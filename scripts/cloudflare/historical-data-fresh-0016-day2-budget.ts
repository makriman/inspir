import path from "node:path";
import { z } from "zod";
import {
  assertD1ReleaseBudgetReservation,
  D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
  D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE,
  readD1ReleaseBudgetLedger,
  readPrivateJsonNoFollow,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  type D1ReleaseBudgetAdmissionMode,
  type D1ReleaseBudgetReservationResult,
} from "./d1-release-budget-ledger";
import type { D1DailyUsage } from "./d1-free-budget";
import {
  assertHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
  HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
  HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_READ_LIMIT,
  HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_WRITTEN_LIMIT,
  historicalFresh0016LiveTopologyEvidenceSchema,
  type HistoricalFresh0016LiveTopologyEvidence,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  classifyHistoricalFresh0016State,
  historicalFresh0016JsonSha256,
  historicalFresh0016StatePaths,
  validateHistoricalFresh0016RunDirectory,
  type HistoricalFresh0016SourceFingerprint,
} from "./historical-data-fresh-0016-state";
import {
  historicalDataReportPath,
  parseHistoricalDataVerificationReport,
} from "./verify-historical-data-preservation";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

const HISTORICAL_FRESH_0016_DAY2_BUDGET_ENVELOPE_KIND =
  "inspir-historical-data-fresh-0016-day2-budget-envelope-v2" as const;
export const HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME =
  "Historical fresh-0016 Day-2 aggregate envelope" as const;
export const HISTORICAL_FRESH_0016_DAY2_BUDGET_MAXIMUM_BYTES =
  1024 * 1024;

const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const workerVersionSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);
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
const absolutePathSchema = z.string().min(1).max(4_096).refine(
  (value) => path.isAbsolute(value) && path.resolve(value) === value,
  "Expected a normalized absolute path.",
);
const sourceFingerprintSchema = z.object({
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
      message: "The Day-2 candidate must differ from the serving baseline.",
    });
  }
});
const usageSchema = z.object({
  databaseCount: positiveIntegerSchema,
  queryGroups: nonnegativeIntegerSchema,
  rowsRead: nonnegativeIntegerSchema,
  rowsWritten: nonnegativeIntegerSchema,
  executions: nonnegativeIntegerSchema,
  windowMinutes: positiveIntegerSchema.refine((value) => value <= 24 * 60),
}).strict();
const maximumLedgerSchema = z.object({
  ledgerPath: absolutePathSchema,
  utcDay: utcDaySchema,
  revision: positiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: z.object({
    operationId: z.string().regex(
      /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
    ),
    operation: z.literal(HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME),
    candidateVersionId: workerVersionSchema,
    phase: z.literal("maximum"),
    rowsRead: z.literal(HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ),
    rowsWritten: z.literal(
      HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
    ),
    maximumRowsRead: z.literal(
      HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
    ),
    maximumRowsWritten: z.literal(
      HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
    ),
    createdAt: canonicalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
  }).strict(),
  totals: z.object({
    rowsRead: nonnegativeIntegerSchema,
    rowsWritten: nonnegativeIntegerSchema,
  }).strict(),
  accountedUsage: z.object({
    rowsRead: nonnegativeIntegerSchema,
    rowsWritten: nonnegativeIntegerSchema,
  }).strict(),
}).strict();
const budgetAdmissionModeSchema = z.union([
  z.literal(D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE),
  z.literal(D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE),
]);

