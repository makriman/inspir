import { createHmac, type Hmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  d1ReleaseBudgetLedgerPath,
  readD1ReleaseBudgetLedger,
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
import { createHistoricalDataWranglerRunner } from "./historical-data-wrangler-runner";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

export { historicalDataHmacKeyId } from "./historical-data-hmac-key";

export const HISTORICAL_DATA_LEGACY_PRESERVATION_KIND =
  "inspir-historical-data-preservation-v1" as const;
export const HISTORICAL_DATA_PRESERVATION_KIND =
  "inspir-historical-data-preservation-v2" as const;
const HISTORICAL_DATA_BASELINE_RELATIVE_PATH =
  "cloudflare/historical-data-preservation-baseline.json" as const;
export const HISTORICAL_DATA_VERIFICATION_RELATIVE_PATH =
  "cloudflare/historical-data-preservation-verification.json" as const;
export const HISTORICAL_SENTINEL_LIMIT = 16;
export const HISTORICAL_CORE_ROW_LIMIT = 350_000;
export const HISTORICAL_GAME_RESULTS_ROW_LIMIT = 50_000;
export const HISTORICAL_SUPPLEMENTAL_ROW_LIMIT = 175_000;
export const HISTORICAL_OPERATIONAL_ROW_LIMIT = 10_000;
export const HISTORICAL_SCHEMA_COLUMN_LIMIT = 256;
export const HISTORICAL_SCHEMA_OBJECT_LIMIT = 512;
export const HISTORICAL_SCHEMA_OBJECT_SQL_MAX_BYTES = 4_096;
export const HISTORICAL_GAME_RESULTS_IDENTITY_MAX_BYTES = 2_000_000;
export const HISTORICAL_GAME_RESULTS_TABLE_SQL = [
  'CREATE TABLE `game_results` (',
  '  `id` text PRIMARY KEY NOT NULL,',
  '  `schema_version` integer NOT NULL CHECK (`schema_version` = 1),',
  "  `game_slug` text NOT NULL CHECK (`game_slug` IN ('tic-tac-toe', 'connect-four', 'chess')),",
  '  `engine_id` text NOT NULL,',
  '  `engine_version` text NOT NULL,',
  '  `terminal_code` text NOT NULL,',
  "  `winner` text NOT NULL CHECK (`winner` IN ('human', 'opponent', 'draw')),",
  "  `outcome` text NOT NULL CHECK (`outcome` IN ('win', 'loss', 'draw')),",
  '  `ply_count` integer NOT NULL CHECK (`ply_count` >= 0 AND `ply_count` <= 128),',
  '  `payload` text NOT NULL CHECK (json_valid(`payload`)),',
  '  `started_at` integer,',
  '  `completed_at` integer NOT NULL,',
  '  `duration_ms` integer CHECK (`duration_ms` IS NULL OR (`duration_ms` >= 0 AND `duration_ms` <= 86400000)),',
  '  `created_at` integer NOT NULL,',
  '  CHECK ((`started_at` IS NULL AND `duration_ms` IS NULL) OR (`started_at` IS NOT NULL AND `duration_ms` IS NOT NULL)),',
  '  CHECK (`started_at` IS NULL OR `started_at` <= `completed_at`),',
  '  CHECK (`completed_at` = `created_at`)',
  ')',
].join("\n");
export const HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL = [
  'CREATE TRIGGER `game_results_reject_update`',
  'BEFORE UPDATE ON `game_results`',
  'BEGIN',
  "  SELECT RAISE(ABORT, 'game_results rows are immutable');",
  'END',
].join("\n");
// These are SHA-256 digests of the exact UTF-8 `sqlite_master.sql` values
// created by drizzle-d1/0012_immutable_game_results.sql. SQLite removes only
// `IF NOT EXISTS` and the final semicolon when it stores those definitions.
export const HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256 =
  "785620ec28ca98f56cdcb74cee3b915c014658f5adcddcc97cac5647e34baf31" as const;
export const HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256 =
  "59acc11c8bbe752e1e6433dccb47aa511a0bf3faec3164194d5d523b2530e1f1" as const;
// Combined identity = SHA-256(stableStringify([table object, trigger object]))
// where each object is { type, name, table, sqlSha256 } in the canonical order
// below. This binds object role/name/table as well as both exact DDL byte hashes.
export const HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256 =
  "b9cdcba4c5458327e1091ec608ac565dcb5951aa8bac0d9026712f46397cf1ce" as const;

export function historicalGameResultsSchemaObjectResultRows() {
  return [
    {
      object_type: "table",
      object_name: "game_results",
      table_name: "game_results",
      sql_bytes: Buffer.byteLength(HISTORICAL_GAME_RESULTS_TABLE_SQL, "utf8"),
      sql: HISTORICAL_GAME_RESULTS_TABLE_SQL,
    },
    {
      object_type: "trigger",
      object_name: "game_results_reject_update",
      table_name: "game_results",
      sql_bytes: Buffer.byteLength(
        HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL,
        "utf8",
      ),
      sql: HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL,
    },
  ];
}

const canonicalGameResultsTableSha256 = createHash()
  .update(HISTORICAL_GAME_RESULTS_TABLE_SQL)
  .digest("hex");
const canonicalGameResultsTriggerSha256 = createHash()
  .update(HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL)
  .digest("hex");
if (
  canonicalGameResultsTableSha256 !==
    HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256 ||
  canonicalGameResultsTriggerSha256 !==
    HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256 ||
  gameResultsSchemaObjectsCombinedSha256(
    canonicalGameResultsTableSha256,
    canonicalGameResultsTriggerSha256,
  ) !== HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256
) {
  throw new Error("Historical game-results canonical DDL constants drifted.");
}
export const HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT = 750_000;
// One logical snapshot is bounded below this cushion. Cloudflare may
// transparently execute a read-only statement up to three times, so release
// admission must reserve the separate worst-case billable ceiling below.
export const HISTORICAL_BILLED_READ_LIMIT = 750_000;
export const HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS = 3;
export const HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT = 2_250_000;
export const HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ = 740_996;
if (
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT !==
  HISTORICAL_BILLED_READ_LIMIT *
    HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS
) {
  throw new Error(
    "Historical preservation automatic-retry reservation is inconsistent.",
  );
}
export const HISTORICAL_DATA_COUNT_RESULT_SET_COUNT = 22;
export const HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT = 20;
export const HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT = 1;
export const HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT = 21;
export const HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT =
  HISTORICAL_DATA_COUNT_RESULT_SET_COUNT +
  HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT +
  HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT +
  HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT;
const HISTORICAL_DATA_REPORT_MAX_BYTES = 2 * 1024 * 1024;
export const HISTORICAL_DATA_BASELINE_MAX_AGE_MS = 30 * 60 * 1000;
export const HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const HISTORICAL_DATA_FINAL_VERIFICATION_AUTHORIZATION_KIND =
  "inspir-historical-data-fresh-0016-final-verifier-authorization-v3" as const;
export const HISTORICAL_DATA_FINAL_VERIFICATION_PREPARED_KIND =
  "inspir-historical-data-fresh-0016-final-verifier-prepared-v1" as const;

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
  "game_results",
] as const;

export type HistoricalSupplementalDatasetName =
  (typeof HISTORICAL_SUPPLEMENTAL_DATASET_NAMES)[number];

export const HISTORICAL_OPERATIONAL_DATASET_NAMES = [
  "memory_vector_cleanup_outbox",
] as const;

export type HistoricalOperationalDatasetName =
  (typeof HISTORICAL_OPERATIONAL_DATASET_NAMES)[number];
export type HistoricalProtectedDatasetName =
  | HistoricalDatasetName
  | HistoricalSupplementalDatasetName;
export const HISTORICAL_PROTECTED_DATASET_COUNT =
  HISTORICAL_DATASET_NAMES.length + HISTORICAL_SUPPLEMENTAL_DATASET_NAMES.length;
type HistoricalSnapshotDatasetName =
  | HistoricalProtectedDatasetName
  | HistoricalOperationalDatasetName;

export type HistoricalColumnIdentity = {
  name: string;
  type: string;
  notNull: 0 | 1;
  primaryKey: number;
};

export type HistoricalGameResultsSchemaObjects = {
  tableSha256: typeof HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256;
  rejectUpdateTriggerSha256:
    typeof HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256;
  combinedSha256: typeof HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256;
};

export const HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS = Object.freeze({
  tableSha256: HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256,
  rejectUpdateTriggerSha256:
    HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256,
  combinedSha256: HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256,
} satisfies HistoricalGameResultsSchemaObjects);

export type HistoricalDatasetEvidence = {
  rowCount: number;
  schemaTable: string;
  schemaSha256: string;
  columns: HistoricalColumnIdentity[];
  sentinels: string[];
  schemaObjects?: HistoricalGameResultsSchemaObjects;
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
  baselineEvidence?: {
    kind: "fresh-0016-canonical-successor";
    cutoverRunId: string;
    policySha256: string;
    canonicalArtifactSha256: string;
    successorReportSha256: string;
  };
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

export type HistoricalDataFinalVerificationAuthorization = Readonly<{
  kind: typeof HISTORICAL_DATA_FINAL_VERIFICATION_AUTHORIZATION_KIND;
  schemaVersion: 3;
  phase: "final-verifier-authorized";
  d1ExecutionMayStart: true;
  createdAt: string;
  utcDay: string;
  cutoverRunId: string;
  policySha256: string;
  operationId: string;
  accountingParentOperationId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  workerRelease: HistoricalFresh0016UploadedInactiveWorkerRelease;
  finalVerificationLiveTopology: HistoricalFresh0016FinalLiveTopology;
  hmacKeyId: string;
  snapshotPlanSha256: typeof HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256;
  canonicalArtifactSha256: string;
  successorReportSha256: string;
  maximumReservationRevision: number;
  maximumRowsRead: typeof HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT;
  maximumRowsWritten: 0;
}>;

export type HistoricalDataPreparedVerification = Readonly<{
  kind: typeof HISTORICAL_DATA_FINAL_VERIFICATION_PREPARED_KIND;
  schemaVersion: 1;
  phase: "verification-prepared";
  preparedAt: string;
  utcDay: string;
  operationId: string;
  backupDir: string;
  database: typeof D1_DATABASE_NAME;
  accountingParentOperationId: string | null;
  candidateVersionId: string | null;
  authorizationEvidenceSha256: string | null;
  hmacKeyId: string;
  sourceFingerprint: SourceFingerprint;
  baselineCreatedAt: string;
  baselineEvidence?: NonNullable<
    HistoricalDataVerificationReport["baselineEvidence"]
  >;
  rowsRead: number;
  rowsWritten: 0;
  usage: D1DailyUsage;
  maximumReservation: D1ReleaseBudgetReservationResult;
  problems: string[];
  captureSha256: string;
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >;
  operationalDatasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >;
}>;

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

export type HistoricalDataV2SnapshotDatasetEvidence = Readonly<{
  rowCount: number;
  schemaTable: string;
  schemaSha256: string;
  columns: readonly Readonly<HistoricalColumnIdentity>[];
  sentinels: readonly string[];
  schemaObjects?: Readonly<HistoricalGameResultsSchemaObjects>;
}>;

export type HistoricalDataV2SnapshotOperationalEvidence = Readonly<{
  lifecycle: "mutable-drainable-outbox";
  rowCount: number;
  schemaTable: "memory_vector_cleanup_outbox";
  schemaSha256: string;
  columns: readonly Readonly<HistoricalColumnIdentity>[];
}>;

export type HistoricalDataV2SnapshotEvidence = Readonly<{
  snapshotPlanSha256: typeof HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256;
  resultSetCount: typeof HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT;
  automaticAttemptsPerResultSet: 1;
  rowsRead: number;
  rowsWritten: 0;
  hmacKeyId: string;
  datasets: Readonly<
    Record<HistoricalDatasetName, HistoricalDataV2SnapshotDatasetEvidence>
  >;
  supplementalDatasets: Readonly<
    Record<
      HistoricalSupplementalDatasetName,
      HistoricalDataV2SnapshotDatasetEvidence
    >
  >;
  operationalDatasets: Readonly<
    Record<
      HistoricalOperationalDatasetName,
      HistoricalDataV2SnapshotOperationalEvidence
    >
  >;
}>;

export type CaptureHistoricalDataV2SnapshotEvidenceOptions = Readonly<{
  hmacSecret: string;
  runner?: WranglerRunner;
  authorizeLastPreD1?: () => void;
}>;

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
  accountingParentOperationId?: string;
  candidateVersionId?: string;
  authorizeLastPreD1?: () => void;
  authorizationEvidenceSha256Provider?: () => string;
  persistPreparedVerification?: (
    prepared: HistoricalDataPreparedVerification,
  ) => void;
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
  identityArity: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 14;
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
  "game_results",
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
  {
    name: "game_results",
    table: "game_results",
    cap: HISTORICAL_GAME_RESULTS_ROW_LIMIT,
    identityArity: 14,
    // Return typed fields, not a JSON composite. Local HMAC framing preserves
    // string/number/null distinctions and avoids constructing another payload-
    // sized serialization before hashing the immutable row.
    identitySql: "SELECT id AS identity_1, schema_version AS identity_2, game_slug AS identity_3, engine_id AS identity_4, engine_version AS identity_5, terminal_code AS identity_6, winner AS identity_7, outcome AS identity_8, ply_count AS identity_9, payload AS identity_10, started_at AS identity_11, completed_at AS identity_12, duration_ms AS identity_13, created_at AS identity_14 FROM game_results ORDER BY rowid LIMIT 16;",
  },
] as const;

