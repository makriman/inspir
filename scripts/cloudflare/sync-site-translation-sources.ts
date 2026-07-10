import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import {
  cloudflareDir,
  createHash,
  D1_DATABASE_NAME,
  resolveBackupDir,
  runWrangler,
} from "./migration-config";

export type SourceManifestEntry = {
  sourceHash: string;
  sourceStrings: Record<string, string>;
};

type SyncMode = "local" | "remote";

export type SiteTranslationSourceSnapshot = {
  sources: Record<string, string>;
  sourceStrings: Record<string, Record<string, string>>;
};

export type SiteTranslationSourceSyncPlan = {
  sql: string;
  rows: number;
  sourceStringCount: number;
  sha256: string;
  statements: number;
  logicalRowWrites: number;
  projectedBilledRowWrites: number;
};

export type SiteTranslationSourceSyncReport = {
  createdAt: string;
  backupDir: string;
  mode: SyncMode;
  database: string;
  rows: number;
  sourceStringCount: number;
  sha256: string;
  statements: number;
  logicalRowWrites: number;
  projectedBilledRowWrites: number;
  projectedBilledRowWriteLimit: number;
  applied: boolean;
  ok: boolean;
};

// Keep at least half of the Workers Free daily D1 write allowance available for
// normal application traffic and unrelated release work. The factor below is
// conservative because D1 can count a table row and its primary-key index as
// separate writes.
export const MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES = 50_000;
const PROJECTED_BILLED_WRITES_PER_LOGICAL_ROW = 2;

if (isMainModule()) void main();

