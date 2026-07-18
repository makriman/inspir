import { createHash } from "node:crypto";
import path from "node:path";
import {
  assertD1ReleaseBudgetReservation,
  readPrivateJsonNoFollow,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  createHistoricalFresh0016FinalActiveTopologyEvidence,
  historicalFresh0016FinalActiveTopologyEvidenceSchema,
  type HistoricalFresh0016FinalActiveTopologyEvidence,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  readHistoricalFresh0016Day2BudgetEnvelope,
  refineHistoricalFresh0016Day2BudgetAfterFinalProof,
} from "./historical-data-fresh-0016-day2-budget";
import {
  runWrangler,
  stableStringify,
} from "./migration-config";
import {
  assertDeferred0017EvidenceRecord,
  readHistoricalFresh0016PredecessorPrerequisites,
} from "./historical-data-fresh-0016-prerequisites";
import {
  historicalFresh0016JsonSha256,
} from "./historical-data-fresh-0016-state";
import {
  topicAttestationPath,
  translationAttestationPath,
} from "./release-sequence-attestations";
import {
  runtimeMigration0017VerificationReportPath,
} from "./verify-d1-runtime-migration-0017";
import { readHistoricalFresh0016SuccessorReport } from "./historical-data-fresh-0016-successor";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import {
  HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  readAndValidateHistoricalDataFresh0016FinalVerificationProof,
  readHistoricalDataFresh0016FinalVerificationAuthorizationIfPresent,
  validateHistoricalOperationalDatasets,
  validateHistoricalProtectedDatasetEvidence,
  type HistoricalDataPreservationBaselineReference,
  type HistoricalFresh0016FinalVerificationContext,
} from "./verify-historical-data-preservation";
import { readAndValidateHistoricalFresh0016CutoverComplete } from "./verify-historical-data-fresh-0016-cutover-chain";
import {
  readWorkerCandidateActivationEvidence,
  readWorkerCandidateStagedEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateActivationEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  type WorkerCandidateActivationEvidence,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
} from "./worker-candidate-release-evidence";

const FINAL_PREREQUISITE_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;

type CutoverBoundPredecessorPrerequisites = Readonly<{
  predecessorUtcDay: string;
  topic: Readonly<{ evidenceSha256: string }>;
  translation: Readonly<{ evidenceSha256: string }>;
  runtimeMigration0017: Readonly<{
    verificationEvidenceSha256: string;
  }>;
}>;

