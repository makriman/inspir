import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET,
  HISTORICAL_FRESH_0016_APPLY_COMPLETE_KIND,
  HISTORICAL_FRESH_0016_APPLY_READBACK_RESOLUTION_KIND,
  historicalFresh0016ApplyAuthorizationPayloadSchema,
} from "./apply-historical-data-fresh-0016-migration";
import {
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
  projectRuntimeMigrationUsage,
} from "./check-d1-runtime-migration-budget";
import {
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
} from "./d1-free-budget";
import {
  D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
  readD1ReleaseBudgetLedger,
} from "./d1-release-budget-ledger";
import {
  assertHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_RELATIVE_PATH,
  HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE,
  HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE,
  historicalFresh0016LiveTopologyEvidenceSchema,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_PAID_EXPEDITED_SAME_DAY_TIMING,
  historicalFresh0016PredecessorPrerequisitesSchema,
} from "./historical-data-fresh-0016-prerequisites";
import {
  readHistoricalFresh0016Day2BudgetEnvelope,
} from "./historical-data-fresh-0016-day2-budget";
import { evaluateHistoricalFresh0016Continuity } from "./historical-data-fresh-0016-continuity-evaluation";
import {
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
  historicalFresh0016MigrationBindingSchema,
  historicalFresh0016RenderedMigrationEvidenceSchema,
  readHistoricalFresh0016RenderedMigration,
} from "./historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
  historicalFresh0016MigrationBudgetPreparedSchema,
  readHistoricalFresh0016MigrationBudgetPrepared,
} from "./historical-data-fresh-0016-migration-budget";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_CAPTURE_KIND,
  HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
  historicalFresh0016PredecessorPreparedCaptureSha256,
  parseHistoricalFresh0016PredecessorPreparedCapture,
  parseHistoricalFresh0016PredecessorReport,
  readHistoricalFresh0016PredecessorReport,
  type HistoricalFresh0016PredecessorPreparedCapture,
} from "./historical-data-fresh-0016-predecessor";
import {
  HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  HISTORICAL_FRESH_0016_STATE_STAGES,
  canonicalHistoricalFresh0016Json,
  classifyHistoricalFresh0016State,
  historicalFresh0016JsonSha256,
  historicalFresh0016StatePaths,
  type HistoricalFresh0016StateClassification,
  type HistoricalFresh0016StateFileHandle,
  type HistoricalFresh0016StateStage,
  type HistoricalFresh0016StateStageEnvelope,
} from "./historical-data-fresh-0016-state";
import {
  HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
  historicalFresh0016SuccessorPreparedCaptureSha256,
  historicalFresh0016SuccessorRuntimeVerificationReportSha256,
  parseHistoricalFresh0016SuccessorPreparedCapture,
  parseHistoricalFresh0016SuccessorReport,
  readHistoricalFresh0016SuccessorReport,
  type HistoricalFresh0016SuccessorPreparedCapture,
} from "./historical-data-fresh-0016-successor";
import {
  HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES,
  HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
  HISTORICAL_PRE_0016_SNAPSHOT_KIND,
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  createHistoricalPre0016SnapshotPlan,
} from "./historical-data-pre-0016-snapshot";
import {
  canonicalProductionValidationLockOwner,
  parseProductionValidationLockOwner,
} from "./production-validation-lock";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import {
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256,
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256,
  HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256,
  HISTORICAL_OPERATIONAL_DATASET_NAMES,
  HISTORICAL_PROTECTED_DATASET_COUNT,
  HISTORICAL_SCHEMA_COLUMN_LIMIT,
  HISTORICAL_SENTINEL_LIMIT,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
} from "./verify-historical-data-preservation";
import {
  HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
  historicalFresh0016RuntimeVerificationReportSchema,
} from "./verify-historical-data-fresh-0016-migration";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
} from "./verify-d1-runtime-migrations";

export const HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND =
  "inspir-historical-data-fresh-0016-claim-v2" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_AUTHORIZATION_KIND =
  "inspir-historical-data-fresh-0016-predecessor-authorization-v2" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_KIND =
  HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_CAPTURE_KIND;
export const HISTORICAL_FRESH_0016_PREDECESSOR_COMPLETE_KIND =
  "inspir-historical-data-fresh-0016-predecessor-complete-v1" as const;
export const HISTORICAL_FRESH_0016_MANIFEST_KIND =
  "inspir-historical-data-fresh-0016-manifest-v2" as const;
export const HISTORICAL_FRESH_0016_MIGRATION_BUDGET_KIND =
  "inspir-historical-data-fresh-0016-migration-budget-v2" as const;
export const HISTORICAL_FRESH_0016_RUNTIME_STAGE_KIND =
  "inspir-historical-data-fresh-0016-runtime-stage-v1" as const;
export const HISTORICAL_FRESH_0016_SUCCESSOR_AUTHORIZATION_KIND =
  "inspir-historical-data-fresh-0016-successor-authorization-v2" as const;
export const HISTORICAL_FRESH_0016_SUCCESSOR_COMPLETE_KIND =
  "inspir-historical-data-fresh-0016-successor-complete-v1" as const;
export const HISTORICAL_FRESH_0016_CUTOVER_COMPLETION_INTENT_KIND =
  "inspir-historical-data-fresh-0016-cutover-completion-intent-v1" as const;
export const HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_KIND =
  "inspir-historical-data-fresh-0016-cutover-complete-v2" as const;
export const HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_MAXIMUM_BYTES =
  1024 * 1024;

const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const workerVersionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256Schema = z.string().regex(sha256Pattern);
const uuidSchema = z.string().regex(uuidPattern);
const workerVersionSchema = z.string().regex(workerVersionPattern);
const nonnegativeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a nonnegative safe integer.",
);
const positiveIntegerSchema = nonnegativeIntegerSchema.refine(
  (value) => value > 0,
  "Expected a positive safe integer.",
);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical ISO timestamp.");
const utcDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) =>
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  "Expected a valid UTC day.",
);
const releaseTimingModeSchema = z.enum([
  HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE,
  HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE,
]);
const absolutePathSchema = z.string().min(1).max(4_096).refine(
  (value) =>
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    !/[\u0000-\u001f\u007f]/.test(value),
  "Expected a normalized absolute path.",
);
const sourceIdentitySchema = z.object({
  sha256: sha256Schema,
  fileCount: positiveIntegerSchema,
}).strict();
const uploadedInactiveWorkerReleaseSchema = z.object({
  phase: z.literal("uploaded-inactive"),
  targetCandidateVersionId: workerVersionSchema,
  serviceBaselineVersionId: workerVersionSchema,
  uploadEvidenceSha256: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.targetCandidateVersionId === value.serviceBaselineVersionId) {
    context.addIssue({
      code: "custom",
      message: "The cutover candidate must differ from the serving baseline.",
    });
  }
});
const databaseSchema = z.object({
  id: z.literal(policy.database.id),
  name: z.literal(policy.database.name),
}).strict();
const usageSchema = z.object({
  databaseCount: positiveIntegerSchema,
  queryGroups: nonnegativeIntegerSchema,
  rowsRead: nonnegativeIntegerSchema,
  rowsWritten: nonnegativeIntegerSchema,
  executions: nonnegativeIntegerSchema,
  windowMinutes: positiveIntegerSchema.refine((value) => value <= 24 * 60),
}).strict();

const genericReservationSchema = z.object({
  operationId: z.string().min(1).max(256).refine(isPrintable),
  operation: z.string().min(1).max(256).refine(isPrintable),
  candidateVersionId: workerVersionSchema.nullable(),
  phase: z.enum(["maximum", "exact"]),
  rowsRead: nonnegativeIntegerSchema,
  rowsWritten: nonnegativeIntegerSchema,
  maximumRowsRead: nonnegativeIntegerSchema,
  maximumRowsWritten: nonnegativeIntegerSchema,
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
}).strict();
const genericLedgerResultSchema = z.object({
  ledgerPath: absolutePathSchema,
  utcDay: utcDaySchema,
  revision: positiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: genericReservationSchema,
  totals: z.object({
    rowsRead: nonnegativeIntegerSchema,
    rowsWritten: nonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: nonnegativeIntegerSchema,
    rowsWritten: nonnegativeIntegerSchema,
  }).strict(),
}).strict();

const runtimeCardinalitiesSchema = z.object({
  users: nonnegativeIntegerSchema,
  chats: nonnegativeIntegerSchema,
  messages: nonnegativeIntegerSchema,
  aiRuns: nonnegativeIntegerSchema,
  rateLimitWindows: nonnegativeIntegerSchema,
  opsEvents: nonnegativeIntegerSchema,
  activityRuns: nonnegativeIntegerSchema,
  userMemorySettings: nonnegativeIntegerSchema,
  memorySourceFeedback: nonnegativeIntegerSchema,
  suppressionBackfillUsers: nonnegativeIntegerSchema,
}).strict();
const runtimeProjectionSchema = z.object({
  rowsRead: nonnegativeIntegerSchema,
  rowsWritten: nonnegativeIntegerSchema,
  indexedRows: nonnegativeIntegerSchema,
  runtimeIndexRows: nonnegativeIntegerSchema,
  activityPartialUniqueIndexRows: nonnegativeIntegerSchema,
  snapshotRows: nonnegativeIntegerSchema,
  suppressionBackfillRowsRead: nonnegativeIntegerSchema,
  suppressionBackfillRowsWritten: nonnegativeIntegerSchema,
  outboxSchemaRowsRead: nonnegativeIntegerSchema,
  outboxSchemaRowsWritten: nonnegativeIntegerSchema,
  freshCutoverMarkerRowsRead: nonnegativeIntegerSchema,
  freshCutoverMarkerRowsWritten: nonnegativeIntegerSchema,
}).strict();

export const historicalFresh0016MigrationBudgetEvidenceSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_MIGRATION_BUDGET_KIND),
  schemaVersion: z.literal(2),
  createdAt: canonicalTimestampSchema,
  cutoverRunId: uuidSchema,
  utcDay: utcDaySchema,
  operationId: z.string().regex(
    /^historical-fresh-0016-migration:[a-f0-9]{64}$/,
  ),
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  sourceFingerprint: sourceIdentitySchema,
  database: databaseSchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  liveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  day2BudgetEnvelope: z.object({
    operationId: z.string().regex(
      /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
    ),
    fileSha256: sha256Schema,
    predecessorCompleteStageSha256: sha256Schema,
  }).strict(),
  productionExclusionOwnerSha256: sha256Schema,
  usage: usageSchema,
  cardinalities: runtimeCardinalitiesSchema,
  cardinalityQuery: z.object({
    rowsRead: nonnegativeIntegerSchema,
    rowsWritten: z.literal(0),
    totalAttempts: z.literal(1),
    readOnly: z.literal(true),
  }).strict(),
  projection: runtimeProjectionSchema,
  applyEnvelope: z.object({
    projectedRowsRead: z.literal(
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.projectedRowsRead,
    ),
    maximumReadOnlyCalls: z.literal(
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.readOnlyCalls,
    ),
    maximumWriteCapableCalls: z.literal(
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.writeCapableCalls,
    ),
    maximumTotalRunnerCalls: z.literal(
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.totalRunnerCalls,
    ),
  }).strict(),
  maximum: z.object({
    rowsRead: z.literal(
      HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
    ),
    rowsWritten: z.literal(MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES),
    ledger: genericLedgerResultSchema,
  }).strict(),
  exact: z.object({
    rowsRead: nonnegativeIntegerSchema,
    rowsWritten: nonnegativeIntegerSchema,
    ledger: genericLedgerResultSchema,
  }).strict(),
  migrationSource: z.object({
    file: z.literal(policy.migration0016.trackedFile),
    bytes: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES),
    sha256: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256),
  }).strict(),
}).strict();

const maximumPredecessorReservationSchema = genericLedgerResultSchema.superRefine(
  (value, context) => {
    if (
      value.reservation.operation !== HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME ||
      value.reservation.phase !== "maximum" ||
      value.reservation.rowsRead !== HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION ||
      value.reservation.rowsWritten !== 0 ||
      value.reservation.maximumRowsRead !== HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION ||
      value.reservation.maximumRowsWritten !== 0
    ) {
      context.addIssue({ code: "custom", message: "Predecessor maximum reservation is not exact." });
    }
  },
);
const maximumSuccessorReservationSchema = genericLedgerResultSchema.superRefine(
  (value, context) => {
    if (
      value.reservation.operation !== HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME ||
      value.reservation.phase !== "maximum" ||
      value.reservation.rowsRead !== HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT ||
      value.reservation.rowsWritten !== 0 ||
      value.reservation.maximumRowsRead !== HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT ||
      value.reservation.maximumRowsWritten !== 0
    ) {
      context.addIssue({ code: "custom", message: "Successor maximum reservation is not exact." });
    }
  },
);
const productionExclusionOwnerSchema = z.object({
  candidateVersionId: workerVersionSchema,
  leaseExpiresAt: positiveIntegerSchema,
  leaseId: uuidSchema,
  runId: uuidSchema,
  sourceFingerprintSha256: sha256Schema,
}).strict();

