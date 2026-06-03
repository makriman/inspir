import { asc, eq } from "drizzle-orm";
import {
  buildChatHistoryMemoryContent,
  compileUserMemoryProfile,
  detectMemoryIntent,
  isUsefulMemoryContent,
  upsertChatHistoryMemoryFromTurn,
} from "@/lib/ai/memory";
import { db, sql } from "@/lib/db/client";
import { chatMemoryTurns, chats, topics, users } from "@/lib/db/schema";

type Args = {
  dryRun: boolean;
  limit?: number;
  user?: string;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  const args = parseArgs(process.argv.slice(2));
  const rows = await db
    .select({
      id: chatMemoryTurns.id,
      userId: chatMemoryTurns.userId,
      userEmail: users.email,
      chatId: chatMemoryTurns.chatId,
      topicId: chatMemoryTurns.topicId,
      topicName: topics.name,
      topicSlug: topics.slug,
      topicNameSnapshot: chats.topicNameSnapshot,
      userMessageId: chatMemoryTurns.userMessageId,
      question: chatMemoryTurns.question,
      answerExcerpt: chatMemoryTurns.answerExcerpt,
      topics: chatMemoryTurns.topics,
      embedding: chatMemoryTurns.embedding,
      updatedAt: chatMemoryTurns.updatedAt,
    })
    .from(chatMemoryTurns)
    .innerJoin(users, eq(users.id, chatMemoryTurns.userId))
    .leftJoin(chats, eq(chats.id, chatMemoryTurns.chatId))
    .leftJoin(topics, eq(topics.id, chatMemoryTurns.topicId))
    .orderBy(asc(chatMemoryTurns.updatedAt), asc(chatMemoryTurns.id))
    .limit(args.limit ?? 100_000);

  const filteredRows = args.user
    ? rows.filter((row) => row.userEmail === args.user || row.userId === args.user)
    : rows;

  console.log(
    JSON.stringify({
      event: "chat_memory_materialize_start",
      dryRun: args.dryRun,
      rows: filteredRows.length,
      user: args.user ?? null,
      limit: args.limit ?? null,
    }),
  );

  const changedCategories = new Map<string, Set<string>>();
  const stats = {
    materialized: 0,
    skippedControlTurn: 0,
    skippedLowInformation: 0,
    skippedDryRun: 0,
    skippedExistingUserEdit: 0,
    failed: 0,
  };

  for (const row of filteredRows) {
    const topicName = row.topicName ?? row.topicNameSnapshot ?? row.topics?.[0] ?? "Previous chat";
    const intent = detectMemoryIntent(row.question);
    if (intent === "explicit_remember" || intent === "explicit_forget" || intent === "ask_about_memory") {
      stats.skippedControlTurn += 1;
      continue;
    }

    const content = buildChatHistoryMemoryContent({
      topicName,
      question: row.question,
      answerExcerpt: row.answerExcerpt,
    });
    if (!isUsefulMemoryContent(content)) {
      stats.skippedLowInformation += 1;
      continue;
    }

    if (args.dryRun) {
      stats.skippedDryRun += 1;
      continue;
    }

    try {
      const category = await upsertChatHistoryMemoryFromTurn({
        userId: row.userId,
        chatId: row.chatId,
        topicName,
        topicSlug: row.topicSlug,
        userMessageId: row.userMessageId,
        question: row.question,
        answerExcerpt: row.answerExcerpt,
        topics: row.topics,
        embedding: Array.isArray(row.embedding) ? row.embedding : null,
      });

      if (category) {
        const categories = changedCategories.get(row.userId) ?? new Set<string>();
        categories.add(category);
        changedCategories.set(row.userId, categories);
        stats.materialized += 1;
      } else {
        stats.skippedExistingUserEdit += 1;
      }
    } catch (error) {
      stats.failed += 1;
      console.error(
        JSON.stringify({
          event: "chat_memory_materialize_failed",
          userId: row.userId,
          chatId: row.chatId,
          userMessageId: row.userMessageId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  for (const [userId, categories] of changedCategories) {
    for (const category of categories) {
      await compileUserMemoryProfile(userId, category);
    }
  }

  console.log(
    JSON.stringify({
      event: "chat_memory_materialize_complete",
      changedUsers: changedCategories.size,
      ...stats,
    }),
  );
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--limit" && next) {
      args.limit = parsePositiveInteger(next, "--limit");
      index += 1;
    } else if (arg === "--user" && next) {
      args.user = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
