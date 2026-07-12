import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertD1FreeDailyBudget,
  type D1DailyUsage,
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
  loadAccountD1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1ReleaseBudgetUtcDay,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  type D1ReleaseBudgetReservationResult,
} from "./d1-release-budget-ledger";
import {
  cloudflareDir,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  hasFlag,
  resolveBackupDir,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

// The cardinality query itself must be bounded. These caps keep its worst-case
// table scans below this reserve and force a manual re-plan before the five
// index builds or admin snapshot can become too large for the Free allowance.
const snapshotTableScanLimit = 90_001;
const indexedTableScanLimit = 16_662;
const preCardinalityReadReserve = 350_000;
export const MAXIMUM_PROJECTED_RUNTIME_MIGRATION_READS = 1_000_000;
export const MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES = 50_000;
export const RUNTIME_MIGRATION_SNAPSHOT_READ_PASSES = 3;
export const RUNTIME_MIGRATION_BUDGET_EVIDENCE_KIND =
  "d1-runtime-migrations-0013-0015-budget" as const;
export const RUNTIME_MIGRATION_BUDGET_REPORT =
  "d1-runtime-migration-budget.json" as const;
export const RUNTIME_MIGRATION_BUDGET_OPERATION_ID =
  "d1-runtime-migrations-0013-0015" as const;
export const RUNTIME_MIGRATION_BUDGET_MAX_AGE_MS = 15 * 60 * 1000;

export type RuntimeMigrationCardinalities = {
  users: number;
  chats: number;
  messages: number;
  aiRuns: number;
  rateLimitWindows: number;
  opsEvents: number;
  activityRuns: number;
};

export type RuntimeMigrationProjection = {
  rowsRead: number;
  rowsWritten: number;
  indexedRows: number;
  runtimeIndexRows: number;
  activityPartialUniqueIndexRows: number;
  snapshotRows: number;
};

export type D1CardinalityResult = {
  cardinalities: RuntimeMigrationCardinalities;
  rowsRead: number;
  rowsWritten: number;
};

export type RuntimeMigrationBudgetEvaluation = {
  cardinalities: RuntimeMigrationCardinalities;
  projection: RuntimeMigrationProjection;
  after: { rowsReadAfter: number; rowsWrittenAfter: number };
};

export type RuntimeMigrationBudgetReport = {
  kind: typeof RUNTIME_MIGRATION_BUDGET_EVIDENCE_KIND;
  schemaVersion: 1;
  createdAt: string;
  utcDay: string;
  ok: true;
  exact: true;
  operation: "Production D1 runtime migrations 0013-0015";
  operationId: typeof RUNTIME_MIGRATION_BUDGET_OPERATION_ID;
  backupDir: string;
  database: {
    id: typeof D1_DATABASE_ID;
    name: typeof D1_DATABASE_NAME;
  };
  safeDailyLimits: {
    rowsRead: typeof D1_FREE_SAFE_ROWS_READ_LIMIT;
    rowsWritten: typeof D1_FREE_SAFE_ROWS_WRITTEN_LIMIT;
  };
  usage: D1DailyUsage;
  cardinalities: RuntimeMigrationCardinalities;
  projection: RuntimeMigrationProjection;
  after: { rowsReadAfter: number; rowsWrittenAfter: number };
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprint: SourceFingerprint;
  sourceFingerprintStable: true;
  ledger: D1ReleaseBudgetReservationResult;
};

export type RuntimeMigrationBudgetCheckOptions = {
  backupDir: string;
  cwd?: string;
  runner?: WranglerRunner;
  clock?: () => Date;
  usageLoader?: (now: Date, runner: WranglerRunner, clock: () => Date) => D1DailyUsage;
  cardinalityLoader?: (runner: WranglerRunner) => D1CardinalityResult;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!hasFlag("--confirm-production")) {
    throw new Error("The production D1 migration budget check requires --confirm-production.");
  }
  const backupDir = resolveBackupDir();
  const report = runRuntimeMigrationBudgetCheck({ backupDir });
  const reportPath = writeRuntimeMigrationBudgetReport(backupDir, report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

export function runRuntimeMigrationBudgetCheck(
  options: RuntimeMigrationBudgetCheckOptions,
): RuntimeMigrationBudgetReport {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDir = path.resolve(options.backupDir);
  const runner = options.runner ?? runWrangler;
  const clock = options.clock ?? (() => new Date());
  const startedAt = validClockValue(clock(), "budget check start");
  const utcDay = startedAt.toISOString().slice(0, 10);
  const sourceFingerprintBefore = buildRepoSourceFingerprint(cwd);
  const usage = (options.usageLoader ?? loadAccountD1DailyUsage)(startedAt, runner, clock);
  reserveD1ReleaseBudget({
    backupDir,
    operationId: RUNTIME_MIGRATION_BUDGET_OPERATION_ID,
    operation: "Production D1 runtime migrations 0013-0015",
    sourceFingerprint: compactFingerprint(sourceFingerprintBefore),
    phase: "maximum",
    rowsRead: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_READS,
    rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
    observedUsage: usage,
    now: startedAt,
    expectedUtcDay: utcDay,
  });
  const evaluation = evaluateRuntimeMigrationBudget(
    usage,
    () => (options.cardinalityLoader ?? loadRuntimeMigrationCardinalities)(runner),
  );
  const sourceFingerprintAfterQuery = buildRepoSourceFingerprint(cwd);
  assertStableSourceFingerprint(sourceFingerprintBefore, sourceFingerprintAfterQuery);
  const exactReservedAt = validClockValue(clock(), "exact budget reservation");
  const ledger = reserveD1ReleaseBudget({
    backupDir,
    operationId: RUNTIME_MIGRATION_BUDGET_OPERATION_ID,
    operation: "Production D1 runtime migrations 0013-0015",
    sourceFingerprint: compactFingerprint(sourceFingerprintBefore),
    phase: "exact",
    rowsRead: evaluation.projection.rowsRead,
    rowsWritten: evaluation.projection.rowsWritten,
    observedUsage: usage,
    now: exactReservedAt,
    expectedUtcDay: utcDay,
  });
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  assertStableSourceFingerprint(sourceFingerprintBefore, sourceFingerprint);
  const completedAt = validClockValue(clock(), "budget check completion");
  assertD1ReleaseBudgetUtcDay(utcDay, completedAt);
  return {
    kind: RUNTIME_MIGRATION_BUDGET_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: completedAt.toISOString(),
    utcDay,
    ok: true,
    exact: true,
    operation: "Production D1 runtime migrations 0013-0015",
    operationId: RUNTIME_MIGRATION_BUDGET_OPERATION_ID,
    backupDir,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    safeDailyLimits: {
      rowsRead: D1_FREE_SAFE_ROWS_READ_LIMIT,
      rowsWritten: D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
    },
    usage,
    cardinalities: evaluation.cardinalities,
    projection: evaluation.projection,
    after: evaluation.after,
    sourceFingerprintBefore,
    sourceFingerprint,
    sourceFingerprintStable: true,
    ledger,
  };
}

export function writeRuntimeMigrationBudgetReport(
  backupDir: string,
  report: RuntimeMigrationBudgetReport,
) {
  const reportPath = runtimeMigrationBudgetReportPath(backupDir);
  writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
  return reportPath;
}

export function runtimeMigrationBudgetReportPath(backupDir: string) {
  return path.join(cloudflareDir(path.resolve(backupDir)), RUNTIME_MIGRATION_BUDGET_REPORT);
}

export function evaluateRuntimeMigrationBudget(
  usage: D1DailyUsage,
  cardinalityLoader: () => D1CardinalityResult,
): RuntimeMigrationBudgetEvaluation {
  // This assertion intentionally precedes cardinalityLoader: an exhausted
  // account must not execute even the bounded, read-only cardinality SQL.
  assertD1FreeDailyBudget(usage, {
    operation: "Production D1 migrations 0013-0015 cardinality preflight",
    rowsRead: preCardinalityReadReserve,
    rowsWritten: 0,
  });
  const measured = cardinalityLoader();
  if (measured.rowsWritten !== 0) {
    throw new Error("Read-only D1 cardinality SQL unexpectedly reported rows written.");
  }
  const projection = projectRuntimeMigrationUsage(measured.cardinalities, measured.rowsRead);
  const after = assertD1FreeDailyBudget(usage, {
    operation: "Production D1 runtime migrations 0013-0015",
    rowsRead: projection.rowsRead,
    rowsWritten: projection.rowsWritten,
  });
  return { cardinalities: measured.cardinalities, projection, after };
}

export function projectRuntimeMigrationUsage(
  counts: RuntimeMigrationCardinalities,
  cardinalityQueryRowsRead: number,
): RuntimeMigrationProjection {
  for (const [label, value] of Object.entries(counts)) {
    assertNonNegativeSafeInteger(value, label);
  }
  assertNonNegativeSafeInteger(cardinalityQueryRowsRead, "cardinality query rows read");
  assertCardinalityBelowScanLimit(counts.users, snapshotTableScanLimit, "users");
  assertCardinalityBelowScanLimit(counts.chats, snapshotTableScanLimit, "chats");
  assertCardinalityBelowScanLimit(counts.messages, snapshotTableScanLimit, "messages");
  assertCardinalityBelowScanLimit(counts.aiRuns, indexedTableScanLimit, "AI runs");
  assertCardinalityBelowScanLimit(
    counts.rateLimitWindows,
    indexedTableScanLimit,
    "rate-limit windows",
  );
  assertCardinalityBelowScanLimit(counts.opsEvents, indexedTableScanLimit, "ops events");
  assertCardinalityBelowScanLimit(counts.activityRuns, indexedTableScanLimit, "activity runs");
  const runtimeIndexRows = safeSum(
    [counts.rateLimitWindows, counts.aiRuns, counts.opsEvents],
    "0013 runtime index rows",
  );
  // 0015 builds two independent partial unique indexes. Existing NULL values
  // are not stored in either index, but reserve a full-table index entry for
  // each build so this gate stays safe if the migration is retried after new
  // activity completions have been written.
  const activityPartialUniqueIndexRows = safeMultiply(
    counts.activityRuns,
    2,
    "0015 activity partial unique index rows",
  );
  const indexedRows = safeSum(
    [runtimeIndexRows, activityPartialUniqueIndexRows],
    "0013-0015 indexed rows",
  );
  const snapshotRows = safeSum(
    [counts.users, counts.chats, counts.messages, counts.aiRuns],
    "snapshot rows",
  );
  // DDL accounting is platform-dependent. Reserve four reads and three writes
  // per indexed row, then three full snapshot passes for the reserved-domain
  // exclusion lookups in 0014 plus fixed verification room.
  const rowsRead = safeSum(
    [
      cardinalityQueryRowsRead,
      safeMultiply(indexedRows, 4, "indexed-row reads"),
      safeMultiply(
        snapshotRows,
        RUNTIME_MIGRATION_SNAPSHOT_READ_PASSES,
        "snapshot reads",
      ),
      5_000,
    ],
    "projected migration reads",
  );
  const rowsWritten = safeSum(
    [safeMultiply(indexedRows, 3, "indexed-row writes"), 16],
    "projected migration writes",
  );
  if (rowsRead > MAXIMUM_PROJECTED_RUNTIME_MIGRATION_READS) {
    throw new Error(
      `Runtime migration read projection ${rowsRead} exceeds ${MAXIMUM_PROJECTED_RUNTIME_MIGRATION_READS}.`,
    );
  }
  if (rowsWritten > MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES) {
    throw new Error(
      `Runtime migration write projection ${rowsWritten} exceeds ${MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES}.`,
    );
  }
  return {
    rowsRead,
    rowsWritten,
    indexedRows,
    runtimeIndexRows,
    activityPartialUniqueIndexRows,
    snapshotRows,
  };
}

export function loadRuntimeMigrationCardinalities(
  runner: WranglerRunner = runWrangler,
): D1CardinalityResult {
  const sql = [
    "SELECT",
    `  (SELECT count(*) FROM (SELECT 1 FROM users LIMIT ${snapshotTableScanLimit})) AS users,`,
    `  (SELECT count(*) FROM (SELECT 1 FROM chats LIMIT ${snapshotTableScanLimit})) AS chats,`,
    `  (SELECT count(*) FROM (SELECT 1 FROM messages LIMIT ${snapshotTableScanLimit})) AS messages,`,
    `  (SELECT count(*) FROM (SELECT 1 FROM ai_runs LIMIT ${indexedTableScanLimit})) AS ai_runs,`,
    `  (SELECT count(*) FROM (SELECT 1 FROM rate_limit_windows LIMIT ${indexedTableScanLimit})) AS rate_limit_windows,`,
    `  (SELECT count(*) FROM (SELECT 1 FROM ops_events LIMIT ${indexedTableScanLimit})) AS ops_events,`,
    `  (SELECT count(*) FROM (SELECT 1 FROM activity_runs LIMIT ${indexedTableScanLimit})) AS activity_runs;`,
  ].join("\n");
  const value = parseWranglerJson(
    runner([
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      sql,
    ]),
  );
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error("D1 cardinality check returned an invalid result set.");
  }
  const result = value[0];
  if (!Array.isArray(result.results) || result.results.length !== 1 || !isRecord(result.results[0])) {
    throw new Error("D1 cardinality check returned an invalid row.");
  }
  if (!isRecord(result.meta)) throw new Error("D1 cardinality check omitted query metadata.");
  const row = result.results[0];
  const cardinalities = {
    users: requiredNonNegativeInteger(row.users, "users"),
    chats: requiredNonNegativeInteger(row.chats, "chats"),
    messages: requiredNonNegativeInteger(row.messages, "messages"),
    aiRuns: requiredNonNegativeInteger(row.ai_runs, "AI runs"),
    rateLimitWindows: requiredNonNegativeInteger(row.rate_limit_windows, "rate-limit windows"),
    opsEvents: requiredNonNegativeInteger(row.ops_events, "ops events"),
    activityRuns: requiredNonNegativeInteger(row.activity_runs, "activity runs"),
  };
  assertCardinalityBelowScanLimit(cardinalities.users, snapshotTableScanLimit, "users");
  assertCardinalityBelowScanLimit(cardinalities.chats, snapshotTableScanLimit, "chats");
  assertCardinalityBelowScanLimit(cardinalities.messages, snapshotTableScanLimit, "messages");
  assertCardinalityBelowScanLimit(cardinalities.aiRuns, indexedTableScanLimit, "AI runs");
  assertCardinalityBelowScanLimit(
    cardinalities.rateLimitWindows,
    indexedTableScanLimit,
    "rate-limit windows",
  );
  assertCardinalityBelowScanLimit(
    cardinalities.opsEvents,
    indexedTableScanLimit,
    "ops events",
  );
  assertCardinalityBelowScanLimit(
    cardinalities.activityRuns,
    indexedTableScanLimit,
    "activity runs",
  );
  const rowsRead = requiredNonNegativeInteger(result.meta.rows_read, "cardinality rows read");
  const rowsWritten = requiredNonNegativeInteger(
    result.meta.rows_written,
    "cardinality rows written",
  );
  if (rowsWritten !== 0) {
    throw new Error("Read-only D1 cardinality SQL unexpectedly reported rows written.");
  }
  return {
    cardinalities,
    rowsRead,
    rowsWritten,
  };
}

function parseWranglerJson(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) throw new Error("Could not parse Wrangler D1 JSON output.");
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function requiredNonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label} cardinality.`);
  }
  return value;
}

function assertNonNegativeSafeInteger(value: number, label: string) {
  requiredNonNegativeInteger(value, label);
}

function safeSum(values: number[], label: string) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error(`Unsafe ${label}.`);
  return total;
}

function safeMultiply(value: number, factor: number, label: string) {
  const result = value * factor;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Unsafe ${label}.`);
  return result;
}

function assertCardinalityBelowScanLimit(value: number, limit: number, label: string) {
  if (value >= limit) {
    throw new Error(
      `Runtime migration ${label} cardinality reached its bounded scan cap of ${limit}; re-plan before running DDL.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactFingerprint(fingerprint: SourceFingerprint) {
  return { sha256: fingerprint.sha256, fileCount: fingerprint.fileCount };
}

function assertStableSourceFingerprint(expected: SourceFingerprint, current: SourceFingerprint) {
  if (expected.sha256 !== current.sha256 || expected.fileCount !== current.fileCount) {
    throw new Error("Source fingerprint changed during the D1 runtime migration budget check.");
  }
}

function validClockValue(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`D1 runtime migration ${label} requires a valid clock value.`);
  }
  return value;
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