const historicalColumnSchema = z.object({
  name: z.string().min(1).max(256),
  type: z.string().max(256),
  notNull: z.union([z.literal(0), z.literal(1)]),
  primaryKey: nonnegativeIntegerSchema,
}).strict();
const historicalGameResultsSchemaObjectsSchema = z.object({
  tableSha256: z.literal(HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256),
  rejectUpdateTriggerSha256: z.literal(
    HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256,
  ),
  combinedSha256: z.literal(HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256),
}).strict();
const protectedDatasetSchema = z.object({
  rowCount: nonnegativeIntegerSchema,
  schemaTable: z.string().min(1).max(128),
  schemaSha256: sha256Schema,
  columns: z.array(historicalColumnSchema).min(1).max(HISTORICAL_SCHEMA_COLUMN_LIMIT),
  sentinels: z.array(sha256Schema).max(HISTORICAL_SENTINEL_LIMIT),
  schemaObjects: historicalGameResultsSchemaObjectsSchema.optional(),
}).strict();
const operationalDatasetSchema = z.object({
  lifecycle: z.literal("mutable-drainable-outbox"),
  rowCount: z.literal(0),
  schemaTable: z.literal("memory_vector_cleanup_outbox"),
  schemaSha256: sha256Schema,
  columns: z.array(historicalColumnSchema).min(1).max(HISTORICAL_SCHEMA_COLUMN_LIMIT),
}).strict();
const predecessorCaptureSchema = z.object({
  plan: z.unknown(),
  rowsRead: positiveIntegerSchema,
  rowsWritten: z.literal(0),
  hmacKeyId: sha256Schema,
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), protectedDatasetSchema),
  supplementalDatasets: z.record(
    z.enum(HISTORICAL_SUPPLEMENTAL_DATASET_NAMES),
    protectedDatasetSchema,
  ),
}).strict();
const successorCaptureSchema = z.object({
  snapshotPlanSha256: z.literal(policy.successor.snapshotPlanSha256),
  resultSetCount: z.literal(HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT),
  automaticAttemptsPerResultSet: z.literal(1),
  rowsRead: positiveIntegerSchema,
  rowsWritten: z.literal(0),
  hmacKeyId: sha256Schema,
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), protectedDatasetSchema),
  supplementalDatasets: z.record(
    z.enum(HISTORICAL_SUPPLEMENTAL_DATASET_NAMES),
    protectedDatasetSchema,
  ),
  operationalDatasets: z.record(
    z.enum(HISTORICAL_OPERATIONAL_DATASET_NAMES),
    operationalDatasetSchema,
  ),
}).strict();

export const historicalFresh0016ClaimPayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND),
  schemaVersion: z.literal(2),
  releaseTimingMode: releaseTimingModeSchema.optional(),
  operatorConfirmationFlag: z.literal(HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG),
  lostKeyBoundaryAccepted: z.literal(true),
  legacyIntervalContinuityProven: z.literal(false),
  retroactiveContinuityClaimed: z.literal(false),
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  database: databaseSchema,
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  claimLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  predecessorPrerequisites:
    historicalFresh0016PredecessorPrerequisitesSchema,
}).strict().superRefine((value, context) => {
  const releaseTimingMode =
    value.releaseTimingMode ??
    HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE;
  if (
    value.predecessorPrerequisites.timing ===
      HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_PAID_EXPEDITED_SAME_DAY_TIMING &&
    releaseTimingMode !== HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Fresh-0016 same-day predecessor prerequisites require paid-expedited release timing.",
    });
  }
});

export const historicalFresh0016PredecessorAuthorizationPayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_AUTHORIZATION_KIND),
  schemaVersion: z.literal(2),
  claimStageSha256: sha256Schema,
  operationId: z.string().regex(/^historical-fresh-0016-predecessor:[a-f0-9]{64}$/),
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  captureLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  snapshotPlanSha256: sha256Schema,
  utcDay: utcDaySchema,
  usage: usageSchema,
  maximumReservation: maximumPredecessorReservationSchema,
  d1ExecutionMayHaveStarted: z.literal(true),
}).strict();

export const historicalFresh0016PredecessorPreparedPayloadSchema = z.custom<
  HistoricalFresh0016PredecessorPreparedCapture
>((value) => {
  try {
    parseHistoricalFresh0016PredecessorPreparedCapture(value);
    return true;
  } catch {
    return false;
  }
}, "Expected an exact fresh-0016 predecessor prepared capture.");

export const historicalFresh0016PredecessorCompletePayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_COMPLETE_KIND),
  schemaVersion: z.literal(1),
  preparedStageSha256: sha256Schema,
  reportCanonicalValueSha256: sha256Schema,
  reportFileSha256: sha256Schema,
}).strict();

export const historicalFresh0016ManifestPayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_MANIFEST_KIND),
  schemaVersion: z.literal(2),
  predecessorCompleteStageSha256: sha256Schema,
  predecessorReportSha256: sha256Schema,
  predecessorEvidenceChainSha256: sha256Schema,
  predecessorHmacKeyId: sha256Schema,
  successorSnapshotPlanSha256: z.literal(policy.successor.snapshotPlanSha256),
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  sourceFingerprint: sourceIdentitySchema,
  database: databaseSchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  migrationLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  productionExclusion: z.object({
    owner: productionExclusionOwnerSchema,
    ownerSha256: sha256Schema,
  }).strict(),
  preWriteEvidenceSha256: sha256Schema,
  migrationBudget: z.object({
    evidence: historicalFresh0016MigrationBudgetEvidenceSchema,
    evidenceSha256: sha256Schema,
    preparedArtifactFileSha256: sha256Schema,
  }).strict(),
  migrationSource: z.object({
    file: z.literal(policy.migration0016.trackedFile),
    bytes: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES),
    sha256: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256),
  }).strict(),
}).strict();

const applyAttemptSchema = z.object({
  attempt: z.union([z.literal(1), z.literal(2)]),
  startedAt: canonicalTimestampSchema,
  completedAt: canonicalTimestampSchema,
  responseConfirmed: z.boolean(),
  runnerOutcome: z.enum([
    "confirmed-success",
    "unconfirmed-response",
    "runner-failed",
  ]),
  readback: z.enum(["verified-committed", "verified-absent"]),
}).strict();
export const historicalFresh0016MigrationCompletePayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_APPLY_COMPLETE_KIND),
  schemaVersion: z.literal(1),
  bindingSha256: sha256Schema,
  migrationAuthorizedStageSha256: sha256Schema,
  verifierMigrationAuthorizationSha256: sha256Schema,
  runtimeVerificationReportSha256: sha256Schema,
  renderedMigrationSha256: sha256Schema,
  readbackResolutionSha256: sha256Schema.nullable(),
  status: z.enum([
    "verified",
    "verified-after-ambiguous-response",
    "verified-after-explicit-retry",
    "verified-after-unresolved-authorization",
  ]),
  attempts: z.array(applyAttemptSchema).max(2),
  d1ExecutionVerified: z.literal(true),
}).strict();

export const historicalFresh0016RuntimeStagePayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_RUNTIME_STAGE_KIND),
  schemaVersion: z.literal(1),
  migrationCompleteStageSha256: sha256Schema,
  reportCanonicalValueSha256: sha256Schema,
  reportCanonicalFileSha256: sha256Schema,
  report: historicalFresh0016RuntimeVerificationReportSchema,
}).strict();

export const historicalFresh0016SuccessorAuthorizationPayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_SUCCESSOR_AUTHORIZATION_KIND),
  schemaVersion: z.literal(2),
  runtimeVerificationStageSha256: sha256Schema,
  operationId: z.string().regex(/^historical-fresh-0016-successor:[a-f0-9]{64}$/),
  accountingParentOperationId: z.string().regex(
    /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
  ),
  authorizationContextSha256: sha256Schema,
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  captureLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  predecessorReportSha256: sha256Schema,
  runtimeVerificationReportSha256: sha256Schema,
  productionExclusionOwnerSha256: sha256Schema,
  utcDay: utcDaySchema,
  usage: usageSchema,
  maximumReservation: maximumSuccessorReservationSchema,
  d1ExecutionMayHaveStarted: z.literal(true),
}).strict();

export const historicalFresh0016SuccessorPreparedPayloadSchema = z.custom<
  HistoricalFresh0016SuccessorPreparedCapture
>((value) => {
  try {
    parseHistoricalFresh0016SuccessorPreparedCapture(value);
    return true;
  } catch {
    return false;
  }
}, "Expected an exact fresh-0016 successor prepared capture.");

export const historicalFresh0016SuccessorCompletePayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_SUCCESSOR_COMPLETE_KIND),
  schemaVersion: z.literal(1),
  preparedStageSha256: sha256Schema,
  reportCanonicalValueSha256: sha256Schema,
  reportFileSha256: sha256Schema,
}).strict();

export const historicalFresh0016CutoverCompletionIntentPayloadSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_CUTOVER_COMPLETION_INTENT_KIND),
  schemaVersion: z.literal(1),
  successorCompleteStageSha256: sha256Schema,
  completedAt: canonicalTimestampSchema,
  canonicalCompletePath: absolutePathSchema,
  canonicalArtifactSha256: sha256Schema,
}).strict();

const stageHashRecordSchema = z.object({
  claim: sha256Schema,
  "predecessor-authorized": sha256Schema,
  "predecessor-prepared": sha256Schema,
  "predecessor-complete": sha256Schema,
  manifest: sha256Schema,
  "migration-authorized": sha256Schema,
  "migration-complete": sha256Schema,
  "runtime-verification": sha256Schema,
  "successor-authorized": sha256Schema,
  "successor-prepared": sha256Schema,
  "successor-complete": sha256Schema,
}).strict();

export const historicalFresh0016CanonicalCutoverArtifactSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_KIND),
  schemaVersion: z.literal(2),
  createdAt: canonicalTimestampSchema,
  cutoverRunId: uuidSchema,
  paths: z.object({
    backupDirectory: absolutePathSchema,
    runDirectory: absolutePathSchema,
    canonicalCompletePath: absolutePathSchema,
  }).strict(),
  policy: z.object({
    id: z.literal(policy.policyId),
    sha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
    lostKeyStatus: z.literal(policy.legacyInterval.status),
    legacyIntervalContinuityProven: z.literal(false),
    retroactiveContinuityClaimed: z.literal(false),
  }).strict(),
  database: databaseSchema,
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  finalizationLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  state: z.object({
    verifiedStageCount: z.literal(12),
    boundStageHashCount: z.literal(11),
    stages: stageHashRecordSchema,
    successorCompleteStageSha256: sha256Schema,
    completionIntentMaterialSha256: sha256Schema,
  }).strict(),
  evidence: z.object({
    predecessorPrerequisitesSha256: sha256Schema,
    predecessorPrerequisites:
      historicalFresh0016PredecessorPrerequisitesSchema,
    predecessorReportFileSha256: sha256Schema,
    migrationBudgetPreparedArtifactFileSha256: sha256Schema,
    manifestPayloadSha256: sha256Schema,
    bindingSha256: sha256Schema,
    renderedMigrationSha256: sha256Schema,
    migrationAuthorizationStageSha256: sha256Schema,
    migrationCompleteStageSha256: sha256Schema,
    runtimeVerificationCanonicalValueSha256: sha256Schema,
    runtimeVerificationCanonicalFileSha256: sha256Schema,
    successorReportFileSha256: sha256Schema,
    productionExclusionOwnerSha256: sha256Schema,
    preWriteEvidenceSha256: sha256Schema,
  }).strict(),
  migration: z.object({
    status: z.enum([
      "verified",
      "verified-after-ambiguous-response",
      "verified-after-explicit-retry",
      "verified-after-unresolved-authorization",
    ]),
    attempts: nonnegativeIntegerSchema.refine((value) => value <= 2),
    readbackResolutionUsed: z.boolean(),
    runtimeRowsRead: nonnegativeIntegerSchema,
    runtimeRowsWritten: z.literal(0),
  }).strict(),
  continuity: z.object({
    ok: z.literal(true),
    protectedDatasetCount: z.literal(HISTORICAL_PROTECTED_DATASET_COUNT),
    decisionsSha256: sha256Schema,
    predecessorToSuccessorGapMs: positiveIntegerSchema,
    outboxSchemaPresent: z.literal(true),
    outboxRowsBeforeActivation: z.literal(0),
  }).strict(),
  timing: z.object({
    releaseTimingMode: releaseTimingModeSchema.optional(),
    predecessorUtcDay: utcDaySchema,
    successorUtcDay: utcDaySchema,
    predecessorCreatedAt: canonicalTimestampSchema,
    runtimeVerifiedAt: canonicalTimestampSchema,
    successorCreatedAt: canonicalTimestampSchema,
    productionExclusionLeaseExpiresAt: positiveIntegerSchema,
  }).strict(),
  budget: z.object({
    predecessorOperationId: z.string().regex(/^historical-fresh-0016-predecessor:[a-f0-9]{64}$/),
    predecessorMaximumRowsRead: z.literal(HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION),
    predecessorExactRowsRead: positiveIntegerSchema,
    runtimeMigrationReportSha256: sha256Schema,
    runtimeMigrationProjectedRowsRead: nonnegativeIntegerSchema,
    runtimeMigrationProjectedRowsWritten: nonnegativeIntegerSchema,
    applyEnvelopeRowsRead: z.literal(
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.projectedRowsRead,
    ),
    applyMaximumWriteCapableCalls: z.literal(
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.writeCapableCalls,
    ),
    successorOperationId: z.string().regex(/^historical-fresh-0016-successor:[a-f0-9]{64}$/),
    successorMaximumRowsRead: z.literal(HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT),
    successorExactRowsRead: positiveIntegerSchema,
  }).strict(),
  privacy: z.literal("hashes-counts-and-hmac-identities-only"),
}).strict();

export type HistoricalFresh0016CanonicalCutoverArtifact = z.infer<
  typeof historicalFresh0016CanonicalCutoverArtifactSchema
>;
export type HistoricalFresh0016CutoverCompletionIntent = z.infer<
  typeof historicalFresh0016CutoverCompletionIntentPayloadSchema
