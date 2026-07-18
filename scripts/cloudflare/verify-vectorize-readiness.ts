import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertGitReleaseIdentity,
  type GitReleaseIdentity,
} from "./git-release-identity";
import {
  resolveBackupDir,
  runWrangler,
  VECTORIZE_INDEX_NAME,
  type RunCommandOptions,
} from "./migration-config";
import {
  buildWorkerDeployArtifactEvidence,
  type WorkerDeployArtifactEvidence,
} from "./worker-deploy-evidence";
import type { ReleaseSequenceServingPhase } from "./release-sequence-attestations";
import {
  createVectorizeReadinessReport,
  parseVectorizeIndexConfigurationOutput,
  parseVectorizeInfoOutput,
  parseVectorizeMetadataIndexesOutput,
  readConfiguredVectorizeBinding,
  writeVectorizeReadinessReport,
  type VectorizeReadinessCurrentRelease,
  type VectorizeReadinessReport,
} from "./vectorize-readiness-evidence";
import {
  parseWorkerDeploymentStatusOutput,
  readWorkerCandidateActivationEvidence,
  readWorkerCandidateStagedEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateActivationEvidence,
  verifyWorkerCandidateStagedEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  type WorkerCandidateActivationEvidence,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
  type WorkerDeploymentStatus,
} from "./worker-candidate-release-evidence";

type ReadOnlyWranglerRunner = (args: string[], options?: RunCommandOptions) => string;

export type VerifyVectorizeReadinessOptions = {
  confirmed: boolean;
  remote: boolean;
  phase: ReleaseSequenceServingPhase;
  candidateVersionId: string;
  backupDir?: string;
  cwd?: string;
};

