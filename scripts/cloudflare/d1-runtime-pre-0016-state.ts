import path from "node:path";
import {
  D1_DATABASE_NAME,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_VERIFICATION_BILLABLE_ROWS_READ_LIMIT,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
  RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT,
  verifyD1RuntimeMigrations,
  type RuntimeMigrationVerificationReport,
} from "./verify-d1-runtime-migrations";

export const D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ = 32 as const;
export const D1_RUNTIME_FRESH_0016_MARKER_KEY =
  "runtime-migration-0016-fresh-cutover" as const;
const D1_RUNTIME_PRE_0016_STATE_MAX_AUTOMATIC_ATTEMPTS = 3 as const;
const D1_RUNTIME_PRE_0016_STATE_BILLABLE_ROWS_READ =
  D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ *
  D1_RUNTIME_PRE_0016_STATE_MAX_AUTOMATIC_ATTEMPTS;
export const D1_RUNTIME_PRE_0016_VERIFICATION_BILLABLE_ROWS_READ =
  RUNTIME_MIGRATION_VERIFICATION_BILLABLE_ROWS_READ_LIMIT +
  D1_RUNTIME_PRE_0016_STATE_BILLABLE_ROWS_READ;

export const D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS = [
  "0013-rate-limit-windows-index",
  "0013-ai-runs-index",
  "0013-ops-events-user-index",
  "0014-admin-totals-snapshot",
  "0015-completion-token-column",
  "0015-completion-message-id-column",
  "0015-completion-token-unique-partial-index",
  "0015-completion-message-id-unique-partial-index",
] as const;

export const D1_RUNTIME_0016_ABSENT_CHECK_IDS = [
  "0016-memory-summary-suppression-mask-column",
  "0016-memory-vector-cleanup-outbox-columns",
  "0016-memory-vector-cleanup-outbox-checks",
  "0016-memory-vector-cleanup-outbox-due-index",
  "0016-completion-marker",
] as const;

export const D1_RUNTIME_PRE_0016_STATE_SQL = `
SELECT
  CASE WHEN EXISTS (
    SELECT 1
    FROM pragma_table_info('user_memory_settings')
    WHERE name = 'summary_suppression_mask'
    LIMIT 1
  ) THEN 1 ELSE 0 END AS summary_mask_column_exists,
  CASE WHEN EXISTS (
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'memory_vector_cleanup_outbox'
    LIMIT 1
  ) THEN 1 ELSE 0 END AS outbox_table_exists,
  CASE WHEN EXISTS (
    SELECT 1
    FROM sqlite_master
    WHERE type = 'index' AND name = 'memory_vector_cleanup_outbox_due_idx'
    LIMIT 1
  ) THEN 1 ELSE 0 END AS outbox_index_exists,
  CASE WHEN EXISTS (
    SELECT 1 FROM app_metadata
    WHERE key = '${RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY}'
    LIMIT 1
  ) THEN 1 ELSE 0 END AS fixed_marker_exists,
  (
    SELECT value FROM app_metadata
    WHERE key = '${RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY}'
    LIMIT 1
  ) AS fixed_marker_value,
  (
    SELECT updated_at FROM app_metadata
    WHERE key = '${RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY}'
    LIMIT 1
  ) AS fixed_marker_updated_at,
  CASE WHEN EXISTS (
    SELECT 1 FROM app_metadata
    WHERE key = '${D1_RUNTIME_FRESH_0016_MARKER_KEY}'
    LIMIT 1
  ) THEN 1 ELSE 0 END AS fresh_marker_exists,
  (
    SELECT value FROM app_metadata
    WHERE key = '${D1_RUNTIME_FRESH_0016_MARKER_KEY}'
    LIMIT 1
  ) AS fresh_marker_value,
  (
    SELECT updated_at FROM app_metadata
    WHERE key = '${D1_RUNTIME_FRESH_0016_MARKER_KEY}'
    LIMIT 1
  ) AS fresh_marker_updated_at;
`.trim();

export type D1RuntimePre0016StateProof = Readonly<{
  classification: "exact-pre-0016";
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>;
  staticRowsRead: number;
  probeRowsRead: number;
  staticTotalAttempts: 1;
  probeTotalAttempts: 1;
  appliedCheckCount: typeof D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.length;
  absentCheckCount: typeof D1_RUNTIME_0016_ABSENT_CHECK_IDS.length;
  schemaObjectsAbsent: true;
  fixedMarkerAbsent: true;
  freshMarkerAbsent: true;
}>;

export function verifyD1RuntimePre0016State(options: Readonly<{
  backupDir: string;
  cwd?: string;
  nowMs?: number;
  runner: WranglerRunner;
  staticVerifier?: (options: {
    backupDir: string;
    cwd: string;
    nowMs: number;
    runner: WranglerRunner;
  }) => RuntimeMigrationVerificationReport;
}>): D1RuntimePre0016StateProof {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDir = path.resolve(options.backupDir);
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error("Pre-0016 runtime-state verification clock is invalid.");
  }
  const sourceBefore = buildRepoSourceFingerprint(cwd);
  const report = (options.staticVerifier ?? verifyD1RuntimeMigrations)({
    backupDir,
    cwd,
    nowMs,
    runner: options.runner,
  });
  assertExactStaticPre0016State(report, sourceBefore);
  const probe = loadD1RuntimePre0016StateProbe(options.runner);
  if (!isExactAbsentProbe(probe)) {
    throw new Error(
      "Runtime migration 0016 is present, partial, or malformed; exact pre-0016 state is required.",
    );
  }
  const sourceAfter = buildRepoSourceFingerprint(cwd);
  if (
    sourceBefore.sha256 !== sourceAfter.sha256 ||
    sourceBefore.fileCount !== sourceAfter.fileCount
  ) {
    throw new Error("Source files changed during exact pre-0016 state verification.");
  }
  return Object.freeze({
    classification: "exact-pre-0016",
    sourceFingerprint: Object.freeze({
      sha256: sourceAfter.sha256,
      fileCount: sourceAfter.fileCount,
    }),
    staticRowsRead: report.rowsRead,
    probeRowsRead: probe.rowsRead,
    staticTotalAttempts: 1,
    probeTotalAttempts: 1,
    appliedCheckCount: D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.length,
    absentCheckCount: D1_RUNTIME_0016_ABSENT_CHECK_IDS.length,
    schemaObjectsAbsent: true,
    fixedMarkerAbsent: true,
    freshMarkerAbsent: true,
  });
}

