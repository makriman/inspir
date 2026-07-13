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
} from "../scripts/cloudflare/release-sequence-attestations";
import type { WorkerDeployArtifactEvidence } from "../scripts/cloudflare/worker-deploy-evidence";
import type { VectorizeReadinessCurrentRelease } from "../scripts/cloudflare/vectorize-readiness-evidence";

const candidateVersionId = "22222222-2222-4222-8222-222222222222";
const vectorizeCreatedAt = "2026-07-13T10:00:00.000Z";
const topicCreatedAt = "2026-07-13T10:01:00.000Z";
const translationCreatedAt = "2026-07-13T10:02:00.000Z";

test("translation release evidence stays fail-closed while checking and authorizes only exact verified order", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-release-sequence-"));
  const currentRelease = releaseIdentity(artifactEvidence(backupDir));
  try {
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
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-release-drift-"));
  const currentRelease = releaseIdentity(artifactEvidence(backupDir));
  try {
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
      /exact candidate and source|authorize/,
    );
    assert.throws(
      () => assertProductionTranslationReconciliationReleaseBinding({
        backupDir,
        currentRelease: {
          ...currentRelease,
          candidateVersionId: "33333333-3333-4333-8333-333333333333",
          activeVersionId: "33333333-3333-4333-8333-333333333333",
        },
      }),
      /exact candidate and source|authorize/,
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

test("release sequence creation rejects impossible causal timestamps", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-release-causality-"));
  const currentRelease = releaseIdentity(artifactEvidence(backupDir));
  try {
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
): VectorizeReadinessCurrentRelease {
  return {
    candidateVersionId,
    activeVersionId: candidateVersionId,
    git: {
      head: "a".repeat(40),
      upstream: "a".repeat(40),
      upstreamRef: "origin/codex/release",
    },
    artifactEvidence: evidence,
  };
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
