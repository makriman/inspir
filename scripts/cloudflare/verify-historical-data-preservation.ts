import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  readPrivateJsonNoFollow,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  type D1ReleaseBudgetReservationResult,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  D1_DATABASE_NAME,
  createHash,
  hasFlag,
  resolveBackupDir,
  runWrangler,
  stableStringify,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

export const HISTORICAL_DATA_PRESERVATION_KIND =
  "inspir-historical-data-preservation-v1" as const;
export const HISTORICAL_DATA_BASELINE_RELATIVE_PATH =
  "cloudflare/historical-data-preservation-baseline.json" as const;
export const HISTORICAL_DATA_VERIFICATION_RELATIVE_PATH =
  "cloudflare/historical-data-preservation-verification.json" as const;
export const HISTORICAL_SENTINEL_LIMIT = 16;
export const HISTORICAL_CORE_ROW_LIMIT = 350_000;
export const HISTORICAL_BILLED_READ_LIMIT = 750_000;
export const HISTORICAL_DATA_REPORT_MAX_BYTES = 2 * 1024 * 1024;
export const HISTORICAL_DATA_BASELINE_MAX_AGE_MS = 30 * 60 * 1000;
export const HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const historicalRequiredNonemptyDatasets = [
  "users",
  "accounts",
  "chats",
  "messages",
  "user_memories",
] as const;

export const HISTORICAL_DATASET_NAMES = [
  "users",
  "accounts",
  "sessions",
  "chats",
  "messages",
  "admin_users",
  "user_memories",
  "activity_runs",
  "product_events",
  "profile_photo_pointers",
] as const;

export type HistoricalDatasetName = (typeof HISTORICAL_DATASET_NAMES)[number];

type HistoricalColumnIdentity = {
  name: string;
  type: string;
  notNull: 0 | 1;
  primaryKey: number;
};

export type HistoricalDatasetEvidence = {
  rowCount: number;
  schemaTable: string;
  schemaSha256: string;
  columns: HistoricalColumnIdentity[];
  sentinels: string[];
};

export type HistoricalDataBaselineReport = {
  kind: typeof HISTORICAL_DATA_PRESERVATION_KIND;
  schemaVersion: 1;
  phase: "baseline";
  createdAt: string;
  utcDay: string;
  operationId: string;
  backupDir: string;
  database: typeof D1_DATABASE_NAME;
  ok: true;
  privacy: "hmac-sha256-no-raw-identifiers";
  hmacKeyId: string;
  sourceFingerprint: SourceFingerprint;
  rowsRead: number;
  rowsWritten: 0;
  usage: D1DailyUsage;
  ledger: D1ReleaseBudgetReservationResult;
  limits: {
    coreRows: number;
    billedReads: number;
    sentinelsPerDataset: number;
  };
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
};

export type HistoricalDataVerificationReport = {
  kind: typeof HISTORICAL_DATA_PRESERVATION_KIND;
  schemaVersion: 1;
  phase: "verification";
  createdAt: string;
  utcDay: string;
  operationId: string;
  backupDir: string;
  database: typeof D1_DATABASE_NAME;
  ok: boolean;
  privacy: "hmac-sha256-no-raw-identifiers";
  hmacKeyId: string;
  sourceFingerprint: SourceFingerprint;
  baselineCreatedAt: string;
  rowsRead: number;
  rowsWritten: 0;
  usage: D1DailyUsage;
  ledger: D1ReleaseBudgetReservationResult;
  problems: string[];
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
};

type CapturedDataset = HistoricalDatasetEvidence & {
  identityHashes: Set<string>;
};

type HistoricalCapture = {
  rowsRead: number;
  rowsWritten: 0;
  hmacKeyId: string;
  datasets: Record<HistoricalDatasetName, CapturedDataset>;
};

type HistoricalClock = () => Date;

type HistoricalUsageLoader = (
  now: Date,
  runner: WranglerRunner,
  clock: HistoricalClock,
) => D1DailyUsage;

type HistoricalOperationOptions = {
  backupDir: string;
  hmacSecret: string;
  cwd?: string;
  runner?: WranglerRunner;
  clock?: HistoricalClock;
  usageLoader?: HistoricalUsageLoader;
  sourceFingerprint?: SourceFingerprint;
  sourceFingerprintProvider?: () => SourceFingerprint;
};

export type ReadHistoricalDataBaselineOptions = {
  backupDir: string;
  cwd?: string;
  expectedSourceFingerprint?: SourceFingerprint;
  now?: Date;
  maximumAgeMs?: number;
};

type DatasetSpec = {
  name: HistoricalDatasetName;
  table: string;
  cap: number;
  identitySql: string;
};

const coreTableNames = [
  "users",
  "accounts",
  "sessions",
  "chats",
  "messages",
  "admin_users",
  "user_memories",
  "activity_runs",
  "product_events",
] as const;

