import fs from "node:fs";
import path from "node:path";
import { D1_DATABASE_NAME, RUNTIME_MUTABLE_TABLES, hasFlag, runWrangler } from "./migration-config";
import { syncSiteTranslationSources } from "./sync-site-translation-sources";

const migrationPath = path.resolve(process.cwd(), "drizzle-d1/0000_majestic_invisible_woman.sql");

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
    "select name from sqlite_master where type = 'table' and name = 'users';",
  ]);
  const parsed = parseJsonFromOutput<Array<{ results?: Array<{ name?: string }>; success?: boolean }>>(existing, []);
  if (parsed[0]?.results?.[0]?.name !== "users") {
    runWrangler(["d1", "execute", D1_DATABASE_NAME, "--local", "--file", migrationPath]);
    localSchema = "created";
  }

  const sourceSync = syncSiteTranslationSources("local");
  const resetRuntimeTables = hasFlag("--reset-runtime-state") ? resetLocalRuntimeState() : [];
  console.log(JSON.stringify({ database: D1_DATABASE_NAME, localSchema, sourceSync, resetRuntimeTables }));
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
