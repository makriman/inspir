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
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
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
  HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
  HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  HISTORICAL_PRE_0016_SNAPSHOT_KIND,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
  HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
  captureHistoricalPre0016Snapshot,
  createHistoricalPre0016SnapshotPlan,
  type HistoricalPre0016SnapshotCapture,
} from "./historical-data-pre-0016-snapshot";
import {
  historicalDataHmacKeyId,
  requireHistoricalHmacSecret,
} from "./historical-data-hmac-key";
import { createHistoricalDataWranglerRunner } from "./historical-data-wrangler-runner";
import { stableStringify, type WranglerRunner } from "./migration-config";
import {
  HISTORICAL_CORE_ROW_LIMIT,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_GAME_RESULTS_REJECT_UPDATE_TRIGGER_SQL_SHA256,
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS_SHA256,
  HISTORICAL_GAME_RESULTS_TABLE_SQL_SHA256,
  HISTORICAL_SCHEMA_COLUMN_LIMIT,
  HISTORICAL_SENTINEL_LIMIT,
  HISTORICAL_PROTECTED_DATASET_COUNT,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
  validateHistoricalProtectedDatasetEvidence,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalSupplementalDatasetName,
} from "./verify-historical-data-preservation";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

export const HISTORICAL_FRESH_0016_PREDECESSOR_KIND =
  "inspir-historical-data-fresh-0016-predecessor-v2" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_CAPTURE_KIND =
  "inspir-historical-data-fresh-0016-predecessor-prepared-capture-v2" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME =
  "04a-predecessor-report.json" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME =
  "Fresh 0016 pre-migration historical predecessor capture" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES =
  2 * 1024 * 1024;

const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const operationIdPattern =
  /^historical-fresh-0016-predecessor:[a-f0-9]{64}$/;

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
      message: "The fresh-0016 target candidate must differ from the serving baseline.",
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
const ledgerReservationSchema = z.object({
  operationId: z.string().regex(operationIdPattern),
  operation: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME),
  candidateVersionId: uuidSchema,
  phase: z.literal("exact"),
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    "Exact predecessor rows read exceed the snapshot bound.",
  ),
  rowsWritten: z.literal(0),
  maximumRowsRead: z.literal(
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  ),
  maximumRowsWritten: z.literal(0),
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
}).strict();
const ledgerResultSchema = z.object({
  ledgerPath: normalizedAbsolutePathSchema,
  utcDay: utcDaySchema,
  revision: safePositiveIntegerSchema,
  idempotent: z.literal(false),
  reservation: ledgerReservationSchema,
  totals: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
}).strict();
const liveExactLedgerResultSchema = z.object({
  ledgerPath: normalizedAbsolutePathSchema,
  utcDay: utcDaySchema,
  revision: safePositiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: ledgerReservationSchema,
  totals: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
}).strict();
const maximumLedgerReservationSchema = z.object({
  operationId: z.string().regex(operationIdPattern),
  operation: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME),
  candidateVersionId: uuidSchema,
  phase: z.literal("maximum"),
  rowsRead: z.literal(
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  ),
  rowsWritten: z.literal(0),
  maximumRowsRead: z.literal(
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  ),
  maximumRowsWritten: z.literal(0),
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
}).strict();
const maximumLedgerResultSchema = z.object({
  ledgerPath: normalizedAbsolutePathSchema,
  utcDay: utcDaySchema,
  revision: safePositiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: maximumLedgerReservationSchema,
  totals: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: safeNonnegativeIntegerSchema,
    rowsWritten: safeNonnegativeIntegerSchema,
  }).strict(),
}).strict();

const authorizationContextSchema = z.object({
  phase: z.literal("predecessor"),
  d1ExecutionMayStart: z.literal(true),
  cutoverRunId: uuidSchema,
  operationId: z.string().regex(operationIdPattern),
  sourceFingerprint: sourceIdentitySchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  captureLiveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  hmacKeyId: sha256Schema,
  snapshotPlanSha256: sha256Schema,
  utcDay: utcDaySchema,
  maximumReservationRevision: safePositiveIntegerSchema,
  maximumRowsRead: z.literal(
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  ),
  maximumRowsWritten: z.literal(0),
}).strict();
const authorizationReceiptSchema = z.object({
  authorizationStageSha256: sha256Schema,
}).strict();
const preparedAuthorizationSchema = authorizationContextSchema.extend({
  authorizationStageSha256: sha256Schema,
}).strict();
const snapshotPlanSchema = z.object({
  kind: z.literal(HISTORICAL_PRE_0016_SNAPSHOT_KIND),
  schemaVersion: z.literal(1),
  boundary: z.literal("before-runtime-migration-0016"),
  sourceIdentity: sourceIdentitySchema,
  protectedDatasets: z.array(
    z.enum(HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES),
  ).length(HISTORICAL_PROTECTED_DATASET_COUNT),
  excludedOperationalDatasets: z.array(
    z.literal("memory_vector_cleanup_outbox"),
  ).length(1),
  snapshotSqlSha256: sha256Schema,
  resultSetCounts: z.object({
    counts: z.literal(HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT),
    schemas: z.literal(HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT),
    schemaObjects: z.literal(
      HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT,
    ),
    identities: z.literal(HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT),
    total: z.literal(HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT),
  }).strict(),
  limits: z.object({
    logicalSnapshotRowsRead: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    ),
    logicalRowsReadLimit: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
    ),
    maximumAutomaticReadAttempts: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
    ),
    billableRowsReadReservation: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    ),
  }).strict(),
  planSha256: sha256Schema,
}).strict();
const snapshotCaptureSchema = z.object({
  plan: snapshotPlanSchema,
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    "Prepared predecessor rows read exceed the snapshot bound.",
  ),
  rowsWritten: z.literal(0),
  hmacKeyId: sha256Schema,
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), datasetEvidenceSchema),
  supplementalDatasets: z.record(
    z.enum(HISTORICAL_SUPPLEMENTAL_DATASET_NAMES),
    datasetEvidenceSchema,
  ),
}).strict();

const preparedCaptureSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_CAPTURE_KIND),
  schemaVersion: z.literal(2),
  phase: z.literal("predecessor-prepared-capture"),
  boundary: z.literal("before-runtime-migration-0016"),
  cutoverRunId: uuidSchema,
  policy: z.object({
    id: z.literal(policy.policyId),
    sha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
    reason: z.literal(policy.reason),
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
  snapshotPlanSha256: sha256Schema,
  authorization: preparedAuthorizationSchema,
  captureStartedAt: canonicalTimestampSchema,
  captureCompletedAt: canonicalTimestampSchema,
  plannedExactReservedAt: canonicalTimestampSchema,
  plannedReportCreatedAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  operationId: z.string().regex(operationIdPattern),
  usage: d1UsageSchema,
  maximumReservation: maximumLedgerResultSchema,
  privacy: z.literal("hmac-sha256-no-raw-identifiers"),
  captureSha256: sha256Schema,
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    "Prepared predecessor rows read exceed the snapshot bound.",
  ),
  rowsWritten: z.literal(0),
  resultSetCount: z.literal(HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT),
  maximumAutomaticReadAttempts: z.literal(
    HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
  ),
  capture: snapshotCaptureSchema,
}).strict();

const predecessorReportSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_KIND),
  schemaVersion: z.literal(2),
  phase: z.literal("predecessor"),
  boundary: z.literal("before-runtime-migration-0016"),
  cutoverRunId: uuidSchema,
  policy: z.object({
    id: z.literal(policy.policyId),
    sha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
    reason: z.literal(policy.reason),
  }).strict(),
  lostKeyBoundary: z.object({
    status: z.literal(policy.legacyInterval.status),
    predecessorHmacKeyAvailable: z.literal(false),
    legacyIntervalContinuityProven: z.literal(false),
    retroactiveContinuityClaimed: z.literal(false),
    scope: z.literal("fresh-boundary-forward-only"),
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
  snapshotPlanSha256: sha256Schema,
  captureStartedAt: canonicalTimestampSchema,
  captureCompletedAt: canonicalTimestampSchema,
  createdAt: canonicalTimestampSchema,
  finalizedAt: canonicalTimestampSchema,
  utcDay: utcDaySchema,
  operationId: z.string().regex(operationIdPattern),
  rowsRead: safePositiveIntegerSchema.refine(
    (value) => value <= HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    "Predecessor rows read exceed the snapshot bound.",
  ),
  rowsWritten: z.literal(0),
  usage: d1UsageSchema,
  ledger: ledgerResultSchema,
  limits: z.object({
    protectedDatasetCount: z.literal(HISTORICAL_PROTECTED_DATASET_COUNT),
    coreRows: z.literal(HISTORICAL_CORE_ROW_LIMIT),
    supplementalRows: z.literal(HISTORICAL_SUPPLEMENTAL_ROW_LIMIT),
    schemaColumnsPerTable: z.literal(HISTORICAL_SCHEMA_COLUMN_LIMIT),
    sentinelsPerDataset: z.literal(HISTORICAL_SENTINEL_LIMIT),
    logicalSnapshotRowsRead: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    ),
    logicalRowsReadLimit: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
    ),
    maximumAutomaticReadAttempts: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
    ),
    billableRowsReadReservation: z.literal(
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    ),
  }).strict(),
  privacy: z.literal("hmac-sha256-no-raw-identifiers"),
  datasets: z.record(z.enum(HISTORICAL_DATASET_NAMES), datasetEvidenceSchema),
  supplementalDatasets: z.record(
    z.enum(HISTORICAL_SUPPLEMENTAL_DATASET_NAMES),
    datasetEvidenceSchema,
  ),
}).strict();

export type HistoricalFresh0016PredecessorReport = z.infer<
  typeof predecessorReportSchema
>;

export type HistoricalFresh0016PredecessorPaths = Readonly<{
  backupDirectory: string;
  runDirectory: string;
  reportPath: string;
}>;

export type HistoricalFresh0016PredecessorArtifact = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  report: HistoricalFresh0016PredecessorReport;
}>;

export type HistoricalFresh0016PredecessorPrivacyOptions = Readonly<{
  forbiddenPlaintext?: readonly string[];
}>;

export type HistoricalFresh0016PredecessorPreparedCapture = z.infer<
  typeof preparedCaptureSchema
>;
export type HistoricalFresh0016PredecessorAuthorizationContext = z.infer<
  typeof authorizationContextSchema
>;
export type HistoricalFresh0016PredecessorAuthorizationReceipt = z.infer<
  typeof authorizationReceiptSchema
>;

export type CaptureHistoricalFresh0016PredecessorReportOptions = Readonly<{
  cutoverRunId: string;
  backupDirectory: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  captureLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
  liveDeploymentStatusOutput: string;
  hmacSecret: string;
  usage: D1DailyUsage;
  maximumReservation: D1ReleaseBudgetReservationResult;
  authorizeLastPreD1: (
    context: HistoricalFresh0016PredecessorAuthorizationContext,
  ) => HistoricalFresh0016PredecessorAuthorizationReceipt;
  persistPreparedCapture: (
    prepared: HistoricalFresh0016PredecessorPreparedCapture,
  ) => void;
  observeFinalizationTopology: () => Readonly<{
    evidence: HistoricalFresh0016LiveTopologyEvidence;
    statusOutput: string;
  }>;
  forbiddenPlaintext: readonly string[];
  runner?: WranglerRunner;
  clock?: () => Date;
}>;

export type FinalizeHistoricalFresh0016PredecessorPreparedCaptureOptions =
  Readonly<{
    preparedCapture: unknown;
    sourceFingerprint: D1ReleaseSourceIdentity;
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
    finalizationLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
    liveDeploymentStatusOutput: string;
    hmacSecret: string;
    forbiddenPlaintext: readonly string[];
    clock?: () => Date;
  }>;

type HistoricalFresh0016PredecessorDirectoryIdentity = Readonly<{
  backupDirectory: Readonly<{ device: number; inode: number }>;
  policyRoot: Readonly<{ device: number; inode: number }>;
  runDirectory: Readonly<{ device: number; inode: number }>;
}>;

export type BuildHistoricalFresh0016PredecessorReportOptions = Readonly<{
  capture: HistoricalPre0016SnapshotCapture;
  cutoverRunId: string;
  backupDirectory: string;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  captureLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
  finalizationLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
  captureStartedAt: Date;
  captureCompletedAt: Date;
  createdAt: Date;
  finalizedAt: Date;
  usage: D1DailyUsage;
  ledger: D1ReleaseBudgetReservationResult;
  forbiddenPlaintext: readonly string[];
}>;

export function historicalFresh0016PredecessorPaths(
  backupDirectory: string,
  cutoverRunId: string,
): HistoricalFresh0016PredecessorPaths {
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
    throw new Error("Fresh 0016 predecessor policy root is unsafe.");
  }
  const policyRoot = path.resolve(backup, ...rootSegments);
  assertContainedPath(backup, policyRoot, "policy root");
  const runDirectory = path.resolve(policyRoot, runId);
  assertDirectDescendant(policyRoot, runDirectory, "run directory");
  const reportPath = path.resolve(
    runDirectory,
    HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME,
  );
  assertDirectDescendant(runDirectory, reportPath, "predecessor report");
  return Object.freeze({
    backupDirectory: backup,
    runDirectory,
    reportPath,
  });
}

