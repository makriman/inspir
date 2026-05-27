import { existsSync } from "fs";
import { join } from "path";
import { sql } from "@/lib/db/client";
import { duplicateAwareRows, readCsv } from "@/lib/migration/csv";

function rawDir() {
  const candidates = [join(process.cwd(), "Export from Bubble"), join(process.cwd(), "data", "raw")];
  return candidates.find((candidate) => existsSync(candidate));
}

function readOptional(name: string) {
  const dir = rawDir();
  if (!dir) return [];
  const path = join(dir, name);
  return existsSync(path) ? readCsv(path) : [];
}

async function countQuery(query: ReturnType<typeof sql>) {
  const rows = await query;
  return Number(Object.values(rows[0] ?? { count: 0 })[0] ?? 0);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for validation.");

  const chatsRows = readOptional("export_All-chats_2026-05-27_16-48-04.csv");
  const messagesRows = readOptional("export_All-Messages_2026-05-27_16-48-44.csv");
  const dummyRows = readOptional("export_All-dummyData_2026-05-27_16-48-22.csv");
  const skipped =
    duplicateAwareRows(chatsRows, false).skipped +
    duplicateAwareRows(messagesRows, false).skipped +
    duplicateAwareRows(dummyRows, false).skipped;

  const summary = {
    users_imported: await countQuery(sql`select count(*) from users`),
    active_topics_imported: await countQuery(sql`select count(*) from topics where status = 'active'`),
    archived_topics_imported: await countQuery(sql`select count(*) from topics where status = 'archived'`),
    topic_aliases_imported: await countQuery(sql`select count(*) from topic_legacy_ids`),
    legacy_chats_reconstructed: await countQuery(
      sql`select count(*) from chats where legacy_bubble_id is not null`,
    ),
    messages_imported: await countQuery(sql`select count(*) from messages`),
    legacy_chat_snapshots_imported: await countQuery(sql`select count(*) from legacy_chat_snapshots`),
    duplicate_rows_skipped: skipped,
    orphan_messages: await countQuery(sql`
      select count(*)
      from messages m
      left join chats c on c.id = m.chat_id
      where c.id is null
    `),
    orphan_topic_ids: await countQuery(sql`
      select count(distinct m.legacy_topic_id)
      from messages m
      left join topic_legacy_ids t on t.legacy_id = m.legacy_topic_id
      where m.legacy_topic_id is not null and t.legacy_id is null
    `),
  };

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