export type VerifyVectorizeReadinessDependencies = {
  readGitIdentity?: (cwd: string) => GitReleaseIdentity;
  buildArtifactEvidence?: (cwd: string) => WorkerDeployArtifactEvidence;
  readUploadEvidence?: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  readStagedEvidence?: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  readActivationEvidence?: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
  readDeploymentStatus?: (runner: ReadOnlyWranglerRunner) => WorkerDeploymentStatus;
  runner?: ReadOnlyWranglerRunner;
  clock?: () => Date;
  writeReport?: (report: VectorizeReadinessReport, backupDir: string) => string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseVectorizeReadinessCli(process.argv.slice(2));
    const report = verifyProductionVectorizeReadiness(options);
    console.log(JSON.stringify({
      ok: report.ok,
      phase: report.phase,
      targetCandidateVersionId: report.release.targetCandidateVersionId,
      serviceBaselineVersionId: report.release.serviceBaselineVersionId,
      uploadEvidenceSha256: report.release.uploadEvidenceSha256,
      sourceFingerprintSha256:
        report.release.artifactEvidence.sourceFingerprintSha256,
      vectorize: report.vectorize,
      readOnly: report.readOnly,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Vectorize readiness verification failed.");
    process.exitCode = 1;
  }
}

export function verifyProductionVectorizeReadiness(
  options: VerifyVectorizeReadinessOptions,
  dependencies: VerifyVectorizeReadinessDependencies = {},
) {
  if (!options.remote || !options.confirmed) {
    throw new Error(
      "Production Vectorize readiness requires --remote and --confirm-production.",
    );
  }
  const candidateVersionId = requireWorkerVersion(options.candidateVersionId);
  const phase = requireServingPhase(options.phase);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDir = path.resolve(options.backupDir ?? resolveBackupDir());
  const readGitIdentity = dependencies.readGitIdentity ??
    ((releaseCwd: string) => assertGitReleaseIdentity({ cwd: releaseCwd }));
  const buildArtifactEvidence = dependencies.buildArtifactEvidence ?? buildWorkerDeployArtifactEvidence;
  const runner = dependencies.runner ?? ((args, runnerOptions) => runWrangler(args, runnerOptions));
  const readUploadEvidence =
    dependencies.readUploadEvidence ?? readWorkerCandidateUploadEvidence;
  const readStagedEvidence =
    dependencies.readStagedEvidence ?? readWorkerCandidateStagedEvidence;
  const readActivationEvidence =
    dependencies.readActivationEvidence ?? readWorkerCandidateActivationEvidence;
  const readDeploymentStatus =
    dependencies.readDeploymentStatus ??
    ((readRunner: ReadOnlyWranglerRunner) =>
      parseWorkerDeploymentStatusOutput(
        readRunner(
          ["deployments", "status", "--name", "inspirlearning", "--json"],
          { maxBuffer: 64 * 1_024, timeoutMs: 60_000 },
        ),
      ));
  const clock = dependencies.clock ?? (() => new Date());
  const writeReport = dependencies.writeReport ?? writeVectorizeReadinessReport;

  const configuredBefore = readConfiguredVectorizeBinding(cwd);
  const releaseBefore = readCandidateReleaseIdentity({
    cwd,
    backupDir,
    phase,
    candidateVersionId,
    readGitIdentity,
    buildArtifactEvidence,
    readUploadEvidence,
    readStagedEvidence,
    readActivationEvidence,
    readDeploymentStatus,
    runner,
  });
  const observedBeforeAt = validClock(clock()).toISOString();

  const indexOutput = runner(
    ["vectorize", "get", VECTORIZE_INDEX_NAME, "--json"],
    { maxBuffer: 64 * 1_024, timeoutMs: 60_000 },
  );
  const infoOutput = runner(
    ["vectorize", "info", VECTORIZE_INDEX_NAME, "--json"],
    { maxBuffer: 64 * 1_024, timeoutMs: 60_000 },
  );
  const metadataOutput = runner(
    ["vectorize", "list-metadata-index", VECTORIZE_INDEX_NAME, "--json"],
    { maxBuffer: 64 * 1_024, timeoutMs: 60_000 },
  );
  const vectorizeIndex = parseVectorizeIndexConfigurationOutput(indexOutput);
  const vectorizeInfo = parseVectorizeInfoOutput(infoOutput);
  const metadataIndexes = parseVectorizeMetadataIndexesOutput(metadataOutput);

  const configuredAfter = readConfiguredVectorizeBinding(cwd);
  const releaseAfter = readCandidateReleaseIdentity({
    cwd,
    backupDir,
    phase,
    candidateVersionId,
    readGitIdentity,
    buildArtifactEvidence,
    readUploadEvidence,
    readStagedEvidence,
    readActivationEvidence,
    readDeploymentStatus,
    runner,
  });
  const observedAfterAt = validClock(clock()).toISOString();
  if (
    configuredBefore.binding !== configuredAfter.binding ||
    configuredBefore.indexName !== configuredAfter.indexName
  ) {
    throw new Error("Vectorize binding changed during readiness verification.");
  }
  assertStableCandidateReleaseIdentity(releaseBefore, releaseAfter);

  const now = validClock(clock());
  const report = createVectorizeReadinessReport({
    createdAt: now.toISOString(),
    backupDir,
    currentRelease: releaseAfter.currentRelease,
    servingObservation: { observedBeforeAt, observedAfterAt },
    vectorizeIndex,
    vectorizeInfo,
    metadataIndexes,
  });
  writeReport(report, backupDir);
  return report;
}

export function parseVectorizeReadinessCli(args: readonly string[]): VerifyVectorizeReadinessOptions {
  let remote = false;
  let confirmed = false;
  let phase: ReleaseSequenceServingPhase | undefined;
  let candidateVersionId = "";
  let backupDir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote" && !remote) remote = true;
    else if (argument === "--confirm-production" && !confirmed) confirmed = true;
    else if (argument === "--phase" && phase === undefined) {
      phase = requireServingPhase(args[index + 1]);
      index += 1;
    }
    else if (argument === "--candidate-version" && !candidateVersionId) {
      candidateVersionId = args[index + 1] ?? "";
      index += 1;
    } else if (argument === "--backup" && backupDir === undefined) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Vectorize readiness --backup requires a directory path.");
      }
      backupDir = value;
      index += 1;
    } else {
      throw new Error(`Unsupported or duplicate Vectorize readiness argument: ${argument ?? "<missing>"}.`);
    }
  }
  return {
    remote,
    confirmed,
    phase: requireServingPhase(phase),
    candidateVersionId: requireWorkerVersion(candidateVersionId),
    ...(backupDir ? { backupDir: path.resolve(backupDir) } : {}),
  };
}

