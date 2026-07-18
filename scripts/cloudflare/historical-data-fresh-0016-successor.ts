import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
  type D1ReleaseBudgetReservationResult,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  assertHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  historicalFresh0016LiveTopologyEvidenceSchema,
  type HistoricalFresh0016LiveTopologyEvidence,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  parseHistoricalFresh0016PredecessorReport,
  type HistoricalFresh0016PredecessorReport,
} from "./historical-data-fresh-0016-predecessor";
import { requireHistoricalHmacSecret } from "./historical-data-hmac-key";
import { createHistoricalDataWranglerRunner } from "./historical-data-wrangler-runner";
import {
  stableStringify,
  type WranglerRunner,
} from "./migration-config";
import {
  canonicalProductionValidationLockOwner,
  parseProductionValidationLockOwner,
  type ProductionValidationLockOwner,
} from "./production-validation-lock";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";
import {
  historicalFresh0016RuntimeVerificationReportSchema,
  type HistoricalFresh0016RuntimeVerificationReport,
} from "./verify-historical-data-fresh-0016-migration";
import {
  HISTORICAL_CORE_ROW_LIMIT,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_COUNT_RESULT_SET_COUNT,
  HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT,
  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT,
  HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT,
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
  HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
  HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
  HISTORICAL_BILLED_READ_LIMIT,
  HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256,
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256,
  HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256,
  HISTORICAL_OPERATIONAL_DATASET_NAMES,
  HISTORICAL_OPERATIONAL_ROW_LIMIT,
  HISTORICAL_PROTECTED_DATASET_COUNT,
  HISTORICAL_SCHEMA_COLUMN_LIMIT,
  HISTORICAL_SENTINEL_LIMIT,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
  captureHistoricalDataV2SnapshotEvidence,
  hasRequiredHistoricalMemoryVectorCleanupOutboxSchema,
  historicalDataHmacKeyId,
  historicalDataSchemaHash,
  validateHistoricalProtectedDatasetEvidence,
  type HistoricalDataV2SnapshotEvidence,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalOperationalDatasetEvidence,
  type HistoricalSupplementalDatasetName,
} from "./verify-historical-data-preservation";

export const HISTORICAL_FRESH_0016_SUCCESSOR_KIND =
  "inspir-historical-data-fresh-0016-successor-v2" as const;
export const HISTORICAL_FRESH_0016_SUCCESSOR_PREPARED_CAPTURE_KIND =
  "inspir-historical-data-fresh-0016-successor-prepared-capture-v2" as const;
export const HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME =
  "11a-successor-report.json" as const;
export const HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME =
  "Fresh 0016 post-migration historical successor capture" as const;
export const HISTORICAL_FRESH_0016_SUCCESSOR_MAXIMUM_BYTES =
  2 * 1024 * 1024;

const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const operationIdPattern = /^historical-fresh-0016-successor:[a-f0-9]{64}$/;

const safeNonnegativeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a nonnegative safe integer.",
);
const safePositiveIntegerSchema = safeNonnegativeIntegerSchema.refine(
  (value) => value > 0,
  "Expected a positive safe integer.",
);
const sha256Schema = z.string().regex(sha256Pattern);
const uuidSchema = z.string().regex(uuidPattern);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical ISO timestamp.");
const utcDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) =>
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  "Expected a valid UTC day.",
);
const normalizedAbsolutePathSchema = z.string().min(1).max(4_096).refine(
  (value) =>
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    !/[\u0000-\u001f\u007f]/.test(value),
  "Expected a normalized absolute path.",
);
const sourceIdentitySchema = z.object({
  sha256: sha256Schema,
  fileCount: safePositiveIntegerSchema,
}).strict();
const uploadedInactiveWorkerReleaseSchema = z.object({
  phase: z.literal("uploaded-inactive"),
  targetCandidateVersionId: uuidSchema,
  serviceBaselineVersionId: uuidSchema,
  uploadEvidenceSha256: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.targetCandidateVersionId === value.serviceBaselineVersionId) {
    context.addIssue({
      code: "custom",
      message: "The fresh-0016 successor candidate must differ from the serving baseline.",
    });
  }
});
const columnSchema = z.object({
  name: z.string().min(1).max(256),
  type: z.string().max(256),
  notNull: z.union([z.literal(0), z.literal(1)]),
  primaryKey: safeNonnegativeIntegerSchema,
}).strict();
const gameResultsSchemaObjectsSchema = z.object({
  tableSha256: z.literal(HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256),
  rejectUpdateTriggerSha256: z.literal(
    HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256,
  ),
  combinedSha256: z.literal(HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256),
}).strict();
const datasetEvidenceSchema = z.object({
  rowCount: safeNonnegativeIntegerSchema,
  schemaTable: z.string().min(1).max(128),
  schemaSha256: sha256Schema,
  columns: z.array(columnSchema).min(1).max(HISTORICAL_SCHEMA_COLUMN_LIMIT),
  sentinels: z.array(sha256Schema).max(HISTORICAL_SENTINEL_LIMIT),
  schemaObjects: gameResultsSchemaObjectsSchema.optional(),
}).strict();
const operationalDatasetEvidenceSchema = z.object({
  lifecycle: z.literal("mutable-drainable-outbox"),
  rowCount: z.literal(0),
  schemaTable: z.literal("memory_vector_cleanup_outbox"),
  schemaSha256: sha256Schema,
  columns: z.array(columnSchema).min(1).max(HISTORICAL_SCHEMA_COLUMN_LIMIT),
}).strict();
const d1UsageSchema = z.object({
  databaseCount: safePositiveIntegerSchema,
  queryGroups: safeNonnegativeIntegerSchema,
  rowsRead: safeNonnegativeIntegerSchema,
  rowsWritten: safeNonnegativeIntegerSchema,
  executions: safeNonnegativeIntegerSchema,
  windowMinutes: safePositiveIntegerSchema.refine(
    (value) => value <= 24 * 60,
    "D1 usage window cannot exceed one UTC day.",
  ),
}).strict();
const ledgerResultFields = {
  ledgerPath: normalizedAbsolutePathSchema,
  utcDay: utcDaySchema,
  revision: safePositiveIntegerSchema,
  totals: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
} as const;
const ledgerReservationFields = {
  operationId: z.string().regex(operationIdPattern),
  operation: z.literal(HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME),
  candidateVersionId: uuidSchema,
  maximumRowsRead: z.literal(
    HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  ),
  maximumRowsWritten: z.literal(0),
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
} as const;
const maximumLedgerResultSchema = z.object({
  ...ledgerResultFields,
  idempotent: z.boolean(),
  reservation: z.object({
    ...ledgerReservationFields,
    phase: z.literal("maximum"),
    rowsRead: z.literal(HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT),
    rowsWritten: z.literal(0),
  }).strict(),
}).strict();
const exactLedgerResultSchema = z.object({
  ...ledgerResultFields,
  idempotent: z.literal(false),
  reservation: z.object({
    ...ledgerReservationFields,
    phase: z.literal("exact"),
    rowsRead: safePositiveIntegerSchema.refine(
      (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      "Exact successor rows read exceed the V2 snapshot bound.",
    ),
    rowsWritten: z.literal(0),
  }).strict(),
}).strict();
const liveExactLedgerResultSchema = z.object({
  ...ledgerResultFields,
  idempotent: z.boolean(),
  reservation: z.object({
    ...ledgerReservationFields,
    phase: z.literal("exact"),
    rowsRead: safePositiveIntegerSchema.refine(
      (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      "Exact successor rows read exceed the V2 snapshot bound.",
    ),
    rowsWritten: z.literal(0),
  }).strict(),
}).strict();

const authorizationContextSchema = z.object({
  phase: z.literal("successor"),
  d1ExecutionMayStart: z.literal(true),
  cutoverRunId: uuidSchema,
  operationId: z.string().regex(operationIdPattern),
  accountingParentOperationId: z.string().regex(
    /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
  ),
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  captureLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  snapshotPlanSha256: z.literal(HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256),
  predecessorReportSha256: sha256Schema,
  runtimeVerificationStageSha256: sha256Schema,
  runtimeVerificationReportSha256: sha256Schema,
  productionExclusionOwnerSha256: sha256Schema,
  utcDay: utcDaySchema,
  maximumReservationRevision: safePositiveIntegerSchema,
  maximumRowsRead: z.literal(
    HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  ),
  maximumRowsWritten: z.literal(0),
}).strict();
const authorizationReceiptSchema = z.object({
  authorizationStageSha256: sha256Schema,
}).strict();
const preparedAuthorizationSchema = authorizationContextSchema.extend({
  authorizationStageSha256: sha256Schema,
}).strict();

const v2CaptureEvidenceSchema = z.object({
  snapshotPlanSha256: z.literal(HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256),
  resultSetCount: z.literal(HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT),
  automaticAttemptsPerResultSet: z.literal(1),
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    "Prepared successor rows read exceed the V2 snapshot bound.",
  ),
  rowsWritten: z.literal(0),
  hmacKeyId: sha256Schema,
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), datasetEvidenceSchema),
  supplementalDatasets: z.record(
    z.enum(HISTORICAL_SUPPLEMENTAL_DATASET_NAMES),
    datasetEvidenceSchema,
  ),
  operationalDatasets: z.record(
    z.enum(HISTORICAL_OPERATIONAL_DATASET_NAMES),
    operationalDatasetEvidenceSchema,
  ),
}).strict();

const preparedCaptureSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_SUCCESSOR_PREPARED_CAPTURE_KIND),
  schemaVersion: z.literal(2),
  phase: z.literal("successor-prepared-capture"),
  boundary: z.literal("after-runtime-migration-0016-before-worker-activation"),
  cutoverRunId: uuidSchema,
  policy: z.object({
    id: z.literal(policy.policyId),
    sha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  }).strict(),
  paths: z.object({
    backupDirectory: normalizedAbsolutePathSchema,
    runDirectory: normalizedAbsolutePathSchema,
    reportPath: normalizedAbsolutePathSchema,
  }).strict(),
  database: z.object({
    id: z.literal(policy.database.id),
    name: z.literal(policy.database.name),
  }).strict(),
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  captureLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  snapshotPlanSha256: z.literal(HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256),
  predecessor: z.object({
    reportSha256: sha256Schema,
    createdAt: canonicalTimestampSchema,
    hmacKeyId: sha256Schema,
    sourceFingerprint: sourceIdentitySchema,
    snapshotPlanSha256: sha256Schema,
  }).strict(),
  migrationRuntimeVerification: z.object({
    stageSha256: sha256Schema,
    reportSha256: sha256Schema,
    createdAt: canonicalTimestampSchema,
    predecessorCompleteSha256: sha256Schema,
    productionExclusionOwnerSha256: sha256Schema,
  }).strict(),
  productionExclusion: z.object({
    ownerSha256: sha256Schema,
    leaseExpiresAt: safePositiveIntegerSchema,
  }).strict(),
  authorization: preparedAuthorizationSchema,
  captureStartedAt: canonicalTimestampSchema,
  captureCompletedAt: canonicalTimestampSchema,
  plannedExactReservedAt: canonicalTimestampSchema,
  plannedReportCreatedAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  predecessorToSuccessorGapMs: safePositiveIntegerSchema.refine(
    (value) => value <= policy.successor.maximumPredecessorToSuccessorGapMs,
    "Prepared predecessor-to-successor gap exceeds policy.",
  ),
  operationId: z.string().regex(operationIdPattern),
  accountingParentOperationId: z.string().regex(
    /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
  ),
  usage: d1UsageSchema,
  maximumReservation: maximumLedgerResultSchema,
  privacy: z.literal("hmac-sha256-no-raw-identifiers"),
  captureSha256: sha256Schema,
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    "Prepared successor rows read exceed the V2 snapshot bound.",
  ),
  rowsWritten: z.literal(0),
  resultSetCount: z.literal(HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT),
  automaticAttemptsPerResultSet: z.literal(1),
  capture: v2CaptureEvidenceSchema,
}).strict();

const successorReportSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_SUCCESSOR_KIND),
  schemaVersion: z.literal(2),
  phase: z.literal("successor"),
  boundary: z.literal("after-runtime-migration-0016-before-worker-activation"),
  cutoverRunId: uuidSchema,
  policy: z.object({
    id: z.literal(policy.policyId),
    sha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  }).strict(),
  paths: z.object({
    backupDirectory: normalizedAbsolutePathSchema,
    runDirectory: normalizedAbsolutePathSchema,
    reportPath: normalizedAbsolutePathSchema,
  }).strict(),
  database: z.object({
    id: z.literal(policy.database.id),
    name: z.literal(policy.database.name),
  }).strict(),
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  captureLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  finalizationLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  snapshotPlanSha256: z.literal(HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256),
  predecessor: z.object({
    reportSha256: sha256Schema,
    createdAt: canonicalTimestampSchema,
    hmacKeyId: sha256Schema,
    sourceFingerprint: sourceIdentitySchema,
    snapshotPlanSha256: sha256Schema,
  }).strict(),
  migrationRuntimeVerification: z.object({
    stageSha256: sha256Schema,
    reportSha256: sha256Schema,
    createdAt: canonicalTimestampSchema,
    predecessorCompleteSha256: sha256Schema,
    productionExclusionOwnerSha256: sha256Schema,
  }).strict(),
  productionExclusion: z.object({
    ownerSha256: sha256Schema,
    leaseExpiresAt: safePositiveIntegerSchema,
  }).strict(),
  captureStartedAt: canonicalTimestampSchema,
  captureCompletedAt: canonicalTimestampSchema,
  exactReservedAt: canonicalTimestampSchema,
  createdAt: canonicalTimestampSchema,
  finalizedAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  predecessorToSuccessorGapMs: safePositiveIntegerSchema.refine(
    (value) => value <= policy.successor.maximumPredecessorToSuccessorGapMs,
    "Predecessor-to-successor gap exceeds policy.",
  ),
  operationId: z.string().regex(operationIdPattern),
  accountingParentOperationId: z.string().regex(
    /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
  ),
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    "Successor rows read exceed the V2 snapshot bound.",
  ),
  rowsWritten: z.literal(0),
  snapshotExecution: z.object({
    resultSetCount: z.literal(HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT),
    countResultSetCount: z.literal(HISTORICAL_DATA_COUNT_RESULT_SET_COUNT),
    schemaResultSetCount: z.literal(HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT),
    schemaObjectResultSetCount: z.literal(
      HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT,
    ),
    identityResultSetCount: z.literal(HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT),
    automaticAttemptsPerResultSet: z.literal(1),
  }).strict(),
  usage: d1UsageSchema,
  ledger: z.object({
    maximum: maximumLedgerResultSchema,
    exact: exactLedgerResultSchema,
  }).strict(),
  limits: z.object({
    protectedDatasetCount: z.literal(HISTORICAL_PROTECTED_DATASET_COUNT),
    operationalDatasetCount: z.literal(1),
    coreRows: z.literal(HISTORICAL_CORE_ROW_LIMIT),
    supplementalRows: z.literal(HISTORICAL_SUPPLEMENTAL_ROW_LIMIT),
    operationalRows: z.literal(HISTORICAL_OPERATIONAL_ROW_LIMIT),
    schemaColumnsPerTable: z.literal(HISTORICAL_SCHEMA_COLUMN_LIMIT),
    sentinelsPerDataset: z.literal(HISTORICAL_SENTINEL_LIMIT),
    logicalSnapshotRowsRead: z.literal(HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ),
    logicalRowsReadLimit: z.literal(HISTORICAL_BILLED_READ_LIMIT),
    maximumAutomaticReadAttempts: z.literal(
      HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
    ),
    billableRowsReadReservation: z.literal(
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    ),
    requiredCleanupOutboxRows: z.literal(0),
  }).strict(),
  privacy: z.literal("hmac-sha256-no-raw-identifiers"),
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), datasetEvidenceSchema),
  supplementalDatasets: z.record(
    z.enum(HISTORICAL_SUPPLEMENTAL_DATASET_NAMES),
    datasetEvidenceSchema,
  ),
  operationalDatasets: z.record(
    z.enum(HISTORICAL_OPERATIONAL_DATASET_NAMES),
    operationalDatasetEvidenceSchema,
  ),
}).strict();

export type HistoricalFresh0016SuccessorReport = z.infer<
  typeof successorReportSchema
>;
export type HistoricalFresh0016SuccessorPreparedCapture = z.infer<
  typeof preparedCaptureSchema
>;

export type HistoricalFresh0016SuccessorPaths = Readonly<{
  backupDirectory: string;
  runDirectory: string;
  reportPath: string;
}>;

export type HistoricalFresh0016SuccessorArtifact = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  report: HistoricalFresh0016SuccessorReport;
}>;

export type HistoricalFresh0016SuccessorPrivacyOptions = Readonly<{
  forbiddenPlaintext?: readonly string[];
}>;

export type HistoricalFresh0016SuccessorAuthorizationContext = z.infer<
  typeof authorizationContextSchema
>;
export type HistoricalFresh0016SuccessorAuthorizationReceipt = z.infer<
  typeof authorizationReceiptSchema
>;

export type CaptureHistoricalFresh0016SuccessorReportOptions = Readonly<{
  cutoverRunId: string;
  backupDirectory: string;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  captureLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
  liveDeploymentStatusOutput: string;
  hmacSecret: string;
  predecessor: unknown;
  runtimeVerification: unknown;
  runtimeVerificationStageSha256: string;
  productionExclusionOwner: ProductionValidationLockOwner;
  usage: D1DailyUsage;
  maximumReservation: D1ReleaseBudgetReservationResult;
  accountingParentOperationId: string;
  authorizeLastPreD1: (
    context: HistoricalFresh0016SuccessorAuthorizationContext,
  ) => HistoricalFresh0016SuccessorAuthorizationReceipt;
  persistPreparedCapture: (
    prepared: HistoricalFresh0016SuccessorPreparedCapture,
  ) => void;
  observeFinalizationTopology: () => Readonly<{
    evidence: HistoricalFresh0016LiveTopologyEvidence;
    statusOutput: string;
  }>;
  forbiddenPlaintext: readonly string[];
  runner?: WranglerRunner;
  clock?: () => Date;
}>;

export type FinalizeHistoricalFresh0016SuccessorPreparedCaptureOptions =
  Readonly<{
    preparedCapture: unknown;
    sourceFingerprint: D1ReleaseSourceIdentity;
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
    finalizationLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
    liveDeploymentStatusOutput: string;
    productionExclusionOwner: ProductionValidationLockOwner;
    forbiddenPlaintext: readonly string[];
    clock?: () => Date;
  }>;

type HistoricalFresh0016SuccessorDirectoryIdentity = Readonly<{
  backupDirectory: Readonly<{ device: number; inode: number }>;
  policyRoot: Readonly<{ device: number; inode: number }>;
  runDirectory: Readonly<{ device: number; inode: number }>;
}>;

export function historicalFresh0016SuccessorPaths(
  backupDirectory: string,
  cutoverRunId: string,
): HistoricalFresh0016SuccessorPaths {
  const runId = requireUuid(cutoverRunId, "cutover run ID");
  const backup = normalizeAbsolutePath(backupDirectory, "backup directory");
  const relativeRoot = policy.storage.runsRelativeDirectory;
  const rootSegments = relativeRoot.split("/");
  if (
    path.isAbsolute(relativeRoot) ||
    rootSegments.length === 0 ||
    rootSegments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    throw new Error("Fresh 0016 successor policy root is unsafe.");
  }
  const policyRoot = path.resolve(backup, ...rootSegments);
  assertContainedPath(backup, policyRoot, "policy root");
  const runDirectory = path.resolve(policyRoot, runId);
  assertDirectDescendant(policyRoot, runDirectory, "run directory");
  const reportPath = path.resolve(
    runDirectory,
    HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME,
  );
  assertDirectDescendant(runDirectory, reportPath, "successor report");
  return Object.freeze({
    backupDirectory: backup,
    runDirectory,
    reportPath,
  });
}

export function historicalFresh0016SuccessorProductionExclusionOwnerSha256(
  ownerInput: ProductionValidationLockOwner,
) {
  const owner = parseProductionValidationLockOwner(ownerInput);
  return sha256(canonicalProductionValidationLockOwner(owner));
}

export function historicalFresh0016SuccessorPredecessorReportSha256(
  reportInput: unknown,
  privacy: HistoricalFresh0016SuccessorPrivacyOptions = {},
) {
  const report = parseHistoricalFresh0016PredecessorReport(reportInput, privacy);
  return canonicalValueSha256(report);
}

export function historicalFresh0016SuccessorRuntimeVerificationReportSha256(
  reportInput: unknown,
) {
  const report = historicalFresh0016RuntimeVerificationReportSchema.parse(
    reportInput,
  );
  return canonicalValueSha256(report);
}