export function historicalFresh0016PredecessorOperationId(input: Readonly<{
  cutoverRunId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  captureLiveTopology: HistoricalFresh0016LiveTopologyEvidence;
  hmacKeyId: string;
  snapshotPlanSha256: string;
}>) {
  const workerRelease = parseUploadedInactiveWorkerRelease(input);
  const captureLiveTopology = historicalFresh0016LiveTopologyEvidenceSchema.parse(
    input.captureLiveTopology,
  );
  if (
    stableStringify(captureLiveTopology.workerRelease) !==
      stableStringify(workerRelease)
  ) {
    throw new Error(
      "Fresh 0016 predecessor operation topology drifted from its Worker release.",
    );
  }
  const material = {
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_KIND,
    schemaVersion: 2,
    policyId: policy.policyId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    cutoverRunId: requireUuid(input.cutoverRunId, "cutover run ID"),
    sourceFingerprint: validateSourceIdentity(input.sourceFingerprint),
    workerRelease,
    captureLiveTopology,
    hmacKeyId: requireSha256(input.hmacKeyId, "HMAC key ID"),
    snapshotPlanSha256: requireSha256(
      input.snapshotPlanSha256,
      "snapshot plan SHA-256",
    ),
  } as const;
  const binding = createHash("sha256")
    .update(stableStringify(material))
    .digest("hex");
  return `historical-fresh-0016-predecessor:${binding}`;
}

export function parseHistoricalFresh0016PredecessorPreparedCapture(
  value: unknown,
  privacy: HistoricalFresh0016PredecessorPrivacyOptions = {},
): HistoricalFresh0016PredecessorPreparedCapture {
  assertNoForbiddenPlaintext(value, privacy.forbiddenPlaintext ?? []);
  const prepared = preparedCaptureSchema.parse(value);
  validatePreparedCaptureInvariants(prepared);
  assertNoForbiddenPlaintext(prepared, privacy.forbiddenPlaintext ?? []);
  deepFreeze(prepared);
  return prepared;
}

export function historicalFresh0016PredecessorPreparedCaptureSha256(
  value: unknown,
  privacy: HistoricalFresh0016PredecessorPrivacyOptions = {},
) {
  const prepared = parseHistoricalFresh0016PredecessorPreparedCapture(
    value,
    privacy,
  );
  return createHash("sha256")
    .update(stableStringify(prepared))
    .digest("hex");
}

export function captureHistoricalFresh0016PredecessorReport(
  options: CaptureHistoricalFresh0016PredecessorReportOptions,
): HistoricalFresh0016PredecessorReport {
  const cutoverRunId = requireUuid(options.cutoverRunId, "cutover run ID");
  const sourceFingerprint = validateSourceIdentity(options.sourceFingerprint);
  const workerRelease = requireUploadedInactiveWorkerRelease({
    backupDirectory: options.backupDirectory,
    sourceFingerprint,
    targetCandidateVersionId: options.targetCandidateVersionId,
    serviceBaselineVersionId: options.serviceBaselineVersionId,
    uploadEvidenceSha256: options.uploadEvidenceSha256,
  });
  const hmacSecret = requireHistoricalHmacSecret(options.hmacSecret);
  const forbiddenPlaintext = Object.freeze([
    hmacSecret,
    ...options.forbiddenPlaintext,
  ]);
  const hmacKeyId = historicalDataHmacKeyId(hmacSecret);
  const plan = createHistoricalPre0016SnapshotPlan(sourceFingerprint);
  const paths = historicalFresh0016PredecessorPaths(
    options.backupDirectory,
    cutoverRunId,
  );
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
  const operationId = historicalFresh0016PredecessorOperationId({
    cutoverRunId,
    sourceFingerprint,
    ...workerRelease,
    captureLiveTopology,
    hmacKeyId,
    snapshotPlanSha256: plan.planSha256,
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
    sourceFingerprint,
    usage,
    captureStartedAt,
  });
  const authorizationContext = authorizationContextSchema.parse({
    phase: "predecessor",
    d1ExecutionMayStart: true,
    cutoverRunId,
    operationId,
    sourceFingerprint,
    workerRelease,
    captureLiveTopology,
    hmacKeyId,
    snapshotPlanSha256: plan.planSha256,
    utcDay,
    maximumReservationRevision: maximumReservation.revision,
    maximumRowsRead:
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    maximumRowsWritten: 0,
  });
  deepFreeze(authorizationContext);
  if (typeof options.authorizeLastPreD1 !== "function") {
    throw new Error(
      "Fresh 0016 predecessor requires one synchronous last-pre-D1 authorization callback.",
    );
  }
  if (typeof options.persistPreparedCapture !== "function") {
    throw new Error(
      "Fresh 0016 predecessor requires a synchronous prepared-capture persistence callback before exact refinement.",
    );
  }
  if (typeof options.observeFinalizationTopology !== "function") {
    throw new Error(
      "Fresh 0016 predecessor requires a fresh synchronous finalization-topology observation.",
    );
  }
  const authorizationState: {
    calls: number;
    receipt?: HistoricalFresh0016PredecessorAuthorizationReceipt;
  } = { calls: 0 };
  const capture = captureHistoricalPre0016Snapshot({
    sourceIdentity: sourceFingerprint,
    hmacSecret,
    runner: options.runner
      ? createHistoricalDataWranglerRunner(options.runner)
      : undefined,
    authorizeLastPreD1: () => {
      authorizationState.calls += 1;
      const result = options.authorizeLastPreD1(authorizationContext);
      if (isThenable(result)) {
        throw new Error(
          "Fresh 0016 predecessor authorization receipt must be synchronous and cannot be a Promise or thenable.",
        );
      }
      authorizationState.receipt = authorizationReceiptSchema.parse(result);
      deepFreeze(authorizationState.receipt);
    },
  });
  if (authorizationState.calls !== 1 || !authorizationState.receipt) {
    throw new Error(
      "Fresh 0016 predecessor did not receive one exact last-pre-D1 authorization-stage receipt.",
    );
  }
  validateSnapshotCapture(capture);
  if (
    capture.hmacKeyId !== hmacKeyId ||
    stableStringify(capture.plan) !== stableStringify(plan)
  ) {
    throw new Error(
      "Fresh 0016 predecessor capture lost its exact HMAC or source-bound plan.",
    );
  }
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
  const preparedCapture = parseHistoricalFresh0016PredecessorPreparedCapture({
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_CAPTURE_KIND,
    schemaVersion: 2,
    phase: "predecessor-prepared-capture",
    boundary: "before-runtime-migration-0016",
    cutoverRunId,
    policy: {
      id: policy.policyId,
      sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      reason: policy.reason,
    },
    paths,
    database: { ...policy.database },
    sourceFingerprint,
    workerRelease,
    captureLiveTopology,
    hmacKeyId,
    snapshotPlanSha256: plan.planSha256,
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
    operationId,
    usage,
    maximumReservation: cloneLedgerResult(maximumReservation),
    privacy: "hmac-sha256-no-raw-identifiers",
    captureSha256: canonicalJsonSha256(capture),
    rowsRead: capture.rowsRead,
    rowsWritten: 0,
    resultSetCount: HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
    maximumAutomaticReadAttempts:
      HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
    capture: cloneSnapshotCapture(capture),
  }, {
    forbiddenPlaintext,
  });
  const persisted = options.persistPreparedCapture(preparedCapture);
  if (persisted !== undefined) {
    throw new Error(
      "Fresh 0016 predecessor prepared-capture persistence must complete synchronously without a return value.",
    );
  }
  const finalizationObservation = options.observeFinalizationTopology();
  if (isThenable(finalizationObservation)) {
    throw new Error(
      "Fresh 0016 predecessor finalization-topology observation cannot be a Promise or thenable.",
    );
  }
  return finalizeHistoricalFresh0016PredecessorPreparedCapture({
    preparedCapture,
    sourceFingerprint,
    ...workerRelease,
    finalizationLiveTopology: finalizationObservation.evidence,
    liveDeploymentStatusOutput: finalizationObservation.statusOutput,
    hmacSecret,
    forbiddenPlaintext,
    clock,
  });
}