function readCandidateReleaseIdentity(input: {
  cwd: string;
  backupDir: string;
  phase: ReleaseSequenceServingPhase;
  candidateVersionId: string;
  readGitIdentity: (cwd: string) => GitReleaseIdentity;
  buildArtifactEvidence: (cwd: string) => WorkerDeployArtifactEvidence;
  readUploadEvidence: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  readStagedEvidence: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  readActivationEvidence: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
  readDeploymentStatus: (runner: ReadOnlyWranglerRunner) => WorkerDeploymentStatus;
  runner: ReadOnlyWranglerRunner;
}) {
  const git = input.readGitIdentity(input.cwd);
  const artifactEvidence = input.buildArtifactEvidence(input.cwd);
  const phaseEvidence = readCandidatePhaseEvidence(input);
  assertCandidateArgumentAndSourceIdentity({
    candidateVersionId: input.candidateVersionId,
    upload: phaseEvidence.upload,
    git,
    artifactEvidence,
  });
  const deployment = input.readDeploymentStatus(input.runner);
  const stagedTopologyEvidence =
    input.phase === "uploaded-inactive" &&
    deployment.versions.some(
      (entry) =>
        entry.versionId === phaseEvidence.upload.value.targetCandidateVersionId &&
        entry.percentage === 0,
    )
      ? input.readStagedEvidence(
          workerCandidateStagedEvidencePath(input.backupDir),
        )
      : undefined;
  if (stagedTopologyEvidence !== undefined) {
    verifyWorkerCandidateStagedEvidence({
      uploadEvidence: phaseEvidence.upload.value,
      uploadEvidenceSha256: phaseEvidence.upload.sha256,
      stagedEvidence: stagedTopologyEvidence.value,
      stagedEvidenceSha256: stagedTopologyEvidence.sha256,
    });
  }
  const soleServingVersionId = assertPhaseServingTopology({
    phase: input.phase,
    deployment,
    upload: phaseEvidence.upload,
    activation:
      phaseEvidence.phase === "candidate-active"
        ? phaseEvidence.activation
        : undefined,
    stagedTopologyEvidence,
  });
  return {
    currentRelease: {
      phase: input.phase,
      targetCandidateVersionId:
        phaseEvidence.upload.value.targetCandidateVersionId,
      serviceBaselineVersionId:
        phaseEvidence.upload.value.serviceBaselineVersionId,
      uploadEvidenceSha256: phaseEvidence.upload.sha256,
      phaseEvidenceSha256: phaseEvidence.phaseEvidenceSha256,
      phaseEvidenceCreatedAt: phaseEvidence.phaseEvidenceCreatedAt,
      soleServingVersionId,
      git,
      artifactEvidence,
    } satisfies VectorizeReadinessCurrentRelease,
    phaseEvidence,
    stagedTopologyEvidence,
    deployment,
  };
}