const datasetSpecs: readonly DatasetSpec[] = [
  { name: "users", table: "users", cap: 100_000, identitySql: "SELECT id AS identity_1 FROM users ORDER BY rowid LIMIT 16;" },
  { name: "accounts", table: "accounts", cap: 150_000, identitySql: "SELECT provider AS identity_1, provider_account_id AS identity_2, user_id AS identity_3 FROM accounts ORDER BY rowid LIMIT 16;" },
  { name: "sessions", table: "sessions", cap: 150_000, identitySql: "SELECT session_token AS identity_1, user_id AS identity_2 FROM sessions ORDER BY rowid LIMIT 16;" },
  { name: "chats", table: "chats", cap: 100_000, identitySql: "SELECT id AS identity_1, coalesce(user_id, '') AS identity_2 FROM chats ORDER BY rowid LIMIT 16;" },
  { name: "messages", table: "messages", cap: 250_000, identitySql: "SELECT id AS identity_1, chat_id AS identity_2 FROM messages ORDER BY rowid LIMIT 16;" },
  { name: "admin_users", table: "admin_users", cap: 1_000, identitySql: "SELECT email AS identity_1 FROM admin_users ORDER BY rowid LIMIT 16;" },
  { name: "user_memories", table: "user_memories", cap: 100_000, identitySql: "SELECT id AS identity_1, user_id AS identity_2 FROM user_memories ORDER BY rowid LIMIT 16;" },
  { name: "activity_runs", table: "activity_runs", cap: 75_000, identitySql: "SELECT id AS identity_1, chat_id AS identity_2 FROM activity_runs ORDER BY rowid LIMIT 16;" },
  { name: "product_events", table: "product_events", cap: 250_000, identitySql: "SELECT id AS identity_1, coalesce(user_id, '') AS identity_2 FROM product_events ORDER BY rowid LIMIT 16;" },
  {
    name: "profile_photo_pointers",
    table: "users",
    cap: 100_000,
    identitySql:
      "SELECT id AS identity_1, coalesce(profile_image_r2_key, '') AS identity_2, coalesce(profile_image_hash, '') AS identity_3, coalesce(profile_image_r2_etag, '') AS identity_4 FROM users WHERE profile_image_r2_key IS NOT NULL OR profile_image_hash IS NOT NULL OR profile_image_r2_etag IS NOT NULL ORDER BY rowid LIMIT 16;",
  },
] as const;

const safeNonnegativeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a nonnegative safe integer.",
);
const safePositiveIntegerSchema = safeNonnegativeIntegerSchema.refine(
  (value) => value > 0,
  "Expected a positive safe integer.",
);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical ISO timestamp.");
const utcDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  "Expected a valid UTC day.",
);
const historicalColumnSchema = z.object({
  name: z.string().min(1).max(256),
  type: z.string().max(256),
  notNull: z.union([z.literal(0), z.literal(1)]),
  primaryKey: safeNonnegativeIntegerSchema,
}).strict();
const historicalDatasetSchema = z.object({
  rowCount: safeNonnegativeIntegerSchema,
  schemaTable: z.string().min(1).max(128),
  schemaSha256: sha256Schema,
  columns: z.array(historicalColumnSchema).min(1).max(256),
  sentinels: z.array(sha256Schema).max(HISTORICAL_SENTINEL_LIMIT),
}).strict();
const sourceFileSchema = z.object({
  file: z.string().min(1).max(2_048),
  bytes: safeNonnegativeIntegerSchema,
  sha256: sha256Schema,
}).strict();
const sourceFingerprintSchema = z.object({
  sha256: sha256Schema,
  fileCount: safePositiveIntegerSchema,
  files: z.array(sourceFileSchema).min(1).max(20_000),
}).strict();
const d1UsageSchema = z.object({
  databaseCount: safePositiveIntegerSchema,
  queryGroups: safeNonnegativeIntegerSchema,
  rowsRead: safeNonnegativeIntegerSchema,
  rowsWritten: safeNonnegativeIntegerSchema,
  executions: safeNonnegativeIntegerSchema,
  windowMinutes: safePositiveIntegerSchema.refine((value) => value <= 24 * 60),
}).strict();
const historicalLedgerReservationSchema = z.object({
  operationId: z.string().min(1).max(200),
  operation: z.string().min(1).max(160),
  candidateVersionId: z.null(),
  phase: z.literal("exact"),
  rowsRead: safeNonnegativeIntegerSchema,
  rowsWritten: z.literal(0),
  maximumRowsRead: z.literal(HISTORICAL_BILLED_READ_LIMIT),
  maximumRowsWritten: z.literal(0),
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
}).strict();
const historicalLedgerResultSchema = z.object({
  ledgerPath: z.string().min(1).max(4_096),
  utcDay: utcDaySchema,
  revision: safePositiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: historicalLedgerReservationSchema,
  totals: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
}).strict();
const historicalBaselineSchema = z.object({
  kind: z.literal(HISTORICAL_DATA_PRESERVATION_KIND),
  schemaVersion: z.literal(1),
  phase: z.literal("baseline"),
  createdAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  operationId: z.string().min(1).max(200),
  backupDir: z.string().min(1).max(4_096),
  database: z.literal(D1_DATABASE_NAME),
  ok: z.literal(true),
  privacy: z.literal("hmac-sha256-no-raw-identifiers"),
  hmacKeyId: sha256Schema,
  sourceFingerprint: sourceFingerprintSchema,
  rowsRead: safePositiveIntegerSchema.refine((value) => value <= HISTORICAL_BILLED_READ_LIMIT),
  rowsWritten: z.literal(0),
  usage: d1UsageSchema,
  ledger: historicalLedgerResultSchema,
  limits: z.object({
    coreRows: z.literal(HISTORICAL_CORE_ROW_LIMIT),
    billedReads: z.literal(HISTORICAL_BILLED_READ_LIMIT),
    sentinelsPerDataset: z.literal(HISTORICAL_SENTINEL_LIMIT),
  }).strict(),
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), historicalDatasetSchema),
}).strict();