const historicalFresh0016Day2BudgetEnvelopeSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_DAY2_BUDGET_ENVELOPE_KIND),
  schemaVersion: z.literal(2),
  createdAt: canonicalTimestampSchema,
  cutoverRunId: uuidSchema,
  utcDay: utcDaySchema,
  operationId: z.string().regex(
    /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
  ),
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  predecessorCompleteStageSha256: sha256Schema,
  predecessorReportSha256: sha256Schema,
  sourceFingerprint: sourceFingerprintSchema,
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  liveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  database: z.object({
    id: z.literal(policy.database.id),
    name: z.literal(policy.database.name),
  }).strict(),
  admissionMode: budgetAdmissionModeSchema.default(
    D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE,
  ),
  initialObservedUsage: usageSchema,
  maximum: z.object({
    rowsRead: z.literal(HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ),
    rowsWritten: z.literal(
      HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
    ),
    ledger: maximumLedgerSchema,
  }).strict(),
  allocations: z.object({
    migrationProjectionRowsRead: z.literal(
      policy.day2Budget.allocations.migrationProjectionRowsRead,
    ),
    migrationApplyBillableRowsRead: z.literal(
      policy.day2Budget.allocations.migrationApplyBillableRowsRead,
    ),
    preservationBranchRowsRead: z.literal(
      policy.day2Budget.allocations.preservationBranchRowsRead,
    ),
    standaloneRuntimeVerificationBillableRowsRead: z.literal(
      policy.day2Budget.allocations
        .standaloneRuntimeVerificationBillableRowsRead,
    ),
    runtimeMigration0017VerificationBillableRowsRead: z.literal(
      policy.day2Budget.allocations
        .runtimeMigration0017VerificationBillableRowsRead,
    ),
    productionLockRowsRead: z.literal(
      policy.day2Budget.allocations.productionLockRowsRead,
    ),
    productionLockRowsWritten: z.literal(
      policy.day2Budget.allocations.productionLockRowsWritten,
    ),
    postdeployAuthorizationRowsRead: z.literal(
      policy.day2Budget.allocations.postdeployAuthorizationRowsRead,
    ),
    postdeployAuthorizationRowsWritten: z.literal(
      policy.day2Budget.allocations.postdeployAuthorizationRowsWritten,
    ),
  }).strict(),
  accounting: z.literal(policy.day2Budget.accounting),
  refinement: z.literal(policy.day2Budget.refinement),
  privacy: z.literal("counts-budget-and-release-identities-only"),
}).strict().superRefine((value, context) => {
  const expectedOperationId = historicalFresh0016Day2BudgetOperationId({
    cutoverRunId: value.cutoverRunId,
    utcDay: value.utcDay,
    predecessorCompleteStageSha256:
      value.predecessorCompleteStageSha256,
    predecessorReportSha256: value.predecessorReportSha256,
    sourceFingerprint: value.sourceFingerprint,
    ...value.workerRelease,
    liveTopology: value.liveTopology,
  });
  if (
    value.createdAt.slice(0, 10) !== value.utcDay ||
    value.operationId !== expectedOperationId ||
    value.maximum.ledger.utcDay !== value.utcDay ||
    value.maximum.ledger.reservation.operationId !== value.operationId ||
    value.maximum.ledger.reservation.candidateVersionId !==
      value.workerRelease.targetCandidateVersionId ||
    historicalFresh0016JsonSha256(value.liveTopology.workerRelease) !==
      historicalFresh0016JsonSha256(value.workerRelease) ||
    (value.admissionMode === D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE &&
      (value.initialObservedUsage.rowsRead >
        HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_READ_LIMIT ||
        value.initialObservedUsage.rowsWritten >
          HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_WRITTEN_LIMIT))
  ) {
    context.addIssue({
      code: "custom",
      message:
        "The Day-2 budget envelope identity, UTC day, release, or admission usage is inconsistent.",
    });
  }
});

export type HistoricalFresh0016Day2BudgetEnvelope = z.infer<
  typeof historicalFresh0016Day2BudgetEnvelopeSchema
>;

export type HistoricalFresh0016Day2BudgetEnvelopeHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  evidence: HistoricalFresh0016Day2BudgetEnvelope;
}>;