const datasetSpecs: readonly DatasetSpec<HistoricalProtectedDatasetName>[] = [
  ...coreDatasetSpecs,
  ...supplementalDatasetSpecs,
];
export type HistoricalProtectedDatasetSnapshotSpec = Readonly<{
  name: HistoricalProtectedDatasetName;
  table: string;
  cap: number;
  identityArity: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 14;
  identitySql: string;
}>;
export const HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS: readonly HistoricalProtectedDatasetSnapshotSpec[] =
  Object.freeze(
    datasetSpecs.map((spec) => Object.freeze({ ...spec })),
  );
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
const historicalGameResultsSchemaObjectsSchema = z.object({
  tableSha256: z.literal(HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256),
  rejectUpdateTriggerSha256: z.literal(
    HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256,
  ),
  combinedSha256: z.literal(
    HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256,
  ),
}).strict();
const historicalDatasetSchema = z.object({
  rowCount: safeNonnegativeIntegerSchema,
  schemaTable: z.string().min(1).max(128),
  schemaSha256: sha256Schema,
  columns: z.array(historicalColumnSchema).min(1).max(256),
  sentinels: z.array(sha256Schema).max(HISTORICAL_SENTINEL_LIMIT),
  schemaObjects: historicalGameResultsSchemaObjectsSchema.optional(),
}).strict();
const historicalOperationalDatasetSchema = historicalDatasetSchema
  .omit({ sentinels: true, schemaObjects: true })
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
const compactSourceFingerprintSchema = z.object({
  sha256: sha256Schema,
  fileCount: safePositiveIntegerSchema,
}).strict();
const nullableReleaseIdentitySchema = z.string().min(1).max(200).nullable();
const d1UsageSchema = z.object({
  databaseCount: safePositiveIntegerSchema,
  queryGroups: safeNonnegativeIntegerSchema,
  rowsRead: safeNonnegativeIntegerSchema,
  rowsWritten: safeNonnegativeIntegerSchema,
  executions: safeNonnegativeIntegerSchema,
  windowMinutes: safePositiveIntegerSchema.refine((value) => value <= 24 * 60),
}).strict();
const historicalMaximumLedgerResultSchema = z.object({
  ledgerPath: z.string().min(1).max(4_096),
  utcDay: utcDaySchema,
  revision: safePositiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: z.object({
    operationId: z.string().min(1).max(200),
    operation: z.literal("Historical production data preservation verification"),
    candidateVersionId: nullableReleaseIdentitySchema,
    phase: z.literal("maximum"),
    rowsRead: z.literal(HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT),
    rowsWritten: z.literal(0),
    maximumRowsRead: z.literal(
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    ),
    maximumRowsWritten: z.literal(0),
    createdAt: canonicalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  }).strict(),
  totals: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
}).strict();
const historicalBaselineEvidenceSchema = z.object({
  kind: z.literal("fresh-0016-canonical-successor"),
  cutoverRunId: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
  policySha256: sha256Schema,
  canonicalArtifactSha256: sha256Schema,
  successorReportSha256: sha256Schema,
}).strict();
const historicalVerificationLedgerResultSchema = z.object({
  ledgerPath: z.string().min(1).max(4_096),
  utcDay: utcDaySchema,
  revision: safePositiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: z.object({
    operationId: z.string().min(1).max(200),
    operation: z.literal("Historical production data preservation verification"),
    candidateVersionId: nullableReleaseIdentitySchema,
    phase: z.literal("exact"),
    rowsRead: safePositiveIntegerSchema.refine(
      (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      "Historical verification ledger exceeds its logical read bound.",
    ),
    rowsWritten: z.literal(0),
    maximumRowsRead: z.literal(
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    ),
    maximumRowsWritten: z.literal(0),
    createdAt: canonicalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  }).strict(),
  totals: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
}).strict();
const historicalDataVerificationReportSchema = z.object({
  kind: z.literal(HISTORICAL_DATA_PRESERVATION_KIND),
  schemaVersion: z.literal(2),
  phase: z.literal("verification"),
  createdAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  operationId: z.string().min(1).max(200),
  backupDir: z.string().min(1).max(4_096),
  database: z.literal(D1_DATABASE_NAME),
  ok: z.boolean(),
  privacy: z.literal("hmac-sha256-no-raw-identifiers"),
  hmacKeyId: sha256Schema,
  sourceFingerprint: sourceFingerprintSchema,
  baselineCreatedAt: canonicalTimestampSchema,
  baselineEvidence: historicalBaselineEvidenceSchema.optional(),
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    "Historical verification exceeds its logical read bound.",
  ),
  rowsWritten: z.literal(0),
  usage: d1UsageSchema,
  ledger: historicalVerificationLedgerResultSchema,
  problems: z.array(z.string().min(1).max(2_048)).max(2_000),
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
const historicalDataPreparedVerificationSchema = z.object({
  kind: z.literal(HISTORICAL_DATA_FINAL_VERIFICATION_PREPARED_KIND),
  schemaVersion: z.literal(1),
  phase: z.literal("verification-prepared"),
  preparedAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  operationId: z.string().min(1).max(200),
  backupDir: z.string().min(1).max(4_096),
  database: z.literal(D1_DATABASE_NAME),
  accountingParentOperationId: nullableReleaseIdentitySchema,
  candidateVersionId: nullableReleaseIdentitySchema,
  authorizationEvidenceSha256: sha256Schema.nullable(),
  hmacKeyId: sha256Schema,
  sourceFingerprint: sourceFingerprintSchema,
  baselineCreatedAt: canonicalTimestampSchema,
  baselineEvidence: historicalBaselineEvidenceSchema.optional(),
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    "Prepared historical verification exceeds its logical read bound.",
  ),
  rowsWritten: z.literal(0),
  usage: d1UsageSchema,
  maximumReservation: historicalMaximumLedgerResultSchema,
  problems: z.array(z.string().min(1).max(2_048)).max(2_000),
  captureSha256: sha256Schema,
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

const historicalDataSchemaObjectStatements = [
  `SELECT type AS object_type, name AS object_name, tbl_name AS table_name, length(CAST(sql AS BLOB)) AS sql_bytes, CASE WHEN length(CAST(sql AS BLOB)) <= ${HISTORICAL_SCHEMA_OBJECT_SQL_MAX_BYTES} THEN sql ELSE NULL END AS sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name LIMIT ${HISTORICAL_SCHEMA_OBJECT_LIMIT + 1};`,
] as const;

const historicalDataIdentityStatements = datasetSpecs.map((spec) => spec.identitySql);

// The pre-0016 preservation boundary uses the same protected learner-data
// plan, but runs before the operational cleanup outbox exists. Keep this SQL
// derived from the canonical V2 plan so the bounded recovery primitive cannot
// drift to a second set of dataset definitions.
export const HISTORICAL_PROTECTED_DATA_SNAPSHOT_SQL = [
  ...historicalDataCountStatements.slice(0, datasetSpecs.length),
  ...historicalDataSchemaStatements.slice(
    0,
    coreTableNames.length + supplementalTableNames.length,
  ),
  ...historicalDataSchemaObjectStatements,
  ...historicalDataIdentityStatements,
].join("\n");

if (
  historicalDataCountStatements.length !== HISTORICAL_DATA_COUNT_RESULT_SET_COUNT ||
  historicalDataSchemaStatements.length !== HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT ||
  historicalDataSchemaObjectStatements.length !==
    HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT ||
  historicalDataIdentityStatements.length !== HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT
) {
  throw new Error("Historical preservation snapshot plan has an invalid result-set partition.");
}

export const HISTORICAL_DATA_SUMMARY_SQL = [
  ...historicalDataCountStatements,
  ...historicalDataSchemaStatements,
  ...historicalDataSchemaObjectStatements,
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
const historicalSchemaObjectScanMaximum =
  HISTORICAL_SCHEMA_OBJECT_LIMIT + 1;
const historicalIdentityScanMaximum = datasetSpecs.reduce(
  (sum, spec) =>
    sum + (spec.name === "profile_photo_pointers" ? usersDatasetSpec.cap + 1 : HISTORICAL_SENTINEL_LIMIT),
  0,
);
export const HISTORICAL_PROTECTED_DATA_SNAPSHOT_CALCULATED_MAX_ROWS_READ =
  datasetSpecs.reduce(
    (sum, spec) =>
      sum +
      (spec.name === "profile_photo_pointers"
        ? usersDatasetSpec.cap + 1
        : spec.cap + 1),
    0,
  ) +
  (coreTableNames.length + supplementalTableNames.length) *
    (HISTORICAL_SCHEMA_COLUMN_LIMIT + 1) +
  historicalSchemaObjectScanMaximum +
  historicalIdentityScanMaximum;
const calculatedHistoricalDataSnapshotMaxRowsRead =
  historicalCountScanMaximum +
  historicalSchemaScanMaximum +
  historicalSchemaObjectScanMaximum +
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

const fresh0016WorkerVersionSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);
const historicalFresh0016UploadedInactiveWorkerReleaseSchema = z.object({
  phase: z.literal("uploaded-inactive"),
  targetCandidateVersionId: fresh0016WorkerVersionSchema,
  serviceBaselineVersionId: fresh0016WorkerVersionSchema,
  uploadEvidenceSha256: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.targetCandidateVersionId === value.serviceBaselineVersionId) {
    context.addIssue({
      code: "custom",
      message: "The final verifier candidate must differ from the serving baseline.",
    });
  }
});
const historicalFresh0016BaselineLiveTopologySchema = z.object({
  kind: z.literal("inspir-historical-fresh-0016-live-worker-topology-v1"),
  schemaVersion: z.literal(1),
  observedAt: canonicalTimestampSchema,
  authoritativeSource: z.literal("wrangler-deployments-status-json"),
  statusOutputSha256: sha256Schema,
  workerRelease: historicalFresh0016UploadedInactiveWorkerReleaseSchema,
  topology: z.object({
    deploymentId: fresh0016WorkerVersionSchema,
    serviceBaselineVersionId: fresh0016WorkerVersionSchema,
    baselinePercentage: z.literal(100),
    observedVersions: z.literal(1),
  }).strict(),
  targetCandidate: z.object({
    versionId: fresh0016WorkerVersionSchema,
    state: z.literal("absent"),
    percentage: z.literal(0),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (
    value.topology.serviceBaselineVersionId !==
      value.workerRelease.serviceBaselineVersionId ||
    value.targetCandidate.versionId !==
      value.workerRelease.targetCandidateVersionId
  ) {
    context.addIssue({
      code: "custom",
      message: "Final-verifier live topology drifted from its Worker release.",
    });
  }
});

const historicalFresh0016FinalLiveTopologySchema = z.object({
  kind: z.literal(
    "inspir-historical-fresh-0016-final-active-worker-topology-v1",
  ),
  schemaVersion: z.literal(1),
  observedAt: canonicalTimestampSchema,
  authoritativeSource: z.literal("wrangler-deployments-status-json"),
  statusOutputSha256: sha256Schema,
  workerRelease: historicalFresh0016UploadedInactiveWorkerReleaseSchema,
  activationEvidence: z.object({
    sha256: sha256Schema,
    createdAt: canonicalTimestampSchema,
    deploymentId: fresh0016WorkerVersionSchema,
    stagedEvidenceSha256: sha256Schema,
    preActivationSealSha256: sha256Schema,
  }).strict(),
  topology: z.object({
    deploymentId: fresh0016WorkerVersionSchema,
    targetCandidateVersionId: fresh0016WorkerVersionSchema,
    candidatePercentage: z.literal(100),
    observedVersions: z.literal(1),
  }).strict(),
  serviceBaseline: z.object({
    versionId: fresh0016WorkerVersionSchema,
    state: z.literal("absent"),
    percentage: z.literal(0),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (
    value.topology.targetCandidateVersionId !==
      value.workerRelease.targetCandidateVersionId ||
    value.serviceBaseline.versionId !==
      value.workerRelease.serviceBaselineVersionId ||
    value.activationEvidence.deploymentId !== value.topology.deploymentId ||
    Date.parse(value.observedAt) <=
      Date.parse(value.activationEvidence.createdAt)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Final-verifier active topology drifted from its activation, candidate, or service-baseline identity.",
    });
  }
});

const historicalDataFinalVerificationAuthorizationSchema = z.object({
  kind: z.literal(HISTORICAL_DATA_FINAL_VERIFICATION_AUTHORIZATION_KIND),
  schemaVersion: z.literal(3),
  phase: z.literal("final-verifier-authorized"),
  d1ExecutionMayStart: z.literal(true),
  createdAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  cutoverRunId: historicalBaselineEvidenceSchema.shape.cutoverRunId,
  policySha256: sha256Schema,
  operationId: z.string().min(1).max(200),
  accountingParentOperationId: z.string().min(1).max(200),
  sourceFingerprint: compactSourceFingerprintSchema,
  workerRelease: historicalFresh0016UploadedInactiveWorkerReleaseSchema,
  finalVerificationLiveTopology: historicalFresh0016FinalLiveTopologySchema,
  hmacKeyId: sha256Schema,
  snapshotPlanSha256: z.literal(HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256),
  canonicalArtifactSha256: sha256Schema,
  successorReportSha256: sha256Schema,
  maximumReservationRevision: safePositiveIntegerSchema,
  maximumRowsRead: z.literal(
    HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  ),
  maximumRowsWritten: z.literal(0),
}).strict();

assertHistoricalDataSnapshotSql(HISTORICAL_DATA_SNAPSHOT_SQL);

function captureHistoricalDataSnapshot(options: {
  hmacSecret: string;
  runner?: WranglerRunner;
  authorizeLastPreD1?: () => void;
}): HistoricalCapture {
  const secret = requireHistoricalHmacSecret(options.hmacSecret);
  const runner = createHistoricalDataWranglerRunner(
    options.runner ?? runWrangler,
  );
  const snapshot = executeD1ReadOnly(
    HISTORICAL_DATA_SNAPSHOT_SQL,
    runner,
    options.authorizeLastPreD1,
  );
  if (snapshot.resultSets.length !== HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT) {
    throw new Error("Historical preservation snapshot returned an unexpected result-set count.");
  }
  const countResultSets = snapshot.resultSets.slice(0, HISTORICAL_DATA_COUNT_RESULT_SET_COUNT);
  const schemaStart = HISTORICAL_DATA_COUNT_RESULT_SET_COUNT;
  const schemaEnd = schemaStart + HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT;
  const schemaResultSets = snapshot.resultSets.slice(schemaStart, schemaEnd);
  const schemaObjectEnd =
    schemaEnd + HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT;
  const schemaObjectResultSets = snapshot.resultSets.slice(
    schemaEnd,
    schemaObjectEnd,
  );
  const identityResultSets = snapshot.resultSets.slice(schemaObjectEnd);
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
  const schemaObjects = parseHistoricalGameResultsSchemaObjects(
    schemaObjectResultSets[0] ?? [],
  );
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
      rows.map((row) => {
        const values = identityValues(row, spec.identityArity);
        if (spec.name === "game_results") {
          assertHistoricalGameResultsIdentity(values);
        }
        return historicalDataIdentityHmac(secret, spec.name, values);
      }),
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
      schemaSha256: historicalDataSchemaHash(schemaColumns),
      columns: schemaColumns,
      sentinels: [...identityHashes].slice(0, HISTORICAL_SENTINEL_LIMIT),
      identityHashes,
      ...(spec.name === "game_results" ? { schemaObjects } : {}),
    };
  }
  assertCompleteCapturedDatasets(datasets);
  const core = coreCapturedDatasets(datasets);
  const supplemental = supplementalCapturedDatasets(datasets);
  const operational = operationalDatasetEvidence(counts, columns);
  validateHistoricalCrossDatasetInvariants(core, supplemental);
  if (!hasRequiredHistoricalGameResultsSchema(supplemental.game_results)) {
    throw new Error(
      "Historical preservation game_results schema is incomplete.",
    );
  }
  return {
    rowsRead,
    rowsWritten: 0,
    hmacKeyId: historicalDataHmacKeyId(secret),
    datasets: core,
    supplementalDatasets: supplemental,
    operationalDatasets: operational,
  };
}

export function captureHistoricalDataV2SnapshotEvidence(
  options: CaptureHistoricalDataV2SnapshotEvidenceOptions,
): HistoricalDataV2SnapshotEvidence {
  const captured = captureHistoricalDataSnapshot(options);
  const datasets = publicDatasets(captured.datasets);
  const supplementalDatasets = publicSupplementalDatasets(
    captured.supplementalDatasets,
  );
  validateHistoricalProtectedDatasetEvidence(
    datasets,
    supplementalDatasets,
  );
  validateHistoricalOperationalDatasets(captured.operationalDatasets);
  const evidence = {
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    resultSetCount: HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
    automaticAttemptsPerResultSet: 1,
    rowsRead: captured.rowsRead,
    rowsWritten: 0,
    hmacKeyId: captured.hmacKeyId,
    datasets,
    supplementalDatasets,
    operationalDatasets: captured.operationalDatasets,
  } as const;
  deepFreezeHistoricalSnapshotEvidence(evidence);
  return evidence;
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
  return finishHistoricalDataPreservationVerification({
    operation,
    baseline,
    hmacSecret: options.hmacSecret,
  });
}

export type HistoricalDataPreservationBaselineReference = Readonly<Pick<
  HistoricalDataBaselineReport,
  | "createdAt"
  | "hmacKeyId"
  | "sourceFingerprint"
  | "datasets"
  | "supplementalDatasets"
  | "operationalDatasets"
> & {
  baselineEvidence?: HistoricalDataVerificationReport["baselineEvidence"];
}>;

function finishHistoricalDataPreservationVerification(input: Readonly<{
  operation: HistoricalOperation;
  baseline: HistoricalDataPreservationBaselineReference;
  hmacSecret: string;
}>): HistoricalDataVerificationReport {
  const { operation, baseline, hmacSecret } = input;
  assertSameSource(baseline.sourceFingerprint, operation.sourceBefore);
  if (historicalDataHmacKeyId(hmacSecret) !== baseline.hmacKeyId) {
    throw new Error(
      "Historical preservation verification requires the exact baseline HMAC key.",
    );
  }
  const captured = captureHistoricalDataSnapshot({
    hmacSecret,
    runner: operation.runner,
    ...(operation.authorizeLastPreD1
      ? {
          authorizeLastPreD1: () => {
            const result = operation.authorizeLastPreD1?.();
            if (result !== undefined || isThenable(result)) {
              throw new Error(
                "Historical preservation last-pre-D1 authorization must complete synchronously without a return value.",
              );
            }
          },
        }
      : {}),
  });
  const sourceAfter = operation.sourceProvider();
  assertValidSourceFingerprint(sourceAfter);
  assertSameSource(operation.sourceBefore, sourceAfter);
  const preparedAt = readHistoricalClock(
    operation.clock,
    "verification prepared capture",
  );
  assertD1ReleaseBudgetUtcDay(operation.utcDay, preparedAt);
  const datasets = publicDatasets(captured.datasets);
  const supplementalDatasets = publicSupplementalDatasets(
    captured.supplementalDatasets,
  );
  const operationalDatasets = captured.operationalDatasets;
  const problems = historicalVerificationProblems({
    baseline,
    hmacKeyId: captured.hmacKeyId,
    datasets,
    supplementalDatasets,
    operationalDatasets,
  });
  const authorizationEvidenceSha256 =
    operation.authorizationEvidenceSha256Provider?.() ?? null;
  const captureSha256 = historicalPreparedCaptureSha256({
    hmacKeyId: captured.hmacKeyId,
    rowsRead: captured.rowsRead,
    datasets,
    supplementalDatasets,
    operationalDatasets,
  });
  const prepared = parseHistoricalDataPreparedVerification({
    kind: HISTORICAL_DATA_FINAL_VERIFICATION_PREPARED_KIND,
    schemaVersion: 1,
    phase: "verification-prepared",
    preparedAt: preparedAt.toISOString(),
    utcDay: operation.utcDay,
    operationId: operation.operationId,
    backupDir: operation.backupDir,
    database: D1_DATABASE_NAME,
    accountingParentOperationId:
      operation.accountingParentOperationId ?? null,
    candidateVersionId: operation.candidateVersionId ?? null,
    authorizationEvidenceSha256,
    hmacKeyId: captured.hmacKeyId,
    sourceFingerprint: sourceAfter,
    baselineCreatedAt: baseline.createdAt,
    ...(baseline.baselineEvidence
      ? { baselineEvidence: baseline.baselineEvidence }
      : {}),
    rowsRead: captured.rowsRead,
    rowsWritten: 0,
    usage: operation.usage,
    maximumReservation: operation.maximumReservation,
    problems,
    captureSha256,
    datasets,
    supplementalDatasets,
    operationalDatasets,
  });
  if (operation.persistPreparedVerification) {
    const result = operation.persistPreparedVerification(prepared);
    if (result !== undefined || isThenable(result)) {
      throw new Error(
        "Historical preservation prepared-capture persistence must complete synchronously without a return value.",
      );
    }
  }
  return finalizeHistoricalDataPreparedVerification({
    prepared,
    hmacSecret,
    expectedSourceFingerprint: sourceAfter,
    now: readHistoricalClock(operation.clock, "verification finalization"),
  });
}

export function finalizeHistoricalDataPreparedVerification(input: Readonly<{
  prepared: unknown;
  hmacSecret: string;
  expectedSourceFingerprint: SourceFingerprint;
  now?: Date;
}>): HistoricalDataVerificationReport {
  const prepared = parseHistoricalDataPreparedVerification(input.prepared);
  const secret = requireHistoricalHmacSecret(input.hmacSecret);
  assertValidSourceFingerprint(input.expectedSourceFingerprint);
  assertSameSource(prepared.sourceFingerprint, input.expectedSourceFingerprint);
  if (historicalDataHmacKeyId(secret) !== prepared.hmacKeyId) {
    throw new Error(
      "Historical preservation prepared capture requires its exact HMAC key.",
    );
  }
  const finalizedAt = input.now ?? new Date();
  if (!Number.isFinite(finalizedAt.getTime())) {
    throw new Error("Historical preservation requires a valid finalization clock.");
  }
  if (finalizedAt.getTime() < Date.parse(prepared.preparedAt)) {
    throw new Error(
      "Historical preservation prepared capture cannot finalize before it was created.",
    );
  }
  assertD1ReleaseBudgetUtcDay(prepared.utcDay, finalizedAt);
  assertPreparedHistoricalVerificationLedgerIsLive(prepared);
  const ledger = reserveD1ReleaseBudget({
    backupDir: prepared.backupDir,
    operationId: prepared.operationId,
    operation: historicalOperationName("verification"),
    sourceFingerprint: compactSourceFingerprint(prepared.sourceFingerprint),
    ...(prepared.candidateVersionId
      ? { candidateVersionId: prepared.candidateVersionId }
      : {}),
    ...(prepared.accountingParentOperationId
      ? { accountingParentOperationId: prepared.accountingParentOperationId }
      : {}),
    phase: "exact",
    rowsRead: prepared.rowsRead,
    rowsWritten: 0,
    observedUsage: prepared.usage,
    now: finalizedAt,
    expectedUtcDay: prepared.utcDay,
  });
  assertD1ReleaseBudgetReservation({
    ledgerPath: ledger.ledgerPath,
    utcDay: prepared.utcDay,
    operationId: prepared.operationId,
    sourceFingerprint: compactSourceFingerprint(prepared.sourceFingerprint),
    ...(prepared.candidateVersionId
      ? { candidateVersionId: prepared.candidateVersionId }
      : {}),
    ...(prepared.accountingParentOperationId
      ? { accountingParentOperationId: prepared.accountingParentOperationId }
      : {}),
    phase: "exact",
    rowsRead: prepared.rowsRead,
    rowsWritten: 0,
    now: finalizedAt,
  });
  return parseHistoricalDataVerificationReport({
    kind: HISTORICAL_DATA_PRESERVATION_KIND,
    schemaVersion: 2,
    phase: "verification",
    createdAt: finalizedAt.toISOString(),
    utcDay: prepared.utcDay,
    operationId: prepared.operationId,
    backupDir: prepared.backupDir,
    database: D1_DATABASE_NAME,
    ok: prepared.problems.length === 0,
    privacy: "hmac-sha256-no-raw-identifiers",
    hmacKeyId: prepared.hmacKeyId,
    sourceFingerprint: prepared.sourceFingerprint,
    baselineCreatedAt: prepared.baselineCreatedAt,
    ...(prepared.baselineEvidence
      ? { baselineEvidence: prepared.baselineEvidence }
      : {}),
    rowsRead: prepared.rowsRead,
    rowsWritten: 0,
    usage: prepared.usage,
    ledger,
    problems: prepared.problems,
    datasets: prepared.datasets,
    supplementalDatasets: prepared.supplementalDatasets,
    operationalDatasets: prepared.operationalDatasets,
  });
}

function assertPreparedHistoricalVerificationLedgerIsLive(
  prepared: HistoricalDataPreparedVerification,
) {
  const ledger = readD1ReleaseBudgetLedger(
    prepared.maximumReservation.ledgerPath,
  );
  const reservation = ledger.reservations.find(
    (candidate) =>
      candidate.operationId === prepared.operationId &&
      candidate.sourceFingerprint.sha256 ===
        prepared.sourceFingerprint.sha256 &&
      candidate.sourceFingerprint.fileCount ===
        prepared.sourceFingerprint.fileCount,
  );
  if (
    !reservation ||
    reservation.operation !== historicalOperationName("verification") ||
    reservation.candidateVersionId !== prepared.candidateVersionId ||
    reservation.accountingParentOperationId !==
      prepared.accountingParentOperationId ||
    reservation.maximumRowsRead !==
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT ||
    reservation.maximumRowsWritten !== 0 ||
    (reservation.phase === "maximum" &&
      (reservation.rowsRead !==
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT ||
        reservation.rowsWritten !== 0)) ||
    (reservation.phase === "exact" &&
      (reservation.rowsRead !== prepared.rowsRead ||
        reservation.rowsWritten !== 0))
  ) {
    throw new Error(
      "Historical preservation prepared capture no longer has its exact live maximum-or-finalized ledger reservation.",
    );
  }
}

export function parseHistoricalDataPreparedVerification(
  value: unknown,
): HistoricalDataPreparedVerification {
  const prepared = historicalDataPreparedVerificationSchema.parse(value);
  assertValidSourceFingerprint(prepared.sourceFingerprint);
  const compactSource = compactSourceFingerprint(prepared.sourceFingerprint);
  if (
    path.resolve(prepared.backupDir) !== prepared.backupDir ||
    prepared.operationId !==
      historicalDataBudgetOperationId("verification", compactSource) ||
    prepared.maximumReservation.ledgerPath !==
      d1ReleaseBudgetLedgerPath(prepared.backupDir, prepared.utcDay) ||
    prepared.maximumReservation.utcDay !== prepared.utcDay ||
    prepared.maximumReservation.reservation.operationId !==
      prepared.operationId ||
    prepared.maximumReservation.reservation.candidateVersionId !==
      prepared.candidateVersionId ||
    prepared.maximumReservation.reservation.updatedAt > prepared.preparedAt ||
    prepared.captureSha256 !==
      historicalPreparedCaptureSha256({
        hmacKeyId: prepared.hmacKeyId,
        rowsRead: prepared.rowsRead,
        datasets: prepared.datasets,
        supplementalDatasets: prepared.supplementalDatasets,
        operationalDatasets: prepared.operationalDatasets,
      })
  ) {
    throw new Error(
      "Historical preservation prepared capture lost its source, ledger, path, candidate, timing, or capture binding.",
    );
  }
  return prepared;
}

export function parseHistoricalDataVerificationReport(
  value: unknown,
): HistoricalDataVerificationReport {
  try {
    const report = historicalDataVerificationReportSchema.parse(value);
    assertValidSourceFingerprint(report.sourceFingerprint);
    validateHistoricalVerificationDatasetEvidence(
      report.datasets,
      report.supplementalDatasets,
    );
    validateHistoricalOperationalDatasets(report.operationalDatasets);
    const compactSource = compactSourceFingerprint(report.sourceFingerprint);
    const reservation = report.ledger.reservation;
    if (
      path.resolve(report.backupDir) !== report.backupDir ||
      report.createdAt.slice(0, 10) !== report.utcDay ||
      report.baselineCreatedAt > report.createdAt ||
      report.operationId !==
        historicalDataBudgetOperationId("verification", compactSource) ||
      report.ledger.ledgerPath !==
        d1ReleaseBudgetLedgerPath(report.backupDir, report.utcDay) ||
      report.ledger.utcDay !== report.utcDay ||
      reservation.operationId !== report.operationId ||
      reservation.rowsRead !== report.rowsRead ||
      reservation.createdAt > reservation.updatedAt ||
      reservation.createdAt.slice(0, 10) !== report.utcDay ||
      reservation.updatedAt.slice(0, 10) !== report.utcDay ||
      reservation.updatedAt > report.createdAt ||
      report.ledger.totals.rowsRead < report.rowsRead ||
      report.ledger.accountedUsage.rowsRead < report.ledger.totals.rowsRead ||
      report.ledger.accountedUsage.rowsWritten <
        report.ledger.totals.rowsWritten ||
      report.ok !== (report.problems.length === 0)
    ) {
      throw new Error("Invalid historical verification linkage.");
    }
    return report;
  } catch {
    throw new Error(
      "Historical preservation verification report is invalid or inconsistent.",
    );
  }
}

export function validateHistoricalDataFresh0016FinalVerificationReport(
  input: Readonly<{
    value: unknown;
    backupDir: string;
    baseline: HistoricalDataPreservationBaselineReference;
    day2Budget: HistoricalFresh0016FinalVerificationDay2Binding;
    now: Date;
  }>,
): HistoricalDataVerificationReport {
  return validateHistoricalDataFresh0016FinalVerificationReportInternal({
    ...input,
    requireSuccessfulProof: true,
  });
}

export type HistoricalFresh0016FinalVerificationEnvelopeBinding = Omit<
  HistoricalFresh0016FinalVerificationDay2Binding,
  "finalVerificationLiveTopology"
>;

export function readAndValidateHistoricalDataFresh0016FinalVerificationProof(
  input: Readonly<{
    backupDir: string;
    baseline: HistoricalDataPreservationBaselineReference;
    day2Budget: HistoricalFresh0016FinalVerificationEnvelopeBinding;
    now: Date;
  }>,
) {
  const backupDir = path.resolve(input.backupDir);
  const baselineEvidence = input.baseline.baselineEvidence;
  if (!baselineEvidence) {
    throw new Error(
      "Fresh-0016 final preservation proof requires its canonical cutover identity.",
    );
  }
  const recoveryPaths = historicalDataFinalVerificationRecoveryPaths(
    backupDir,
    baselineEvidence.cutoverRunId,
  );
  const authorization = parseHistoricalDataFinalVerificationAuthorization(
    readPrivateJsonNoFollow(
      recoveryPaths.authorization,
      HISTORICAL_DATA_REPORT_MAX_BYTES,
    ),
  );
  const day2Budget = {
    utcDay: input.day2Budget.utcDay,
    operationId: input.day2Budget.operationId,
    policySha256: input.day2Budget.policySha256,
    sourceFingerprint: input.day2Budget.sourceFingerprint,
    workerRelease: input.day2Budget.workerRelease,
    liveTopology: input.day2Budget.liveTopology,
    finalVerificationLiveTopology:
      authorization.finalVerificationLiveTopology,
    initialObservedUsage: input.day2Budget.initialObservedUsage,
    maximum: input.day2Budget.maximum,
  } satisfies HistoricalFresh0016FinalVerificationDay2Binding;
  const expectedOperationId = historicalDataBudgetOperationId(
    "verification",
    compactSourceFingerprint(input.baseline.sourceFingerprint),
  );
  assertFresh0016FinalVerificationAuthorizationBindings({
    authorization,
    baseline: input.baseline,
    day2Budget,
    expectedOperationId,
  });
  const reportPath = historicalDataReportPath(backupDir, "verification");
  const report = validateHistoricalDataFresh0016FinalVerificationReport({
    value: readPrivateJsonNoFollow(
      reportPath,
      HISTORICAL_DATA_REPORT_MAX_BYTES,
    ),
    backupDir,
    baseline: input.baseline,
    day2Budget,
    now: input.now,
  });
  if (Date.parse(authorization.createdAt) > Date.parse(report.createdAt)) {
    throw new Error(
      "Fresh-0016 final preservation proof predates its durable D1 authorization.",
    );
  }
  return Object.freeze({
    authorizationPath: recoveryPaths.authorization,
    reportPath,
    report,
    finalVerificationLiveTopology:
      authorization.finalVerificationLiveTopology,
  });
}

function validateHistoricalDataFresh0016FinalVerificationReportInternal(
  input: Readonly<{
    value: unknown;
    backupDir: string;
    baseline: HistoricalDataPreservationBaselineReference;
    day2Budget: HistoricalFresh0016FinalVerificationDay2Binding;
    now: Date;
    requireSuccessfulProof: boolean;
  }>,
) {
  try {
    const now = new Date(input.now.getTime());
    if (!Number.isFinite(now.getTime())) {
      throw new Error("Invalid final-proof clock.");
    }
    const backupDir = path.resolve(input.backupDir);
    const report = parseHistoricalDataVerificationReport(input.value);
    const baselineEvidence = historicalBaselineEvidenceSchema.parse(
      input.baseline.baselineEvidence,
    );
    const baselineCreatedAt = canonicalTimestampSchema.parse(
      input.baseline.createdAt,
    );
    const day2UtcDay = utcDaySchema.parse(input.day2Budget.utcDay);
    const day2Source = compactSourceFingerprintSchema.parse(
      input.day2Budget.sourceFingerprint,
    );
    const day2Usage = d1UsageSchema.parse(
      input.day2Budget.initialObservedUsage,
    );
    const day2WorkerRelease =
      historicalFresh0016UploadedInactiveWorkerReleaseSchema.parse(
        input.day2Budget.workerRelease,
      );
    const day2LiveTopology =
      historicalFresh0016BaselineLiveTopologySchema.parse(
        input.day2Budget.liveTopology,
      );
    const finalVerificationLiveTopology =
      historicalFresh0016FinalLiveTopologySchema.parse(
        input.day2Budget.finalVerificationLiveTopology,
      );
    assertValidSourceFingerprint(input.baseline.sourceFingerprint);
    validateHistoricalProtectedDatasetEvidence(
      input.baseline.datasets,
      input.baseline.supplementalDatasets,
    );
    validateHistoricalOperationalDatasets(input.baseline.operationalDatasets);
    const compactReportSource = compactSourceFingerprint(
      report.sourceFingerprint,
    );
    const expectedOperationId = historicalDataBudgetOperationId(
      "verification",
      compactReportSource,
    );
    const createdAtMs = Date.parse(report.createdAt);
    const nowMs = now.getTime();
    const exactProblems = historicalVerificationProblems({
      baseline: input.baseline,
      hmacKeyId: report.hmacKeyId,
      datasets: report.datasets,
      supplementalDatasets: report.supplementalDatasets,
      operationalDatasets: report.operationalDatasets,
    });
    if (
      report.backupDir !== backupDir ||
      report.utcDay !== day2UtcDay ||
      report.createdAt.slice(0, 10) !== day2UtcDay ||
      createdAtMs > nowMs ||
      nowMs - createdAtMs >
        HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS ||
      baselineCreatedAt > report.createdAt ||
      report.baselineCreatedAt !== baselineCreatedAt ||
      stableStringify(report.baselineEvidence ?? null) !==
        stableStringify(baselineEvidence) ||
      stableStringify(report.sourceFingerprint) !==
        stableStringify(input.baseline.sourceFingerprint) ||
      compactReportSource.sha256 !== day2Source.sha256 ||
      compactReportSource.fileCount !== day2Source.fileCount ||
      report.hmacKeyId !== input.baseline.hmacKeyId ||
      baselineEvidence.policySha256 !== input.day2Budget.policySha256 ||
      report.operationId !== expectedOperationId ||
      stableStringify(report.usage) !== stableStringify(day2Usage) ||
      report.ledger.ledgerPath !== input.day2Budget.maximum.ledger.ledgerPath ||
      report.ledger.reservation.candidateVersionId !==
        day2WorkerRelease.targetCandidateVersionId ||
      stableStringify(day2LiveTopology.workerRelease) !==
        stableStringify(day2WorkerRelease) ||
      stableStringify(finalVerificationLiveTopology.workerRelease) !==
        stableStringify(day2WorkerRelease) ||
      Date.parse(finalVerificationLiveTopology.activationEvidence.createdAt) <=
        Date.parse(day2LiveTopology.observedAt) ||
      Date.parse(finalVerificationLiveTopology.observedAt) <=
        Date.parse(day2LiveTopology.observedAt) ||
      Date.parse(finalVerificationLiveTopology.observedAt) > createdAtMs ||
      Date.parse(finalVerificationLiveTopology.observedAt) > nowMs ||
      stableStringify(report.problems) !== stableStringify(exactProblems) ||
      report.ok !== (exactProblems.length === 0) ||
      (input.requireSuccessfulProof && report.ok !== true)
    ) {
      throw new Error("Invalid final-proof binding.");
    }
    const liveLedger = assertD1ReleaseBudgetReservation({
      ledgerPath: report.ledger.ledgerPath,
      utcDay: report.utcDay,
      operationId: report.operationId,
      sourceFingerprint: compactReportSource,
      candidateVersionId:
        day2WorkerRelease.targetCandidateVersionId,
      accountingParentOperationId: input.day2Budget.operationId,
      phase: "exact",
      rowsRead: report.rowsRead,
      rowsWritten: 0,
      now,
    });
    if (
      stableStringify(report.ledger.reservation) !==
        stableStringify(liveLedger.reservation) ||
      report.ledger.revision > liveLedger.revision
    ) {
      throw new Error("Invalid final-proof live reservation.");
    }
    return report;
  } catch {
    throw new Error(
      "Fresh-0016 final preservation proof is invalid or inconsistent.",
    );
  }
}

function parseHistoricalDataFinalVerificationAuthorization(
  value: unknown,
): HistoricalDataFinalVerificationAuthorization {
  return historicalDataFinalVerificationAuthorizationSchema.parse(value);
}

function historicalPreparedCaptureSha256(input: Readonly<{
  hmacKeyId: string;
  rowsRead: number;
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >;
  operationalDatasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >;
}>) {
  return createHash()
    .update(stableStringify({
      snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
      hmacKeyId: input.hmacKeyId,
      rowsRead: input.rowsRead,
      rowsWritten: 0,
      datasets: input.datasets,
      supplementalDatasets: input.supplementalDatasets,
      operationalDatasets: input.operationalDatasets,
    }))
    .digest("hex");
}

function historicalVerificationProblems(input: Readonly<{
  baseline: HistoricalDataPreservationBaselineReference;
  hmacKeyId: string;
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >;
  operationalDatasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >;
}>) {
  const problems: string[] = [];
  if (input.hmacKeyId !== input.baseline.hmacKeyId) {
    problems.push("The preservation HMAC key does not match the baseline key.");
  }
  for (const name of HISTORICAL_DATASET_NAMES) {
    appendHistoricalDatasetProblems(
      name,
      input.baseline.datasets[name],
      input.datasets[name],
      problems,
    );
  }
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    appendHistoricalDatasetProblems(
      name,
      input.baseline.supplementalDatasets[name],
      input.supplementalDatasets[name],
      problems,
    );
  }
  for (const name of HISTORICAL_OPERATIONAL_DATASET_NAMES) {
    const baselineDataset = input.baseline.operationalDatasets[name];
    const current = input.operationalDatasets[name];
    const currentColumns = new Set(current.columns.map(columnIdentity));
    for (const column of baselineDataset.columns) {
      if (!currentColumns.has(columnIdentity(column))) {
        problems.push(
          `${name} lost or changed baseline operational column ${column.name}.`,
        );
      }
    }
  }
  return problems;
}

function appendHistoricalDatasetProblems(
  name: HistoricalProtectedDatasetName,
  baseline: HistoricalDatasetEvidence,
  current: HistoricalDatasetEvidence,
  problems: string[],
) {
  if (current.rowCount < baseline.rowCount) {
    problems.push(
      `${name} row count decreased: ${current.rowCount} < ${baseline.rowCount}.`,
    );
  }
  const currentColumns = new Set(current.columns.map(columnIdentity));
  for (const column of baseline.columns) {
    if (!currentColumns.has(columnIdentity(column))) {
      problems.push(`${name} lost or changed baseline column ${column.name}.`);
    }
  }
  const currentSentinels = new Set(current.sentinels);
  for (const sentinel of baseline.sentinels) {
    if (!currentSentinels.has(sentinel)) {
      problems.push(`${name} is missing a baseline identity sentinel.`);
    }
  }
  if (
    stableStringify(current.schemaObjects ?? null) !==
      stableStringify(baseline.schemaObjects ?? null)
  ) {
    problems.push(`${name} changed its protected schema-object identity.`);
  }
}

function isThenable(value: unknown) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
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
  const validatedReport = report.phase === "verification"
    ? parseHistoricalDataVerificationReport(report)
    : report;
  const outputPath = historicalDataReportPath(backupDir, validatedReport.phase);
  ensureHistoricalEvidenceDirectory(path.dirname(outputPath));
  writePrivateJsonDurably(outputPath, validatedReport, {
    replace: pathEntryExists(outputPath),
  });
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

function historicalDataFinalVerificationRecoveryPaths(
  backupDir: string,
  cutoverRunId: string,
) {
  const runId = historicalBaselineEvidenceSchema.shape.cutoverRunId.parse(
    cutoverRunId,
  );
  const directory = path.join(path.resolve(backupDir), "cloudflare");
  const prefix = `historical-data-fresh-0016-final-verifier-${runId}`;
  return Object.freeze({
    authorization: path.join(directory, `${prefix}-authorization.json`),
    prepared: path.join(directory, `${prefix}-prepared.json`),
  });
}

export function readHistoricalDataFresh0016FinalVerificationAuthorizationIfPresent(
  input: Readonly<{
    backupDir: string;
    cutoverRunId: string;
  }>,
) {
  const authorizationPath = historicalDataFinalVerificationRecoveryPaths(
    input.backupDir,
    input.cutoverRunId,
  ).authorization;
  if (!pathEntryExists(authorizationPath)) return null;
  return parseHistoricalDataFinalVerificationAuthorization(
    readPrivateJsonNoFollow(
      authorizationPath,
      HISTORICAL_DATA_REPORT_MAX_BYTES,
    ),
  );
}

export function assertHistoricalDataFresh0016FinalVerificationReplayTopology(
  input: Readonly<{
    currentCheckedTopology: HistoricalFresh0016FinalLiveTopology;
    proofTopology: HistoricalFresh0016FinalLiveTopology;
  }>,
) {
  const currentCheckedTopology =
    historicalFresh0016FinalLiveTopologySchema.parse(
      input.currentCheckedTopology,
    );
  const proofTopology = historicalFresh0016FinalLiveTopologySchema.parse(
    input.proofTopology,
  );
  if (
    stableStringify(proofTopology) !==
      stableStringify(currentCheckedTopology)
  ) {
    throw new Error(
      "Fresh-0016 final-proof replay authorization changed after its current candidate-active topology check.",
    );
  }
  return proofTopology;
}

function historicalDataFinalVerificationAuthorizationSha256(
  authorization: HistoricalDataFinalVerificationAuthorization,
) {
  return createHash()
    .update(stableStringify(
      parseHistoricalDataFinalVerificationAuthorization(authorization),
    ))
    .digest("hex");
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
  accountingParentOperationId: string | undefined;
  candidateVersionId: string | undefined;
  maximumReservation: D1ReleaseBudgetReservationResult;
  authorizeLastPreD1: (() => void) | undefined;
  authorizationEvidenceSha256Provider: (() => string) | undefined;
  persistPreparedVerification:
    | ((prepared: HistoricalDataPreparedVerification) => void)
    | undefined;
};

function startHistoricalOperation(
  phase: "baseline" | "verification",
  options: HistoricalOperationOptions,
): HistoricalOperation {
  if (options.sourceFingerprint && options.sourceFingerprintProvider) {
    throw new Error("Choose one historical preservation source fingerprint input.");
  }
  const backupDir = path.resolve(options.backupDir);
  const runner = createHistoricalDataWranglerRunner(
    options.runner ?? runWrangler,
  );
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
    candidateVersionId: options.candidateVersionId,
    accountingParentOperationId: options.accountingParentOperationId,
    phase: "maximum",
    rowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    rowsWritten: 0,
    observedUsage: usage,
    now: startedAt,
    expectedUtcDay: utcDay,
  });
  if (maximumReservation.idempotent) {
    const provenPreSnapshotReplay =
      options.allowProvenPreSnapshotReservationReplay === true &&
      ((phase === "baseline" && typeof options.beforeSnapshot === "function") ||
        (phase === "verification" &&
          typeof options.authorizeLastPreD1 === "function")) &&
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
    accountingParentOperationId: options.accountingParentOperationId,
    candidateVersionId: options.candidateVersionId,
    maximumReservation,
    authorizeLastPreD1: options.authorizeLastPreD1,
    authorizationEvidenceSha256Provider:
      options.authorizationEvidenceSha256Provider,
    persistPreparedVerification: options.persistPreparedVerification,
  };
}

