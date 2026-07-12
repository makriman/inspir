import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  cloudflareDir,
  D1_DATABASE_NAME,
  hasFlag,
  resolveBackupDir,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

export const RUNTIME_MIGRATION_EVIDENCE_KIND =
  "d1-runtime-migrations-0013-0015-verification" as const;
export const RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH =
  "cloudflare/d1-runtime-migrations-0013-0015-report.json" as const;
export const RUNTIME_MIGRATION_FILES = [
  "drizzle-d1/0013_runtime_query_indexes.sql",
  "drizzle-d1/0014_admin_totals_snapshot.sql",
  "drizzle-d1/0015_atomic_activity_completion.sql",
] as const;
export const RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS = [
  "0013-rate-limit-windows-index",
  "0013-ai-runs-index",
  "0013-ops-events-user-index",
  "0014-admin-totals-snapshot",
  "0015-completion-token-column",
  "0015-completion-message-id-column",
  "0015-completion-token-unique-partial-index",
  "0015-completion-message-id-unique-partial-index",
] as const;

type RuntimeMigrationVerificationCheckId =
  (typeof RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS)[number];

export type RuntimeMigrationVerificationCheck = {
  id: RuntimeMigrationVerificationCheckId;
  ok: boolean;
  detail: Record<string, unknown>;
};

export type RuntimeMigrationVerificationReport = {
  kind: typeof RUNTIME_MIGRATION_EVIDENCE_KIND;
  createdAt: string;
  backupDir: string;
  database: typeof D1_DATABASE_NAME;
  migrations: [...typeof RUNTIME_MIGRATION_FILES];
  ok: boolean;
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprint: SourceFingerprint;
  sourceFingerprintStable: boolean;
  rowsRead: number;
  rowsWritten: number;
  checks: RuntimeMigrationVerificationCheck[];
  error?: string;
};

type D1VerificationQueryResult = {
  rows: Array<Record<string, unknown>>;
  rowsRead: number;
  rowsWritten: number;
};

type IndexSpec = {
  id: RuntimeMigrationVerificationCheckId;
  name: string;
  tableName: string;
  columnName: string;
  unique: 0 | 1;
  partial: 0 | 1;
};

const indexSpecs: readonly IndexSpec[] = [
  {
    id: "0013-rate-limit-windows-index",
    name: "rate_limit_windows_reset_at_idx",
    tableName: "rate_limit_windows",
    columnName: "reset_at",
    unique: 0,
    partial: 0,
  },
  {
    id: "0013-ai-runs-index",
    name: "ai_runs_created_idx",
    tableName: "ai_runs",
    columnName: "created_at",
    unique: 0,
    partial: 0,
  },
  {
    id: "0013-ops-events-user-index",
    name: "ops_events_user_id_idx",
    tableName: "ops_events",
    columnName: "user_id",
    unique: 0,
    partial: 0,
  },
  {
    id: "0015-completion-token-unique-partial-index",
    name: "activity_runs_completion_token_uidx",
    tableName: "activity_runs",
    columnName: "completion_token",
    unique: 1,
    partial: 1,
  },
  {
    id: "0015-completion-message-id-unique-partial-index",
    name: "activity_runs_completion_message_id_uidx",
    tableName: "activity_runs",
    columnName: "completion_message_id",
    unique: 1,
    partial: 1,
  },
];

