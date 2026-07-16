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
  "d1-runtime-migrations-0013-0016-verification" as const;
export const RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH =
  "cloudflare/d1-runtime-migrations-0013-0016-report.json" as const;
export const RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY =
  "runtime-migration-0016-complete" as const;
export const RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE =
  "summary-suppression-mask-backfill-v1" as const;
export const RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT =
  5_000 as const;
const RUNTIME_MIGRATION_VERIFICATION_MAX_AUTOMATIC_ATTEMPTS =
  3 as const;
export const RUNTIME_MIGRATION_VERIFICATION_BILLABLE_ROWS_READ_LIMIT =
  RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT *
  RUNTIME_MIGRATION_VERIFICATION_MAX_AUTOMATIC_ATTEMPTS;
export const RUNTIME_MIGRATION_FILES = [
  "drizzle-d1/0013_runtime_query_indexes.sql",
  "drizzle-d1/0014_admin_totals_snapshot.sql",
  "drizzle-d1/0015_atomic_activity_completion.sql",
  "drizzle-d1/0016_memory_vector_cleanup_outbox.sql",
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
  "0016-memory-summary-suppression-mask-column",
  "0016-memory-vector-cleanup-outbox-columns",
  "0016-memory-vector-cleanup-outbox-checks",
  "0016-memory-vector-cleanup-outbox-due-index",
  "0016-completion-marker",
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
  totalAttempts: 1 | null;
  checks: RuntimeMigrationVerificationCheck[];
  error?: string;
};

