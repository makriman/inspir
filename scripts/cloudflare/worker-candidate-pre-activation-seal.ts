import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readAndValidateTranslationSemanticReleaseAttestation,
} from "../translation-semantic-release-attestation";
import {
  CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
  readAndValidateCurrentTranslationFallbackReleaseAttestation,
} from "../staged-translation-fallback-release-attestation";
import {
  type DeployPreflightReport,
  buildSteadyStateDeployPreflightReport,
} from "./deploy-preflight";
import {
  RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
} from "./verify-d1-runtime-migrations";
import {
  RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
} from "./verify-d1-runtime-migration-0017";
import {
  readAndValidateHistoricalFresh0016CutoverComplete,
} from "./verify-historical-data-fresh-0016-cutover-chain";
import {
  assertProductionTopicReconciliationReleaseBinding,
  assertProductionTranslationReconciliationReleaseBinding,
  topicAttestationPath,
  translationAttestationPath,
  type ReleaseSequenceCurrentRelease,
} from "./release-sequence-attestations";
import {
  assertFreshProductionVectorizeReadiness,
  vectorizeReadinessReportPath,
} from "./vectorize-readiness-evidence";
import {
  assertWorkerDeployArtifactEvidenceUnchanged,
  buildWorkerDeployArtifactEvidence,
  type WorkerDeployArtifactEvidence,
} from "./worker-deploy-evidence";
import {
  assertWorkerDeployPreparationUploadBinding,
  assertWorkerDeployPreparationBoundStateUnchanged,
  assertWorkerDeployPreparationMatchesArtifacts,
  readAndValidateWorkerDeployPreparationProvenance,
  type WorkerDeployPreparationHandle,
} from "./worker-deploy-preparation";
import {
  readWorkerCandidateStagedEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateStagedEvidence,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
} from "./worker-candidate-release-evidence";
import {
  assertWorkerCandidateVersionOverrideSmokeInitiallyFresh,
  readAndValidateWorkerCandidateVersionOverrideSmokeEvidence,
  type WorkerCandidateVersionOverrideSmokeEvidenceHandle,
} from "./worker-candidate-version-override-smoke";
import {
  WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND,
  WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS,
  assertFileBackedWorkerCandidatePreActivationSealHandle,
  parseWorkerCandidatePreActivationSeal,
  readWorkerCandidatePreActivationSeal,
  workerCandidatePreActivationCanonicalValueSha256,
  workerCandidatePreActivationPrerequisitesSchema,
  workerCandidatePreActivationSealPath,
  writeWorkerCandidatePreActivationSeal,
  type WorkerCandidatePreActivationPrerequisites,
  type WorkerCandidatePreActivationSeal,
  type WorkerCandidatePreActivationSealHandle,
} from "./worker-candidate-pre-activation-seal-file";
import { resolveBackupDir } from "./migration-config";

export {
  WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS,
  readWorkerCandidatePreActivationSeal,
  workerCandidatePreActivationSealPath,
  type WorkerCandidatePreActivationSeal,
  type WorkerCandidatePreActivationSealHandle,
} from "./worker-candidate-pre-activation-seal-file";

const MAXIMUM_BOUND_PREREQUISITE_BYTES = 64 * 1_024 * 1_024;
const MAXIMUM_PREFLIGHT_AGE_MS = 5 * 60 * 1_000;

type ValidationContext = Readonly<{
  cwd: string;
  backupDirectory: string;
  now: Date;
  uploadHandle: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  stagedHandle: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  workerDeployPreparationHandle: WorkerDeployPreparationHandle;
  artifacts: WorkerDeployArtifactEvidence;
  currentRelease: ReleaseSequenceCurrentRelease;
  versionOverrideSmokeHandle: WorkerCandidateVersionOverrideSmokeEvidenceHandle;
}>;

export type WorkerCandidatePreActivationSealDependencies = Readonly<{
  readDeployPreparation: (input: {
    cwd: string;
    backupDirectory: string;
    now: Date;
    uploadEvidence: WorkerCandidateUploadEvidence;
  }) => WorkerDeployPreparationHandle;
  validatePrerequisites: (
    context: ValidationContext,
  ) => WorkerCandidatePreActivationPrerequisites;
  buildPreflightReport: (context: ValidationContext) => DeployPreflightReport;
}>;

