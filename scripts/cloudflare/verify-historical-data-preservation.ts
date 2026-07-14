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
import {
  createHistoricalDataHmacKey,
  historicalDataHmacKeyId,
  readHistoricalDataHmacKey,
  requireHistoricalHmacSecret,
} from "./historical-data-hmac-key";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

export { historicalDataHmacKeyId } from "./historical-data-hmac-key";

export const HISTORICAL_DATA_LEGACY_PRESERVATION_KIND =
  "inspir-historical-data-preservation-v1" as const;
export const HISTORICAL_DATA_PRESERVATION_KIND =
  "inspir-historical-data-preservation-v2" as const;
export const HISTORICAL_DATA_BASELINE_RELATIVE_PATH =
  "cloudflare/historical-data-preservation-baseline.json" as const;
export const HISTORICAL_DATA_VERIFICATION_RELATIVE_PATH =
  "cloudflare/historical-data-preservation-verification.json" as const;
export const HISTORICAL_SENTINEL_LIMIT = 16;
export const HISTORICAL_CORE_ROW_LIMIT = 350_000;
export const HISTORICAL_SUPPLEMENTAL_ROW_LIMIT = 125_000;
export const HISTORICAL_OPERATIONAL_ROW_LIMIT = 10_000;
export const HISTORICAL_SCHEMA_COLUMN_LIMIT = 256;
export const HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT = 750_000;
// One logical snapshot is bounded below this cushion. Cloudflare may
// transparently execute a read-only statement up to three times, so release
// admission must reserve the separate worst-case billable ceiling below.
export const HISTORICAL_BILLED_READ_LIMIT = 750_000;
export const HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS = 3;
export const HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT = 2_250_000;
export const HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ = 690_209;
if (
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT !==
  HISTORICAL_BILLED_READ_LIMIT *
    HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS
) {
  throw new Error(
    "Historical preservation automatic-retry reservation is inconsistent.",
  );
}
export const HISTORICAL_DATA_COUNT_RESULT_SET_COUNT = 21;
export const HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT = 19;
export const HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT = 20;
export const HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT =
  HISTORICAL_DATA_COUNT_RESULT_SET_COUNT +
  HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT +
  HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT;
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

// Kept separate from HISTORICAL_DATASET_NAMES so the immutable one-release
// rollover bridge can compare its older ten-dataset V1 baseline. Every newly
// captured V2 baseline requires this extended learner-data graph.
export const HISTORICAL_SUPPLEMENTAL_DATASET_NAMES = [
  "ai_runs",
  "user_memory_graph_edges",
  "user_memory_settings",
  "chat_memory_summaries",
  "chat_memory_turns",
  "user_memory_profiles",
  "user_memory_summaries",
  "memory_synthesis_runs",
  "memory_source_feedback",
  "memory_events",
] as const;

export type HistoricalSupplementalDatasetName =
  (typeof HISTORICAL_SUPPLEMENTAL_DATASET_NAMES)[number];

export const HISTORICAL_OPERATIONAL_DATASET_NAMES = [
  "memory_vector_cleanup_outbox",
] as const;

export type HistoricalOperationalDatasetName =
  (typeof HISTORICAL_OPERATIONAL_DATASET_NAMES)[number];
type HistoricalProtectedDatasetName =
  | HistoricalDatasetName
  | HistoricalSupplementalDatasetName;
type HistoricalSnapshotDatasetName =
  | HistoricalProtectedDatasetName
  | HistoricalOperationalDatasetName;

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

export type HistoricalOperationalDatasetEvidence = {
  lifecycle: "mutable-drainable-outbox";
  rowCount: number;
  schemaTable: "memory_vector_cleanup_outbox";
  schemaSha256: string;
  columns: HistoricalColumnIdentity[];
};

export type HistoricalDataBaselineReport = {
  kind: typeof HISTORICAL_DATA_PRESERVATION_KIND;
  schemaVersion: 2;
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
    supplementalRows: number;
    operationalRows: number;
    logicalSnapshotRowsRead: number;
    logicalRowsReadLimit: number;
    maximumAutomaticReadAttempts: number;
    billableRowsReadReservation: number;
    sentinelsPerDataset: number;
  };
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >;
  operationalDatasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >;
};

export type HistoricalDataLegacyBaselineReport = Omit<
  HistoricalDataBaselineReport,
  "kind" | "schemaVersion" | "limits" | "supplementalDatasets" | "operationalDatasets"
> & {
  kind: typeof HISTORICAL_DATA_LEGACY_PRESERVATION_KIND;
  schemaVersion: 1;
  limits: {
    coreRows: number;
    billedReads: number;
    sentinelsPerDataset: number;
  };
};

export type HistoricalDataVerificationReport = {
  kind: typeof HISTORICAL_DATA_PRESERVATION_KIND;
  schemaVersion: 2;
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
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >;
  operationalDatasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >;
};

type CapturedDataset = HistoricalDatasetEvidence & {
  identityHashes: Set<string>;
};

type HistoricalCapture = {
  rowsRead: number;
  rowsWritten: 0;
  hmacKeyId: string;
  datasets: Record<HistoricalDatasetName, CapturedDataset>;
  supplementalDatasets: Record<HistoricalSupplementalDatasetName, CapturedDataset>;
  operationalDatasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >;
};

type HistoricalClock = () => Date;

type HistoricalUsageLoader = (
  now: Date,
  runner: WranglerRunner,
  clock: HistoricalClock,
) => D1DailyUsage;

export type HistoricalBeforeSnapshotContext = Readonly<{
  phase: "baseline";
  backupDir: string;
  startedAt: Date;
  utcDay: string;
  operationId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  maximumRowsRead: typeof HISTORICAL_BILLED_READ_LIMIT;
  maximumAutomaticReadAttempts: typeof HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS;
  maximumBillableRowsRead: typeof HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT;
}>;

type HistoricalOperationOptions = {
  backupDir: string;
  hmacSecret: string;
  cwd?: string;
  runner?: WranglerRunner;
  clock?: HistoricalClock;
  usageLoader?: HistoricalUsageLoader;
  sourceFingerprint?: SourceFingerprint;
  sourceFingerprintProvider?: () => SourceFingerprint;
  beforeSnapshot?: (context: HistoricalBeforeSnapshotContext) => void;
  allowProvenPreSnapshotReservationReplay?: boolean;
};