export const HISTORICAL_DATA_SUMMARY_SQL = [
  `SELECT ${datasetSpecs
    .map((spec) =>
      spec.name === "profile_photo_pointers"
        ? `('${spec.name}') AS dataset, (SELECT count(*) FROM users WHERE profile_image_r2_key IS NOT NULL OR profile_image_hash IS NOT NULL OR profile_image_r2_etag IS NOT NULL) AS row_count`
        : `('${spec.name}') AS dataset, (SELECT count(*) FROM ${spec.table}) AS row_count`,
    )
    .join(" UNION ALL SELECT ")};`,
  `SELECT table_name, name, type, not_null, primary_key FROM (${coreTableNames
    .map(
      (table) =>
        `SELECT '${table}' AS table_name, name, lower(type) AS type, "notnull" AS not_null, pk AS primary_key FROM pragma_table_info('${table}')`,
    )
    .join(" UNION ALL ")}) ORDER BY table_name, primary_key DESC, name;`,
].join("\n");

export const HISTORICAL_DATA_IDENTITIES_SQL = datasetSpecs
  .map((spec) => spec.identitySql)
  .join("\n");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

function captureHistoricalDataSnapshot(options: {
  hmacSecret: string;
  runner?: WranglerRunner;
}): HistoricalCapture {
  const secret = requireHistoricalHmacSecret(options.hmacSecret);
  const runner = options.runner ?? runWrangler;
  const summary = executeD1ReadOnly(HISTORICAL_DATA_SUMMARY_SQL, runner);
  if (summary.resultSets.length !== 2) {
    throw new Error("Historical preservation summary returned an unexpected result-set count.");
  }
  const counts = parseDatasetCounts(summary.resultSets[0] ?? []);
  const columns = parseSchemaColumns(summary.resultSets[1] ?? []);
  const coreRows = coreTableNames.reduce((sum, table) => sum + counts[table], 0);
  if (coreRows > HISTORICAL_CORE_ROW_LIMIT) {
    throw new Error(
      `Historical preservation core rows exceed the Free-plan cap: ${coreRows} > ${HISTORICAL_CORE_ROW_LIMIT}.`,
    );
  }
  for (const spec of datasetSpecs) {
    if (counts[spec.name] > spec.cap) {
      throw new Error(
        `Historical preservation ${spec.name} rows exceed its cap: ${counts[spec.name]} > ${spec.cap}.`,
      );
    }
  }
  const projectedRowsRead =
    summary.rowsRead +
    HISTORICAL_DATASET_NAMES.reduce(
      (sum, name) => sum + Math.min(counts[name], HISTORICAL_SENTINEL_LIMIT),
      0,
    );
  if (projectedRowsRead > HISTORICAL_BILLED_READ_LIMIT) {
    throw new Error(
      `Historical preservation projected reads exceed the Free-plan cap: ${projectedRowsRead} > ${HISTORICAL_BILLED_READ_LIMIT}.`,
    );
  }

  const identities = executeD1ReadOnly(HISTORICAL_DATA_IDENTITIES_SQL, runner);
  if (identities.resultSets.length !== datasetSpecs.length) {
    throw new Error("Historical preservation identities returned an unexpected result-set count.");
  }
  const rowsRead = summary.rowsRead + identities.rowsRead;
  if (rowsRead > HISTORICAL_BILLED_READ_LIMIT) {
    throw new Error(
      `Historical preservation billed reads exceed the Free-plan cap: ${rowsRead} > ${HISTORICAL_BILLED_READ_LIMIT}.`,
    );
  }

  const datasets: Partial<Record<HistoricalDatasetName, CapturedDataset>> = {};
  for (const [index, spec] of datasetSpecs.entries()) {
    const rows = identities.resultSets[index] ?? [];
    const expectedRows = Math.min(counts[spec.name], HISTORICAL_SENTINEL_LIMIT);
    if (rows.length !== expectedRows) {
      throw new Error(
        `Historical preservation ${spec.name} sentinel cardinality mismatch: ${rows.length}/${expectedRows}.`,
      );
    }
    const identityHashes = new Set(
      rows.map((row) => hmacIdentity(secret, spec.name, identityValues(row))),
    );
    if (identityHashes.size !== rows.length) {
      throw new Error(`Historical preservation ${spec.name} contains duplicate stable identities.`);
    }
    const schemaColumns = columns[spec.table];
    if (!schemaColumns?.length) {
      throw new Error(`Historical preservation schema is missing ${spec.table}.`);
    }
    datasets[spec.name] = {
      rowCount: counts[spec.name],
      schemaTable: spec.table,
      schemaSha256: schemaHash(schemaColumns),
      columns: schemaColumns,
      sentinels: [...identityHashes].slice(0, HISTORICAL_SENTINEL_LIMIT),
      identityHashes,
    };
  }
  assertCompleteCapturedDatasets(datasets);
  return {
    rowsRead,
    rowsWritten: 0,
    hmacKeyId: createHmac("sha256", secret).update("inspir-preservation-key-id-v1").digest("hex"),
    datasets,
  };
}

