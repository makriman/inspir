import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET } from "./apply-historical-data-fresh-0016-migration";
import {
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
} from "./check-d1-runtime-migration-budget";
import {
  assertHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  HISTORICAL_FRESH_0016_DAY2_APPLY_BILLABLE_ROWS_READ,
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT,
  historicalFresh0016LiveTopologyEvidenceSchema,
  type HistoricalFresh0016LiveTopologyEvidence,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
} from "./historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  canonicalHistoricalFresh0016Json,
  classifyHistoricalFresh0016State,
  historicalFresh0016JsonSha256,
  historicalFresh0016StatePaths,
  validateHistoricalFresh0016RunDirectory,
  type HistoricalFresh0016SourceFingerprint,
} from "./historical-data-fresh-0016-state";
import {
  canonicalProductionValidationLockOwner,
  parseProductionValidationLockBudget,
} from "./production-validation-lock";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

export const HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND =
  "inspir-historical-data-fresh-0016-migration-budget-prepared-v2" as const;
export const HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_MAXIMUM_BYTES =
  1024 * 1024;
export const HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME =
  "Historical fresh-0016 runtime migration" as const;
export const HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ =
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT +
  HISTORICAL_FRESH_0016_DAY2_APPLY_BILLABLE_ROWS_READ;

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
      message: "The migration target candidate must differ from the serving baseline.",
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
const ledgerResultSchema = z.object({
  ledgerPath: absolutePathSchema,
  utcDay: utcDaySchema,
  revision: positiveIntegerSchema,
  idempotent: z.boolean(),
  reservation: z.object({
    operationId: z.string().min(1).max(256),
    operation: z.literal(HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME),
    candidateVersionId: workerVersionSchema,
    phase: z.literal("maximum"),
    rowsRead: z.literal(
      HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
    ),
    rowsWritten: z.literal(MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES),
    maximumRowsRead: z.literal(
      HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
    ),
    maximumRowsWritten: z.literal(MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES),
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
const cardinalitiesSchema = z.object({
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
const projectionSchema = z.object({
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
const applyEnvelopeSchema = z.object({
  projectedRowsRead: z.literal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
      .projectedRowsRead,
  ),
  maximumReadOnlyCalls: z.literal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation.readOnlyCalls,
  ),
  maximumWriteCapableCalls: z.literal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
      .writeCapableCalls,
  ),
  maximumTotalRunnerCalls: z.literal(
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
      .totalRunnerCalls,
  ),
}).strict();

export const historicalFresh0016MigrationBudgetPreparedSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND),
  schemaVersion: z.literal(2),
  createdAt: canonicalTimestampSchema,
  cutoverRunId: uuidSchema,
  utcDay: utcDaySchema,
  operationId: z.string().regex(
    /^historical-fresh-0016-migration:[a-f0-9]{64}$/,
  ),
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  sourceFingerprint: sourceFingerprintSchema,
  database: z.object({
    id: z.literal(policy.database.id),
    name: z.literal(policy.database.name),
  }).strict(),
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  liveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  day2BudgetEnvelope: z.object({
    operationId: z.string().regex(
      /^historical-fresh-0016-day2-budget:[a-f0-9]{64}$/,
    ),
    fileSha256: sha256Schema,
    predecessorCompleteStageSha256: sha256Schema,
  }).strict(),
  productionExclusion: z.object({
    owner: z.object({
      candidateVersionId: workerVersionSchema,
      leaseExpiresAt: positiveIntegerSchema,
      leaseId: uuidSchema,
      runId: uuidSchema,
      sourceFingerprintSha256: sha256Schema,
    }).strict(),
    ownerSha256: sha256Schema,
    lockBudget: z.object({
      operations: z.literal(2),
      reservedRowsRead: z.literal(36),
      reservedRowsWritten: z.literal(4),
      billedRowsRead: nonnegativeIntegerSchema,
      billedRowsWritten: nonnegativeIntegerSchema,
    }).strict(),
  }).strict(),
  usage: usageSchema,
  maximum: z.object({
    rowsRead: z.literal(
      HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
    ),
    rowsWritten: z.literal(MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES),
    ledger: ledgerResultSchema,
  }).strict(),
  cardinalities: cardinalitiesSchema,
  cardinalityQuery: z.object({
    rowsRead: nonnegativeIntegerSchema,
    rowsWritten: z.literal(0),
    totalAttempts: z.literal(1),
    readOnly: z.literal(true),
  }).strict(),
  projection: projectionSchema,
  applyEnvelope: applyEnvelopeSchema,
  migrationSource: z.object({
    file: z.literal(policy.migration0016.trackedFile),
    bytes: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES),
    sha256: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256),
  }).strict(),
  privacy: z.literal("counts-budget-and-release-identities-only"),
}).strict().superRefine((value, context) => {
  if (
    value.createdAt.slice(0, 10) !== value.utcDay ||
    value.maximum.ledger.utcDay !== value.utcDay ||
    value.maximum.ledger.reservation.operationId !== value.operationId ||
    value.operationId !==
      historicalFresh0016MigrationOperationId({
        cutoverRunId: value.cutoverRunId,
        sourceFingerprint: value.sourceFingerprint,
        ...value.workerRelease,
        liveTopology: value.liveTopology,
        productionExclusionOwnerSha256:
          value.productionExclusion.ownerSha256,
        utcDay: value.utcDay,
      }) ||
    value.maximum.ledger.reservation.candidateVersionId !==
      value.workerRelease.targetCandidateVersionId ||
    value.productionExclusion.owner.candidateVersionId !==
      value.workerRelease.targetCandidateVersionId ||
    value.productionExclusion.owner.sourceFingerprintSha256 !==
      value.sourceFingerprint.sha256 ||
    canonicalHistoricalFresh0016Json(value.liveTopology.workerRelease) !==
      canonicalHistoricalFresh0016Json(value.workerRelease) ||
    createHash("sha256")
      .update(
        canonicalProductionValidationLockOwner(
          value.productionExclusion.owner,
        ),
      )
      .digest("hex") !== value.productionExclusion.ownerSha256
  ) {
    context.addIssue({
      code: "custom",
      message: "Prepared migration-budget identity bindings are inconsistent.",
    });
  }
  try {
    parseProductionValidationLockBudget(value.productionExclusion.lockBudget);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Prepared migration-budget lock accounting is invalid.",
    });
  }
});