export type ReadHistoricalDataBaselineOptions = {
  backupDir: string;
  cwd?: string;
  expectedSourceFingerprint?: SourceFingerprint;
  now?: Date;
  maximumAgeMs?: number;
};

type DatasetSpec<Name extends HistoricalSnapshotDatasetName = HistoricalSnapshotDatasetName> = {
  name: Name;
  table: string;
  cap: number;
  identityArity: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  identitySql: string;
};

type CountDatasetSpec<Name extends HistoricalSnapshotDatasetName = HistoricalSnapshotDatasetName> = {
  name: Name;
  table: string;
  cap: number;
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

const supplementalTableNames = [
  "ai_runs",
  "user_memory_settings",
  "chat_memory_summaries",
  "chat_memory_turns",
  "user_memory_profiles",
  "user_memory_summaries",
  "memory_synthesis_runs",
  "memory_source_feedback",
  "memory_events",
] as const;

const operationalTableNames = ["memory_vector_cleanup_outbox"] as const;

const historicalUsersRowLimit = 100_000;

const coreDatasetSpecs: readonly DatasetSpec<HistoricalDatasetName>[] = [
  { name: "users", table: "users", cap: historicalUsersRowLimit, identityArity: 1, identitySql: "SELECT id AS identity_1 FROM users ORDER BY rowid LIMIT 16;" },
  { name: "accounts", table: "accounts", cap: 25_000, identityArity: 3, identitySql: "SELECT provider AS identity_1, provider_account_id AS identity_2, user_id AS identity_3 FROM accounts ORDER BY rowid LIMIT 16;" },
  { name: "sessions", table: "sessions", cap: 25_000, identityArity: 2, identitySql: "SELECT session_token AS identity_1, user_id AS identity_2 FROM sessions ORDER BY rowid LIMIT 16;" },
  { name: "chats", table: "chats", cap: 25_000, identityArity: 2, identitySql: "SELECT id AS identity_1, coalesce(user_id, '') AS identity_2 FROM chats ORDER BY rowid LIMIT 16;" },
  { name: "messages", table: "messages", cap: 75_000, identityArity: 2, identitySql: "SELECT id AS identity_1, chat_id AS identity_2 FROM messages ORDER BY rowid LIMIT 16;" },
  { name: "admin_users", table: "admin_users", cap: 1_000, identityArity: 1, identitySql: "SELECT email AS identity_1 FROM admin_users ORDER BY rowid LIMIT 16;" },
  { name: "user_memories", table: "user_memories", cap: 25_000, identityArity: 2, identitySql: "SELECT id AS identity_1, user_id AS identity_2 FROM user_memories ORDER BY rowid LIMIT 16;" },
  { name: "activity_runs", table: "activity_runs", cap: 24_000, identityArity: 2, identitySql: "SELECT id AS identity_1, chat_id AS identity_2 FROM activity_runs ORDER BY rowid LIMIT 16;" },
  { name: "product_events", table: "product_events", cap: 50_000, identityArity: 2, identitySql: "SELECT id AS identity_1, coalesce(user_id, '') AS identity_2 FROM product_events ORDER BY rowid LIMIT 16;" },
  {
    name: "profile_photo_pointers",
    table: "users",
    cap: historicalUsersRowLimit,
    identityArity: 4,
    identitySql:
      `SELECT id AS identity_1, coalesce(profile_image_r2_key, '') AS identity_2, coalesce(profile_image_hash, '') AS identity_3, coalesce(profile_image_r2_etag, '') AS identity_4 FROM (SELECT rowid AS bounded_rowid, id, profile_image_r2_key, profile_image_hash, profile_image_r2_etag FROM users ORDER BY rowid LIMIT ${historicalUsersRowLimit + 1}) WHERE profile_image_r2_key IS NOT NULL OR profile_image_hash IS NOT NULL OR profile_image_r2_etag IS NOT NULL ORDER BY bounded_rowid LIMIT 16;`,
  },
] as const;

const supplementalDatasetSpecs: readonly DatasetSpec<HistoricalSupplementalDatasetName>[] = [
  {
    name: "ai_runs",
    table: "ai_runs",
    cap: 20_000,
    identityArity: 3,
    identitySql: "SELECT id AS identity_1, chat_id AS identity_2, coalesce(user_message_id, '') AS identity_3 FROM ai_runs ORDER BY rowid LIMIT 16;",
  },
  {
    name: "user_memory_graph_edges",
    table: "user_memories",
    cap: 25_000,
    identityArity: 7,
    identitySql: "SELECT id AS identity_1, user_id AS identity_2, source_turn_ids AS identity_3, source_memory_ids AS identity_4, coalesce(source_chat_id, '') AS identity_5, coalesce(source_message_id, '') AS identity_6, coalesce(superseded_by_memory_id, '') AS identity_7 FROM user_memories ORDER BY rowid LIMIT 16;",
  },
  {
    name: "user_memory_settings",
    table: "user_memory_settings",
    cap: 10_000,
    identityArity: 1,
    identitySql: "SELECT user_id AS identity_1 FROM user_memory_settings ORDER BY rowid LIMIT 16;",
  },
  {
    name: "chat_memory_summaries",
    table: "chat_memory_summaries",
    cap: 10_000,
    identityArity: 2,
    identitySql: "SELECT chat_id AS identity_1, user_id AS identity_2 FROM chat_memory_summaries ORDER BY rowid LIMIT 16;",
  },
  {
    name: "chat_memory_turns",
    table: "chat_memory_turns",
    cap: 20_000,
    identityArity: 6,
    identitySql: "SELECT id AS identity_1, user_id AS identity_2, chat_id AS identity_3, coalesce(topic_id, '') AS identity_4, user_message_id AS identity_5, assistant_message_id AS identity_6 FROM chat_memory_turns ORDER BY rowid LIMIT 16;",
  },
  {
    name: "user_memory_profiles",
    table: "user_memory_profiles",
    cap: 10_000,
    identityArity: 2,
    identitySql: "SELECT user_id AS identity_1, category AS identity_2 FROM user_memory_profiles ORDER BY rowid LIMIT 16;",
  },
  {
    name: "user_memory_summaries",
    table: "user_memory_summaries",
    cap: 5_000,
    identityArity: 1,
    identitySql: "SELECT user_id AS identity_1 FROM user_memory_summaries ORDER BY rowid LIMIT 16;",
  },
  {
    name: "memory_synthesis_runs",
    table: "memory_synthesis_runs",
    cap: 10_000,
    identityArity: 2,
    identitySql: "SELECT id AS identity_1, user_id AS identity_2 FROM memory_synthesis_runs ORDER BY rowid LIMIT 16;",
  },
  {
    name: "memory_source_feedback",
    table: "memory_source_feedback",
    cap: 5_000,
    identityArity: 6,
    identitySql: "SELECT id AS identity_1, user_id AS identity_2, coalesce(ai_run_id, '') AS identity_3, coalesce(memory_id, '') AS identity_4, coalesce(chat_turn_id, '') AS identity_5, coalesce(summary_section_id, '') AS identity_6 FROM memory_source_feedback ORDER BY rowid LIMIT 16;",
  },
  {
    name: "memory_events",
    table: "memory_events",
    cap: 10_000,
    identityArity: 5,
    identitySql: "SELECT id AS identity_1, user_id AS identity_2, coalesce(memory_id, '') AS identity_3, coalesce(chat_id, '') AS identity_4, coalesce(message_id, '') AS identity_5 FROM memory_events ORDER BY rowid LIMIT 16;",
  },
] as const;

const datasetSpecs: readonly DatasetSpec<HistoricalProtectedDatasetName>[] = [
  ...coreDatasetSpecs,
  ...supplementalDatasetSpecs,
];
const operationalDatasetSpecs: readonly CountDatasetSpec<HistoricalOperationalDatasetName>[] = [
  {
    name: "memory_vector_cleanup_outbox",
    table: "memory_vector_cleanup_outbox",
    cap: HISTORICAL_OPERATIONAL_ROW_LIMIT,
  },
] as const;
const countDatasetSpecs: readonly CountDatasetSpec[] = [
  ...datasetSpecs,
  ...operationalDatasetSpecs,
];
const snapshotTableNames = [
  ...coreTableNames,
  ...supplementalTableNames,
  ...operationalTableNames,
] as const;
const usersDatasetSpec = coreDatasetSpecs.find((spec) => spec.name === "users");
if (!usersDatasetSpec) {
  throw new Error("Historical preservation snapshot plan is missing the users dataset.");
}
const countedCoreCap = coreDatasetSpecs
  .filter((spec) => spec.name !== "profile_photo_pointers")
  .reduce((sum, spec) => sum + spec.cap, 0);
const countedSupplementalCap = supplementalDatasetSpecs.reduce(
  (sum, spec) => sum + spec.cap,
  0,
);
if (
  countedCoreCap !== HISTORICAL_CORE_ROW_LIMIT ||
  countedSupplementalCap !== HISTORICAL_SUPPLEMENTAL_ROW_LIMIT
) {
  throw new Error("Historical preservation row caps do not match the V2 aggregate limits.");
}

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
const historicalOperationalDatasetSchema = historicalDatasetSchema
  .omit({ sentinels: true })
  .extend({
    lifecycle: z.literal("mutable-drainable-outbox"),
    schemaTable: z.literal("memory_vector_cleanup_outbox"),
  })
  .strict();
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
  maximumRowsRead: z.literal(
    HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  ),
  maximumRowsWritten: z.literal(0),
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
}).strict();
const historicalLegacyLedgerReservationSchema = historicalLedgerReservationSchema.extend({
  maximumRowsRead: z.literal(HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT),
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
const historicalLegacyLedgerResultSchema = historicalLedgerResultSchema.extend({
  reservation: historicalLegacyLedgerReservationSchema,
}).strict();
const historicalBaselineSchema = z.object({
  kind: z.literal(HISTORICAL_DATA_PRESERVATION_KIND),
  schemaVersion: z.literal(2),
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
    supplementalRows: z.literal(HISTORICAL_SUPPLEMENTAL_ROW_LIMIT),
    operationalRows: z.literal(HISTORICAL_OPERATIONAL_ROW_LIMIT),
    logicalSnapshotRowsRead: z.literal(
      HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    ),
    logicalRowsReadLimit: z.literal(HISTORICAL_BILLED_READ_LIMIT),
    maximumAutomaticReadAttempts: z.literal(
      HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
    ),
    billableRowsReadReservation: z.literal(
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    ),
    sentinelsPerDataset: z.literal(HISTORICAL_SENTINEL_LIMIT),
  }).strict(),
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), historicalDatasetSchema),
  supplementalDatasets: z.record(
    z.enum(HISTORICAL_SUPPLEMENTAL_DATASET_NAMES),
    historicalDatasetSchema,
  ),
  operationalDatasets: z.record(
    z.enum(HISTORICAL_OPERATIONAL_DATASET_NAMES),
    historicalOperationalDatasetSchema,
  ),
}).strict();
const historicalLegacyBaselineSchema = historicalBaselineSchema
  .omit({
    kind: true,
    schemaVersion: true,
    limits: true,
    ledger: true,
    supplementalDatasets: true,
    operationalDatasets: true,
  })
  .extend({
    kind: z.literal(HISTORICAL_DATA_LEGACY_PRESERVATION_KIND),
    schemaVersion: z.literal(1),
    ledger: historicalLegacyLedgerResultSchema,
    limits: z.object({
      coreRows: z.literal(HISTORICAL_CORE_ROW_LIMIT),
      billedReads: z.literal(HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT),
      sentinelsPerDataset: z.literal(HISTORICAL_SENTINEL_LIMIT),
    }).strict(),
  })
  .strict();