export function createHistoricalDataBaseline(
  options: HistoricalOperationOptions,
): HistoricalDataBaselineReport {
  const operation = startHistoricalOperation("baseline", options);
  const captured = captureHistoricalDataSnapshot({
    hmacSecret: options.hmacSecret,
    runner: operation.runner,
  });
  for (const name of historicalRequiredNonemptyDatasets) {
    if (captured.datasets[name].rowCount === 0) {
      throw new Error(
        `Historical preservation refuses an empty or wrong production database: ${name} has no rows.`,
      );
    }
  }
  const sourceAfter = operation.sourceProvider();
  assertValidSourceFingerprint(sourceAfter);
  assertSameSource(operation.sourceBefore, sourceAfter);
  const ledger = finishHistoricalOperation(operation, captured.rowsRead);
  const createdAt = operation.completedAt.toISOString();
  return {
    kind: HISTORICAL_DATA_PRESERVATION_KIND,
    schemaVersion: 1,
    phase: "baseline",
    createdAt,
    utcDay: operation.utcDay,
    operationId: operation.operationId,
    backupDir: operation.backupDir,
    database: D1_DATABASE_NAME,
    ok: true,
    privacy: "hmac-sha256-no-raw-identifiers",
    hmacKeyId: captured.hmacKeyId,
    sourceFingerprint: sourceAfter,
    rowsRead: captured.rowsRead,
    rowsWritten: 0,
    usage: operation.usage,
    ledger,
    limits: {
      coreRows: HISTORICAL_CORE_ROW_LIMIT,
      billedReads: HISTORICAL_BILLED_READ_LIMIT,
      sentinelsPerDataset: HISTORICAL_SENTINEL_LIMIT,
    },
    datasets: publicDatasets(captured.datasets),
  };
}

export function verifyHistoricalDataPreservation(options: {
  baseline: HistoricalDataBaselineReport;
  maximumBaselineAgeMs?: number;
} & HistoricalOperationOptions): HistoricalDataVerificationReport {
  const operation = startHistoricalOperation("verification", options);
  const baseline = validateHistoricalDataBaselineReport(options.baseline, {
    backupDir: operation.backupDir,
    expectedSourceFingerprint: operation.sourceBefore,
    now: operation.startedAt,
    maximumAgeMs: options.maximumBaselineAgeMs ?? HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
    requireLiveLedger: true,
  });
  const captured = captureHistoricalDataSnapshot({
    hmacSecret: options.hmacSecret,
    runner: operation.runner,
  });
  const sourceAfter = operation.sourceProvider();
  assertValidSourceFingerprint(sourceAfter);
  assertSameSource(operation.sourceBefore, sourceAfter);
  const ledger = finishHistoricalOperation(operation, captured.rowsRead);
  const problems: string[] = [];
  if (captured.hmacKeyId !== baseline.hmacKeyId) {
    problems.push("The preservation HMAC key does not match the baseline key.");
  }
  for (const name of HISTORICAL_DATASET_NAMES) {
    const baselineDataset = baseline.datasets[name];
    const current = captured.datasets[name];
    if (current.rowCount < baselineDataset.rowCount) {
      problems.push(`${name} row count decreased: ${current.rowCount} < ${baselineDataset.rowCount}.`);
    }
    const currentColumns = new Set(current.columns.map(columnIdentity));
    for (const column of baselineDataset.columns) {
      if (!currentColumns.has(columnIdentity(column))) {
        problems.push(`${name} lost or changed baseline column ${column.name}.`);
      }
    }
    for (const sentinel of baselineDataset.sentinels) {
      if (!current.identityHashes.has(sentinel)) {
        problems.push(`${name} is missing a baseline identity sentinel.`);
      }
    }
  }
  return {
    kind: HISTORICAL_DATA_PRESERVATION_KIND,
    schemaVersion: 1,
    phase: "verification",
    createdAt: operation.completedAt.toISOString(),
    utcDay: operation.utcDay,
    operationId: operation.operationId,
    backupDir: operation.backupDir,
    database: D1_DATABASE_NAME,
    ok: problems.length === 0,
    privacy: "hmac-sha256-no-raw-identifiers",
    hmacKeyId: captured.hmacKeyId,
    sourceFingerprint: sourceAfter,
    baselineCreatedAt: baseline.createdAt,
    rowsRead: captured.rowsRead,
    rowsWritten: 0,
    usage: operation.usage,
    ledger,
    problems,
    datasets: publicDatasets(captured.datasets),
  };
}