type D1VerificationQueryResult = {
  rows: Array<Record<string, unknown>>;
  rowsRead: number;
  rowsWritten: number;
  totalAttempts: 1;
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

type ColumnSpec = {
  name: string;
  type: "integer" | "text";
  notNull: 0 | 1;
  defaultValue: string | null;
  primaryKey: 0 | 1;
};

const outboxColumnSpecs: readonly ColumnSpec[] = [
  { name: "vector_id", type: "text", notNull: 1, defaultValue: null, primaryKey: 1 },
  { name: "owner_user_id", type: "text", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "source_namespace", type: "text", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "source_row_id", type: "text", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "source_row_revision", type: "integer", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "write_token", type: "text", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "reason", type: "text", notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: "state", type: "text", notNull: 1, defaultValue: "'cleanup_ready'", primaryKey: 0 },
  { name: "write_fence_expires_at", type: "integer", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "absence_count", type: "integer", notNull: 1, defaultValue: "0", primaryKey: 0 },
  { name: "attempt_count", type: "integer", notNull: 1, defaultValue: "0", primaryKey: 0 },
  { name: "lease_token", type: "text", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "lease_until", type: "integer", notNull: 1, defaultValue: "0", primaryKey: 0 },
  { name: "next_attempt_at", type: "integer", notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: "last_attempt_at", type: "integer", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "last_error", type: "text", notNull: 0, defaultValue: null, primaryKey: 0 },
  { name: "created_at", type: "integer", notNull: 1, defaultValue: null, primaryKey: 0 },
  { name: "updated_at", type: "integer", notNull: 1, defaultValue: null, primaryKey: 0 },
] as const;

const expectedOutboxTableSql = `
CREATE TABLE memory_vector_cleanup_outbox (
  vector_id text PRIMARY KEY NOT NULL
    CHECK (
      length(vector_id) BETWEEN 1 AND 64
      AND vector_id NOT GLOB '*[^A-Za-z0-9:._-]*'
    ),
  owner_user_id text
    CHECK (owner_user_id IS NULL OR length(owner_user_id) BETWEEN 1 AND 120),
  source_namespace text
    CHECK (source_namespace IS NULL OR source_namespace IN ('user_memories', 'chat_memory_turns')),
  source_row_id text
    CHECK (source_row_id IS NULL OR length(source_row_id) BETWEEN 1 AND 120),
  source_row_revision integer
    CHECK (source_row_revision IS NULL OR source_row_revision BETWEEN 1 AND 9007199254740991),
  write_token text
    CHECK (write_token IS NULL OR length(write_token) BETWEEN 1 AND 120),
  reason text NOT NULL
    CHECK (length(reason) BETWEEN 1 AND 80),
  state text DEFAULT 'cleanup_ready' NOT NULL
    CHECK (state IN ('write_pending', 'cleanup_fenced', 'cleanup_ready', 'verifying_absence')),
  write_fence_expires_at integer
    CHECK (write_fence_expires_at IS NULL OR write_fence_expires_at >= 0),
  absence_count integer DEFAULT 0 NOT NULL
    CHECK (absence_count >= 0 AND absence_count <= 2),
  attempt_count integer DEFAULT 0 NOT NULL
    CHECK (attempt_count >= 0),
  lease_token text
    CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 120),
  lease_until integer DEFAULT 0 NOT NULL CHECK (lease_until >= 0),
  next_attempt_at integer NOT NULL CHECK (next_attempt_at >= 0),
  last_attempt_at integer
    CHECK (last_attempt_at IS NULL OR last_attempt_at >= 0),
  last_error text
    CHECK (last_error IS NULL OR length(last_error) <= 160),
  created_at integer NOT NULL CHECK (created_at >= 0),
  updated_at integer NOT NULL CHECK (updated_at >= 0)
)
`;

const expectedOutboxDueIndexSql =
  "CREATE INDEX memory_vector_cleanup_outbox_due_idx ON memory_vector_cleanup_outbox (next_attempt_at, created_at, vector_id)";

export const RUNTIME_MIGRATION_VERIFICATION_SQL_STATEMENTS = Object.freeze([
  `
SELECT
  'activity-column' AS kind,
  column_info.name AS name,
  'activity_runs' AS table_name,
  column_info.type AS column_type,
  column_info."notnull" AS column_not_null,
  column_info.dflt_value AS column_default,
  column_info.pk AS column_primary_key
FROM pragma_table_info('activity_runs') AS column_info
WHERE column_info.name IN ('completion_token', 'completion_message_id')
ORDER BY column_info.name
`.trim(),
  ...indexSpecs.map((spec) => runtimeMigrationIndexVerificationSql(spec)),
  runtimeMigrationIndexVerificationSql({
    name: "memory_vector_cleanup_outbox_due_idx",
    tableName: "memory_vector_cleanup_outbox",
  }),
  `
SELECT
  'admin-snapshot' AS kind,
  metadata."key" AS name,
  'app_metadata' AS table_name,
  json_valid(metadata.value) AS snapshot_json_valid,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.users') ELSE NULL END AS snapshot_users_type,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.users') ELSE NULL END AS snapshot_users,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.chats') ELSE NULL END AS snapshot_chats_type,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.chats') ELSE NULL END AS snapshot_chats,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.messages') ELSE NULL END AS snapshot_messages_type,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.messages') ELSE NULL END AS snapshot_messages,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_type(metadata.value, '$.aiRuns') ELSE NULL END AS snapshot_ai_runs_type,
  CASE WHEN json_valid(metadata.value) = 1 THEN json_extract(metadata.value, '$.aiRuns') ELSE NULL END AS snapshot_ai_runs,
  metadata.updated_at AS snapshot_updated_at
FROM app_metadata AS metadata
WHERE metadata."key" = 'native-admin-totals-v1'
`.trim(),
  `
SELECT
  'migration-marker' AS kind,
  metadata."key" AS name,
  'app_metadata' AS table_name,
  metadata.updated_at AS snapshot_updated_at,
  metadata.value AS table_sql
FROM app_metadata AS metadata
WHERE metadata."key" = '${RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY}'
`.trim(),
  `
SELECT
  'memory-settings-column' AS kind,
  column_info.name AS name,
  'user_memory_settings' AS table_name,
  column_info.type AS column_type,
  column_info."notnull" AS column_not_null,
  column_info.dflt_value AS column_default,
  column_info.pk AS column_primary_key,
  (
    SELECT settings_schema.sql
    FROM sqlite_master AS settings_schema
    WHERE settings_schema.type = 'table'
      AND settings_schema.name = 'user_memory_settings'
  ) AS table_sql
FROM pragma_table_info('user_memory_settings') AS column_info
WHERE column_info.name = 'summary_suppression_mask'
`.trim(),
  `
SELECT
  'outbox-column' AS kind,
  column_info.name AS name,
  'memory_vector_cleanup_outbox' AS table_name,
  column_info.type AS column_type,
  column_info."notnull" AS column_not_null,
  column_info.dflt_value AS column_default,
  column_info.pk AS column_primary_key
FROM pragma_table_info('memory_vector_cleanup_outbox') AS column_info
ORDER BY column_info.cid
`.trim(),
  `
SELECT
  'outbox-table' AS kind,
  schema_table.name AS name,
  schema_table.tbl_name AS table_name,
  schema_table.sql AS table_sql,
  (
    SELECT count(*)
    FROM pragma_index_list('memory_vector_cleanup_outbox') AS outbox_index
    WHERE outbox_index.origin = 'c'
  ) AS custom_index_count
FROM sqlite_master AS schema_table
WHERE schema_table.type = 'table'
  AND schema_table.name = 'memory_vector_cleanup_outbox'
`.trim(),
]);

export const RUNTIME_MIGRATION_VERIFICATION_SQL =
  RUNTIME_MIGRATION_VERIFICATION_SQL_STATEMENTS.join(";\n");

function runtimeMigrationIndexVerificationSql(
  spec: Readonly<Pick<IndexSpec, "name" | "tableName">>,
) {
  return `
SELECT
  'index' AS kind,
  schema_index.name AS name,
  schema_index.tbl_name AS table_name,
  schema_index.sql AS index_sql,
  catalog."unique" AS index_unique,
  catalog.origin AS index_origin,
  catalog.partial AS index_partial,
  index_columns.seqno AS index_seqno,
  index_columns.name AS index_column
FROM sqlite_master AS schema_index
JOIN pragma_index_list('${spec.tableName}') AS catalog
  ON catalog.name = schema_index.name
JOIN pragma_index_info('${spec.name}') AS index_columns
WHERE schema_index.type = 'index'
  AND schema_index.name = '${spec.name}'
  AND schema_index.tbl_name = '${spec.tableName}'
ORDER BY index_columns.seqno
`.trim();
}

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
    totalAttempts: queryResult.totalAttempts,
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
    verifyMemorySuppressionMaskColumn(rows),
    verifyOutboxColumns(rows),
    verifyOutboxChecks(rows),
    verifyOutboxDueIndex(rows),
    verifyMigration0016CompletionMarker(rows),
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
    totalAttempts: null,
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

function verifyMemorySuppressionMaskColumn(
  rows: Array<Record<string, unknown>>,
): RuntimeMigrationVerificationCheck {
  const matches = rows.filter(
    (row) =>
      row.kind === "memory-settings-column" &&
      row.name === "summary_suppression_mask",
  );
  const row = matches[0];
  const normalizedTableSql =
    typeof row?.table_sql === "string" ? normalizeSchemaSql(row.table_sql) : null;
  const normalizedConstraintSql = normalizeSchemaSql(`
    CONSTRAINT user_memory_settings_summary_suppression_mask_check
    CHECK (summary_suppression_mask BETWEEN 0 AND 511)
  `);
  const constraintMatches = normalizedTableSql === null
    ? 0
    : normalizedTableSql.split(normalizedConstraintSql).length - 1;
  const ok =
    matches.length === 1 &&
    row?.table_name === "user_memory_settings" &&
    typeof row.column_type === "string" &&
    row.column_type.toLowerCase() === "integer" &&
    row.column_not_null === 1 &&
    row.column_default === "0" &&
    row.column_primary_key === 0 &&
    constraintMatches === 1;
  return {
    id: "0016-memory-summary-suppression-mask-column",
    ok,
    detail: {
      rows: matches.length,
      table: row?.table_name ?? null,
      type: row?.column_type ?? null,
      notNull: row?.column_not_null ?? null,
      defaultValue: row?.column_default ?? null,
      primaryKey: row?.column_primary_key ?? null,
      exactNamedCheck: constraintMatches === 1,
    },
  };
}

function verifyOutboxColumns(
  rows: Array<Record<string, unknown>>,
): RuntimeMigrationVerificationCheck {
  const matches = rows.filter(
    (row) => row.kind === "outbox-column" &&
      row.table_name === "memory_vector_cleanup_outbox",
  );
  const columnResults = outboxColumnSpecs.map((spec) => {
    const columnMatches = matches.filter((row) => row.name === spec.name);
    const row = columnMatches[0];
    return {
      name: spec.name,
      ok:
        columnMatches.length === 1 &&
        typeof row?.column_type === "string" &&
        row.column_type.toLowerCase() === spec.type &&
        row.column_not_null === spec.notNull &&
        row.column_default === spec.defaultValue &&
        row.column_primary_key === spec.primaryKey,
    };
  });
  const ok =
    matches.length === outboxColumnSpecs.length &&
    columnResults.every((column) => column.ok);
  return {
    id: "0016-memory-vector-cleanup-outbox-columns",
    ok,
    detail: {
      rows: matches.length,
      expectedRows: outboxColumnSpecs.length,
      mismatchedColumns: columnResults.filter((column) => !column.ok).map((column) => column.name),
    },
  };
}

function verifyOutboxChecks(
  rows: Array<Record<string, unknown>>,
): RuntimeMigrationVerificationCheck {
  const matches = rows.filter(
    (row) => row.kind === "outbox-table" &&
      row.name === "memory_vector_cleanup_outbox",
  );
  const row = matches[0];
  const actualSql = typeof row?.table_sql === "string" ? normalizeSchemaSql(row.table_sql) : null;
  const expectedSql = normalizeSchemaSql(expectedOutboxTableSql);
  const ok =
    matches.length === 1 &&
    row?.table_name === "memory_vector_cleanup_outbox" &&
    actualSql === expectedSql;
  return {
    id: "0016-memory-vector-cleanup-outbox-checks",
    ok,
    detail: {
      rows: matches.length,
      table: row?.table_name ?? null,
      exactTableSql: actualSql === expectedSql,
    },
  };
}

function verifyOutboxDueIndex(
  rows: Array<Record<string, unknown>>,
): RuntimeMigrationVerificationCheck {
  const matches = rows
    .filter(
      (row) => row.kind === "index" &&
        row.name === "memory_vector_cleanup_outbox_due_idx",
    )
    .sort((left, right) => Number(left.index_seqno) - Number(right.index_seqno));
  const expectedColumns = ["next_attempt_at", "created_at", "vector_id"] as const;
  const tableRows = rows.filter(
    (row) => row.kind === "outbox-table" &&
      row.name === "memory_vector_cleanup_outbox",
  );
  const actualSql = typeof matches[0]?.index_sql === "string"
    ? normalizeSchemaSql(matches[0].index_sql)
    : null;
  const expectedSql = normalizeSchemaSql(expectedOutboxDueIndexSql);
  const ok =
    matches.length === expectedColumns.length &&
    matches.every(
      (row, index) =>
        row.table_name === "memory_vector_cleanup_outbox" &&
        row.index_unique === 0 &&
        row.index_origin === "c" &&
        row.index_partial === 0 &&
        row.index_seqno === index &&
        row.index_column === expectedColumns[index] &&
        typeof row.index_sql === "string" &&
        normalizeSchemaSql(row.index_sql) === expectedSql,
    ) &&
    tableRows.length === 1 &&
    tableRows[0]?.custom_index_count === 1 &&
    actualSql === expectedSql;
  return {
    id: "0016-memory-vector-cleanup-outbox-due-index",
    ok,
    detail: {
      rows: matches.length,
      table: matches[0]?.table_name ?? null,
      columns: matches.map((row) => row.index_column),
      customIndexes: tableRows[0]?.custom_index_count ?? null,
      exactIndexSql: actualSql === expectedSql,
    },
  };
}

function verifyMigration0016CompletionMarker(
  rows: Array<Record<string, unknown>>,
): RuntimeMigrationVerificationCheck {
  const matches = rows.filter(
    (row) =>
      row.kind === "migration-marker" &&
      row.name === RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  );
  const row = matches[0];
  const updatedAtOk =
    isNonNegativeSafeInteger(row?.snapshot_updated_at) &&
    row.snapshot_updated_at > 0;
  const ok =
    matches.length === 1 &&
    row?.table_name === "app_metadata" &&
    row.table_sql === RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE &&
    updatedAtOk;
  return {
    id: "0016-completion-marker",
    ok,
    detail: {
      rows: matches.length,
      table: row?.table_name ?? null,
      valueMatches:
        row?.table_sql === RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
      updatedAtIsPositiveInteger: updatedAtOk,
    },
  };
}

function parseD1VerificationQueryResult(output: string): D1VerificationQueryResult {
  const value = parseWranglerJson(output);
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecord)) {
    throw new Error("D1 runtime migration verification returned an invalid result set.");
  }
  const rows: Array<Record<string, unknown>> = [];
  let rowsRead = 0;
  let rowsWritten = 0;
  for (const [index, result] of value.entries()) {
    if (!Array.isArray(result.results) || !result.results.every(isRecord)) {
      throw new Error("D1 runtime migration verification returned invalid rows.");
    }
    if (!isRecord(result.meta)) {
      throw new Error("D1 runtime migration verification omitted query metadata.");
    }
    const resultRowsRead = requiredNonNegativeInteger(
      result.meta.rows_read,
      `verification result set ${index + 1} rows read`,
    );
    const resultRowsWritten = requiredNonNegativeInteger(
      result.meta.rows_written,
      `verification result set ${index + 1} rows written`,
    );
    const totalAttempts = requiredNonNegativeInteger(
      result.meta.total_attempts,
      `verification total attempts for result set ${index + 1}`,
    );
    rowsRead += resultRowsRead;
    rowsWritten += resultRowsWritten;
    if (rowsWritten !== 0) {
      throw new Error("Read-only D1 runtime migration verification unexpectedly wrote rows.");
    }
    if (rowsRead > RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT) {
      throw new Error(
        `Read-only D1 runtime migration verification exceeded its logical read bound: ${rowsRead} > ${RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT}.`,
      );
    }
    if (totalAttempts !== 1) {
      throw new Error(
        "Read-only D1 runtime migration verification must complete in exactly one automatic attempt.",
      );
    }
    rows.push(...result.results);
  }
  return { rows, rowsRead, rowsWritten, totalAttempts: 1 };
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
  return normalizeSchemaSql(sql);
}

function normalizeSchemaSql(sql: string): string {
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