export const RUNTIME_MIGRATION_VERIFICATION_SQL = `
WITH index_catalog AS (
  SELECT 'activity_runs' AS table_name, name, "unique" AS index_unique, origin AS index_origin, partial AS index_partial
  FROM pragma_index_list('activity_runs')
  UNION ALL
  SELECT 'rate_limit_windows', name, "unique", origin, partial
  FROM pragma_index_list('rate_limit_windows')
  UNION ALL
  SELECT 'ai_runs', name, "unique", origin, partial
  FROM pragma_index_list('ai_runs')
  UNION ALL
  SELECT 'ops_events', name, "unique", origin, partial
  FROM pragma_index_list('ops_events')
), index_columns AS (
  SELECT 'activity_runs_completion_token_uidx' AS index_name, seqno AS index_seqno, name AS index_column
  FROM pragma_index_info('activity_runs_completion_token_uidx')
  UNION ALL
  SELECT 'activity_runs_completion_message_id_uidx', seqno, name
  FROM pragma_index_info('activity_runs_completion_message_id_uidx')
  UNION ALL
  SELECT 'rate_limit_windows_reset_at_idx', seqno, name
  FROM pragma_index_info('rate_limit_windows_reset_at_idx')
  UNION ALL
  SELECT 'ai_runs_created_idx', seqno, name
  FROM pragma_index_info('ai_runs_created_idx')
  UNION ALL
  SELECT 'ops_events_user_id_idx', seqno, name
  FROM pragma_index_info('ops_events_user_id_idx')
)
SELECT
  'activity-column' AS kind,
  column_info.name AS name,
  'activity_runs' AS table_name,
  column_info.type AS column_type,
  column_info."notnull" AS column_not_null,
  column_info.dflt_value AS column_default,
  column_info.pk AS column_primary_key,
  NULL AS index_sql,
  NULL AS index_unique,
  NULL AS index_origin,
  NULL AS index_partial,
  NULL AS index_seqno,
  NULL AS index_column,
  NULL AS snapshot_json_valid,
  NULL AS snapshot_users_type,
  NULL AS snapshot_users,
  NULL AS snapshot_chats_type,
  NULL AS snapshot_chats,
  NULL AS snapshot_messages_type,
  NULL AS snapshot_messages,
  NULL AS snapshot_ai_runs_type,
  NULL AS snapshot_ai_runs,
  NULL AS snapshot_updated_at
FROM pragma_table_info('activity_runs') AS column_info
WHERE column_info.name IN ('completion_token', 'completion_message_id')
UNION ALL
SELECT
  'index',
  catalog.name,
  schema_index.tbl_name,
  NULL,
  NULL,
  NULL,
  NULL,
  schema_index.sql,
  catalog.index_unique,
  catalog.index_origin,
  catalog.index_partial,
  index_columns.index_seqno,
  index_columns.index_column,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM sqlite_master AS schema_index
JOIN index_catalog AS catalog
  ON catalog.name = schema_index.name AND catalog.table_name = schema_index.tbl_name
JOIN index_columns ON index_columns.index_name = schema_index.name
WHERE schema_index.type = 'index'
  AND schema_index.name IN (
    'rate_limit_windows_reset_at_idx',
    'ai_runs_created_idx',
    'ops_events_user_id_idx',
    'activity_runs_completion_token_uidx',
    'activity_runs_completion_message_id_uidx'
  )
UNION ALL
SELECT
  'admin-snapshot',
  metadata."key",
  'app_metadata',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  json_valid(metadata.value),
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.users') ELSE NULL END,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.users') ELSE NULL END,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.chats') ELSE NULL END,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.chats') ELSE NULL END,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.messages') ELSE NULL END,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.messages') ELSE NULL END,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.aiRuns') ELSE NULL END,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.aiRuns') ELSE NULL END,
  metadata.updated_at
FROM app_metadata AS metadata
WHERE metadata."key" = 'native-admin-totals-v1'
ORDER BY kind, name, index_seqno;
`.trim();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

export function verifyD1RuntimeMigrations(options: {
  backupDir: string;
  cwd?: string;
  nowMs?: number;
  runner?: WranglerRunner;
}): RuntimeMigrationVerificationReport {
  const cwd = options.cwd ?? process.cwd();
  const sourceFingerprintBefore = buildRepoSourceFingerprint(cwd);
  const queryResult = loadRuntimeMigrationVerificationRows(options.runner ?? runWrangler);
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  const sourceFingerprintStable =
    sourceFingerprintBefore.sha256 === sourceFingerprint.sha256 &&
    sourceFingerprintBefore.fileCount === sourceFingerprint.fileCount;
  const checks = evaluateRuntimeMigrationVerificationRows(queryResult.rows);
  return {
    kind: RUNTIME_MIGRATION_EVIDENCE_KIND,
    createdAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    backupDir: path.resolve(options.backupDir),
    database: D1_DATABASE_NAME,
    migrations: [...RUNTIME_MIGRATION_FILES],
    ok:
      sourceFingerprintStable &&
      queryResult.rowsWritten === 0 &&
      checks.length === RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length &&
      checks.every((check) => check.ok),
    sourceFingerprintBefore,
    sourceFingerprint,
    sourceFingerprintStable,
    rowsRead: queryResult.rowsRead,
    rowsWritten: queryResult.rowsWritten,
    checks,
  };
}

