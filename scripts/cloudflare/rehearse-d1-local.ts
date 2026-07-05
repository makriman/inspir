import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  TABLE_ORDER,
  TIMESTAMP_PRECISION_TABLE,
  cloudflareDir,
  createHash,
  d1ManifestPath,
  orderByClause,
  quoteIdent,
  readNdjson,
  resolveBackupDir,
  stableStringify,
  timestampPrecisionOrderByClause,
  timestampPrecisionPath,
  transformedTablePath,
  type D1Row,
  type TableName,
  type TimestampPrecisionRow,
} from "./migration-config";

type TableManifest = {
  table: TableName;
  rows: number;
  sha256: string;
};

const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const dbPath = path.join(cfDir, "d1-local-rehearsal.sqlite");
const reportPath = path.join(cfDir, "d1-local-rehearsal-report.json");
const schemaPath = path.resolve(process.cwd(), "drizzle-d1/0000_majestic_invisible_woman.sql");
const manifest = new Map(
  (JSON.parse(fs.readFileSync(d1ManifestPath(backupDir), "utf8")) as TableManifest[]).map((table) => [table.table, table]),
);

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeReport({ ok: false, error: message });
  console.error(message);
  process.exitCode = 1;
});

async function main() {
  if (!fs.existsSync(schemaPath)) throw new Error(`Missing D1 schema file: ${schemaPath}`);
  fs.rmSync(dbPath, { force: true });

  runSql(".bail on\nPRAGMA foreign_keys=ON;\nPRAGMA journal_mode=OFF;\nPRAGMA synchronous=OFF;\n");
  ensurePrivateSqliteFile();
  runSql(fs.readFileSync(schemaPath, "utf8"));
  await importRows();
  ensurePrivateSqliteFile();

  const quickCheck = runJsonQuery<Array<{ quick_check?: string }>>("pragma quick_check");
  const foreignKeyCheck = runJsonQuery<unknown[]>("pragma foreign_key_check");
  const tables = [];
  const timestampPrecision = await validateTimestampPrecision();

  for (const table of TABLE_ORDER) {
    const expected = manifest.get(table);
    if (!expected) throw new Error(`Missing D1 manifest entry for ${table}`);
    const countRows = runJsonQuery<Array<{ count?: number }>>(`select count(*) as count from ${quoteIdent(table)}`);
    const actualRows = Number(countRows[0]?.count ?? 0);
    const actualSha256 = hashLocalTable(table, actualRows);
    tables.push({
      table,
      expectedRows: expected.rows,
      actualRows,
      expectedSha256: expected.sha256,
      actualSha256,
      ok: expected.rows === actualRows && expected.sha256 === actualSha256,
    });
  }

  const ok =
    quickCheck[0]?.quick_check === "ok" &&
    foreignKeyCheck.length === 0 &&
    tables.every((table) => table.ok) &&
    timestampPrecision.ok;
  writeReport({
    ok,
    sqlitePath: dbPath,
    quickCheck,
    foreignKeyCheck,
    tables,
    timestampPrecision,
  });
  if (!ok) process.exitCode = 1;
}

async function importRows() {
  const sqlite = spawn("sqlite3", [dbPath], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  sqlite.stdout.setEncoding("utf8");
  sqlite.stderr.setEncoding("utf8");
  sqlite.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  sqlite.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  sqlite.stdin.write(".bail on\nPRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n");
  for (const table of TABLE_ORDER) {
    let rows = 0;
    for await (const raw of readNdjson(transformedTablePath(backupDir, table))) {
      const row = raw as D1Row;
      const columns = Object.keys(row);
      const values = Object.values(row).map(sqlLiteral).join(", ");
      sqlite.stdin.write(
        `insert into ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) values (${values});\n`,
      );
      rows += 1;
    }
    const expected = manifest.get(table)?.rows;
    if (expected !== rows) throw new Error(`Source row count mismatch for ${table}: expected ${expected}, read ${rows}`);
  }
  for await (const raw of readNdjson(timestampPrecisionPath(backupDir))) {
    const row = raw as TimestampPrecisionRow;
    const columns = Object.keys(row);
    const values = Object.values(row).map(sqlLiteral).join(", ");
    sqlite.stdin.write(
      `insert into ${quoteIdent(TIMESTAMP_PRECISION_TABLE)} (${columns.map(quoteIdent).join(", ")}) values (${values});\n`,
    );
  }
  sqlite.stdin.end("COMMIT;\nPRAGMA foreign_key_check;\n");

  const status = await new Promise<number | null>((resolve) => {
    sqlite.on("close", resolve);
  });
  if (status !== 0) {
    throw new Error(`sqlite3 local D1 rehearsal import failed with status ${status}: ${stderr || stdout}`);
  }
}

async function validateTimestampPrecision() {
  const expected = await hashTimestampPrecisionArtifact();
  const countRows = runJsonQuery<Array<{ count?: number }>>(
    `select count(*) as count from ${quoteIdent(TIMESTAMP_PRECISION_TABLE)}`,
  );
  const actualRows = Number(countRows[0]?.count ?? 0);
  const actualSha256 = hashLocalTimestampPrecisionTable(actualRows);
  return {
    table: TIMESTAMP_PRECISION_TABLE,
    expectedRows: expected.rows,
    actualRows,
    expectedSha256: expected.sha256,
    actualSha256,
    ok: expected.rows === actualRows && expected.sha256 === actualSha256,
  };
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

function hashLocalTimestampPrecisionTable(actualRows: number) {
  const hash = createHash();
  const pageSize = 1000;
  for (let offset = 0; offset < actualRows; offset += pageSize) {
    const rows = runJsonQuery<D1Row[]>(
      `select * from ${quoteIdent(TIMESTAMP_PRECISION_TABLE)} order by ${timestampPrecisionOrderByClause()} limit ${pageSize} offset ${offset}`,
    );
    for (const row of rows) hash.update(`${stableStringify(row)}\n`);
  }
  return hash.digest("hex");
}

function hashLocalTable(table: TableName, actualRows: number) {
  const hash = createHash();
  const pageSize = table === "app_translations" ? 100 : 1000;
  for (let offset = 0; offset < actualRows; offset += pageSize) {
    const rows = runJsonQuery<D1Row[]>(
      `select * from ${quoteIdent(table)} order by ${orderByClause(table)} limit ${pageSize} offset ${offset}`,
    );
    for (const row of rows) hash.update(`${stableStringify(row)}\n`);
  }
  return hash.digest("hex");
}

function runSql(sql: string) {
  const result = spawnSync("sqlite3", [dbPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: sql,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 exited with status ${result.status}`);
  }
}

function runJsonQuery<T>(sql: string): T {
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 query exited with status ${result.status}: ${sql}`);
  }
  return JSON.parse(result.stdout || "[]") as T;
}

function ensurePrivateSqliteFile() {
  if (fs.existsSync(dbPath)) fs.chmodSync(dbPath, 0o600);
}

function sqlLiteral(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for SQLite import: ${value}`);
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function writeReport(extra: Record<string, unknown>) {
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    ...extra,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