export function historicalDataBudgetOperationId(
  phase: "baseline" | "verification",
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint.sha256)) {
    throw new Error("Historical preservation budget identity requires an exact source SHA-256.");
  }
  if (!Number.isSafeInteger(sourceFingerprint.fileCount) || sourceFingerprint.fileCount <= 0) {
    throw new Error("Historical preservation budget identity requires a positive source file count.");
  }
  const binding = createHash()
    .update(stableStringify({ kind: HISTORICAL_DATA_PRESERVATION_KIND, phase, sourceFingerprint }))
    .digest("hex");
  return `historical-data-preservation-${phase}:${binding}`;
}

export function writeHistoricalDataReport(
  backupDir: string,
  report: HistoricalDataBaselineReport | HistoricalDataVerificationReport,
) {
  const outputPath = historicalDataReportPath(backupDir, report.phase);
  ensureHistoricalEvidenceDirectory(path.dirname(outputPath));
  writePrivateJsonDurably(outputPath, report, { replace: pathEntryExists(outputPath) });
  return outputPath;
}

export function historicalDataReportPath(
  backupDir: string,
  phase: "baseline" | "verification",
) {
  const relative = phase === "baseline"
    ? HISTORICAL_DATA_BASELINE_RELATIVE_PATH
    : HISTORICAL_DATA_VERIFICATION_RELATIVE_PATH;
  return path.join(path.resolve(backupDir), relative);
}

export function readAndValidateHistoricalDataBaseline(
  options: ReadHistoricalDataBaselineOptions,
): HistoricalDataBaselineReport {
  const backupDir = path.resolve(options.backupDir);
  const file = historicalDataReportPath(backupDir, "baseline");
  const value = readPrivateJsonNoFollow(file, HISTORICAL_DATA_REPORT_MAX_BYTES);
  const expectedSource = options.expectedSourceFingerprint ??
    buildRepoSourceFingerprint(path.resolve(options.cwd ?? process.cwd()));
  return validateHistoricalDataBaselineReport(value, {
    backupDir,
    expectedSourceFingerprint: expectedSource,
    now: options.now ?? new Date(),
    maximumAgeMs: options.maximumAgeMs ?? HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
    requireLiveLedger: true,
  });
}

type HistoricalOperation = {
  phase: "baseline" | "verification";
  backupDir: string;
  runner: WranglerRunner;
  clock: HistoricalClock;
  startedAt: Date;
  completedAt: Date;
  utcDay: string;
  sourceProvider: () => SourceFingerprint;
  sourceBefore: SourceFingerprint;
  sourceIdentity: D1ReleaseSourceIdentity;
  operationId: string;
  usage: D1DailyUsage;
};

function startHistoricalOperation(
  phase: "baseline" | "verification",
  options: HistoricalOperationOptions,
): HistoricalOperation {
  if (options.sourceFingerprint && options.sourceFingerprintProvider) {
    throw new Error("Choose one historical preservation source fingerprint input.");
  }
  const backupDir = path.resolve(options.backupDir);
  const runner = options.runner ?? runWrangler;
  const clock = options.clock ?? (() => new Date());
  const startedAt = readHistoricalClock(clock, `${phase} start`);
  const utcDay = startedAt.toISOString().slice(0, 10);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const providedSource = options.sourceFingerprint;
  const sourceProvider = options.sourceFingerprintProvider ??
    (providedSource ? () => providedSource : () => buildRepoSourceFingerprint(cwd));
  const sourceBefore = sourceProvider();
  assertValidSourceFingerprint(sourceBefore);
  const sourceIdentity = compactSourceFingerprint(sourceBefore);
  const operationId = historicalDataBudgetOperationId(phase, sourceIdentity);
  const usage = (options.usageLoader ?? loadAccountD1DailyUsage)(startedAt, runner, clock);
  reserveD1ReleaseBudget({
    backupDir,
    operationId,
    operation: historicalOperationName(phase),
    sourceFingerprint: sourceIdentity,
    phase: "maximum",
    rowsRead: HISTORICAL_BILLED_READ_LIMIT,
    rowsWritten: 0,
    observedUsage: usage,
    now: startedAt,
    expectedUtcDay: utcDay,
  });
  return {
    phase,
    backupDir,
    runner,
    clock,
    startedAt,
    completedAt: startedAt,
    utcDay,
    sourceProvider,
    sourceBefore,
    sourceIdentity,
    operationId,
    usage,
  };
}