export type WorkerCandidatePreActivationSealOptions = Readonly<{
  cwd?: string;
  backupDirectory?: string;
  now?: Date;
  uploadHandle: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  stagedHandle: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  workerDeployPreparationHandle: WorkerDeployPreparationHandle;
  artifacts: WorkerDeployArtifactEvidence;
  dependencies?: Partial<WorkerCandidatePreActivationSealDependencies>;
}>;

export type CreateWorkerCandidatePreActivationSealOptions =
  WorkerCandidatePreActivationSealOptions &
    Readonly<{
      preflightReport?: DeployPreflightReport;
    }>;

const defaultDependencies: WorkerCandidatePreActivationSealDependencies = {
  readDeployPreparation: (input) =>
    readAndValidateWorkerDeployPreparationProvenance(input),
  validatePrerequisites: validateProductionPrerequisites,
  buildPreflightReport: (context) =>
    buildSteadyStateDeployPreflightReport({
      backupDir: context.backupDirectory,
      cwd: context.cwd,
      nowMs: context.now.getTime(),
      workerTopologyPhase: "candidate-staged",
    }),
};

export function createWorkerCandidatePreActivationSeal(
  options: CreateWorkerCandidatePreActivationSealOptions,
): WorkerCandidatePreActivationSealHandle {
  const context = validateCurrentReleaseContext(options);
  const prerequisites = context.dependencies.validatePrerequisites(context);
  const preflight = validateCandidateStagedPreflight(
    options.preflightReport ??
      context.dependencies.buildPreflightReport(context),
    context,
  );
  const versionOverrideSmoke =
    assertWorkerCandidateVersionOverrideSmokeInitiallyFresh(
      context.versionOverrideSmokeHandle,
      context.now,
    );
  const createdAt = context.now.toISOString();
  const validUntil = new Date(
    context.now.getTime() +
      WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS,
  ).toISOString();
  const release = {
    targetCandidateVersionId:
      context.uploadHandle.value.targetCandidateVersionId,
    serviceBaselineVersionId:
      context.uploadHandle.value.serviceBaselineVersionId,
    uploadEvidenceSha256: context.uploadHandle.sha256,
    stagedEvidenceSha256: context.stagedHandle.sha256,
  } as const;
  const artifacts = artifactIdentity(context.artifacts);
  const preparation = {
    sha256: context.workerDeployPreparationHandle.sha256,
    createdAt: context.workerDeployPreparationHandle.artifact.createdAt,
    validUntil: context.workerDeployPreparationHandle.artifact.validUntil,
  } as const;
  const preflightBinding = preflightEvidence(preflight);
  const versionOverrideSmokeBinding = versionOverrideSmokeEvidence(
    versionOverrideSmoke,
  );
  const prerequisitesSha256 =
    workerCandidatePreActivationCanonicalValueSha256(prerequisites);
  const authorizationMaterial = {
    release,
    git: context.workerDeployPreparationHandle.artifact.git,
    artifacts,
    preparation,
    preflight: preflightBinding,
    versionOverrideSmoke: versionOverrideSmokeBinding,
    prerequisites,
    prerequisitesSha256,
  } as const;
  const value = parseWorkerCandidatePreActivationSeal({
    kind: WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND,
    schemaVersion: 1,
    phase: "candidate-staged",
    createdAt,
    validUntil,
    maximumAgeMs: WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS,
    backupDirectory: context.backupDirectory,
    ...authorizationMaterial,
    authorizationMaterialSha256:
      workerCandidatePreActivationCanonicalValueSha256(
        authorizationMaterial,
      ),
  });
  return writeWorkerCandidatePreActivationSeal(
    workerCandidatePreActivationSealPath(context.backupDirectory),
    value,
  );
}