export function parseHistoricalFresh0016SuccessorPreparedCapture(
  value: unknown,
  privacy: HistoricalFresh0016SuccessorPrivacyOptions = {},
): HistoricalFresh0016SuccessorPreparedCapture {
  assertNoForbiddenPlaintext(value, privacy.forbiddenPlaintext ?? []);
  const prepared = preparedCaptureSchema.parse(value);
  validatePreparedCaptureInvariants(prepared);
  assertNoForbiddenPlaintext(prepared, privacy.forbiddenPlaintext ?? []);
  return deepFreeze(prepared);
}

export function historicalFresh0016SuccessorPreparedCaptureSha256(
  value: unknown,
  privacy: HistoricalFresh0016SuccessorPrivacyOptions = {},
) {
  return sha256(stableStringify(
    parseHistoricalFresh0016SuccessorPreparedCapture(value, privacy),
  ));
}

export function historicalFresh0016SuccessorOperationId(input: Readonly<{
  cutoverRunId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  captureLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
  hmacKeyId: string;
  predecessorReportSha256: string;
  runtimeVerificationStageSha256: string;
  runtimeVerificationReportSha256: string;
  productionExclusionOwnerSha256: string;
}>) {
  const workerRelease = parseUploadedInactiveWorkerRelease(input);
  const captureLiveTopology =
    historicalFresh0016LiveTopologyEvidenceSchema.parse(
      input.captureLiveTopology,
    );
  if (
    stableStringify(captureLiveTopology.workerRelease) !==
      stableStringify(workerRelease)
  ) {
    throw new Error(
      "Fresh 0016 successor operation topology drifted from its Worker release.",
    );
  }
  const material = {
    kind: HISTORICAL_FRESH_0016_SUCCESSOR_KIND,
    schemaVersion: 2,
    policyId: policy.policyId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    cutoverRunId: requireUuid(input.cutoverRunId, "cutover run ID"),
    sourceFingerprint: validateSourceIdentity(input.sourceFingerprint),
    workerRelease,
    captureLiveTopology,
    hmacKeyId: requireSha256(input.hmacKeyId, "HMAC key ID"),
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    predecessorReportSha256: requireSha256(
      input.predecessorReportSha256,
      "predecessor report SHA-256",
    ),
    runtimeVerificationStageSha256: requireSha256(
      input.runtimeVerificationStageSha256,
      "runtime-verification stage SHA-256",
    ),
    runtimeVerificationReportSha256: requireSha256(
      input.runtimeVerificationReportSha256,
      "runtime-verification report SHA-256",
    ),
    productionExclusionOwnerSha256: requireSha256(
      input.productionExclusionOwnerSha256,
      "production-exclusion owner SHA-256",
    ),
  } as const;
  return `historical-fresh-0016-successor:${sha256(stableStringify(material))}`;
}

export function captureHistoricalFresh0016SuccessorReport(
  options: CaptureHistoricalFresh0016SuccessorReportOptions,
): HistoricalFresh0016SuccessorReport {
  const cutoverRunId = requireUuid(options.cutoverRunId, "cutover run ID");
  const hmacSecret = requireHistoricalHmacSecret(options.hmacSecret);
  const forbiddenPlaintext = Object.freeze([
    hmacSecret,
    ...options.forbiddenPlaintext,
  ]);
  const predecessor = parseHistoricalFresh0016PredecessorReport(
    options.predecessor,
    { forbiddenPlaintext },
  );
  const runtimeVerification =
    historicalFresh0016RuntimeVerificationReportSchema.parse(
      options.runtimeVerification,
    );
  assertNoForbiddenPlaintext(runtimeVerification, forbiddenPlaintext);
  const runtimeVerificationStageSha256 = requireSha256(
    options.runtimeVerificationStageSha256,
    "runtime-verification stage SHA-256",
  );
  const productionExclusionOwner = parseProductionValidationLockOwner(
    options.productionExclusionOwner,
  );
  const productionExclusionOwnerSha256 =
    historicalFresh0016SuccessorProductionExclusionOwnerSha256(
      productionExclusionOwner,
    );
  const paths = historicalFresh0016SuccessorPaths(
    options.backupDirectory,
    cutoverRunId,
  );
  const workerRelease = requireUploadedInactiveWorkerRelease({
    backupDirectory: options.backupDirectory,
    sourceFingerprint: predecessor.sourceFingerprint,
    targetCandidateVersionId: options.targetCandidateVersionId,
    serviceBaselineVersionId: options.serviceBaselineVersionId,
    uploadEvidenceSha256: options.uploadEvidenceSha256,
  });
  const clock = options.clock ?? (() => new Date());
  const captureStartedAt = readClock(clock, "capture start");
  const captureLiveTopology = assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: options.captureLiveTopology,
    boundaryAt: captureStartedAt,
    statusOutput: options.liveDeploymentStatusOutput,
    ...workerRelease,
  });
  assertLiveTopologyPostdatesUpload(
    options.backupDirectory,
    captureLiveTopology,
  );
  const hmacKeyId = historicalDataHmacKeyId(hmacSecret);
  const predecessorReportSha256 =
    historicalFresh0016SuccessorPredecessorReportSha256(predecessor, {
      forbiddenPlaintext,
    });
  const runtimeVerificationReportSha256 =
    historicalFresh0016SuccessorRuntimeVerificationReportSha256(
      runtimeVerification,
    );
  validateCrossEvidence({
    cutoverRunId,
    workerRelease,
    captureLiveTopology,
    hmacKeyId,
    paths,
    predecessor,
    predecessorReportSha256,
    runtimeVerification,
    productionExclusionOwner,
    productionExclusionOwnerSha256,
  });
  const operationId = historicalFresh0016SuccessorOperationId({
    cutoverRunId,
    sourceFingerprint: predecessor.sourceFingerprint,
    ...workerRelease,
    captureLiveTopology,
    hmacKeyId,
    predecessorReportSha256,
    runtimeVerificationStageSha256,
    runtimeVerificationReportSha256,
    productionExclusionOwnerSha256,
  });
  const utcDay = captureStartedAt.toISOString().slice(0, 10);
  const usage = d1UsageSchema.parse(options.usage);
  const maximumReservation = maximumLedgerResultSchema.parse(
    options.maximumReservation,
  );
  validateMaximumReservation({
    maximumReservation,
    paths,
    utcDay,
    operationId,
    targetCandidateVersionId: workerRelease.targetCandidateVersionId,
    sourceFingerprint: predecessor.sourceFingerprint,
    usage,
    captureStartedAt,
    runtimeVerificationCreatedAt: runtimeVerification.createdAt,
    accountingParentOperationId: options.accountingParentOperationId,
  });
  if (productionExclusionOwner.leaseExpiresAt <= captureStartedAt.getTime()) {
    throw new Error(
      "Fresh 0016 successor production exclusion expires before capture authorization.",
    );
  }
  const authorizationContext: HistoricalFresh0016SuccessorAuthorizationContext = deepFreeze({
    phase: "successor" as const,
    d1ExecutionMayStart: true as const,
    cutoverRunId,
    operationId,
    accountingParentOperationId: options.accountingParentOperationId,
    sourceFingerprint: { ...predecessor.sourceFingerprint },
    workerRelease,
    captureLiveTopology,
    hmacKeyId,
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    predecessorReportSha256,
    runtimeVerificationStageSha256,
    runtimeVerificationReportSha256,
    productionExclusionOwnerSha256,
    utcDay,
    maximumReservationRevision: maximumReservation.revision,
    maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    maximumRowsWritten: 0 as const,
  });
  if (typeof options.authorizeLastPreD1 !== "function") {
    throw new Error(
      "Fresh 0016 successor requires one synchronous last-pre-D1 authorization callback.",
    );
  }
  if (typeof options.persistPreparedCapture !== "function") {
    throw new Error(
      "Fresh 0016 successor requires a synchronous prepared-capture persistence callback before exact refinement.",
    );
  }
  if (typeof options.observeFinalizationTopology !== "function") {
    throw new Error(
      "Fresh 0016 successor requires a fresh synchronous finalization-topology observation.",
    );
  }
  const authorizationState: {
    calls: number;
    receipt?: HistoricalFresh0016SuccessorAuthorizationReceipt;
  } = { calls: 0 };
  const capture = captureHistoricalDataV2SnapshotEvidence({
    hmacSecret,
    runner: options.runner
      ? createHistoricalDataWranglerRunner(options.runner)
      : undefined,
    authorizeLastPreD1: () => {
      authorizationState.calls += 1;
      const result = options.authorizeLastPreD1(authorizationContext);
      if (isThenable(result)) {
        throw new Error(
          "Fresh 0016 successor authorization receipt must be synchronous and cannot be a Promise or thenable.",
        );
      }
      authorizationState.receipt = deepFreeze(
        authorizationReceiptSchema.parse(result),
      );
    },
  });
  if (authorizationState.calls !== 1 || !authorizationState.receipt) {
    throw new Error(
      "Fresh 0016 successor did not receive one exact last-pre-D1 authorization-stage receipt.",
    );
  }
  validateSuccessorCapture(capture, hmacKeyId);
  const captureCompletedAt = readClock(clock, "capture completion");
  assertMonotonicDate(captureStartedAt, captureCompletedAt, "capture");
  assertD1ReleaseBudgetUtcDay(utcDay, captureCompletedAt);
  const plannedExactReservedAt = readClock(clock, "planned exact reservation");
  assertMonotonicDate(
    captureCompletedAt,
    plannedExactReservedAt,
    "planned exact reservation",
  );
  assertD1ReleaseBudgetUtcDay(utcDay, plannedExactReservedAt);
  const plannedReportCreatedAt = readClock(clock, "planned report creation");
  assertMonotonicDate(
    plannedExactReservedAt,
    plannedReportCreatedAt,
    "planned report creation",
  );
  assertD1ReleaseBudgetUtcDay(utcDay, plannedReportCreatedAt);
  if (
    productionExclusionOwner.leaseExpiresAt <=
    plannedReportCreatedAt.getTime()
  ) {
    throw new Error(
      "Fresh 0016 successor production exclusion expires before planned report creation.",
    );
  }
  const preparedCapture = parseHistoricalFresh0016SuccessorPreparedCapture({
    kind: HISTORICAL_FRESH_0016_SUCCESSOR_PREPARED_CAPTURE_KIND,
    schemaVersion: 2,
    phase: "successor-prepared-capture",
    boundary: "after-runtime-migration-0016-before-worker-activation",
    cutoverRunId,
    policy: {
      id: policy.policyId,
      sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    },
    paths,
    database: { ...policy.database },
    sourceFingerprint: { ...predecessor.sourceFingerprint },
    workerRelease,
    captureLiveTopology,
    hmacKeyId,
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    predecessor: {
      reportSha256: predecessorReportSha256,
      createdAt: predecessor.createdAt,
      hmacKeyId: predecessor.hmacKeyId,
      sourceFingerprint: { ...predecessor.sourceFingerprint },
      snapshotPlanSha256: predecessor.snapshotPlanSha256,
    },
    migrationRuntimeVerification: {
      stageSha256: runtimeVerificationStageSha256,
      reportSha256: runtimeVerificationReportSha256,
      createdAt: runtimeVerification.createdAt,
      predecessorCompleteSha256:
        runtimeVerification.evidence.predecessorCompleteSha256,
      productionExclusionOwnerSha256,
    },
    productionExclusion: {
      ownerSha256: productionExclusionOwnerSha256,
      leaseExpiresAt: productionExclusionOwner.leaseExpiresAt,
    },
    authorization: {
      ...authorizationContext,
      authorizationStageSha256:
        authorizationState.receipt.authorizationStageSha256,
    },
    captureStartedAt: captureStartedAt.toISOString(),
    captureCompletedAt: captureCompletedAt.toISOString(),
    plannedExactReservedAt: plannedExactReservedAt.toISOString(),
    plannedReportCreatedAt: plannedReportCreatedAt.toISOString(),
    utcDay,
    predecessorToSuccessorGapMs:
      plannedReportCreatedAt.getTime() - Date.parse(predecessor.createdAt),
    operationId,
    accountingParentOperationId: options.accountingParentOperationId,
    usage: { ...usage },
    maximumReservation: cloneLedgerResult(maximumReservation),
    privacy: "hmac-sha256-no-raw-identifiers",
    captureSha256: sha256(stableStringify(capture)),
    rowsRead: capture.rowsRead,
    rowsWritten: 0,
    resultSetCount: capture.resultSetCount,
    automaticAttemptsPerResultSet:
      capture.automaticAttemptsPerResultSet,
    capture: cloneV2Capture(capture),
  }, {
    forbiddenPlaintext,
  });
  let preparedPersistenceCalls = 0;
  preparedPersistenceCalls += 1;
  const persistenceResult = options.persistPreparedCapture(preparedCapture);
  if (persistenceResult !== undefined) {
    throw new Error(
      "Fresh 0016 successor prepared-capture persistence must complete synchronously without a return value.",
    );
  }
  if (preparedPersistenceCalls !== 1) {
    throw new Error(
      "Fresh 0016 successor did not persist one exact prepared capture.",
    );
  }
  const finalizationObservation = options.observeFinalizationTopology();
  if (isThenable(finalizationObservation)) {
    throw new Error(
      "Fresh 0016 successor finalization-topology observation cannot be a Promise or thenable.",
    );
  }
  return finalizeHistoricalFresh0016SuccessorPreparedCapture({
    preparedCapture,
    sourceFingerprint: predecessor.sourceFingerprint,
    ...workerRelease,
    finalizationLiveTopology: finalizationObservation.evidence,
    liveDeploymentStatusOutput: finalizationObservation.statusOutput,
    productionExclusionOwner,
    forbiddenPlaintext,
    clock,
  });
}