function finishHistoricalOperation(operation: HistoricalOperation, rowsRead: number) {
  const exactAt = readHistoricalClock(operation.clock, `${operation.phase} exact reservation`);
  const ledger = reserveD1ReleaseBudget({
    backupDir: operation.backupDir,
    operationId: operation.operationId,
    operation: historicalOperationName(operation.phase),
    sourceFingerprint: operation.sourceIdentity,
    phase: "exact",
    rowsRead,
    rowsWritten: 0,
    observedUsage: operation.usage,
    now: exactAt,
    expectedUtcDay: operation.utcDay,
  });
  operation.completedAt = readHistoricalClock(operation.clock, `${operation.phase} completion`);
  assertD1ReleaseBudgetUtcDay(operation.utcDay, operation.completedAt);
  assertD1ReleaseBudgetReservation({
    ledgerPath: ledger.ledgerPath,
    utcDay: operation.utcDay,
    operationId: operation.operationId,
    sourceFingerprint: operation.sourceIdentity,
    phase: "exact",
    rowsRead,
    rowsWritten: 0,
    now: operation.completedAt,
  });
  const sourceAtCompletion = operation.sourceProvider();
  assertValidSourceFingerprint(sourceAtCompletion);
  assertSameSource(operation.sourceBefore, sourceAtCompletion);
  return ledger;
}

function historicalOperationName(phase: "baseline" | "verification") {
  return phase === "baseline"
    ? "Historical production data baseline capture"
    : "Historical production data preservation verification";
}

function compactSourceFingerprint(source: SourceFingerprint): D1ReleaseSourceIdentity {
  return { sha256: source.sha256, fileCount: source.fileCount };
}

function readHistoricalClock(clock: HistoricalClock, label: string) {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`Historical preservation requires a valid ${label} clock.`);
  }
  return value;
}

function runCli() {
  if (!hasFlag("--confirm-production")) {
    throw new Error("Historical data preservation requires --confirm-production.");
  }
  const secret = requireHistoricalHmacSecret(
    process.env.HISTORICAL_DATA_PRESERVATION_HMAC_SECRET ?? "",
  );
  const backupDir = resolveBackupDir();
  if (hasFlag("--capture-baseline")) {
    const report = createHistoricalDataBaseline({ backupDir, hmacSecret: secret });
    console.log(JSON.stringify({
      kind: report.kind,
      phase: report.phase,
      ok: report.ok,
      createdAt: report.createdAt,
      utcDay: report.utcDay,
      operationId: report.operationId,
      reportPath: writeHistoricalDataReport(backupDir, report),
    }, null, 2));
    return;
  }
  if (hasFlag("--verify-preservation")) {
    const baseline = readAndValidateHistoricalDataBaseline({
      backupDir,
      maximumAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
    });
    const report = verifyHistoricalDataPreservation({
      baseline,
      backupDir,
      hmacSecret: secret,
      maximumBaselineAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
    });
    console.log(JSON.stringify({
      kind: report.kind,
      phase: report.phase,
      ok: report.ok,
      createdAt: report.createdAt,
      utcDay: report.utcDay,
      operationId: report.operationId,
      problemCount: report.problems.length,
      reportPath: writeHistoricalDataReport(backupDir, report),
    }, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Choose exactly one of --capture-baseline or --verify-preservation.");
}

function executeD1ReadOnly(sql: string, runner: WranglerRunner) {
  const output = runner([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  const value = parseJsonOutput(output);
  if (!Array.isArray(value)) throw new Error("Historical preservation D1 output is malformed.");
  const resultSets: Array<Array<Record<string, unknown>>> = [];
  let rowsRead = 0;
  let rowsWritten = 0;
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || entry.success !== true || !Array.isArray(entry.results)) {
      throw new Error(`Historical preservation D1 result set ${index + 1} failed.`);
    }
    const rows = entry.results;
    if (!rows.every(isRecord)) {
      throw new Error(`Historical preservation D1 result set ${index + 1} has malformed rows.`);
    }
    const meta = isRecord(entry.meta) ? entry.meta : null;
    const read = nonNegativeInteger(meta?.rows_read);
    const written = nonNegativeInteger(meta?.rows_written);
    if (read === null || written === null) {
      throw new Error(`Historical preservation D1 result set ${index + 1} lacks billing metadata.`);
    }
    rowsRead += read;
    rowsWritten += written;
    resultSets.push(rows);
  }
  if (rowsWritten !== 0) {
    throw new Error("Historical preservation read-only query unexpectedly wrote rows.");
  }
  return { resultSets, rowsRead, rowsWritten: 0 };
}

function parseDatasetCounts(rows: Array<Record<string, unknown>>) {
  const counts: Partial<Record<HistoricalDatasetName, number>> = {};
  for (const row of rows) {
    if (!isHistoricalDatasetName(row.dataset)) {
      throw new Error("Historical preservation summary returned an unknown dataset.");
    }
    const name = row.dataset;
    if (Object.hasOwn(counts, name)) {
      throw new Error(`Historical preservation summary duplicated ${name}.`);
    }
    const count = nonNegativeInteger(row.row_count);
    if (count === null) throw new Error(`Historical preservation ${name} count is invalid.`);
    counts[name] = count;
  }
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!Object.hasOwn(counts, name)) throw new Error(`Historical preservation summary omitted ${name}.`);
  }
  assertCompleteDatasetCounts(counts);
  return counts;
}

function parseSchemaColumns(rows: Array<Record<string, unknown>>) {
  const schemas: Record<string, HistoricalColumnIdentity[]> = {};
  for (const row of rows) {
    if (!isCoreTableName(row.table_name)) {
      throw new Error("Historical preservation schema returned an unknown table.");
    }
    if (typeof row.name !== "string" || typeof row.type !== "string") {
      throw new Error("Historical preservation schema returned an invalid column.");
    }
    const notNull = row.not_null === 0 || row.not_null === 1 ? row.not_null : null;
    const primaryKey = nonNegativeInteger(row.primary_key);
    if (notNull === null || primaryKey === null) {
      throw new Error("Historical preservation schema returned invalid column flags.");
    }
    (schemas[row.table_name] ??= []).push({
      name: row.name,
      type: row.type.toLowerCase(),
      notNull,
      primaryKey,
    });
  }
  return schemas;
}

function identityValues(row: Record<string, unknown>) {
  const values: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const key = `identity_${index}`;
    if (!Object.hasOwn(row, key)) continue;
    const value = row[key];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error("Historical preservation identity contains an invalid value.");
    }
    values.push(String(value));
  }
  if (values.length === 0) throw new Error("Historical preservation identity is empty.");
  return values;
}