export function readAndValidateWorkerCandidatePreActivationSeal(
  options: WorkerCandidatePreActivationSealOptions,
): WorkerCandidatePreActivationSealHandle {
  const context = validateCurrentReleaseContext(options);
  const handle = assertFileBackedWorkerCandidatePreActivationSealHandle(
    readWorkerCandidatePreActivationSeal(
      workerCandidatePreActivationSealPath(context.backupDirectory),
    ),
    workerCandidatePreActivationSealPath(context.backupDirectory),
  );
  const value = handle.value;
  const nowMs = context.now.getTime();
  const createdAtMs = Date.parse(value.createdAt);
  const validUntilMs = Date.parse(value.validUntil);
  if (
    value.backupDirectory !== context.backupDirectory ||
    value.release.targetCandidateVersionId !==
      context.uploadHandle.value.targetCandidateVersionId ||
    value.release.serviceBaselineVersionId !==
      context.uploadHandle.value.serviceBaselineVersionId ||
    value.release.uploadEvidenceSha256 !== context.uploadHandle.sha256 ||
    value.release.stagedEvidenceSha256 !== context.stagedHandle.sha256 ||
    value.versionOverrideSmoke.evidence.sha256 !==
      context.versionOverrideSmokeHandle.sha256 ||
    workerCandidatePreActivationCanonicalValueSha256(
      value.versionOverrideSmoke,
    ) !==
      workerCandidatePreActivationCanonicalValueSha256(
        versionOverrideSmokeEvidence(context.versionOverrideSmokeHandle),
      ) ||
    value.preparation.sha256 !==
      context.workerDeployPreparationHandle.sha256 ||
    value.git.head !==
      context.workerDeployPreparationHandle.artifact.git.head ||
    value.git.upstream !==
      context.workerDeployPreparationHandle.artifact.git.upstream ||
    value.git.upstreamRef !==
      context.workerDeployPreparationHandle.artifact.git.upstreamRef ||
    !sameArtifactIdentity(value.artifacts, context.artifacts) ||
    nowMs < createdAtMs ||
    nowMs > validUntilMs ||
    validUntilMs !==
      createdAtMs + WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS
  ) {
    throw new Error(
      "Worker candidate pre-activation seal is stale or no longer binds the exact candidate, preparation, Git, and artifacts.",
    );
  }
  const currentPrerequisites =
    context.dependencies.validatePrerequisites(context);
  if (
    workerCandidatePreActivationCanonicalValueSha256(currentPrerequisites) !==
      value.prerequisitesSha256 ||
    workerCandidatePreActivationCanonicalValueSha256(value.prerequisites) !==
      value.prerequisitesSha256
  ) {
    throw new Error(
      "Worker candidate pre-activation prerequisites changed after authorization.",
    );
  }
  return handle;
}