export function finalizeHistoricalFresh0016SuccessorPreparedCapture(
  options: FinalizeHistoricalFresh0016SuccessorPreparedCaptureOptions,
): HistoricalFresh0016SuccessorReport {
  const forbiddenPlaintext = Object.freeze([...options.forbiddenPlaintext]);
  const prepared = parseHistoricalFresh0016SuccessorPreparedCapture(
    options.preparedCapture,
    { forbiddenPlaintext },
  );
  const sourceFingerprint = validateSourceIdentity(options.sourceFingerprint);
  const workerRelease = requireUploadedInactiveWorkerRelease({
    backupDirectory: prepared.paths.backupDirectory,
    sourceFingerprint,
    targetCandidateVersionId: options.targetCandidateVersionId,
    serviceBaselineVersionId: options.serviceBaselineVersionId,
    uploadEvidenceSha256: options.uploadEvidenceSha256,
  });
  if (
    !sameSource(prepared.sourceFingerprint, sourceFingerprint) ||
    stableStringify(prepared.workerRelease) !== stableStringify(workerRelease)
  ) {
    throw new Error(
      "Fresh 0016 successor prepared capture does not match the live source or inactive Worker release.",
    );
  }
  const productionExclusionOwner = parseProductionValidationLockOwner(
    options.productionExclusionOwner,
  );
  const productionExclusionOwnerSha256 =
    historicalFresh0016SuccessorProductionExclusionOwnerSha256(
      productionExclusionOwner,
    );
  if (
    productionExclusionOwnerSha256 !==
      prepared.productionExclusion.ownerSha256 ||
    productionExclusionOwner.candidateVersionId !==
      workerRelease.targetCandidateVersionId ||
    productionExclusionOwner.sourceFingerprintSha256 !==
      prepared.sourceFingerprint.sha256 ||
    productionExclusionOwner.leaseExpiresAt !==
      prepared.productionExclusion.leaseExpiresAt
  ) {
    throw new Error(
      "Fresh 0016 successor prepared capture does not match the exact production-exclusion owner.",
    );
  }
  const clock = options.clock ?? (() => new Date());
  const finalizedAt = readClock(clock, "prepared-capture finalization");
  const finalizationLiveTopology =
    assertHistoricalFresh0016LiveTopologyEvidence({
      evidence: options.finalizationLiveTopology,
      boundaryAt: finalizedAt,
      statusOutput: options.liveDeploymentStatusOutput,
      ...workerRelease,
    });
  assertLiveTopologyPostdatesUpload(
    prepared.paths.backupDirectory,
    finalizationLiveTopology,
  );
  if (
    Date.parse(finalizationLiveTopology.observedAt) <=
    Date.parse(prepared.captureLiveTopology.observedAt)
  ) {
    throw new Error(
      "Fresh 0016 successor finalization requires a newly observed live topology after capture admission.",
    );
  }
  const plannedCreatedAt = new Date(prepared.plannedReportCreatedAt);
  assertMonotonicDate(
    plannedCreatedAt,
    finalizedAt,
    "prepared-capture finalization",
  );
  assertD1ReleaseBudgetUtcDay(prepared.utcDay, finalizedAt);
  if (productionExclusionOwner.leaseExpiresAt <= finalizedAt.getTime()) {
    throw new Error(
      "Fresh 0016 successor production exclusion expired before prepared-capture finalization.",
    );
  }

  assertPreparedLedgerIsLive(prepared, finalizedAt);
  const exactResult = liveExactLedgerResultSchema.parse(
    reserveD1ReleaseBudget({
      backupDir: prepared.paths.backupDirectory,
      operationId: prepared.operationId,
      operation: HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
      sourceFingerprint,
      candidateVersionId: workerRelease.targetCandidateVersionId,
      accountingParentOperationId: prepared.accountingParentOperationId,
      phase: "exact",
      rowsRead: prepared.capture.rowsRead,
      rowsWritten: 0,
      observedUsage: prepared.usage,
      now: new Date(prepared.plannedExactReservedAt),
      expectedUtcDay: prepared.utcDay,
    }),
  );
  const liveExact = liveExactLedgerResultSchema.parse(
    assertD1ReleaseBudgetReservation({
      ledgerPath: exactResult.ledgerPath,
      utcDay: prepared.utcDay,
      operationId: prepared.operationId,
      sourceFingerprint,
      candidateVersionId: workerRelease.targetCandidateVersionId,
      accountingParentOperationId: prepared.accountingParentOperationId,
      phase: "exact",
      rowsRead: prepared.capture.rowsRead,
      rowsWritten: 0,
      now: finalizedAt,
    }),
  );
  if (!sameLedgerResultIgnoringIdempotence(exactResult, liveExact)) {
    throw new Error(
      "Fresh 0016 successor exact ledger changed during prepared-capture finalization.",
    );
  }
  validateExactLedgerTransition(prepared, exactResult);
  const exactReservation = exactLedgerResultSchema.parse({
    ...cloneLedgerResult(exactResult),
    idempotent: false,
  });
  const capture = prepared.capture;
  const report = {
    kind: HISTORICAL_FRESH_0016_SUCCESSOR_KIND,
    schemaVersion: 2,
    phase: "successor",
    boundary: prepared.boundary,
    cutoverRunId: prepared.cutoverRunId,
    policy: { ...prepared.policy },
    paths: { ...prepared.paths },
    database: { ...prepared.database },
    sourceFingerprint: { ...prepared.sourceFingerprint },
    workerRelease,
    captureLiveTopology: prepared.captureLiveTopology,
    finalizationLiveTopology,
    hmacKeyId: prepared.hmacKeyId,
    snapshotPlanSha256: prepared.snapshotPlanSha256,
    predecessor: {
      ...prepared.predecessor,
      sourceFingerprint: { ...prepared.predecessor.sourceFingerprint },
    },
    migrationRuntimeVerification: {
      ...prepared.migrationRuntimeVerification,
    },
    productionExclusion: { ...prepared.productionExclusion },
    captureStartedAt: prepared.captureStartedAt,
    captureCompletedAt: prepared.captureCompletedAt,
    exactReservedAt: exactReservation.reservation.updatedAt,
    createdAt: prepared.plannedReportCreatedAt,
    finalizedAt: finalizedAt.toISOString(),
    utcDay: prepared.utcDay,
    predecessorToSuccessorGapMs:
      prepared.predecessorToSuccessorGapMs,
    operationId: prepared.operationId,
    accountingParentOperationId: prepared.accountingParentOperationId,
    rowsRead: capture.rowsRead,
    rowsWritten: 0,
    snapshotExecution: {
      resultSetCount: capture.resultSetCount,
      countResultSetCount: HISTORICAL_DATA_COUNT_RESULT_SET_COUNT,
      schemaResultSetCount: HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT,
      schemaObjectResultSetCount:
        HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT,
      identityResultSetCount: HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT,
      automaticAttemptsPerResultSet:
        capture.automaticAttemptsPerResultSet,
    },
    usage: { ...prepared.usage },
    ledger: {
      maximum: cloneLedgerResult(prepared.maximumReservation),
      exact: cloneLedgerResult(exactReservation),
    },
    limits: {
      protectedDatasetCount: HISTORICAL_PROTECTED_DATASET_COUNT,
      operationalDatasetCount: 1,
      coreRows: HISTORICAL_CORE_ROW_LIMIT,
      supplementalRows: HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
      operationalRows: HISTORICAL_OPERATIONAL_ROW_LIMIT,
      schemaColumnsPerTable: HISTORICAL_SCHEMA_COLUMN_LIMIT,
      sentinelsPerDataset: HISTORICAL_SENTINEL_LIMIT,
      logicalSnapshotRowsRead: HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      logicalRowsReadLimit: HISTORICAL_BILLED_READ_LIMIT,
      maximumAutomaticReadAttempts:
        HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
      billableRowsReadReservation:
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      requiredCleanupOutboxRows: 0,
    },
    privacy: "hmac-sha256-no-raw-identifiers",
    datasets: cloneDatasets(capture.datasets),
    supplementalDatasets: cloneSupplementalDatasets(
      capture.supplementalDatasets,
    ),
    operationalDatasets: cloneOperationalDatasets(
      capture.operationalDatasets,
    ),
  };
  return parseHistoricalFresh0016SuccessorReport(report, {
    forbiddenPlaintext,
  });
}

