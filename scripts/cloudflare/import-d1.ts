import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  TABLE_ORDER,
  TIMESTAMP_PRECISION_SCHEMA_STATEMENTS,
  TIMESTAMP_PRECISION_TABLE,
  d1ManifestPath,
  cloudflareDir,
  createHash,
  hasFlag,
  quoteIdent,
  readNdjson,
  resolveBackupDir,
  runWranglerResult,
  runWrangler,
  stableStringify,
  timestampPrecisionPath,
  transformedTablePath,
  type D1Row,
  type TableName,
  type TimestampPrecisionRow,
} from "./migration-config";
import { evaluateImporterResponse } from "./importer-response";
import { assertImportPrerequisites, type ImportPrerequisiteReport } from "./import-prerequisites";
import { buildD1ArtifactFingerprint } from "./migration-artifact-fingerprint";
import {
  buildD1PreImportBackupReport,
  d1PreImportBackupSqlPath,
  writeD1PreImportBackupReport,
  type D1PreImportBackupReport,
} from "./d1-pre-import-backup";

const backupDir = resolveBackupDir();
const skipReset = hasFlag("--skip-reset");
const keepImporter = hasFlag("--keep-importer");
const importerName = "inspirlearning-d1-importer";
const token = crypto.randomBytes(32).toString("hex");
const configPath = path.join(cloudflareDir(backupDir), "d1-importer.wrangler.jsonc");
const preImportBackupPath = d1PreImportBackupSqlPath(backupDir);
const manifest = JSON.parse(fs.readFileSync(d1ManifestPath(backupDir), "utf8")) as Array<{ table: TableName; rows: number }>;
const artifactFingerprint = buildD1ArtifactFingerprint(backupDir);
const imported: Record<string, number> = {};
let preImportBackup: D1PreImportBackupReport | undefined;
let timestampPrecision:
  | {
      table: string;
      rows: number;
      sha256: string;
      file: string;
    }
  | undefined;