export function loadRuntimeMigrationVerificationRows(
  runner: WranglerRunner = runWrangler,
): D1VerificationQueryResult {
  const output = runner([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    RUNTIME_MIGRATION_VERIFICATION_SQL,
  ]);
  return parseD1VerificationQueryResult(output);
}

export function evaluateRuntimeMigrationVerificationRows(
  rows: Array<Record<string, unknown>>,
): RuntimeMigrationVerificationCheck[] {
  const checks: RuntimeMigrationVerificationCheck[] = [
    verifyColumn(rows, "completion_token", "0015-completion-token-column"),
    verifyColumn(rows, "completion_message_id", "0015-completion-message-id-column"),
    ...indexSpecs.map((spec) => verifyIndex(rows, spec)),
    verifyAdminSnapshot(rows),
  ];
  const byId = new Map(checks.map((check) => [check.id, check]));
  return RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.map(
    (id) =>
      byId.get(id) ?? {
        id,
        ok: false,
        detail: { reason: "Verification implementation omitted a required check." },
      },
  );
}

export function writeRuntimeMigrationVerificationReport(
  report: RuntimeMigrationVerificationReport,
): string {
  const outputPath = runtimeMigrationVerificationReportPath(report.backupDir);
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporaryPath, outputPath);
    fs.chmodSync(outputPath, 0o600);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return outputPath;
}

export function runtimeMigrationVerificationReportPath(backupDir: string): string {
  return path.join(cloudflareDir(path.resolve(backupDir)), path.basename(RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH));
}

