import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertFreshProductionTranslationReconciliation,
  assertProductionTranslationReconciliationReleaseBinding,
  createTopicReconciliationAttestation,
  releaseSequenceIdentityFromCurrentRelease,
  topicAttestationPath,
  translationAttestationPath,
  writeTopicReconciliationAttestation,
  writeTranslationReconciliationPending,
  writeTranslationReconciliationSuccess,
  type StagedTranslationReconciliationBinding,
} from "../scripts/cloudflare/release-sequence-attestations";
import type { WorkerDeployArtifactEvidence } from "../scripts/cloudflare/worker-deploy-evidence";
import {
  buildWorkerCandidateActivationEvidence,
  buildWorkerCandidateStagedEvidence,
  buildWorkerCandidateUploadEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  writeWorkerCandidateEvidence,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateUploadEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";
import type { VectorizeReadinessCurrentRelease } from "../scripts/cloudflare/vectorize-readiness-evidence";

const candidateVersionId = "22222222-2222-4222-8222-222222222222";
const baselineVersionId = "11111111-1111-4111-8111-111111111111";
const uploadDeploymentId = "44444444-4444-4444-8444-444444444444";
const stagedDeploymentId = "55555555-5555-4555-8555-555555555555";
const activeDeploymentId = "66666666-6666-4666-8666-666666666666";
const uploadCreatedAt = "2026-07-13T09:50:00.000Z";
const vectorizeCreatedAt = "2026-07-13T10:00:00.000Z";
const topicCreatedAt = "2026-07-13T10:01:00.000Z";
const translationCreatedAt = "2026-07-13T10:02:00.000Z";

test("translation release evidence stays fail-closed while checking and authorizes only exact verified order", () => {
  const backupDir = privateTempDir("inspir-release-sequence-");
  try {
    const artifacts = artifactEvidence(backupDir);
    const upload = installUploadEvidence(backupDir, artifacts);
    const currentRelease = releaseIdentity(artifacts, upload);
    const topic = createTopicReconciliationAttestation({
      createdAt: topicCreatedAt,
      backupDir,
      release: releaseSequenceIdentityFromCurrentRelease(currentRelease),
      vectorizeReadinessCreatedAt: vectorizeCreatedAt,
      seedSha256: "f".repeat(64),
      verifiedTopics: 10,
      verifiedArchivedTopics: 2,
    });
    writeTopicReconciliationAttestation(topic, backupDir);
    writeTranslationReconciliationPending({
      createdAt: translationCreatedAt,
      backupDir,
      currentRelease,
      vectorizeReadiness: { createdAt: vectorizeCreatedAt },
      topicAttestation: topic,
      method: "read-only-drift",
    });

    assert.equal(fs.statSync(topicAttestationPath(backupDir)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(translationAttestationPath(backupDir)).mode & 0o777, 0o600);
    assert.throws(
      () => assertProductionTranslationReconciliationReleaseBinding({
        backupDir,
        currentRelease,
      }),
      /incomplete/,
    );

    writeTranslationReconciliationSuccess({
      createdAt: translationCreatedAt,
      backupDir,
      currentRelease,
      vectorizeReadiness: { createdAt: vectorizeCreatedAt },
      topicAttestation: topic,
      method: "read-only-drift",
      remoteQueries: 4,
      billedRowsRead: 123,
    });
    const verified = assertFreshProductionTranslationReconciliation({
      backupDir,
      currentRelease,
      now: new Date("2026-07-13T10:31:59.999Z"),
    });
    assert.equal(verified.status, "reconciled");
    assert.equal(verified.verification?.repairApplied, false);
    assert.equal(verified.verification?.remoteQueries, 4);

    assert.throws(
      () => assertFreshProductionTranslationReconciliation({
        backupDir,
        currentRelease,
        now: new Date("2026-07-13T10:32:00.001Z"),
      }),
      /stale/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("translation attestations reject source, candidate, and predecessor-order drift", () => {
  const backupDir = privateTempDir("inspir-release-drift-");
  try {
    const artifacts = artifactEvidence(backupDir);
    const upload = installUploadEvidence(backupDir, artifacts);
    const currentRelease = releaseIdentity(artifacts, upload);
    const firstTopic = createTopicReconciliationAttestation({
      createdAt: topicCreatedAt,
      backupDir,
      release: releaseSequenceIdentityFromCurrentRelease(currentRelease),
      vectorizeReadinessCreatedAt: vectorizeCreatedAt,
      seedSha256: "f".repeat(64),
      verifiedTopics: 10,
      verifiedArchivedTopics: 0,
    });
    writeTopicReconciliationAttestation(firstTopic, backupDir);
    writeTranslationReconciliationSuccess({
      createdAt: translationCreatedAt,
      backupDir,
      currentRelease,
      vectorizeReadiness: { createdAt: vectorizeCreatedAt },
      topicAttestation: firstTopic,
      method: "atomic-repair",
      remoteQueries: 8,
      billedRowsRead: 456,
    });

    assert.throws(
      () => assertProductionTranslationReconciliationReleaseBinding({
        backupDir,
        currentRelease: {
          ...currentRelease,
          artifactEvidence: {
            ...currentRelease.artifactEvidence,
            workerSourceSha256: "0".repeat(64),
          },
        },
      }),
      /exact candidate and source|authorize|immutable uploaded candidate/,
    );
    assert.throws(
      () => assertProductionTranslationReconciliationReleaseBinding({
        backupDir,
        currentRelease: {
          ...currentRelease,
          targetCandidateVersionId: "33333333-3333-4333-8333-333333333333",
        },
      }),
      /exact candidate and source|authorize|immutable uploaded candidate/,
    );

    const newerTopic = createTopicReconciliationAttestation({
      createdAt: "2026-07-13T10:03:00.000Z",
      backupDir,
      release: releaseSequenceIdentityFromCurrentRelease(currentRelease),
      vectorizeReadinessCreatedAt: vectorizeCreatedAt,
      seedSha256: "e".repeat(64),
      verifiedTopics: 10,
      verifiedArchivedTopics: 1,
    });
    writeTopicReconciliationAttestation(newerTopic, backupDir);
    assert.throws(
      () => assertProductionTranslationReconciliationReleaseBinding({
        backupDir,
        currentRelease,
      }),
      /does not follow the current topic reconciliation/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("staged reconciliation success consumes the exact pending release mode and corpus", () => {
  const backupDir = privateTempDir("inspir-staged-release-sequence-");
  try {
    const artifacts = artifactEvidence(backupDir);
    const upload = installUploadEvidence(backupDir, artifacts);
    const currentRelease = releaseIdentity(artifacts, upload);
    const topic = createTopicReconciliationAttestation({
      createdAt: topicCreatedAt,
      backupDir,
      release: releaseSequenceIdentityFromCurrentRelease(currentRelease),
      vectorizeReadinessCreatedAt: vectorizeCreatedAt,
      seedSha256: "f".repeat(64),
      verifiedTopics: 10,
      verifiedArchivedTopics: 0,
    });
    writeTopicReconciliationAttestation(topic, backupDir);
    const stagedRelease = stagedBinding();
    assert.throws(
      () => writeTranslationReconciliationPending({
        createdAt: translationCreatedAt,
        backupDir,
        currentRelease,
        vectorizeReadiness: { createdAt: vectorizeCreatedAt },
        topicAttestation: topic,
        method: "read-only-drift",
        stagedRelease: finalizedAfrikaansBinding(),
      }),
      /only the selected current no-site-promotion/,
    );
    assert.throws(
      () => writeTranslationReconciliationPending({
        createdAt: translationCreatedAt,
        backupDir,
        currentRelease,
        vectorizeReadiness: { createdAt: vectorizeCreatedAt },
        topicAttestation: topic,
        method: "atomic-repair",
        stagedRelease,
      }),
      /read-only preactivation plan seal/,
    );
    writeTranslationReconciliationPending({
      createdAt: translationCreatedAt,
      backupDir,
      currentRelease,
      vectorizeReadiness: { createdAt: vectorizeCreatedAt },
      topicAttestation: topic,
      method: "read-only-drift",
      stagedRelease,
    });
    assert.throws(
      () => writeTranslationReconciliationSuccess({
        createdAt: "2026-07-13T10:02:01.000Z",
        backupDir,
        currentRelease,
        vectorizeReadiness: { createdAt: vectorizeCreatedAt },
        topicAttestation: topic,
        method: "read-only-drift",
        remoteQueries: 3,
        billedRowsRead: 100,
        stagedRelease: {
          ...stagedRelease,
          d1Corpus: {
            ...stagedRelease.d1Corpus,
            payloadCorpusSha256: "0".repeat(64),
          },
        },
      }),
      /exact pending candidate, release mode, plan, and topic evidence/,
    );
    writeTranslationReconciliationSuccess({
      createdAt: "2026-07-13T10:02:01.000Z",
      backupDir,
      currentRelease,
      vectorizeReadiness: { createdAt: vectorizeCreatedAt },
      topicAttestation: topic,
      method: "read-only-drift",
      remoteQueries: 3,
      billedRowsRead: 100,
      stagedRelease,
    });
    const value: unknown = JSON.parse(
      fs.readFileSync(translationAttestationPath(backupDir), "utf8"),
    );
    assert.equal(
      requireRecord(value, "staged translation evidence").kind,
      "production-staged-translation-reconciliation-v1",
    );
    assert.match(
      String(
        requireRecord(value, "staged translation evidence")
          .pendingEvidenceSha256,
      ),
      /^[a-f0-9]{64}$/,
    );
    assert.throws(
      () => writeTranslationReconciliationSuccess({
        createdAt: "2026-07-13T10:02:02.000Z",
        backupDir,
        currentRelease,
        vectorizeReadiness: { createdAt: vectorizeCreatedAt },
        topicAttestation: topic,
        method: "read-only-drift",
        remoteQueries: 3,
        billedRowsRead: 100,
        stagedRelease,
      }),
      /requires its exact pending/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("pre-activation topic and translation attestations remain candidate-bound after activation", () => {
  const backupDir = privateTempDir("inspir-release-activation-");
  try {
    const artifacts = artifactEvidence(backupDir);
    const upload = installUploadEvidence(backupDir, artifacts);
    const inactiveRelease = releaseIdentity(artifacts, upload);
    const topic = createTopicReconciliationAttestation({
      createdAt: topicCreatedAt,
      backupDir,
      release: releaseSequenceIdentityFromCurrentRelease(inactiveRelease),
      vectorizeReadinessCreatedAt: vectorizeCreatedAt,
      seedSha256: "f".repeat(64),
      verifiedTopics: 10,
      verifiedArchivedTopics: 1,
    });
    writeTopicReconciliationAttestation(topic, backupDir);
    writeTranslationReconciliationSuccess({
      createdAt: translationCreatedAt,
      backupDir,
      currentRelease: inactiveRelease,
      vectorizeReadiness: { createdAt: vectorizeCreatedAt },
      topicAttestation: topic,
      method: "read-only-drift",
      remoteQueries: 4,
      billedRowsRead: 123,
    });

    const activation = installActivationEvidence(backupDir, upload);
    const activeRelease: VectorizeReadinessCurrentRelease = {
      ...inactiveRelease,
      phase: "candidate-active",
      phaseEvidenceSha256: activation.sha256,
      phaseEvidenceCreatedAt: activation.value.createdAt,
      soleServingVersionId: candidateVersionId,
    };
    const verified = assertProductionTranslationReconciliationReleaseBinding({
      backupDir,
      currentRelease: activeRelease,
    });
    assert.equal(
      verified.release.targetCandidateVersionId,
      candidateVersionId,
    );
    assert.equal(
      verified.release.serviceBaselineVersionId,
      baselineVersionId,
    );
    assert.equal(verified.release.uploadEvidenceSha256, upload.sha256);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("release sequence creation rejects impossible causal timestamps", () => {
  const backupDir = privateTempDir("inspir-release-causality-");
  try {
    const artifacts = artifactEvidence(backupDir);
    const upload = installUploadEvidence(backupDir, artifacts);
    const currentRelease = releaseIdentity(artifacts, upload);
    assert.throws(
      () => createTopicReconciliationAttestation({
        createdAt: topicCreatedAt,
        backupDir,
        release: releaseSequenceIdentityFromCurrentRelease(currentRelease),
        vectorizeReadinessCreatedAt: "2026-07-13T10:01:00.001Z",
        seedSha256: "f".repeat(64),
        verifiedTopics: 10,
        verifiedArchivedTopics: 0,
      }),
      /wrong successful release contract/,
    );
    const topic = createTopicReconciliationAttestation({
      createdAt: topicCreatedAt,
      backupDir,
      release: releaseSequenceIdentityFromCurrentRelease(currentRelease),
      vectorizeReadinessCreatedAt: vectorizeCreatedAt,
      seedSha256: "f".repeat(64),
      verifiedTopics: 10,
      verifiedArchivedTopics: 0,
    });
    assert.throws(
      () => writeTranslationReconciliationPending({
        createdAt: translationCreatedAt,
        backupDir,
        currentRelease,
        vectorizeReadiness: { createdAt: "2026-07-13T10:03:00.000Z" },
        topicAttestation: topic,
        method: "read-only-drift",
      }),
      /not in causal order/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

function releaseIdentity(
  evidence: WorkerDeployArtifactEvidence,
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
): VectorizeReadinessCurrentRelease {
  return {
    phase: "uploaded-inactive",
    targetCandidateVersionId: candidateVersionId,
    serviceBaselineVersionId: baselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: upload.sha256,
    phaseEvidenceCreatedAt: upload.value.createdAt,
    soleServingVersionId: baselineVersionId,
    git: {
      head: "a".repeat(40),
      upstream: "a".repeat(40),
      upstreamRef: "origin/codex/release",
    },
    artifactEvidence: evidence,
  };
}

function privateTempDir(prefix: string) {
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  fs.chmodSync(directory, 0o700);
  return directory;
}

function installUploadEvidence(
  backupDir: string,
  evidence: WorkerDeployArtifactEvidence,
) {
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { mode: 0o700 });
  const upload = buildWorkerCandidateUploadEvidence({
    createdAt: uploadCreatedAt,
    targetCandidateVersionId: candidateVersionId,
    serviceBaselineVersionId: baselineVersionId,
    expectedReleaseTag: "release-test",
    expectedReleaseMessageSha256: "8".repeat(64),
    uploadCommandEvidenceSha256: "9".repeat(64),
    workerDeployPreparationSha256: "0".repeat(64),
    git: {
      head: "a".repeat(40),
      upstream: "a".repeat(40),
      upstreamRef: "origin/codex/release",
    },
    artifacts: {
      sourceFingerprintSha256: evidence.sourceFingerprint.sha256,
      sourceFingerprintFileCount: evidence.sourceFingerprint.fileCount,
      workerSourceSha256: evidence.workerSourceSha256,
      wranglerConfigSha256: evidence.wranglerConfigSha256,
      assetManifestSha256: evidence.assetManifest.sha256,
      assetManifestFileCount: evidence.assetManifest.fileCount,
      assetManifestBytes: evidence.assetManifest.bytes,
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
  return writeWorkerCandidateEvidence(
    workerCandidateUploadEvidencePath(backupDir),
    upload,
  );
}

function installActivationEvidence(
  backupDir: string,
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
) {
  const stagedValue = buildWorkerCandidateStagedEvidence({
    createdAt: "2026-07-13T10:03:00.000Z",
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    deployOutput: {
      type: "version-deploy",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-tag",
      deploymentId: stagedDeploymentId,
      timestamp: "2026-07-13T10:02:30.000Z",
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
  const activationValue = buildWorkerCandidateActivationEvidence({
    createdAt: "2026-07-13T10:04:00.000Z",
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
      timestamp: "2026-07-13T10:03:30.000Z",
    },
    topology: {
      deploymentId: activeDeploymentId,
      targetCandidateVersionId: candidateVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  return writeWorkerCandidateEvidence(
    workerCandidateActivationEvidencePath(backupDir),
    activationValue,
  );
}

function artifactEvidence(cwd: string): WorkerDeployArtifactEvidence {
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

function stagedBinding(): StagedTranslationReconciliationBinding {
  const digest = (value: string) =>
    Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);
  return {
    releaseMode: "staged-canonical-English-fallback",
    attestationKind:
      "inspir-current-translation-fallback-no-site-promotion-attestation-v1",
    sitePromotionMode: "none-current-availability",
    artifactFileSha256: digest("artifact-file"),
    attestationSha256: digest("attestation"),
    sourceManifestFileSha256: digest("source-manifest"),
    sourceCatalogRootSha256: digest("source-root"),
    availabilityManifestFileSha256: digest("availability-file"),
    availabilityLogicalSha256: digest("availability-logical"),
    availabilityNamespaceEntries: 245,
    localizedHtmlPaths: 245,
    localizedHtmlPathsSha256: digest("localized-paths"),
    curatedSiteTreeSha256: digest("curated-tree"),
    staticMainAppTreeSha256: digest("main-tree"),
    targetSetSha256: digest("target-set"),
    cleanTargetSetSha256: digest("clean-targets"),
    pendingLedgerSha256: digest("pending"),
    pendingEntries: 7_957,
    pendingMissing: 7_865,
    pendingStale: 92,
    fallbackPolicySha256: digest("fallback-policy"),
    d1Corpus: {
      siteRows: 599,
      mainAppRows: 69,
      exactRows: 668,
      rowSetSha256: digest("row-set"),
      payloadCorpusSha256: digest("payload-corpus"),
      cutoverPolicy:
        "preserve-serving-baseline-until-candidate-active-cleanup",
      preActivationMutationAllowed: false,
      postActivationExactCleanupRequired: true,
    },
  };
}

function finalizedAfrikaansBinding(): StagedTranslationReconciliationBinding {
  const current = stagedBinding();
  const digest = (value: string) =>
    Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);
  return {
    ...current,
    attestationKind:
      "inspir-staged-translation-fallback-release-attestation-v1",
    sitePromotionMode: "afrikaans-finalized",
    afrikaansProofSha256: digest("afrikaans-proof"),
    afrikaansAuditManifestSha256: digest("afrikaans-audit"),
    afrikaansSemanticEvidenceSha256: digest("afrikaans-semantic"),
    afrikaansPromotionTransactionId: digest("afrikaans-transaction"),
    afrikaansJournalBindingSha256: digest("afrikaans-journal"),
    afrikaansPostSiteTreeSha256: digest("afrikaans-tree"),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}