>;
export type HistoricalFresh0016CutoverArtifactHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  publication: "created" | "exact-replay";
  artifact: HistoricalFresh0016CanonicalCutoverArtifact;
}>;

export type HistoricalFresh0016ValidatedCutoverArtifactHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  validation: "existing-full-chain";
  artifact: HistoricalFresh0016CanonicalCutoverArtifact;
}>;

export type HistoricalFresh0016CutoverChainErrorCode =
  | "CHAIN_INCOMPLETE"
  | "CHAIN_INVALID"
  | "ARTIFACT_INVALID"
  | "SOURCE_DRIFT"
  | "PUBLICATION_CONFLICT"
  | "PATH_UNSAFE";

export class HistoricalFresh0016CutoverChainError extends Error {
  readonly code: HistoricalFresh0016CutoverChainErrorCode;

  constructor(code: HistoricalFresh0016CutoverChainErrorCode, message: string) {
    super(message);
    this.name = "HistoricalFresh0016CutoverChainError";
    this.code = code;
  }
}

export function historicalFresh0016CanonicalCompletePath(backupDirectory: string) {
  const backup = path.resolve(backupDirectory);
  const relative = HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_RELATIVE_PATH;
  if (
    path.isAbsolute(relative) ||
    relative.split("/").some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"),
    )
  ) {
    throw chainError("PATH_UNSAFE", "The canonical cutover path is unsafe.");
  }
  const result = path.resolve(backup, ...relative.split("/"));
  assertContainedPath(backup, result, "canonical cutover artifact");
  return result;
}

export function buildHistoricalFresh0016CutoverCompletionIntent(input: {
  cwd: string;
  backupDirectory: string;
  cutoverRunId: string;
  completedAt: Date;
  forbiddenPlaintext?: readonly string[];
}): Readonly<{
  artifact: HistoricalFresh0016CanonicalCutoverArtifact;
  artifactSha256: string;
  payload: Omit<HistoricalFresh0016CutoverCompletionIntent, "canonicalArtifactSha256">;
}> {
  const completedAt = canonicalDate(input.completedAt, "completion time");
  const verified = verifyFirstElevenStages(input);
  if (completedAt.getTime() < Date.parse(verified.successor.report.createdAt)) {
    throw chainError("CHAIN_INVALID", "Cutover completion predates successor proof.");
  }
  if (completedAt.getTime() >= verified.productionExclusionLeaseExpiresAt) {
    throw chainError("CHAIN_INVALID", "Production exclusion expired before cutover completion.");
  }
  const canonicalCompletePath = historicalFresh0016CanonicalCompletePath(
    verified.paths.backupDirectory,
  );
  const artifact = buildCanonicalArtifact({
    verified,
    createdAt: completedAt.toISOString(),
    canonicalCompletePath,
  });
  const artifactSha256 = canonicalFileSha256(artifact);
  return deepFreeze({
    artifact,
    artifactSha256,
    payload: {
      kind: HISTORICAL_FRESH_0016_CUTOVER_COMPLETION_INTENT_KIND,
      schemaVersion: 1,
      successorCompleteStageSha256: verified.stageByName["successor-complete"].sha256,
      completedAt: completedAt.toISOString(),
      canonicalCompletePath,
    },
  });
}

export function verifyAndPublishHistoricalFresh0016CutoverComplete(input: {
  cwd: string;
  backupDirectory: string;
  cutoverRunId: string;
  forbiddenPlaintext?: readonly string[];
}): HistoricalFresh0016CutoverArtifactHandle {
  const candidate = validateHistoricalFresh0016CutoverCompletion(input);
  return publishOrReadExactCanonicalArtifact(
    candidate.payload.canonicalCompletePath,
    candidate.artifact,
  );
}

export function readAndValidateHistoricalFresh0016CutoverComplete(input: {
  cwd: string;
  backupDirectory: string;
  forbiddenPlaintext?: readonly string[];
}): HistoricalFresh0016ValidatedCutoverArtifactHandle {
  const file = historicalFresh0016CanonicalCompletePath(input.backupDirectory);
  const before = readCanonicalArtifact(file);
  const candidate = validateHistoricalFresh0016CutoverCompletion({
    ...input,
    cutoverRunId: before.artifact.cutoverRunId,
  });
  const expectedBytes = canonicalFileBytes(candidate.artifact);
  if (!before.bytes.equals(expectedBytes)) {
    throw chainError(
      "ARTIFACT_INVALID",
      "The existing canonical cutover artifact does not match its complete source-bound chain.",
    );
  }
  const after = readCanonicalArtifact(file);
  if (!after.bytes.equals(before.bytes)) {
    throw chainError(
      "PATH_UNSAFE",
      "The canonical cutover artifact changed during full-chain validation.",
    );
  }
  return deepFreeze({
    path: file,
    bytes: after.bytes.byteLength,
    sha256: sha256(after.bytes),
    validation: "existing-full-chain" as const,
    artifact: after.artifact,
  });
}

function validateHistoricalFresh0016CutoverCompletion(input: {
  cwd: string;
  backupDirectory: string;
  cutoverRunId: string;
  forbiddenPlaintext?: readonly string[];
}) {
  const classification = classifyCutoverState({
    backupDirectory: input.backupDirectory,
    runId: input.cutoverRunId,
  });
  if (
    classification.status !== "complete" ||
    classification.issues.length !== 0 ||
    classification.stages.length !== HISTORICAL_FRESH_0016_STATE_STAGES.length ||
    classification.currentStage !== "cutover-complete"
  ) {
    throw chainError("CHAIN_INCOMPLETE", "The exact append-only 12-stage cutover chain is not complete.");
  }
  const cutoverStage = requiredStage(classification, "cutover-complete");
  const intent = parseStagePayload(
    cutoverStage,
    historicalFresh0016CutoverCompletionIntentPayloadSchema,
    "cutover-complete intent",
  );
  const candidate = buildHistoricalFresh0016CutoverCompletionIntent({
    ...input,
    completedAt: new Date(intent.completedAt),
  });
  if (
    intent.successorCompleteStageSha256 !==
      candidate.payload.successorCompleteStageSha256 ||
    intent.canonicalCompletePath !== candidate.payload.canonicalCompletePath ||
    intent.canonicalArtifactSha256 !== candidate.artifactSha256
  ) {
    throw chainError("CHAIN_INVALID", "The completion intent does not bind the exact canonical artifact.");
  }
  const sourceAfter = compactSource(buildRepoSourceFingerprint(path.resolve(input.cwd)));
  if (!sameSource(sourceAfter, candidate.artifact.sourceFingerprint)) {
    throw chainError("SOURCE_DRIFT", "The release source changed during final chain verification.");
  }
  return candidate;
}

type VerifiedFirstEleven = ReturnType<typeof verifyFirstElevenStages>;

function verifyFirstElevenStages(input: {
  cwd: string;
  backupDirectory: string;
  cutoverRunId: string;
  forbiddenPlaintext?: readonly string[];
}) {
  const cwd = path.resolve(input.cwd);
  const sourceBeforeFull = buildRepoSourceFingerprint(cwd);
  const sourceBefore = compactSource(sourceBeforeFull);
  const classification = classifyCutoverState({
    backupDirectory: input.backupDirectory,
    runId: input.cutoverRunId,
  });
  const allowedStatus = classification.status === "in-progress" || classification.status === "complete";
  if (
    !allowedStatus ||
    classification.issues.length !== 0 ||
    classification.stages.length < 11
  ) {
    throw chainError("CHAIN_INCOMPLETE", "The first eleven exact cutover stages are not complete.");
  }
  const requiredAuxiliaryNames = Object.values(
    HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  );
  if (
    classification.auxiliaryFiles.length !== requiredAuxiliaryNames.length ||
    !requiredAuxiliaryNames.every((name) =>
      classification.auxiliaryFiles.some((entry) => entry.name === name),
    )
  ) {
    throw chainError(
      "CHAIN_INCOMPLETE",
      "The exact predecessor, rendered migration, and successor auxiliary artifacts are required.",
    );
  }
  const firstElevenNames = FIRST_ELEVEN_STAGES;
  const stageByName = stageMap(classification, firstElevenNames);
  if (!firstElevenNames.every((stage, index) => classification.stages[index]?.value.stage === stage)) {
    throw chainError("CHAIN_INVALID", "The cutover stage order is not exact.");
  }
  if (classification.readbackResolutions.some((entry) => entry.value.stage !== "migration-authorized")) {
    throw chainError("CHAIN_INVALID", "Predecessor and successor authorization recovery is review-required in v1.");
  }

  const claim = parseStagePayload(stageByName.claim, historicalFresh0016ClaimPayloadSchema, "claim");
  if (!sameSource(claim.sourceFingerprint, sourceBefore)) {
    throw chainError(
      "SOURCE_DRIFT",
      "The claim source no longer matches the repository.",
    );
  }
  if (
    !sameSource(
      claim.predecessorPrerequisites.sourceFingerprint,
      claim.sourceFingerprint,
    ) ||
    canonicalHistoricalFresh0016Json(
      claim.predecessorPrerequisites.workerRelease,
    ) !== canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    canonicalHistoricalFresh0016Json(
      claim.claimLiveTopology.workerRelease,
    ) !== canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    claim.predecessorPrerequisites.predecessorUtcDay !==
      stageByName.claim.value.createdAt.slice(0, 10)
  ) {
    throw chainError(
      "CHAIN_INVALID",
      "The earlier-day topic/translation/0017 prerequisites and live runtime gate no longer match the claim source, Worker, or predecessor day.",
    );
  }
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: claim.claimLiveTopology,
    boundaryAt: new Date(stageByName.claim.value.createdAt),
    ...claim.workerRelease,
  });

  const predecessorAuthorized = parseStagePayload(
    stageByName["predecessor-authorized"],
    historicalFresh0016PredecessorAuthorizationPayloadSchema,
    "predecessor authorization",
  );
  const predecessorPrepared = parseStagePayload(
    stageByName["predecessor-prepared"],
    historicalFresh0016PredecessorPreparedPayloadSchema,
    "predecessor prepared",
  );
  const predecessorComplete = parseStagePayload(
    stageByName["predecessor-complete"],
    historicalFresh0016PredecessorCompletePayloadSchema,
    "predecessor complete",
  );
  const predecessorCapture = parsePredecessorCapture(
    predecessorPrepared.capture,
    claim.sourceFingerprint,
  );
  let predecessor: ReturnType<typeof readHistoricalFresh0016PredecessorReport>;
  try {
    predecessor = readHistoricalFresh0016PredecessorReport({
      backupDirectory: input.backupDirectory,
      cutoverRunId: input.cutoverRunId,
      forbiddenPlaintext: input.forbiddenPlaintext,
    });
  } catch {
    throw chainError(
      "ARTIFACT_INVALID",
      "The predecessor auxiliary artifact is missing, invalid, noncanonical, or privacy-unsafe.",
    );
  }
  const predecessorCanonicalValueSha256 = historicalFresh0016JsonSha256(predecessor.report);
  assertEqual(
    historicalFresh0016PredecessorPreparedCaptureSha256(predecessorPrepared),
    stageByName["predecessor-prepared"].value.payloadSha256,
    "Predecessor prepared producer hash drifted from state publication.",
  );
  assertEqual(
    predecessorPrepared.authorization.authorizationStageSha256,
    stageByName["predecessor-authorized"].sha256,
    "Predecessor prepared stage lost its authorization.",
  );
  assertEqual(predecessorPrepared.captureSha256, historicalFresh0016JsonSha256(predecessorCapture), "Predecessor prepared capture hash drifted.");
  assertEqual(predecessorComplete.preparedStageSha256, stageByName["predecessor-prepared"].sha256, "Predecessor completion lost its prepared stage.");
  assertEqual(predecessorComplete.reportCanonicalValueSha256, predecessorCanonicalValueSha256, "Predecessor completion canonical hash drifted.");
  assertEqual(predecessorComplete.reportFileSha256, predecessor.sha256, "Predecessor completion file hash drifted.");
  assertCaptureMatchesPredecessorReport(predecessorCapture, predecessor.report);
  validatePredecessorStageBindings({
    claim,
    authorized: predecessorAuthorized,
    prepared: predecessorPrepared,
    report: predecessor.report,
    claimStageSha256: stageByName.claim.sha256,
  });

  const manifestStage = stageByName.manifest;
  const manifest = parseStagePayload(
    manifestStage,
    historicalFresh0016ManifestPayloadSchema,
    "manifest",
  );
  validateManifest({
    manifest,
    manifestStage,
    predecessorCompleteStage: stageByName["predecessor-complete"],
    predecessorEvidenceStageHashes: {
      claim: stageByName.claim.sha256,
      predecessorAuthorized: stageByName["predecessor-authorized"].sha256,
      predecessorPrepared: stageByName["predecessor-prepared"].sha256,
      predecessorComplete: stageByName["predecessor-complete"].sha256,
    },
    predecessorReportSha256: predecessor.sha256,
    predecessor: predecessor.report,
    claim,
    cwd,
    backupDirectory: path.resolve(input.backupDirectory),
    currentSourceFull: sourceBeforeFull,
  });
  const binding = parseSchema(historicalFresh0016MigrationBindingSchema, {
    cutoverRunId: input.cutoverRunId,
    cutoverManifestSha256: manifestStage.value.payloadSha256,
    migrationBudgetPreparedArtifactFileSha256:
      manifest.migrationBudget.preparedArtifactFileSha256,
    predecessorReportSha256: predecessor.sha256,
    predecessorCompleteSha256: stageByName["predecessor-complete"].sha256,
    predecessorEvidenceChainSha256: manifest.predecessorEvidenceChainSha256,
    predecessorHmacKeyId: predecessor.report.hmacKeyId,
    successorSnapshotPlanSha256: policy.successor.snapshotPlanSha256,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint: sourceBefore,
    database: policy.database,
  }, "migration binding");
  let rendered: ReturnType<typeof readHistoricalFresh0016RenderedMigration>;
  try {
    rendered = readHistoricalFresh0016RenderedMigration({
      cwd,
      backupDir: input.backupDirectory,
      runDirectory: historicalFresh0016StatePaths(
        input.backupDirectory,
        input.cutoverRunId,
      ).runDirectory,
      binding,
    });
  } catch {
    throw chainError(
      "ARTIFACT_INVALID",
      "The rendered migration auxiliary artifact is missing, invalid, noncanonical, or source-drifted.",
    );
  }
  const renderedEvidence = parseSchema(
    historicalFresh0016RenderedMigrationEvidenceSchema,
    rendered.evidence,
    "rendered migration evidence",
  );

  const migrationAuthorized = parseStagePayload(
    stageByName["migration-authorized"],
    historicalFresh0016ApplyAuthorizationPayloadSchema,
    "migration authorization",
  );
  const migrationComplete = parseStagePayload(
    stageByName["migration-complete"],
    historicalFresh0016MigrationCompletePayloadSchema,
    "migration completion",
  );
  const runtimeStage = parseStagePayload(
    stageByName["runtime-verification"],
    historicalFresh0016RuntimeStagePayloadSchema,
    "runtime verification",
  );
  validateMigrationStages({
    binding,
    renderedEvidence,
    manifest,
    manifestStage,
    predecessorCompleteStage: stageByName["predecessor-complete"],
    migrationAuthorized,
    migrationAuthorizedStage: stageByName["migration-authorized"],
    migrationComplete,
    migrationCompleteStage: stageByName["migration-complete"],
    runtimeStage,
  });
  validateApplyResolution(classification, migrationAuthorized, migrationComplete);

  const successorAuthorized = parseStagePayload(
    stageByName["successor-authorized"],
    historicalFresh0016SuccessorAuthorizationPayloadSchema,
    "successor authorization",
  );
  const successorPrepared = parseStagePayload(
    stageByName["successor-prepared"],
    historicalFresh0016SuccessorPreparedPayloadSchema,
    "successor prepared",
  );
  assertEqual(
    historicalFresh0016SuccessorPreparedCaptureSha256(successorPrepared),
    stageByName["successor-prepared"].value.payloadSha256,
    "Successor prepared producer hash drifted from state publication.",
  );
  const successorComplete = parseStagePayload(
    stageByName["successor-complete"],
    historicalFresh0016SuccessorCompletePayloadSchema,
    "successor complete",
  );
  const successorCapture = parseSchema(
    successorCaptureSchema,
    successorPrepared.capture,
    "successor prepared capture",
  );
  let successor: ReturnType<typeof readHistoricalFresh0016SuccessorReport>;
  try {
    successor = readHistoricalFresh0016SuccessorReport({
      backupDirectory: input.backupDirectory,
      cutoverRunId: input.cutoverRunId,
      forbiddenPlaintext: input.forbiddenPlaintext,
    });
  } catch {
    throw chainError(
      "ARTIFACT_INVALID",
      "The successor auxiliary artifact is missing, invalid, noncanonical, or privacy-unsafe.",
    );
  }
  const successorCanonicalValueSha256 = historicalFresh0016JsonSha256(successor.report);
  assertEqual(successorPrepared.authorization.authorizationStageSha256, stageByName["successor-authorized"].sha256, "Successor prepared lost its authorization.");
  assertEqual(successorPrepared.captureSha256, historicalFresh0016JsonSha256(successorCapture), "Successor prepared capture hash drifted.");
  assertEqual(successorComplete.preparedStageSha256, stageByName["successor-prepared"].sha256, "Successor completion lost its prepared stage.");
  assertEqual(successorComplete.reportCanonicalValueSha256, successorCanonicalValueSha256, "Successor completion canonical hash drifted.");
  assertEqual(successorComplete.reportFileSha256, successor.sha256, "Successor completion file hash drifted.");
  assertCaptureMatchesSuccessorReport(successorCapture, successor.report);
  validateSuccessorStageBindings({
    authorized: successorAuthorized,
    prepared: successorPrepared,
    report: successor.report,
    authorizationStage: stageByName["successor-authorized"],
    runtimeStage: stageByName["runtime-verification"],
    runtimeReport: runtimeStage.report,
    predecessorReportSha256: predecessor.sha256,
    manifest,
    claim,
  });

  const continuity = evaluateHistoricalFresh0016Continuity({
    predecessor: predecessor.report,
    successor: successor.report,
  });
  if (
    !continuity.ok ||
    continuity.problems.length !== 0 ||
    !continuity.sameSource ||
    !continuity.sameHmacKey ||
    !continuity.predecessorPlanMatchesSource ||
    !continuity.gapWithinPolicy ||
    !continuity.operationalOutbox.schemaPresent ||
    !continuity.operationalOutbox.emptyBeforeActivation ||
    continuity.operationalOutbox.successorRows !== 0
  ) {
    throw chainError("CHAIN_INVALID", "Protected dataset continuity failed across fresh 0016.");
  }
  validateTimingAndBudgets({
    claim,
    predecessorAuthorized,
    predecessor: predecessor.report,
    runtime: runtimeStage.report,
    successorAuthorized,
    successor: successor.report,
    manifest,
  });

  const sourceAfter = compactSource(buildRepoSourceFingerprint(cwd));
  if (!sameSource(sourceBefore, sourceAfter)) {
    throw chainError("SOURCE_DRIFT", "The repository changed during cutover verification.");
  }
  return deepFreeze({
    paths: historicalFresh0016StatePaths(input.backupDirectory, input.cutoverRunId),
    stageByName,
    claim,
    predecessor,
    manifest,
    binding,
    rendered,
    migrationAuthorized,
    migrationComplete,
    runtimeStage,
    successorAuthorized,
    successor,
    continuity,
    productionExclusionLeaseExpiresAt: manifest.productionExclusion.owner.leaseExpiresAt,
  });
}