export function finalizeHistoricalFresh0016PredecessorPreparedCapture(
  options: FinalizeHistoricalFresh0016PredecessorPreparedCaptureOptions,
): HistoricalFresh0016PredecessorReport {
  const hmacSecret = requireHistoricalHmacSecret(options.hmacSecret);
  const forbiddenPlaintext = Object.freeze([
    hmacSecret,
    ...options.forbiddenPlaintext,
  ]);
  const prepared = parseHistoricalFresh0016PredecessorPreparedCapture(
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
    stableStringify(prepared.workerRelease) !==
      stableStringify(workerRelease) ||
    prepared.hmacKeyId !== historicalDataHmacKeyId(hmacSecret)
  ) {
    throw new Error(
      "Fresh 0016 predecessor prepared capture does not match the live source, Worker, or HMAC key.",
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
      "Fresh 0016 predecessor finalization requires a newly observed live topology after capture admission.",
    );
  }
  assertMonotonicDate(
    new Date(prepared.plannedReportCreatedAt),
    finalizedAt,
    "prepared-capture finalization",
  );
  assertD1ReleaseBudgetUtcDay(prepared.utcDay, finalizedAt);
  assertPreparedLedgerIsLive(prepared, finalizedAt);
  const exactResult = liveExactLedgerResultSchema.parse(
    reserveD1ReleaseBudget({
      backupDir: prepared.paths.backupDirectory,
      operationId: prepared.operationId,
      operation: HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
      sourceFingerprint,
      candidateVersionId: workerRelease.targetCandidateVersionId,
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
      phase: "exact",
      rowsRead: prepared.capture.rowsRead,
      rowsWritten: 0,
      now: finalizedAt,
    }),
  );
  if (!sameLedgerResultIgnoringIdempotence(exactResult, liveExact)) {
    throw new Error(
      "Fresh 0016 predecessor exact ledger changed during prepared-capture finalization.",
    );
  }
  validateExactLedgerTransition(prepared, exactResult);
  const exactReservation = ledgerResultSchema.parse({
    ...cloneLedgerResult(exactResult),
    idempotent: false,
  });
  return buildHistoricalFresh0016PredecessorReport({
    capture: preparedSnapshotCapture(prepared.capture),
    cutoverRunId: prepared.cutoverRunId,
    backupDirectory: prepared.paths.backupDirectory,
    ...workerRelease,
    captureLiveTopology: prepared.captureLiveTopology,
    finalizationLiveTopology,
    captureStartedAt: new Date(prepared.captureStartedAt),
    captureCompletedAt: new Date(prepared.captureCompletedAt),
    createdAt: new Date(prepared.plannedReportCreatedAt),
    finalizedAt,
    usage: prepared.usage,
    ledger: exactReservation,
    forbiddenPlaintext,
  });
}

export function buildHistoricalFresh0016PredecessorReport(
  options: BuildHistoricalFresh0016PredecessorReportOptions,
): HistoricalFresh0016PredecessorReport {
  const cutoverRunId = requireUuid(options.cutoverRunId, "cutover run ID");
  const workerRelease = parseUploadedInactiveWorkerRelease(options);
  const captureStartedAt = canonicalDate(
    options.captureStartedAt,
    "capture start",
  );
  const captureCompletedAt = canonicalDate(
    options.captureCompletedAt,
    "capture completion",
  );
  const createdAt = canonicalDate(options.createdAt, "report creation");
  const finalizedAt = canonicalDate(options.finalizedAt, "report finalization");
  const captureLiveTopology = assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: options.captureLiveTopology,
    boundaryAt: captureStartedAt,
    ...workerRelease,
  });
  const finalizationLiveTopology =
    assertHistoricalFresh0016LiveTopologyEvidence({
      evidence: options.finalizationLiveTopology,
      boundaryAt: finalizedAt,
      ...workerRelease,
    });
  if (
    Date.parse(finalizationLiveTopology.observedAt) <=
    Date.parse(captureLiveTopology.observedAt)
  ) {
    throw new Error(
      "Fresh 0016 predecessor report requires capture and newer finalization topology observations.",
    );
  }
  const paths = historicalFresh0016PredecessorPaths(
    options.backupDirectory,
    cutoverRunId,
  );
  validateSnapshotCapture(options.capture);
  const operationId = historicalFresh0016PredecessorOperationId({
    cutoverRunId,
    sourceFingerprint: options.capture.plan.sourceIdentity,
    ...workerRelease,
    captureLiveTopology,
    hmacKeyId: options.capture.hmacKeyId,
    snapshotPlanSha256: options.capture.plan.planSha256,
  });
  const report = {
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_KIND,
    schemaVersion: 2,
    phase: "predecessor",
    boundary: "before-runtime-migration-0016",
    cutoverRunId,
    policy: {
      id: policy.policyId,
      sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      reason: policy.reason,
    },
    lostKeyBoundary: {
      status: policy.legacyInterval.status,
      predecessorHmacKeyAvailable: false,
      legacyIntervalContinuityProven: false,
      retroactiveContinuityClaimed: false,
      scope: "fresh-boundary-forward-only",
    },
    paths,
    database: { id: policy.database.id, name: policy.database.name },
    sourceFingerprint: { ...options.capture.plan.sourceIdentity },
    workerRelease,
    captureLiveTopology,
    finalizationLiveTopology,
    hmacKeyId: options.capture.hmacKeyId,
    snapshotPlanSha256: options.capture.plan.planSha256,
    captureStartedAt: captureStartedAt.toISOString(),
    captureCompletedAt: captureCompletedAt.toISOString(),
    createdAt: createdAt.toISOString(),
    finalizedAt: finalizedAt.toISOString(),
    utcDay: captureStartedAt.toISOString().slice(0, 10),
    operationId,
    rowsRead: options.capture.rowsRead,
    rowsWritten: 0,
    usage: { ...options.usage },
    ledger: cloneLedgerResult(options.ledger),
    limits: {
      protectedDatasetCount: HISTORICAL_PROTECTED_DATASET_COUNT,
      coreRows: HISTORICAL_CORE_ROW_LIMIT,
      supplementalRows: HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
      schemaColumnsPerTable: HISTORICAL_SCHEMA_COLUMN_LIMIT,
      sentinelsPerDataset: HISTORICAL_SENTINEL_LIMIT,
      logicalSnapshotRowsRead:
        HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
      logicalRowsReadLimit:
        HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
      maximumAutomaticReadAttempts:
        HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
      billableRowsReadReservation:
        HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    },
    privacy: "hmac-sha256-no-raw-identifiers",
    datasets: cloneDatasets(options.capture.datasets),
    supplementalDatasets: cloneSupplementalDatasets(
      options.capture.supplementalDatasets,
    ),
  };
  return parseHistoricalFresh0016PredecessorReport(report, {
    forbiddenPlaintext: options.forbiddenPlaintext,
  });
}