function assertStableCandidateReleaseIdentity(
  before: ReturnType<typeof readCandidateReleaseIdentity>,
  after: ReturnType<typeof readCandidateReleaseIdentity>,
) {
  const beforeRelease = before.currentRelease;
  const afterRelease = after.currentRelease;
  if (
    beforeRelease.phase !== afterRelease.phase ||
    beforeRelease.targetCandidateVersionId !==
      afterRelease.targetCandidateVersionId ||
    beforeRelease.serviceBaselineVersionId !==
      afterRelease.serviceBaselineVersionId ||
    beforeRelease.uploadEvidenceSha256 !== afterRelease.uploadEvidenceSha256 ||
    beforeRelease.phaseEvidenceSha256 !== afterRelease.phaseEvidenceSha256 ||
    beforeRelease.phaseEvidenceCreatedAt !== afterRelease.phaseEvidenceCreatedAt ||
    beforeRelease.soleServingVersionId !== afterRelease.soleServingVersionId ||
    beforeRelease.git.head !== afterRelease.git.head ||
    beforeRelease.git.upstream !== afterRelease.git.upstream ||
    beforeRelease.git.upstreamRef !== afterRelease.git.upstreamRef ||
    !sameArtifacts(beforeRelease.artifactEvidence, afterRelease.artifactEvidence) ||
    before.stagedTopologyEvidence?.sha256 !==
      after.stagedTopologyEvidence?.sha256 ||
    before.deployment.deploymentId !== after.deployment.deploymentId ||
    !sameDeploymentVersions(
      before.deployment.versions,
      after.deployment.versions,
    )
  ) {
    throw new Error(
      "Candidate source, immutable phase evidence, or serving topology changed during Vectorize readiness verification.",
    );
  }
}

type CandidatePhaseEvidence =
  | Readonly<{
      phase: "uploaded-inactive";
      upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
      phaseEvidenceSha256: string;
      phaseEvidenceCreatedAt: string;
    }>
  | Readonly<{
      phase: "candidate-active";
      upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
      staged: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
      activation: WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
      phaseEvidenceSha256: string;
      phaseEvidenceCreatedAt: string;
    }>;

function readCandidatePhaseEvidence(input: {
  backupDir: string;
  phase: ReleaseSequenceServingPhase;
  readUploadEvidence: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  readStagedEvidence: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  readActivationEvidence: (
    file: string,
  ) => WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
}): CandidatePhaseEvidence {
  const upload = input.readUploadEvidence(
    workerCandidateUploadEvidencePath(input.backupDir),
  );
  if (input.phase === "uploaded-inactive") {
    return {
      phase: input.phase,
      upload,
      phaseEvidenceSha256: upload.sha256,
      phaseEvidenceCreatedAt: upload.value.createdAt,
    };
  }
  const staged = input.readStagedEvidence(
    workerCandidateStagedEvidencePath(input.backupDir),
  );
  const activation = input.readActivationEvidence(
    workerCandidateActivationEvidencePath(input.backupDir),
  );
  verifyWorkerCandidateActivationEvidence({
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
    activationEvidence: activation.value,
    activationEvidenceSha256: activation.sha256,
  });
  return {
    phase: input.phase,
    upload,
    staged,
    activation,
    phaseEvidenceSha256: activation.sha256,
    phaseEvidenceCreatedAt: activation.value.createdAt,
  };
}

function assertCandidateArgumentAndSourceIdentity(input: {
  candidateVersionId: string;
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  git: GitReleaseIdentity;
  artifactEvidence: WorkerDeployArtifactEvidence;
}) {
  const upload = input.upload.value;
  const artifacts = input.artifactEvidence;
  if (input.candidateVersionId !== upload.targetCandidateVersionId) {
    throw new Error(
      "Vectorize readiness --candidate-version does not match immutable upload evidence.",
    );
  }
  if (
    input.git.head !== upload.git.head ||
    input.git.upstream !== upload.git.upstream ||
    input.git.upstreamRef !== upload.git.upstreamRef ||
    input.git.head !== input.git.upstream
  ) {
    throw new Error(
      "Vectorize readiness clean pushed Git identity does not match immutable upload evidence.",
    );
  }
  if (
    artifacts.sourceFingerprint.sha256 !==
      upload.artifacts.sourceFingerprintSha256 ||
    artifacts.sourceFingerprint.fileCount !==
      upload.artifacts.sourceFingerprintFileCount ||
    artifacts.workerSourceSha256 !== upload.artifacts.workerSourceSha256 ||
    artifacts.wranglerConfigSha256 !== upload.artifacts.wranglerConfigSha256 ||
    artifacts.assetManifest.sha256 !== upload.artifacts.assetManifestSha256 ||
    artifacts.assetManifest.fileCount !==
      upload.artifacts.assetManifestFileCount ||
    artifacts.assetManifest.bytes !== upload.artifacts.assetManifestBytes
  ) {
    throw new Error(
      "Vectorize readiness source or immutable Worker artifacts do not match upload evidence.",
    );
  }
}