const historicalDataCountStatements = countDatasetSpecs.map((spec) =>
  spec.name === "profile_photo_pointers"
    ? `SELECT '${spec.name}' AS dataset, count(*) AS row_count FROM (SELECT profile_image_r2_key, profile_image_hash, profile_image_r2_etag FROM users ORDER BY rowid LIMIT ${usersDatasetSpec.cap + 1}) WHERE profile_image_r2_key IS NOT NULL OR profile_image_hash IS NOT NULL OR profile_image_r2_etag IS NOT NULL;`
    : `SELECT '${spec.name}' AS dataset, count(*) AS row_count FROM (SELECT 1 FROM ${spec.table} ORDER BY rowid LIMIT ${spec.cap + 1});`,
);

const historicalDataSchemaStatements = snapshotTableNames.map(
  (table) =>
    `SELECT '${table}' AS table_name, name, lower(type) AS type, "notnull" AS not_null, pk AS primary_key FROM pragma_table_info('${table}') ORDER BY primary_key DESC, name LIMIT ${HISTORICAL_SCHEMA_COLUMN_LIMIT + 1};`,
);

const historicalDataIdentityStatements = datasetSpecs.map((spec) => spec.identitySql);

if (
  historicalDataCountStatements.length !== HISTORICAL_DATA_COUNT_RESULT_SET_COUNT ||
  historicalDataSchemaStatements.length !== HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT ||
  historicalDataIdentityStatements.length !== HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT
) {
  throw new Error("Historical preservation snapshot plan has an invalid result-set partition.");
}