let importerUrl = "";
let secretDir = "";
let secretFile = "";
let startedAt = "";
let importPrerequisites: ImportPrerequisiteReport | undefined;
let cleanup: { attempted: boolean; ok: boolean | null; kept: boolean; status?: number | null; output?: string } = {
  attempted: false,
  ok: null,
  kept: keepImporter,
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  requireImportConfirmations();
  importPrerequisites = assertImportPrerequisites({ backupDir, kind: "d1" });
  startedAt = new Date().toISOString();
  secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-import-"));
  secretFile = path.join(secretDir, "secrets.json");
  writeImporterConfig();
  fs.writeFileSync(secretFile, JSON.stringify({ MIGRATION_IMPORT_TOKEN: token }), { mode: 0o600 });
  fs.chmodSync(secretFile, 0o600);
  let ok = false;
  let errorMessage: string | undefined;

  try {
    preImportBackup = exportRemoteD1BeforeImport();
    importerUrl = deployImporter();
    await waitForImporter(importerUrl);
    await postStatements(TIMESTAMP_PRECISION_SCHEMA_STATEMENTS.map((sql) => ({ sql })));

    if (!skipReset) {
      const deletes = [
        { sql: `delete from ${quoteIdent(TIMESTAMP_PRECISION_TABLE)}` },
        ...[...TABLE_ORDER].reverse().map((table) => ({ sql: `delete from ${quoteIdent(table)}` })),
      ];
      await postStatements(deletes);
    }

    for (const tableInfo of manifest) {
      const table = tableInfo.table;
      const insertSql = await insertSqlForTable(table);
      let batch: Array<{ sql: string; params: unknown[] }> = [];
      let batchBytes = 0;
      let rows = 0;

      for await (const row of readNdjson(transformedTablePath(backupDir, table))) {
        const params = Object.values(row as D1Row);
        const statement = { sql: insertSql, params };
        const statementBytes = Buffer.byteLength(JSON.stringify(statement), "utf8");
        if (batch.length && (batch.length >= 50 || batchBytes + statementBytes > 3_000_000)) {
          await postStatements(batch);
          batch = [];
          batchBytes = 0;
        }
        batch.push(statement);
        batchBytes += statementBytes;
        rows += 1;
      }

      if (batch.length) await postStatements(batch);
      imported[table] = rows;
      console.log(JSON.stringify({ table, imported: rows, expected: tableInfo.rows }));
    }
    const countMismatches = manifest.filter((tableInfo) => imported[tableInfo.table] !== tableInfo.rows);
    if (countMismatches.length) {
      throw new Error(
        `D1 import count mismatch: ${countMismatches
          .map((tableInfo) => `${tableInfo.table} expected ${tableInfo.rows}, imported ${imported[tableInfo.table] ?? 0}`)
          .join("; ")}`,
      );
    }
    timestampPrecision = await importTimestampPrecisionRows();
    ok = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (!keepImporter) {
      const result = runWranglerResult(["delete", importerName, "--force"], { allowFailure: true });
      cleanup = {
        attempted: true,
        ok: result.ok,
        kept: false,
        status: result.status,
        output: result.output.slice(0, 2000),
      };
    }
    const cleanupOk = keepImporter || cleanup.ok === true;
    const finalOk = ok && cleanupOk;
    if (ok && !cleanupOk) {
      errorMessage = errorMessage ?? "D1 importer cleanup failed after data import";
      process.exitCode = 1;
    }
    if (secretDir) fs.rmSync(secretDir, { recursive: true, force: true });
    writeReport({
      createdAt: new Date().toISOString(),
      startedAt,
      completedAt: new Date().toISOString(),
      backupDir,
      ok: finalOk,
      importOk: ok,
      resetSkipped: skipReset,
      cleanupOk,
      error: errorMessage,
      database: D1_DATABASE_NAME,
      databaseId: D1_DATABASE_ID,
      importerName,
      importerUrl,
      imported,
      preImportBackup,
      importPrerequisites,
      timestampPrecision,
      artifactFingerprint,
      cleanup,
    });
  }
}

function exportRemoteD1BeforeImport() {
  fs.rmSync(preImportBackupPath, { force: true });
  const output = runWrangler(["d1", "export", D1_DATABASE_NAME, "--remote", "--output", preImportBackupPath]);
  const report = buildD1PreImportBackupReport({
    backupDir,
    database: D1_DATABASE_NAME,
    databaseId: D1_DATABASE_ID,
    wranglerOutputExcerpt: output.slice(0, 2000),
  });
  writeD1PreImportBackupReport(report, backupDir);
  console.log(JSON.stringify({ event: "d1_pre_import_backup", file: report.file, bytes: report.bytes, sha256: report.sha256 }));
  return report;
}

function requireImportConfirmations() {
  const required = {
    CONFIRM_WRITE_FREEZE: "1",
    CONFIRM_D1_IMPORT: "1",
    CONFIRM_D1_DATABASE_NAME: D1_DATABASE_NAME,
    CONFIRM_D1_DATABASE_ID: D1_DATABASE_ID,
    CONFIRM_BACKUP_DIR: backupDir,
    ...(keepImporter ? { CONFIRM_KEEP_D1_IMPORTER: "1" } : {}),
    ...(skipReset ? { CONFIRM_D1_SKIP_RESET: "1" } : {}),
  };
  const missing = Object.entries(required)
    .filter(([key, expected]) => process.env[key] !== expected)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      [
        "Refusing remote D1 import without explicit write-freeze confirmations.",
        `Missing or incorrect: ${missing.join(", ")}`,
        "This command deletes/replaces production D1 data unless --skip-reset is used.",
      ].join(" "),
    );
  }
}

