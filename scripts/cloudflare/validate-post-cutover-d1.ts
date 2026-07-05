import fs from "node:fs";
import path from "node:path";
import {
  D1_DATABASE_NAME,
  POST_CUTOVER_MUTABLE_TABLES,
  POST_CUTOVER_TRANSIENT_TABLES,
  PRIMARY_KEY_ORDER,
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

const postCutoverMutableTables = new Set<TableName>(POST_CUTOVER_MUTABLE_TABLES);
const postCutoverTransientTables = new Set<TableName>(POST_CUTOVER_TRANSIENT_TABLES);

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
  allowedPostCutoverMutableTables: [...POST_CUTOVER_MUTABLE_TABLES],
  allowedPostCutoverTransientTables: [...POST_CUTOVER_TRANSIENT_TABLES],
  quickCheck: runQuery("pragma quick_check") as Array<{ quick_check?: string }>,
  foreignKeyCheck: runQuery("pragma foreign_key_check"),
  tables: [] as Array<{
    table: TableName;
    expectedRows: number;
    actualRows: number;
    expectedSha256: string;
    actualSha256: string | null;
    mutableAfterCutover: boolean;
    transientAfterCutover: boolean;
    mutableImportedRows?: {
      checkedRows: number;
      mismatchedRows: number;
      missingRows: number;
      expectedSha256: string;
      actualSha256: string;
      expectedPrimaryKeySha256?: string;
      actualImportedPrimaryKeySha256?: string;
      extraRows?: number;
      ok: boolean;
    };
    ok: boolean;
  }>,
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  for (const table of TABLE_ORDER) {
    const expected = manifest.get(table);
    if (!expected) throw new Error(`Missing manifest entry for ${table}`);
    const countResult = runQuery(`select count(*) as count from ${quoteIdent(table)}`) as Array<{ count?: number }>;
    const actualRows = Number(countResult[0]?.count ?? 0);
    const mutableAfterCutover = postCutoverMutableTables.has(table);
    const transientAfterCutover = postCutoverTransientTables.has(table);
    const actualSha256 = mutableAfterCutover ? null : await hashRemoteTable(table, actualRows);
    const mutableImportedRows = mutableAfterCutover ? await validateMutableImportedRows(table) : undefined;
    const ok = transientAfterCutover
      ? actualRows >= 0
      : mutableAfterCutover
        ? actualRows >= expected.rows && mutableImportedRows?.ok === true
      : expected.rows === actualRows && expected.sha256 === actualSha256;

    report.tables.push({
      table,
      expectedRows: expected.rows,
      actualRows,
      expectedSha256: expected.sha256,
      actualSha256,
      mutableAfterCutover,
      transientAfterCutover,
      mutableImportedRows,
      ok,
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

  const finalReport = {
    ...report,
    startedAt,
    completedAt: new Date().toISOString(),
    artifactFingerprint,
    exactTableCount: report.tables.filter((table) => !table.mutableAfterCutover).length,
    mutableTableCount: report.tables.filter((table) => table.mutableAfterCutover).length,
    transformedSourceHashCheck: expectedSourceHashes,
    mismatchedSourceHashes,
    timestampPrecision,
    ok,
  };

  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), "d1-post-cutover-validation-report.json"),
    `${JSON.stringify(finalReport, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(finalReport, null, 2));
  if (!ok) process.exitCode = 1;
}

async function hashRemoteTable(table: TableName, actualRows: number) {
  const hash = createHash();
  const pageSize = table === "app_translations" ? 500 : 1000;
  for (let offset = 0; offset < actualRows; offset += pageSize) {
    const rows = runQuery(
      `select * from ${quoteIdent(table)} order by ${orderByClause(table)} limit ${pageSize} offset ${offset}`,
    ) as D1Row[];
    for (const row of rows) hash.update(`${stableStringify(row)}\n`);
  }
  return hash.digest("hex");
}

async function validateMutableImportedRows(table: TableName) {
  const primaryKeys = PRIMARY_KEY_ORDER[table];
  if (!primaryKeys?.length) throw new Error(`Missing primary key order for mutable table ${table}`);
  const expectedKeys = new Set<string>();

  for await (const expectedRow of readNdjson(transformedTablePath(backupDir, table))) {
    expectedKeys.add(primaryKeyFingerprint(primaryKeys, expectedRow as Record<string, unknown>));
  }

  const actualKeys = new Set<string>();
  const pageSize = 5000;
  const countResult = runQuery(`select count(*) as count from ${quoteIdent(table)}`) as Array<{ count?: number }>;
  const actualRows = Number(countResult[0]?.count ?? 0);
  const selectKeys = primaryKeys.map(quoteIdent).join(", ");
  for (let offset = 0; offset < actualRows; offset += pageSize) {
    const rows = runQuery(
      `select ${selectKeys} from ${quoteIdent(table)} order by ${orderByClause(table)} limit ${pageSize} offset ${offset}`,
    ) as D1Row[];
    for (const row of rows) actualKeys.add(primaryKeyFingerprint(primaryKeys, row));
  }

  const expectedImportedKeys = [...expectedKeys].sort();
  const actualImportedKeyList = expectedImportedKeys.filter((key) => actualKeys.has(key));
  const missingRows = expectedImportedKeys.length - actualImportedKeyList.length;
  const expectedSha256 = hashLines(expectedImportedKeys);
  const actualSha256 = hashLines(actualImportedKeyList);
  return {
    checkedRows: expectedImportedKeys.length,
    mismatchedRows: 0,
    missingRows,
    expectedSha256,
    actualSha256,
    expectedPrimaryKeySha256: expectedSha256,
    actualImportedPrimaryKeySha256: actualSha256,
    extraRows: Math.max(0, actualRows - actualImportedKeyList.length),
    ok: missingRows === 0 && expectedSha256 === actualSha256,
  };
}

function primaryKeyValueMap(primaryKeys: string[], row: Record<string, unknown>) {
  return Object.fromEntries(primaryKeys.map((key) => [key, row[key] ?? null]));
}

function primaryKeyFingerprint(primaryKeys: string[], row: Record<string, unknown>) {
  return stableStringify(primaryKeyValueMap(primaryKeys, row));
}

function hashLines(lines: string[]) {
  const hash = createHash();
  for (const line of lines) hash.update(`${line}\n`);
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

async function validateTimestampPrecision() {
  const expected = await hashTimestampPrecisionArtifact();
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