export function parseHistoricalFresh0016SuccessorReport(
  value: unknown,
  privacy: HistoricalFresh0016SuccessorPrivacyOptions = {},
): HistoricalFresh0016SuccessorReport {
  assertNoForbiddenPlaintext(value, privacy.forbiddenPlaintext ?? []);
  const parsed = successorReportSchema.parse(value);
  validateReportInvariants(parsed);
  assertNoForbiddenPlaintext(parsed, privacy.forbiddenPlaintext ?? []);
  deepFreeze(parsed);
  return parsed;
}

export function writeHistoricalFresh0016SuccessorReport(
  report: HistoricalFresh0016SuccessorReport,
  privacy: HistoricalFresh0016SuccessorPrivacyOptions = {},
): HistoricalFresh0016SuccessorArtifact {
  const parsed = parseHistoricalFresh0016SuccessorReport(report, privacy);
  const payload = serializeReport(parsed, privacy.forbiddenPlaintext ?? []);
  const directoryIdentity = assertPrivatePathHierarchy(parsed.paths);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      parsed.paths.reportPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error(
      "Fresh 0016 successor report must be created once at its absent reserved path.",
    );
  }
  let writeFailure: unknown;
  try {
    fs.fchmodSync(descriptor, 0o600);
    const before = fs.fstatSync(descriptor);
    assertPrivateReportStat(before, 0, "new successor report");
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateReportStat(after, payload.byteLength, "written successor report");
    if (!sameFileIdentity(fileIdentity(before), fileIdentity(after))) {
      throw new Error(
        "Fresh 0016 successor report inode changed during its exclusive write.",
      );
    }
  } catch (error) {
    writeFailure = error;
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      writeFailure ??= error;
    }
  }
  if (writeFailure !== undefined) throw writeFailure;
  fsyncPrivateDirectory(
    parsed.paths.runDirectory,
    directoryIdentity.runDirectory,
  );
  assertSamePathHierarchy(parsed.paths, directoryIdentity);
  return readHistoricalFresh0016SuccessorReport({
    backupDirectory: parsed.paths.backupDirectory,
    cutoverRunId: parsed.cutoverRunId,
    forbiddenPlaintext: privacy.forbiddenPlaintext,
  });
}

export function readHistoricalFresh0016SuccessorReport(options: Readonly<{
  backupDirectory: string;
  cutoverRunId: string;
  forbiddenPlaintext?: readonly string[];
}>): HistoricalFresh0016SuccessorArtifact {
  const paths = historicalFresh0016SuccessorPaths(
    options.backupDirectory,
    options.cutoverRunId,
  );
  const directoryIdentity = assertPrivatePathHierarchy(paths);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      paths.reportPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error(
      "Fresh 0016 successor report must be a real immutable owner-only file.",
    );
  }
  let bytes: Buffer;
  let after: fs.Stats;
  try {
    const before = fs.fstatSync(descriptor);
    assertPrivateReportStat(before, undefined, "stored successor report");
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
    assertPrivateReportStat(after, bytes.byteLength, "read successor report");
    if (
      !sameStableFile(before, after) ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(
        "Fresh 0016 successor report changed while it was being read.",
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const named = safeLstat(paths.reportPath);
  assertPrivateReportStat(named, bytes.byteLength, "named successor report");
  if (
    !sameFileIdentity(fileIdentity(named), fileIdentity(after)) ||
    named.mtimeMs !== after.mtimeMs ||
    named.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(
      "Fresh 0016 successor report path changed during exact readback.",
    );
  }
  assertSamePathHierarchy(paths, directoryIdentity);
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) {
    throw new Error(
      "Fresh 0016 successor report lacks its canonical final newline.",
    );
  }
  assertNoForbiddenPlaintext(text, options.forbiddenPlaintext ?? []);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Fresh 0016 successor report is not valid JSON.");
  }
  const report = parseHistoricalFresh0016SuccessorReport(value, {
    forbiddenPlaintext: options.forbiddenPlaintext,
  });
  const canonicalBytes = serializeReport(
    report,
    options.forbiddenPlaintext ?? [],
  );
  if (!bytes.equals(canonicalBytes)) {
    throw new Error("Fresh 0016 successor report bytes are not canonical.");
  }
  if (
    report.cutoverRunId !== requireUuid(options.cutoverRunId, "cutover run ID") ||
    report.paths.backupDirectory !== paths.backupDirectory ||
    report.paths.runDirectory !== paths.runDirectory ||
    report.paths.reportPath !== paths.reportPath
  ) {
    throw new Error(
      "Fresh 0016 successor report does not match its requested run path.",
    );
  }
  return Object.freeze({
    path: paths.reportPath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    report,
  });
}

function validateCrossEvidence(input: Readonly<{
  cutoverRunId: string;
  workerRelease: z.infer<typeof uploadedInactiveWorkerReleaseSchema>;
  captureLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
  hmacKeyId: string;
  paths: HistoricalFresh0016SuccessorPaths;
  predecessor: HistoricalFresh0016PredecessorReport;
  predecessorReportSha256: string;
  runtimeVerification: HistoricalFresh0016RuntimeVerificationReport;
  productionExclusionOwner: ProductionValidationLockOwner;
  productionExclusionOwnerSha256: string;
}>) {
  const runtime = input.runtimeVerification;
  const binding = runtime.binding;
  if (
    input.predecessor.cutoverRunId !== input.cutoverRunId ||
    binding.cutoverRunId !== input.cutoverRunId ||
    input.predecessor.paths.backupDirectory !== input.paths.backupDirectory ||
    input.predecessor.paths.runDirectory !== input.paths.runDirectory ||
    runtime.backupDir !== input.paths.backupDirectory ||
    runtime.runDirectory !== input.paths.runDirectory
  ) {
    throw new Error(
      "Fresh 0016 successor evidence does not bind the same exact cutover run paths.",
    );
  }
  if (
    stableStringify(input.predecessor.workerRelease) !==
      stableStringify(input.workerRelease) ||
    stableStringify(input.captureLiveTopology.workerRelease) !==
      stableStringify(input.workerRelease) ||
    runtime.activeWorkerVersion !==
      input.workerRelease.targetCandidateVersionId ||
    input.productionExclusionOwner.candidateVersionId !==
      input.workerRelease.targetCandidateVersionId
  ) {
    throw new Error(
      "Fresh 0016 successor evidence does not bind the same uploaded-inactive candidate and serving baseline.",
    );
  }
  if (
    Date.parse(input.captureLiveTopology.observedAt) <=
    Date.parse(input.predecessor.finalizationLiveTopology.observedAt)
  ) {
    throw new Error(
      "Fresh 0016 successor requires a new live topology observation after predecessor finalization.",
    );
  }
  if (
    input.predecessor.hmacKeyId !== input.hmacKeyId ||
    binding.predecessorHmacKeyId !== input.hmacKeyId
  ) {
    throw new Error(
      "Fresh 0016 successor must use the same fresh predecessor HMAC key.",
    );
  }
  if (
    !sameSource(input.predecessor.sourceFingerprint, binding.sourceFingerprint) ||
    !sameSource(input.predecessor.sourceFingerprint, runtime.sourceFingerprint) ||
    input.productionExclusionOwner.sourceFingerprintSha256 !==
      input.predecessor.sourceFingerprint.sha256
  ) {
    throw new Error(
      "Fresh 0016 successor must bind the same exact release source.",
    );
  }
  if (
    binding.policySha256 !== HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256 ||
    binding.successorSnapshotPlanSha256 !==
      HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256 ||
    binding.predecessorReportSha256 !== input.predecessorReportSha256 ||
    runtime.evidence.productionExclusionOwnerSha256 !==
      input.productionExclusionOwnerSha256
  ) {
    throw new Error(
      "Fresh 0016 successor runtime verification lost its exact policy, predecessor, plan, or exclusion binding.",
    );
  }
}

function validateMaximumReservation(input: Readonly<{
  maximumReservation: z.infer<typeof maximumLedgerResultSchema>;
  paths: HistoricalFresh0016SuccessorPaths;
  utcDay: string;
  operationId: string;
  targetCandidateVersionId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  usage: D1DailyUsage;
  captureStartedAt: Date;
  runtimeVerificationCreatedAt: string;
  accountingParentOperationId: string;
}>) {
  const maximum = input.maximumReservation;
  const expectedLedgerPath = path.join(
    input.paths.backupDirectory,
    "cloudflare",
    `d1-release-budget-ledger-${input.utcDay}.json`,
  );
  if (
    maximum.ledgerPath !== expectedLedgerPath ||
    maximum.utcDay !== input.utcDay ||
    maximum.reservation.operationId !== input.operationId ||
    maximum.reservation.candidateVersionId !==
      input.targetCandidateVersionId ||
    Date.parse(maximum.reservation.createdAt) >
      Date.parse(maximum.reservation.updatedAt) ||
    Date.parse(maximum.reservation.updatedAt) > input.captureStartedAt.getTime() ||
    Date.parse(input.runtimeVerificationCreatedAt) >
      Date.parse(maximum.reservation.createdAt)
  ) {
    throw new Error(
      "Fresh 0016 successor maximum ledger evidence is not the exact pre-D1 reservation.",
    );
  }
  validateLedgerUsage(maximum, input.usage, "maximum");
  assertD1ReleaseBudgetUtcDay(input.utcDay, input.captureStartedAt);
  assertD1ReleaseBudgetReservation({
    ledgerPath: maximum.ledgerPath,
    utcDay: input.utcDay,
    operationId: input.operationId,
    sourceFingerprint: input.sourceFingerprint,
    candidateVersionId: input.targetCandidateVersionId,
    accountingParentOperationId: input.accountingParentOperationId,
    phase: "maximum",
    rowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    rowsWritten: 0,
    now: input.captureStartedAt,
  });
}