function writeReport(report: Record<string, unknown>) {
  fs.writeFileSync(path.join(cloudflareDir(backupDir), "d1-import-run.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}

function writeImporterConfig() {
  const config = {
    name: importerName,
    main: path.resolve(process.cwd(), "scripts/cloudflare/d1-import-worker.ts"),
    compatibility_date: "2026-06-24",
    account_id: CLOUDFLARE_ACCOUNT_ID,
    workers_dev: true,
    d1_databases: [
      {
        binding: "DB",
        database_name: D1_DATABASE_NAME,
        database_id: D1_DATABASE_ID,
      },
    ],
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function deployImporter() {
  const output = runWrangler(["deploy", "--config", configPath, "--keep-vars", "--secrets-file", secretFile]);
  const url = output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
  if (!url) throw new Error(`Could not find workers.dev URL in deploy output:\n${output}`);
  console.log(JSON.stringify({ event: "importer_deployed", url }));
  return url;
}

async function waitForImporter(url: string) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ statements: [{ sql: "select 1 as ok" }] }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (response?.ok) {
      console.log(JSON.stringify({ event: "importer_ready" }));
      return;
    }
    if (response?.status === 401 || response?.status === 403) {
      const text = await response.text();
      throw new Error(`D1 importer rejected migration secret: ${text.slice(0, 500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error("Timed out waiting for D1 importer worker");
}

async function postStatements(statements: Array<{ sql: string; params?: unknown[] }>) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch(importerUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ statements }),
    });
    const text = await response.text();
    const evaluation = evaluateImporterResponse({ responseOk: response.ok, status: response.status, text });

    if (evaluation.ok) return;

    if (attempt === 8 || !evaluation.retryable) {
      throw new Error(`D1 importer failed (${response.status}): ${evaluation.errorExcerpt}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
}

async function insertSqlForTable(table: TableName) {
  for await (const row of readNdjson(transformedTablePath(backupDir, table))) {
    const columns = Object.keys(row);
    const columnSql = columns.map(quoteIdent).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    return `insert into ${quoteIdent(table)} (${columnSql}) values (${placeholders})`;
  }
  return `select 1`;
}

async function importTimestampPrecisionRows() {
  const artifact = await hashTimestampPrecisionArtifact();
  const insertSql = await insertSqlForTimestampPrecision();
  let batch: Array<{ sql: string; params: unknown[] }> = [];
  let batchBytes = 0;
  let rows = 0;

  for await (const row of readNdjson(timestampPrecisionPath(backupDir))) {
    const params = Object.values(row as TimestampPrecisionRow);
    const statement = { sql: insertSql, params };
    const statementBytes = Buffer.byteLength(JSON.stringify(statement), "utf8");
    if (batch.length && (batch.length >= 50 || batchBytes + statementBytes > 3_000_000)) {
      await postStatements(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(statement);
    batchBytes += statementBytes;
    rows += 1;
  }

  if (batch.length) await postStatements(batch);
  if (rows !== artifact.rows) {
    throw new Error(`Timestamp precision import count mismatch: expected ${artifact.rows}, imported ${rows}`);
  }
  console.log(JSON.stringify({ table: TIMESTAMP_PRECISION_TABLE, imported: rows, expected: artifact.rows }));
  return {
    table: TIMESTAMP_PRECISION_TABLE,
    rows,
    sha256: artifact.sha256,
    file: path.relative(backupDir, timestampPrecisionPath(backupDir)),
  };
}

async function insertSqlForTimestampPrecision() {
  for await (const row of readNdjson(timestampPrecisionPath(backupDir))) {
    const columns = Object.keys(row);
    const columnSql = columns.map(quoteIdent).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    return `insert or replace into ${quoteIdent(TIMESTAMP_PRECISION_TABLE)} (${columnSql}) values (${placeholders})`;
  }
  return `select 1`;
}

async function hashTimestampPrecisionArtifact() {
  const hash = createHash();
  let rows = 0;
  for await (const row of readNdjson(timestampPrecisionPath(backupDir))) {
    hash.update(`${stableStringify(row)}\n`);
    rows += 1;
  }
  return { rows, sha256: hash.digest("hex") };
}