function loadD1RuntimePre0016StateProbe(
  runner: WranglerRunner,
) {
  const output = runner([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    D1_RUNTIME_PRE_0016_STATE_SQL,
  ]);
  let value: unknown;
  try {
    value = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("Pre-0016 runtime-state probe did not return JSON.");
  }
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("Pre-0016 runtime-state probe returned an invalid result set.");
  }
  const result = requiredRecord(value[0], "pre-0016 runtime-state result");
  const meta = requiredRecord(result.meta, "pre-0016 runtime-state metadata");
  const rowsRead = nonnegativeInteger(meta.rows_read, "pre-0016 probe rows read");
  const rowsWritten = nonnegativeInteger(
    meta.rows_written,
    "pre-0016 probe rows written",
  );
  const totalAttempts = nonnegativeInteger(
    meta.total_attempts,
    "pre-0016 probe attempts",
  );
  if (
    rowsRead > D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ ||
    rowsWritten !== 0 ||
    totalAttempts !== 1 ||
    !Array.isArray(result.results) ||
    result.results.length !== 1
  ) {
    throw new Error(
      "Pre-0016 runtime-state probe exceeded its bound or was not one exact read-only attempt.",
    );
  }
  const row = requiredRecord(result.results[0], "pre-0016 runtime-state row");
  const expectedKeys = [
    "fixed_marker_exists",
    "fixed_marker_updated_at",
    "fixed_marker_value",
    "fresh_marker_exists",
    "fresh_marker_updated_at",
    "fresh_marker_value",
    "outbox_index_exists",
    "outbox_table_exists",
    "summary_mask_column_exists",
  ];
  if (
    Object.keys(row).sort().join("\n") !== expectedKeys.sort().join("\n")
  ) {
    throw new Error("Pre-0016 runtime-state probe row has the wrong schema.");
  }
  return Object.freeze({
    rowsRead,
    summaryMaskColumnExists: bit(row.summary_mask_column_exists),
    outboxTableExists: bit(row.outbox_table_exists),
    outboxIndexExists: bit(row.outbox_index_exists),
    fixedMarkerExists: bit(row.fixed_marker_exists),
    fixedMarkerValue: row.fixed_marker_value,
    fixedMarkerUpdatedAt: row.fixed_marker_updated_at,
    freshMarkerExists: bit(row.fresh_marker_exists),
    freshMarkerValue: row.fresh_marker_value,
    freshMarkerUpdatedAt: row.fresh_marker_updated_at,
  });
}

function assertExactStaticPre0016State(
  report: RuntimeMigrationVerificationReport,
  source: Readonly<{ sha256: string; fileCount: number }>,
) {
  const expectedIds = new Set<string>(RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS);
  const checkStates = new Map<string, boolean>();
  for (const check of report.checks) {
    if (!expectedIds.has(check.id) || checkStates.has(check.id)) {
      throw new Error("Pre-0016 static verification returned duplicate or unknown checks.");
    }
    checkStates.set(check.id, check.ok);
  }
  if (
    report.backupDir !== path.resolve(report.backupDir) ||
    report.database !== D1_DATABASE_NAME ||
    report.sourceFingerprintStable !== true ||
    report.sourceFingerprintBefore.sha256 !== source.sha256 ||
    report.sourceFingerprintBefore.fileCount !== source.fileCount ||
    report.sourceFingerprint.sha256 !== source.sha256 ||
    report.sourceFingerprint.fileCount !== source.fileCount ||
    report.rowsRead > RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT ||
    report.rowsWritten !== 0 ||
    report.totalAttempts !== 1 ||
    report.checks.length !== RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length ||
    !D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.every(
      (id) => checkStates.get(id) === true,
    ) ||
    !D1_RUNTIME_0016_ABSENT_CHECK_IDS.every(
      (id) => checkStates.get(id) === false,
    )
  ) {
    throw new Error(
      "D1 requires exact 0013-0015 applied and exact 0016 absent before this operation.",
    );
  }
}

function isExactAbsentProbe(
  probe: ReturnType<typeof loadD1RuntimePre0016StateProbe>,
) {
  return probe.summaryMaskColumnExists === 0 &&
    probe.outboxTableExists === 0 &&
    probe.outboxIndexExists === 0 &&
    probe.fixedMarkerExists === 0 &&
    probe.fixedMarkerValue === null &&
    probe.fixedMarkerUpdatedAt === null &&
    probe.freshMarkerExists === 0 &&
    probe.freshMarkerValue === null &&
    probe.freshMarkerUpdatedAt === null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonnegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function bit(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) {
    throw new Error("Pre-0016 runtime-state existence flags must be bits.");
  }
  return value;
}

if (
  D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.length +
      D1_RUNTIME_0016_ABSENT_CHECK_IDS.length !==
    RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length ||
  D1_RUNTIME_PRE_0016_VERIFICATION_BILLABLE_ROWS_READ !== 15_096
) {
  throw new Error("Pre-0016 runtime-state verification bounds drifted.");
}