function validateCurrentReleaseContext(
  options: WorkerCandidatePreActivationSealOptions,
) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDirectory = path.resolve(
    options.backupDirectory ?? resolveBackupDir(),
  );
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Worker candidate pre-activation clock is invalid.");
  }
  const dependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const uploadHandle = requireUploadHandle(
    backupDirectory,
    options.uploadHandle,
  );
  const stagedHandle = requireStagedHandle(
    backupDirectory,
    options.stagedHandle,
  );
  verifyWorkerCandidateStagedEvidence({
    uploadEvidence: uploadHandle.value,
    uploadEvidenceSha256: uploadHandle.sha256,
    stagedEvidence: stagedHandle.value,
    stagedEvidenceSha256: stagedHandle.sha256,
  });
  const versionOverrideSmokeHandle =
    readAndValidateWorkerCandidateVersionOverrideSmokeEvidence({
      backupDirectory,
      now,
      uploadHandle,
      stagedHandle,
    });
  const currentPreparation = dependencies.readDeployPreparation({
    cwd,
    backupDirectory,
    now,
    uploadEvidence: uploadHandle.value,
  });
  if (
    path.resolve(currentPreparation.path) !==
      path.resolve(options.workerDeployPreparationHandle.path) ||
    currentPreparation.sha256 !== options.workerDeployPreparationHandle.sha256
  ) {
    throw new Error(
      "Worker candidate activation did not retain the exact fresh deploy preparation.",
    );
  }
  assertWorkerDeployPreparationBoundStateUnchanged({
    handle: currentPreparation,
    cwd,
    backupDirectory,
  });
  assertWorkerDeployPreparationMatchesArtifacts(
    currentPreparation,
    options.artifacts,
  );
  assertWorkerDeployArtifactEvidenceUnchanged(options.artifacts);
  assertUploadMatchesRelease({
    upload: uploadHandle.value,
    preparation: currentPreparation,
    artifacts: options.artifacts,
  });
  const currentRelease: ReleaseSequenceCurrentRelease = {
    phase: "uploaded-inactive",
    targetCandidateVersionId: uploadHandle.value.targetCandidateVersionId,
    serviceBaselineVersionId: uploadHandle.value.serviceBaselineVersionId,
    uploadEvidenceSha256: uploadHandle.sha256,
    phaseEvidenceSha256: uploadHandle.sha256,
    phaseEvidenceCreatedAt: uploadHandle.value.createdAt,
    soleServingVersionId: uploadHandle.value.serviceBaselineVersionId,
    git: uploadHandle.value.git,
    artifactEvidence: options.artifacts,
  };
  return Object.freeze({
    cwd,
    backupDirectory,
    now,
    uploadHandle,
    stagedHandle,
    workerDeployPreparationHandle: currentPreparation,
    artifacts: options.artifacts,
    currentRelease,
    versionOverrideSmokeHandle,
    dependencies,
  });
}