function finishHistoricalOperation(operation: HistoricalOperation, rowsRead: number) {
  const exactAt = readHistoricalClock(operation.clock, `${operation.phase} exact reservation`);
  const ledger = reserveD1ReleaseBudget({
    backupDir: operation.backupDir,
    operationId: operation.operationId,
    operation: historicalOperationName(operation.phase),
    sourceFingerprint: operation.sourceIdentity,
    candidateVersionId: operation.candidateVersionId,
    accountingParentOperationId: operation.accountingParentOperationId,
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
    candidateVersionId: operation.candidateVersionId,
    accountingParentOperationId: operation.accountingParentOperationId,
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

export type HistoricalFresh0016FinalVerificationContext = Readonly<{
  evidence: HistoricalFresh0016FinalVerificationDay2Binding;
  refineAfterFinalProof: (input: Readonly<{
    finalProofPath: string;
    finalProofCanonicalValueSha256: string;
    now: Date;
  }>) => void;
}>;

export type HistoricalDataPreservationCliDependencies = Readonly<{
  readFresh0016PreservationReference: (input: Readonly<{
    backupDir: string;
    cwd: string;
    now: Date;
  }>) =>
    | HistoricalDataPreservationBaselineReference
    | Promise<HistoricalDataPreservationBaselineReference>;
  readFresh0016FinalVerificationContext: (input: Readonly<{
    backupDirectory: string;
    cutoverRunId: string;
    now: Date;
  }>) => HistoricalFresh0016FinalVerificationContext;
  canonicalFresh0016JsonSha256: (value: unknown) => string;
}>;

export async function runHistoricalDataPreservationCli(
  dependencies: HistoricalDataPreservationCliDependencies,
) {
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
  const useFresh0016CutoverBaseline = hasFlag(
    "--fresh-0016-cutover-baseline",
  );
  const backupDir = resolveBackupDir();
  if (capture) {
    if (
      !createNewKey ||
      reuseBaselineKey ||
      confirmRollover ||
      useFresh0016CutoverBaseline
    ) {
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
  if (useFresh0016CutoverBaseline) {
    const cwd = process.cwd();
    const now = new Date();
    const baseline = await dependencies.readFresh0016PreservationReference({
      backupDir,
      cwd,
      now,
    });
    if (!baseline.baselineEvidence) {
      throw new Error(
        "Fresh-0016 final verification requires its canonical cutover identity.",
      );
    }
    const day2Budget =
      dependencies.readFresh0016FinalVerificationContext({
      backupDirectory: backupDir,
      cutoverRunId: baseline.baselineEvidence.cutoverRunId,
      now,
    });
    const existingReportPath = historicalDataReportPath(
      backupDir,
      "verification",
    );
    if (pathEntryExists(existingReportPath)) {
      const existingProof =
        readAndValidateHistoricalDataFresh0016FinalVerificationProof({
          backupDir,
          baseline,
          day2Budget: day2Budget.evidence,
          now,
        });
      assertHistoricalDataFresh0016FinalVerificationReplayTopology({
        currentCheckedTopology:
          day2Budget.evidence.finalVerificationLiveTopology,
        proofTopology: existingProof.finalVerificationLiveTopology,
      });
      const verifiedExisting = existingProof.report;
      day2Budget.refineAfterFinalProof({
        finalProofPath: existingReportPath,
        finalProofCanonicalValueSha256:
          dependencies.canonicalFresh0016JsonSha256(verifiedExisting),
        now: new Date(),
      });
      console.log(JSON.stringify({
        kind: verifiedExisting.kind,
        phase: verifiedExisting.phase,
        baselineKind: "fresh-0016-canonical-successor",
        ok: verifiedExisting.ok,
        createdAt: verifiedExisting.createdAt,
        utcDay: verifiedExisting.utcDay,
        operationId: verifiedExisting.operationId,
        problemCount: verifiedExisting.problems.length,
        reportPath: existingReportPath,
        recoveredFromDurableFinalProof: true,
      }, null, 2));
      return;
    }
    const secret = (await readHistoricalDataHmacKey(baseline.hmacKeyId)).secret;
    const recoveryPaths = historicalDataFinalVerificationRecoveryPaths(
      backupDir,
      baseline.baselineEvidence.cutoverRunId,
    );
    const authorizationExists = pathEntryExists(recoveryPaths.authorization);
    const preparedExists = pathEntryExists(recoveryPaths.prepared);
    if (preparedExists && !authorizationExists) {
      throw new Error(
        "Fresh-0016 final-verifier prepared capture has no last-pre-D1 authorization evidence.",
      );
    }
    const expectedOperationId = historicalDataBudgetOperationId(
      "verification",
      compactSourceFingerprint(baseline.sourceFingerprint),
    );
    if (authorizationExists) {
      const authorization = parseHistoricalDataFinalVerificationAuthorization(
        readPrivateJsonNoFollow(
          recoveryPaths.authorization,
          HISTORICAL_DATA_REPORT_MAX_BYTES,
        ),
      );
      assertFresh0016FinalVerificationAuthorizationBindings({
        authorization,
        baseline,
        day2Budget: day2Budget.evidence,
        expectedOperationId,
      });
      if (!preparedExists) {
        throw new Error(
          "Fresh-0016 final-verifier authorization is unresolved; D1 may have started, so the retained aggregate maximum requires operator resolution rather than a second snapshot.",
        );
      }
      const prepared = parseHistoricalDataPreparedVerification(
        readPrivateJsonNoFollow(
          recoveryPaths.prepared,
          HISTORICAL_DATA_REPORT_MAX_BYTES,
        ),
      );
      const authorizationSha256 =
        historicalDataFinalVerificationAuthorizationSha256(authorization);
      assertFresh0016FinalVerificationPreparedBindings({
        prepared,
        authorization,
        authorizationSha256,
        baseline,
        day2Budget: day2Budget.evidence,
      });
      const recoveredReport = finalizeHistoricalDataPreparedVerification({
        prepared,
        hmacSecret: secret,
        expectedSourceFingerprint: baseline.sourceFingerprint,
        now: new Date(),
      });
      const verifiedRecoveredReport =
        validateHistoricalDataFresh0016FinalVerificationReportInternal({
          value: recoveredReport,
          backupDir,
          baseline,
          day2Budget: day2Budget.evidence,
          now: new Date(),
          requireSuccessfulProof: false,
        });
      const recoveredReportPath = writeHistoricalDataReport(
        backupDir,
        verifiedRecoveredReport,
      );
      if (verifiedRecoveredReport.ok) {
        day2Budget.refineAfterFinalProof({
          finalProofPath: recoveredReportPath,
          finalProofCanonicalValueSha256:
            dependencies.canonicalFresh0016JsonSha256(
              verifiedRecoveredReport,
            ),
          now: new Date(),
        });
      }
      console.log(JSON.stringify({
        kind: verifiedRecoveredReport.kind,
        phase: verifiedRecoveredReport.phase,
        baselineKind: "fresh-0016-canonical-successor",
        ok: verifiedRecoveredReport.ok,
        createdAt: verifiedRecoveredReport.createdAt,
        utcDay: verifiedRecoveredReport.utcDay,
        operationId: verifiedRecoveredReport.operationId,
        problemCount: verifiedRecoveredReport.problems.length,
        reportPath: recoveredReportPath,
        recoveredFromDurablePreparedCapture: true,
      }, null, 2));
      if (!verifiedRecoveredReport.ok) process.exitCode = 1;
      return;
    }
    const operationState: { value?: HistoricalOperation } = {};
    let authorizationSha256: string | undefined;
    const authorizeLastPreD1 = () => {
      const currentOperation = operationState.value;
      if (!currentOperation) {
        throw new Error(
          "Fresh-0016 final-verifier operation is unavailable at authorization.",
        );
      }
      const authorizedAt = new Date();
      assertD1ReleaseBudgetUtcDay(currentOperation.utcDay, authorizedAt);
      const authorization = parseHistoricalDataFinalVerificationAuthorization({
        kind: HISTORICAL_DATA_FINAL_VERIFICATION_AUTHORIZATION_KIND,
        schemaVersion: 3,
        phase: "final-verifier-authorized",
        d1ExecutionMayStart: true,
        createdAt: authorizedAt.toISOString(),
        utcDay: currentOperation.utcDay,
        cutoverRunId: baseline.baselineEvidence?.cutoverRunId,
        policySha256: baseline.baselineEvidence?.policySha256,
        operationId: currentOperation.operationId,
        accountingParentOperationId: day2Budget.evidence.operationId,
        sourceFingerprint: currentOperation.sourceIdentity,
        workerRelease: day2Budget.evidence.workerRelease,
        finalVerificationLiveTopology:
          day2Budget.evidence.finalVerificationLiveTopology,
        hmacKeyId: baseline.hmacKeyId,
        snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
        canonicalArtifactSha256:
          baseline.baselineEvidence?.canonicalArtifactSha256,
        successorReportSha256:
          baseline.baselineEvidence?.successorReportSha256,
        maximumReservationRevision:
          currentOperation.maximumReservation.revision,
        maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
        maximumRowsWritten: 0,
      });
      assertFresh0016FinalVerificationAuthorizationBindings({
        authorization,
        baseline,
        day2Budget: day2Budget.evidence,
        expectedOperationId,
      });
      writePrivateJsonDurably(
        recoveryPaths.authorization,
        authorization,
        { replace: false },
      );
      const stored = parseHistoricalDataFinalVerificationAuthorization(
        readPrivateJsonNoFollow(
          recoveryPaths.authorization,
          HISTORICAL_DATA_REPORT_MAX_BYTES,
        ),
      );
      authorizationSha256 =
        historicalDataFinalVerificationAuthorizationSha256(stored);
    };
    const operation = startHistoricalOperation("verification", {
      backupDir,
      cwd,
      hmacSecret: secret,
      accountingParentOperationId: day2Budget.evidence.operationId,
      candidateVersionId:
        day2Budget.evidence.workerRelease.targetCandidateVersionId,
      authorizeLastPreD1,
      authorizationEvidenceSha256Provider: () => {
        if (!authorizationSha256) {
          throw new Error(
            "Fresh-0016 final-verifier authorization evidence was not durably published before D1.",
          );
        }
        return authorizationSha256;
      },
      persistPreparedVerification: (prepared) => {
        const authorization = parseHistoricalDataFinalVerificationAuthorization(
          readPrivateJsonNoFollow(
            recoveryPaths.authorization,
            HISTORICAL_DATA_REPORT_MAX_BYTES,
          ),
        );
        assertFresh0016FinalVerificationPreparedBindings({
          prepared,
          authorization,
          authorizationSha256:
            historicalDataFinalVerificationAuthorizationSha256(authorization),
          baseline,
          day2Budget: day2Budget.evidence,
        });
        writePrivateJsonDurably(recoveryPaths.prepared, prepared, {
          replace: false,
        });
      },
      allowProvenPreSnapshotReservationReplay: true,
      usageLoader: () => ({
        ...day2Budget.evidence.initialObservedUsage,
      }),
    });
    operationState.value = operation;
    const report = finishHistoricalDataPreservationVerification({
      operation,
      baseline,
      hmacSecret: secret,
    });
    const verifiedReport =
      validateHistoricalDataFresh0016FinalVerificationReportInternal({
        value: report,
        backupDir,
        baseline,
        day2Budget: day2Budget.evidence,
        now: new Date(),
        requireSuccessfulProof: false,
      });
    const reportPath = writeHistoricalDataReport(backupDir, verifiedReport);
    if (verifiedReport.ok) {
      day2Budget.refineAfterFinalProof({
        finalProofPath: reportPath,
        finalProofCanonicalValueSha256:
          dependencies.canonicalFresh0016JsonSha256(verifiedReport),
        now: new Date(),
      });
    }
    console.log(JSON.stringify({
      kind: verifiedReport.kind,
      phase: verifiedReport.phase,
      baselineKind: "fresh-0016-canonical-successor",
      ok: verifiedReport.ok,
      createdAt: verifiedReport.createdAt,
      utcDay: verifiedReport.utcDay,
      operationId: verifiedReport.operationId,
      problemCount: verifiedReport.problems.length,
      reportPath,
    }, null, 2));
    if (!verifiedReport.ok) process.exitCode = 1;
    return;
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

export type HistoricalFresh0016UploadedInactiveWorkerRelease = z.infer<
  typeof historicalFresh0016UploadedInactiveWorkerReleaseSchema
>;
export type HistoricalFresh0016FinalLiveTopology = z.infer<
  typeof historicalFresh0016FinalLiveTopologySchema
>;
export type HistoricalFresh0016BaselineLiveTopology = z.infer<
  typeof historicalFresh0016BaselineLiveTopologySchema
>;

export type HistoricalFresh0016FinalVerificationDay2Binding = Readonly<{
  utcDay: string;
  operationId: string;
  policySha256: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  workerRelease: HistoricalFresh0016UploadedInactiveWorkerRelease;
  liveTopology: HistoricalFresh0016BaselineLiveTopology;
  finalVerificationLiveTopology: HistoricalFresh0016FinalLiveTopology;
  initialObservedUsage: D1DailyUsage;
  maximum: Readonly<{
    ledger: Readonly<{ ledgerPath: string }>;
  }>;
}>;

function assertFresh0016FinalVerificationAuthorizationBindings(input: Readonly<{
  authorization: HistoricalDataFinalVerificationAuthorization;
  baseline: HistoricalDataPreservationBaselineReference;
  day2Budget: HistoricalFresh0016FinalVerificationDay2Binding;
  expectedOperationId: string;
}>) {
  const baselineEvidence = input.baseline.baselineEvidence;
  if (
    !baselineEvidence ||
    input.authorization.utcDay !== input.day2Budget.utcDay ||
    input.authorization.createdAt.slice(0, 10) !== input.day2Budget.utcDay ||
    input.authorization.cutoverRunId !== baselineEvidence.cutoverRunId ||
    input.authorization.policySha256 !== baselineEvidence.policySha256 ||
    input.authorization.policySha256 !== input.day2Budget.policySha256 ||
    input.authorization.operationId !== input.expectedOperationId ||
    input.authorization.accountingParentOperationId !==
      input.day2Budget.operationId ||
    input.authorization.sourceFingerprint.sha256 !==
      input.day2Budget.sourceFingerprint.sha256 ||
    input.authorization.sourceFingerprint.fileCount !==
      input.day2Budget.sourceFingerprint.fileCount ||
    stableStringify(input.authorization.workerRelease) !==
      stableStringify(input.day2Budget.workerRelease) ||
    stableStringify(input.authorization.finalVerificationLiveTopology) !==
      stableStringify(input.day2Budget.finalVerificationLiveTopology) ||
    stableStringify(
      input.authorization.finalVerificationLiveTopology.workerRelease,
    ) !== stableStringify(input.day2Budget.workerRelease) ||
    Date.parse(input.authorization.finalVerificationLiveTopology.observedAt) >
      Date.parse(input.authorization.createdAt) ||
    Date.parse(input.authorization.createdAt) -
      Date.parse(input.authorization.finalVerificationLiveTopology.observedAt) >
      5 * 60 * 1_000 ||
    Date.parse(input.day2Budget.finalVerificationLiveTopology.observedAt) <=
      Date.parse(input.day2Budget.liveTopology.observedAt) ||
    Date.parse(
      input.day2Budget.finalVerificationLiveTopology.activationEvidence
        .createdAt,
    ) <= Date.parse(input.day2Budget.liveTopology.observedAt) ||
    input.authorization.hmacKeyId !== input.baseline.hmacKeyId ||
    input.authorization.snapshotPlanSha256 !==
      HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256 ||
    input.authorization.canonicalArtifactSha256 !==
      baselineEvidence.canonicalArtifactSha256 ||
    input.authorization.successorReportSha256 !==
      baselineEvidence.successorReportSha256
  ) {
    throw new Error(
      "Fresh-0016 final-verifier authorization lost its canonical cutover, source, Worker, HMAC, parent-budget, or snapshot binding.",
    );
  }
}

function assertFresh0016FinalVerificationPreparedBindings(input: Readonly<{
  prepared: HistoricalDataPreparedVerification;
  authorization: HistoricalDataFinalVerificationAuthorization;
  authorizationSha256: string;
  baseline: HistoricalDataPreservationBaselineReference;
  day2Budget: HistoricalFresh0016FinalVerificationDay2Binding;
}>) {
  const baselineEvidence = input.baseline.baselineEvidence;
  const preparedEvidence = input.prepared.baselineEvidence;
  const expectedBackupDirectory = path.dirname(
    path.dirname(input.day2Budget.maximum.ledger.ledgerPath),
  );
  if (
    !baselineEvidence ||
    !preparedEvidence ||
    input.prepared.preparedAt < input.authorization.createdAt ||
    input.prepared.utcDay !== input.authorization.utcDay ||
    input.prepared.operationId !== input.authorization.operationId ||
    input.prepared.backupDir !== expectedBackupDirectory ||
    input.prepared.accountingParentOperationId !==
      input.authorization.accountingParentOperationId ||
    input.prepared.candidateVersionId !==
      input.authorization.workerRelease.targetCandidateVersionId ||
    input.prepared.authorizationEvidenceSha256 !==
      input.authorizationSha256 ||
    input.prepared.hmacKeyId !== input.authorization.hmacKeyId ||
    input.prepared.sourceFingerprint.sha256 !==
      input.authorization.sourceFingerprint.sha256 ||
    input.prepared.sourceFingerprint.fileCount !==
      input.authorization.sourceFingerprint.fileCount ||
    input.prepared.baselineCreatedAt !== input.baseline.createdAt ||
    stableStringify(preparedEvidence) !== stableStringify(baselineEvidence) ||
    input.prepared.maximumReservation.revision !==
      input.authorization.maximumReservationRevision
  ) {
    throw new Error(
      "Fresh-0016 final-verifier prepared capture lost its exact authorization, cutover, source, budget, HMAC, or baseline binding.",
    );
  }
}

function executeD1ReadOnly(
  sql: string,
  runner: WranglerRunner,
  authorizeLastPreD1?: () => void,
) {
  assertHistoricalDataSnapshotSql(sql);
  authorizeLastPreD1?.();
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
    ...historicalDataSchemaObjectStatements,
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

export function parseHistoricalGameResultsSchemaObjects(
  rows: Array<Record<string, unknown>>,
): HistoricalGameResultsSchemaObjects {
  if (rows.length === 0 || rows.length > HISTORICAL_SCHEMA_OBJECT_LIMIT) {
    throw new Error(
      "Historical preservation schema-object inventory is empty or exceeds its cap.",
    );
  }
  const identities = new Set<string>();
  let tableSql: string | null = null;
  let triggerSql: string | null = null;
  for (const row of rows) {
    if (
      !hasExactKeys(row, [
        "object_name",
        "object_type",
        "sql",
        "sql_bytes",
        "table_name",
      ]) ||
      typeof row.object_type !== "string" ||
      typeof row.object_name !== "string" ||
      typeof row.table_name !== "string"
    ) {
      throw new Error(
        "Historical preservation schema-object inventory has an invalid exact shape.",
      );
    }
    const sqlBytes = nonNegativeInteger(row.sql_bytes);
    if (
      sqlBytes === null ||
      sqlBytes > HISTORICAL_SCHEMA_OBJECT_SQL_MAX_BYTES ||
      typeof row.sql !== "string" ||
      Buffer.byteLength(row.sql, "utf8") !== sqlBytes
    ) {
      throw new Error(
        "Historical preservation schema-object DDL exceeds its byte cap or is malformed.",
      );
    }
    const identity = `${row.object_type}\0${row.object_name}`;
    if (identities.has(identity)) {
      throw new Error(
        "Historical preservation schema-object inventory contains a duplicate object.",
      );
    }
    identities.add(identity);
    if (
      row.object_type === "table" &&
      row.object_name === "game_results" &&
      row.table_name === "game_results"
    ) {
      tableSql = row.sql;
    }
    if (
      row.object_type === "trigger" &&
      row.object_name === "game_results_reject_update" &&
      row.table_name === "game_results"
    ) {
      triggerSql = row.sql;
    }
  }
  if (tableSql === null || triggerSql === null) {
    throw new Error(
      "Historical preservation game_results schema objects are incomplete.",
    );
  }
  const tableSha256 = createHash().update(tableSql, "utf8").digest("hex");
  const rejectUpdateTriggerSha256 = createHash()
    .update(triggerSql, "utf8")
    .digest("hex");
  const combinedSha256 = gameResultsSchemaObjectsCombinedSha256(
    tableSha256,
    rejectUpdateTriggerSha256,
  );
  if (
    tableSha256 !== HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256 ||
    rejectUpdateTriggerSha256 !==
      HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256 ||
    combinedSha256 !== HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256
  ) {
    throw new Error(
      "Historical preservation game_results table or immutability-trigger DDL changed.",
    );
  }
  return {
    tableSha256,
    rejectUpdateTriggerSha256,
    combinedSha256,
  };
}

function gameResultsSchemaObjectsCombinedSha256(
  tableSha256: string,
  rejectUpdateTriggerSha256: string,
) {
  return createHash()
    .update(
      stableStringify([
        {
          type: "table",
          name: "game_results",
          table: "game_results",
          sqlSha256: tableSha256,
        },
        {
          type: "trigger",
          name: "game_results_reject_update",
          table: "game_results",
          sqlSha256: rejectUpdateTriggerSha256,
        },
      ]),
    )
    .digest("hex");
}

export type HistoricalIdentityValue = string | number | null;

function identityValues(
  row: Record<string, unknown>,
  arity: DatasetSpec["identityArity"],
) {
  const values: HistoricalIdentityValue[] = [];
  for (let index = 1; index <= arity; index += 1) {
    const key = `identity_${index}`;
    if (!Object.hasOwn(row, key)) {
      throw new Error("Historical preservation identity is incomplete.");
    }
    const value = row[key];
    if (
      value !== null &&
      typeof value !== "string" &&
      !isSafeIdentityInteger(value)
    ) {
      throw new Error("Historical preservation identity contains an invalid value.");
    }
    values.push(value);
  }
  return values;
}

export function assertHistoricalGameResultsIdentity(
  values: readonly HistoricalIdentityValue[],
) {
  const valid =
    values.length === 14 &&
    typeof values[0] === "string" &&
    isSafeIdentityInteger(values[1]) &&
    values.slice(2, 8).every((value) => typeof value === "string") &&
    isSafeIdentityInteger(values[8]) &&
    typeof values[9] === "string" &&
    (values[10] === null || isSafeIdentityInteger(values[10])) &&
    isSafeIdentityInteger(values[11]) &&
    (values[12] === null || isSafeIdentityInteger(values[12])) &&
    isSafeIdentityInteger(values[13]);
  if (!valid) {
    throw new Error(
      "Historical preservation game_results identity types are invalid.",
    );
  }
  const payload = values[9];
  if (
    typeof payload !== "string" ||
    Buffer.byteLength(payload, "utf8") >
      HISTORICAL_GAME_RESULTS_IDENTITY_MAX_BYTES ||
    values.reduce<number>(
      (sum, value) => sum + identityValueByteLength(value),
      0,
    ) >
      HISTORICAL_GAME_RESULTS_IDENTITY_MAX_BYTES
  ) {
    throw new Error(
      "Historical preservation game_results identity exceeds its byte cap.",
    );
  }
}

function isSafeIdentityInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function identityValueByteLength(value: HistoricalIdentityValue) {
  if (value === null) return 0;
  return Buffer.byteLength(String(value), "utf8");
}

function hasExactKeys(row: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(row).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

export function historicalDataIdentityHmac(
  secret: string,
  dataset: HistoricalProtectedDatasetName,
  values: readonly HistoricalIdentityValue[],
) {
  const hmac = createHmac("sha256", secret);
  hmac.update("inspir-historical-identity-length-framed-v2\0", "utf8");
  updateIdentityHmacFrame(hmac, 0x64, dataset);
  for (const value of values) {
    if (value === null) {
      updateIdentityHmacFrame(hmac, 0x6e, null);
    } else if (typeof value === "string") {
      updateIdentityHmacFrame(hmac, 0x73, value);
    } else if (isSafeIdentityInteger(value)) {
      updateIdentityHmacFrame(hmac, 0x69, String(value));
    } else {
      throw new Error(
        "Historical preservation identity HMAC requires exact string, safe-integer, or null fields.",
      );
    }
  }
  return hmac.digest("hex");
}

function updateIdentityHmacFrame(
  hmac: Hmac,
  type: number,
  value: string | null,
) {
  const byteLength = value === null ? 0 : Buffer.byteLength(value, "utf8");
  const header = Buffer.allocUnsafe(9);
  header.writeUInt8(type, 0);
  header.writeBigUInt64BE(BigInt(byteLength), 1);
  hmac.update(header);
  if (value !== null) hmac.update(value, "utf8");
}

export function historicalDataSchemaHash(columns: HistoricalColumnIdentity[]) {
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
      schemaSha256: historicalDataSchemaHash(schemaColumns),
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
  validateHistoricalProtectedDatasetEvidence(
    parsed.datasets,
    parsed.supplementalDatasets,
  );
  validateHistoricalOperationalDatasets(parsed.operationalDatasets);
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
  requireRequiredNonempty = true,
) {
  for (const spec of coreDatasetSpecs) {
    const dataset = datasets[spec.name];
    if (dataset.schemaObjects !== undefined) {
      throw new Error(
        `Historical preservation baseline ${spec.name} has unexpected schema-object evidence.`,
      );
    }
    if (dataset.schemaTable !== spec.table) {
      throw new Error(`Historical preservation baseline ${spec.name} targets the wrong schema table.`);
    }
    if (dataset.rowCount > spec.cap) {
      throw new Error(`Historical preservation baseline ${spec.name} exceeds its row cap.`);
    }
    if (new Set(dataset.columns.map((column) => column.name)).size !== dataset.columns.length) {
      throw new Error(`Historical preservation baseline ${spec.name} has duplicate schema columns.`);
    }
    if (historicalDataSchemaHash(dataset.columns) !== dataset.schemaSha256) {
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
  if (requireRequiredNonempty) {
    for (const name of historicalRequiredNonemptyDatasets) {
      if (datasets[name].rowCount === 0) {
        throw new Error(
          `Historical preservation refuses an empty or wrong production database: ${name} has no rows.`,
        );
      }
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
    if (spec.name !== "game_results" && dataset.schemaObjects !== undefined) {
      throw new Error(
        `Historical preservation baseline ${spec.name} has unexpected schema-object evidence.`,
      );
    }
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
    if (historicalDataSchemaHash(dataset.columns) !== dataset.schemaSha256) {
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
  if (!hasRequiredHistoricalGameResultsSchema(datasets.game_results)) {
    throw new Error(
      "Historical preservation game_results schema is incomplete.",
    );
  }
}

const historicalGameResultsRequiredColumns: HistoricalColumnIdentity[] = [
    { name: "id", type: "text", notNull: 1, primaryKey: 1 },
    { name: "schema_version", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "game_slug", type: "text", notNull: 1, primaryKey: 0 },
    { name: "engine_id", type: "text", notNull: 1, primaryKey: 0 },
    { name: "engine_version", type: "text", notNull: 1, primaryKey: 0 },
    { name: "terminal_code", type: "text", notNull: 1, primaryKey: 0 },
    { name: "winner", type: "text", notNull: 1, primaryKey: 0 },
    { name: "outcome", type: "text", notNull: 1, primaryKey: 0 },
    { name: "ply_count", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "payload", type: "text", notNull: 1, primaryKey: 0 },
    { name: "started_at", type: "integer", notNull: 0, primaryKey: 0 },
    { name: "completed_at", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "duration_ms", type: "integer", notNull: 0, primaryKey: 0 },
    { name: "created_at", type: "integer", notNull: 1, primaryKey: 0 },
  ];
export const HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS: readonly HistoricalColumnIdentity[] =
  Object.freeze(
    historicalGameResultsRequiredColumns.map((column) =>
      Object.freeze({ ...column })
    ),
  );

export function hasRequiredHistoricalGameResultsSchema(
  dataset: HistoricalDatasetEvidence,
) {
  const schemaObjects = dataset.schemaObjects;
  if (
    dataset.schemaTable !== "game_results" ||
    dataset.columns.length !== HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.length ||
    schemaObjects?.tableSha256 !==
      HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256 ||
    schemaObjects?.rejectUpdateTriggerSha256 !==
      HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256 ||
    schemaObjects?.combinedSha256 !==
      HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256
  ) {
    return false;
  }
  const actualColumns = new Set(dataset.columns.map(columnIdentity));
  return actualColumns.size === HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.length &&
    HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.every((column) =>
      actualColumns.has(columnIdentity(column))
    );
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

export function validateHistoricalOperationalDatasets(
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
  if (historicalDataSchemaHash(dataset.columns) !== dataset.schemaSha256) {
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

export function validateHistoricalProtectedDatasetEvidence(
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>,
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >,
) {
  validateHistoricalDatasets(datasets);
  validateHistoricalSupplementalDatasets(supplementalDatasets);
  validateHistoricalCrossDatasetInvariants(datasets, supplementalDatasets);
}

function validateHistoricalVerificationDatasetEvidence(
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>,
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >,
) {
  validateHistoricalDatasets(datasets, false);
  validateHistoricalSupplementalDatasets(supplementalDatasets);
  validateHistoricalCrossDatasetInvariants(datasets, supplementalDatasets);
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
    if (first < 0 || last <= first) {
      throw new Error(
        "Historical preservation could not parse Wrangler JSON.",
      );
    }
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
    } catch {
      throw new Error(
        "Historical preservation could not parse Wrangler JSON.",
      );
    }
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

function deepFreezeHistoricalSnapshotEvidence(value: unknown) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) deepFreezeHistoricalSnapshotEvidence(entry);
  } else {
    for (const entry of Object.values(value)) {
      deepFreezeHistoricalSnapshotEvidence(entry);
    }
  }
  Object.freeze(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