export type HistoricalFresh0016MigrationBudgetPrepared = z.infer<
  typeof historicalFresh0016MigrationBudgetPreparedSchema
>;

export type HistoricalFresh0016MigrationBudgetPreparedHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  evidence: HistoricalFresh0016MigrationBudgetPrepared;
}>;

export function historicalFresh0016MigrationOperationId(input: Readonly<{
  cutoverRunId: string;
  sourceFingerprint: HistoricalFresh0016SourceFingerprint;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  liveTopology: HistoricalFresh0016LiveTopologyEvidence;
  productionExclusionOwnerSha256: string;
  utcDay: string;
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
  if (
    canonicalHistoricalFresh0016Json(liveTopology.workerRelease) !==
    canonicalHistoricalFresh0016Json(workerRelease)
  ) {
    throw new Error(
      "Fresh-0016 migration operation topology drifted from its Worker release.",
    );
  }
  const material = {
    kind: HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND,
    schemaVersion: 2,
    cutoverRunId: input.cutoverRunId,
    sourceFingerprint: input.sourceFingerprint,
    workerRelease,
    liveTopology,
    productionExclusionOwnerSha256: input.productionExclusionOwnerSha256,
    utcDay: input.utcDay,
  } as const;
  const parsed = z.object({
    kind: z.literal(HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND),
    schemaVersion: z.literal(2),
    cutoverRunId: uuidSchema,
    sourceFingerprint: sourceFingerprintSchema,
    workerRelease: uploadedInactiveWorkerReleaseSchema,
    liveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
    productionExclusionOwnerSha256: sha256Schema,
    utcDay: utcDaySchema,
  }).strict().parse(material);
  return `historical-fresh-0016-migration:${historicalFresh0016JsonSha256(parsed)}`;
}

export function writeHistoricalFresh0016MigrationBudgetPrepared(input: {
  backupDirectory: string;
  runId: string;
  evidence: unknown;
  liveDeploymentStatusOutput: string;
}): HistoricalFresh0016MigrationBudgetPreparedHandle {
  const evidence = historicalFresh0016MigrationBudgetPreparedSchema.parse(
    input.evidence,
  );
  assertCanonicalUploadBinding(input.backupDirectory, evidence);
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: evidence.liveTopology,
    boundaryAt: new Date(evidence.createdAt),
    statusOutput: input.liveDeploymentStatusOutput,
    ...evidence.workerRelease,
  });
  if (evidence.cutoverRunId !== input.runId) {
    throw new Error("Prepared migration-budget run ID does not match its run directory.");
  }
  const paths = validateHistoricalFresh0016RunDirectory({
    backupDirectory: input.backupDirectory,
    runId: input.runId,
  });
  const classification = classifyHistoricalFresh0016State({
    backupDirectory: input.backupDirectory,
    runId: input.runId,
  });
  if (
    classification.status !== "in-progress" ||
    classification.currentStage !== "predecessor-complete" ||
    classification.nextStage !== "manifest" ||
    classification.issues.length !== 0 ||
    !classification.auxiliaryFiles.some(
      (file) =>
        file.name ===
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.day2BudgetEnvelope,
    ) ||
    classification.auxiliaryFiles.some(
      (file) =>
        file.name ===
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
          .migrationBudgetPrepared,
    )
  ) {
    throw new Error(
      "Prepared migration-budget evidence is admitted only at the exact predecessor-complete tail.",
    );
  }
  return writeExclusivePreparedFile(
    paths.auxiliaryFiles.migrationBudgetPrepared,
    evidence,
  );
}