function validateSuccessorCapture(
  capture: HistoricalDataV2SnapshotEvidence,
  expectedHmacKeyId: string,
) {
  if (
    capture.snapshotPlanSha256 !== HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256 ||
    capture.resultSetCount !== HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT ||
    capture.automaticAttemptsPerResultSet !== 1 ||
    capture.rowsWritten !== 0 ||
    capture.hmacKeyId !== expectedHmacKeyId ||
    capture.operationalDatasets.memory_vector_cleanup_outbox.rowCount !== 0 ||
    !hasRequiredHistoricalMemoryVectorCleanupOutboxSchema(
      mutableOperationalEvidence(
        capture.operationalDatasets.memory_vector_cleanup_outbox,
      ),
    )
  ) {
    throw new Error(
      "Fresh 0016 successor V2 capture lacks its exact HMAC, one-attempt plan, or empty cleanup outbox.",
    );
  }
}

function validatePreparedCaptureInvariants(
  prepared: HistoricalFresh0016SuccessorPreparedCapture,
) {
  const expectedPaths = historicalFresh0016SuccessorPaths(
    prepared.paths.backupDirectory,
    prepared.cutoverRunId,
  );
  const expectedOperationId = historicalFresh0016SuccessorOperationId({
    cutoverRunId: prepared.cutoverRunId,
    sourceFingerprint: prepared.sourceFingerprint,
    ...prepared.workerRelease,
    captureLiveTopology: prepared.captureLiveTopology,
    hmacKeyId: prepared.hmacKeyId,
    predecessorReportSha256: prepared.predecessor.reportSha256,
    runtimeVerificationStageSha256:
      prepared.migrationRuntimeVerification.stageSha256,
    runtimeVerificationReportSha256:
      prepared.migrationRuntimeVerification.reportSha256,
    productionExclusionOwnerSha256:
      prepared.productionExclusion.ownerSha256,
  });
  const expectedAuthorization = preparedAuthorizationSchema.parse({
    phase: "successor",
    d1ExecutionMayStart: true,
    cutoverRunId: prepared.cutoverRunId,
    operationId: prepared.operationId,
    accountingParentOperationId: prepared.accountingParentOperationId,
    sourceFingerprint: prepared.sourceFingerprint,
    workerRelease: prepared.workerRelease,
    captureLiveTopology: prepared.captureLiveTopology,
    hmacKeyId: prepared.hmacKeyId,
    snapshotPlanSha256: prepared.snapshotPlanSha256,
    predecessorReportSha256: prepared.predecessor.reportSha256,
    runtimeVerificationStageSha256:
      prepared.migrationRuntimeVerification.stageSha256,
    runtimeVerificationReportSha256:
      prepared.migrationRuntimeVerification.reportSha256,
    productionExclusionOwnerSha256:
      prepared.productionExclusion.ownerSha256,
    utcDay: prepared.utcDay,
    maximumReservationRevision: prepared.maximumReservation.revision,
    maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    maximumRowsWritten: 0,
    authorizationStageSha256:
      prepared.authorization.authorizationStageSha256,
  });
  if (
    prepared.paths.runDirectory !== expectedPaths.runDirectory ||
    prepared.paths.reportPath !== expectedPaths.reportPath ||
    prepared.operationId !== expectedOperationId ||
    prepared.predecessor.hmacKeyId !== prepared.hmacKeyId ||
    !sameSource(
      prepared.predecessor.sourceFingerprint,
      prepared.sourceFingerprint,
    ) ||
    prepared.migrationRuntimeVerification.productionExclusionOwnerSha256 !==
      prepared.productionExclusion.ownerSha256 ||
    stableStringify(prepared.authorization) !==
      stableStringify(expectedAuthorization)
  ) {
    throw new Error(
      "Fresh 0016 prepared capture lost its path, source, HMAC, runtime, authorization, exclusion, or operation binding.",
    );
  }
  const maximum = prepared.maximumReservation;
  const expectedLedgerPath = path.join(
    prepared.paths.backupDirectory,
    "cloudflare",
    `d1-release-budget-ledger-${prepared.utcDay}.json`,
  );
  if (
    maximum.ledgerPath !== expectedLedgerPath ||
    maximum.utcDay !== prepared.utcDay ||
    maximum.reservation.operationId !== prepared.operationId ||
    maximum.reservation.candidateVersionId !==
      prepared.workerRelease.targetCandidateVersionId
  ) {
    throw new Error(
      "Fresh 0016 prepared capture lost its exact maximum-ledger binding.",
    );
  }
  validateLedgerUsage(maximum, prepared.usage, "prepared maximum");
  validateSuccessorCapture(prepared.capture, prepared.hmacKeyId);
  if (
    prepared.captureSha256 !==
      sha256(stableStringify(prepared.capture)) ||
    prepared.rowsRead !== prepared.capture.rowsRead ||
    prepared.rowsWritten !== prepared.capture.rowsWritten ||
    prepared.resultSetCount !== prepared.capture.resultSetCount ||
    prepared.automaticAttemptsPerResultSet !==
      prepared.capture.automaticAttemptsPerResultSet
  ) {
    throw new Error(
      "Fresh 0016 prepared capture hash or execution summary does not match its full V2 evidence.",
    );
  }
  validateHistoricalProtectedDatasetEvidence(
    prepared.capture.datasets,
    prepared.capture.supplementalDatasets,
  );
  const predecessorAt = Date.parse(prepared.predecessor.createdAt);
  const runtimeAt = Date.parse(
    prepared.migrationRuntimeVerification.createdAt,
  );
  const maximumCreatedAt = Date.parse(maximum.reservation.createdAt);
  const maximumUpdatedAt = Date.parse(maximum.reservation.updatedAt);
  const startedAt = Date.parse(prepared.captureStartedAt);
  const completedAt = Date.parse(prepared.captureCompletedAt);
  const plannedExactAt = Date.parse(prepared.plannedExactReservedAt);
  const plannedCreatedAt = Date.parse(prepared.plannedReportCreatedAt);
  if (
    maximum.utcDay !== maximum.reservation.createdAt.slice(0, 10) ||
    maximum.utcDay !== maximum.reservation.updatedAt.slice(0, 10) ||
    prepared.utcDay !== prepared.captureStartedAt.slice(0, 10) ||
    prepared.utcDay !== prepared.captureCompletedAt.slice(0, 10) ||
    prepared.utcDay !== prepared.plannedExactReservedAt.slice(0, 10) ||
    prepared.utcDay !== prepared.plannedReportCreatedAt.slice(0, 10) ||
    predecessorAt > runtimeAt ||
    runtimeAt > maximumCreatedAt ||
    maximumCreatedAt > maximumUpdatedAt ||
    maximumUpdatedAt > startedAt ||
    startedAt > completedAt ||
    completedAt > plannedExactAt ||
    plannedExactAt > plannedCreatedAt ||
    plannedCreatedAt - predecessorAt !==
      prepared.predecessorToSuccessorGapMs ||
    prepared.productionExclusion.leaseExpiresAt <= plannedCreatedAt
  ) {
    throw new Error(
      "Fresh 0016 prepared capture timestamps, gap, reservation, or exclusion lease are invalid.",
    );
  }
}

function assertPreparedLedgerIsLive(
  prepared: HistoricalFresh0016SuccessorPreparedCapture,
  now: Date,
) {
  let maximumFailure: unknown;
  try {
    const liveMaximum = maximumLedgerResultSchema.parse(
      assertD1ReleaseBudgetReservation({
        ledgerPath: prepared.maximumReservation.ledgerPath,
        utcDay: prepared.utcDay,
        operationId: prepared.operationId,
        sourceFingerprint: prepared.sourceFingerprint,
        candidateVersionId: prepared.workerRelease.targetCandidateVersionId,
        accountingParentOperationId: prepared.accountingParentOperationId,
        phase: "maximum",
        rowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
        rowsWritten: 0,
        now,
      }),
    );
    if (
      !sameLedgerResultIgnoringIdempotence(
        prepared.maximumReservation,
        liveMaximum,
      )
    ) {
      throw new Error(
        "Fresh 0016 prepared maximum ledger no longer matches live evidence.",
      );
    }
    return;
  } catch (error) {
    maximumFailure = error;
  }
  try {
    const liveExact = liveExactLedgerResultSchema.parse(
      assertD1ReleaseBudgetReservation({
        ledgerPath: prepared.maximumReservation.ledgerPath,
        utcDay: prepared.utcDay,
        operationId: prepared.operationId,
        sourceFingerprint: prepared.sourceFingerprint,
        candidateVersionId: prepared.workerRelease.targetCandidateVersionId,
        accountingParentOperationId: prepared.accountingParentOperationId,
        phase: "exact",
        rowsRead: prepared.capture.rowsRead,
        rowsWritten: 0,
        now,
      }),
    );
    validateExactLedgerTransition(prepared, liveExact);
  } catch (exactFailure) {
    throw new AggregateError(
      [maximumFailure, exactFailure],
      "Fresh 0016 prepared capture has neither its exact live maximum nor exact ledger reservation.",
    );
  }
}

function validateExactLedgerTransition(
  prepared: HistoricalFresh0016SuccessorPreparedCapture,
  exact: z.infer<typeof liveExactLedgerResultSchema>,
) {
  const maximum = prepared.maximumReservation;
  if (
    exact.ledgerPath !== maximum.ledgerPath ||
    exact.utcDay !== prepared.utcDay ||
    exact.reservation.operationId !== prepared.operationId ||
    exact.reservation.candidateVersionId !==
      prepared.workerRelease.targetCandidateVersionId ||
    exact.reservation.rowsRead !== prepared.capture.rowsRead ||
    exact.reservation.updatedAt !== prepared.plannedExactReservedAt ||
    exact.reservation.createdAt !== maximum.reservation.createdAt ||
    exact.revision <= maximum.revision ||
    maximum.totals.rowsRead !== exact.totals.rowsRead ||
    maximum.totals.rowsWritten !== exact.totals.rowsWritten ||
    maximum.accountedUsage.rowsRead !== exact.accountedUsage.rowsRead ||
    maximum.accountedUsage.rowsWritten !== exact.accountedUsage.rowsWritten
  ) {
    throw new Error(
      "Fresh 0016 prepared capture does not prove its exact maximum-to-actual ledger refinement.",
    );
  }
  validateLedgerUsage(exact, prepared.usage, "prepared exact");
}

