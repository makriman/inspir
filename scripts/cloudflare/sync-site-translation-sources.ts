import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import { cloudflareDir, createHash, D1_DATABASE_NAME, resolveBackupDir, runWrangler } from "./migration-config";

type SourceManifestEntry = {
  sourceHash: string;
  sourceStrings: Record<string, string>;
};

type SyncMode = "local" | "remote";

export type SiteTranslationSourceSyncReport = {
  createdAt: string;
  backupDir: string;
  mode: SyncMode;
  database: string;
  rows: number;
  sourceStringCount: number;
  sha256: string;
  ok: boolean;
};

if (isMainModule()) void main();

function main() {
  const mode: SyncMode = process.argv.includes("--remote") ? "remote" : "local";
  const backupDir = resolveBackupDir();
  const report = syncSiteTranslationSources(mode, backupDir);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function syncSiteTranslationSources(mode: SyncMode = "local", backupDir = resolveBackupDir()) {
  const sources = manifestEntries();
  const sqlPath = writeSqlFile(sources);
  try {
    runWrangler([
      "d1",
      "execute",
      D1_DATABASE_NAME,
      mode === "remote" ? "--remote" : "--local",
      "--file",
      sqlPath,
    ], { maxBuffer: 128 * 1024 * 1024 });
  } finally {
    fs.rmSync(sqlPath, { force: true });
  }

  const report: SiteTranslationSourceSyncReport = {
    createdAt: new Date().toISOString(),
    backupDir,
    mode,
    database: D1_DATABASE_NAME,
    rows: sources.length,
    sourceStringCount: sources.reduce((sum, [, entry]) => sum + Object.keys(entry.sourceStrings).length, 0),
    sha256: sourceManifestHash(sources),
    ok: sources.length > 0,
  };
  writeReport(report, backupDir);
  return report;
}

function manifestEntries() {
  return Object.entries(siteSourceManifest as Record<string, SourceManifestEntry>).sort(([a], [b]) => a.localeCompare(b));
}

function writeSqlFile(sources: Array<[string, SourceManifestEntry]>) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-site-translation-sources-"));
  const sqlPath = path.join(tmpDir, "site-translation-sources.sql");
  fs.writeFileSync(sqlPath, buildSiteTranslationSourceSql(sources), { mode: 0o600 });
  return sqlPath;
}

export function buildSiteTranslationSourceSql(sources = manifestEntries()) {
  const now = Date.now();
  const statements = [
    "PRAGMA foreign_keys = ON;",
    "DROP TABLE IF EXISTS app_translation_source_strings;",
    "DROP TABLE IF EXISTS app_translation_sources;",
    "CREATE TABLE IF NOT EXISTS app_translation_sources (namespace text PRIMARY KEY NOT NULL, source_hash text NOT NULL, updated_at integer NOT NULL);",
    "CREATE TABLE IF NOT EXISTS app_translation_source_strings (namespace text NOT NULL, source_key text NOT NULL, source_text text NOT NULL, PRIMARY KEY(namespace, source_key), FOREIGN KEY(namespace) REFERENCES app_translation_sources(namespace) ON DELETE CASCADE);",
  ];

  for (const [namespace, entry] of sources) {
    statements.push(
      [
        "INSERT INTO app_translation_sources (namespace, source_hash, updated_at) VALUES (",
        sqlString(namespace),
        ", ",
        sqlString(entry.sourceHash),
        ", ",
        String(now),
        ") ON CONFLICT(namespace) DO UPDATE SET source_hash = excluded.source_hash, updated_at = excluded.updated_at;",
      ].join(""),
    );
    statements.push(`DELETE FROM app_translation_source_strings WHERE namespace = ${sqlString(namespace)};`);
    for (const [key, value] of Object.entries(entry.sourceStrings)) {
      statements.push(
        [
          "INSERT INTO app_translation_source_strings (namespace, source_key, source_text) VALUES (",
          sqlString(namespace),
          ", ",
          sqlString(key),
          ", ",
          sqlString(value),
          ");",
        ].join(""),
      );
    }
  }

  return `${statements.join("\n")}\n`;
}

function sourceManifestHash(sources: Array<[string, SourceManifestEntry]>) {
  return createHash()
    .update(JSON.stringify(sources.map(([namespace, entry]) => [namespace, entry.sourceHash, entry.sourceStrings])))
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

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