function hmacIdentity(secret: string, dataset: HistoricalDatasetName, values: string[]) {
  return createHmac("sha256", secret)
    .update(dataset)
    .update("\0")
    .update(stableStringify(values))
    .digest("hex");
}

function schemaHash(columns: HistoricalColumnIdentity[]) {
  return createHash().update(stableStringify(columns.map(columnIdentity))).digest("hex");
}

function columnIdentity(column: HistoricalColumnIdentity) {
  return `${column.name}\0${column.type}\0${column.notNull}\0${column.primaryKey}`;
}

function publicDatasets(datasets: Record<HistoricalDatasetName, CapturedDataset>) {
  const result: Partial<Record<HistoricalDatasetName, HistoricalDatasetEvidence>> = {};
  for (const name of HISTORICAL_DATASET_NAMES) {
    const { identityHashes: _identityHashes, ...evidence } = datasets[name];
    void _identityHashes;
    result[name] = evidence;
  }
  assertCompletePublicDatasets(result);
  return result;
}

function validateHistoricalDataBaselineReport(
  value: unknown,
  options: {
    backupDir: string;
    expectedSourceFingerprint: SourceFingerprint;
    now: Date;
    maximumAgeMs: number;
    requireLiveLedger: boolean;
  },
): HistoricalDataBaselineReport {
  const parsed = historicalBaselineSchema.parse(value);
  const backupDir = path.resolve(options.backupDir);
  if (path.resolve(parsed.backupDir) !== backupDir) {
    throw new Error("Historical preservation baseline targets the wrong private backup directory.");
  }
  if (!Number.isSafeInteger(options.maximumAgeMs) || options.maximumAgeMs <= 0) {
    throw new Error("Historical preservation baseline freshness limit is invalid.");
  }
  if (!Number.isFinite(options.now.getTime())) {
    throw new Error("Historical preservation baseline freshness clock is invalid.");
  }
  const createdAtMs = Date.parse(parsed.createdAt);
  const ageMs = options.now.getTime() - createdAtMs;
  if (ageMs < 0 || ageMs > options.maximumAgeMs) {
    throw new Error("Historical preservation baseline is stale or from the future.");
  }
  if (parsed.createdAt.slice(0, 10) !== parsed.utcDay) {
    throw new Error("Historical preservation baseline UTC day does not match its timestamp.");
  }
  assertValidSourceFingerprint(parsed.sourceFingerprint);
  assertValidSourceFingerprint(options.expectedSourceFingerprint);
  assertSameSource(parsed.sourceFingerprint, options.expectedSourceFingerprint);
  const expectedOperationId = historicalDataBudgetOperationId(
    "baseline",
    compactSourceFingerprint(parsed.sourceFingerprint),
  );
  if (parsed.operationId !== expectedOperationId) {
    throw new Error("Historical preservation baseline has the wrong source-bound operation ID.");
  }
  validateHistoricalDatasets(parsed.datasets);
  validateHistoricalBaselineLedger(parsed, backupDir);
  if (options.requireLiveLedger) {
    assertD1ReleaseBudgetReservation({
      ledgerPath: parsed.ledger.ledgerPath,
      utcDay: parsed.utcDay,
      operationId: parsed.operationId,
      sourceFingerprint: compactSourceFingerprint(parsed.sourceFingerprint),
      phase: "exact",
      rowsRead: parsed.rowsRead,
      rowsWritten: 0,
      now: options.now,
    });
  }
  return parsed;
}