export function parseHistoricalFresh0016PredecessorReport(
  value: unknown,
  privacy: HistoricalFresh0016PredecessorPrivacyOptions = {},
): HistoricalFresh0016PredecessorReport {
  assertNoForbiddenPlaintext(value, privacy.forbiddenPlaintext ?? []);
  const parsed = predecessorReportSchema.parse(value);
  validateReportInvariants(parsed);
  assertNoForbiddenPlaintext(parsed, privacy.forbiddenPlaintext ?? []);
  deepFreeze(parsed);
  return parsed;
}

export function writeHistoricalFresh0016PredecessorReport(
  report: HistoricalFresh0016PredecessorReport,
  privacy: HistoricalFresh0016PredecessorPrivacyOptions = {},
): HistoricalFresh0016PredecessorArtifact {
  const parsed = parseHistoricalFresh0016PredecessorReport(report, privacy);
  requireUploadedInactiveWorkerRelease({
    backupDirectory: parsed.paths.backupDirectory,
    sourceFingerprint: parsed.sourceFingerprint,
    ...parsed.workerRelease,
  });
  assertLiveTopologyPostdatesUpload(
    parsed.paths.backupDirectory,
    parsed.captureLiveTopology,
  );
  assertLiveTopologyPostdatesUpload(
    parsed.paths.backupDirectory,
    parsed.finalizationLiveTopology,
  );
  const payload = serializeReport(parsed, privacy.forbiddenPlaintext ?? []);
  const reportPath = parsed.paths.reportPath;
  const directoryIdentity = assertPrivatePathHierarchy(parsed.paths);
  if (path.dirname(reportPath) !== parsed.paths.runDirectory) {
    throw new Error(
      "Fresh 0016 predecessor report path is outside its exact run directory.",
    );
  }
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      reportPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error(
      "Fresh 0016 predecessor report must be created once at its absent reserved path.",
    );
  }
  let writeFailure: unknown;
  try {
    fs.fchmodSync(descriptor, 0o600);
    const before = fs.fstatSync(descriptor);
    assertPrivateReportStat(before, 0, "new predecessor report");
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateReportStat(
      after,
      payload.byteLength,
      "written predecessor report",
    );
    if (!sameFileIdentity(fileIdentity(before), fileIdentity(after))) {
      throw new Error(
        "Fresh 0016 predecessor report inode changed during its exclusive write.",
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
  if (writeFailure !== undefined) {
    throw writeFailure;
  }
  fsyncPrivateDirectory(
    parsed.paths.runDirectory,
    directoryIdentity.runDirectory,
  );
  assertSamePathHierarchy(parsed.paths, directoryIdentity);
  return readHistoricalFresh0016PredecessorReport({
    backupDirectory: parsed.paths.backupDirectory,
    cutoverRunId: parsed.cutoverRunId,
    forbiddenPlaintext: privacy.forbiddenPlaintext,
  });
}

export function readHistoricalFresh0016PredecessorReport(options: Readonly<{
  backupDirectory: string;
  cutoverRunId: string;
  forbiddenPlaintext?: readonly string[];
}>): HistoricalFresh0016PredecessorArtifact {
  const paths = historicalFresh0016PredecessorPaths(
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
      "Fresh 0016 predecessor report must be a real immutable owner-only file.",
    );
  }
  let bytes: Buffer;
  let after: fs.Stats;
  try {
    const before = fs.fstatSync(descriptor);
    assertPrivateReportStat(before, undefined, "stored predecessor report");
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
    assertPrivateReportStat(
      after,
      bytes.byteLength,
      "read predecessor report",
    );
    if (
      !sameIdentity(before, after) ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(
        "Fresh 0016 predecessor report changed while it was being read.",
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const named = safeLstat(paths.reportPath);
  assertPrivateReportStat(named, bytes.byteLength, "named predecessor report");
  if (
    !sameFileIdentity(fileIdentity(named), fileIdentity(after)) ||
    named.mtimeMs !== after.mtimeMs ||
    named.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(
      "Fresh 0016 predecessor report path changed during exact readback.",
    );
  }
  assertSamePathHierarchy(paths, directoryIdentity);
  if (bytes.byteLength > HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES) {
    throw new Error("Fresh 0016 predecessor report exceeds its byte limit.");
  }
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) {
    throw new Error(
      "Fresh 0016 predecessor report lacks its canonical final newline.",
    );
  }
  assertNoForbiddenPlaintext(text, options.forbiddenPlaintext ?? []);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Fresh 0016 predecessor report is not valid JSON.");
  }
  const report = parseHistoricalFresh0016PredecessorReport(value, {
    forbiddenPlaintext: options.forbiddenPlaintext,
  });
  requireUploadedInactiveWorkerRelease({
    backupDirectory: report.paths.backupDirectory,
    sourceFingerprint: report.sourceFingerprint,
    ...report.workerRelease,
  });
  assertLiveTopologyPostdatesUpload(
    report.paths.backupDirectory,
    report.captureLiveTopology,
  );
  assertLiveTopologyPostdatesUpload(
    report.paths.backupDirectory,
    report.finalizationLiveTopology,
  );
  const canonicalBytes = serializeReport(
    report,
    options.forbiddenPlaintext ?? [],
  );
  if (!bytes.equals(canonicalBytes)) {
    throw new Error(
      "Fresh 0016 predecessor report bytes are not canonical.",
    );
  }
  if (
    report.cutoverRunId !== requireUuid(options.cutoverRunId, "cutover run ID") ||
    report.paths.backupDirectory !== paths.backupDirectory ||
    report.paths.runDirectory !== paths.runDirectory ||
    report.paths.reportPath !== paths.reportPath
  ) {
    throw new Error(
      "Fresh 0016 predecessor report does not match its requested run path.",
    );
  }
  return Object.freeze({
    path: paths.reportPath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    report,
  });
}

function validateMaximumReservation(input: Readonly<{
  maximumReservation: z.infer<typeof maximumLedgerResultSchema>;
  paths: HistoricalFresh0016PredecessorPaths;
  utcDay: string;
  operationId: string;
  targetCandidateVersionId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  usage: D1DailyUsage;
  captureStartedAt: Date;
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
    Date.parse(maximum.reservation.updatedAt) >
      input.captureStartedAt.getTime()
  ) {
    throw new Error(
      "Fresh 0016 predecessor maximum ledger evidence is not the exact pre-D1 reservation.",
    );
  }
  validateLedgerUsage(maximum, input.usage, "maximum");
  assertD1ReleaseBudgetUtcDay(input.utcDay, input.captureStartedAt);
  const liveMaximum = maximumLedgerResultSchema.parse(
    assertD1ReleaseBudgetReservation({
      ledgerPath: maximum.ledgerPath,
      utcDay: input.utcDay,
      operationId: input.operationId,
      sourceFingerprint: input.sourceFingerprint,
      candidateVersionId: input.targetCandidateVersionId,
      phase: "maximum",
      rowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      rowsWritten: 0,
      now: input.captureStartedAt,
    }),
  );
  if (!sameLedgerResultIgnoringIdempotence(maximum, liveMaximum)) {
    throw new Error(
      "Fresh 0016 predecessor maximum ledger evidence does not match the exact live pre-D1 reservation.",
    );
  }
}

function validatePreparedCaptureInvariants(
  prepared: HistoricalFresh0016PredecessorPreparedCapture,
) {
  const expectedPaths = historicalFresh0016PredecessorPaths(
    prepared.paths.backupDirectory,
    prepared.cutoverRunId,
  );
  const expectedPlan = createHistoricalPre0016SnapshotPlan(
    prepared.sourceFingerprint,
  );
  const expectedOperationId = historicalFresh0016PredecessorOperationId({
    cutoverRunId: prepared.cutoverRunId,
    sourceFingerprint: prepared.sourceFingerprint,
    ...prepared.workerRelease,
    captureLiveTopology: prepared.captureLiveTopology,
    hmacKeyId: prepared.hmacKeyId,
    snapshotPlanSha256: prepared.snapshotPlanSha256,
  });
  const expectedAuthorization = preparedAuthorizationSchema.parse({
    phase: "predecessor",
    d1ExecutionMayStart: true,
    cutoverRunId: prepared.cutoverRunId,
    operationId: prepared.operationId,
    sourceFingerprint: prepared.sourceFingerprint,
    workerRelease: prepared.workerRelease,
    captureLiveTopology: prepared.captureLiveTopology,
    hmacKeyId: prepared.hmacKeyId,
    snapshotPlanSha256: prepared.snapshotPlanSha256,
    utcDay: prepared.utcDay,
    maximumReservationRevision: prepared.maximumReservation.revision,
    maximumRowsRead:
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    maximumRowsWritten: 0,
    authorizationStageSha256:
      prepared.authorization.authorizationStageSha256,
  });
  const capture = preparedSnapshotCapture(prepared.capture);
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: prepared.captureLiveTopology,
    boundaryAt: new Date(prepared.captureStartedAt),
    ...prepared.workerRelease,
  });
  if (
    prepared.paths.runDirectory !== expectedPaths.runDirectory ||
    prepared.paths.reportPath !== expectedPaths.reportPath ||
    prepared.snapshotPlanSha256 !== expectedPlan.planSha256 ||
    stableStringify(prepared.capture.plan) !== stableStringify(expectedPlan) ||
    stableStringify(capture.plan) !== stableStringify(expectedPlan) ||
    prepared.operationId !== expectedOperationId ||
    capture.hmacKeyId !== prepared.hmacKeyId ||
    stableStringify(prepared.authorization) !==
      stableStringify(expectedAuthorization) ||
    prepared.captureSha256 !== canonicalJsonSha256(prepared.capture) ||
    prepared.rowsRead !== capture.rowsRead ||
    prepared.rowsWritten !== capture.rowsWritten
  ) {
    throw new Error(
      "Fresh 0016 prepared predecessor lost its path, plan, source, Worker, HMAC, authorization, capture, or operation binding.",
    );
  }
  validateSnapshotCapture(capture);
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
      "Fresh 0016 prepared predecessor lost its exact maximum-ledger binding.",
    );
  }
  validateLedgerUsage(maximum, prepared.usage, "prepared maximum");
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
    maximumCreatedAt > maximumUpdatedAt ||
    maximumUpdatedAt > startedAt ||
    startedAt > completedAt ||
    completedAt > plannedExactAt ||
    plannedExactAt > plannedCreatedAt
  ) {
    throw new Error(
      "Fresh 0016 prepared predecessor timestamps are not monotonic within one UTC day.",
    );
  }
}

