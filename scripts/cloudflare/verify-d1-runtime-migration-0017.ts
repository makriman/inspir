import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RUNTIME_MIGRATION_0017_FILE,
  RUNTIME_MIGRATION_0017_VERIFICATION_LOGICAL_ROWS_READ_LIMIT,
} from "./check-d1-runtime-migration-0017-budget";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
import {
  cloudflareDir,
  D1_DATABASE_NAME,
  resolveBackupDir,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

export const RUNTIME_MIGRATION_0017_INDEX =
  "users_normalized_email_lookup_idx" as const;
export const RUNTIME_MIGRATION_0017_EVIDENCE_KIND =
  "d1-runtime-migration-0017-verification" as const;
export const RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH =
  "cloudflare/d1-runtime-migration-0017-report.json" as const;
export const RUNTIME_MIGRATION_0017_CHECK_ID =
  "0017-users-normalized-email-covering-index" as const;
export const RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG =
  "--expect-absent-deferred-free-plan" as const;
export { RUNTIME_MIGRATION_0017_VERIFICATION_LOGICAL_ROWS_READ_LIMIT };

const maximumVerificationOutputBytes = 1 * 1024 * 1024;
const expectedNormalizedIndexSql =
  "create index users_normalized_email_lookup_idx on users(lower(email),id,email)";

export const RUNTIME_MIGRATION_0017_VERIFICATION_SQL = `
SELECT
  'schema' AS kind,
  name AS index_name,
  tbl_name AS table_name,
  sql AS index_sql,
  NULL AS index_unique,
  NULL AS index_origin,
  NULL AS index_partial,
  NULL AS key_seqno,
  NULL AS key_cid,
  NULL AS key_name,
  NULL AS key_desc,
  NULL AS key_collation,
  NULL AS key_flag
FROM sqlite_master
WHERE type = 'index'
  AND name = '${RUNTIME_MIGRATION_0017_INDEX}'
UNION ALL
SELECT
  'catalog',
  name,
  'users',
  NULL,
  "unique",
  origin,
  partial,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM pragma_index_list('users')
WHERE name = '${RUNTIME_MIGRATION_0017_INDEX}'
UNION ALL
SELECT
  'key',
  '${RUNTIME_MIGRATION_0017_INDEX}',
  'users',
  NULL,
  NULL,
  NULL,
  NULL,
  seqno,
  cid,
  name,
  desc,
  coll,
  key
FROM pragma_index_xinfo('${RUNTIME_MIGRATION_0017_INDEX}')
WHERE key = 1
ORDER BY kind, key_seqno;
`.trim();

export type RuntimeMigration0017State = "absent" | "applied" | "partial";

export type RuntimeMigration0017VerificationCheck = Readonly<{
  id: typeof RUNTIME_MIGRATION_0017_CHECK_ID;
  ok: boolean;
  detail: {
    state: RuntimeMigration0017State;
    schemaRows: number;
    catalogRows: number;
    keyRows: number;
    tableMatches: boolean;
    sqlMatches: boolean;
    catalogMatches: boolean;
    keySequenceMatches: boolean;
  };
}>;

export type RuntimeMigration0017VerificationReport = Readonly<{
  kind: typeof RUNTIME_MIGRATION_0017_EVIDENCE_KIND;
  schemaVersion: 1;
  createdAt: string;
  backupDir: string;
  database: typeof D1_DATABASE_NAME;
  migration: typeof RUNTIME_MIGRATION_0017_FILE;
  ok: boolean;
  state: RuntimeMigration0017State;
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprint: SourceFingerprint;
  sourceFingerprintStable: boolean;
  rowsRead: number;
  rowsWritten: number;
  totalAttempts: 1 | null;
  checks: [RuntimeMigration0017VerificationCheck];
  error?: string;
}>;

type RuntimeMigration0017QueryResult = Readonly<{
  rows: Array<Record<string, unknown>>;
  rowsRead: number;
  rowsWritten: 0;
  totalAttempts: 1;
}>;

export type RuntimeMigration0017CliExpectation =
  | "applied"
  | "absent-deferred-free-plan";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

export function verifyD1RuntimeMigration0017(options: {
  backupDir: string;
  cwd?: string;
  nowMs?: number;
  runner?: WranglerRunner;
}): RuntimeMigration0017VerificationReport {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourceFingerprintBefore = buildRepoSourceFingerprint(cwd);
  const query = loadRuntimeMigration0017VerificationRows(options.runner ?? runWrangler);
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  const sourceFingerprintStable = sameFingerprint(sourceFingerprintBefore, sourceFingerprint);
  const check = evaluateRuntimeMigration0017VerificationRows(query.rows);
  return {
    kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    backupDir: path.resolve(options.backupDir),
    database: D1_DATABASE_NAME,
    migration: RUNTIME_MIGRATION_0017_FILE,
    ok: sourceFingerprintStable && check.ok,
    state: check.detail.state,
    sourceFingerprintBefore,
    sourceFingerprint,
    sourceFingerprintStable,
    rowsRead: query.rowsRead,
    rowsWritten: query.rowsWritten,
    totalAttempts: query.totalAttempts,
    checks: [check],
  };
}

function loadRuntimeMigration0017VerificationRows(
  runner: WranglerRunner = runWrangler,
): RuntimeMigration0017QueryResult {
  const output = runner(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      RUNTIME_MIGRATION_0017_VERIFICATION_SQL,
    ],
    { maxBuffer: maximumVerificationOutputBytes },
  );
  const value = parseJson(output);
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("D1 migration 0017 verification returned an invalid result set.");
  }
  const result = requiredRecord(value[0], "D1 migration 0017 verification result");
  if (!Array.isArray(result.results) || !result.results.every(isRecord)) {
    throw new Error("D1 migration 0017 verification returned invalid rows.");
  }
  const meta = requiredRecord(result.meta, "D1 migration 0017 verification metadata");
  const rowsRead = nonNegativeInteger(meta.rows_read, "0017 verification rows read");
  const rowsWritten = nonNegativeInteger(meta.rows_written, "0017 verification rows written");
  const totalAttempts = nonNegativeInteger(meta.total_attempts, "0017 verification attempts");
  if (rowsRead > RUNTIME_MIGRATION_0017_VERIFICATION_LOGICAL_ROWS_READ_LIMIT) {
    throw new Error("D1 migration 0017 verification exceeded its logical read bound.");
  }
  if (rowsWritten !== 0 || totalAttempts !== 1) {
    throw new Error("D1 migration 0017 verification must be read-only in exactly one attempt.");
  }
  return {
    rows: result.results,
    rowsRead,
    rowsWritten: 0,
    totalAttempts: 1,
  };
}