export const HISTORICAL_DATA_SUMMARY_SQL = [
  ...historicalDataCountStatements,
  ...historicalDataSchemaStatements,
].join("\n");

export const HISTORICAL_DATA_IDENTITIES_SQL = historicalDataIdentityStatements.join("\n");

export const HISTORICAL_DATA_SNAPSHOT_SQL = [
  HISTORICAL_DATA_SUMMARY_SQL,
  HISTORICAL_DATA_IDENTITIES_SQL,
].join("\n");

const historicalCountScanMaximum = countDatasetSpecs.reduce(
  (sum, spec) =>
    sum + (spec.name === "profile_photo_pointers" ? usersDatasetSpec.cap + 1 : spec.cap + 1),
  0,
);
const historicalSchemaScanMaximum =
  snapshotTableNames.length * (HISTORICAL_SCHEMA_COLUMN_LIMIT + 1);
const historicalIdentityScanMaximum = datasetSpecs.reduce(
  (sum, spec) =>
    sum + (spec.name === "profile_photo_pointers" ? usersDatasetSpec.cap + 1 : HISTORICAL_SENTINEL_LIMIT),
  0,
);
const calculatedHistoricalDataSnapshotMaxRowsRead =
  historicalCountScanMaximum +
  historicalSchemaScanMaximum +
  historicalIdentityScanMaximum;
if (
  calculatedHistoricalDataSnapshotMaxRowsRead !==
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ
) {
  throw new Error(
    `Historical preservation V2 snapshot bound changed: ${calculatedHistoricalDataSnapshotMaxRowsRead} !== ${HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ}.`,
  );
}
if (HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ > HISTORICAL_BILLED_READ_LIMIT) {
  throw new Error(
    `Historical preservation V2 snapshot bound exceeds its pre-read reservation: ${HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ} > ${HISTORICAL_BILLED_READ_LIMIT}.`,
  );
}

export const HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256 = createHash()
  .update(stableStringify({
    kind: HISTORICAL_DATA_PRESERVATION_KIND,
    schemaVersion: 2,
    snapshotSql: HISTORICAL_DATA_SNAPSHOT_SQL,
    logicalSnapshotRowsRead: HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    logicalRowsReadLimit: HISTORICAL_BILLED_READ_LIMIT,
    maximumAutomaticReadAttempts:
      HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
    billableRowsReadReservation:
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  }))
  .digest("hex");

assertHistoricalDataSnapshotSql(HISTORICAL_DATA_SNAPSHOT_SQL);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Historical data preservation failed.",
    );
    process.exitCode = 1;
  });
}

