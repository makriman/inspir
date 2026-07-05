import fs from "node:fs";
import path from "node:path";
import {
  D1_DATABASE_NAME,
  TABLE_ORDER,
  TIMESTAMP_PRECISION_TABLE,
  cloudflareDir,
  createHash,
  d1ManifestPath,
  orderByClause,
  quoteIdent,
  readNdjson,
  resolveBackupDir,
  runWrangler,
  stableStringify,
  timestampPrecisionOrderByClause,
  timestampPrecisionPath,
  transformedTablePath,
  type D1Row,
  type TableName,
} from "./migration-config";
import { buildD1ArtifactFingerprint } from "./migration-artifact-fingerprint";

type TableManifest = {
  table: TableName;
  rows: number;
  sha256: string;
};

type TimestampPrecisionValidation = {
  table: string;
  expectedRows: number;
  actualRows: number;
  expectedSha256: string;
  actualSha256: string;
  ok: boolean;
  error?: string;
};

const backupDir = resolveBackupDir();
const startedAt = new Date().toISOString();
const artifactFingerprint = buildD1ArtifactFingerprint(backupDir);
const manifest = new Map(
  (JSON.parse(fs.readFileSync(d1ManifestPath(backupDir), "utf8")) as TableManifest[]).map((table) => [table.table, table]),
);

const report = {
  createdAt: new Date().toISOString(),
  backupDir,
  database: D1_DATABASE_NAME,
  quickCheck: runQuery("pragma quick_check") as Array<{ quick_check?: string }>,
  foreignKeyCheck: runQuery("pragma foreign_key_check"),
  tables: [] as Array<{
    table: TableName;
    expectedRows: number;
    actualRows: number;
    expectedSha256: string;
    actualSha256: string;
    ok: boolean;
  }>,
};
let reportWritten = false;

void main().catch((error) => {
  console.error(error);
  writeValidationReport({
    timestampPrecision: null,
    mismatchedSourceHashes: [],
    transformedSourceHashCheck: [],
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

async function main() {
  for (const table of TABLE_ORDER) {
    const expected = manifest.get(table);
    if (!expected) throw new Error(`Missing manifest entry for ${table}`);
    const countResult = runQuery(`select count(*) as count from ${quoteIdent(table)}`) as Array<{ count?: number }>;
    const actualRows = Number(countResult[0]?.count ?? 0);
    const actualSha256 = await hashRemoteTable(table, actualRows);
    report.tables.push({
      table,
      expectedRows: expected.rows,
      actualRows,
      expectedSha256: expected.sha256,
      actualSha256,
      ok: expected.rows === actualRows && expected.sha256 === actualSha256,
    });
    console.log(JSON.stringify(report.tables.at(-1)));
  }

  const expectedSourceHashes = await hashTransformedSources();
  const timestampPrecision = await validateTimestampPrecision();
  const mismatchedSourceHashes = expectedSourceHashes.filter((entry) => entry.expectedSha256 !== entry.sourceSha256);
  const ok =
    report.quickCheck[0]?.quick_check === "ok" &&
    report.foreignKeyCheck.length === 0 &&
    report.tables.every((table) => table.ok) &&
    timestampPrecision.ok &&
    mismatchedSourceHashes.length === 0;

  writeValidationReport({
    timestampPrecision,
    transformedSourceHashCheck: expectedSourceHashes,
    mismatchedSourceHashes,
    ok,
  });
  if (!ok) process.exitCode = 1;
}

async function hashRemoteTable(table: TableName, actualRows: number) {
  const hash = createHash();
  const pageSize = table === "app_translations" ? 100 : 1000;
  for (let offset = 0; offset < actualRows; offset += pageSize) {
    const rows = runQuery(
      `select * from ${quoteIdent(table)} order by ${orderByClause(table)} limit ${pageSize} offset ${offset}`,
    ) as D1Row[];
    for (const row of rows) hash.update(`${stableStringify(row)}\n`);
  }
  return hash.digest("hex");
}

async function hashTransformedSources() {
  const checks = [];
  for (const table of TABLE_ORDER) {
    const expected = manifest.get(table);
    if (!expected) throw new Error(`Missing manifest entry for ${table}`);
    const hash = createHash();
    for await (const row of readNdjson(transformedTablePath(backupDir, table))) {
      hash.update(`${stableStringify(row)}\n`);
    }
    checks.push({ table, expectedSha256: expected.sha256, sourceSha256: hash.digest("hex") });
  }
  return checks;
}

async function validateTimestampPrecision(): Promise<TimestampPrecisionValidation> {
  const expected = await hashTimestampPrecisionArtifact();
  try {
    const countResult = runQuery(`select count(*) as count from ${quoteIdent(TIMESTAMP_PRECISION_TABLE)}`) as Array<{ count?: number }>;
    const actualRows = Number(countResult[0]?.count ?? 0);
    const actualSha256 = await hashRemoteTimestampPrecisionTable(actualRows);
    return {
      table: TIMESTAMP_PRECISION_TABLE,
      expectedRows: expected.rows,
      actualRows,
      expectedSha256: expected.sha256,
      actualSha256,
      ok: expected.rows === actualRows && expected.sha256 === actualSha256,
    };
  } catch (error) {
    return {
      table: TIMESTAMP_PRECISION_TABLE,
      expectedRows: expected.rows,
      actualRows: 0,
      expectedSha256: expected.sha256,
      actualSha256: "",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

async function hashRemoteTimestampPrecisionTable(actualRows: number) {
  const hash = createHash();
  const pageSize = 1000;
  for (let offset = 0; offset < actualRows; offset += pageSize) {
    const rows = runQuery(
      `select * from ${quoteIdent(TIMESTAMP_PRECISION_TABLE)} order by ${timestampPrecisionOrderByClause()} limit ${pageSize} offset ${offset}`,
    ) as D1Row[];
    for (const row of rows) hash.update(`${stableStringify(row)}\n`);
  }
  return hash.digest("hex");
}

function runQuery(sql: string) {
  const output = runWrangler(["d1", "execute", D1_DATABASE_NAME, "--remote", "--json", "--command", sql], {
    maxBuffer: 128 * 1024 * 1024,
  });
  const parsed = JSON.parse(output) as Array<{ results?: unknown[]; success: boolean; error?: string }>;
  const first = parsed[0];
  if (!first?.success) throw new Error(first?.error ?? `D1 query failed: ${sql}`);
  return first.results ?? [];
}

function writeValidationReport(details: {
  timestampPrecision: TimestampPrecisionValidation | null;
  transformedSourceHashCheck: unknown[];
  mismatchedSourceHashes: unknown[];
  ok: boolean;
  error?: string;
}) {
  if (reportWritten) return;
  reportWritten = true;
  const finalReport = {
    ...report,
    startedAt,
    completedAt: new Date().toISOString(),
    artifactFingerprint,
    ...details,
  };

  fs.writeFileSync(path.join(cloudflareDir(backupDir), "d1-validation-report.json"), `${JSON.stringify(finalReport, null, 2)}\n`);
  console.log(JSON.stringify(finalReport, null, 2));
}