export function readHistoricalFresh0016MigrationBudgetPrepared(input: {
  backupDirectory: string;
  runId: string;
}): HistoricalFresh0016MigrationBudgetPreparedHandle {
  const paths = validateHistoricalFresh0016RunDirectory(input);
  const expected = historicalFresh0016StatePaths(
    paths.backupDirectory,
    input.runId,
  ).auxiliaryFiles.migrationBudgetPrepared;
  const handle = readPreparedFile(expected, input.runId);
  assertCanonicalUploadBinding(input.backupDirectory, handle.evidence);
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: handle.evidence.liveTopology,
    boundaryAt: new Date(handle.evidence.createdAt),
    ...handle.evidence.workerRelease,
  });
  return handle;
}

function assertCanonicalUploadBinding(
  backupDirectory: string,
  evidence: HistoricalFresh0016MigrationBudgetPrepared,
) {
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
  );
  const release = evidence.workerRelease;
  if (
    upload.sha256 !== release.uploadEvidenceSha256 ||
    upload.value.targetCandidateVersionId !==
      release.targetCandidateVersionId ||
    upload.value.serviceBaselineVersionId !==
      release.serviceBaselineVersionId ||
    upload.value.soleBaselineTopology.serviceBaselineVersionId !==
      release.serviceBaselineVersionId ||
    upload.value.soleBaselineTopology.percentage !== 100 ||
    upload.value.soleBaselineTopology.observedVersions !== 1 ||
    upload.value.artifacts.sourceFingerprintSha256 !==
      evidence.sourceFingerprint.sha256 ||
    upload.value.artifacts.sourceFingerprintFileCount !==
      evidence.sourceFingerprint.fileCount ||
    Date.parse(evidence.liveTopology.observedAt) <
      Date.parse(upload.value.createdAt)
  ) {
    throw new Error(
      "Prepared migration budget is not bound to the exact inactive upload while the baseline remains sole 100% serving.",
    );
  }
}