const FIRST_ELEVEN_STAGES = [
  "claim",
  "predecessor-authorized",
  "predecessor-prepared",
  "predecessor-complete",
  "manifest",
  "migration-authorized",
  "migration-complete",
  "runtime-verification",
  "successor-authorized",
  "successor-prepared",
  "successor-complete",
] as const satisfies readonly HistoricalFresh0016StateStage[];
type FirstElevenStage = (typeof FIRST_ELEVEN_STAGES)[number];
type StageHandle = HistoricalFresh0016StateFileHandle<
  HistoricalFresh0016StateStageEnvelope
>;
type ClaimPayload = z.infer<typeof historicalFresh0016ClaimPayloadSchema>;
function claimReleaseTimingMode(claim: ClaimPayload) {
  return claim.releaseTimingMode ??
    HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE;
}

type PredecessorAuthorizationPayload = z.infer<
  typeof historicalFresh0016PredecessorAuthorizationPayloadSchema
>;
type PredecessorPreparedPayload = z.infer<
  typeof historicalFresh0016PredecessorPreparedPayloadSchema
>;
type ManifestPayload = z.infer<typeof historicalFresh0016ManifestPayloadSchema>;
type MigrationCompletePayload = z.infer<
  typeof historicalFresh0016MigrationCompletePayloadSchema
>;
type RuntimeStagePayload = z.infer<
  typeof historicalFresh0016RuntimeStagePayloadSchema
>;
type SuccessorAuthorizationPayload = z.infer<
  typeof historicalFresh0016SuccessorAuthorizationPayloadSchema
>;
type SuccessorPreparedPayload = z.infer<
  typeof historicalFresh0016SuccessorPreparedPayloadSchema
>;

function stageMap(
  classification: HistoricalFresh0016StateClassification,
  expected: readonly FirstElevenStage[],
) {
  const result: Partial<Record<FirstElevenStage, StageHandle>> = {};
  for (const stage of expected) {
    const handle = classification.stages.find(
      (candidate) => candidate.value.stage === stage,
    );
    if (!handle) {
      throw chainError("CHAIN_INCOMPLETE", `Required cutover stage ${stage} is missing.`);
    }
    result[stage] = handle;
  }
  return requireFirstElevenStageMap(result);
}

function requireFirstElevenStageMap(
  value: Partial<Record<FirstElevenStage, StageHandle>>,
): Record<FirstElevenStage, StageHandle> {
  for (const stage of FIRST_ELEVEN_STAGES) {
    if (!value[stage]) {
      throw chainError("CHAIN_INCOMPLETE", `Required cutover stage ${stage} is missing.`);
    }
  }
  return {
    claim: requiredMappedStage(value, "claim"),
    "predecessor-authorized": requiredMappedStage(value, "predecessor-authorized"),
    "predecessor-prepared": requiredMappedStage(value, "predecessor-prepared"),
    "predecessor-complete": requiredMappedStage(value, "predecessor-complete"),
    manifest: requiredMappedStage(value, "manifest"),
    "migration-authorized": requiredMappedStage(value, "migration-authorized"),
    "migration-complete": requiredMappedStage(value, "migration-complete"),
    "runtime-verification": requiredMappedStage(value, "runtime-verification"),
    "successor-authorized": requiredMappedStage(value, "successor-authorized"),
    "successor-prepared": requiredMappedStage(value, "successor-prepared"),
    "successor-complete": requiredMappedStage(value, "successor-complete"),
  };
}

function requiredMappedStage(
  value: Partial<Record<FirstElevenStage, StageHandle>>,
  stage: FirstElevenStage,
) {
  const result = value[stage];
  if (!result) {
    throw chainError("CHAIN_INCOMPLETE", `Required cutover stage ${stage} is missing.`);
  }
  return result;
}

function requiredStage(
  classification: HistoricalFresh0016StateClassification,
  stage: HistoricalFresh0016StateStage,
) {
  const result = classification.stages.find(
    (candidate) => candidate.value.stage === stage,
  );
  if (!result) {
    throw chainError("CHAIN_INCOMPLETE", `Required cutover stage ${stage} is missing.`);
  }
  return result;
}

function parseStagePayload<T>(
  stage: StageHandle,
  schema: z.ZodType<T>,
  label: string,
) {
  const parsed = parseSchema(schema, stage.value.payload, label);
  if (historicalFresh0016JsonSha256(parsed) !== stage.value.payloadSha256) {
    throw chainError("CHAIN_INVALID", `The ${label} payload hash is inconsistent.`);
  }
  return parsed;
}

function parsePredecessorCapture(value: unknown, source: { sha256: string; fileCount: number }) {
  const capture = parseSchema(
    predecessorCaptureSchema,
    value,
    "predecessor prepared capture",
  );
  const expectedPlan = createHistoricalPre0016SnapshotPlan(source);
  if (canonicalHistoricalFresh0016Json(capture.plan) !== canonicalHistoricalFresh0016Json(expectedPlan)) {
    throw chainError("CHAIN_INVALID", "Predecessor prepared capture has the wrong source-bound plan.");
  }
  return capture;
}

function assertCaptureMatchesPredecessorReport(
  capture: z.infer<typeof predecessorCaptureSchema>,
  report: ReturnType<typeof parseHistoricalFresh0016PredecessorReport>,
) {
  const plan = requireRecord(capture.plan, "predecessor capture plan");
  if (
    plan.kind !== HISTORICAL_PRE_0016_SNAPSHOT_KIND ||
    canonicalHistoricalFresh0016Json(plan.protectedDatasets) !==
      canonicalHistoricalFresh0016Json(HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES) ||
    canonicalHistoricalFresh0016Json(plan.excludedOperationalDatasets) !==
      canonicalHistoricalFresh0016Json(HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES) ||
    plan.planSha256 !== report.snapshotPlanSha256 ||
    capture.rowsRead !== report.rowsRead ||
    capture.rowsWritten !== report.rowsWritten ||
    capture.hmacKeyId !== report.hmacKeyId ||
    canonicalHistoricalFresh0016Json(capture.datasets) !==
      canonicalHistoricalFresh0016Json(report.datasets) ||
    canonicalHistoricalFresh0016Json(capture.supplementalDatasets) !==
      canonicalHistoricalFresh0016Json(report.supplementalDatasets)
  ) {
    throw chainError("CHAIN_INVALID", "Predecessor prepared capture does not exactly match its final report.");
  }
}

function assertCaptureMatchesSuccessorReport(
  capture: z.infer<typeof successorCaptureSchema>,
  report: ReturnType<typeof parseHistoricalFresh0016SuccessorReport>,
) {
  if (
    capture.snapshotPlanSha256 !== report.snapshotPlanSha256 ||
    capture.resultSetCount !== report.snapshotExecution.resultSetCount ||
    capture.automaticAttemptsPerResultSet !==
      report.snapshotExecution.automaticAttemptsPerResultSet ||
    capture.rowsRead !== report.rowsRead ||
    capture.rowsWritten !== report.rowsWritten ||
    capture.hmacKeyId !== report.hmacKeyId ||
    canonicalHistoricalFresh0016Json(capture.datasets) !==
      canonicalHistoricalFresh0016Json(report.datasets) ||
    canonicalHistoricalFresh0016Json(capture.supplementalDatasets) !==
      canonicalHistoricalFresh0016Json(report.supplementalDatasets) ||
    canonicalHistoricalFresh0016Json(capture.operationalDatasets) !==
      canonicalHistoricalFresh0016Json(report.operationalDatasets)
  ) {
    throw chainError("CHAIN_INVALID", "Successor prepared capture does not exactly match its final report.");
  }
}