function assertPreparedLedgerIsLive(
  prepared: HistoricalFresh0016PredecessorPreparedCapture,
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
        phase: "maximum",
        rowsRead:
          HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
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
        "Fresh 0016 prepared predecessor maximum ledger no longer matches live evidence.",
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
      "Fresh 0016 prepared predecessor has neither its exact live maximum nor exact ledger reservation.",
    );
  }
}

function validateExactLedgerTransition(
  prepared: HistoricalFresh0016PredecessorPreparedCapture,
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
    maximum.totals.rowsRead < exact.totals.rowsRead ||
    maximum.totals.rowsRead - exact.totals.rowsRead !==
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION -
        prepared.capture.rowsRead ||
    maximum.totals.rowsWritten !== exact.totals.rowsWritten
  ) {
    throw new Error(
      "Fresh 0016 prepared predecessor does not prove its exact maximum-to-actual ledger refinement.",
    );
  }
  validateLedgerUsage(exact, prepared.usage, "prepared exact");
}

function validateLedgerUsage(
  ledger:
    | z.infer<typeof maximumLedgerResultSchema>
    | z.infer<typeof liveExactLedgerResultSchema>,
  usage: D1DailyUsage,
  label: string,
) {
  if (
    ledger.accountedUsage.rowsRead <
      safeAdd(usage.rowsRead, ledger.totals.rowsRead, `${label} rows read`) ||
    ledger.accountedUsage.rowsWritten <
      safeAdd(
        usage.rowsWritten,
        ledger.totals.rowsWritten,
        `${label} rows written`,
      ) ||
    ledger.accountedUsage.rowsRead > D1_FREE_SAFE_ROWS_READ_LIMIT ||
    ledger.accountedUsage.rowsWritten > D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
  ) {
    throw new Error(
      `Fresh 0016 predecessor ${label} ledger does not cover exact usage within safe daily limits.`,
    );
  }
}

function sameLedgerResultIgnoringIdempotence(
  left: D1ReleaseBudgetReservationResult,
  right: D1ReleaseBudgetReservationResult,
) {
  return stableStringify({ ...left, idempotent: false }) ===
    stableStringify({ ...right, idempotent: false });
}