function sameLedgerResultIgnoringIdempotence(
  left: D1ReleaseBudgetReservationResult,
  right: D1ReleaseBudgetReservationResult,
) {
  return stableStringify({ ...left, idempotent: false }) ===
    stableStringify({ ...right, idempotent: false });
}

function validateReportInvariants(report: HistoricalFresh0016SuccessorReport) {
  const expectedPaths = historicalFresh0016SuccessorPaths(
    report.paths.backupDirectory,
    report.cutoverRunId,
  );
  if (
    report.paths.runDirectory !== expectedPaths.runDirectory ||
    report.paths.reportPath !== expectedPaths.reportPath
  ) {
    throw new Error(
      "Fresh 0016 successor report paths do not match its exact run identity.",
    );
  }
  const expectedOperationId = historicalFresh0016SuccessorOperationId({
    cutoverRunId: report.cutoverRunId,
    sourceFingerprint: report.sourceFingerprint,
    ...report.workerRelease,
    captureLiveTopology: report.captureLiveTopology,
    hmacKeyId: report.hmacKeyId,
    predecessorReportSha256: report.predecessor.reportSha256,
    runtimeVerificationStageSha256:
      report.migrationRuntimeVerification.stageSha256,
    runtimeVerificationReportSha256:
      report.migrationRuntimeVerification.reportSha256,
    productionExclusionOwnerSha256:
      report.productionExclusion.ownerSha256,
  });
  if (
    report.operationId !== expectedOperationId ||
    report.predecessor.hmacKeyId !== report.hmacKeyId ||
    !sameSource(report.predecessor.sourceFingerprint, report.sourceFingerprint) ||
    report.migrationRuntimeVerification.productionExclusionOwnerSha256 !==
      report.productionExclusion.ownerSha256
  ) {
    throw new Error(
      "Fresh 0016 successor report lost its source, HMAC, runtime, exclusion, or operation binding.",
    );
  }
  const maximum = report.ledger.maximum;
  const exact = report.ledger.exact;
  const expectedLedgerPath = path.join(
    report.paths.backupDirectory,
    "cloudflare",
    `d1-release-budget-ledger-${report.utcDay}.json`,
  );
  if (
    maximum.ledgerPath !== expectedLedgerPath ||
    exact.ledgerPath !== expectedLedgerPath ||
    maximum.utcDay !== report.utcDay ||
    exact.utcDay !== report.utcDay ||
    maximum.reservation.operationId !== report.operationId ||
    exact.reservation.operationId !== report.operationId ||
    maximum.reservation.candidateVersionId !==
      report.workerRelease.targetCandidateVersionId ||
    exact.reservation.candidateVersionId !==
      report.workerRelease.targetCandidateVersionId ||
    exact.reservation.rowsRead !== report.rowsRead ||
    exact.reservation.rowsWritten !== report.rowsWritten ||
    exact.revision <= maximum.revision ||
    maximum.reservation.createdAt !== exact.reservation.createdAt ||
    maximum.totals.rowsRead !== exact.totals.rowsRead ||
    maximum.totals.rowsWritten !== exact.totals.rowsWritten ||
    maximum.accountedUsage.rowsRead !== exact.accountedUsage.rowsRead ||
    maximum.accountedUsage.rowsWritten !== exact.accountedUsage.rowsWritten
  ) {
    throw new Error(
      "Fresh 0016 successor report does not prove one exact maximum-to-actual ledger refinement.",
    );
  }
  validateLedgerUsage(maximum, report.usage, "maximum");
  validateLedgerUsage(exact, report.usage, "exact");
  const predecessorAt = Date.parse(report.predecessor.createdAt);
  const runtimeAt = Date.parse(report.migrationRuntimeVerification.createdAt);
  const maximumCreatedAt = Date.parse(maximum.reservation.createdAt);
  const maximumUpdatedAt = Date.parse(maximum.reservation.updatedAt);
  const startedAt = Date.parse(report.captureStartedAt);
  const completedAt = Date.parse(report.captureCompletedAt);
  const exactAt = Date.parse(exact.reservation.updatedAt);
  const createdAt = Date.parse(report.createdAt);
  const finalizedAt = Date.parse(report.finalizedAt);
  if (
    report.utcDay !== report.captureStartedAt.slice(0, 10) ||
    report.utcDay !== report.captureCompletedAt.slice(0, 10) ||
    report.utcDay !== report.exactReservedAt.slice(0, 10) ||
    report.utcDay !== report.createdAt.slice(0, 10) ||
    report.utcDay !== report.finalizedAt.slice(0, 10) ||
    report.exactReservedAt !== exact.reservation.updatedAt ||
    predecessorAt > runtimeAt ||
    runtimeAt > maximumCreatedAt ||
    maximumCreatedAt > maximumUpdatedAt ||
    maximumUpdatedAt > startedAt ||
    startedAt > completedAt ||
    completedAt > exactAt ||
    exactAt > createdAt ||
    createdAt > finalizedAt ||
    createdAt - predecessorAt !== report.predecessorToSuccessorGapMs ||
    report.productionExclusion.leaseExpiresAt <= finalizedAt
  ) {
    throw new Error(
      "Fresh 0016 successor timestamps, gap, reservation, or exclusion lease are invalid.",
    );
  }
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: report.captureLiveTopology,
    boundaryAt: new Date(report.captureStartedAt),
    ...report.workerRelease,
  });
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: report.finalizationLiveTopology,
    boundaryAt: new Date(report.finalizedAt),
    ...report.workerRelease,
  });
  if (
    Date.parse(report.finalizationLiveTopology.observedAt) <=
    Date.parse(report.captureLiveTopology.observedAt)
  ) {
    throw new Error(
      "Fresh 0016 successor report requires capture and newer finalization topology observations.",
    );
  }
  validateHistoricalProtectedDatasetEvidence(
    report.datasets,
    report.supplementalDatasets,
  );
  const outbox = report.operationalDatasets.memory_vector_cleanup_outbox;
  if (
    historicalDataSchemaHash(outbox.columns) !== outbox.schemaSha256 ||
    !hasRequiredHistoricalMemoryVectorCleanupOutboxSchema(outbox)
  ) {
    throw new Error(
      "Fresh 0016 successor cleanup outbox schema is missing or invalid.",
    );
  }
}

function validateLedgerUsage(
  ledger:
    | z.infer<typeof maximumLedgerResultSchema>
    | z.infer<typeof liveExactLedgerResultSchema>,
  usage: D1DailyUsage,
  label: string,
) {
  const minimumRowsRead = safeAdd(
    usage.rowsRead,
    ledger.totals.rowsRead,
    `${label} rows read`,
  );
  const minimumRowsWritten = safeAdd(
    usage.rowsWritten,
    ledger.totals.rowsWritten,
    `${label} rows written`,
  );
  if (
    ledger.accountedUsage.rowsRead < minimumRowsRead ||
    ledger.accountedUsage.rowsWritten < minimumRowsWritten
  ) {
    throw new Error(
      `Fresh 0016 successor ${label} ledger does not cover exact usage.`,
    );
  }
  if (
    ledger.accountedUsage.rowsRead <= D1_FREE_SAFE_ROWS_READ_LIMIT &&
    ledger.accountedUsage.rowsWritten <= D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
  ) {
    return;
  }

  const liveLedger = readD1ReleaseBudgetLedger(ledger.ledgerPath);
  if (
    liveLedger.utcDay !== ledger.utcDay ||
    liveLedger.admissionMode !== D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE
  ) {
    throw new Error(
      `Fresh 0016 successor ${label} ledger exceeds Workers Free safety limits without exact paid-expedited admission evidence.`,
    );
  }
}

function cloneLedgerResult<T extends D1ReleaseBudgetReservationResult>(
  ledger: T,
) {
  return {
    ledgerPath: ledger.ledgerPath,
    utcDay: ledger.utcDay,
    revision: ledger.revision,
    idempotent: ledger.idempotent,
    reservation: { ...ledger.reservation },
    totals: { ...ledger.totals },
    accountedUsage: { ...ledger.accountedUsage },
  };
}

function cloneV2Capture(
  capture: HistoricalDataV2SnapshotEvidence,
): HistoricalDataV2SnapshotEvidence {
  return {
    snapshotPlanSha256: capture.snapshotPlanSha256,
    resultSetCount: capture.resultSetCount,
    automaticAttemptsPerResultSet:
      capture.automaticAttemptsPerResultSet,
    rowsRead: capture.rowsRead,
    rowsWritten: 0,
    hmacKeyId: capture.hmacKeyId,
    datasets: cloneDatasets(capture.datasets),
    supplementalDatasets: cloneSupplementalDatasets(
      capture.supplementalDatasets,
    ),
    operationalDatasets: cloneOperationalDatasets(
      capture.operationalDatasets,
    ),
  };
}

function cloneDatasets(
  datasets: HistoricalDataV2SnapshotEvidence["datasets"],
) {
  const result: Partial<
    Record<HistoricalDatasetName, HistoricalDatasetEvidence>
  > = {};
  for (const name of HISTORICAL_DATASET_NAMES) {
    result[name] = cloneDatasetEvidence(datasets[name]);
  }
  assertCompleteDatasets(result);
  return result;
}

function cloneSupplementalDatasets(
  datasets: HistoricalDataV2SnapshotEvidence["supplementalDatasets"],
) {
  const result: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  > = {};
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    result[name] = cloneDatasetEvidence(datasets[name]);
  }
  assertCompleteSupplementalDatasets(result);
  return result;
}

function cloneOperationalDatasets(
  datasets: HistoricalDataV2SnapshotEvidence["operationalDatasets"],
) {
  return {
    memory_vector_cleanup_outbox: mutableOperationalEvidence(
      datasets.memory_vector_cleanup_outbox,
    ),
  };
}

function cloneDatasetEvidence(
  dataset: HistoricalDataV2SnapshotEvidence["datasets"][HistoricalDatasetName],
): HistoricalDatasetEvidence {
  return {
    rowCount: dataset.rowCount,
    schemaTable: dataset.schemaTable,
    schemaSha256: dataset.schemaSha256,
    columns: dataset.columns.map((column) => ({ ...column })),
    sentinels: [...dataset.sentinels],
    ...(dataset.schemaObjects
      ? { schemaObjects: { ...dataset.schemaObjects } }
      : {}),
  };
}

function mutableOperationalEvidence(
  dataset: HistoricalDataV2SnapshotEvidence["operationalDatasets"]["memory_vector_cleanup_outbox"],
): HistoricalOperationalDatasetEvidence {
  return {
    lifecycle: dataset.lifecycle,
    rowCount: dataset.rowCount,
    schemaTable: dataset.schemaTable,
    schemaSha256: dataset.schemaSha256,
    columns: dataset.columns.map((column) => ({ ...column })),
  };
}