function main() {
  const mode: SyncMode = process.argv.includes("--remote") ? "remote" : "local";
  const confirmed = process.argv.includes("--confirm-production");
  const backupDir = resolveBackupDir();
  const report = syncSiteTranslationSources(mode, backupDir, { confirmed });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function syncSiteTranslationSources(
  mode: SyncMode = "local",
  backupDir = resolveBackupDir(),
  options: { confirmed?: boolean } = {},
) {
  if (mode === "remote" && !options.confirmed) {
    throw new Error("Remote site translation source synchronization requires --confirm-production.");
  }

  const plan = planSiteTranslationSourceSync(mode);
  assertSourceSyncWriteBudget(plan);
  if (plan.statements > 0) executeSiteTranslationSourceSyncPlan(plan, mode);

  const report: SiteTranslationSourceSyncReport = {
    createdAt: new Date().toISOString(),
    backupDir,
    mode,
    database: D1_DATABASE_NAME,
    rows: plan.rows,
    sourceStringCount: plan.sourceStringCount,
    sha256: plan.sha256,
    statements: plan.statements,
    logicalRowWrites: plan.logicalRowWrites,
    projectedBilledRowWrites: plan.projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    applied: plan.statements > 0,
    ok: plan.rows > 0,
  };
  writeReport(report, backupDir);
  return report;
}

export function planSiteTranslationSourceSync(mode: SyncMode): SiteTranslationSourceSyncPlan {
  return buildSiteTranslationSourceSyncPlan(manifestEntries(), readCurrentSnapshot(mode));
}

export function buildSiteTranslationSourceSyncPlan(
  sources: Array<[string, SourceManifestEntry]> = manifestEntries(),
  current: SiteTranslationSourceSnapshot = emptySnapshot(),
  updatedAt = Date.now(),
): SiteTranslationSourceSyncPlan {
  const statements: string[] = [];
  let logicalRowWrites = 0;
  const desiredNamespaces = new Set(sources.map(([namespace]) => namespace));

  for (const [namespace, entry] of sources) {
    if (current.sources[namespace] !== entry.sourceHash) {
      statements.push(
        [
          "INSERT INTO app_translation_sources (namespace, source_hash, updated_at) VALUES (",
          sqlString(namespace),
          ", ",
          sqlString(entry.sourceHash),
          ", ",
          String(updatedAt),
          ") ON CONFLICT(namespace) DO UPDATE SET source_hash = excluded.source_hash, updated_at = excluded.updated_at",
          " WHERE app_translation_sources.source_hash <> excluded.source_hash;",
        ].join(""),
      );
      logicalRowWrites += 1;
    }

    const currentStrings = current.sourceStrings[namespace] ?? {};
    for (const [key, value] of Object.entries(entry.sourceStrings)) {
      if (currentStrings[key] === value) continue;
      statements.push(
        [
          "INSERT INTO app_translation_source_strings (namespace, source_key, source_text) VALUES (",
          sqlString(namespace),
          ", ",
          sqlString(key),
          ", ",
          sqlString(value),
          ") ON CONFLICT(namespace, source_key) DO UPDATE SET source_text = excluded.source_text",
          " WHERE app_translation_source_strings.source_text <> excluded.source_text;",
        ].join(""),
      );
      logicalRowWrites += 1;
    }

    const desiredKeys = new Set(Object.keys(entry.sourceStrings));
    for (const key of Object.keys(currentStrings)) {
      if (desiredKeys.has(key)) continue;
      statements.push(
        "DELETE FROM app_translation_source_strings WHERE namespace = " +
          sqlString(namespace) +
          " AND source_key = " +
          sqlString(key) +
          ";",
      );
      logicalRowWrites += 1;
    }
  }

  for (const namespace of Object.keys(current.sources)) {
    if (desiredNamespaces.has(namespace)) continue;
    statements.push(
      "DELETE FROM app_translation_sources WHERE namespace = " + sqlString(namespace) + ";",
    );
    logicalRowWrites += 1 + Object.keys(current.sourceStrings[namespace] ?? {}).length;
  }

  return {
    sql: statements.length ? "PRAGMA foreign_keys = ON;\n" + statements.join("\n") + "\n" : "",
    rows: sources.length,
    sourceStringCount: sources.reduce(
      (sum, [, entry]) => sum + Object.keys(entry.sourceStrings).length,
      0,
    ),
    sha256: sourceManifestHash(sources),
    statements: statements.length,
    logicalRowWrites,
    projectedBilledRowWrites: logicalRowWrites * PROJECTED_BILLED_WRITES_PER_LOGICAL_ROW,
  };
}

export function assertSourceSyncWriteBudget(plan: SiteTranslationSourceSyncPlan) {
  if (plan.projectedBilledRowWrites > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES) {
    throw new Error(
      "Projected D1 source-sync writes exceed the Workers Free safety budget: " +
        plan.projectedBilledRowWrites +
        " > " +
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES +
        ".",
    );
  }
}

export function executeSiteTranslationSourceSyncPlan(plan: SiteTranslationSourceSyncPlan, mode: SyncMode) {
  if (!plan.sql || plan.statements === 0) return;
  const sqlPath = writeTemporarySqlFile(plan.sql, "site-translation-source-sync.sql");
  try {
    runWrangler(
      [
        "d1",
        "execute",
        D1_DATABASE_NAME,
        mode === "remote" ? "--remote" : "--local",
        "--file",
        sqlPath,
        "--yes",
      ],
      { maxBuffer: 128 * 1024 * 1024 },
    );
  } finally {
    fs.rmSync(path.dirname(sqlPath), { recursive: true, force: true });
  }
}

export function writeTemporarySqlFile(sql: string, filename: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-site-translation-sources-"));
  fs.chmodSync(tmpDir, 0o700);
  const sqlPath = path.join(tmpDir, filename);
  fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
  return sqlPath;
}

export function buildSiteTranslationSourceSql(sources = manifestEntries()) {
  return buildSiteTranslationSourceSyncPlan(sources).sql;
}

function manifestEntries() {
  return Object.entries(siteSourceManifest as Record<string, SourceManifestEntry>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
}

function readCurrentSnapshot(mode: SyncMode): SiteTranslationSourceSnapshot {
  const sql = [
    "SELECT namespace, source_hash FROM app_translation_sources ORDER BY namespace;",
    "SELECT namespace, source_key, source_text FROM app_translation_source_strings ORDER BY namespace, source_key;",
  ].join("\n");
  const output = runWrangler(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      mode === "remote" ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  const resultSets = parseD1SourceSnapshotResultSets(output);
  const sourceRows = resultSets[0];
  const sourceStringRows = resultSets[1];
  if (!sourceRows || !sourceStringRows) {
    throw new Error("Wrangler D1 source snapshot is missing an expected result set.");
  }
  const snapshot = emptySnapshot();

  for (const [index, row] of sourceRows.entries()) {
    if (typeof row.namespace !== "string" || typeof row.source_hash !== "string") {
      throw new Error(`Wrangler D1 source snapshot row ${index + 1} has an invalid source contract.`);
    }
    snapshot.sources[row.namespace] = row.source_hash;
  }
  for (const [index, row] of sourceStringRows.entries()) {
    if (
      typeof row.namespace !== "string" ||
      typeof row.source_key !== "string" ||
      typeof row.source_text !== "string"
    ) {
      throw new Error(`Wrangler D1 source-string snapshot row ${index + 1} has an invalid contract.`);
    }
    snapshot.sourceStrings[row.namespace] ??= {};
    snapshot.sourceStrings[row.namespace][row.source_key] = row.source_text;
  }
  return snapshot;
}

function emptySnapshot(): SiteTranslationSourceSnapshot {
  return { sources: {}, sourceStrings: {} };
}

export function parseD1SourceSnapshotResultSets(output: string) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler D1 source snapshot did not return an array.");
  }
  if (parsed.length !== 2) {
    throw new Error(`Wrangler D1 source snapshot returned ${parsed.length} result sets; expected 2.`);
  }
  return parsed.map((entry, resultSetIndex) => {
    if (!isRecord(entry)) {
      throw new Error(`Wrangler D1 source snapshot result set ${resultSetIndex + 1} is malformed.`);
    }
    if (entry.success !== true) {
      throw new Error(`Wrangler D1 source snapshot result set ${resultSetIndex + 1} was unsuccessful.`);
    }
    if (!Array.isArray(entry.results)) {
      throw new Error(`Wrangler D1 source snapshot result set ${resultSetIndex + 1} has no row array.`);
    }
    return entry.results.map((row, rowIndex) => {
      if (!isRecord(row)) {
        throw new Error(
          `Wrangler D1 source snapshot result set ${resultSetIndex + 1} row ${rowIndex + 1} is malformed.`,
        );
      }
      return row;
    });
  });
}

function parseJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw new Error("Could not parse Wrangler D1 source snapshot JSON.");
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function sourceManifestHash(sources: Array<[string, SourceManifestEntry]>) {
  return createHash()
    .update(
      JSON.stringify(
        sources.map(([namespace, entry]) => [namespace, entry.sourceHash, entry.sourceStrings]),
      ),
    )
    .digest("hex");
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function writeReport(report: SiteTranslationSourceSyncReport, backupDir: string) {
  const cfDir = cloudflareDir(backupDir);
  const file = path.join(cfDir, `site-translation-sources-${report.mode}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