function cloneSnapshotCapture(
  capture: HistoricalPre0016SnapshotCapture,
): HistoricalPre0016SnapshotCapture {
  return {
    plan: createHistoricalPre0016SnapshotPlan(capture.plan.sourceIdentity),
    rowsRead: capture.rowsRead,
    rowsWritten: 0,
    hmacKeyId: capture.hmacKeyId,
    datasets: cloneDatasets(capture.datasets),
    supplementalDatasets: cloneSupplementalDatasets(
      capture.supplementalDatasets,
    ),
  };
}

function preparedSnapshotCapture(
  capture: z.infer<typeof snapshotCaptureSchema>,
): HistoricalPre0016SnapshotCapture {
  const result: HistoricalPre0016SnapshotCapture = {
    plan: createHistoricalPre0016SnapshotPlan(capture.plan.sourceIdentity),
    rowsRead: capture.rowsRead,
    rowsWritten: 0,
    hmacKeyId: capture.hmacKeyId,
    datasets: cloneDatasets(capture.datasets),
    supplementalDatasets: cloneSupplementalDatasets(
      capture.supplementalDatasets,
    ),
  };
  deepFreeze(result);
  return result;
}

function validateSnapshotCapture(capture: HistoricalPre0016SnapshotCapture) {
  const expectedPlan = createHistoricalPre0016SnapshotPlan(
    capture.plan.sourceIdentity,
  );
  if (
    stableStringify(capture.plan) !== stableStringify(expectedPlan) ||
    capture.rowsWritten !== 0 ||
    !Number.isSafeInteger(capture.rowsRead) ||
    capture.rowsRead <= 0 ||
    capture.rowsRead > HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ ||
    !sha256Pattern.test(capture.hmacKeyId)
  ) {
    throw new Error(
      "Fresh 0016 predecessor capture is not bound to the exact protected snapshot plan.",
    );
  }
  validateHistoricalProtectedDatasetEvidence(
    capture.datasets,
    capture.supplementalDatasets,
  );
}

function validateReportInvariants(report: HistoricalFresh0016PredecessorReport) {
  const expectedPaths = historicalFresh0016PredecessorPaths(
    report.paths.backupDirectory,
    report.cutoverRunId,
  );
  if (
    report.paths.runDirectory !== expectedPaths.runDirectory ||
    report.paths.reportPath !== expectedPaths.reportPath
  ) {
    throw new Error(
      "Fresh 0016 predecessor report paths do not match its exact run identity.",
    );
  }
  const expectedPlan = createHistoricalPre0016SnapshotPlan(
    report.sourceFingerprint,
  );
  if (report.snapshotPlanSha256 !== expectedPlan.planSha256) {
    throw new Error(
      "Fresh 0016 predecessor report has the wrong source-bound snapshot plan.",
    );
  }
  const expectedOperationId = historicalFresh0016PredecessorOperationId({
    cutoverRunId: report.cutoverRunId,
    sourceFingerprint: report.sourceFingerprint,
    ...report.workerRelease,
    captureLiveTopology: report.captureLiveTopology,
    hmacKeyId: report.hmacKeyId,
    snapshotPlanSha256: report.snapshotPlanSha256,
  });
  if (
    report.operationId !== expectedOperationId ||
    report.ledger.reservation.operationId !== expectedOperationId ||
    report.ledger.reservation.candidateVersionId !==
      report.workerRelease.targetCandidateVersionId ||
    report.ledger.reservation.rowsRead !== report.rowsRead ||
    report.ledger.reservation.rowsWritten !== report.rowsWritten
  ) {
    throw new Error(
      "Fresh 0016 predecessor report is not bound to its exact source operation and Worker version.",
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
      "Fresh 0016 predecessor report lacks a newer finalization topology observation.",
    );
  }
  const expectedLedgerPath = path.join(
    report.paths.backupDirectory,
    "cloudflare",
    `d1-release-budget-ledger-${report.utcDay}.json`,
  );
  if (
    report.ledger.ledgerPath !== expectedLedgerPath ||
    report.ledger.utcDay !== report.utcDay
  ) {
    throw new Error(
      "Fresh 0016 predecessor report points to the wrong UTC-day ledger.",
    );
  }
  const startedAt = Date.parse(report.captureStartedAt);
  const completedAt = Date.parse(report.captureCompletedAt);
  const createdAt = Date.parse(report.createdAt);
  const finalizedAt = Date.parse(report.finalizedAt);
  const reservationCreatedAt = Date.parse(
    report.ledger.reservation.createdAt,
  );
  const reservationUpdatedAt = Date.parse(
    report.ledger.reservation.updatedAt,
  );
  if (
    report.captureStartedAt.slice(0, 10) !== report.utcDay ||
    report.captureCompletedAt.slice(0, 10) !== report.utcDay ||
    report.createdAt.slice(0, 10) !== report.utcDay ||
    report.finalizedAt.slice(0, 10) !== report.utcDay ||
    report.ledger.reservation.createdAt.slice(0, 10) !== report.utcDay ||
    report.ledger.reservation.updatedAt.slice(0, 10) !== report.utcDay ||
    reservationCreatedAt > startedAt ||
    startedAt > completedAt ||
    completedAt > reservationUpdatedAt ||
    reservationUpdatedAt > createdAt ||
    createdAt > finalizedAt
  ) {
    throw new Error(
      "Fresh 0016 predecessor timestamps are not monotonic within one UTC day.",
    );
  }
  if (
    report.ledger.totals.rowsRead < report.rowsRead ||
    report.ledger.totals.rowsWritten < report.rowsWritten ||
    report.ledger.accountedUsage.rowsRead <
      safeAdd(
        report.usage.rowsRead,
        report.ledger.totals.rowsRead,
        "accounted rows read",
      ) ||
    report.ledger.accountedUsage.rowsWritten <
      safeAdd(
        report.usage.rowsWritten,
        report.ledger.totals.rowsWritten,
        "accounted rows written",
      ) ||
    report.ledger.accountedUsage.rowsRead > D1_FREE_SAFE_ROWS_READ_LIMIT ||
    report.ledger.accountedUsage.rowsWritten >
      D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
  ) {
    throw new Error(
      "Fresh 0016 predecessor ledger does not exactly cover D1 usage within the safe daily limits.",
    );
  }
  if (
    report.limits.protectedDatasetCount !==
      HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES.length ||
    report.lostKeyBoundary.predecessorHmacKeyAvailable !== false ||
    report.lostKeyBoundary.legacyIntervalContinuityProven !== false ||
    report.lostKeyBoundary.retroactiveContinuityClaimed !== false
  ) {
    throw new Error(
      "Fresh 0016 predecessor report cannot claim lost-key legacy continuity.",
    );
  }
  validateHistoricalProtectedDatasetEvidence(
    report.datasets,
    report.supplementalDatasets,
  );
}

