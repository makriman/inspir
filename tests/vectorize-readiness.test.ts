import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { WorkerDeployArtifactEvidence } from "../scripts/cloudflare/worker-deploy-evidence";
import {
  buildWorkerCandidateActivationEvidence,
  buildWorkerCandidateStagedEvidence,
  buildWorkerCandidateUploadEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  writeWorkerCandidateEvidence,
  type WorkerCandidateActivationEvidence,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";
import {
  assertFreshProductionVectorizeReadiness,
  assertProductionVectorizeReadinessReleaseBinding,
  createVectorizeReadinessReport,
  parseVectorizeIndexConfigurationOutput,
  parseVectorizeInfoOutput,
  parseVectorizeMetadataIndexesOutput,
  vectorizeReadinessReportPath,
  writeVectorizeReadinessReport,
  type VectorizeReadinessCurrentRelease,
  type VectorizeReadinessReport,
} from "../scripts/cloudflare/vectorize-readiness-evidence";
import {
  parseVectorizeReadinessCli,
  verifyProductionVectorizeReadiness,
} from "../scripts/cloudflare/verify-vectorize-readiness";

const candidateVersionId = "22222222-2222-4222-8222-222222222222";
const baselineVersionId = "11111111-1111-4111-8111-111111111111";
const uploadDeploymentId = "44444444-4444-4444-8444-444444444444";
const stagedDeploymentId = "55555555-5555-4555-8555-555555555555";
const activeDeploymentId = "66666666-6666-4666-8666-666666666666";
const restoredDeploymentId = "77777777-7777-4777-8777-777777777777";
const uploadCreatedAt = "2026-07-13T09:50:00.000Z";
const activeCreatedAt = "2026-07-13T09:55:00.000Z";
const reportCreatedAt = "2026-07-13T10:00:00.000Z";
const metadataIndexes = [
  { propertyName: "chatId", indexType: "string" },
  { propertyName: "userId", indexType: "string" },
];
const git = {
  head: "a".repeat(40),
  upstream: "a".repeat(40),
  upstreamRef: "origin/codex/release",
};

test("Vectorize readiness parses the exact production shape and fails closed", () => {
  assert.deepEqual(
    parseVectorizeIndexConfigurationOutput(JSON.stringify({
      name: "inspirlearning-memory-prod",
      config: { dimensions: 512, metric: "cosine" },
    })),
    { name: "inspirlearning-memory-prod", dimensions: 512, metric: "cosine" },
  );
  assert.deepEqual(
    parseVectorizeInfoOutput(JSON.stringify({
      dimensions: 512,
      vectorCount: 174,
      processedUpToDatetime: "2026-07-08T03:01:42.401Z",
      processedUpToMutation: "cc369a53-a464-4c51-9b26-136d3479b11a",
    })),
    { dimensions: 512, vectorCount: 174 },
  );
  assert.deepEqual(
    parseVectorizeMetadataIndexesOutput(JSON.stringify([...metadataIndexes].reverse())),
    metadataIndexes,
  );
  assert.deepEqual(
    parseVectorizeMetadataIndexesOutput(JSON.stringify([
      { propertyName: "userId", indexType: "String" },
      { propertyName: "chatId", indexType: "String" },
    ])),
    metadataIndexes,
  );

  assert.throws(
    () => parseVectorizeIndexConfigurationOutput(JSON.stringify({
      name: "inspirlearning-memory-prod",
      config: { dimensions: 512, metric: "euclidean" },
    })),
    /cosine metric/,
  );
  assert.throws(
    () => parseVectorizeIndexConfigurationOutput(JSON.stringify({
      name: "wrong-index",
      config: { dimensions: 512, metric: "cosine" },
    })),
    /exact index/,
  );
  assert.throws(
    () => parseVectorizeInfoOutput('{"dimensions":768,"vectorCount":174}'),
    /dimensions differ/,
  );
  assert.throws(
    () => parseVectorizeInfoOutput('{"dimensions":512,"vectorCount":0}'),
    /positive safe integer/,
  );
  assert.throws(() => parseVectorizeInfoOutput("not-json"), /not exact JSON/);
  assert.throws(
    () => parseVectorizeMetadataIndexesOutput(JSON.stringify(metadataIndexes.slice(0, 1))),
    /must be exactly/,
  );
  assert.throws(
    () => parseVectorizeMetadataIndexesOutput(JSON.stringify([
      { propertyName: "chatId", indexType: "number" },
      metadataIndexes[1],
    ])),
    /must be exactly/,
  );
});

test("uploaded-inactive verification is read-only and binds baseline serving to immutable upload evidence", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-source-"));
  const backupDir = privateTempDir("inspir-vectorize-backup-");
  const artifacts = workerArtifactEvidence(cwd);
  let written: VectorizeReadinessReport | undefined;
  const commands: string[][] = [];
  try {
    writeWranglerConfig(cwd, "inspirlearning-memory-prod");
    const evidence = installReleaseEvidence(backupDir, artifacts, false);
    installStagedEvidence(backupDir, evidence.upload);
    const report = verifyProductionVectorizeReadiness(
      {
        confirmed: true,
        remote: true,
        phase: "uploaded-inactive",
        candidateVersionId,
        backupDir,
        cwd,
      },
      {
        readGitIdentity: () => git,
        buildArtifactEvidence: () => artifacts,
        runner: vectorRunner(commands, {
          deploymentId: stagedDeploymentId,
          versions: [
            { versionId: baselineVersionId, percentage: 100 },
            { versionId: candidateVersionId, percentage: 0 },
          ],
        }),
        clock: () => new Date(reportCreatedAt),
        writeReport: (value) => {
          written = value;
          return path.join(backupDir, "captured.json");
        },
      },
    );

    assert.equal(report, written);
    assert.deepEqual(commands, [
      ["deployments", "status", "--name", "inspirlearning", "--json"],
      ["vectorize", "get", "inspirlearning-memory-prod", "--json"],
      ["vectorize", "info", "inspirlearning-memory-prod", "--json"],
      ["vectorize", "list-metadata-index", "inspirlearning-memory-prod", "--json"],
      ["deployments", "status", "--name", "inspirlearning", "--json"],
    ]);
    assert.equal(report.phase, "uploaded-inactive");
    assert.equal(report.release.targetCandidateVersionId, candidateVersionId);
    assert.equal(report.release.serviceBaselineVersionId, baselineVersionId);
    assert.equal(report.release.uploadEvidenceSha256, evidence.upload.sha256);
    assert.equal(report.servingObservation.soleServingVersionId, baselineVersionId);
    assert.equal(report.servingObservation.phaseEvidenceSha256, evidence.upload.sha256);
    assert.equal(report.readOnly.remoteQueries, 5);
    assert.equal(report.readOnly.mutationCommands, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("candidate-active verification consumes the complete upload-to-activation chain", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-active-source-"));
  const backupDir = privateTempDir("inspir-vectorize-active-backup-");
  const artifacts = workerArtifactEvidence(cwd);
  try {
    writeWranglerConfig(cwd, "inspirlearning-memory-prod");
    const evidence = installReleaseEvidence(backupDir, artifacts, true);
    assert.ok(evidence.staged);
    assert.ok(evidence.activation);
    const staged = evidence.staged;
    const activation = evidence.activation;
    const report = verifyProductionVectorizeReadiness(
      {
        confirmed: true,
        remote: true,
        phase: "candidate-active",
        candidateVersionId,
        backupDir,
        cwd,
      },
      {
        readGitIdentity: () => git,
        buildArtifactEvidence: () => artifacts,
        runner: vectorRunner([], {
          deploymentId: activeDeploymentId,
          versions: [{ versionId: candidateVersionId, percentage: 100 }],
        }),
        clock: () => new Date(reportCreatedAt),
        writeReport: () => path.join(backupDir, "captured.json"),
      },
    );
    assert.equal(report.phase, "candidate-active");
    assert.equal(report.servingObservation.soleServingVersionId, candidateVersionId);
    assert.equal(
      report.servingObservation.phaseEvidenceSha256,
      activation.sha256,
    );
    const restoredReport = verifyProductionVectorizeReadiness(
      {
        confirmed: true,
        remote: true,
        phase: "candidate-active",
        candidateVersionId,
        backupDir,
        cwd,
      },
      {
        readGitIdentity: () => git,
        buildArtifactEvidence: () => artifacts,
        runner: vectorRunner([], {
          deploymentId: restoredDeploymentId,
          versions: [{ versionId: candidateVersionId, percentage: 100 }],
        }),
        clock: () => new Date(reportCreatedAt),
        writeReport: () => path.join(backupDir, "restored.json"),
      },
    );
    assert.equal(restoredReport.phase, "candidate-active");
    assert.equal(
      restoredReport.servingObservation.phaseEvidenceSha256,
      activation.sha256,
    );

    assert.throws(
      () => verifyProductionVectorizeReadiness(
        {
          confirmed: true,
          remote: true,
          phase: "candidate-active",
          candidateVersionId,
          backupDir,
          cwd,
        },
        {
          readGitIdentity: () => git,
          buildArtifactEvidence: () => artifacts,
          readStagedEvidence: () => ({
            ...staged,
            sha256: "f".repeat(64),
          }),
          runner: vectorRunner([], {
            deploymentId: activeDeploymentId,
            versions: [{ versionId: candidateVersionId, percentage: 100 }],
          }),
        },
      ),
      /exact immutable upload evidence|wrong canonical SHA-256/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("verification rejects candidate, source, topology, and phase drift before writing", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-drift-source-"));
  const backupDir = privateTempDir("inspir-vectorize-drift-backup-");
  const artifacts = workerArtifactEvidence(cwd);
  let writes = 0;
  try {
    writeWranglerConfig(cwd, "inspirlearning-memory-prod");
    installReleaseEvidence(backupDir, artifacts, false);
    assert.throws(
      () => verifyProductionVectorizeReadiness(
        {
          confirmed: true,
          remote: true,
          phase: "uploaded-inactive",
          candidateVersionId: "33333333-3333-4333-8333-333333333333",
          backupDir,
          cwd,
        },
        {
          readGitIdentity: () => git,
          buildArtifactEvidence: () => artifacts,
          runner: vectorRunner([], {
            deploymentId: uploadDeploymentId,
            versions: [{ versionId: baselineVersionId, percentage: 100 }],
          }),
          writeReport: () => {
            writes += 1;
            return "unexpected";
          },
        },
      ),
      /does not match immutable upload evidence/,
    );
    assert.throws(
      () => verifyProductionVectorizeReadiness(
        {
          confirmed: true,
          remote: true,
          phase: "uploaded-inactive",
          candidateVersionId,
          backupDir,
          cwd,
        },
        {
          readGitIdentity: () => git,
          buildArtifactEvidence: () => ({
            ...artifacts,
            workerSourceSha256: "f".repeat(64),
          }),
          runner: vectorRunner([], {
            deploymentId: uploadDeploymentId,
            versions: [{ versionId: baselineVersionId, percentage: 100 }],
          }),
          writeReport: () => {
            writes += 1;
            return "unexpected";
          },
        },
      ),
      /artifacts do not match upload evidence/,
    );
    assert.throws(
      () => verifyProductionVectorizeReadiness(
        {
          confirmed: true,
          remote: true,
          phase: "uploaded-inactive",
          candidateVersionId,
          backupDir,
          cwd,
        },
        {
          readGitIdentity: () => git,
          buildArtifactEvidence: () => artifacts,
          runner: vectorRunner([], {
            deploymentId: uploadDeploymentId,
            versions: [{ versionId: candidateVersionId, percentage: 100 }],
          }),
        },
      ),
      /service baseline as the sole 100% serving version/,
    );
    assert.equal(writes, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("post-activation consumers reject pre-activation Vectorize evidence until refreshed", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-evidence-source-"));
  const backupDir = privateTempDir("inspir-vectorize-evidence-backup-");
  const artifacts = workerArtifactEvidence(cwd);
  try {
    const evidence = installReleaseEvidence(backupDir, artifacts, false);
    const inactive = currentRelease(artifacts, evidence.upload, undefined);
    const inactiveReport = readinessReport({
      backupDir,
      currentRelease: inactive,
      createdAt: reportCreatedAt,
    });
    const reportPath = writeVectorizeReadinessReport(inactiveReport, backupDir);
    assert.equal(reportPath, vectorizeReadinessReportPath(backupDir));
    assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
    assert.equal(
      assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease: inactive,
        requiredPhase: "uploaded-inactive",
        now: new Date("2026-07-13T10:29:59.999Z"),
      }).phase,
      "uploaded-inactive",
    );

    const activeEvidence = installActivationEvidence(backupDir, evidence.upload);
    const active = currentRelease(artifacts, evidence.upload, activeEvidence.activation);
    assert.throws(
      () => assertProductionVectorizeReadinessReleaseBinding({
        backupDir,
        currentRelease: active,
        requiredPhase: "candidate-active",
      }),
      /required serving phase|phase evidence/,
    );

    const activeReport = readinessReport({
      backupDir,
      currentRelease: active,
      createdAt: "2026-07-13T10:10:00.000Z",
    });
    writeVectorizeReadinessReport(activeReport, backupDir);
    assert.equal(
      assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease: active,
        requiredPhase: "candidate-active",
        now: new Date("2026-07-13T10:20:00.000Z"),
      }).phase,
      "candidate-active",
    );
    assert.throws(
      () => assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease: active,
        requiredPhase: "candidate-active",
        now: new Date("2026-07-13T11:40:00.001Z"),
      }),
      /stale/,
    );
    assert.throws(
      () => assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease: {
          ...active,
          artifactEvidence: {
            ...artifacts,
            workerSourceSha256: "f".repeat(64),
          },
        },
        requiredPhase: "candidate-active",
        now: new Date("2026-07-13T10:20:00.000Z"),
      }),
      /does not match the immutable uploaded candidate/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("Vectorize readiness CLI requires an explicit serving phase", () => {
  assert.deepEqual(
    parseVectorizeReadinessCli([
      "--remote",
      "--confirm-production",
      "--phase",
      "candidate-active",
      "--candidate-version",
      candidateVersionId,
    ]),
    {
      remote: true,
      confirmed: true,
      phase: "candidate-active",
      candidateVersionId,
    },
  );
  assert.throws(
    () => parseVectorizeReadinessCli([
      "--remote",
      "--confirm-production",
      "--candidate-version",
      candidateVersionId,
    ]),
    /requires --phase/,
  );
  assert.throws(
    () => parseVectorizeReadinessCli([
      "--remote",
      "--confirm-production",
      "--phase",
      "wrong",
      "--candidate-version",
      candidateVersionId,
    ]),
    /requires --phase/,
  );
  assert.throws(
    () => verifyProductionVectorizeReadiness({
      confirmed: false,
      remote: true,
      phase: "candidate-active",
      candidateVersionId,
    }),
    /requires --remote and --confirm-production/,
  );
});

function readinessReport(input: {
  backupDir: string;
  currentRelease: VectorizeReadinessCurrentRelease;
  createdAt: string;
}) {
  return createVectorizeReadinessReport({
    createdAt: input.createdAt,
    backupDir: input.backupDir,
    currentRelease: input.currentRelease,
    servingObservation: {
      observedBeforeAt: input.createdAt,
      observedAfterAt: input.createdAt,
    },
    vectorizeIndex: {
      name: "inspirlearning-memory-prod",
      dimensions: 512,
      metric: "cosine",
    },
    vectorizeInfo: { dimensions: 512, vectorCount: 174 },
    metadataIndexes,
  });
}

function privateTempDir(prefix: string) {
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  fs.chmodSync(directory, 0o700);
  return directory;
}

function vectorRunner(
  commands: string[][],
  deployment: {
    deploymentId: string;
    versions: { versionId: string; percentage: number }[];
  },
) {
  return (args: string[]) => {
    commands.push([...args]);
    if (args[0] === "deployments") {
      return JSON.stringify({
        id: deployment.deploymentId,
        versions: deployment.versions.map((entry) => ({
          version_id: entry.versionId,
          percentage: entry.percentage,
        })),
      });
    }
    if (args[1] === "get") {
      return JSON.stringify({
        name: "inspirlearning-memory-prod",
        config: { dimensions: 512, metric: "cosine" },
      });
    }
    return args[1] === "info"
      ? JSON.stringify({ dimensions: 512, vectorCount: 174 })
      : JSON.stringify(metadataIndexes);
  };
}

function writeWranglerConfig(cwd: string, indexName: string) {
  fs.writeFileSync(
    path.join(cwd, "wrangler.jsonc"),
    `${JSON.stringify({
      vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: indexName }],
    }, null, 2)}\n`,
  );
}

function workerArtifactEvidence(cwd: string): WorkerDeployArtifactEvidence {
  return {
    sourceFingerprint: {
      sha256: "b".repeat(64),
      fileCount: 1,
      files: [{ file: "package.json", sha256: "1".repeat(64), bytes: 1 }],
    },
    workerSourceSha256: "c".repeat(64),
    wranglerConfigSha256: "d".repeat(64),
    assetManifest: {
      root: path.join(cwd, ".open-next/assets"),
      sha256: "e".repeat(64),
      fileCount: 12,
      bytes: 4_096,
    },
  };
}

function installReleaseEvidence(
  backupDir: string,
  artifacts: WorkerDeployArtifactEvidence,
  active: boolean,
): {
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  staged?: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  activation?: WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
} {
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { mode: 0o700 });
  const uploadValue = buildWorkerCandidateUploadEvidence({
    createdAt: uploadCreatedAt,
    targetCandidateVersionId: candidateVersionId,
    serviceBaselineVersionId: baselineVersionId,
    expectedReleaseTag: "release-test",
    expectedReleaseMessageSha256: "8".repeat(64),
    uploadCommandEvidenceSha256: "9".repeat(64),
    workerDeployPreparationSha256: "0".repeat(64),
    git,
    artifacts: {
      sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
      sourceFingerprintFileCount: artifacts.sourceFingerprint.fileCount,
      workerSourceSha256: artifacts.workerSourceSha256,
      wranglerConfigSha256: artifacts.wranglerConfigSha256,
      assetManifestSha256: artifacts.assetManifest.sha256,
      assetManifestFileCount: artifacts.assetManifest.fileCount,
      assetManifestBytes: artifacts.assetManifest.bytes,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-tag",
      versionId: candidateVersionId,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-13T09:49:00.000Z",
    },
    versionView: {
      versionId: candidateVersionId,
      createdAt: "2026-07-13T09:49:00.000Z",
      source: "wrangler",
      releaseTag: "release-test",
      releaseMessageSha256: "8".repeat(64),
      resourceConfigSha256: "7".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: uploadDeploymentId,
      serviceBaselineVersionId: baselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  const upload = writeWorkerCandidateEvidence(
    workerCandidateUploadEvidencePath(backupDir),
    uploadValue,
  );
  if (!active) return { upload };
  return { upload, ...installActivationEvidence(backupDir, upload) };
}

function installActivationEvidence(
  backupDir: string,
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
): {
  staged: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  activation: WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>;
} {
  const staged = installStagedEvidence(backupDir, upload);
  const activationValue = buildWorkerCandidateActivationEvidence({
    createdAt: activeCreatedAt,
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
    preActivationSealSha256: "6".repeat(64),
    deployOutput: {
      type: "version-deploy",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-tag",
      deploymentId: activeDeploymentId,
      timestamp: "2026-07-13T09:54:00.000Z",
    },
    topology: {
      deploymentId: activeDeploymentId,
      targetCandidateVersionId: candidateVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  const activation = writeWorkerCandidateEvidence(
    workerCandidateActivationEvidencePath(backupDir),
    activationValue,
  );
  return { staged, activation };
}

function installStagedEvidence(
  backupDir: string,
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
) {
  const stagedValue = buildWorkerCandidateStagedEvidence({
    createdAt: "2026-07-13T09:53:00.000Z",
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    deployOutput: {
      type: "version-deploy",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-tag",
      deploymentId: stagedDeploymentId,
      timestamp: "2026-07-13T09:52:30.000Z",
    },
    topology: {
      deploymentId: stagedDeploymentId,
      serviceBaselineVersionId: baselineVersionId,
      targetCandidateVersionId: candidateVersionId,
      baselinePercentage: 100,
      candidatePercentage: 0,
      observedVersions: 2,
    },
  });
  const staged = writeWorkerCandidateEvidence(
    workerCandidateStagedEvidencePath(backupDir),
    stagedValue,
  );
  return staged;
}

function currentRelease(
  artifacts: WorkerDeployArtifactEvidence,
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
  activation:
    | WorkerCandidateEvidenceHandle<WorkerCandidateActivationEvidence>
    | undefined,
): VectorizeReadinessCurrentRelease {
  if (activation) {
    return {
      phase: "candidate-active",
      targetCandidateVersionId: candidateVersionId,
      serviceBaselineVersionId: baselineVersionId,
      uploadEvidenceSha256: upload.sha256,
      phaseEvidenceSha256: activation.sha256,
      phaseEvidenceCreatedAt: activation.value.createdAt,
      soleServingVersionId: candidateVersionId,
      git,
      artifactEvidence: artifacts,
    };
  }
  return {
    phase: "uploaded-inactive",
    targetCandidateVersionId: candidateVersionId,
    serviceBaselineVersionId: baselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: upload.sha256,
    phaseEvidenceCreatedAt: upload.value.createdAt,
    soleServingVersionId: baselineVersionId,
    git,
    artifactEvidence: artifacts,
  };
}