function writeExclusivePreparedFile(
  file: string,
  evidence: HistoricalFresh0016MigrationBudgetPrepared,
) {
  const bytes = Buffer.from(
    `${canonicalHistoricalFresh0016Json(evidence)}\n`,
    "utf8",
  );
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength >
      HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_MAXIMUM_BYTES
  ) {
    throw new Error("Prepared migration-budget evidence exceeds its size bound.");
  }
  const directory = path.dirname(file);
  const directoryBefore = privateDirectoryStat(directory);
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
      throw new Error("Prepared migration-budget evidence already exists and is immutable.");
    }
    throw new Error("Prepared migration-budget evidence could not be created exclusively.");
  }
  let failure: unknown;
  try {
    fs.fchmodSync(descriptor, 0o600);
    const before = privateFileStat(fs.fstatSync(descriptor), 0);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const after = privateFileStat(fs.fstatSync(descriptor), bytes.byteLength);
    if (before.dev !== after.dev || before.ino !== after.ino) {
      throw new Error("Prepared migration-budget evidence inode changed during write.");
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
    throw new Error("Prepared migration-budget evidence write was interrupted and remains fail-closed.");
  }
  const directoryDescriptor = fs.openSync(
    directory,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(directoryDescriptor);
  } finally {
    fs.closeSync(directoryDescriptor);
  }
  const directoryAfter = privateDirectoryStat(directory);
  if (
    directoryBefore.dev !== directoryAfter.dev ||
    directoryBefore.ino !== directoryAfter.ino
  ) {
    throw new Error("Prepared migration-budget parent directory changed during write.");
  }
  return readPreparedFile(file, evidence.cutoverRunId);
}

function readPreparedFile(file: string, runId: string) {
  if (
    path.basename(file) !==
      HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.migrationBudgetPrepared
  ) {
    throw new Error("Prepared migration-budget evidence path is not canonical.");
  }
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error("Prepared migration-budget evidence is missing, linked, or unreadable.");
  }
  let before: fs.Stats;
  let after: fs.Stats;
  let bytes: Buffer;
  try {
    before = privateFileStat(fs.fstatSync(descriptor));
    if (
      before.size === 0 ||
      before.size >
        HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_MAXIMUM_BYTES
    ) {
      throw new Error("Prepared migration-budget evidence has an invalid size.");
    }
    bytes = fs.readFileSync(descriptor);
    after = privateFileStat(fs.fstatSync(descriptor), bytes.byteLength);
  } finally {
    fs.closeSync(descriptor);
  }
  const pathStat = privateFileStat(fs.lstatSync(file), bytes.byteLength);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    after.dev !== pathStat.dev ||
    after.ino !== pathStat.ino
  ) {
    throw new Error("Prepared migration-budget evidence changed during readback.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Prepared migration-budget evidence is not valid JSON.");
  }
  const evidence = historicalFresh0016MigrationBudgetPreparedSchema.parse(raw);
  if (evidence.cutoverRunId !== runId) {
    throw new Error("Prepared migration-budget evidence belongs to another run.");
  }
  const canonicalBytes = Buffer.from(
    `${canonicalHistoricalFresh0016Json(evidence)}\n`,
    "utf8",
  );
  if (!bytes.equals(canonicalBytes)) {
    throw new Error("Prepared migration-budget evidence bytes are not canonical.");
  }
  return Object.freeze({
    path: path.resolve(file),
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    evidence: Object.freeze(evidence),
  });
}

function privateDirectoryStat(directory: string) {
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error("Prepared migration-budget directory is not private and canonical.");
  }
  return stat;
}

function privateFileStat(stat: fs.Stats, expectedBytes?: number) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    (expectedBytes !== undefined && stat.size !== expectedBytes)
  ) {
    throw new Error("Prepared migration-budget evidence is not a private regular file.");
  }
  return stat;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