function runCli() {
  if (!hasFlag("--confirm-production")) {
    throw new Error(
      "The read-only production D1 runtime migration verifier requires --confirm-production.",
    );
  }
  const backupDir = resolveBackupDir();
  const outputPath = runtimeMigrationVerificationReportPath(backupDir);
  // A killed or failed verification must not leave a prior fresh success that
  // could authorize a deploy of the same source revision.
  fs.rmSync(outputPath, { force: true });

  let report: RuntimeMigrationVerificationReport;
  try {
    report = verifyD1RuntimeMigrations({ backupDir });
  } catch (error) {
    report = failedVerificationReport({
      backupDir,
      cwd: process.cwd(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const reportPath = writeRuntimeMigrationVerificationReport(report);
  console.log(
    JSON.stringify(
      {
        ...report,
        sourceFingerprintBefore: compactFingerprint(report.sourceFingerprintBefore),
        sourceFingerprint: compactFingerprint(report.sourceFingerprint),
        reportPath,
      },
      null,
      2,
    ),
  );
  if (!report.ok) process.exitCode = 1;
}

function failedVerificationReport(input: {
  backupDir: string;
  cwd: string;
  error: string;
}): RuntimeMigrationVerificationReport {
  const sourceFingerprint = buildRepoSourceFingerprint(input.cwd);
  return {
    kind: RUNTIME_MIGRATION_EVIDENCE_KIND,
    createdAt: new Date().toISOString(),
    backupDir: path.resolve(input.backupDir),
    database: D1_DATABASE_NAME,
    migrations: [...RUNTIME_MIGRATION_FILES],
    ok: false,
    sourceFingerprintBefore: sourceFingerprint,
    sourceFingerprint,
    sourceFingerprintStable: true,
    rowsRead: 0,
    rowsWritten: 0,
    checks: RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.map((id) => ({
      id,
      ok: false,
      detail: { reason: "Runtime migration verification did not complete." },
    })),
    error: input.error.slice(0, 2_000),
  };
}

function verifyColumn(
  rows: Array<Record<string, unknown>>,
  name: string,
  id: RuntimeMigrationVerificationCheckId,
): RuntimeMigrationVerificationCheck {
  const matches = rows.filter(
    (row) => row.kind === "activity-column" && row.name === name,
  );
  const row = matches[0];
  const ok =
    matches.length === 1 &&
    row?.table_name === "activity_runs" &&
    typeof row.column_type === "string" &&
    row.column_type.toLowerCase() === "text" &&
    row.column_not_null === 0 &&
    row.column_default === null &&
    row.column_primary_key === 0;
  return {
    id,
    ok,
    detail: {
      rows: matches.length,
      table: row?.table_name ?? null,
      type: row?.column_type ?? null,
      nullable: row ? row.column_not_null === 0 : null,
      defaultValue: row?.column_default ?? null,
      primaryKey: row?.column_primary_key ?? null,
    },
  };
}

function verifyIndex(
  rows: Array<Record<string, unknown>>,
  spec: IndexSpec,
): RuntimeMigrationVerificationCheck {
  const matches = rows.filter((row) => row.kind === "index" && row.name === spec.name);
  const row = matches[0];
  const expectedSql = normalizedExpectedIndexSql(spec);
  const actualSql = typeof row?.index_sql === "string" ? normalizeIndexSql(row.index_sql) : null;
  const ok =
    matches.length === 1 &&
    row?.table_name === spec.tableName &&
    row.index_unique === spec.unique &&
    row.index_origin === "c" &&
    row.index_partial === spec.partial &&
    row.index_seqno === 0 &&
    row.index_column === spec.columnName &&
    actualSql === expectedSql;
  return {
    id: spec.id,
    ok,
    detail: {
      rows: matches.length,
      table: row?.table_name ?? null,
      column: row?.index_column ?? null,
      unique: row?.index_unique ?? null,
      partial: row?.index_partial ?? null,
      origin: row?.index_origin ?? null,
      sqlMatches: actualSql === expectedSql,
    },
  };
}

function verifyAdminSnapshot(
  rows: Array<Record<string, unknown>>,
): RuntimeMigrationVerificationCheck {
  const matches = rows.filter(
    (row) => row.kind === "admin-snapshot" && row.name === "native-admin-totals-v1",
  );
  const row = matches[0];
  const countFields = [
    [row?.snapshot_users_type, row?.snapshot_users],
    [row?.snapshot_chats_type, row?.snapshot_chats],
    [row?.snapshot_messages_type, row?.snapshot_messages],
    [row?.snapshot_ai_runs_type, row?.snapshot_ai_runs],
  ] as const;
  const countsOk = countFields.every(
    ([type, value]) => type === "integer" && isNonNegativeSafeInteger(value),
  );
  const updatedAtOk = isNonNegativeSafeInteger(row?.snapshot_updated_at) && row.snapshot_updated_at > 0;
  const ok =
    matches.length === 1 &&
    row?.table_name === "app_metadata" &&
    row.snapshot_json_valid === 1 &&
    countsOk &&
    updatedAtOk;
  return {
    id: "0014-admin-totals-snapshot",
    ok,
    detail: {
      rows: matches.length,
      jsonValid: row?.snapshot_json_valid ?? null,
      countsAreNonNegativeIntegers: countsOk,
      updatedAtIsPositiveInteger: updatedAtOk,
    },
  };
}

function parseD1VerificationQueryResult(output: string): D1VerificationQueryResult {
  const value = parseWranglerJson(output);
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error("D1 runtime migration verification returned an invalid result set.");
  }
  const result = value[0];
  if (!Array.isArray(result.results) || !result.results.every(isRecord)) {
    throw new Error("D1 runtime migration verification returned invalid rows.");
  }
  if (!isRecord(result.meta)) {
    throw new Error("D1 runtime migration verification omitted query metadata.");
  }
  const rowsRead = requiredNonNegativeInteger(result.meta.rows_read, "verification rows read");
  const rowsWritten = requiredNonNegativeInteger(
    result.meta.rows_written,
    "verification rows written",
  );
  if (rowsWritten !== 0) {
    throw new Error("Read-only D1 runtime migration verification unexpectedly wrote rows.");
  }
  return { rows: result.results, rowsRead, rowsWritten };
}

function parseWranglerJson(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw new Error("Could not parse Wrangler D1 runtime migration verification JSON.");
    }
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
    } catch {
      throw new Error("Could not parse Wrangler D1 runtime migration verification JSON.");
    }
  }
}

function normalizedExpectedIndexSql(spec: IndexSpec): string {
  const unique = spec.unique === 1 ? "unique " : "";
  const predicate = spec.partial === 1 ? ` where ${spec.columnName} is not null` : "";
  return normalizeIndexSql(
    `create ${unique}index ${spec.name} on ${spec.tableName} (${spec.columnName})${predicate}`,
  );
}

function normalizeIndexSql(sql: string): string {
  return sql
    .trim()
    .replace(/;$/, "")
    .replace(/[`\"]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  if (!isNonNegativeSafeInteger(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactFingerprint(fingerprint: SourceFingerprint) {
  return { sha256: fingerprint.sha256, fileCount: fingerprint.fileCount };
}