function historicalFresh0016Day2BudgetOperationId(input: Readonly<{
  cutoverRunId: string;
  utcDay: string;
  predecessorCompleteStageSha256: string;
  predecessorReportSha256: string;
  sourceFingerprint: HistoricalFresh0016SourceFingerprint;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  liveTopology: HistoricalFresh0016LiveTopologyEvidence;
}>) {
  const workerRelease = uploadedInactiveWorkerReleaseSchema.parse({
    phase: "uploaded-inactive",
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
  const liveTopology = historicalFresh0016LiveTopologyEvidenceSchema.parse(
    input.liveTopology,
  );
  const identity = z.object({
    kind: z.literal(HISTORICAL_FRESH_0016_DAY2_BUDGET_ENVELOPE_KIND),
    schemaVersion: z.literal(2),
    cutoverRunId: uuidSchema,
    utcDay: utcDaySchema,
    policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
    predecessorCompleteStageSha256: sha256Schema,
    predecessorReportSha256: sha256Schema,
    sourceFingerprint: sourceFingerprintSchema,
    workerRelease: uploadedInactiveWorkerReleaseSchema,
    liveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  }).strict().parse({
    kind: HISTORICAL_FRESH_0016_DAY2_BUDGET_ENVELOPE_KIND,
    schemaVersion: 2,
    cutoverRunId: input.cutoverRunId,
    utcDay: input.utcDay,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    predecessorCompleteStageSha256:
      input.predecessorCompleteStageSha256,
    predecessorReportSha256: input.predecessorReportSha256,
    sourceFingerprint: input.sourceFingerprint,
    workerRelease,
    liveTopology,
  });
  return `historical-fresh-0016-day2-budget:${historicalFresh0016JsonSha256(identity)}`;
}

export function preauthorizeHistoricalFresh0016Day2Budget(input: Readonly<{
  backupDirectory: string;
  cutoverRunId: string;
  now: Date;
  predecessorCompleteStageSha256: string;
  predecessorReportSha256: string;
  sourceFingerprint: HistoricalFresh0016SourceFingerprint;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  liveTopology: HistoricalFresh0016LiveTopologyEvidence;
  liveDeploymentStatusOutput: string;
  initialObservedUsage: D1DailyUsage;
  admissionMode?: D1ReleaseBudgetAdmissionMode;
  reserveBudget?: typeof reserveD1ReleaseBudget;
}>): HistoricalFresh0016Day2BudgetEnvelopeHandle {
  const now = validDate(input.now);
  const admissionMode =
    input.admissionMode ?? D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE;
  if (
    admissionMode === D1_RELEASE_BUDGET_WORKERS_FREE_ADMISSION_MODE &&
    (input.initialObservedUsage.rowsRead >
      HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_READ_LIMIT ||
      input.initialObservedUsage.rowsWritten >
        HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_WRITTEN_LIMIT)
  ) {
    throw new Error(
      "Fresh-0016 Day-2 observed usage exceeds the aggregate-envelope admission ceiling; wait for the next UTC reset.",
    );
  }
  assertPreauthorizationTail(input.backupDirectory, input.cutoverRunId);
  const workerRelease = requireUploadedInactiveWorkerRelease(input);
  const liveTopology = assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: input.liveTopology,
    boundaryAt: now,
    statusOutput: input.liveDeploymentStatusOutput,
    ...workerRelease,
  });
  assertLiveTopologyPostdatesUpload(input.backupDirectory, liveTopology);
  const utcDay = now.toISOString().slice(0, 10);
  const operationId = historicalFresh0016Day2BudgetOperationId({
    cutoverRunId: input.cutoverRunId,
    utcDay,
    predecessorCompleteStageSha256:
      input.predecessorCompleteStageSha256,
    predecessorReportSha256: input.predecessorReportSha256,
    sourceFingerprint: input.sourceFingerprint,
    ...workerRelease,
    liveTopology,
  });
  const ledger = (input.reserveBudget ?? reserveD1ReleaseBudget)({
    backupDir: input.backupDirectory,
    operationId,
    operation: HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME,
    sourceFingerprint: input.sourceFingerprint,
    candidateVersionId: workerRelease.targetCandidateVersionId,
    phase: "maximum",
    rowsRead: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
    rowsWritten: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
    observedUsage: input.initialObservedUsage,
    admissionMode,
    now,
    expectedUtcDay: utcDay,
  });
  const evidence = historicalFresh0016Day2BudgetEnvelopeSchema.parse({
    kind: HISTORICAL_FRESH_0016_DAY2_BUDGET_ENVELOPE_KIND,
    schemaVersion: 2,
    createdAt: now.toISOString(),
    cutoverRunId: input.cutoverRunId,
    utcDay,
    operationId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    predecessorCompleteStageSha256:
      input.predecessorCompleteStageSha256,
    predecessorReportSha256: input.predecessorReportSha256,
    sourceFingerprint: input.sourceFingerprint,
    workerRelease,
    liveTopology,
    database: policy.database,
    admissionMode,
    initialObservedUsage: input.initialObservedUsage,
    maximum: {
      rowsRead: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
      rowsWritten: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
      ledger,
    },
    allocations: policy.day2Budget.allocations,
    accounting: policy.day2Budget.accounting,
    refinement: policy.day2Budget.refinement,
    privacy: "counts-budget-and-release-identities-only",
  });
  const paths = historicalFresh0016StatePaths(
    input.backupDirectory,
    input.cutoverRunId,
  );
  writePrivateJsonDurably(paths.auxiliaryFiles.day2BudgetEnvelope, evidence, {
    replace: false,
  });
  return readHistoricalFresh0016Day2BudgetEnvelope({
    backupDirectory: input.backupDirectory,
    cutoverRunId: input.cutoverRunId,
    now,
  });
}