function assertPhaseServingTopology(input: {
  phase: ReleaseSequenceServingPhase;
  deployment: WorkerDeploymentStatus;
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  activation?: WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
  stagedTopologyEvidence?: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
}) {
  const candidate = input.upload.value.targetCandidateVersionId;
  const baseline = input.upload.value.serviceBaselineVersionId;
  const percentages = new Map(
    input.deployment.versions.map((entry) => [entry.versionId, entry.percentage]),
  );
  if (input.phase === "uploaded-inactive") {
    const topologyIsBaselineOnly =
      input.deployment.versions.length === 1 &&
      percentages.get(baseline) === 100;
    const topologyIsStagedZeroTraffic =
      input.deployment.versions.length === 2 &&
      percentages.get(baseline) === 100 &&
      percentages.get(candidate) === 0 &&
      input.stagedTopologyEvidence !== undefined &&
      input.deployment.deploymentId ===
        input.stagedTopologyEvidence.value.topology.deploymentId;
    if (!topologyIsBaselineOnly && !topologyIsStagedZeroTraffic) {
      throw new Error(
        "Uploaded-inactive Vectorize readiness requires the exact service baseline as the sole 100% serving version (with only the target candidate optionally present at 0%).",
      );
    }
    return baseline;
  }
  if (
    input.activation === undefined ||
    input.deployment.versions.length !== 1 ||
    percentages.get(candidate) !== 100
  ) {
    throw new Error(
      "Candidate-active Vectorize readiness requires the exact activated candidate alone at 100%.",
    );
  }
  return candidate;
}

function sameArtifacts(left: WorkerDeployArtifactEvidence, right: WorkerDeployArtifactEvidence) {
  return left.sourceFingerprint.sha256 === right.sourceFingerprint.sha256 &&
    left.sourceFingerprint.fileCount === right.sourceFingerprint.fileCount &&
    left.workerSourceSha256 === right.workerSourceSha256 &&
    left.wranglerConfigSha256 === right.wranglerConfigSha256 &&
    left.assetManifest.root === right.assetManifest.root &&
    left.assetManifest.sha256 === right.assetManifest.sha256 &&
    left.assetManifest.fileCount === right.assetManifest.fileCount &&
    left.assetManifest.bytes === right.assetManifest.bytes;
}

function sameDeploymentVersions(
  left: WorkerDeploymentStatus["versions"],
  right: WorkerDeploymentStatus["versions"],
) {
  const leftSorted = [...left].sort((first, second) =>
    first.versionId.localeCompare(second.versionId)
  );
  const rightSorted = [...right].sort((first, second) =>
    first.versionId.localeCompare(second.versionId)
  );
  return leftSorted.length === rightSorted.length && leftSorted.every((entry, index) =>
    entry.versionId === rightSorted[index]?.versionId &&
    entry.percentage === rightSorted[index]?.percentage
  );
}

function requireWorkerVersion(value: string | undefined) {
  const version = value?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(version)) {
    throw new Error("Vectorize readiness requires --candidate-version with an exact lowercase Worker UUID.");
  }
  return version;
}

function requireServingPhase(
  value: string | undefined,
): ReleaseSequenceServingPhase {
  if (value !== "uploaded-inactive" && value !== "candidate-active") {
    throw new Error(
      "Vectorize readiness requires --phase uploaded-inactive|candidate-active.",
    );
  }
  return value;
}

function validClock(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Vectorize readiness clock is invalid.");
  }
  return value;
}