export function readHistoricalFresh0016PreservationReference(input: Readonly<{
  backupDir: string;
  cwd: string;
  now: Date;
}>): HistoricalDataPreservationBaselineReference {
  const backupDir = path.resolve(input.backupDir);
  const cwd = path.resolve(input.cwd);
  const completion = readAndValidateHistoricalFresh0016CutoverComplete({
    cwd,
    backupDirectory: backupDir,
  });
  let livePrerequisitesSha256: string | null = null;
  try {
    livePrerequisitesSha256 = historicalFresh0016JsonSha256(
      readHistoricalFresh0016PredecessorPrerequisites({
        backupDirectory: backupDir,
        sourceFingerprint: completion.artifact.sourceFingerprint,
        ...completion.artifact.workerRelease,
        predecessorStartAt: new Date(
          completion.artifact.timing.predecessorCreatedAt,
        ),
        liveRuntimeState:
          completion.artifact.evidence.predecessorPrerequisites.liveRuntimeState,
      }),
    );
  } catch {
    livePrerequisitesSha256 = null;
  }
  if (
    livePrerequisitesSha256 !==
    completion.artifact.evidence.predecessorPrerequisitesSha256
  ) {
    assertCutoverBoundPredecessorPrerequisitesStillSafe({
      backupDir,
      sourceFingerprint: completion.artifact.sourceFingerprint,
      expectedPrerequisites:
        completion.artifact.evidence.predecessorPrerequisites,
      expectedPrerequisitesSha256:
        completion.artifact.evidence.predecessorPrerequisitesSha256,
    });
  }
  const successor = readHistoricalFresh0016SuccessorReport({
    backupDirectory: backupDir,
    cutoverRunId: completion.artifact.cutoverRunId,
  });
  const report = successor.report;
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  const compactSource: D1ReleaseSourceIdentity = {
    sha256: sourceFingerprint.sha256,
    fileCount: sourceFingerprint.fileCount,
  };
  const createdAtMs = Date.parse(report.createdAt);
  const nowMs = input.now.getTime();
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(createdAtMs) ||
    createdAtMs > nowMs ||
    nowMs - createdAtMs > HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS
  ) {
    throw new Error(
      "Fresh-0016 successor preservation evidence is stale or from the future.",
    );
  }
  if (
    completion.artifact.paths.backupDirectory !== backupDir ||
    completion.artifact.evidence.successorReportFileSha256 !== successor.sha256 ||
    completion.artifact.cutoverRunId !== report.cutoverRunId ||
    completion.artifact.sourceFingerprint.sha256 !== compactSource.sha256 ||
    completion.artifact.sourceFingerprint.fileCount !== compactSource.fileCount ||
    report.sourceFingerprint.sha256 !== compactSource.sha256 ||
    report.sourceFingerprint.fileCount !== compactSource.fileCount ||
    historicalFresh0016JsonSha256(completion.artifact.workerRelease) !==
      historicalFresh0016JsonSha256(report.workerRelease) ||
    historicalFresh0016JsonSha256(
      completion.artifact.finalizationLiveTopology,
    ) !== historicalFresh0016JsonSha256(report.finalizationLiveTopology) ||
    completion.artifact.hmacKeyId !== report.hmacKeyId ||
    completion.artifact.timing.successorCreatedAt !== report.createdAt ||
    completion.artifact.budget.successorOperationId !== report.operationId ||
    completion.artifact.budget.successorExactRowsRead !== report.rowsRead ||
    report.paths.backupDirectory !== backupDir ||
    report.operationalDatasets.memory_vector_cleanup_outbox.rowCount !== 0
  ) {
    throw new Error(
      "Fresh-0016 successor preservation evidence is not exactly bound to the canonical accepted cutover, source, HMAC key, Worker, paths, and empty outbox.",
    );
  }
  assertD1ReleaseBudgetReservation({
    ledgerPath: report.ledger.exact.ledgerPath,
    utcDay: report.utcDay,
    operationId: report.operationId,
    sourceFingerprint: compactSource,
    candidateVersionId: report.workerRelease.targetCandidateVersionId,
    accountingParentOperationId: report.accountingParentOperationId,
    phase: "exact",
    rowsRead: report.rowsRead,
    rowsWritten: 0,
    now: input.now,
  });
  validateHistoricalProtectedDatasetEvidence(
    report.datasets,
    report.supplementalDatasets,
  );
  validateHistoricalOperationalDatasets(report.operationalDatasets);
  return Object.freeze({
    createdAt: report.createdAt,
    hmacKeyId: report.hmacKeyId,
    sourceFingerprint,
    datasets: report.datasets,
    supplementalDatasets: report.supplementalDatasets,
    operationalDatasets: report.operationalDatasets,
    baselineEvidence: Object.freeze({
      kind: "fresh-0016-canonical-successor" as const,
      cutoverRunId: report.cutoverRunId,
      policySha256: completion.artifact.policy.sha256,
      canonicalArtifactSha256: completion.sha256,
      successorReportSha256: successor.sha256,
    }),
  });
}

function assertCutoverBoundPredecessorPrerequisitesStillSafe(input: Readonly<{
  backupDir: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  expectedPrerequisites: CutoverBoundPredecessorPrerequisites;
  expectedPrerequisitesSha256: string;
}>) {
  if (
    historicalFresh0016JsonSha256(input.expectedPrerequisites) !==
    input.expectedPrerequisitesSha256
  ) {
    throw new Error(
      "Fresh-0016 cutover-bound predecessor prerequisites no longer match the accepted completion hash.",
    );
  }
  const topic = readPrivateJsonNoFollow(
    topicAttestationPath(input.backupDir),
    FINAL_PREREQUISITE_EVIDENCE_MAX_BYTES,
  );
  const translation = readPrivateJsonNoFollow(
    translationAttestationPath(input.backupDir),
    FINAL_PREREQUISITE_EVIDENCE_MAX_BYTES,
  );
  if (
    canonicalJsonSha256(topic) !==
      input.expectedPrerequisites.topic.evidenceSha256 ||
    canonicalJsonSha256(translation) !==
      input.expectedPrerequisites.translation.evidenceSha256
  ) {
    throw new Error(
      "Fresh-0016 topic/translation prerequisite evidence changed before the final verifier.",
    );
  }
  const current0017 = requiredRecord(
    readPrivateJsonNoFollow(
      runtimeMigration0017VerificationReportPath(input.backupDir),
      FINAL_PREREQUISITE_EVIDENCE_MAX_BYTES,
    ),
    "current 0017 deferred verification report",
  );
  assertDeferred0017EvidenceRecord(current0017, {
    backupDirectory: input.backupDir,
    sourceFingerprint: input.sourceFingerprint,
  });
  const current0017CreatedAt = requiredCanonicalTimestamp(
    current0017.createdAt,
    "current 0017 verification timestamp",
  );
  if (
    current0017CreatedAt.slice(0, 10) !==
    input.expectedPrerequisites.predecessorUtcDay
  ) {
    throw new Error(
      "Fresh-0016 final verifier requires current 0017 read-only absence evidence on the predecessor UTC day.",
    );
  }
}

