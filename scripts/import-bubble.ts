import { existsSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db, sql } from "@/lib/db/client";
import {
  chats,
  legacyChatSnapshots,
  legacyDummyData,
  messages,
  topicLegacyIds,
  topics,
  users,
} from "@/lib/db/schema";
import { duplicateAwareRows, hasUniqueId, readCsv, type CsvRow } from "@/lib/migration/csv";
import { parseBubbleDate } from "@/lib/utils/dates";
import { slugify } from "@/lib/utils/slug";

const ASSISTANT_LEGACY_ID = "1679932487751x915434052091153300";

type MessageInsert = typeof messages.$inferInsert;

type Summary = Record<string, number | string[]>;

function argValue(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function rawDir() {
  const candidates = [join(process.cwd(), "Export from Bubble"), join(process.cwd(), "data", "raw")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Could not find Bubble export folder.");
  return found;
}

function file(name: string) {
  return join(rawDir(), name);
}

function assertStrictIds(files: string[]) {
  const missing = files.filter((path) => {
    const rows = readCsv(path);
    return !hasUniqueId(Object.keys(rows[0] ?? {}));
  });
  if (missing.length) {
    throw new Error(
      `Strict import requires Bubble Unique ID columns. Missing in: ${missing
        .map((path) => path.split("/").pop())
        .join(", ")}`,
    );
  }
}

function chunk<T>(values: T[], size = 1000) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

async function importUsers(rows: CsvRow[]) {
  const byEmail = new Map<string, CsvRow>();
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (email) byEmail.set(email, row);
  }

  for (const batch of chunk([...byEmail.entries()], 1000)) {
    await db
      .insert(users)
      .values(
        batch.map(([email, row]) => ({
          email,
          profilePictureUrl: row.proile_picture || null,
          image: row.proile_picture || null,
          createdAt: parseBubbleDate(row["Creation Date"]) ?? new Date(),
          updatedAt: parseBubbleDate(row["Modified Date"]) ?? new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: users.email,
        set: {
          updatedAt: new Date(),
        },
      });
  }

  return byEmail.size;
}

async function importTopics(rows: CsvRow[]) {
  let order = 0;
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    order += 1;
    await db
      .insert(topics)
      .values({
        slug: slugify(name),
        name,
        subText: row.sub_text || "",
        description: row.description || "",
        inputboxText: row.inputbox_text || "",
        systemPrompt: row.system_prompt || "",
        iconUrl: row.topic_icon || null,
        sortOrder: order,
        status: "active",
      })
      .onConflictDoUpdate({
        target: topics.slug,
        set: {
          name,
          subText: row.sub_text || "",
          description: row.description || "",
          inputboxText: row.inputbox_text || "",
          systemPrompt: row.system_prompt || "",
          iconUrl: row.topic_icon || null,
          sortOrder: order,
          status: "active",
          updatedAt: new Date(),
        },
      });
  }
}

async function ensureTopicAlias(legacyId: string, topicName: string | undefined, source: string) {
  if (!legacyId) return;
  const slug = topicName ? slugify(topicName) : undefined;
  let [topic] = slug ? await db.select().from(topics).where(eq(topics.slug, slug)).limit(1) : [];

  if (!topic) {
    const name = topicName?.trim() || `Legacy topic ${legacyId.slice(0, 8)}`;
    const archivedSlug = slugify(`${name}-${legacyId.slice(0, 8)}`);
    const [created] = await db
      .insert(topics)
      .values({
        slug: archivedSlug,
        name,
        subText: "Imported legacy topic",
        description: "Archived topic reconstructed from Bubble export.",
        inputboxText: "What would you like to learn today?",
        systemPrompt: "You are inspir Buddy. Help the user learn clearly and practically.",
        status: "archived",
        sortOrder: 1000,
      })
      .onConflictDoNothing()
      .returning();
    if (created) {
      topic = created;
    } else {
      [topic] = await db.select().from(topics).where(eq(topics.slug, archivedSlug)).limit(1);
    }
  }

  await db
    .insert(topicLegacyIds)
    .values({ legacyId, topicId: topic.id, source, confidence: topicName ? "derived" : "low" })
    .onConflictDoNothing();
}

async function importAliasesFromChats(rows: CsvRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    const legacyId = row.topicId?.trim();
    if (!legacyId || seen.has(legacyId)) continue;
    seen.add(legacyId);
    await ensureTopicAlias(legacyId, row.topic_name, "csv_chats_topic_name");
  }
  return seen.size;
}

async function importLegacyChatsAndMessages(rows: CsvRow[]) {
  const byChat = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const chatId = row.chatId?.trim();
    if (!chatId) continue;
    const group = byChat.get(chatId) ?? [];
    group.push(row);
    byChat.set(chatId, group);
  }

  const aliasRows = await db.select().from(topicLegacyIds);
  const aliasMap = new Map(aliasRows.map((row) => [row.legacyId, row.topicId]));
  const chatIdMap = new Map<string, string>();

  for (const [legacyChatId, group] of byChat) {
    const legacyTopicId = mostCommon(group.map((row) => row.topic_id));
    if (legacyTopicId && !aliasMap.has(legacyTopicId)) {
      await ensureTopicAlias(legacyTopicId, undefined, "csv_messages_topic_id");
    }
    const [alias] = legacyTopicId
      ? await db.select().from(topicLegacyIds).where(eq(topicLegacyIds.legacyId, legacyTopicId)).limit(1)
      : [];
    const firstDate = parseBubbleDate(group[0]?.["Creation Date"]);
    const [chat] = await db
      .insert(chats)
      .values({
        legacyBubbleId: legacyChatId,
        topicId: alias?.topicId ?? aliasMap.get(legacyTopicId ?? "") ?? null,
        legacyTopicId: legacyTopicId ?? null,
        topicNameSnapshot: legacyTopicId ? `Legacy topic ${legacyTopicId}` : "Legacy chat",
        title: group.find((row) => row.senderId !== ASSISTANT_LEGACY_ID)?.text?.slice(0, 96) || "Legacy chat",
        createdAt: firstDate ?? new Date(),
        updatedAt: parseBubbleDate(group[group.length - 1]?.["Creation Date"]) ?? firstDate ?? new Date(),
      })
      .onConflictDoUpdate({
        target: chats.legacyBubbleId,
        set: {
          updatedAt: new Date(),
        },
      })
      .returning();
    chatIdMap.set(legacyChatId, chat.id);
  }

  let imported = 0;
  for (const batch of chunk(rows.filter((row) => row.chatId?.trim()), 1000)) {
    const values = batch.reduce<MessageInsert[]>((acc, row) => {
        const chatId = chatIdMap.get(row.chatId.trim());
        if (!chatId || !row.text?.trim()) return acc;
        acc.push({
          chatId,
          role: row.senderId === ASSISTANT_LEGACY_ID ? "assistant" : "user",
          content: row.text,
          legacySenderId: row.senderId || null,
          legacyUserId: row.user_id || null,
          legacyTopicId: row.topic_id || null,
          createdAt: parseBubbleDate(row["Creation Date"]) ?? new Date(),
        });
        return acc;
      }, []);
    if (!values.length) continue;
    await db.insert(messages).values(values);
    imported += values.length;
  }

  return { chats: byChat.size, messages: imported };
}

