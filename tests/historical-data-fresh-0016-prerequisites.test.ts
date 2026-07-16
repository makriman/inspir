import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
  readHistoricalFresh0016PredecessorPrerequisites,
  verifyHistoricalFresh0016PredecessorRuntimeGate,
} from "../scripts/cloudflare/historical-data-fresh-0016-prerequisites";
import {
  d1ReleaseBudgetLedgerPath,
  reserveD1ReleaseBudget,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  D1_DATABASE_NAME,
} from "../scripts/cloudflare/migration-config";
import {
  RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
  runtimeMigration0017VerificationReportPath,
  type RuntimeMigration0017VerificationReport,
} from "../scripts/cloudflare/verify-d1-runtime-migration-0017";
import {
  topicAttestationPath,
  translationAttestationPath,
} from "../scripts/cloudflare/release-sequence-attestations";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const sourceFingerprint = {
  sha256: "a".repeat(64),
  fileCount: 7,
} as const;
const targetCandidateVersionId = "11111111-1111-4111-8111-111111111111";
const serviceBaselineVersionId = "99999999-9999-4999-8999-999999999999";

test("predecessor live runtime gate reserves first and rejects a UTC crossing", () => {
  const root = fs.realpathSync(fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-live-runtime-gate-"),
  ));
  fs.chmodSync(root, 0o700);
  fs.mkdirSync(path.join(root, "cloudflare"), { mode: 0o700 });
  const upload = writeUploadEvidence(root);
  const events: string[] = [];
  const source = { ...sourceFingerprint, files: [] };
  const options = {
    backupDirectory: root,
    cwd: root,
    sourceFingerprint,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    liveDeploymentStatusOutput: deploymentStatusOutput(
      "77777777-7777-4777-8777-777777777777",
      serviceBaselineVersionId,
    ),
    liveTopologyObservedAt: new Date("2026-07-14T23:39:00.000Z"),
    predecessorStartAt: new Date("2026-07-14T23:40:00.000Z"),
    runner: () => {
      throw new Error("Injected live gate verifiers must avoid Wrangler.");
    },
    usageLoader: () => {
      events.push("usage");
      return {
        databaseCount: 1,
        queryGroups: 0,
        rowsRead: 0,
        rowsWritten: 0,
        executions: 0,
        windowMinutes: 5,
      };
    },
    reserveBudget: (input: Parameters<typeof reserveD1ReleaseBudget>[0]) => {
      events.push("reserve");
      return {
        ledgerPath: d1ReleaseBudgetLedgerPath(root, "2026-07-14"),
        utcDay: "2026-07-14",
        revision: 1,
        idempotent: false,
        reservation: {
          operationId: input.operationId,
          operation: input.operation,
          candidateVersionId: targetCandidateVersionId,
          phase: "maximum" as const,
          rowsRead: input.rowsRead,
          rowsWritten: input.rowsWritten,
          maximumRowsRead: input.rowsRead,
          maximumRowsWritten: input.rowsWritten,
          createdAt: "2026-07-14T23:40:00.000Z",
          updatedAt: "2026-07-14T23:40:00.000Z",
        },
        totals: { rowsRead: input.rowsRead, rowsWritten: input.rowsWritten },
        accountedUsage: {
          rowsRead: input.rowsRead,
          rowsWritten: input.rowsWritten,
        },
      };
    },
    pre0016StateVerifier: () => {
      events.push("pre0016");
      return {
        classification: "exact-pre-0016" as const,
        sourceFingerprint,
        staticRowsRead: 13,
        probeRowsRead: 9,
        staticTotalAttempts: 1 as const,
        probeTotalAttempts: 1 as const,
        appliedCheckCount: 8 as const,
        absentCheckCount: 5 as const,
        schemaObjectsAbsent: true as const,
        fixedMarkerAbsent: true as const,
        freshMarkerAbsent: true as const,
      };
    },
    migration0017Verifier: (): RuntimeMigration0017VerificationReport => {
      events.push("0017");
      return {
        kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
        schemaVersion: 1 as const,
        createdAt: "2026-07-14T23:40:00.000Z",
        backupDir: root,
        database: "inspirlearning-prod" as const,
        migration: "drizzle-d1/0017_users_normalized_email_lookup.sql" as const,
        ok: false,
        state: "absent" as const,
        sourceFingerprintBefore: source,
        sourceFingerprint: source,
        sourceFingerprintStable: true,
        rowsRead: 5,
        rowsWritten: 0,
        totalAttempts: 1 as const,
        checks: [
          {
            id: "0017-users-normalized-email-covering-index" as const,
            ok: false,
            detail: {
              state: "absent" as const,
              schemaRows: 0,
              catalogRows: 0,
              keyRows: 0,
              tableMatches: false,
              sqlMatches: false,
              catalogMatches: false,
              keySequenceMatches: false,
            },
          },
        ],
      };
    },
  };
  try {
    const gate = verifyHistoricalFresh0016PredecessorRuntimeGate({
      ...options,
      clock: () => new Date("2026-07-14T23:41:00.000Z"),
    });
    assert.deepEqual(events, ["usage", "reserve", "pre0016", "0017"]);
    assert.equal(
      gate.maximum.rowsRead,
      HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
    );
    events.length = 0;
    assert.throws(
      () => verifyHistoricalFresh0016PredecessorRuntimeGate({
        ...options,
        clock: () => new Date("2026-07-15T00:00:00.000Z"),
      }),
      /crossed its UTC billing day/,
    );
    assert.deepEqual(events, ["usage", "reserve", "pre0016", "0017"]);
    events.length = 0;
    assert.throws(
      () => verifyHistoricalFresh0016PredecessorRuntimeGate({
        ...options,
        uploadEvidenceSha256: "0".repeat(64),
      }),
      /exact inactive upload evidence/,
    );
    assert.deepEqual(events, [], "upload hash drift must fail before D1 admission");
    assert.throws(
      () => verifyHistoricalFresh0016PredecessorRuntimeGate({
        ...options,
        targetCandidateVersionId: serviceBaselineVersionId,
        serviceBaselineVersionId: targetCandidateVersionId,
      }),
      /exact inactive upload evidence/,
    );
    assert.deepEqual(events, [], "candidate/baseline swaps must fail before D1 admission");
    assert.throws(
      () => verifyHistoricalFresh0016PredecessorRuntimeGate({
        ...options,
        serviceBaselineVersionId: "88888888-8888-4888-8888-888888888888",
      }),
      /exact inactive upload evidence/,
    );
    assert.deepEqual(events, [], "baseline drift must fail before D1 admission");
    assert.throws(
      () => verifyHistoricalFresh0016PredecessorRuntimeGate({
        ...options,
        liveDeploymentStatusOutput: deploymentStatusOutput(
          "66666666-6666-4666-8666-666666666666",
          targetCandidateVersionId,
        ),
      }),
      /exact service baseline/,
    );
    assert.deepEqual(events, [], "an active target must fail before D1 admission");
    assert.throws(
      () => verifyHistoricalFresh0016PredecessorRuntimeGate({
        ...options,
        liveTopologyObservedAt: new Date("2026-07-14T23:30:00.000Z"),
      }),
      /stale, future-dated/,
    );
    assert.deepEqual(events, [], "stale topology must fail before D1 admission");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fresh-0016 predecessor claim consumes earlier-day topic/translation and same-day deferred 0017 proof", () => {
  const root = fs.realpathSync(fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-prerequisites-"),
  ));
  fs.chmodSync(root, 0o700);
  const backupDirectory = path.join(root, "backup");
  const cloudflareDirectory = path.join(backupDirectory, "cloudflare");
  fs.mkdirSync(cloudflareDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDirectory, 0o700);
  fs.chmodSync(cloudflareDirectory, 0o700);
  try {
    const upload = writeUploadEvidence(backupDirectory);
    const release = releaseIdentity(upload.sha256);
    const topic = {
      kind: "production-topic-reconciliation-v1",
      createdAt: "2026-07-13T20:00:00.000Z",
      backupDir: path.resolve(backupDirectory),
      status: "reconciled",
      ok: true,
      release,
      vectorizeReadinessCreatedAt: "2026-07-13T19:55:00.000Z",
      topic: {
        seedSha256: "b".repeat(64),
        verifiedTopics: 12,
        verifiedArchivedTopics: 1,
      },
    } as const;
    const translation = {
      kind: "production-translation-reconciliation-v1",
      createdAt: "2026-07-13T21:00:00.000Z",
      backupDir: path.resolve(backupDirectory),
      status: "reconciled",
      ok: true,
      release,
      vectorizeReadinessCreatedAt: "2026-07-13T19:55:00.000Z",
      topicReconciliationCreatedAt: topic.createdAt,
      method: "read-only-drift",
      verification: {
        remoteQueries: 3,
        billedRowsRead: 100,
        repairApplied: false,
      },
    } as const;
    writePrivate(topicAttestationPath(backupDirectory), topic);
    writePrivate(translationAttestationPath(backupDirectory), translation);
    writeRuntimeMigration0017Evidence(backupDirectory);
    const liveRuntimeState = verifyRuntimeGateFixture(
      backupDirectory,
      upload.sha256,
      new Date("2026-07-14T23:45:00.000Z"),
    );

    const evidence = readHistoricalFresh0016PredecessorPrerequisites({
      backupDirectory,
      sourceFingerprint,
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: upload.sha256,
      predecessorStartAt: new Date("2026-07-14T23:45:00.000Z"),
      liveRuntimeState,
    });
    assert.equal(evidence.predecessorUtcDay, "2026-07-14");
    assert.equal(evidence.topic.createdAt, topic.createdAt);
    assert.equal(evidence.translation.createdAt, translation.createdAt);
    assert.equal(
      evidence.mutationRule,
      "no-topic-translation-or-deferred-0017-apply-from-predecessor-through-final-verifier",
    );
    assert.equal(
      evidence.runtimeMigration0017.state,
      "absent-deferred-free-plan",
    );
    assert.equal(
      evidence.liveRuntimeState.exactState.migration0017,
      "absent-deferred-free-plan",
    );

    fs.writeFileSync(
      translationAttestationPath(backupDirectory),
      `${JSON.stringify({
        ...translation,
        createdAt: "2026-07-14T20:00:00.000Z",
      })}\n`,
      { mode: 0o600 },
    );
    fs.chmodSync(translationAttestationPath(backupDirectory), 0o600);
    assert.throws(
      () => readHistoricalFresh0016PredecessorPrerequisites({
        backupDirectory,
        sourceFingerprint,
        targetCandidateVersionId,
        serviceBaselineVersionId,
        uploadEvidenceSha256: upload.sha256,
        predecessorStartAt: new Date("2026-07-14T23:45:00.000Z"),
        liveRuntimeState,
      }),
      /earlier-day/,
    );
    fs.writeFileSync(
      translationAttestationPath(backupDirectory),
      `${JSON.stringify(translation)}\n`,
      { mode: 0o600 },
    );
    fs.chmodSync(translationAttestationPath(backupDirectory), 0o600);
    const verifierPath = runtimeMigration0017VerificationReportPath(
      backupDirectory,
    );
    const verifier = JSON.parse(fs.readFileSync(verifierPath, "utf8")) as unknown;
    for (const state of ["partial", "applied"] as const) {
      const tampered: unknown = structuredClone(verifier);
      assertRecord(tampered);
      tampered.state = state;
      tampered.ok = state === "applied";
      const checks = tampered.checks;
      assert.ok(Array.isArray(checks));
      assertRecord(checks[0]);
      checks[0].ok = state === "applied";
      nestedRecord(checks[0], "detail").state = state;
      fs.writeFileSync(verifierPath, `${JSON.stringify(tampered)}\n`, {
        mode: 0o600,
      });
      fs.chmodSync(verifierPath, 0o600);
      assert.throws(
        () => readHistoricalFresh0016PredecessorPrerequisites({
          backupDirectory,
          sourceFingerprint,
          targetCandidateVersionId,
          serviceBaselineVersionId,
          uploadEvidenceSha256: upload.sha256,
          predecessorStartAt: new Date("2026-07-14T23:45:00.000Z"),
          liveRuntimeState,
        }),
        /absent-0017 report/,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function releaseIdentity(uploadEvidenceSha256: string) {
  return {
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
    git: {
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    },
    artifactEvidence: {
      sourceFingerprintSha256: sourceFingerprint.sha256,
      sourceFingerprintFileCount: sourceFingerprint.fileCount,
      workerSourceSha256: "d".repeat(64),
      wranglerConfigSha256: "e".repeat(64),
      assetManifestSha256: "f".repeat(64),
      assetManifestFileCount: 100,
      assetManifestBytes: 10_000,
    },
  } as const;
}

function writeUploadEvidence(backupDirectory: string) {
  const releaseMessageSha256 = workerReleaseMessageSha256(
    "fresh-0016 candidate fixture",
  );
  const evidence = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-13T17:01:00.000Z",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    expectedReleaseTag: "fresh-0016-fixture",
    expectedReleaseMessageSha256: releaseMessageSha256,
    uploadCommandEvidenceSha256: "1".repeat(64),
    workerDeployPreparationSha256: "2".repeat(64),
    git: {
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    },
    artifacts: {
      sourceFingerprintSha256: sourceFingerprint.sha256,
      sourceFingerprintFileCount: sourceFingerprint.fileCount,
      workerSourceSha256: "d".repeat(64),
      wranglerConfigSha256: "e".repeat(64),
      assetManifestSha256: "f".repeat(64),
      assetManifestFileCount: 100,
      assetManifestBytes: 10_000,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-fixture-tag",
      versionId: targetCandidateVersionId,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-13T17:00:00.000Z",
    },
    versionView: {
      versionId: targetCandidateVersionId,
      createdAt: "2026-07-13T16:59:00.000Z",
      source: "fixture",
      releaseTag: "fresh-0016-fixture",
      releaseMessageSha256,
      resourceConfigSha256: "3".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: "77777777-7777-4777-8777-777777777777",
      serviceBaselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  return writeWorkerCandidateEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
    evidence,
  );
}

function deploymentStatusOutput(
  deploymentId: string,
  soleServingVersionId: string,
) {
  return JSON.stringify({
    id: deploymentId,
    versions: [{ version_id: soleServingVersionId, percentage: 100 }],
  });
}

function verifyRuntimeGateFixture(
  backupDirectory: string,
  uploadEvidenceSha256: string,
  predecessorStartAt: Date,
) {
  const predecessorUtcDay = predecessorStartAt.toISOString().slice(0, 10);
  const observedAt = new Date(predecessorStartAt.getTime() - 60_000);
  const source = { ...sourceFingerprint, files: [] };
  return verifyHistoricalFresh0016PredecessorRuntimeGate({
    backupDirectory,
    cwd: backupDirectory,
    sourceFingerprint,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
    liveDeploymentStatusOutput: deploymentStatusOutput(
      "77777777-7777-4777-8777-777777777777",
      serviceBaselineVersionId,
    ),
    liveTopologyObservedAt: observedAt,
    predecessorStartAt,
    runner: () => {
      throw new Error("Injected prerequisite verifiers must avoid Wrangler.");
    },
    clock: () => new Date(predecessorStartAt.getTime() + 60_000),
    usageLoader: () => ({
      databaseCount: 1,
      queryGroups: 0,
      rowsRead: 0,
      rowsWritten: 0,
      executions: 0,
      windowMinutes: 5,
    }),
    reserveBudget: (input) => ({
      ledgerPath: d1ReleaseBudgetLedgerPath(
        backupDirectory,
        predecessorUtcDay,
      ),
      utcDay: predecessorUtcDay,
      revision: 1,
      idempotent: false,
      reservation: {
        operationId: input.operationId,
        operation: input.operation,
        candidateVersionId: targetCandidateVersionId,
        phase: "maximum",
        rowsRead: input.rowsRead,
        rowsWritten: input.rowsWritten,
        maximumRowsRead: input.rowsRead,
        maximumRowsWritten: input.rowsWritten,
        createdAt: predecessorStartAt.toISOString(),
        updatedAt: predecessorStartAt.toISOString(),
      },
      totals: { rowsRead: input.rowsRead, rowsWritten: input.rowsWritten },
      accountedUsage: {
        rowsRead: input.rowsRead,
        rowsWritten: input.rowsWritten,
      },
    }),
    pre0016StateVerifier: () => ({
      classification: "exact-pre-0016",
      sourceFingerprint,
      staticRowsRead: 13,
      probeRowsRead: 9,
      staticTotalAttempts: 1,
      probeTotalAttempts: 1,
      appliedCheckCount: 8,
      absentCheckCount: 5,
      schemaObjectsAbsent: true,
      fixedMarkerAbsent: true,
      freshMarkerAbsent: true,
    }),
    migration0017Verifier: (): RuntimeMigration0017VerificationReport => ({
      kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
      schemaVersion: 1,
      createdAt: predecessorStartAt.toISOString(),
      backupDir: backupDirectory,
      database: "inspirlearning-prod",
      migration: "drizzle-d1/0017_users_normalized_email_lookup.sql",
      ok: false,
      state: "absent",
      sourceFingerprintBefore: source,
      sourceFingerprint: source,
      sourceFingerprintStable: true,
      rowsRead: 5,
      rowsWritten: 0,
      totalAttempts: 1,
      checks: [{
        id: "0017-users-normalized-email-covering-index",
        ok: false,
        detail: {
          state: "absent",
          schemaRows: 0,
          catalogRows: 0,
          keyRows: 0,
          tableMatches: false,
          sqlMatches: false,
          catalogMatches: false,
          keySequenceMatches: false,
        },
      }],
    }),
  });
}

function writeRuntimeMigration0017Evidence(backupDirectory: string) {
  const source = { ...sourceFingerprint, files: [] };
  const verification = {
    kind: RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: "2026-07-14T23:44:00.000Z",
    backupDir: path.resolve(backupDirectory),
    database: D1_DATABASE_NAME,
    migration: "drizzle-d1/0017_users_normalized_email_lookup.sql",
    ok: false,
    state: "absent",
    sourceFingerprintBefore: source,
    sourceFingerprint: source,
    sourceFingerprintStable: true,
    rowsRead: 5,
    rowsWritten: 0,
    totalAttempts: 1,
    checks: [
      {
        id: "0017-users-normalized-email-covering-index",
        ok: false,
        detail: {
          state: "absent",
          schemaRows: 0,
          catalogRows: 0,
          keyRows: 0,
          tableMatches: false,
          sqlMatches: false,
          catalogMatches: false,
          keySequenceMatches: false,
        },
      },
    ],
  } as const;
  writePrivate(
    runtimeMigration0017VerificationReportPath(backupDirectory),
    verification,
  );
}

function writePrivate(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function nestedRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  assertRecord(nested);
  return nested;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a prerequisite fixture object.");
  }
}
