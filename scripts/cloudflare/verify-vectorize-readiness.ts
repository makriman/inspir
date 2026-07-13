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
  readPrivateWorkerDeployEvidence,
  validateWorkerDeployEvidenceForRepair,
  type WorkerDeployRepairEvidence,
} from "./repair-seo-cta-translations";
import {
  buildWorkerDeployArtifactEvidence,
  readSoleActiveWorkerVersion,
  WORKER_DEPLOY_REPORT,
  type WorkerDeployArtifactEvidence,
} from "./worker-deploy-evidence";
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

type ReadOnlyWranglerRunner = (args: string[], options?: RunCommandOptions) => string;

export type VerifyVectorizeReadinessOptions = {
  confirmed: boolean;
  remote: boolean;
  candidateVersionId: string;
  backupDir?: string;
  cwd?: string;
};

export type VerifyVectorizeReadinessDependencies = {
  readGitIdentity?: (cwd: string) => GitReleaseIdentity;
  buildArtifactEvidence?: (cwd: string) => WorkerDeployArtifactEvidence;
  readDeployReport?: (file: string) => unknown;
  validateDeployEvidence?: typeof validateWorkerDeployEvidenceForRepair;
  readActiveVersion?: (runner: ReadOnlyWranglerRunner) => string;
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
      candidateVersionId: report.candidateVersionId,
      sourceFingerprintSha256: report.artifactEvidence.sourceFingerprintSha256,
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
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDir = path.resolve(options.backupDir ?? resolveBackupDir());
  const readGitIdentity = dependencies.readGitIdentity ??
    ((releaseCwd: string) => assertGitReleaseIdentity({ cwd: releaseCwd }));
  const buildArtifactEvidence = dependencies.buildArtifactEvidence ?? buildWorkerDeployArtifactEvidence;
  const readDeployReport = dependencies.readDeployReport ?? readPrivateWorkerDeployEvidence;
  const validateDeployEvidence = dependencies.validateDeployEvidence ?? validateWorkerDeployEvidenceForRepair;
  const runner = dependencies.runner ?? ((args, runnerOptions) => runWrangler(args, runnerOptions));
  const readActiveVersion = dependencies.readActiveVersion ?? ((readRunner) =>
    readSoleActiveWorkerVersion((args) =>
      readRunner(args, { maxBuffer: 64 * 1_024, timeoutMs: 60_000 })
    ));
  const clock = dependencies.clock ?? (() => new Date());
  const writeReport = dependencies.writeReport ?? writeVectorizeReadinessReport;

  const configuredBefore = readConfiguredVectorizeBinding(cwd);
  const releaseBefore = readCandidateReleaseIdentity({
    cwd,
    backupDir,
    candidateVersionId,
    readGitIdentity,
    buildArtifactEvidence,
    readDeployReport,
    validateDeployEvidence,
    readActiveVersion,
    runner,
  });

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
    candidateVersionId,
    readGitIdentity,
    buildArtifactEvidence,
    readDeployReport,
    validateDeployEvidence,
    readActiveVersion,
    runner,
  });
  if (
    configuredBefore.binding !== configuredAfter.binding ||
    configuredBefore.indexName !== configuredAfter.indexName
  ) {
    throw new Error("Vectorize binding changed during readiness verification.");
  }
  assertStableCandidateReleaseIdentity(releaseBefore, releaseAfter);

  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Vectorize readiness clock is invalid.");
  }
  const report = createVectorizeReadinessReport({
    createdAt: now.toISOString(),
    backupDir,
    currentRelease: releaseAfter.currentRelease,
    deployEvidence: {
      createdAt: releaseAfter.deployEvidence.createdAt,
      activeDeploymentReadAt: releaseAfter.deployEvidence.activeDeploymentReadAt,
    },
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
  let candidateVersionId = "";
  let backupDir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote" && !remote) remote = true;
    else if (argument === "--confirm-production" && !confirmed) confirmed = true;
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
    candidateVersionId: requireWorkerVersion(candidateVersionId),
    ...(backupDir ? { backupDir: path.resolve(backupDir) } : {}),
  };
}

function readCandidateReleaseIdentity(input: {
  cwd: string;
  backupDir: string;
  candidateVersionId: string;
  readGitIdentity: (cwd: string) => GitReleaseIdentity;
  buildArtifactEvidence: (cwd: string) => WorkerDeployArtifactEvidence;
  readDeployReport: (file: string) => unknown;
  validateDeployEvidence: typeof validateWorkerDeployEvidenceForRepair;
  readActiveVersion: (runner: ReadOnlyWranglerRunner) => string;
  runner: ReadOnlyWranglerRunner;
}) {
  const git = input.readGitIdentity(input.cwd);
  const artifactEvidence = input.buildArtifactEvidence(input.cwd);
  const deployEvidence = input.validateDeployEvidence({
    report: input.readDeployReport(path.resolve(input.backupDir, WORKER_DEPLOY_REPORT)),
    backupDir: input.backupDir,
    candidateVersionId: input.candidateVersionId,
    currentArtifactEvidence: artifactEvidence,
  });
  const activeVersionId = requireWorkerVersion(input.readActiveVersion(input.runner));
  if (activeVersionId !== input.candidateVersionId) {
    throw new Error(
      `Vectorize readiness expected candidate ${input.candidateVersionId} alone at 100%; received ${activeVersionId}.`,
    );
  }
  return {
    currentRelease: {
      candidateVersionId: input.candidateVersionId,
      activeVersionId,
      git,
      artifactEvidence,
    } satisfies VectorizeReadinessCurrentRelease,
    deployEvidence,
  };
}

function assertStableCandidateReleaseIdentity(
  before: ReturnType<typeof readCandidateReleaseIdentity>,
  after: ReturnType<typeof readCandidateReleaseIdentity>,
) {
  const beforeRelease = before.currentRelease;
  const afterRelease = after.currentRelease;
  if (
    beforeRelease.candidateVersionId !== afterRelease.candidateVersionId ||
    beforeRelease.activeVersionId !== afterRelease.activeVersionId ||
    beforeRelease.git.head !== afterRelease.git.head ||
    beforeRelease.git.upstream !== afterRelease.git.upstream ||
    beforeRelease.git.upstreamRef !== afterRelease.git.upstreamRef ||
    !sameArtifacts(beforeRelease.artifactEvidence, afterRelease.artifactEvidence) ||
    !sameDeployEvidence(before.deployEvidence, after.deployEvidence)
  ) {
    throw new Error("Candidate source, deploy evidence, or active version changed during Vectorize readiness verification.");
  }
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

function sameDeployEvidence(left: WorkerDeployRepairEvidence, right: WorkerDeployRepairEvidence) {
  return left.createdAt === right.createdAt &&
    left.backupDir === right.backupDir &&
    left.candidateVersionId === right.candidateVersionId &&
    left.sourceFingerprintSha256 === right.sourceFingerprintSha256 &&
    left.sourceFingerprintFileCount === right.sourceFingerprintFileCount &&
    left.workerSourceSha256 === right.workerSourceSha256 &&
    left.wranglerConfigSha256 === right.wranglerConfigSha256 &&
    left.assetManifest.sha256 === right.assetManifest.sha256 &&
    left.assetManifest.fileCount === right.assetManifest.fileCount &&
    left.assetManifest.bytes === right.assetManifest.bytes &&
    left.activeDeploymentReadAt === right.activeDeploymentReadAt;
}

function requireWorkerVersion(value: string | undefined) {
  const version = value?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(version)) {
    throw new Error("Vectorize readiness requires --candidate-version with an exact lowercase Worker UUID.");
  }
  return version;
}