async function importSnapshots(rows: CsvRow[]) {
  for (const batch of chunk(rows, 1000)) {
    await db.insert(legacyChatSnapshots).values(
      batch.map((row) => ({
        assistantRaw: row.assistant || null,
        messagesRaw: row.messages || null,
        questionsRaw: row.questions || null,
        topicRaw: row.topic || null,
        topicName: row.topic_name || null,
        legacyTopicId: row.topicId || null,
        userEmail: row.user_email || null,
      })),
    );
  }
  return rows.length;
}

async function importDummy(rows: CsvRow[]) {
  for (const batch of chunk(rows, 1000)) {
    await db.insert(legacyDummyData).values(
      batch.map((row) => ({
        dummy: row.dummy || null,
        legacyTopicId: row.topicId || null,
        creatorLegacyId: row.Creator || null,
        createdAt: parseBubbleDate(row["Creation Date"]),
        modifiedAt: parseBubbleDate(row["Modified Date"]),
      })),
    );
  }
  return rows.length;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for import.");

  const mode = argValue("--mode", process.env.IMPORT_MODE ?? "best-effort");
  const preserveDuplicates = process.env.PRESERVE_DUPLICATES === "true";
  const paths = {
    users: file("export_All-Users_2026-05-27_16-49-13.csv"),
    chats: file("export_All-chats_2026-05-27_16-48-04.csv"),
    messages: file("export_All-Messages_2026-05-27_16-48-44.csv"),
    topics: file("export_All-topics_2026-05-27_16-48-57.csv"),
    dummy: file("export_All-dummyData_2026-05-27_16-48-22.csv"),
  };

  if (mode === "strict") assertStrictIds(Object.values(paths));

  const usersRows = readCsv(paths.users);
  const topicRows = readCsv(paths.topics);
  const chatsDedup = duplicateAwareRows(readCsv(paths.chats), preserveDuplicates);
  const messagesDedup = duplicateAwareRows(readCsv(paths.messages), preserveDuplicates);
  const dummyDedup = duplicateAwareRows(readCsv(paths.dummy), preserveDuplicates);

  await importTopics(topicRows);

  const summary: Summary = {
    users_imported: await importUsers(usersRows),
    active_topics_imported: topicRows.filter((row) => row.name?.trim()).length,
    topic_aliases_imported: await importAliasesFromChats(chatsDedup.rows),
    duplicate_rows_skipped:
      chatsDedup.skipped + messagesDedup.skipped + dummyDedup.skipped,
  };

  const legacy = await importLegacyChatsAndMessages(messagesDedup.rows);
  summary.legacy_chats_reconstructed = legacy.chats;
  summary.messages_imported = legacy.messages;
  summary.legacy_chat_snapshots_imported = await importSnapshots(chatsDedup.rows);
  summary.legacy_dummy_data_imported = await importDummy(dummyDedup.rows);

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