export function readHistoricalFresh0016Day2BudgetEnvelope(input: Readonly<{
  backupDirectory: string;
  cutoverRunId: string;
  now: Date;
  assertBudget?: typeof assertD1ReleaseBudgetReservation;
  allowRefined?: boolean;
}>): HistoricalFresh0016Day2BudgetEnvelopeHandle {
  const now = validDate(input.now);
  const paths = validateHistoricalFresh0016RunDirectory({
    backupDirectory: input.backupDirectory,
    runId: input.cutoverRunId,
  });
  const classification = classifyHistoricalFresh0016State({
    backupDirectory: input.backupDirectory,
    runId: input.cutoverRunId,
  });
  if (
    classification.status === "broken" ||
    classification.status === "conflict" ||
    classification.issues.length !== 0
  ) {
    throw new Error("Fresh-0016 Day-2 budget evidence is not in a healthy state chain.");
  }
  const handle = classification.auxiliaryFiles.find(
    (candidate) =>
      candidate.name ===
      HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.day2BudgetEnvelope,
  );
  if (!handle) {
    throw new Error("Fresh-0016 Day-2 aggregate budget envelope is missing.");
  }
  const file = paths.auxiliaryFiles.day2BudgetEnvelope;
  const evidence = historicalFresh0016Day2BudgetEnvelopeSchema.parse(
    readPrivateJsonNoFollowBounded(file),
  );
  if (evidence.cutoverRunId !== input.cutoverRunId) {
    throw new Error("Fresh-0016 Day-2 budget evidence targets the wrong run.");
  }
  assertCanonicalUploadBinding(input.backupDirectory, evidence);
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: evidence.liveTopology,
    boundaryAt: new Date(evidence.createdAt),
    ...evidence.workerRelease,
  });
  try {
    (input.assertBudget ?? assertD1ReleaseBudgetReservation)({
      ledgerPath: evidence.maximum.ledger.ledgerPath,
      utcDay: evidence.utcDay,
      operationId: evidence.operationId,
      sourceFingerprint: evidence.sourceFingerprint,
      candidateVersionId: evidence.workerRelease.targetCandidateVersionId,
      phase: "maximum",
      rowsRead: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
      rowsWritten: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
      now,
    });
  } catch (maximumError) {
    if (!input.allowRefined) throw maximumError;
    assertEnvelopeWasSafelyRefined(evidence);
  }
  const ledger = readD1ReleaseBudgetLedger(evidence.maximum.ledger.ledgerPath);
  if (ledger.admissionMode !== evidence.admissionMode) {
    throw new Error(
      "Fresh-0016 Day-2 budget envelope admission mode no longer matches its ledger.",
    );
  }
  return Object.freeze({
    path: handle.path,
    bytes: handle.bytes,
    sha256: handle.sha256,
    evidence,
  });
}

function assertEnvelopeWasSafelyRefined(
  evidence: HistoricalFresh0016Day2BudgetEnvelope,
) {
  const ledger = readD1ReleaseBudgetLedger(evidence.maximum.ledger.ledgerPath);
  const parent = ledger.reservations.find(
    (reservation) =>
      reservation.operationId === evidence.operationId &&
      reservation.sourceFingerprint.sha256 ===
        evidence.sourceFingerprint.sha256 &&
      reservation.sourceFingerprint.fileCount ===
        evidence.sourceFingerprint.fileCount,
  );
  if (
    !parent ||
    parent.accountingParentOperationId !== null ||
    parent.phase !== "exact" ||
    parent.candidateVersionId !==
      evidence.workerRelease.targetCandidateVersionId ||
    parent.maximumRowsRead !== HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ ||
    parent.maximumRowsWritten !==
      HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN
  ) {
    throw new Error(
      "Fresh-0016 Day-2 envelope is neither live maximum nor safely refined exact evidence.",
    );
  }
}

function assertPreauthorizationTail(
  backupDirectory: string,
  cutoverRunId: string,
) {
  validateHistoricalFresh0016RunDirectory({
    backupDirectory,
    runId: cutoverRunId,
  });
  const classification = classifyHistoricalFresh0016State({
    backupDirectory,
    runId: cutoverRunId,
  });
  if (
    classification.status !== "in-progress" ||
    classification.currentStage !== "predecessor-complete" ||
    classification.nextStage !== "manifest" ||
    classification.issues.length !== 0 ||
    classification.auxiliaryFiles.some(
      (file) =>
        file.name ===
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.day2BudgetEnvelope,
    )
  ) {
    throw new Error(
      "Fresh-0016 Day-2 budget preauthorization is admitted only at the exact predecessor-complete tail.",
    );
  }
}