function validateProductionPrerequisites(
  context: ValidationContext,
): WorkerCandidatePreActivationPrerequisites {
  const vectorize = assertFreshProductionVectorizeReadiness({
    backupDir: context.backupDirectory,
    currentRelease: context.currentRelease,
    requiredPhase: "uploaded-inactive",
    now: context.now,
  });
  const topic = assertProductionTopicReconciliationReleaseBinding({
    backupDir: context.backupDirectory,
    currentRelease: context.currentRelease,
  });
  const translation =
    assertProductionTranslationReconciliationReleaseBinding({
      backupDir: context.backupDirectory,
      currentRelease: context.currentRelease,
    });
  const cutover = readAndValidateHistoricalFresh0016CutoverComplete({
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
  });
  const semanticTranslations = translationReleasePrerequisite(context.cwd);
  if (
    cutover.artifact.paths.backupDirectory !== context.backupDirectory ||
    cutover.artifact.sourceFingerprint.sha256 !==
      context.artifacts.sourceFingerprint.sha256 ||
    cutover.artifact.sourceFingerprint.fileCount !==
      context.artifacts.sourceFingerprint.fileCount ||
    cutover.artifact.workerRelease.phase !== "uploaded-inactive" ||
    cutover.artifact.workerRelease.targetCandidateVersionId !==
      context.uploadHandle.value.targetCandidateVersionId ||
    cutover.artifact.workerRelease.serviceBaselineVersionId !==
      context.uploadHandle.value.serviceBaselineVersionId ||
    cutover.artifact.workerRelease.uploadEvidenceSha256 !==
      context.uploadHandle.sha256 ||
    cutover.artifact.finalizationLiveTopology.workerRelease
      .targetCandidateVersionId !==
      context.uploadHandle.value.targetCandidateVersionId ||
    cutover.artifact.finalizationLiveTopology.workerRelease
      .serviceBaselineVersionId !==
      context.uploadHandle.value.serviceBaselineVersionId ||
    cutover.artifact.finalizationLiveTopology.workerRelease
      .uploadEvidenceSha256 !== context.uploadHandle.sha256 ||
    cutover.artifact.finalizationLiveTopology.topology
      .serviceBaselineVersionId !==
      context.uploadHandle.value.serviceBaselineVersionId ||
    cutover.artifact.finalizationLiveTopology.targetCandidate.versionId !==
      context.uploadHandle.value.targetCandidateVersionId ||
    cutover.artifact.finalizationLiveTopology.targetCandidate.state !==
      "absent" ||
    cutover.artifact.continuity.outboxRowsBeforeActivation !== 0
  ) {
    throw new Error(
      "Fresh-0016 cutover completion does not bind the exact candidate, source, backup, and empty pre-activation outbox boundary.",
    );
  }
  const runtimeMigrations = readPrivateEvidence(
    path.join(
      context.backupDirectory,
      RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
    ),
    context.backupDirectory,
  );
  const runtimeMigration0017 = readPrivateEvidence(
    path.join(
      context.backupDirectory,
      RUNTIME_MIGRATION_0017_EVIDENCE_RELATIVE_PATH,
    ),
    context.backupDirectory,
  );
  return workerCandidatePreActivationPrerequisitesSchema.parse({
    vectorize: {
      evidence: readPrivateEvidence(
        vectorizeReadinessReportPath(context.backupDirectory),
        context.backupDirectory,
      ).binding,
      createdAt: vectorize.createdAt,
      phase: "uploaded-inactive",
      soleServingVersionId:
        vectorize.servingObservation.soleServingVersionId,
      vectorCount: vectorize.vectorize.vectorCount,
    },
    topic: {
      evidence: readPrivateEvidence(
        topicAttestationPath(context.backupDirectory),
        context.backupDirectory,
      ).binding,
      createdAt: topic.createdAt,
      seedSha256: topic.topic.seedSha256,
      verifiedTopics: topic.topic.verifiedTopics,
      verifiedArchivedTopics: topic.topic.verifiedArchivedTopics,
    },
    translation: {
      evidence: readPrivateEvidence(
        translationAttestationPath(context.backupDirectory),
        context.backupDirectory,
      ).binding,
      createdAt: translation.createdAt,
      method: translation.method,
      remoteQueries: requireTranslationVerification(translation).remoteQueries,
      billedRowsRead:
        requireTranslationVerification(translation).billedRowsRead,
      repairApplied:
        requireTranslationVerification(translation).repairApplied,
    },
    runtimeMigrations0013To0016: {
      evidence: runtimeMigrations.binding,
      createdAt: evidenceCreatedAt(runtimeMigrations.bytes),
    },
    runtimeMigration0017: {
      evidence: runtimeMigration0017.binding,
      createdAt: evidenceCreatedAt(runtimeMigration0017.bytes),
    },
    fresh0016Cutover: {
      evidence: {
        scope: "backup",
        absolutePath: cutover.path,
        bytes: cutover.bytes,
        sha256: cutover.sha256,
      },
      createdAt: cutover.artifact.createdAt,
      cutoverRunId: cutover.artifact.cutoverRunId,
      workerRelease: cutover.artifact.workerRelease,
      finalizationLiveTopologySha256:
        workerCandidatePreActivationCanonicalValueSha256(
          cutover.artifact.finalizationLiveTopology,
        ),
      serviceBaselineDeploymentId:
        cutover.artifact.finalizationLiveTopology.topology.deploymentId,
      targetCandidateState: "absent",
      predecessorPrerequisitesSha256:
        cutover.artifact.evidence.predecessorPrerequisitesSha256,
      continuityDecisionsSha256:
        cutover.artifact.continuity.decisionsSha256,
      outboxRowsBeforeActivation: 0,
    },
    semanticTranslations,
  });
}