function validateHistoricalDatasets(
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>,
) {
  for (const spec of datasetSpecs) {
    const dataset = datasets[spec.name];
    if (dataset.schemaTable !== spec.table) {
      throw new Error(`Historical preservation baseline ${spec.name} targets the wrong schema table.`);
    }
    if (dataset.rowCount > spec.cap) {
      throw new Error(`Historical preservation baseline ${spec.name} exceeds its row cap.`);
    }
    if (new Set(dataset.columns.map((column) => column.name)).size !== dataset.columns.length) {
      throw new Error(`Historical preservation baseline ${spec.name} has duplicate schema columns.`);
    }
    if (schemaHash(dataset.columns) !== dataset.schemaSha256) {
      throw new Error(`Historical preservation baseline ${spec.name} schema identity is invalid.`);
    }
    const expectedSentinels = Math.min(dataset.rowCount, HISTORICAL_SENTINEL_LIMIT);
    if (
      dataset.sentinels.length !== expectedSentinels ||
      new Set(dataset.sentinels).size !== dataset.sentinels.length
    ) {
      throw new Error(`Historical preservation baseline ${spec.name} sentinels are incomplete.`);
    }
  }
  for (const name of historicalRequiredNonemptyDatasets) {
    if (datasets[name].rowCount === 0) {
      throw new Error(
        `Historical preservation refuses an empty or wrong production database: ${name} has no rows.`,
      );
    }
  }
  const coreRows = coreTableNames.reduce((sum, table) => sum + datasets[table].rowCount, 0);
  if (coreRows > HISTORICAL_CORE_ROW_LIMIT) {
    throw new Error("Historical preservation baseline exceeds its core-row limit.");
  }
}

function validateHistoricalBaselineLedger(
  baseline: HistoricalDataBaselineReport,
  backupDir: string,
) {
  const reservation = baseline.ledger.reservation;
  const expectedLedgerPath = path.join(
    backupDir,
    "cloudflare",
    `d1-release-budget-ledger-${baseline.utcDay}.json`,
  );
  if (
    path.resolve(baseline.ledger.ledgerPath) !== expectedLedgerPath ||
    baseline.ledger.utcDay !== baseline.utcDay ||
    reservation.operationId !== baseline.operationId ||
    reservation.operation !== historicalOperationName("baseline") ||
    reservation.rowsRead !== baseline.rowsRead ||
    Date.parse(reservation.updatedAt) < Date.parse(reservation.createdAt) ||
    reservation.createdAt.slice(0, 10) !== baseline.utcDay ||
    reservation.updatedAt.slice(0, 10) !== baseline.utcDay
  ) {
    throw new Error("Historical preservation baseline ledger linkage is invalid.");
  }
}

function assertValidSourceFingerprint(source: SourceFingerprint) {
  const parsed = sourceFingerprintSchema.parse(source);
  if (parsed.fileCount !== parsed.files.length) {
    throw new Error("Historical preservation source fingerprint file count is invalid.");
  }
  const sortedFiles = [...parsed.files].map((entry) => entry.file).sort();
  for (const [index, entry] of parsed.files.entries()) {
    if (
      entry.file !== sortedFiles[index] ||
      path.posix.isAbsolute(entry.file) ||
      entry.file.includes("\\") ||
      path.posix.normalize(entry.file) !== entry.file ||
      entry.file.startsWith("../") ||
      /[\u0000-\u001f\u007f]/.test(entry.file)
    ) {
      throw new Error("Historical preservation source fingerprint contains an unsafe file path.");
    }
  }
  const hash = createHash();
  for (const entry of parsed.files) {
    hash.update(`${entry.file}\0${entry.bytes}\0${entry.sha256}\n`);
  }
  if (hash.digest("hex") !== parsed.sha256) {
    throw new Error("Historical preservation source fingerprint contents do not match its SHA-256.");
  }
}

function assertSameSource(left: SourceFingerprint, right: SourceFingerprint) {
  if (left.sha256 !== right.sha256 || left.fileCount !== right.fileCount) {
    throw new Error("Historical preservation evidence source fingerprint changed.");
  }
}

function requireHistoricalHmacSecret(value: string) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 32 || bytes > 512) {
    throw new Error("HISTORICAL_DATA_PRESERVATION_HMAC_SECRET must contain 32 to 512 UTF-8 bytes.");
  }
  return value;
}

function ensureHistoricalEvidenceDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Historical preservation evidence directory must be a real directory.");
  }
  fs.chmodSync(directory, 0o700);
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function assertCompleteCapturedDatasets(
  datasets: Partial<Record<HistoricalDatasetName, CapturedDataset>>,
): asserts datasets is Record<HistoricalDatasetName, CapturedDataset> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!datasets[name]) throw new Error(`Historical preservation capture omitted ${name}.`);
  }
}

function assertCompletePublicDatasets(
  datasets: Partial<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
): asserts datasets is Record<HistoricalDatasetName, HistoricalDatasetEvidence> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!datasets[name]) throw new Error(`Historical preservation evidence omitted ${name}.`);
  }
}

function assertCompleteDatasetCounts(
  counts: Partial<Record<HistoricalDatasetName, number>>,
): asserts counts is Record<HistoricalDatasetName, number> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (counts[name] === undefined) {
      throw new Error(`Historical preservation summary omitted ${name}.`);
    }
  }
}

function isHistoricalDatasetName(value: unknown): value is HistoricalDatasetName {
  return typeof value === "string" && HISTORICAL_DATASET_NAMES.some((name) => name === value);
}

function isCoreTableName(value: unknown): value is (typeof coreTableNames)[number] {
  return typeof value === "string" && coreTableNames.some((name) => name === value);
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first < 0 || last <= first) throw new Error("Historical preservation could not parse Wrangler JSON.");
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
