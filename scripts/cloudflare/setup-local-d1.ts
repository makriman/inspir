import fs from "node:fs";
import path from "node:path";
import { D1_DATABASE_NAME, RUNTIME_MUTABLE_TABLES, hasFlag, runWrangler } from "./migration-config";
import { syncSiteTranslationSources } from "./sync-site-translation-sources";
import { syncTopicSeeds } from "./sync-topic-seeds";

const migrationPath = path.resolve(process.cwd(), "drizzle-d1/0000_majestic_invisible_woman.sql");
const migrationDir = path.dirname(migrationPath);

void main();

function main() {
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Missing local D1 migration file: ${migrationPath}`);
  }

  let localSchema = "present";
  const existing = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--local",
    "--json",
    "--command",
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%';",
  ]);
  const parsed = parseJsonFromOutput<Array<{ results?: Array<{ name?: string }>; success?: boolean }>>(existing, []);
  const applicationTables = (parsed[0]?.results ?? [])
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string" && !name.startsWith("_cf_"));
  if (!applicationTables.includes("users")) {
    if (applicationTables.length > 0) {
      runWrangler([
        "d1",
        "execute",
        D1_DATABASE_NAME,
        "--local",
        "--command",
        idempotentBaseMigration(fs.readFileSync(migrationPath, "utf8")),
      ]);
      localSchema = "completed-incomplete";
    } else {
      runWrangler(["d1", "execute", D1_DATABASE_NAME, "--local", "--file", migrationPath]);
      localSchema = "created";
    }
  }

  const supplementalMigrations = applySupplementalMigrations();
  const topicSeedSync = syncTopicSeeds("local");
  const sourceSync = syncSiteTranslationSources("local");
  const resetRuntimeTables = hasFlag("--reset-runtime-state") ? resetLocalRuntimeState() : [];
  console.log(
    JSON.stringify({
      database: D1_DATABASE_NAME,
      localSchema,
      supplementalMigrations,
      topicSeedSync,
      sourceSync,
      resetRuntimeTables,
    }),
  );
}

function idempotentBaseMigration(source: string) {
  return source
    .replaceAll("--> statement-breakpoint", "")
    .replaceAll("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ")
    .replace(/CREATE (UNIQUE )?INDEX /g, "CREATE $1INDEX IF NOT EXISTS ");
}

function applySupplementalMigrations() {
  runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--local",
    "--command",
    'create table if not exists "__inspir_local_migrations" ("name" text primary key not null, "applied_at" integer not null);',
  ]);
  const existingOutput = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--local",
    "--json",
    "--command",
    'select "name" from "__inspir_local_migrations";',
  ]);
  const existingRows = parseJsonFromOutput<Array<{ results?: Array<{ name?: string }> }>>(existingOutput, []);
  const applied = new Set(existingRows.flatMap((row) => row.results ?? []).map((row) => row.name).filter(Boolean));
  const baseMigration = path.basename(migrationPath);
  const migrationFiles = fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql") && file !== baseMigration)
    .sort();
  const appliedNow: string[] = [];

  for (const file of migrationFiles) {
    if (applied.has(file)) continue;
    runWrangler(["d1", "execute", D1_DATABASE_NAME, "--local", "--file", path.join(migrationDir, file)]);
    runWrangler([
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--local",
      "--command",
      `insert into "__inspir_local_migrations" ("name", "applied_at") values (${sqlString(file)}, ${Date.now()}) on conflict ("name") do update set "applied_at" = excluded."applied_at";`,
    ]);
    appliedNow.push(file);
  }

  return appliedNow;
}

function resetLocalRuntimeState() {
  for (const table of RUNTIME_MUTABLE_TABLES) {
    runWrangler(["d1", "execute", D1_DATABASE_NAME, "--local", "--command", `delete from "${table}";`]);
  }
  return [...RUNTIME_MUTABLE_TABLES];
}

function parseJsonFromOutput<T>(output: string, fallback: T): T {
  const trimmed = output.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const first =
      firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
    const last = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (first === -1 || last === -1 || last <= first) return fallback;
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  }
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