function translationReleasePrerequisite(
  workspaceRoot: string,
): WorkerCandidatePreActivationPrerequisites["semanticTranslations"] {
  try {
    const semantic = readAndValidateTranslationSemanticReleaseAttestation({
      workspaceRoot,
    });
    return {
      releaseMode: "full-semantic",
      evidence: {
        scope: "workspace",
        absolutePath: semantic.path,
        bytes: semantic.bytes,
        sha256: semantic.sha256,
      },
      curatedTreeSha256: semantic.artifact.curatedTree.sha256,
      semanticEvidenceSha256:
        semantic.artifact.semanticEvidence.semanticEvidenceSha256,
    };
  } catch (fullSemanticError) {
    try {
      const staged =
        readAndValidateCurrentTranslationFallbackReleaseAttestation({
          workspaceRoot,
        });
      return {
        releaseMode: "staged-canonical-English-fallback",
        sitePromotionMode: "none-current-availability",
        attestationKind: CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
        evidence: {
          scope: "workspace",
          absolutePath: staged.path,
          bytes: staged.bytes,
          sha256: staged.sha256,
        },
        curatedTreeSha256:
          staged.artifact.inventory.curatedSiteTree.sha256,
        inventoryEvidenceSha256:
          staged.artifact.inventory.cleanTargetSetSha256,
        availabilityManifestSha256:
          staged.artifact.inventory.availabilityManifest.fileSha256,
        localizedHtmlPathsSha256:
          staged.artifact.inventory.availabilityManifest
            .localizedHtmlPathsSha256,
        pendingLedgerSha256:
          staged.artifact.inventory.pendingLedger.sha256,
      };
    } catch (stagedError) {
      throw new Error(
        `Neither translation release prerequisite is valid. Full semantic: ${errorMessage(fullSemanticError)} Staged fallback: ${errorMessage(stagedError)}`,
      );
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function validateCandidateStagedPreflight(
  report: DeployPreflightReport,
  context: ValidationContext,
) {
  const createdAtMs = Date.parse(report.createdAt);
  const ageMs = context.now.getTime() - createdAtMs;
  const names = report.checks.map((check) => check.name);
  if (
    report.mode !== "steady-state" ||
    report.workerTopologyPhase !== "candidate-staged" ||
    path.resolve(report.backupDir) !== context.backupDirectory ||
    report.ok !== true ||
    report.checks.length === 0 ||
    report.checks.some((check) => check.status !== "pass") ||
    new Set(names).size !== names.length ||
    !Number.isFinite(createdAtMs) ||
    ageMs < 0 ||
    ageMs > MAXIMUM_PREFLIGHT_AGE_MS
  ) {
    throw new Error(
      "Pre-activation seal requires one fresh, complete, passing candidate-staged deploy preflight.",
    );
  }
  return report;
}

function preflightEvidence(report: DeployPreflightReport) {
  return {
    workerTopologyPhase: "candidate-staged" as const,
    createdAt: report.createdAt,
    reportCanonicalSha256:
      workerCandidatePreActivationCanonicalValueSha256(report),
    checksCanonicalSha256:
      workerCandidatePreActivationCanonicalValueSha256(report.checks),
    passedChecks: report.checks.length,
  };
}

function versionOverrideSmokeEvidence(
  handle: WorkerCandidateVersionOverrideSmokeEvidenceHandle,
) {
  const value = handle.value;
  return {
    evidence: {
      scope: "backup" as const,
      absolutePath: handle.path,
      bytes: handle.bytes,
      sha256: handle.sha256,
    },
    createdAt: value.createdAt,
    validUntil: value.validUntil,
    targetCandidateVersionId: value.release.targetCandidateVersionId,
    serviceBaselineVersionId: value.release.serviceBaselineVersionId,
    uploadEvidenceSha256: value.release.uploadEvidenceSha256,
    stagedEvidenceSha256: value.release.stagedEvidenceSha256,
    stagedDeploymentId: value.release.stagedDeploymentId,
    stagedTopologySha256: value.release.stagedTopologySha256,
    unpinnedResponseSha256: value.unpinnedResponseSha256,
    candidateResponseSha256: value.candidateResponseSha256,
  } as const;
}

function requireUploadHandle(
  backupDirectory: string,
  handle: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
) {
  const expected = workerCandidateUploadEvidencePath(backupDirectory);
  const persisted = readWorkerCandidateUploadEvidence(expected);
  if (
    path.resolve(handle.path) !== expected ||
    handle.sha256 !== persisted.sha256
  ) {
    throw new Error(
      "Pre-activation upload handle is not the canonical immutable upload evidence.",
    );
  }
  return persisted;
}

function requireStagedHandle(
  backupDirectory: string,
  handle: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>,
) {
  const expected = workerCandidateStagedEvidencePath(backupDirectory);
  const persisted = readWorkerCandidateStagedEvidence(expected);
  if (
    path.resolve(handle.path) !== expected ||
    handle.sha256 !== persisted.sha256
  ) {
    throw new Error(
      "Pre-activation staged handle is not the canonical immutable staged evidence.",
    );
  }
  return persisted;
}

function assertUploadMatchesRelease(input: {
  upload: WorkerCandidateUploadEvidence;
  preparation: WorkerDeployPreparationHandle;
  artifacts: WorkerDeployArtifactEvidence;
}) {
  assertWorkerDeployPreparationUploadBinding(
    input.preparation,
    input.upload,
  );
  const expected = artifactIdentity(input.artifacts);
  if (
    input.upload.git.head !== input.preparation.artifact.git.head ||
    input.upload.git.upstream !== input.preparation.artifact.git.upstream ||
    input.upload.git.upstreamRef !==
      input.preparation.artifact.git.upstreamRef ||
    JSON.stringify(input.upload.artifacts) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "Uploaded candidate does not match the fresh preparation, pushed Git, or current artifacts.",
    );
  }
}

function artifactIdentity(artifacts: WorkerDeployArtifactEvidence) {
  return {
    sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
    sourceFingerprintFileCount: artifacts.sourceFingerprint.fileCount,
    workerSourceSha256: artifacts.workerSourceSha256,
    wranglerConfigSha256: artifacts.wranglerConfigSha256,
    assetManifestSha256: artifacts.assetManifest.sha256,
    assetManifestFileCount: artifacts.assetManifest.fileCount,
    assetManifestBytes: artifacts.assetManifest.bytes,
  } as const;
}

function sameArtifactIdentity(
  sealed: WorkerCandidatePreActivationSeal["artifacts"],
  current: WorkerDeployArtifactEvidence,
) {
  return JSON.stringify(sealed) === JSON.stringify(artifactIdentity(current));
}

function requireTranslationVerification(
  report: ReturnType<
    typeof assertProductionTranslationReconciliationReleaseBinding
  >,
) {
  if (report.verification === null) {
    throw new Error(
      "Translation reconciliation has no successful verification evidence.",
    );
  }
  return report.verification;
}

function readPrivateEvidence(file: string, root: string) {
  const absolute = path.resolve(file);
  const relative = path.relative(path.resolve(root), absolute);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Pre-activation prerequisite escaped its backup root.");
  }
  const descriptor = fs.openSync(
    absolute,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      (before.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === "function" && before.uid !== process.getuid())
    ) {
      throw new Error(
        `Pre-activation prerequisite must be a one-link owner-only file: ${absolute}.`,
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAXIMUM_BOUND_PREREQUISITE_BYTES
    ) {
      throw new Error(
        `Pre-activation prerequisite changed during read: ${absolute}.`,
      );
    }
    return Object.freeze({
      binding: Object.freeze({
        scope: "backup" as const,
        absolutePath: absolute,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
      bytes,
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function evidenceCreatedAt(bytes: Buffer) {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error("Pre-activation prerequisite is not valid JSON.", {
      cause: error,
    });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "string" ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    throw new Error(
      "Pre-activation prerequisite has no canonical createdAt timestamp.",
    );
  }
  return value.createdAt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const cwd = process.cwd();
    const backupDirectory = resolveBackupDir();
    const now = new Date();
    const uploadHandle = readWorkerCandidateUploadEvidence(
      workerCandidateUploadEvidencePath(backupDirectory),
    );
    const stagedHandle = readWorkerCandidateStagedEvidence(
      workerCandidateStagedEvidencePath(backupDirectory),
    );
    const workerDeployPreparationHandle =
      readAndValidateWorkerDeployPreparationProvenance({
        cwd,
        backupDirectory,
        now,
        uploadEvidence: uploadHandle.value,
      });
    const handle = createWorkerCandidatePreActivationSeal({
      cwd,
      backupDirectory,
      now,
      uploadHandle,
      stagedHandle,
      workerDeployPreparationHandle,
      artifacts: buildWorkerDeployArtifactEvidence(cwd),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: handle.path,
          sha256: handle.sha256,
          createdAt: handle.value.createdAt,
          validUntil: handle.value.validUntil,
          targetCandidateVersionId:
            handle.value.release.targetCandidateVersionId,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