function validatePredecessorStageBindings(input: {
  claim: ClaimPayload;
  authorized: PredecessorAuthorizationPayload;
  prepared: PredecessorPreparedPayload;
  report: ReturnType<typeof parseHistoricalFresh0016PredecessorReport>;
  claimStageSha256: string;
}) {
  const { claim, authorized, prepared, report } = input;
  const preparedAuthorization = {
    phase: "predecessor" as const,
    d1ExecutionMayStart: true as const,
    cutoverRunId: report.cutoverRunId,
    operationId: authorized.operationId,
    sourceFingerprint: authorized.sourceFingerprint,
    workerRelease: authorized.workerRelease,
    captureLiveTopology: authorized.captureLiveTopology,
    hmacKeyId: authorized.hmacKeyId,
    snapshotPlanSha256: authorized.snapshotPlanSha256,
    utcDay: authorized.utcDay,
    maximumReservationRevision: authorized.maximumReservation.revision,
    maximumRowsRead:
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    maximumRowsWritten: 0 as const,
    authorizationStageSha256:
      prepared.authorization.authorizationStageSha256,
  };
  if (
    authorized.claimStageSha256 !== input.claimStageSha256 ||
    authorized.operationId !== report.operationId ||
    !sameSource(authorized.sourceFingerprint, claim.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(authorized.workerRelease) !==
      canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    canonicalHistoricalFresh0016Json(authorized.captureLiveTopology) !==
      canonicalHistoricalFresh0016Json(prepared.captureLiveTopology) ||
    authorized.hmacKeyId !== claim.hmacKeyId ||
    authorized.snapshotPlanSha256 !== report.snapshotPlanSha256 ||
    authorized.utcDay !== report.utcDay ||
    !sameSource(report.sourceFingerprint, claim.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(report.workerRelease) !==
      canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    report.hmacKeyId !== claim.hmacKeyId ||
    canonicalHistoricalFresh0016Json(authorized.usage) !==
      canonicalHistoricalFresh0016Json(report.usage) ||
    canonicalHistoricalFresh0016Json(prepared.authorization) !==
      canonicalHistoricalFresh0016Json(preparedAuthorization) ||
    prepared.cutoverRunId !== report.cutoverRunId ||
    prepared.paths.backupDirectory !== report.paths.backupDirectory ||
    prepared.paths.runDirectory !== report.paths.runDirectory ||
    prepared.paths.reportPath !== report.paths.reportPath ||
    prepared.operationId !== report.operationId ||
    !sameSource(prepared.sourceFingerprint, report.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(prepared.workerRelease) !==
      canonicalHistoricalFresh0016Json(report.workerRelease) ||
    canonicalHistoricalFresh0016Json(prepared.captureLiveTopology) !==
      canonicalHistoricalFresh0016Json(report.captureLiveTopology) ||
    prepared.hmacKeyId !== report.hmacKeyId ||
    prepared.snapshotPlanSha256 !== report.snapshotPlanSha256 ||
    prepared.utcDay !== report.utcDay ||
    canonicalHistoricalFresh0016Json(prepared.usage) !==
      canonicalHistoricalFresh0016Json(report.usage) ||
    canonicalHistoricalFresh0016Json(prepared.maximumReservation) !==
      canonicalHistoricalFresh0016Json(authorized.maximumReservation) ||
    prepared.rowsRead !== report.rowsRead ||
    prepared.rowsWritten !== report.rowsWritten ||
    prepared.captureStartedAt !== report.captureStartedAt ||
    prepared.captureCompletedAt !== report.captureCompletedAt ||
    prepared.plannedExactReservedAt !== report.ledger.reservation.updatedAt ||
    prepared.plannedReportCreatedAt !== report.createdAt
  ) {
    throw chainError("CHAIN_INVALID", "Predecessor stages, report, source, HMAC, or Worker binding drifted.");
  }
  validateMaximumToExactReservation({
    label: "predecessor",
    maximum: authorized.maximumReservation,
    exact: report.ledger,
    operationId: report.operationId,
    targetCandidateVersionId: report.workerRelease.targetCandidateVersionId,
    maximumRowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    exactRowsRead: report.rowsRead,
    maximumRowsWritten: 0,
    exactRowsWritten: 0,
    usage: report.usage,
    accountedByAggregate: false,
  });
}

function validateManifest(input: {
  manifest: ManifestPayload;
  manifestStage: StageHandle;
  predecessorCompleteStage: StageHandle;
  predecessorEvidenceStageHashes: Readonly<{
    claim: string;
    predecessorAuthorized: string;
    predecessorPrepared: string;
    predecessorComplete: string;
  }>;
  predecessorReportSha256: string;
  predecessor: ReturnType<typeof parseHistoricalFresh0016PredecessorReport>;
  claim: ClaimPayload;
  cwd: string;
  backupDirectory: string;
  currentSourceFull: ReturnType<typeof buildRepoSourceFingerprint>;
}) {
  const { manifest, predecessor, claim } = input;
  const expectedEvidenceChainSha256 = historicalFresh0016JsonSha256(
    input.predecessorEvidenceStageHashes,
  );
  const owner = parseProductionValidationLockOwner(
    manifest.productionExclusion.owner,
  );
  const ownerSha256 = sha256(canonicalProductionValidationLockOwner(owner));
  if (
    manifest.predecessorCompleteStageSha256 !== input.predecessorCompleteStage.sha256 ||
    manifest.predecessorReportSha256 !== input.predecessorReportSha256 ||
    manifest.predecessorEvidenceChainSha256 !== expectedEvidenceChainSha256 ||
    manifest.predecessorHmacKeyId !== predecessor.hmacKeyId ||
    manifest.predecessorHmacKeyId !== claim.hmacKeyId ||
    !sameSource(manifest.sourceFingerprint, claim.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(manifest.workerRelease) !==
      canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    canonicalHistoricalFresh0016Json(
      manifest.migrationLiveTopology.workerRelease,
    ) !== canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    owner.candidateVersionId !==
      claim.workerRelease.targetCandidateVersionId ||
    owner.sourceFingerprintSha256 !== claim.sourceFingerprint.sha256 ||
    manifest.productionExclusion.ownerSha256 !== ownerSha256 ||
    owner.leaseExpiresAt <= Date.parse(input.manifestStage.value.createdAt) ||
    canonicalHistoricalFresh0016Json(manifest.database) !==
      canonicalHistoricalFresh0016Json(claim.database)
  ) {
    throw chainError("CHAIN_INVALID", "Manifest lost its predecessor, source, HMAC, Worker, database, or exclusion binding.");
  }
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: manifest.migrationLiveTopology,
    boundaryAt: new Date(input.manifestStage.value.createdAt),
    ...manifest.workerRelease,
  });
  if (
    Date.parse(manifest.migrationLiveTopology.observedAt) <=
    Date.parse(predecessor.finalizationLiveTopology.observedAt)
  ) {
    throw chainError(
      "CHAIN_INVALID",
      "Manifest requires a new candidate-absent topology after predecessor finalization.",
    );
  }
  const budgetHash = historicalFresh0016JsonSha256(
    manifest.migrationBudget.evidence,
  );
  if (
    manifest.preWriteEvidenceSha256 !== budgetHash ||
    manifest.migrationBudget.evidenceSha256 !== budgetHash
  ) {
    throw chainError("CHAIN_INVALID", "Manifest pre-write budget evidence hash drifted.");
  }
  let preparedBudget: ReturnType<
    typeof readHistoricalFresh0016MigrationBudgetPrepared
  >;
  try {
    preparedBudget = readHistoricalFresh0016MigrationBudgetPrepared({
      backupDirectory: input.backupDirectory,
      runId: predecessor.cutoverRunId,
    });
  } catch {
    throw chainError(
      "ARTIFACT_INVALID",
      "The immutable prepared migration-budget artifact is missing, unsafe, noncanonical, or malformed.",
    );
  }
  const prepared = historicalFresh0016MigrationBudgetPreparedSchema.parse(
    preparedBudget.evidence,
  );
  let day2Budget: ReturnType<
    typeof readHistoricalFresh0016Day2BudgetEnvelope
  >;
  try {
    day2Budget = readHistoricalFresh0016Day2BudgetEnvelope({
      backupDirectory: input.backupDirectory,
      cutoverRunId: predecessor.cutoverRunId,
      now: new Date(input.manifestStage.value.createdAt),
      allowRefined: true,
    });
  } catch {
    throw chainError(
      "ARTIFACT_INVALID",
      "The immutable aggregate Day-2 envelope is missing, unsafe, unbudgeted, or malformed.",
    );
  }
  const finalBudget = manifest.migrationBudget.evidence;
  if (
    manifest.migrationBudget.preparedArtifactFileSha256 !==
      preparedBudget.sha256 ||
    prepared.cutoverRunId !== predecessor.cutoverRunId ||
    prepared.day2BudgetEnvelope.operationId !==
      day2Budget.evidence.operationId ||
    prepared.day2BudgetEnvelope.fileSha256 !== day2Budget.sha256 ||
    prepared.day2BudgetEnvelope.predecessorCompleteStageSha256 !==
      input.predecessorCompleteStage.sha256 ||
    canonicalHistoricalFresh0016Json(finalBudget.day2BudgetEnvelope) !==
      canonicalHistoricalFresh0016Json(prepared.day2BudgetEnvelope) ||
    finalBudget.cutoverRunId !== prepared.cutoverRunId ||
    finalBudget.policySha256 !== prepared.policySha256 ||
    finalBudget.utcDay !== prepared.utcDay ||
    finalBudget.operationId !== prepared.operationId ||
    canonicalHistoricalFresh0016Json(finalBudget.workerRelease) !==
      canonicalHistoricalFresh0016Json(prepared.workerRelease) ||
    canonicalHistoricalFresh0016Json(finalBudget.liveTopology) !==
      canonicalHistoricalFresh0016Json(prepared.liveTopology) ||
    canonicalHistoricalFresh0016Json(manifest.workerRelease) !==
      canonicalHistoricalFresh0016Json(prepared.workerRelease) ||
    canonicalHistoricalFresh0016Json(manifest.migrationLiveTopology) !==
      canonicalHistoricalFresh0016Json(prepared.liveTopology) ||
    canonicalHistoricalFresh0016Json(day2Budget.evidence.workerRelease) !==
      canonicalHistoricalFresh0016Json(prepared.workerRelease) ||
    finalBudget.productionExclusionOwnerSha256 !==
      prepared.productionExclusion.ownerSha256 ||
    canonicalHistoricalFresh0016Json(finalBudget.sourceFingerprint) !==
      canonicalHistoricalFresh0016Json(prepared.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(finalBudget.database) !==
      canonicalHistoricalFresh0016Json(prepared.database) ||
    canonicalHistoricalFresh0016Json(finalBudget.usage) !==
      canonicalHistoricalFresh0016Json(prepared.usage) ||
    canonicalHistoricalFresh0016Json(finalBudget.cardinalities) !==
      canonicalHistoricalFresh0016Json(prepared.cardinalities) ||
    canonicalHistoricalFresh0016Json(finalBudget.cardinalityQuery) !==
      canonicalHistoricalFresh0016Json(prepared.cardinalityQuery) ||
    canonicalHistoricalFresh0016Json(finalBudget.projection) !==
      canonicalHistoricalFresh0016Json(prepared.projection) ||
    canonicalHistoricalFresh0016Json(finalBudget.applyEnvelope) !==
      canonicalHistoricalFresh0016Json(prepared.applyEnvelope) ||
    canonicalHistoricalFresh0016Json(finalBudget.maximum) !==
      canonicalHistoricalFresh0016Json(prepared.maximum) ||
    canonicalHistoricalFresh0016Json(finalBudget.migrationSource) !==
      canonicalHistoricalFresh0016Json(prepared.migrationSource) ||
    canonicalHistoricalFresh0016Json(manifest.productionExclusion.owner) !==
      canonicalHistoricalFresh0016Json(prepared.productionExclusion.owner) ||
    manifest.productionExclusion.ownerSha256 !==
      prepared.productionExclusion.ownerSha256 ||
    canonicalHistoricalFresh0016Json(manifest.database) !==
      canonicalHistoricalFresh0016Json(prepared.database) ||
    canonicalHistoricalFresh0016Json(manifest.migrationSource) !==
      canonicalHistoricalFresh0016Json(prepared.migrationSource)
  ) {
    throw chainError(
      "CHAIN_INVALID",
      "Manifest and final migration budget do not bind the exact prepared artifact.",
    );
  }
  validateMigrationBudgetEvidence({
    evidence: manifest.migrationBudget.evidence,
    manifestCreatedAt: input.manifestStage.value.createdAt,
    backupDirectory: input.backupDirectory,
    source: claim.sourceFingerprint,
    workerRelease: claim.workerRelease,
    productionExclusionOwnerSha256: ownerSha256,
  });
  if (!sameSource(compactSource(input.currentSourceFull), claim.sourceFingerprint)) {
    throw chainError("SOURCE_DRIFT", "Migration manifest source does not match the current repository.");
  }
}

function validateMigrationBudgetEvidence(input: {
  evidence: z.infer<typeof historicalFresh0016MigrationBudgetEvidenceSchema>;
  manifestCreatedAt: string;
  backupDirectory: string;
  source: { sha256: string; fileCount: number };
  workerRelease: z.infer<typeof uploadedInactiveWorkerReleaseSchema>;
  productionExclusionOwnerSha256: string;
}) {
  const evidence = input.evidence;
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: evidence.liveTopology,
    boundaryAt: new Date(evidence.createdAt),
    ...evidence.workerRelease,
  });
  let expectedProjection: ReturnType<typeof projectRuntimeMigrationUsage>;
  try {
    expectedProjection = projectRuntimeMigrationUsage(
      evidence.cardinalities,
      evidence.cardinalityQuery.rowsRead,
    );
  } catch {
    throw chainError("CHAIN_INVALID", "The embedded runtime migration projection is invalid.");
  }
  const exactRowsRead = safeAdd(
    expectedProjection.rowsRead,
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.projectedRowsRead,
    "runtime migration and apply read envelope",
  );
  if (
    canonicalHistoricalFresh0016Json(evidence.projection) !==
      canonicalHistoricalFresh0016Json(expectedProjection) ||
    evidence.exact.rowsRead !== exactRowsRead ||
    evidence.exact.rowsWritten !== expectedProjection.rowsWritten ||
    evidence.maximum.rowsRead !==
      HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ ||
    evidence.maximum.rowsWritten !== MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES ||
    evidence.productionExclusionOwnerSha256 !==
      input.productionExclusionOwnerSha256 ||
    canonicalHistoricalFresh0016Json(evidence.workerRelease) !==
      canonicalHistoricalFresh0016Json(input.workerRelease) ||
    canonicalHistoricalFresh0016Json(evidence.liveTopology.workerRelease) !==
      canonicalHistoricalFresh0016Json(input.workerRelease) ||
    !sameSource(evidence.sourceFingerprint, input.source) ||
    evidence.createdAt.slice(0, 10) !== evidence.utcDay ||
    input.manifestCreatedAt.slice(0, 10) !== evidence.utcDay ||
    Date.parse(evidence.createdAt) > Date.parse(input.manifestCreatedAt)
  ) {
    throw chainError("CHAIN_INVALID", "The runtime migration budget evidence is not exact or source-bound.");
  }
  validateMaximumToExactReservation({
    label: "runtime migration",
    maximum: evidence.maximum.ledger,
    exact: evidence.exact.ledger,
    operationId: evidence.operationId,
    targetCandidateVersionId:
      evidence.workerRelease.targetCandidateVersionId,
    maximumRowsRead: evidence.maximum.rowsRead,
    exactRowsRead: evidence.exact.rowsRead,
    maximumRowsWritten: evidence.maximum.rowsWritten,
    exactRowsWritten: evidence.exact.rowsWritten,
    usage: evidence.usage,
    accountedByAggregate: true,
  });
  const expectedLedgerPath = path.join(
    input.backupDirectory,
    "cloudflare",
    `d1-release-budget-ledger-${evidence.utcDay}.json`,
  );
  if (
    evidence.maximum.ledger.ledgerPath !== expectedLedgerPath ||
    evidence.exact.ledger.ledgerPath !== expectedLedgerPath
  ) {
    throw chainError("CHAIN_INVALID", "Runtime migration budget points to the wrong UTC-day ledger.");
  }
}

function validateMaximumToExactReservation(input: {
  label: string;
  maximum: z.infer<typeof genericLedgerResultSchema>;
  exact: z.infer<typeof genericLedgerResultSchema>;
  operationId: string;
  targetCandidateVersionId: string;
  maximumRowsRead: number;
  exactRowsRead: number;
  maximumRowsWritten: number;
  exactRowsWritten: number;
  usage: z.infer<typeof usageSchema>;
  accountedByAggregate: boolean;
}) {
  const maximum = input.maximum;
  const exact = input.exact;
  const releasedReads = input.maximumRowsRead - input.exactRowsRead;
  const releasedWrites = input.maximumRowsWritten - input.exactRowsWritten;
  const maximumOverFree =
    maximum.accountedUsage.rowsRead > D1_FREE_SAFE_ROWS_READ_LIMIT ||
    maximum.accountedUsage.rowsWritten > D1_FREE_SAFE_ROWS_WRITTEN_LIMIT;
  const exactOverFree =
    exact.accountedUsage.rowsRead > D1_FREE_SAFE_ROWS_READ_LIMIT ||
    exact.accountedUsage.rowsWritten > D1_FREE_SAFE_ROWS_WRITTEN_LIMIT;
  if (
    releasedReads < 0 ||
    releasedWrites < 0 ||
    maximum.ledgerPath !== exact.ledgerPath ||
    maximum.utcDay !== exact.utcDay ||
    maximum.reservation.operationId !== input.operationId ||
    exact.reservation.operationId !== input.operationId ||
    maximum.reservation.operation !== exact.reservation.operation ||
    maximum.reservation.candidateVersionId !==
      input.targetCandidateVersionId ||
    exact.reservation.candidateVersionId !== input.targetCandidateVersionId ||
    maximum.reservation.phase !== "maximum" ||
    exact.reservation.phase !== "exact" ||
    maximum.reservation.rowsRead !== input.maximumRowsRead ||
    exact.reservation.rowsRead !== input.exactRowsRead ||
    maximum.reservation.rowsWritten !== input.maximumRowsWritten ||
    exact.reservation.rowsWritten !== input.exactRowsWritten ||
    maximum.reservation.maximumRowsRead !== input.maximumRowsRead ||
    exact.reservation.maximumRowsRead !== input.maximumRowsRead ||
    maximum.reservation.maximumRowsWritten !== input.maximumRowsWritten ||
    exact.reservation.maximumRowsWritten !== input.maximumRowsWritten ||
    maximum.reservation.createdAt !== exact.reservation.createdAt ||
    Date.parse(maximum.reservation.createdAt) >
      Date.parse(maximum.reservation.updatedAt) ||
    Date.parse(maximum.reservation.updatedAt) >
      Date.parse(exact.reservation.updatedAt) ||
    exact.revision <= maximum.revision ||
    (input.accountedByAggregate
      ? maximum.totals.rowsRead !== exact.totals.rowsRead ||
        maximum.totals.rowsWritten !== exact.totals.rowsWritten ||
        maximum.accountedUsage.rowsRead !== exact.accountedUsage.rowsRead ||
        maximum.accountedUsage.rowsWritten !== exact.accountedUsage.rowsWritten
      : maximum.totals.rowsRead < exact.totals.rowsRead ||
        maximum.totals.rowsRead - exact.totals.rowsRead !== releasedReads ||
        maximum.totals.rowsWritten < exact.totals.rowsWritten ||
        maximum.totals.rowsWritten - exact.totals.rowsWritten !== releasedWrites) ||
    maximum.accountedUsage.rowsRead <
      safeAdd(input.usage.rowsRead, maximum.totals.rowsRead, `${input.label} maximum reads`) ||
    exact.accountedUsage.rowsRead <
      safeAdd(input.usage.rowsRead, exact.totals.rowsRead, `${input.label} exact reads`) ||
    maximum.accountedUsage.rowsWritten <
      safeAdd(input.usage.rowsWritten, maximum.totals.rowsWritten, `${input.label} maximum writes`) ||
    exact.accountedUsage.rowsWritten <
      safeAdd(input.usage.rowsWritten, exact.totals.rowsWritten, `${input.label} exact writes`) ||
    ((maximumOverFree || exactOverFree) &&
      !hasPaidExpeditedAdmission(maximum, exact))
  ) {
    throw chainError("CHAIN_INVALID", `The ${input.label} maximum-to-exact ledger transition is invalid.`);
  }
}

function hasPaidExpeditedAdmission(
  maximum: z.infer<typeof genericLedgerResultSchema>,
  exact: z.infer<typeof genericLedgerResultSchema>,
) {
  if (maximum.ledgerPath !== exact.ledgerPath || maximum.utcDay !== exact.utcDay) {
    return false;
  }
  try {
    const ledger = readD1ReleaseBudgetLedger(maximum.ledgerPath);
    return (
      ledger.utcDay === maximum.utcDay &&
      ledger.admissionMode === D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE
    );
  } catch {
    return false;
  }
}

function validateMigrationStages(input: {
  binding: z.infer<typeof historicalFresh0016MigrationBindingSchema>;
  renderedEvidence: z.infer<
    typeof historicalFresh0016RenderedMigrationEvidenceSchema
  >;
  manifest: ManifestPayload;
  manifestStage: StageHandle;
  predecessorCompleteStage: StageHandle;
  migrationAuthorized: z.infer<
    typeof historicalFresh0016ApplyAuthorizationPayloadSchema
  >;
  migrationAuthorizedStage: StageHandle;
  migrationComplete: MigrationCompletePayload;
  migrationCompleteStage: StageHandle;
  runtimeStage: RuntimeStagePayload;
}) {
  const authorization = input.migrationAuthorized;
  const completion = input.migrationComplete;
  const runtime = input.runtimeStage.report;
  const renderedSha256 = input.renderedEvidence.renderedMigration.sha256;
  const bindingSha256 = historicalFresh0016JsonSha256(input.binding);
  const runtimeValueSha256 = historicalFresh0016JsonSha256(runtime);
  const runtimeFileSha256 = canonicalFileSha256(runtime);
  if (
    canonicalHistoricalFresh0016Json(authorization.binding) !==
      canonicalHistoricalFresh0016Json(input.binding) ||
    authorization.manifestStageSha256 !== input.manifestStage.sha256 ||
    authorization.predecessorCompleteStageSha256 !==
      input.predecessorCompleteStage.sha256 ||
    authorization.predecessorReportSha256 !==
      input.binding.predecessorReportSha256 ||
    authorization.preWriteEvidenceSha256 !==
      input.manifest.preWriteEvidenceSha256 ||
    authorization.renderedMigrationSha256 !== renderedSha256 ||
    authorization.productionExclusionOwnerSha256 !==
      input.manifest.productionExclusion.ownerSha256 ||
    authorization.activeWorkerVersion !==
      input.manifest.workerRelease.targetCandidateVersionId ||
    !sameSource(authorization.sourceFingerprint, input.binding.sourceFingerprint) ||
    authorization.preState.classification !== "exact-pre-0016" ||
    !authorization.preState.schemaObjectsAbsent ||
    !authorization.preState.fixedMarkerAbsent ||
    !authorization.preState.freshMarkerAbsent ||
    completion.bindingSha256 !== bindingSha256 ||
    completion.migrationAuthorizedStageSha256 !==
      input.migrationAuthorizedStage.sha256 ||
    completion.verifierMigrationAuthorizationSha256 !==
      input.migrationAuthorizedStage.sha256 ||
    completion.runtimeVerificationReportSha256 !== runtimeValueSha256 ||
    completion.renderedMigrationSha256 !== renderedSha256 ||
    input.runtimeStage.migrationCompleteStageSha256 !==
      input.migrationCompleteStage.sha256 ||
    input.runtimeStage.reportCanonicalValueSha256 !== runtimeValueSha256 ||
    input.runtimeStage.reportCanonicalFileSha256 !== runtimeFileSha256 ||
    runtime.evidence.predecessorCompleteSha256 !==
      input.predecessorCompleteStage.sha256 ||
    runtime.evidence.preWriteEvidenceSha256 !==
      input.manifest.preWriteEvidenceSha256 ||
    runtime.evidence.migrationAuthorizationSha256 !==
      input.migrationAuthorizedStage.sha256 ||
    runtime.evidence.renderedMigrationSha256 !== renderedSha256 ||
    runtime.evidence.productionExclusionOwnerSha256 !==
      input.manifest.productionExclusion.ownerSha256 ||
    runtime.renderedMigration.renderedSha256 !== renderedSha256 ||
    runtime.renderedMigration.freshMarkerValueSha256 !==
      input.renderedEvidence.freshMarker.valueSha256 ||
    runtime.post0016Verification.querySha256 !==
      sha256(HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL) ||
    runtime.post0016Verification.fixedMarker.valueSha256 !==
      sha256(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE) ||
    runtime.post0016Verification.freshMarker.valueSha256 !==
      input.renderedEvidence.freshMarker.valueSha256 ||
    runtime.activeWorkerVersion !==
      input.manifest.workerRelease.targetCandidateVersionId ||
    !sameSource(runtime.sourceFingerprint, input.binding.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(runtime.binding) !==
      canonicalHistoricalFresh0016Json(input.binding) ||
    runtime.post0016Verification.cleanupOutboxRowCount !== 0 ||
    runtime.totalRowsWritten !== 0
  ) {
    throw chainError("CHAIN_INVALID", "Migration authorization, completion, runtime proof, or rendered binding drifted.");
  }
  validateApplyAttempts(authorization, completion);
}

function validateApplyAttempts(
  authorization: z.infer<typeof historicalFresh0016ApplyAuthorizationPayloadSchema>,
  completion: MigrationCompletePayload,
) {
  const attempts = completion.attempts;
  if (
    attempts.length > authorization.attemptPlan.maximumAttempts ||
    attempts.some(
      (attempt, index) =>
        attempt.attempt !== index + 1 ||
        Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt) ||
        (attempt.responseConfirmed &&
          attempt.runnerOutcome !== "confirmed-success") ||
        (!attempt.responseConfirmed &&
          attempt.runnerOutcome === "confirmed-success"),
    ) ||
    (attempts.length > 0 && attempts.at(-1)?.readback !== "verified-committed")
  ) {
    throw chainError("CHAIN_INVALID", "Migration attempt evidence is inconsistent.");
  }
  const status = completion.status;
  if (
    (status === "verified" &&
      (attempts.length !== 1 || attempts[0]?.responseConfirmed !== true)) ||
    (status === "verified-after-ambiguous-response" &&
      (attempts.length !== 1 || attempts[0]?.responseConfirmed !== false)) ||
    (status === "verified-after-explicit-retry" &&
      (attempts.length !== 2 ||
        attempts[0]?.readback !== "verified-absent" ||
        attempts[1]?.readback !== "verified-committed" ||
        !authorization.attemptPlan.explicitSameInvocationRetryAuthorized)) ||
    (status === "verified-after-unresolved-authorization" &&
      attempts.length !== 0)
  ) {
    throw chainError("CHAIN_INVALID", "Migration completion status does not match its exact attempts.");
  }
}

function validateApplyResolution(
  classification: HistoricalFresh0016StateClassification,
  authorization: z.infer<typeof historicalFresh0016ApplyAuthorizationPayloadSchema>,
  completion: MigrationCompletePayload,
) {
  const resolutions = classification.readbackResolutions.filter(
    (entry) => entry.value.stage === "migration-authorized",
  );
  if (completion.status !== "verified-after-unresolved-authorization") {
    if (completion.readbackResolutionSha256 !== null || resolutions.length !== 0) {
      throw chainError("CHAIN_INVALID", "Unexpected migration readback-resolution evidence exists.");
    }
    return;
  }
  if (resolutions.length !== 1) {
    throw chainError("CHAIN_INVALID", "Recovered migration completion requires one exact resolution.");
  }
  const resolution = resolutions[0];
  if (!resolution || completion.readbackResolutionSha256 !== resolution.sha256) {
    throw chainError("CHAIN_INVALID", "Recovered migration completion lost its exact resolution hash.");
  }
  const evidence = parseSchema(
    z.object({
      kind: z.literal(HISTORICAL_FRESH_0016_APPLY_READBACK_RESOLUTION_KIND),
      schemaVersion: z.literal(1),
      authorizationStageSha256: sha256Schema,
      bindingSha256: sha256Schema,
      runtimeVerificationReportSha256: sha256Schema,
      databaseState: z.literal("verified-committed"),
      staticRowsRead: nonnegativeIntegerSchema,
      probeRowsRead: nonnegativeIntegerSchema.refine((value) => value <= 32),
      staticTotalAttempts: z.literal(1),
      probeTotalAttempts: z.literal(1),
      readbackOnly: z.literal(true),
      d1RetryAuthorized: z.literal(false),
    }).strict(),
    resolution.value.evidence,
    "migration readback resolution evidence",
  );
  if (
    evidence.authorizationStageSha256 !== resolution.value.stageSha256 ||
    evidence.bindingSha256 !== historicalFresh0016JsonSha256(authorization.binding) ||
    evidence.runtimeVerificationReportSha256 !==
      completion.runtimeVerificationReportSha256 ||
    resolution.value.readbackOnly !== true ||
    resolution.value.d1RetryAuthorized !== false ||
    resolution.value.evidenceSha256 !== historicalFresh0016JsonSha256(evidence)
  ) {
    throw chainError("CHAIN_INVALID", "Migration readback resolution is not exact and read-only.");
  }
}

function validateSuccessorStageBindings(input: {
  authorized: SuccessorAuthorizationPayload;
  prepared: SuccessorPreparedPayload;
  report: ReturnType<typeof parseHistoricalFresh0016SuccessorReport>;
  authorizationStage: StageHandle;
  runtimeStage: StageHandle;
  runtimeReport: z.infer<typeof historicalFresh0016RuntimeVerificationReportSchema>;
  predecessorReportSha256: string;
  manifest: ManifestPayload;
  claim: ClaimPayload;
}) {
  const { authorized, prepared, report, runtimeReport, manifest, claim } = input;
  const runtimeFileSha256 =
    historicalFresh0016SuccessorRuntimeVerificationReportSha256(runtimeReport);
  const authorizationContext = {
    phase: "successor",
    d1ExecutionMayStart: true,
    cutoverRunId: report.cutoverRunId,
    operationId: report.operationId,
    accountingParentOperationId: report.accountingParentOperationId,
    sourceFingerprint: report.sourceFingerprint,
    workerRelease: report.workerRelease,
    captureLiveTopology: report.captureLiveTopology,
    hmacKeyId: report.hmacKeyId,
    snapshotPlanSha256: report.snapshotPlanSha256,
    predecessorReportSha256: input.predecessorReportSha256,
    runtimeVerificationStageSha256: input.runtimeStage.sha256,
    runtimeVerificationReportSha256: runtimeFileSha256,
    productionExclusionOwnerSha256:
      manifest.productionExclusion.ownerSha256,
    utcDay: report.utcDay,
    maximumReservationRevision: authorized.maximumReservation.revision,
    maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    maximumRowsWritten: 0,
  } as const;
  const preparedAuthorization = {
    ...authorizationContext,
    authorizationStageSha256: input.authorizationStage.sha256,
  };
  if (
    authorized.runtimeVerificationStageSha256 !== input.runtimeStage.sha256 ||
    authorized.operationId !== report.operationId ||
    authorized.accountingParentOperationId !==
      report.accountingParentOperationId ||
    report.accountingParentOperationId !==
      manifest.migrationBudget.evidence.day2BudgetEnvelope.operationId ||
    authorized.authorizationContextSha256 !==
      historicalFresh0016JsonSha256(authorizationContext) ||
    !sameSource(authorized.sourceFingerprint, claim.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(authorized.workerRelease) !==
      canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    canonicalHistoricalFresh0016Json(authorized.captureLiveTopology) !==
      canonicalHistoricalFresh0016Json(report.captureLiveTopology) ||
    authorized.hmacKeyId !== claim.hmacKeyId ||
    authorized.predecessorReportSha256 !== input.predecessorReportSha256 ||
    authorized.runtimeVerificationReportSha256 !== runtimeFileSha256 ||
    authorized.productionExclusionOwnerSha256 !==
      manifest.productionExclusion.ownerSha256 ||
    authorized.utcDay !== report.utcDay ||
    canonicalHistoricalFresh0016Json(prepared.authorization) !==
      canonicalHistoricalFresh0016Json(preparedAuthorization) ||
    prepared.operationId !== report.operationId ||
    prepared.accountingParentOperationId !==
      report.accountingParentOperationId ||
    prepared.cutoverRunId !== report.cutoverRunId ||
    prepared.paths.backupDirectory !== report.paths.backupDirectory ||
    prepared.paths.runDirectory !== report.paths.runDirectory ||
    prepared.paths.reportPath !== report.paths.reportPath ||
    canonicalHistoricalFresh0016Json(prepared.workerRelease) !==
      canonicalHistoricalFresh0016Json(report.workerRelease) ||
    canonicalHistoricalFresh0016Json(prepared.captureLiveTopology) !==
      canonicalHistoricalFresh0016Json(report.captureLiveTopology) ||
    prepared.hmacKeyId !== report.hmacKeyId ||
    !sameSource(prepared.sourceFingerprint, report.sourceFingerprint) ||
    prepared.productionExclusion.ownerSha256 !==
      report.productionExclusion.ownerSha256 ||
    prepared.productionExclusion.leaseExpiresAt !==
      report.productionExclusion.leaseExpiresAt ||
    canonicalHistoricalFresh0016Json(authorized.usage) !==
      canonicalHistoricalFresh0016Json(report.usage) ||
    canonicalHistoricalFresh0016Json(prepared.usage) !==
      canonicalHistoricalFresh0016Json(report.usage) ||
    canonicalHistoricalFresh0016Json(prepared.maximumReservation) !==
      canonicalHistoricalFresh0016Json(report.ledger.maximum) ||
    report.predecessor.reportSha256 !== input.predecessorReportSha256 ||
    report.migrationRuntimeVerification.stageSha256 !== input.runtimeStage.sha256 ||
    report.migrationRuntimeVerification.reportSha256 !== runtimeFileSha256 ||
    report.migrationRuntimeVerification.predecessorCompleteSha256 !==
      runtimeReport.evidence.predecessorCompleteSha256 ||
    report.productionExclusion.ownerSha256 !==
      manifest.productionExclusion.ownerSha256 ||
    report.productionExclusion.leaseExpiresAt !==
      manifest.productionExclusion.owner.leaseExpiresAt ||
    canonicalHistoricalFresh0016Json(report.workerRelease) !==
      canonicalHistoricalFresh0016Json(claim.workerRelease) ||
    report.hmacKeyId !== claim.hmacKeyId ||
    !sameSource(report.sourceFingerprint, claim.sourceFingerprint) ||
    prepared.rowsRead !== report.rowsRead ||
    prepared.rowsWritten !== report.rowsWritten ||
    prepared.captureStartedAt !== report.captureStartedAt ||
    prepared.captureCompletedAt !== report.captureCompletedAt ||
    prepared.resultSetCount !== report.snapshotExecution.resultSetCount ||
    prepared.automaticAttemptsPerResultSet !==
      report.snapshotExecution.automaticAttemptsPerResultSet
  ) {
    throw chainError("CHAIN_INVALID", "Successor stages, report, runtime, exclusion, source, HMAC, or Worker binding drifted.");
  }
  if (
    Date.parse(report.captureLiveTopology.observedAt) <=
    Date.parse(manifest.migrationLiveTopology.observedAt)
  ) {
    throw chainError(
      "CHAIN_INVALID",
      "Successor requires a new candidate-absent topology after migration evidence publication.",
    );
  }
  validateMaximumToExactReservation({
    label: "successor",
    maximum: authorized.maximumReservation,
    exact: report.ledger.exact,
    operationId: report.operationId,
    targetCandidateVersionId: report.workerRelease.targetCandidateVersionId,
    maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    exactRowsRead: report.rowsRead,
    maximumRowsWritten: 0,
    exactRowsWritten: 0,
    usage: report.usage,
    accountedByAggregate: true,
  });
  if (canonicalHistoricalFresh0016Json(authorized.maximumReservation) !==
    canonicalHistoricalFresh0016Json(report.ledger.maximum)) {
    throw chainError("CHAIN_INVALID", "Successor report does not embed its exact authorization reservation.");
  }
}

function validateTimingAndBudgets(input: {
  claim: ClaimPayload;
  predecessorAuthorized: PredecessorAuthorizationPayload;
  predecessor: ReturnType<typeof parseHistoricalFresh0016PredecessorReport>;
  runtime: z.infer<typeof historicalFresh0016RuntimeVerificationReportSchema>;
  successorAuthorized: SuccessorAuthorizationPayload;
  successor: ReturnType<typeof parseHistoricalFresh0016SuccessorReport>;
  manifest: ManifestPayload;
}) {
  const predecessorStart = Date.parse(input.predecessor.captureStartedAt);
  const predecessorCreated = Date.parse(input.predecessor.createdAt);
  const runtimeCreated = Date.parse(input.runtime.createdAt);
  const successorStart = Date.parse(input.successor.captureStartedAt);
  const successorCreated = Date.parse(input.successor.createdAt);
  const predecessorDayStart = Date.parse(`${input.predecessor.utcDay}T00:00:00.000Z`);
  const successorDayStart = Date.parse(`${input.successor.utcDay}T00:00:00.000Z`);
  const predecessorDayEnd = predecessorDayStart + 24 * 60 * 60 * 1_000;
  const utcDayDeltaMs = successorDayStart - predecessorDayStart;
  const resetTimingInvalid =
    claimReleaseTimingMode(input.claim) ===
    HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE
      ? utcDayDeltaMs !== 0 && utcDayDeltaMs !== 24 * 60 * 60 * 1_000
      : utcDayDeltaMs !== 24 * 60 * 60 * 1_000 ||
        predecessorStart <
          predecessorDayEnd - policy.predecessor.targetFinalUtcDayWindowMs ||
        predecessorCreated >= predecessorDayEnd ||
        successorStart < successorDayStart ||
        successorStart >
          successorDayStart + policy.successor.targetFirstNextUtcDayWindowMs;
  if (
    resetTimingInvalid ||
    predecessorCreated > runtimeCreated ||
    runtimeCreated > successorStart ||
    successorCreated - predecessorCreated !==
      input.successor.predecessorToSuccessorGapMs ||
    input.successor.predecessorToSuccessorGapMs <= 0 ||
    input.successor.predecessorToSuccessorGapMs >
      policy.successor.maximumPredecessorToSuccessorGapMs ||
    input.manifest.migrationBudget.evidence.utcDay !== input.successor.utcDay ||
    input.runtime.createdAt.slice(0, 10) !== input.successor.utcDay ||
    input.predecessorAuthorized.utcDay !== input.predecessor.utcDay ||
    input.successorAuthorized.utcDay !== input.successor.utcDay ||
    input.manifest.productionExclusion.owner.leaseExpiresAt <= successorCreated
  ) {
    throw chainError("CHAIN_INVALID", "Fresh 0016 timing, reset window, UTC-day, gap, or exclusion lease is invalid.");
  }
}

function buildCanonicalArtifact(input: {
  verified: VerifiedFirstEleven;
  createdAt: string;
  canonicalCompletePath: string;
}): HistoricalFresh0016CanonicalCutoverArtifact {
  const value = input.verified;
  const stageHashes = {
    claim: value.stageByName.claim.sha256,
    "predecessor-authorized": value.stageByName["predecessor-authorized"].sha256,
    "predecessor-prepared": value.stageByName["predecessor-prepared"].sha256,
    "predecessor-complete": value.stageByName["predecessor-complete"].sha256,
    manifest: value.stageByName.manifest.sha256,
    "migration-authorized": value.stageByName["migration-authorized"].sha256,
    "migration-complete": value.stageByName["migration-complete"].sha256,
    "runtime-verification": value.stageByName["runtime-verification"].sha256,
    "successor-authorized": value.stageByName["successor-authorized"].sha256,
    "successor-prepared": value.stageByName["successor-prepared"].sha256,
    "successor-complete": value.stageByName["successor-complete"].sha256,
  };
  const decisionsSha256 = historicalFresh0016JsonSha256({
    datasets: value.continuity.datasets,
    supplementalDatasets: value.continuity.supplementalDatasets,
    operationalOutbox: value.continuity.operationalOutbox,
  });
  const runtimeValueSha256 = historicalFresh0016JsonSha256(
    value.runtimeStage.report,
  );
  const runtimeFileSha256 = canonicalFileSha256(value.runtimeStage.report);
  const migrationBudget = value.manifest.migrationBudget.evidence;
  const completionIntentMaterialSha256 = historicalFresh0016JsonSha256({
    kind: HISTORICAL_FRESH_0016_CUTOVER_COMPLETION_INTENT_KIND,
    schemaVersion: 1,
    successorCompleteStageSha256:
      value.stageByName["successor-complete"].sha256,
    completedAt: input.createdAt,
    canonicalCompletePath: input.canonicalCompletePath,
  });
  return parseSchema(
    historicalFresh0016CanonicalCutoverArtifactSchema,
    {
      kind: HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_KIND,
      schemaVersion: 2,
      createdAt: input.createdAt,
      cutoverRunId: value.predecessor.report.cutoverRunId,
      paths: {
        backupDirectory: value.paths.backupDirectory,
        runDirectory: value.paths.runDirectory,
        canonicalCompletePath: input.canonicalCompletePath,
      },
      policy: {
        id: policy.policyId,
        sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
        lostKeyStatus: policy.legacyInterval.status,
        legacyIntervalContinuityProven: false,
        retroactiveContinuityClaimed: false,
      },
      database: policy.database,
      sourceFingerprint: value.claim.sourceFingerprint,
      workerRelease: value.claim.workerRelease,
      finalizationLiveTopology:
        value.successor.report.finalizationLiveTopology,
      hmacKeyId: value.claim.hmacKeyId,
      state: {
        verifiedStageCount: 12,
        boundStageHashCount: 11,
        stages: stageHashes,
        successorCompleteStageSha256:
          value.stageByName["successor-complete"].sha256,
        completionIntentMaterialSha256,
      },
      evidence: {
        predecessorPrerequisitesSha256:
          historicalFresh0016JsonSha256(
            value.claim.predecessorPrerequisites,
          ),
        predecessorPrerequisites: value.claim.predecessorPrerequisites,
        predecessorReportFileSha256: value.predecessor.sha256,
        migrationBudgetPreparedArtifactFileSha256:
          value.manifest.migrationBudget.preparedArtifactFileSha256,
        manifestPayloadSha256: value.stageByName.manifest.value.payloadSha256,
        bindingSha256: historicalFresh0016JsonSha256(value.binding),
        renderedMigrationSha256:
          value.rendered.evidence.renderedMigration.sha256,
        migrationAuthorizationStageSha256:
          value.stageByName["migration-authorized"].sha256,
        migrationCompleteStageSha256:
          value.stageByName["migration-complete"].sha256,
        runtimeVerificationCanonicalValueSha256: runtimeValueSha256,
        runtimeVerificationCanonicalFileSha256: runtimeFileSha256,
        successorReportFileSha256: value.successor.sha256,
        productionExclusionOwnerSha256:
          value.manifest.productionExclusion.ownerSha256,
        preWriteEvidenceSha256: value.manifest.preWriteEvidenceSha256,
      },
      migration: {
        status: value.migrationComplete.status,
        attempts: value.migrationComplete.attempts.length,
        readbackResolutionUsed:
          value.migrationComplete.readbackResolutionSha256 !== null,
        runtimeRowsRead: value.runtimeStage.report.totalRowsRead,
        runtimeRowsWritten: 0,
      },
      continuity: {
        ok: true,
        protectedDatasetCount: HISTORICAL_PROTECTED_DATASET_COUNT,
        decisionsSha256,
        predecessorToSuccessorGapMs: value.continuity.gapMs,
        outboxSchemaPresent: true,
        outboxRowsBeforeActivation: 0,
      },
      timing: {
        releaseTimingMode: claimReleaseTimingMode(value.claim),
        predecessorUtcDay: value.predecessor.report.utcDay,
        successorUtcDay: value.successor.report.utcDay,
        predecessorCreatedAt: value.predecessor.report.createdAt,
        runtimeVerifiedAt: value.runtimeStage.report.createdAt,
        successorCreatedAt: value.successor.report.createdAt,
        productionExclusionLeaseExpiresAt:
          value.productionExclusionLeaseExpiresAt,
      },
      budget: {
        predecessorOperationId: value.predecessor.report.operationId,
        predecessorMaximumRowsRead:
          HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
        predecessorExactRowsRead: value.predecessor.report.rowsRead,
        runtimeMigrationReportSha256:
          value.manifest.migrationBudget.evidenceSha256,
        runtimeMigrationProjectedRowsRead: migrationBudget.exact.rowsRead,
        runtimeMigrationProjectedRowsWritten: migrationBudget.exact.rowsWritten,
        applyEnvelopeRowsRead:
          HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.projectedRowsRead,
        applyMaximumWriteCapableCalls:
          HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.writeCapableCalls,
        successorOperationId: value.successor.report.operationId,
        successorMaximumRowsRead:
          HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
        successorExactRowsRead: value.successor.report.rowsRead,
      },
      privacy: "hashes-counts-and-hmac-identities-only",
    },
    "canonical fresh-0016 cutover artifact",
  );
}

function publishOrReadExactCanonicalArtifact(
  file: string,
  artifact: HistoricalFresh0016CanonicalCutoverArtifact,
): HistoricalFresh0016CutoverArtifactHandle {
  const parsed = parseSchema(
    historicalFresh0016CanonicalCutoverArtifactSchema,
    artifact,
    "canonical cutover artifact",
  );
  const bytes = canonicalFileBytes(parsed);
  if (
    bytes.byteLength <= 0 ||
    bytes.byteLength > HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_MAXIMUM_BYTES
  ) {
    throw chainError("ARTIFACT_INVALID", "Canonical cutover artifact exceeds its byte bound.");
  }
  const directory = path.dirname(file);
  const expectedDirectoryIdentity = assertPrivateDirectory(directory, "canonical artifact directory");
  assertDirectDescendant(directory, file, "canonical cutover artifact");
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      let existing: ReturnType<typeof readCanonicalArtifact>;
      try {
        existing = readCanonicalArtifact(file);
      } catch (readError) {
        if (
          readError instanceof HistoricalFresh0016CutoverChainError &&
          readError.code === "PATH_UNSAFE"
        ) {
          throw readError;
        }
        throw chainError(
          "PUBLICATION_CONFLICT",
          "A conflicting or invalid canonical cutover artifact already exists.",
        );
      }
      if (!existing.bytes.equals(bytes)) {
        throw chainError("PUBLICATION_CONFLICT", "A conflicting canonical cutover artifact already exists.");
      }
      return deepFreeze({
        path: file,
        bytes: existing.bytes.byteLength,
        sha256: sha256(existing.bytes),
        publication: "exact-replay" as const,
        artifact: existing.artifact,
      });
    }
    throw chainError("PATH_UNSAFE", "Canonical cutover artifact could not be created exclusively.");
  }
  let failure: unknown;
  try {
    fs.fchmodSync(descriptor, 0o600);
    const before = fs.fstatSync(descriptor);
    assertPrivateRegularFile(before, 0, "new canonical cutover artifact");
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateRegularFile(after, bytes.byteLength, "written canonical cutover artifact");
    if (!sameFileIdentity(before, after)) {
      throw chainError("PATH_UNSAFE", "Canonical cutover artifact inode changed during write.");
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    throw chainError("PATH_UNSAFE", "Canonical cutover artifact write was interrupted and remains fail-closed.");
  }
  fsyncDirectory(directory);
  assertSameDirectoryIdentity(directory, expectedDirectoryIdentity);
  const stored = readCanonicalArtifact(file);
  if (!stored.bytes.equals(bytes)) {
    throw chainError("PUBLICATION_CONFLICT", "Canonical cutover artifact failed exact durable readback.");
  }
  return deepFreeze({
    path: file,
    bytes: stored.bytes.byteLength,
    sha256: sha256(stored.bytes),
    publication: "created" as const,
    artifact: stored.artifact,
  });
}

function readCanonicalArtifact(file: string) {
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw chainError("PATH_UNSAFE", "Canonical cutover artifact is missing, linked, or unreadable.");
  }
  let before: fs.Stats;
  let after: fs.Stats;
  let bytes: Buffer;
  try {
    before = fs.fstatSync(descriptor);
    assertPrivateRegularFile(before, undefined, "stored canonical cutover artifact");
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (!sameStableFile(before, after) || bytes.byteLength !== after.size) {
    throw chainError("PATH_UNSAFE", "Canonical cutover artifact changed while read.");
  }
  const named = safeLstat(file, "canonical cutover artifact");
  assertPrivateRegularFile(named, bytes.byteLength, "named canonical cutover artifact");
  if (!sameStableFile(after, named)) {
    throw chainError("PATH_UNSAFE", "Canonical cutover artifact path changed during readback.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw chainError("ARTIFACT_INVALID", "Canonical cutover artifact is not valid JSON.");
  }
  const artifact = parseSchema(
    historicalFresh0016CanonicalCutoverArtifactSchema,
    raw,
    "stored canonical cutover artifact",
  );
  if (!bytes.equals(canonicalFileBytes(artifact))) {
    throw chainError("ARTIFACT_INVALID", "Canonical cutover artifact bytes are not exact canonical JSON.");
  }
  return { bytes, artifact: deepFreeze(artifact) };
}

function canonicalFileBytes(value: unknown) {
  return Buffer.from(`${canonicalHistoricalFresh0016Json(value)}\n`, "utf8");
}

function canonicalFileSha256(value: unknown) {
  return sha256(canonicalFileBytes(value));
}

function compactSource(value: { sha256: string; fileCount: number }) {
  return Object.freeze({ sha256: value.sha256, fileCount: value.fileCount });
}

function sameSource(
  left: { sha256: string; fileCount: number },
  right: { sha256: string; fileCount: number },
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function assertEqual(actual: string, expected: string, message: string) {
  if (actual !== expected) throw chainError("CHAIN_INVALID", message);
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw chainError("CHAIN_INVALID", `The ${label} has invalid or non-exact schema.`);
  }
  return parsed.data;
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw chainError("CHAIN_INVALID", `The ${label} is not a JSON object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw chainError("CHAIN_INVALID", `The ${label} is invalid.`);
  }
  return new Date(value.getTime());
}

function safeAdd(left: number, right: number, label: string) {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw chainError("CHAIN_INVALID", `${label} overflowed.`);
  }
  return left + right;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function isPrintable(value: string) {
  return !/[\u0000-\u001f\u007f]/.test(value);
}

function assertPrivateDirectory(directory: string, label: string) {
  const absolute = path.resolve(directory);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw chainError("PATH_UNSAFE", `The ${label} must be a real owner-only directory.`);
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw chainError("PATH_UNSAFE", `The ${label} must be owner-only mode 0700.`);
    }
    const canonical = fs.realpathSync.native(absolute);
    if (canonical !== absolute) {
      throw chainError("PATH_UNSAFE", `The ${label} is linked or noncanonical.`);
    }
    return fileIdentity(stat);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSameDirectoryIdentity(
  directory: string,
  expected: Readonly<{ device: number; inode: number }>,
) {
  const actual = assertPrivateDirectory(directory, "canonical artifact directory");
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw chainError("PATH_UNSAFE", "Canonical artifact directory changed during publication.");
  }
}

function assertPrivateRegularFile(
  stat: fs.Stats,
  expectedBytes: number | undefined,
  label: string,
) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    stat.size <= (expectedBytes === 0 ? -1 : 0) ||
    stat.size > HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_MAXIMUM_BYTES ||
    (expectedBytes !== undefined && stat.size !== expectedBytes)
  ) {
    throw chainError("PATH_UNSAFE", `The ${label} has unsafe ownership, mode, type, links, or size.`);
  }
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(
    directory,
    fs.constants.O_RDONLY |
      fs.constants.O_DIRECTORY |
      fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function safeLstat(file: string, label: string) {
  try {
    return fs.lstatSync(file);
  } catch {
    throw chainError("PATH_UNSAFE", `The ${label} cannot be inspected safely.`);
  }
}

function assertContainedPath(parent: string, child: string, label: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw chainError("PATH_UNSAFE", `The ${label} escaped its exact parent.`);
  }
}

function assertDirectDescendant(parent: string, child: string, label: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative.includes(path.sep)
  ) {
    throw chainError("PATH_UNSAFE", `The ${label} is not an exact child path.`);
  }
}

function fileIdentity(stat: fs.Stats) {
  return Object.freeze({ device: stat.dev, inode: stat.ino });
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: fs.Stats, right: fs.Stats) {
  return sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function classifyCutoverState(input: {
  backupDirectory: string;
  runId: string;
}) {
  try {
    return classifyHistoricalFresh0016State(input);
  } catch {
    throw chainError(
      "PATH_UNSAFE",
      "The fresh-0016 state path is missing, linked, noncanonical, or unsafe.",
    );
  }
}

function chainError(
  code: HistoricalFresh0016CutoverChainErrorCode,
  message: string,
) {
  return new HistoricalFresh0016CutoverChainError(code, message);
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