export function evaluateRuntimeMigration0017VerificationRows(
  rows: Array<Record<string, unknown>>,
): RuntimeMigration0017VerificationCheck {
  const schemaRows = rows.filter((row) => row.kind === "schema");
  const catalogRows = rows.filter((row) => row.kind === "catalog");
  const keyRows = rows.filter((row) => row.kind === "key");
  const schema = schemaRows[0];
  const catalog = catalogRows[0];
  const tableMatches =
    schemaRows.length === 1 &&
    schema?.index_name === RUNTIME_MIGRATION_0017_INDEX &&
    schema.table_name === "users";
  const sqlMatches =
    typeof schema?.index_sql === "string" &&
    normalizeIndexSql(schema.index_sql) === expectedNormalizedIndexSql;
  const catalogMatches =
    catalogRows.length === 1 &&
    catalog?.index_name === RUNTIME_MIGRATION_0017_INDEX &&
    catalog.table_name === "users" &&
    catalog.index_unique === 0 &&
    catalog.index_origin === "c" &&
    catalog.index_partial === 0;
  const keySequenceMatches =
    keyRows.length === 3 &&
    exactKeyRow(keyRows[0], { seqno: 0, cid: -2, name: null }) &&
    exactKeyRow(keyRows[1], { seqno: 1, name: "id" }) &&
    exactKeyRow(keyRows[2], { seqno: 2, name: "email" });
  const noRows = schemaRows.length === 0 && catalogRows.length === 0 && keyRows.length === 0;
  const ok = tableMatches && sqlMatches && catalogMatches && keySequenceMatches;
  const state: RuntimeMigration0017State = ok ? "applied" : noRows ? "absent" : "partial";
  return {
    id: RUNTIME_MIGRATION_0017_CHECK_ID,
    ok,
    detail: {
      state,
      schemaRows: schemaRows.length,
      catalogRows: catalogRows.length,
      keyRows: keyRows.length,
      tableMatches,
      sqlMatches,
      catalogMatches,
      keySequenceMatches,
    },
  };
}

export function writeRuntimeMigration0017VerificationReport(
  report: RuntimeMigration0017VerificationReport,
) {
  const outputPath = runtimeMigration0017VerificationReportPath(report.backupDir);
  writePrivateJsonDurably(outputPath, report, { replace: fs.existsSync(outputPath) });
  return outputPath;
}