function requireUploadedInactiveWorkerRelease(input: Readonly<{
  backupDirectory: string;
  sourceFingerprint: HistoricalFresh0016SourceFingerprint;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>) {
  const workerRelease = uploadedInactiveWorkerReleaseSchema.parse({
    phase: "uploaded-inactive",
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
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
      "Fresh-0016 Day-2 budget requires the exact inactive upload evidence while the baseline remains sole 100% serving.",
    );
  }
  return workerRelease;
}

function assertCanonicalUploadBinding(
  backupDirectory: string,
  evidence: HistoricalFresh0016Day2BudgetEnvelope,
) {
  const workerRelease = requireUploadedInactiveWorkerRelease({
    backupDirectory,
    sourceFingerprint: evidence.sourceFingerprint,
    ...evidence.workerRelease,
  });
  if (
    historicalFresh0016JsonSha256(workerRelease) !==
      historicalFresh0016JsonSha256(evidence.liveTopology.workerRelease) ||
    Date.parse(evidence.liveTopology.observedAt) <
      Date.parse(
        readWorkerCandidateUploadEvidence(
          workerCandidateUploadEvidencePath(backupDirectory),
        ).value.createdAt,
      )
  ) {
    throw new Error(
      "Fresh-0016 Day-2 budget lost its canonical upload or post-upload topology binding.",
    );
  }
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
      "Fresh-0016 Day-2 live topology cannot predate the candidate upload evidence.",
    );
  }
}

function readPrivateJsonNoFollowBounded(file: string): unknown {
  return readPrivateJsonNoFollow(
    file,
    HISTORICAL_FRESH_0016_DAY2_BUDGET_MAXIMUM_BYTES,
  );
}

function validDate(value: Date) {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Fresh-0016 Day-2 budget requires a valid clock.");
  }
  return new Date(value.getTime());
}