function serializeReport(
  report: HistoricalFresh0016PredecessorReport,
  forbiddenPlaintext: readonly string[],
) {
  const payload = Buffer.from(`${stableStringify(report)}\n`, "utf8");
  if (
    payload.byteLength <= 0 ||
    payload.byteLength > HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES
  ) {
    throw new Error("Fresh 0016 predecessor report exceeds its byte limit.");
  }
  assertNoForbiddenPlaintext(payload.toString("utf8"), forbiddenPlaintext);
  return payload;
}

function cloneLedgerResult(
  ledger: D1ReleaseBudgetReservationResult,
): D1ReleaseBudgetReservationResult {
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

function cloneDatasets(
  datasets: Readonly<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
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
  datasets: Readonly<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
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

function cloneDatasetEvidence(
  dataset: HistoricalDatasetEvidence,
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

function assertCompleteDatasets(
  datasets: Partial<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
): asserts datasets is Record<HistoricalDatasetName, HistoricalDatasetEvidence> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!datasets[name]) {
      throw new Error(`Fresh 0016 predecessor evidence omitted ${name}.`);
    }
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
    if (!datasets[name]) {
      throw new Error(`Fresh 0016 predecessor evidence omitted ${name}.`);
    }
  }
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
          "Fresh 0016 predecessor evidence contains forbidden raw identity or secret plaintext.",
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
        "Fresh 0016 predecessor privacy substrings must be bounded printable values of at least eight characters.",
      );
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
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
      `Fresh 0016 predecessor ${label} must be a real owner-only mode-0700 directory.`,
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
        `Fresh 0016 predecessor ${label} must be a real owner-only mode-0700 directory.`,
      );
    }
    return fileIdentity(stat);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertPrivatePathHierarchy(
  paths: HistoricalFresh0016PredecessorPaths,
): HistoricalFresh0016PredecessorDirectoryIdentity {
  const policyRoot = path.dirname(paths.runDirectory);
  assertContainedPath(paths.backupDirectory, policyRoot, "policy root");
  assertDirectDescendant(policyRoot, paths.runDirectory, "run directory");
  assertDirectDescendant(
    paths.runDirectory,
    paths.reportPath,
    "predecessor report",
  );
  const identities = Object.freeze({
    backupDirectory: assertPrivateDirectory(
      paths.backupDirectory,
      "backup directory",
    ),
    policyRoot: assertPrivateDirectory(policyRoot, "policy root"),
    runDirectory: assertPrivateDirectory(
      paths.runDirectory,
      "run directory",
    ),
  });
  if (
    safeRealpath(paths.backupDirectory, "backup directory") !==
      paths.backupDirectory ||
    safeRealpath(policyRoot, "policy root") !== policyRoot ||
    safeRealpath(paths.runDirectory, "run directory") !== paths.runDirectory
  ) {
    throw new Error(
      "Fresh 0016 predecessor directory hierarchy is linked or noncanonical.",
    );
  }
  assertSamePathHierarchy(paths, identities);
  return identities;
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
        "Fresh 0016 predecessor run directory changed before durable publication.",
      );
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameIdentity(before, after)) {
      throw new Error(
        "Fresh 0016 predecessor run directory changed during durable publication.",
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSameDirectoryIdentity(
  directory: string,
  expectedIdentity: Readonly<{ device: number; inode: number }>,
  label: string,
) {
  const actual = assertPrivateDirectory(directory, label);
  if (!sameFileIdentity(actual, expectedIdentity)) {
    throw new Error(
      `Fresh 0016 predecessor ${label} changed during report access.`,
    );
  }
}

function assertSamePathHierarchy(
  paths: HistoricalFresh0016PredecessorPaths,
  expected: HistoricalFresh0016PredecessorDirectoryIdentity,
) {
  const policyRoot = path.dirname(paths.runDirectory);
  assertSameDirectoryIdentity(
    paths.backupDirectory,
    expected.backupDirectory,
    "backup directory",
  );
  assertSameDirectoryIdentity(
    policyRoot,
    expected.policyRoot,
    "policy root",
  );
  assertSameDirectoryIdentity(
    paths.runDirectory,
    expected.runDirectory,
    "run directory",
  );
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
    stat.size > HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES ||
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
    throw new Error(
      "Fresh 0016 predecessor report path is missing or unsafe.",
    );
  }
}

function safeRealpath(directory: string, label: string) {
  try {
    return fs.realpathSync.native(directory);
  } catch {
    throw new Error(
      `Fresh 0016 predecessor ${label} cannot be resolved safely.`,
    );
  }
}

function fileIdentity(stat: fs.Stats) {
  return Object.freeze({ device: stat.dev, inode: stat.ino });
}

function sameIdentity(left: fs.Stats, right: fs.Stats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.nlink === right.nlink
  );
}

function sameFileIdentity(
  left: Readonly<{ device: number; inode: number }>,
  right: Readonly<{ device: number; inode: number }>,
) {
  return left.device === right.device && left.inode === right.inode;
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
      "Fresh 0016 predecessor requires the exact inactive upload evidence while the baseline remains the sole 100% serving Worker.",
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
      "Fresh 0016 predecessor live topology cannot predate the candidate upload evidence.",
    );
  }
}

function requireUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) {
    throw new Error(`Fresh 0016 predecessor ${label} must be an exact UUID.`);
  }
  return value;
}

function requireSha256(value: string, label: string) {
  if (!sha256Pattern.test(value)) {
    throw new Error(
      `Fresh 0016 predecessor ${label} must be an exact SHA-256.`,
    );
  }
  return value;
}

function requirePositiveSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Fresh 0016 predecessor ${label} must be a positive safe integer.`,
    );
  }
  return value;
}

function normalizeAbsolutePath(value: string, label: string) {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Fresh 0016 predecessor ${label} is unsafe.`);
  }
  return path.resolve(value);
}

function assertDirectDescendant(parent: string, child: string, label: string) {
  if (path.dirname(child) !== parent || child === parent) {
    throw new Error(
      `Fresh 0016 predecessor ${label} must be an exact direct descendant.`,
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
      `Fresh 0016 predecessor ${label} must stay inside its exact parent.`,
    );
  }
}

function canonicalDate(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`Fresh 0016 predecessor ${label} clock is invalid.`);
  }
  return new Date(value.getTime());
}

function readClock(clock: () => Date, label: string) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Fresh 0016 predecessor ${label} clock is invalid.`);
  }
  return new Date(value.getTime());
}

function assertMonotonicDate(before: Date, after: Date, label: string) {
  if (after.getTime() < before.getTime()) {
    throw new Error(
      `Fresh 0016 predecessor ${label} clock moved backwards.`,
    );
  }
}

function sameSource(
  left: D1ReleaseSourceIdentity,
  right: D1ReleaseSourceIdentity,
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function canonicalJsonSha256(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function safeAdd(left: number, right: number, label: string) {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0 ||
    left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw new Error(`Fresh 0016 predecessor ${label} overflowed.`);
  }
  return left + right;
}

function deepFreeze(value: unknown) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
  } else {
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  Object.freeze(value);
}