export function runtimeMigration0017VerificationReportPath(backupDir: string) {
  return path.join(
    cloudflareDir(path.resolve(backupDir)),
    path.basename(RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH),
  );
}

function runCli() {
  const expectation = parseRuntimeMigration0017CliExpectation(process.argv.slice(2));
  const backupDir = resolveBackupDir();
  const outputPath = runtimeMigration0017VerificationReportPath(backupDir);
  fs.rmSync(outputPath, { force: true });
  let report: RuntimeMigration0017VerificationReport;
  try {
    report = verifyD1RuntimeMigration0017({ backupDir });
  } catch (error) {
    report = failedReport({
      backupDir,
      cwd: process.cwd(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const reportPath = writeRuntimeMigration0017VerificationReport(report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!runtimeMigration0017ReportMatchesCliExpectation(report, expectation)) {
    process.exitCode = 1;
  }
}

export function parseRuntimeMigration0017CliExpectation(
  args: readonly string[],
): RuntimeMigration0017CliExpectation {
  const remaining = [...args];
  const confirmIndex = remaining.indexOf("--confirm-production");
  if (confirmIndex < 0) {
    throw new Error(
      "The read-only production D1 migration 0017 verifier requires --confirm-production.",
    );
  }
  remaining.splice(confirmIndex, 1);

  let expectation: RuntimeMigration0017CliExpectation = "applied";
  const deferredIndex = remaining.indexOf(RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG);
  if (deferredIndex >= 0) {
    expectation = "absent-deferred-free-plan";
    remaining.splice(deferredIndex, 1);
  }
  if (remaining.includes(RUNTIME_MIGRATION_0017_EXPECT_ABSENT_DEFERRED_FLAG)) {
    throw new Error(
      "The D1 migration 0017 verifier accepts the deferred Free-plan expectation at most once.",
    );
  }
  if (remaining.length > 0) {
    throw new Error(
      "The D1 migration 0017 verifier accepts only --confirm-production and optional --expect-absent-deferred-free-plan.",
    );
  }
  return expectation;
}

export function runtimeMigration0017ReportMatchesCliExpectation(
  report: RuntimeMigration0017VerificationReport,
  expectation: RuntimeMigration0017CliExpectation,
) {
  if (expectation === "applied") {
    return report.ok && report.state === "applied";
  }
  const check = report.checks[0];
  return (
    !report.error &&
    report.sourceFingerprintStable &&
    report.rowsWritten === 0 &&
    report.totalAttempts === 1 &&
    report.state === "absent" &&
    report.ok === false &&
    check.ok === false &&
    check.detail.state === "absent" &&
    check.detail.schemaRows === 0 &&
    check.detail.catalogRows === 0 &&
    check.detail.keyRows === 0
  );
}

function failedReport(input: {
  backupDir: string;
  cwd: string;
  error: string;
}): RuntimeMigration0017VerificationReport {
  const sourceFingerprint = buildRepoSourceFingerprint(input.cwd);
  const check = evaluateRuntimeMigration0017VerificationRows([]);
  return {
    kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    backupDir: path.resolve(input.backupDir),
    database: D1_DATABASE_NAME,
    migration: RUNTIME_MIGRATION_0017_FILE,
    ok: false,
    state: "absent",
    sourceFingerprintBefore: sourceFingerprint,
    sourceFingerprint,
    sourceFingerprintStable: true,
    rowsRead: 0,
    rowsWritten: 0,
    totalAttempts: null,
    checks: [check],
    error: input.error.slice(0, 2_000),
  };
}

function exactKeyRow(
  row: Record<string, unknown> | undefined,
  expected: { seqno: number; cid?: number; name: string | null },
) {
  return (
    row?.index_name === RUNTIME_MIGRATION_0017_INDEX &&
    row.table_name === "users" &&
    row.key_seqno === expected.seqno &&
    (expected.cid === undefined || row.key_cid === expected.cid) &&
    row.key_name === expected.name &&
    row.key_desc === 0 &&
    row.key_collation === "BINARY" &&
    row.key_flag === 1
  );
}

function normalizeIndexSql(sql: string) {
  return sql
    .toLowerCase()
    .replace(/["`\[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

function parseJson(output: string): unknown {
  if (Buffer.byteLength(output, "utf8") > maximumVerificationOutputBytes) {
    throw new Error("D1 migration 0017 verification exceeded its bounded output size.");
  }
  try {
    return JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("D1 migration 0017 verification did not return deterministic JSON.");
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function sameFingerprint(left: SourceFingerprint, right: SourceFingerprint) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}