function canonicalJsonSha256(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredCanonicalTimestamp(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Expected ${label} to be a canonical timestamp.`);
  }
  return value;
}

function readHistoricalFresh0016CanonicalFinalPreservationProof(
  input: Readonly<{
    backupDirectory: string;
    cwd: string;
    now: Date;
  }>,
) {
  const backupDirectory = path.resolve(input.backupDirectory);
  const baseline = readHistoricalFresh0016PreservationReference({
    backupDir: backupDirectory,
    cwd: path.resolve(input.cwd),
    now: input.now,
  });
  const baselineEvidence = baseline.baselineEvidence;
  if (!baselineEvidence) {
    throw new Error(
      "Fresh-0016 final preservation assertion requires its canonical cutover identity.",
    );
  }
  const day2Budget = readHistoricalFresh0016Day2BudgetEnvelope({
    backupDirectory,
    cutoverRunId: baselineEvidence.cutoverRunId,
    now: input.now,
    allowRefined: true,
  });
  const envelope = day2Budget.evidence;
  if (
    envelope.cutoverRunId !== baselineEvidence.cutoverRunId ||
    envelope.policySha256 !== baselineEvidence.policySha256 ||
    envelope.sourceFingerprint.sha256 !== baseline.sourceFingerprint.sha256 ||
    envelope.sourceFingerprint.fileCount !== baseline.sourceFingerprint.fileCount
  ) {
    throw new Error(
      "Fresh-0016 final preservation evidence lost its canonical cutover and source binding.",
    );
  }
  const proof = readAndValidateHistoricalDataFresh0016FinalVerificationProof({
    backupDir: backupDirectory,
    baseline,
    day2Budget: envelope,
    now: input.now,
  });
  return Object.freeze({
    createdAt: proof.report.createdAt,
    cutoverRunId: baselineEvidence.cutoverRunId,
    canonicalArtifactSha256: baselineEvidence.canonicalArtifactSha256,
    successorReportSha256: baselineEvidence.successorReportSha256,
    sourceFingerprint: Object.freeze({
      sha256: baseline.sourceFingerprint.sha256,
      fileCount: baseline.sourceFingerprint.fileCount,
    }),
    workerRelease: Object.freeze({ ...envelope.workerRelease }),
    activationEvidenceSha256:
      proof.finalVerificationLiveTopology.activationEvidence.sha256,
    authorizationPath: proof.authorizationPath,
    reportPath: proof.reportPath,
  });
}

export type HistoricalFresh0016FinalPreservationAssertionDependencies =
  Readonly<{
    readCanonicalProof: typeof readHistoricalFresh0016CanonicalFinalPreservationProof;
  }>;

export function assertFreshHistoricalFresh0016FinalPreservation(input: Readonly<{
  backupDirectory: string;
  cwd: string;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  activationEvidenceSha256: string;
  now?: Date;
}>, dependencies: HistoricalFresh0016FinalPreservationAssertionDependencies = {
  readCanonicalProof:
    readHistoricalFresh0016CanonicalFinalPreservationProof,
}) {
  const now = new Date((input.now ?? new Date()).getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Fresh-0016 final preservation assertion clock is invalid.");
  }
  const proof = dependencies.readCanonicalProof({
    backupDirectory: path.resolve(input.backupDirectory),
    cwd: path.resolve(input.cwd),
    now,
  });
  if (
    proof.workerRelease.targetCandidateVersionId !==
      input.targetCandidateVersionId ||
    proof.workerRelease.serviceBaselineVersionId !==
      input.serviceBaselineVersionId ||
    proof.workerRelease.uploadEvidenceSha256 !== input.uploadEvidenceSha256 ||
    proof.activationEvidenceSha256 !== input.activationEvidenceSha256
  ) {
    throw new Error(
      "Fresh-0016 final preservation evidence does not bind the exact canonical source and Worker release.",
    );
  }
  return proof;
}

export function createHistoricalFresh0016FinalVerificationLiveTopology(input: Readonly<{
  workerRelease: Readonly<{
    phase: "uploaded-inactive";
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
  }>;
  previousLiveTopologyObservedAt: string;
  now: Date;
  statusOutput: string;
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  staged: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  activation: WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
}>) {
  const release = input.workerRelease;
  if (
    input.upload.sha256 !== release.uploadEvidenceSha256 ||
    input.upload.value.targetCandidateVersionId !==
      release.targetCandidateVersionId ||
    input.upload.value.serviceBaselineVersionId !==
      release.serviceBaselineVersionId
  ) {
    throw new Error(
      "Fresh-0016 final verification activation chain lost its exact candidate, baseline, or upload evidence.",
    );
  }
  const activation = verifyWorkerCandidateActivationEvidence({
    uploadEvidence: input.upload.value,
    uploadEvidenceSha256: input.upload.sha256,
    stagedEvidence: input.staged.value,
    stagedEvidenceSha256: input.staged.sha256,
    activationEvidence: input.activation.value,
    activationEvidenceSha256: input.activation.sha256,
  });
  if (
    Date.parse(activation.createdAt) <=
      Date.parse(input.previousLiveTopologyObservedAt)
  ) {
    throw new Error(
      "Fresh-0016 final verification requires activation after the baseline-only Day-2 topology.",
    );
  }
  const topology = createHistoricalFresh0016FinalActiveTopologyEvidence({
    observedAt: input.now,
    statusOutput: input.statusOutput,
    ...release,
    activationEvidence: activation,
    activationEvidenceSha256: input.activation.sha256,
  });
  if (
    Date.parse(topology.observedAt) <=
      Date.parse(input.previousLiveTopologyObservedAt)
  ) {
    throw new Error(
      "Fresh-0016 final verification requires a new candidate-active topology after the Day-2 envelope.",
    );
  }
  return topology;
}

export function selectHistoricalFresh0016FinalVerificationLiveTopology(
  input: Readonly<{
    currentTopology: HistoricalFresh0016FinalActiveTopologyEvidence;
    authorizedTopology?: HistoricalFresh0016FinalActiveTopologyEvidence;
  }>,
) {
  const current = historicalFresh0016FinalActiveTopologyEvidenceSchema.parse(
    input.currentTopology,
  );
  if (!input.authorizedTopology) return current;
  const authorized =
    historicalFresh0016FinalActiveTopologyEvidenceSchema.parse(
      input.authorizedTopology,
    );
  if (
    Date.parse(current.observedAt) < Date.parse(authorized.observedAt) ||
    historicalFresh0016JsonSha256(current.workerRelease) !==
      historicalFresh0016JsonSha256(authorized.workerRelease) ||
    historicalFresh0016JsonSha256(current.activationEvidence) !==
      historicalFresh0016JsonSha256(authorized.activationEvidence) ||
    historicalFresh0016JsonSha256(current.topology) !==
      historicalFresh0016JsonSha256(authorized.topology) ||
    historicalFresh0016JsonSha256(current.serviceBaseline) !==
      historicalFresh0016JsonSha256(authorized.serviceBaseline)
  ) {
    throw new Error(
      "Fresh-0016 final verification recovery no longer matches the authorized candidate-active topology.",
    );
  }
  return authorized;
}

export function readHistoricalFresh0016FinalVerificationContext(
  input: Readonly<{
    backupDirectory: string;
    cutoverRunId: string;
    now: Date;
  }>,
): HistoricalFresh0016FinalVerificationContext {
  const envelope = readHistoricalFresh0016Day2BudgetEnvelope({
    ...input,
    allowRefined: true,
  });
  const statusOutput = runWrangler([
    "deployments",
    "status",
    "--name",
    "inspirlearning",
    "--json",
  ]);
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(input.backupDirectory),
  );
  const staged = readWorkerCandidateStagedEvidence(
    workerCandidateStagedEvidencePath(input.backupDirectory),
  );
  const activation = readWorkerCandidateActivationEvidence(
    workerCandidateActivationEvidencePath(input.backupDirectory),
  );
  const currentTopology =
    createHistoricalFresh0016FinalVerificationLiveTopology({
      workerRelease: envelope.evidence.workerRelease,
      previousLiveTopologyObservedAt:
        envelope.evidence.liveTopology.observedAt,
      now: input.now,
      statusOutput,
      upload,
      staged,
      activation,
    });
  const authorization =
    readHistoricalDataFresh0016FinalVerificationAuthorizationIfPresent({
      backupDir: input.backupDirectory,
      cutoverRunId: input.cutoverRunId,
    });
  const finalVerificationLiveTopology =
    selectHistoricalFresh0016FinalVerificationLiveTopology({
      currentTopology,
      ...(authorization
        ? {
            authorizedTopology:
              authorization.finalVerificationLiveTopology,
          }
        : {}),
    });
  return Object.freeze({
    evidence: Object.freeze({
      ...envelope.evidence,
      finalVerificationLiveTopology,
    }),
    refineAfterFinalProof: (refinement) => {
      refineHistoricalFresh0016Day2BudgetAfterFinalProof({
        envelope,
        ...refinement,
      });
    },
  });
}

export { historicalFresh0016JsonSha256 };