function captureHistoricalDataSnapshot(options: {
  hmacSecret: string;
  runner?: WranglerRunner;
}): HistoricalCapture {
  const secret = requireHistoricalHmacSecret(options.hmacSecret);
  const runner = options.runner ?? runWrangler;
  const snapshot = executeD1ReadOnly(HISTORICAL_DATA_SNAPSHOT_SQL, runner);
  if (snapshot.resultSets.length !== HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT) {
    throw new Error("Historical preservation snapshot returned an unexpected result-set count.");
  }
  const countResultSets = snapshot.resultSets.slice(0, HISTORICAL_DATA_COUNT_RESULT_SET_COUNT);
  const schemaStart = HISTORICAL_DATA_COUNT_RESULT_SET_COUNT;
  const schemaEnd = schemaStart + HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT;
  const schemaResultSets = snapshot.resultSets.slice(schemaStart, schemaEnd);
  const identityResultSets = snapshot.resultSets.slice(schemaEnd);
  const countRows = countResultSets.map((rows, index) => {
    const expected = countDatasetSpecs[index];
    if (rows.length !== 1) {
      throw new Error(
        `Historical preservation ${expected?.name ?? "unknown"} count returned an unexpected row count.`,
      );
    }
    const row = rows[0] ?? {};
    if (
      !expected ||
      row.dataset !== expected.name ||
      !hasExactKeys(row, ["dataset", "row_count"])
    ) {
      throw new Error("Historical preservation count result order or shape is invalid.");
    }
    return row;
  });
  for (const [index, rows] of schemaResultSets.entries()) {
    const expectedTable = snapshotTableNames[index];
    if (
      !expectedTable ||
      rows.length === 0 ||
      rows.length > HISTORICAL_SCHEMA_COLUMN_LIMIT
    ) {
      throw new Error("Historical preservation schema result order or cardinality is invalid.");
    }
    for (const row of rows) {
      if (
        row.table_name !== expectedTable ||
        !hasExactKeys(row, ["table_name", "name", "type", "not_null", "primary_key"])
      ) {
        throw new Error("Historical preservation schema result order or shape is invalid.");
      }
    }
  }
  const counts = parseDatasetCounts(countRows);
  const columns = parseSchemaColumns(schemaResultSets.flat());
  const coreRows = coreTableNames.reduce((sum, table) => sum + counts[table], 0);
  if (coreRows > HISTORICAL_CORE_ROW_LIMIT) {
    throw new Error(
      `Historical preservation core rows exceed the Free-plan cap: ${coreRows} > ${HISTORICAL_CORE_ROW_LIMIT}.`,
    );
  }
  const supplementalRows = HISTORICAL_SUPPLEMENTAL_DATASET_NAMES.reduce(
    (sum, name) => sum + counts[name],
    0,
  );
  if (supplementalRows > HISTORICAL_SUPPLEMENTAL_ROW_LIMIT) {
    throw new Error(
      `Historical preservation supplemental rows exceed the Free-plan cap: ${supplementalRows} > ${HISTORICAL_SUPPLEMENTAL_ROW_LIMIT}.`,
    );
  }
  for (const spec of datasetSpecs) {
    if (counts[spec.name] > spec.cap) {
      throw new Error(
        `Historical preservation ${spec.name} rows exceed its cap: ${counts[spec.name]} > ${spec.cap}.`,
      );
    }
  }
  for (const spec of operationalDatasetSpecs) {
    if (counts[spec.name] > spec.cap) {
      throw new Error(
        `Historical preservation ${spec.name} rows exceed its operational cap: ${counts[spec.name]} > ${spec.cap}.`,
      );
    }
  }
  const rowsRead = snapshot.rowsRead;
  if (rowsRead > HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ) {
    throw new Error(
      `Historical preservation billed reads exceed the proven V2 snapshot bound: ${rowsRead} > ${HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ}.`,
    );
  }

  const datasets: Partial<Record<HistoricalProtectedDatasetName, CapturedDataset>> = {};
  for (const [index, spec] of datasetSpecs.entries()) {
    const rows = identityResultSets[index] ?? [];
    const expectedRows = Math.min(counts[spec.name], HISTORICAL_SENTINEL_LIMIT);
    if (rows.length !== expectedRows) {
      throw new Error(
        `Historical preservation ${spec.name} sentinel cardinality mismatch: ${rows.length}/${expectedRows}.`,
      );
    }
    const expectedIdentityKeys = Array.from(
      { length: spec.identityArity },
      (_, identityIndex) => `identity_${identityIndex + 1}`,
    );
    if (rows.some((row) => !hasExactKeys(row, expectedIdentityKeys))) {
      throw new Error(`Historical preservation ${spec.name} identity shape is invalid.`);
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
  const core = coreCapturedDatasets(datasets);
  const supplemental = supplementalCapturedDatasets(datasets);
  const operational = operationalDatasetEvidence(counts, columns);
  validateHistoricalCrossDatasetInvariants(core, supplemental);
  return {
    rowsRead,
    rowsWritten: 0,
    hmacKeyId: historicalDataHmacKeyId(secret),
    datasets: core,
    supplementalDatasets: supplemental,
    operationalDatasets: operational,
  };
}

export function createHistoricalDataBaseline(
  options: HistoricalOperationOptions,
): HistoricalDataBaselineReport {
  const operation = startHistoricalOperation("baseline", options);
  options.beforeSnapshot?.({
    phase: "baseline",
    backupDir: operation.backupDir,
    startedAt: new Date(operation.startedAt),
    utcDay: operation.utcDay,
    operationId: operation.operationId,
    sourceFingerprint: { ...operation.sourceIdentity },
    maximumRowsRead: HISTORICAL_BILLED_READ_LIMIT,
    maximumAutomaticReadAttempts:
      HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
    maximumBillableRowsRead:
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  });
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
    schemaVersion: 2,
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
      supplementalRows: HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
      operationalRows: HISTORICAL_OPERATIONAL_ROW_LIMIT,
      logicalSnapshotRowsRead: HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      logicalRowsReadLimit: HISTORICAL_BILLED_READ_LIMIT,
      maximumAutomaticReadAttempts:
        HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
      billableRowsReadReservation:
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      sentinelsPerDataset: HISTORICAL_SENTINEL_LIMIT,
    },
    datasets: publicDatasets(captured.datasets),
    supplementalDatasets: publicSupplementalDatasets(captured.supplementalDatasets),
    operationalDatasets: captured.operationalDatasets,
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
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    const baselineDataset = baseline.supplementalDatasets[name];
    const current = captured.supplementalDatasets[name];
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
  for (const name of HISTORICAL_OPERATIONAL_DATASET_NAMES) {
    const baselineDataset = baseline.operationalDatasets[name];
    const current = captured.operationalDatasets[name];
    const currentColumns = new Set(current.columns.map(columnIdentity));
    for (const column of baselineDataset.columns) {
      if (!currentColumns.has(columnIdentity(column))) {
        problems.push(`${name} lost or changed baseline operational column ${column.name}.`);
      }
    }
  }
  return {
    kind: HISTORICAL_DATA_PRESERVATION_KIND,
    schemaVersion: 2,
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
    supplementalDatasets: publicSupplementalDatasets(captured.supplementalDatasets),
    operationalDatasets: captured.operationalDatasets,
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
    .update(stableStringify({
      kind: HISTORICAL_DATA_PRESERVATION_KIND,
      schemaVersion: 2,
      snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
      phase,
      sourceFingerprint,
    }))
    .digest("hex");
  return `historical-data-preservation-${phase}:${binding}`;
}

function historicalDataLegacyBudgetOperationId(
  phase: "baseline" | "verification",
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  const binding = createHash()
    .update(stableStringify({
      kind: HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
      phase,
      sourceFingerprint,
    }))
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
  return validateHistoricalDataBaselineValue(value, options);
}

export function validateHistoricalDataBaselineValue(
  value: unknown,
  options: ReadHistoricalDataBaselineOptions,
): HistoricalDataBaselineReport {
  const backupDir = path.resolve(options.backupDir);
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
  const maximumReservation = reserveD1ReleaseBudget({
    backupDir,
    operationId,
    operation: historicalOperationName(phase),
    sourceFingerprint: sourceIdentity,
    phase: "maximum",
    rowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    rowsWritten: 0,
    observedUsage: usage,
    now: startedAt,
    expectedUtcDay: utcDay,
  });
  if (maximumReservation.idempotent) {
    const provenPreSnapshotReplay =
      phase === "baseline" &&
      options.allowProvenPreSnapshotReservationReplay === true &&
      typeof options.beforeSnapshot === "function" &&
      maximumReservation.reservation.phase === "maximum" &&
      maximumReservation.reservation.rowsRead ===
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT &&
      maximumReservation.reservation.maximumRowsRead ===
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT &&
      maximumReservation.reservation.rowsWritten === 0 &&
      maximumReservation.reservation.maximumRowsWritten === 0;
    if (!provenPreSnapshotReplay) {
      throw new Error(
        "Historical preservation refuses to replay an existing D1 reservation before another snapshot.",
      );
    }
  }
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

async function runCli() {
  if (!hasFlag("--confirm-production")) {
    throw new Error("Historical data preservation requires --confirm-production.");
  }
  const capture = hasFlag("--capture-baseline");
  const verify = hasFlag("--verify-preservation");
  if (capture === verify) {
    throw new Error("Choose exactly one of --capture-baseline or --verify-preservation.");
  }
  const createNewKey = hasFlag("--new-hmac-key");
  const reuseBaselineKey = hasFlag("--reuse-baseline-hmac-key");
  const confirmRollover = hasFlag("--confirm-budget-blocked-rollover");
  const backupDir = resolveBackupDir();
  if (capture) {
    if (!createNewKey || reuseBaselineKey || confirmRollover) {
      throw new Error(
        "Steady-state baseline capture requires --new-hmac-key; the pinned rollover successor must use the continuity orchestrator.",
      );
    }
    const secret = (await createHistoricalDataHmacKey()).secret;
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
  if (createNewKey || reuseBaselineKey || confirmRollover) {
    throw new Error("Historical-data HMAC capture flags are not valid for preservation verification.");
  }
  const baseline = readAndValidateHistoricalDataBaseline({
    backupDir,
    maximumAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  });
  const secret = (await readHistoricalDataHmacKey(baseline.hmacKeyId)).secret;
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
}

function executeD1ReadOnly(sql: string, runner: WranglerRunner) {
  assertHistoricalDataSnapshotSql(sql);
  const output = runner([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    sql,
  ], {
    env: {
      HISTORICAL_DATA_PRESERVATION_HMAC_SECRET: undefined,
      WRANGLER_WRITE_LOGS: "false",
    },
  });
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
    const totalAttempts = nonNegativeInteger(meta?.total_attempts);
    if (read === null || written === null) {
      throw new Error(`Historical preservation D1 result set ${index + 1} lacks billing metadata.`);
    }
    if (totalAttempts === null || totalAttempts < 1) {
      throw new Error(
        `Historical preservation D1 result set ${index + 1} lacks valid automatic-attempt metadata.`,
      );
    }
    if (totalAttempts !== 1) {
      throw new Error(
        `Historical preservation D1 result set ${index + 1} used ${totalAttempts} automatic attempts; the maximum billable-read reservation remains unresolved and no report may be created.`,
      );
    }
    rowsRead = safeAddBillingRows(rowsRead, read, "read");
    rowsWritten = safeAddBillingRows(rowsWritten, written, "written");
    resultSets.push(rows);
  }
  if (rowsWritten !== 0) {
    throw new Error("Historical preservation read-only query unexpectedly wrote rows.");
  }
  return { resultSets, rowsRead, rowsWritten: 0 };
}

function assertHistoricalDataSnapshotSql(sql: string) {
  if (Buffer.byteLength(sql, "utf8") > 100_000 || !sql.trimEnd().endsWith(";")) {
    throw new Error("Historical preservation snapshot SQL is invalid or too large.");
  }
  const parts = sql.split(";");
  const trailing = parts.pop();
  if (trailing?.trim() !== "" || parts.length !== HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT) {
    throw new Error("Historical preservation snapshot SQL has an invalid statement count.");
  }
  const expectedStatements = [
    ...historicalDataCountStatements,
    ...historicalDataSchemaStatements,
    ...historicalDataIdentityStatements,
  ].map((statement) => statement.slice(0, -1));
  for (const [index, statement] of parts.entries()) {
    const trimmed = statement.trim();
    if (
      trimmed !== expectedStatements[index] ||
      !/^SELECT\b/i.test(trimmed) ||
      /\b(?:UNION|INTERSECT|EXCEPT)\b/i.test(trimmed) ||
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(trimmed)
    ) {
      throw new Error("Historical preservation snapshot SQL must contain only simple read-only SELECT statements.");
    }
  }
}

function safeAddBillingRows(current: number, addition: number, label: "read" | "written") {
  if (current > Number.MAX_SAFE_INTEGER - addition) {
    throw new Error(`Historical preservation billed rows ${label} metadata overflowed.`);
  }
  return current + addition;
}

function parseDatasetCounts(rows: Array<Record<string, unknown>>) {
  const counts: Partial<Record<HistoricalSnapshotDatasetName, number>> = {};
  for (const row of rows) {
    if (!isHistoricalSnapshotDatasetName(row.dataset)) {
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
  for (const name of snapshotDatasetNames()) {
    if (!Object.hasOwn(counts, name)) throw new Error(`Historical preservation summary omitted ${name}.`);
  }
  assertCompleteDatasetCounts(counts);
  return counts;
}

function parseSchemaColumns(rows: Array<Record<string, unknown>>) {
  const schemas: Record<string, HistoricalColumnIdentity[]> = {};
  for (const row of rows) {
    if (!isSnapshotTableName(row.table_name)) {
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
  for (let index = 1; index <= 7; index += 1) {
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

function hasExactKeys(row: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(row).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function hmacIdentity(secret: string, dataset: HistoricalSnapshotDatasetName, values: string[]) {
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

function publicSupplementalDatasets(
  datasets: Record<HistoricalSupplementalDatasetName, CapturedDataset>,
) {
  const result: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  > = {};
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    const { identityHashes: _identityHashes, ...evidence } = datasets[name];
    void _identityHashes;
    result[name] = evidence;
  }
  assertCompleteSupplementalPublicDatasets(result);
  return result;
}

function operationalDatasetEvidence(
  counts: Record<HistoricalSnapshotDatasetName, number>,
  columns: Record<string, HistoricalColumnIdentity[]>,
) {
  const result: Partial<
    Record<HistoricalOperationalDatasetName, HistoricalOperationalDatasetEvidence>
  > = {};
  for (const spec of operationalDatasetSpecs) {
    const schemaColumns = columns[spec.table];
    if (!schemaColumns?.length) {
      throw new Error(`Historical preservation schema is missing ${spec.table}.`);
    }
    result[spec.name] = {
      lifecycle: "mutable-drainable-outbox",
      rowCount: counts[spec.name],
      schemaTable: "memory_vector_cleanup_outbox",
      schemaSha256: schemaHash(schemaColumns),
      columns: schemaColumns,
    };
  }
  assertCompleteOperationalPublicDatasets(result);
  validateHistoricalOperationalDatasets(result);
  return result;
}

export function parseHistoricalDataBaselineReport(
  value: unknown,
): HistoricalDataBaselineReport {
  const parsed = historicalBaselineSchema.parse(value);
  assertValidSourceFingerprint(parsed.sourceFingerprint);
  const expectedOperationId = historicalDataBudgetOperationId(
    "baseline",
    compactSourceFingerprint(parsed.sourceFingerprint),
  );
  if (parsed.operationId !== expectedOperationId) {
    throw new Error("Historical preservation baseline has the wrong source-bound operation ID.");
  }
  validateHistoricalDatasets(parsed.datasets);
  validateHistoricalSupplementalDatasets(parsed.supplementalDatasets);
  validateHistoricalOperationalDatasets(parsed.operationalDatasets);
  validateHistoricalCrossDatasetInvariants(parsed.datasets, parsed.supplementalDatasets);
  validateHistoricalBaselineLedger(parsed, path.resolve(parsed.backupDir));
  return parsed;
}

export type HistoricalDataLegacyBaselineIdentity = {
  sourceSha256: string;
  sourceFileCount: number;
  createdAt: string;
  utcDay: string;
  operationId: string;
};

export function parseHistoricalDataLegacyBaselineReportForContinuity(
  value: unknown,
  expected: HistoricalDataLegacyBaselineIdentity,
): HistoricalDataLegacyBaselineReport {
  const parsed = historicalLegacyBaselineSchema.parse(value);
  assertValidSourceFingerprint(parsed.sourceFingerprint);
  const expectedOperationId = historicalDataLegacyBudgetOperationId(
    "baseline",
    compactSourceFingerprint(parsed.sourceFingerprint),
  );
  if (parsed.operationId !== expectedOperationId) {
    throw new Error("Historical preservation V1 baseline has the wrong source-bound operation ID.");
  }
  if (
    parsed.sourceFingerprint.sha256 !== expected.sourceSha256 ||
    parsed.sourceFingerprint.fileCount !== expected.sourceFileCount ||
    parsed.createdAt !== expected.createdAt ||
    parsed.utcDay !== expected.utcDay ||
    parsed.operationId !== expected.operationId
  ) {
    throw new Error("Historical preservation V1 baseline is not the exact continuity predecessor.");
  }
  validateHistoricalDatasets(parsed.datasets);
  validateHistoricalBaselineLedger(parsed, path.resolve(parsed.backupDir));
  return parsed;
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
  assertValidSourceFingerprint(options.expectedSourceFingerprint);
  assertSameSource(parsed.sourceFingerprint, options.expectedSourceFingerprint);
  parseHistoricalDataBaselineReport(parsed);
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
  for (const spec of coreDatasetSpecs) {
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

function validateHistoricalSupplementalDatasets(
  datasets: Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>,
) {
  for (const spec of supplementalDatasetSpecs) {
    const dataset = datasets[spec.name];
    if (dataset.schemaTable !== spec.table) {
      throw new Error(
        `Historical preservation baseline ${spec.name} targets the wrong schema table.`,
      );
    }
    if (dataset.rowCount > spec.cap) {
      throw new Error(`Historical preservation baseline ${spec.name} exceeds its row cap.`);
    }
    if (new Set(dataset.columns.map((column) => column.name)).size !== dataset.columns.length) {
      throw new Error(
        `Historical preservation baseline ${spec.name} has duplicate schema columns.`,
      );
    }
    if (schemaHash(dataset.columns) !== dataset.schemaSha256) {
      throw new Error(
        `Historical preservation baseline ${spec.name} schema identity is invalid.`,
      );
    }
    const expectedSentinels = Math.min(dataset.rowCount, HISTORICAL_SENTINEL_LIMIT);
    if (
      dataset.sentinels.length !== expectedSentinels ||
      new Set(dataset.sentinels).size !== dataset.sentinels.length
    ) {
      throw new Error(
        `Historical preservation baseline ${spec.name} sentinels are incomplete.`,
      );
    }
  }
  const supplementalRows = HISTORICAL_SUPPLEMENTAL_DATASET_NAMES.reduce(
    (sum, name) => sum + datasets[name].rowCount,
    0,
  );
  if (supplementalRows > HISTORICAL_SUPPLEMENTAL_ROW_LIMIT) {
    throw new Error("Historical preservation baseline exceeds its supplemental-row limit.");
  }
}

const requiredMemoryVectorCleanupOutboxColumns: readonly HistoricalColumnIdentity[] = [
  { name: "vector_id", type: "text", notNull: 1, primaryKey: 1 },
  { name: "absence_count", type: "integer", notNull: 1, primaryKey: 0 },
  { name: "attempt_count", type: "integer", notNull: 1, primaryKey: 0 },
  { name: "created_at", type: "integer", notNull: 1, primaryKey: 0 },
  { name: "last_attempt_at", type: "integer", notNull: 0, primaryKey: 0 },
  { name: "last_error", type: "text", notNull: 0, primaryKey: 0 },
  { name: "lease_token", type: "text", notNull: 0, primaryKey: 0 },
  { name: "lease_until", type: "integer", notNull: 1, primaryKey: 0 },
  { name: "next_attempt_at", type: "integer", notNull: 1, primaryKey: 0 },
  { name: "owner_user_id", type: "text", notNull: 0, primaryKey: 0 },
  { name: "reason", type: "text", notNull: 1, primaryKey: 0 },
  { name: "source_namespace", type: "text", notNull: 0, primaryKey: 0 },
  { name: "source_row_id", type: "text", notNull: 0, primaryKey: 0 },
  { name: "source_row_revision", type: "integer", notNull: 0, primaryKey: 0 },
  { name: "state", type: "text", notNull: 1, primaryKey: 0 },
  { name: "updated_at", type: "integer", notNull: 1, primaryKey: 0 },
  { name: "write_fence_expires_at", type: "integer", notNull: 0, primaryKey: 0 },
  { name: "write_token", type: "text", notNull: 0, primaryKey: 0 },
] as const;

export function hasRequiredHistoricalMemoryVectorCleanupOutboxSchema(
  dataset: HistoricalOperationalDatasetEvidence,
) {
  if (
    dataset.lifecycle !== "mutable-drainable-outbox" ||
    dataset.schemaTable !== "memory_vector_cleanup_outbox"
  ) {
    return false;
  }
  const actualColumns = new Set(dataset.columns.map(columnIdentity));
  return requiredMemoryVectorCleanupOutboxColumns.every((column) =>
    actualColumns.has(columnIdentity(column))
  );
}

function validateHistoricalOperationalDatasets(
  datasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >,
) {
  const dataset = datasets.memory_vector_cleanup_outbox;
  if (
    dataset.lifecycle !== "mutable-drainable-outbox" ||
    dataset.schemaTable !== "memory_vector_cleanup_outbox"
  ) {
    throw new Error("Historical preservation outbox has the wrong operational lifecycle.");
  }
  if (dataset.rowCount > HISTORICAL_OPERATIONAL_ROW_LIMIT) {
    throw new Error("Historical preservation outbox exceeds its operational row cap.");
  }
  if (new Set(dataset.columns.map((column) => column.name)).size !== dataset.columns.length) {
    throw new Error("Historical preservation outbox has duplicate schema columns.");
  }
  if (schemaHash(dataset.columns) !== dataset.schemaSha256) {
    throw new Error("Historical preservation outbox schema identity is invalid.");
  }
  const actualColumns = new Set(dataset.columns.map(columnIdentity));
  for (const column of requiredMemoryVectorCleanupOutboxColumns) {
    if (!actualColumns.has(columnIdentity(column))) {
      throw new Error(
        `Historical preservation outbox is missing required operational column ${column.name}.`,
      );
    }
  }
  if (!hasRequiredHistoricalMemoryVectorCleanupOutboxSchema(dataset)) {
    throw new Error("Historical preservation outbox operational schema is incomplete.");
  }
}

function validateHistoricalCrossDatasetInvariants(
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>,
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >,
) {
  const memories = datasets.user_memories;
  const graph = supplementalDatasets.user_memory_graph_edges;
  if (
    graph.rowCount !== memories.rowCount ||
    graph.schemaTable !== memories.schemaTable ||
    graph.schemaSha256 !== memories.schemaSha256 ||
    stableStringify(graph.columns) !== stableStringify(memories.columns)
  ) {
    throw new Error(
      "Historical preservation user-memory graph evidence does not match user_memories.",
    );
  }
  if (datasets.profile_photo_pointers.rowCount > datasets.users.rowCount) {
    throw new Error(
      "Historical preservation profile-photo pointers exceed the users dataset.",
    );
  }
}

function validateHistoricalBaselineLedger(
  baseline: HistoricalDataBaselineReport | HistoricalDataLegacyBaselineReport,
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
  datasets: Partial<Record<HistoricalProtectedDatasetName, CapturedDataset>>,
): asserts datasets is Record<HistoricalProtectedDatasetName, CapturedDataset> {
  for (const name of protectedDatasetNames()) {
    if (!datasets[name]) throw new Error(`Historical preservation capture omitted ${name}.`);
  }
}

function coreCapturedDatasets(
  datasets: Record<HistoricalProtectedDatasetName, CapturedDataset>,
) {
  const result: Partial<Record<HistoricalDatasetName, CapturedDataset>> = {};
  for (const name of HISTORICAL_DATASET_NAMES) result[name] = datasets[name];
  assertCompleteCoreCapturedDatasets(result);
  return result;
}

function supplementalCapturedDatasets(
  datasets: Record<HistoricalProtectedDatasetName, CapturedDataset>,
) {
  const result: Partial<Record<HistoricalSupplementalDatasetName, CapturedDataset>> = {};
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) result[name] = datasets[name];
  assertCompleteSupplementalCapturedDatasets(result);
  return result;
}

function assertCompleteCoreCapturedDatasets(
  datasets: Partial<Record<HistoricalDatasetName, CapturedDataset>>,
): asserts datasets is Record<HistoricalDatasetName, CapturedDataset> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!datasets[name]) throw new Error(`Historical preservation capture omitted ${name}.`);
  }
}

function assertCompleteSupplementalCapturedDatasets(
  datasets: Partial<Record<HistoricalSupplementalDatasetName, CapturedDataset>>,
): asserts datasets is Record<HistoricalSupplementalDatasetName, CapturedDataset> {
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
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

function assertCompleteSupplementalPublicDatasets(
  datasets: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
): asserts datasets is Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence> {
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    if (!datasets[name]) throw new Error(`Historical preservation evidence omitted ${name}.`);
  }
}

function assertCompleteOperationalPublicDatasets(
  datasets: Partial<
    Record<HistoricalOperationalDatasetName, HistoricalOperationalDatasetEvidence>
  >,
): asserts datasets is Record<
  HistoricalOperationalDatasetName,
  HistoricalOperationalDatasetEvidence
> {
  for (const name of HISTORICAL_OPERATIONAL_DATASET_NAMES) {
    if (!datasets[name]) throw new Error(`Historical preservation evidence omitted ${name}.`);
  }
}

function assertCompleteDatasetCounts(
  counts: Partial<Record<HistoricalSnapshotDatasetName, number>>,
): asserts counts is Record<HistoricalSnapshotDatasetName, number> {
  for (const name of snapshotDatasetNames()) {
    if (counts[name] === undefined) {
      throw new Error(`Historical preservation summary omitted ${name}.`);
    }
  }
}

function snapshotDatasetNames(): readonly HistoricalSnapshotDatasetName[] {
  return [
    ...HISTORICAL_DATASET_NAMES,
    ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
    ...HISTORICAL_OPERATIONAL_DATASET_NAMES,
  ];
}

function protectedDatasetNames(): readonly HistoricalProtectedDatasetName[] {
  return [...HISTORICAL_DATASET_NAMES, ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES];
}

function isHistoricalSnapshotDatasetName(
  value: unknown,
): value is HistoricalSnapshotDatasetName {
  return typeof value === "string" && snapshotDatasetNames().some((name) => name === value);
}

function isSnapshotTableName(value: unknown): value is (typeof snapshotTableNames)[number] {
  return typeof value === "string" && snapshotTableNames.some((name) => name === value);
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