export function refineHistoricalFresh0016Day2BudgetAfterFinalProof(
  input: Readonly<{
    envelope: HistoricalFresh0016Day2BudgetEnvelopeHandle;
    finalProofPath: string;
    finalProofCanonicalValueSha256: string;
    now: Date;
    reserveBudget?: typeof reserveD1ReleaseBudget;
  }>,
) {
  const now = validDate(input.now);
  const envelope = historicalFresh0016Day2BudgetEnvelopeSchema.parse(
    input.envelope.evidence,
  );
  const expectedProofSha256 = sha256Schema.parse(
    input.finalProofCanonicalValueSha256,
  );
  const proofValue = readPrivateJsonNoFollow(
    path.resolve(input.finalProofPath),
    2 * 1024 * 1024,
  );
  if (historicalFresh0016JsonSha256(proofValue) !== expectedProofSha256) {
    throw new Error(
      "Fresh-0016 final preservation proof changed before aggregate refinement.",
    );
  }
  const proof = parseHistoricalDataVerificationReport(proofValue);
  const proofBaseline = proof.baselineEvidence;
  const expectedBackupDirectory = path.dirname(
    path.dirname(envelope.maximum.ledger.ledgerPath),
  );
  if (
    proof.ok !== true ||
    proof.problems.length !== 0 ||
    proof.utcDay !== envelope.utcDay ||
    proof.operationId !== proof.ledger.reservation.operationId ||
    proof.backupDir !== expectedBackupDirectory ||
    path.resolve(input.finalProofPath) !==
      historicalDataReportPath(expectedBackupDirectory, "verification") ||
    proof.ledger.ledgerPath !== envelope.maximum.ledger.ledgerPath ||
    proof.ledger.reservation.candidateVersionId !==
      envelope.workerRelease.targetCandidateVersionId ||
    proof.sourceFingerprint.sha256 !== envelope.sourceFingerprint.sha256 ||
    proof.sourceFingerprint.fileCount !== envelope.sourceFingerprint.fileCount ||
    historicalFresh0016JsonSha256(proof.usage) !==
      historicalFresh0016JsonSha256(envelope.initialObservedUsage) ||
    !proofBaseline ||
    proofBaseline.cutoverRunId !== envelope.cutoverRunId ||
    proofBaseline.policySha256 !== HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256
  ) {
    throw new Error(
      "Fresh-0016 final preservation proof lost its envelope, source, or exact-ledger binding.",
    );
  }
  const liveProofReservation = assertD1ReleaseBudgetReservation({
    ledgerPath: proof.ledger.ledgerPath,
    utcDay: proof.utcDay,
    operationId: proof.operationId,
    sourceFingerprint: envelope.sourceFingerprint,
    candidateVersionId: envelope.workerRelease.targetCandidateVersionId,
    accountingParentOperationId: envelope.operationId,
    phase: "exact",
    rowsRead: proof.rowsRead,
    rowsWritten: 0,
    now,
  });
  if (
    historicalFresh0016JsonSha256(proof.ledger.reservation) !==
      historicalFresh0016JsonSha256(liveProofReservation.reservation)
  ) {
    throw new Error(
      "Fresh-0016 final preservation proof lost its exact live reservation.",
    );
  }

  const ledger = readD1ReleaseBudgetLedger(
    envelope.maximum.ledger.ledgerPath,
  );
  const children = ledger.reservations.filter(
    (reservation) =>
      reservation.accountingParentOperationId === envelope.operationId &&
      reservation.sourceFingerprint.sha256 === envelope.sourceFingerprint.sha256 &&
      reservation.sourceFingerprint.fileCount === envelope.sourceFingerprint.fileCount,
  );
  const exactChildren = children.filter((child) => child.phase === "exact");
  const nonExactChildren = children.filter((child) => child.phase !== "exact");
  // Recovered or resumed cutover branches can leave conservative maximum child
  // reservations behind even after the exact child reservations are present.
  // Those maximum reservations remain in the ledger totals, so aggregate
  // refinement only proves from exact children and refuses any unexpected phase.
  if (
    nonExactChildren.some((child) => child.phase !== "maximum") ||
    exactChildren.filter((child) =>
      child.operationId.startsWith("historical-fresh-0016-migration:"),
    ).length !== 1 ||
    exactChildren.filter((child) =>
      child.operationId.startsWith("historical-fresh-0016-successor:"),
    ).length !== 1 ||
    exactChildren.filter((child) => child.operationId === proof.operationId)
      .length !== 1
  ) {
    throw new Error(
      "Fresh-0016 aggregate refinement requires exact migration, successor, and final-verifier child proof.",
    );
  }
  const childUsage = exactChildren.reduce(
    (total, child) => ({
      rowsRead: safeAdd(total.rowsRead, child.rowsRead, "Day-2 exact child reads"),
      rowsWritten: safeAdd(
        total.rowsWritten,
        child.rowsWritten,
        "Day-2 exact child writes",
      ),
    }),
    { rowsRead: 0, rowsWritten: 0 },
  );
  const exactRowsRead = safeAdd(
    childUsage.rowsRead,
    policy.day2Budget.allocations
      .standaloneRuntimeVerificationBillableRowsRead +
      policy.day2Budget.allocations
        .runtimeMigration0017VerificationBillableRowsRead +
      policy.day2Budget.allocations.productionLockRowsRead +
      policy.day2Budget.allocations.postdeployAuthorizationRowsRead,
    "Day-2 refined rows read",
  );
  const exactRowsWritten = safeAdd(
    childUsage.rowsWritten,
    policy.day2Budget.allocations.productionLockRowsWritten +
      policy.day2Budget.allocations.postdeployAuthorizationRowsWritten,
    "Day-2 refined rows written",
  );
  if (
    exactRowsRead > HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ ||
    exactRowsWritten > HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN
  ) {
    throw new Error(
      "Fresh-0016 proven Day-2 exact usage exceeds its aggregate maximum.",
    );
  }
  return (input.reserveBudget ?? reserveD1ReleaseBudget)({
    backupDir: path.dirname(path.dirname(envelope.maximum.ledger.ledgerPath)),
    operationId: envelope.operationId,
    operation: HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME,
    sourceFingerprint: envelope.sourceFingerprint,
    candidateVersionId: envelope.workerRelease.targetCandidateVersionId,
    phase: "exact",
    rowsRead: exactRowsRead,
    rowsWritten: exactRowsWritten,
    observedUsage: envelope.initialObservedUsage,
    allowStaleMaximumChildReservationsOnExactAggregate: true,
    now,
    expectedUtcDay: envelope.utcDay,
  });
}

function safeAdd(left: number, right: number, label: string) {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} overflowed a safe nonnegative integer.`);
  }
  return value;
}

export type HistoricalFresh0016Day2ReserveBudget = (
  input: Parameters<typeof reserveD1ReleaseBudget>[0],
) => D1ReleaseBudgetReservationResult;
