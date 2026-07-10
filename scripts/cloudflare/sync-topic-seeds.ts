import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";
import {
  cloudflareDir,
  createHash,
  D1_DATABASE_NAME,
  resolveBackupDir,
  runWrangler,
  stableStringify,
} from "./migration-config";

type SyncMode = "local" | "remote";

export type TopicSeedSyncReport = {
  createdAt: string;
  mode: SyncMode;
  database: string;
  topics: number;
  sha256: string;
  managedSlugs: number;
  retiredManagedSlugs: readonly string[];
  batches: number;
  ok: boolean;
};

const managedSlugsMetadataKey = "topic_seed_slugs";
const retiredManagedTopicSlugs = ["ai-game-arena"] as const;
const topicSeedBatchSize = 12;

if (isMainModule()) void main();

function main() {
  const mode: SyncMode = process.argv.includes("--remote") ? "remote" : "local";
  const report = syncTopicSeeds(mode);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

/**
 * Synchronize curated topics from an explicit setup/deploy command. Runtime
 * requests only read D1 and never perform this write-heavy initialization.
 */
export function syncTopicSeeds(mode: SyncMode = "local", backupDir = resolveBackupDir()) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-topic-seeds-"));
  const sha256 = topicSeedHash();
  const batches = buildTopicSeedSqlBatches(topicSeeds, Date.now(), sha256);

  try {
    for (const [index, sql] of batches.entries()) {
      const sqlPath = path.join(tmpDir, `topic-seeds-${String(index + 1).padStart(2, "0")}.sql`);
      fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
      runWrangler([
        "d1",
        "execute",
        D1_DATABASE_NAME,
        mode === "remote" ? "--remote" : "--local",
        "--file",
        sqlPath,
      ]);
    }
  } finally {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }

  const report: TopicSeedSyncReport = {
    createdAt: new Date().toISOString(),
    mode,
    database: D1_DATABASE_NAME,
    topics: topicSeeds.length,
    sha256,
    managedSlugs: topicSeeds.length,
    retiredManagedSlugs: retiredManagedTopicSlugs,
    batches: batches.length,
    ok: topicSeeds.length > 0,
  };
  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), `topic-seeds-${mode}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  return report;
}

export function buildTopicSeedSql(
  seeds: readonly TopicSeed[] = topicSeeds,
  now = Date.now(),
  seedHash = topicSeedHash(seeds),
) {
  return buildTopicSeedSqlBatches(seeds, now, seedHash).join("");
}

/**
 * D1's SQL upload has a bounded statement payload. Each file is an atomic,
 * idempotent batch; completion markers are written only after every upsert.
 */
export function buildTopicSeedSqlBatches(
  seeds: readonly TopicSeed[] = topicSeeds,
  now = Date.now(),
  seedHash = topicSeedHash(seeds),
) {
  const managedSlugs = seeds.map((seed) => seed.slug);
  const managedSlugSql = managedSlugs.length ? managedSlugs.map(sqlValue).join(", ") : "NULL";
  const retiredSlugSql = retiredManagedTopicSlugs.map(sqlValue).join(", ");
  const reconciliationStatements = [
    "PRAGMA foreign_keys = ON;",
    [
      "UPDATE topics SET status = 'archived', updated_at = ",
      String(now),
      " WHERE slug NOT IN (",
      managedSlugSql,
      ") AND (slug IN (",
      retiredSlugSql,
      ") OR slug IN (SELECT value FROM json_each(COALESCE((SELECT value FROM app_metadata WHERE key = '",
      managedSlugsMetadataKey,
      "'), '[]'))));",
    ].join(""),
  ];
  const upsertStatements = seeds.map((seed) => buildTopicUpsertSql(seed, now));
  const completionStatements = [
    buildMetadataUpsertSql("topic_seed_hash", seedHash, now),
    buildMetadataUpsertSql(managedSlugsMetadataKey, stableStringify(managedSlugs), now),
  ];

  const batches = [sqlBatch(reconciliationStatements)];
  for (let index = 0; index < upsertStatements.length; index += topicSeedBatchSize) {
    batches.push(sqlBatch(["PRAGMA foreign_keys = ON;", ...upsertStatements.slice(index, index + topicSeedBatchSize)]));
  }
  batches.push(sqlBatch(["PRAGMA foreign_keys = ON;", ...completionStatements]));
  return batches;
}

function buildTopicUpsertSql(seed: TopicSeed, now: number) {
  const values = [
    seed.slug,
    seed.slug,
    seed.name,
    seed.subText,
    seed.description,
    seed.inputboxText,
    seed.systemPrompt,
    seed.sortOrder,
    "active",
    stableStringify(seed.metadata),
    now,
    now,
  ];
  return [
    "INSERT INTO topics (id, slug, name, sub_text, description, inputbox_text, system_prompt, sort_order, status, metadata, created_at, updated_at) VALUES (",
    values.map(sqlValue).join(", "),
    ") ON CONFLICT(slug) DO UPDATE SET ",
    "name = excluded.name, ",
    "sub_text = excluded.sub_text, ",
    "description = excluded.description, ",
    "inputbox_text = excluded.inputbox_text, ",
    "system_prompt = excluded.system_prompt, ",
    "sort_order = excluded.sort_order, ",
    "metadata = excluded.metadata, ",
    "updated_at = excluded.updated_at;",
  ].join("");
}

function buildMetadataUpsertSql(key: string, value: string, now: number) {
  return [
    "INSERT INTO app_metadata (key, value, updated_at) VALUES (",
    sqlValue(key),
    ", ",
    sqlValue(value),
    ", ",
    String(now),
    ") ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;",
  ].join("");
}

function sqlBatch(statements: string[]) {
  return `${statements.join("\n")}\n`;
}

export function topicSeedHash(seeds: readonly TopicSeed[] = topicSeeds) {
  return createHash().update(stableStringify(seeds)).digest("hex");
}

function sqlValue(value: string | number) {
  return typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