function assertCompleteDatasets(
  datasets: Partial<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
): asserts datasets is Record<HistoricalDatasetName, HistoricalDatasetEvidence> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!datasets[name]) throw new Error(`Fresh 0016 successor omitted ${name}.`);
  }
}

function assertCompleteSupplementalDatasets(
  datasets: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
): asserts datasets is Record<
  HistoricalSupplementalDatasetName,
  HistoricalDatasetEvidence
> {
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    if (!datasets[name]) throw new Error(`Fresh 0016 successor omitted ${name}.`);
  }
}

function serializeReport(
  report: HistoricalFresh0016SuccessorReport,
  forbiddenPlaintext: readonly string[],
) {
  const payload = Buffer.from(`${stableStringify(report)}\n`, "utf8");
  if (
    payload.byteLength <= 0 ||
    payload.byteLength > HISTORICAL_FRESH_0016_SUCCESSOR_MAXIMUM_BYTES
  ) {
    throw new Error("Fresh 0016 successor report exceeds its byte limit.");
  }
  assertNoForbiddenPlaintext(payload.toString("utf8"), forbiddenPlaintext);
  return payload;
}

function assertNoForbiddenPlaintext(
  value: unknown,
  forbiddenPlaintext: readonly string[],
) {
  const forbidden = normalizeForbiddenPlaintext(forbiddenPlaintext);
  if (forbidden.length === 0) return;
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (forbidden.some((entry) => current.includes(entry))) {
        throw new Error(
          "Fresh 0016 successor evidence contains forbidden raw identity or secret plaintext.",
        );
      }
      continue;
    }
    if (typeof current !== "object" || current === null) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      pending.push(key, nested);
    }
  }
}

function normalizeForbiddenPlaintext(values: readonly string[]) {
  const result: string[] = [];
  for (const value of values) {
    if (
      typeof value !== "string" ||
      value.length < 8 ||
      Buffer.byteLength(value, "utf8") > 1_024 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new Error(
        "Fresh 0016 successor privacy substrings must be bounded printable values of at least eight characters.",
      );
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function assertPrivatePathHierarchy(
  paths: HistoricalFresh0016SuccessorPaths,
): HistoricalFresh0016SuccessorDirectoryIdentity {
  const policyRoot = path.dirname(paths.runDirectory);
  assertContainedPath(paths.backupDirectory, policyRoot, "policy root");
  assertDirectDescendant(policyRoot, paths.runDirectory, "run directory");
  assertDirectDescendant(paths.runDirectory, paths.reportPath, "successor report");
  const identities = Object.freeze({
    backupDirectory: assertPrivateDirectory(
      paths.backupDirectory,
      "backup directory",
    ),
    policyRoot: assertPrivateDirectory(policyRoot, "policy root"),
    runDirectory: assertPrivateDirectory(paths.runDirectory, "run directory"),
  });
  if (
    safeRealpath(paths.backupDirectory, "backup directory") !==
      paths.backupDirectory ||
    safeRealpath(policyRoot, "policy root") !== policyRoot ||
    safeRealpath(paths.runDirectory, "run directory") !== paths.runDirectory
  ) {
    throw new Error(
      "Fresh 0016 successor directory hierarchy is linked or noncanonical.",
    );
  }
  assertSamePathHierarchy(paths, identities);
  return identities;
}

function assertPrivateDirectory(directory: string, label: string) {
  const absolute = normalizeAbsolutePath(directory, label);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error(
      `Fresh 0016 successor ${label} must be a real owner-only mode-0700 directory.`,
    );
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw new Error(
        `Fresh 0016 successor ${label} must be a real owner-only mode-0700 directory.`,
      );
    }
    return fileIdentity(stat);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncPrivateDirectory(
  directory: string,
  expectedIdentity: Readonly<{ device: number; inode: number }>,
) {
  const descriptor = fs.openSync(
    directory,
    fs.constants.O_RDONLY |
      fs.constants.O_DIRECTORY |
      fs.constants.O_NOFOLLOW,
  );
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isDirectory() ||
      (before.mode & 0o777) !== 0o700 ||
      !sameFileIdentity(fileIdentity(before), expectedIdentity) ||
      (typeof process.getuid === "function" && before.uid !== process.getuid())
    ) {
      throw new Error(
        "Fresh 0016 successor run directory changed before durable publication.",
      );
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameStableFile(before, after)) {
      throw new Error(
        "Fresh 0016 successor run directory changed during durable publication.",
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSamePathHierarchy(
  paths: HistoricalFresh0016SuccessorPaths,
  expected: HistoricalFresh0016SuccessorDirectoryIdentity,
) {
  const policyRoot = path.dirname(paths.runDirectory);
  assertSameDirectoryIdentity(
    paths.backupDirectory,
    expected.backupDirectory,
    "backup directory",
  );
  assertSameDirectoryIdentity(policyRoot, expected.policyRoot, "policy root");
  assertSameDirectoryIdentity(
    paths.runDirectory,
    expected.runDirectory,
    "run directory",
  );
}

function assertSameDirectoryIdentity(
  directory: string,
  expected: Readonly<{ device: number; inode: number }>,
  label: string,
) {
  if (!sameFileIdentity(assertPrivateDirectory(directory, label), expected)) {
    throw new Error(
      `Fresh 0016 successor ${label} changed during report access.`,
    );
  }
}

function assertPrivateReportStat(
  stat: fs.Stats,
  expectedBytes: number | undefined,
  label: string,
) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.nlink !== 1 ||
    stat.size < 0 ||
    stat.size > HISTORICAL_FRESH_0016_SUCCESSOR_MAXIMUM_BYTES ||
    (expectedBytes !== undefined && stat.size !== expectedBytes) ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(
      `Fresh 0016 ${label} has unsafe ownership, mode, type, link count, or size.`,
    );
  }
}

function safeLstat(file: string) {
  try {
    return fs.lstatSync(file);
  } catch {
    throw new Error("Fresh 0016 successor report path is missing or unsafe.");
  }
}

function safeRealpath(directory: string, label: string) {
  try {
    return fs.realpathSync.native(directory);
  } catch {
    throw new Error(
      `Fresh 0016 successor ${label} cannot be resolved safely.`,
    );
  }
}

function fileIdentity(stat: fs.Stats) {
  return Object.freeze({ device: stat.dev, inode: stat.ino });
}

function sameFileIdentity(
  left: Readonly<{ device: number; inode: number }>,
  right: Readonly<{ device: number; inode: number }>,
) {
  return left.device === right.device && left.inode === right.inode;
}

function sameStableFile(left: fs.Stats, right: fs.Stats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.nlink === right.nlink
  );
}

function normalizeAbsolutePath(value: string, label: string) {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Fresh 0016 successor ${label} is unsafe.`);
  }
  return path.resolve(value);
}

function assertDirectDescendant(parent: string, child: string, label: string) {
  if (path.dirname(child) !== parent || child === parent) {
    throw new Error(
      `Fresh 0016 successor ${label} must be an exact direct descendant.`,
    );
  }
}

function assertContainedPath(parent: string, child: string, label: string) {
  const relative = path.relative(parent, child);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      `Fresh 0016 successor ${label} must stay inside its exact parent.`,
    );
  }
}

function validateSourceIdentity(value: D1ReleaseSourceIdentity) {
  return {
    sha256: requireSha256(value.sha256, "source SHA-256"),
    fileCount: requirePositiveSafeInteger(
      value.fileCount,
      "source file count",
    ),
  };
}

function parseUploadedInactiveWorkerRelease(input: Readonly<{
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>) {
  return uploadedInactiveWorkerReleaseSchema.parse({
    phase: "uploaded-inactive",
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
}

function requireUploadedInactiveWorkerRelease(input: Readonly<{
  backupDirectory: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>) {
  const workerRelease = parseUploadedInactiveWorkerRelease(input);
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(input.backupDirectory),
  );
  if (
    upload.sha256 !== workerRelease.uploadEvidenceSha256 ||
    upload.value.targetCandidateVersionId !==
      workerRelease.targetCandidateVersionId ||
    upload.value.serviceBaselineVersionId !==
      workerRelease.serviceBaselineVersionId ||
    upload.value.soleBaselineTopology.serviceBaselineVersionId !==
      workerRelease.serviceBaselineVersionId ||
    upload.value.soleBaselineTopology.percentage !== 100 ||
    upload.value.soleBaselineTopology.observedVersions !== 1 ||
    upload.value.artifacts.sourceFingerprintSha256 !==
      input.sourceFingerprint.sha256 ||
    upload.value.artifacts.sourceFingerprintFileCount !==
      input.sourceFingerprint.fileCount
  ) {
    throw new Error(
      "Fresh 0016 successor requires the exact inactive upload evidence while the baseline remains the sole 100% serving Worker.",
    );
  }
  return workerRelease;
}

function assertLiveTopologyPostdatesUpload(
  backupDirectory: string,
  topology: HistoricalFresh0016LiveTopologyEvidence,
) {
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
  );
  if (Date.parse(topology.observedAt) < Date.parse(upload.value.createdAt)) {
    throw new Error(
      "Fresh 0016 successor live topology cannot predate the candidate upload evidence.",
    );
  }
}

function requireUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) {
    throw new Error(`Fresh 0016 successor ${label} must be an exact UUID.`);
  }
  return value;
}

function requireSha256(value: string, label: string) {
  if (!sha256Pattern.test(value)) {
    throw new Error(
      `Fresh 0016 successor ${label} must be an exact SHA-256.`,
    );
  }
  return value;
}

function requirePositiveSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Fresh 0016 successor ${label} must be a positive safe integer.`,
    );
  }
  return value;
}

function readClock(clock: () => Date, label: string) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Fresh 0016 successor ${label} clock is invalid.`);
  }
  return new Date(value.getTime());
}

function assertMonotonicDate(before: Date, after: Date, label: string) {
  if (after.getTime() < before.getTime()) {
    throw new Error(`Fresh 0016 successor ${label} clock moved backwards.`);
  }
}

function sameSource(
  left: D1ReleaseSourceIdentity,
  right: D1ReleaseSourceIdentity,
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function canonicalValueSha256(value: unknown) {
  return sha256(`${stableStringify(value)}\n`);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function safeAdd(left: number, right: number, label: string) {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new Error(`Fresh 0016 successor ${label} overflowed.`);
  }
  return left + right;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
  } else {
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  Object.freeze(value);
  return value;
}
