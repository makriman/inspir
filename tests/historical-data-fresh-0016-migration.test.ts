import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_FRESH_0016_DATABASE_MARKER_KIND,
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
  HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  HistoricalFresh0016MigrationError,
  buildHistoricalFresh0016RenderedMigration,
  canonicalHistoricalFresh0016DatabaseMarkerValue,
  createHistoricalFresh0016DatabaseMarker,
  historicalFresh0016RenderedMigrationPath,
  historicalFresh0016RunDirectory,
  parseCanonicalHistoricalFresh0016DatabaseMarkerValue,
  parseHistoricalFresh0016MigrationBinding,
  publishHistoricalFresh0016RenderedMigration,
  readHistoricalFresh0016RenderedMigration,
  type HistoricalFresh0016MigrationBinding,
  type HistoricalFresh0016MigrationErrorCode,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration";
import {
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
  HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND,
  HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
  historicalFresh0016MigrationBudgetPreparedSchema,
  historicalFresh0016MigrationOperationId,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration-budget";
import {
  HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET,
} from "../scripts/cloudflare/apply-historical-data-fresh-0016-migration";
import {
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
} from "../scripts/cloudflare/check-d1-runtime-migration-budget";
import {
  canonicalProductionValidationLockOwner,
} from "../scripts/cloudflare/production-validation-lock";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const targetCandidateVersionId = "22222222-2222-4222-8222-222222222222";
const serviceBaselineVersionId = "99999999-9999-4999-8999-999999999999";
const uploadEvidenceSha256 = "8".repeat(64);
const migrationBaselineStatusOutput = JSON.stringify({
  id: "77777777-7777-4777-8777-777777777777",
  versions: [{ version_id: serviceBaselineVersionId, percentage: 100 }],
});
const binding: HistoricalFresh0016MigrationBinding = {
  cutoverRunId: runId,
  cutoverManifestSha256: "a".repeat(64),
  migrationBudgetPreparedArtifactFileSha256: "9".repeat(64),
  predecessorReportSha256: "b".repeat(64),
  predecessorCompleteSha256: "d".repeat(64),
  predecessorEvidenceChainSha256: "e".repeat(64),
  predecessorHmacKeyId: "f".repeat(64),
  successorSnapshotPlanSha256:
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.snapshotPlanSha256,
  policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  sourceFingerprint: {
    sha256: "c".repeat(64),
    fileCount: 321,
  },
  database: { ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database },
};
const forbiddenRawValue = "private-user-id-that-must-never-be-persisted";

test("fresh-0016 rendering pins exact source bytes and appends one canonical insert-only marker", () => {
  const fixture = createFixture();
  try {
    const built = buildHistoricalFresh0016RenderedMigration({
      cwd: fixture.repoDir,
      binding,
    });
    const sourceBytes = fs.readFileSync(fixture.migrationPath);
    const sourceSha256 = sha256(sourceBytes);
    assert.equal(sourceBytes.byteLength, HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES);
    assert.equal(sourceSha256, HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256);
    assert.equal(built.evidence.migrationSource.sha256, sourceSha256);
    assert.equal(built.evidence.migrationSource.bytes, sourceBytes.byteLength);
    assert.equal(
      built.evidence.renderedMigration.sha256,
      sha256(built.bytes),
    );
    assert.equal(
      built.evidence.renderedMigration.bytes,
      built.bytes.byteLength,
    );
    assert.equal(built.bytes.subarray(0, sourceBytes.byteLength).equals(sourceBytes), true);

    const appended = built.bytes.subarray(sourceBytes.byteLength + 1).toString("utf8");
    assert.match(appended, /^INSERT INTO `app_metadata` \(`key`, `value`, `updated_at`\)/);
    assert.equal((appended.match(/;/g) ?? []).length, 1);
    assert.doesNotMatch(
      appended,
      /\b(?:REPLACE|ON\s+CONFLICT|INSERT\s+OR|OR\s+(?:IGNORE|REPLACE))\b/i,
    );
    assert.doesNotMatch(built.bytes.toString("utf8"), /\b(?:BEGIN|COMMIT|ROLLBACK)\b/i);
    assert.equal(built.evidence.renderedMigration.appendedStatementCount, 1);

    const marker = createHistoricalFresh0016DatabaseMarker(binding);
    assert.deepEqual(marker, {
      kind: HISTORICAL_FRESH_0016_DATABASE_MARKER_KIND,
      schemaVersion: 1,
      cutoverRunId: runId,
      cutoverManifestSha256: binding.cutoverManifestSha256,
      migrationBudgetPreparedArtifactFileSha256:
        binding.migrationBudgetPreparedArtifactFileSha256,
      predecessorReportSha256: binding.predecessorReportSha256,
      predecessorCompleteSha256: binding.predecessorCompleteSha256,
      predecessorEvidenceChainSha256:
        binding.predecessorEvidenceChainSha256,
      predecessorHmacKeyId: binding.predecessorHmacKeyId,
      successorSnapshotPlanSha256: binding.successorSnapshotPlanSha256,
      policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      sourceFingerprintSha256: binding.sourceFingerprint.sha256,
      sourceFingerprintFileCount: binding.sourceFingerprint.fileCount,
      migrationSourceSha256: HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
    });
    assert.equal(Object.hasOwn(marker, "renderedMigrationSha256"), false);
    const markerValue = canonicalHistoricalFresh0016DatabaseMarkerValue(marker);
    assert.equal(markerValue, built.evidence.freshMarker.canonicalValue);
    assert.equal(sha256(Buffer.from(markerValue)), built.evidence.freshMarker.valueSha256);
    assert.deepEqual(
      parseCanonicalHistoricalFresh0016DatabaseMarkerValue(markerValue),
      marker,
    );
    assert.match(appended, new RegExp(escapeRegExp(markerValue)));
    assert.equal(built.bytes.includes(Buffer.from(forbiddenRawValue)), false);
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 binding and marker parsing reject extra, wrong, and noncanonical data", () => {
  assertMigrationError(
    () =>
      parseHistoricalFresh0016MigrationBinding({
        ...binding,
        rawUserId: forbiddenRawValue,
      }),
    "CONTRACT_INVALID",
  );
  const missingHmacBinding: Record<string, unknown> = { ...binding };
  Reflect.deleteProperty(missingHmacBinding, "predecessorHmacKeyId");
  assertMigrationError(
    () => parseHistoricalFresh0016MigrationBinding(missingHmacBinding),
    "CONTRACT_INVALID",
  );
  assertMigrationError(
    () =>
      parseHistoricalFresh0016MigrationBinding({
        ...binding,
        successorSnapshotPlanSha256: "9".repeat(64),
      }),
    "CONTRACT_INVALID",
  );
  assertMigrationError(
    () =>
      parseHistoricalFresh0016MigrationBinding({
        ...binding,
        database: {
          ...binding.database,
          id: "00000000-0000-4000-8000-000000000000",
        },
      }),
    "CONTRACT_INVALID",
  );
  assertMigrationError(
    () =>
      parseHistoricalFresh0016MigrationBinding({
        ...binding,
        policySha256: "d".repeat(64),
      }),
    "CONTRACT_INVALID",
  );

  const marker = createHistoricalFresh0016DatabaseMarker(binding);
  assertMigrationError(
    () =>
      canonicalHistoricalFresh0016DatabaseMarkerValue({
        ...marker,
        secret: forbiddenRawValue,
      }),
    "CONTRACT_INVALID",
  );
  assertMigrationError(
    () =>
      parseCanonicalHistoricalFresh0016DatabaseMarkerValue(
        `${JSON.stringify(marker, null, 2)}\n`,
      ),
    "CONTRACT_INVALID",
  );
  assertMigrationError(
    () => parseCanonicalHistoricalFresh0016DatabaseMarkerValue("not-json"),
    "CONTRACT_INVALID",
  );
});

test("rendered migration publication is owner-only, immutable, and exact-replay idempotent", () => {
  const fixture = createFixture();
  try {
    const first = publishHistoricalFresh0016RenderedMigration({
      cwd: fixture.repoDir,
      backupDir: fixture.backupDir,
      runDirectory: fixture.runDirectory,
      binding,
    });
    assert.equal(first.publication, "created");
    assert.equal(first.path, fixture.renderedPath);
    assert.equal(fs.statSync(first.path).mode & 0o777, 0o600);
    assert.equal(fs.statSync(first.path).nlink, 1);
    assert.equal(fs.readFileSync(first.path).equals(build(fixture).bytes), true);

    const replay = publishHistoricalFresh0016RenderedMigration({
      cwd: fixture.repoDir,
      backupDir: fixture.backupDir,
      runDirectory: fixture.runDirectory,
      binding,
    });
    assert.equal(replay.publication, "exact-replay");
    assert.equal(replay.identity.device, first.identity.device);
    assert.equal(replay.identity.inode, first.identity.inode);
    assert.equal(replay.evidence.renderedMigration.sha256, first.evidence.renderedMigration.sha256);
    assert.deepEqual(
      fs.readdirSync(fixture.runDirectory),
      [HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME],
    );
  } finally {
    fixture.cleanup();
  }
});

test("same-run replay rejects a different manifest or predecessor evidence chain", () => {
  const fixture = createFixture();
  try {
    publish(fixture);
    assertMigrationError(
      () =>
        publishHistoricalFresh0016RenderedMigration({
          cwd: fixture.repoDir,
          backupDir: fixture.backupDir,
          runDirectory: fixture.runDirectory,
          binding: {
            ...binding,
            cutoverManifestSha256: "8".repeat(64),
          },
        }),
      "PUBLICATION_CONFLICT",
    );
    assertMigrationError(
      () =>
        publishHistoricalFresh0016RenderedMigration({
          cwd: fixture.repoDir,
          backupDir: fixture.backupDir,
          runDirectory: fixture.runDirectory,
          binding: {
            ...binding,
            predecessorEvidenceChainSha256: "7".repeat(64),
          },
        }),
      "PUBLICATION_CONFLICT",
    );
  } finally {
    fixture.cleanup();
  }
});

test("rendered migration replay fails closed on content, mode, link, and symlink drift", async (t) => {
  await t.test("content drift", () => {
    const fixture = createFixture();
    try {
      publish(fixture);
      const changed = fs.readFileSync(fixture.renderedPath);
      changed[0] = changed[0] === 0x41 ? 0x42 : 0x41;
      fs.writeFileSync(fixture.renderedPath, changed);
      fs.chmodSync(fixture.renderedPath, 0o600);
      assertMigrationError(() => readPublished(fixture), "PUBLICATION_CONFLICT");
      assertMigrationError(() => publish(fixture), "PUBLICATION_CONFLICT");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("broad mode", () => {
    const fixture = createFixture();
    try {
      publish(fixture);
      fs.chmodSync(fixture.renderedPath, 0o644);
      assertMigrationError(() => readPublished(fixture), "FILE_UNSAFE");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("additional hard link", () => {
    const fixture = createFixture();
    try {
      publish(fixture);
      fs.linkSync(fixture.renderedPath, path.join(fixture.runDirectory, "unexpected-link.sql"));
      assertMigrationError(() => readPublished(fixture), "FILE_UNSAFE");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("symlink at the publication path", () => {
    const fixture = createFixture();
    try {
      const outside = path.join(fixture.root, "outside.sql");
      fs.writeFileSync(outside, build(fixture).bytes, { mode: 0o600 });
      fs.symlinkSync(outside, fixture.renderedPath);
      assertMigrationError(() => publish(fixture), "FILE_UNSAFE");
    } finally {
      fixture.cleanup();
    }
  });
});

test("source and path validation reject tampering, symlinks, broad directories, and cross-run publication", async (t) => {
  await t.test("same-size source tampering", () => {
    const fixture = createFixture();
    try {
      const changed = fs.readFileSync(fixture.migrationPath);
      changed[0] = changed[0] === 0x41 ? 0x42 : 0x41;
      fs.writeFileSync(fixture.migrationPath, changed);
      assertMigrationError(() => build(fixture), "SOURCE_MISMATCH");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("symlinked tracked source", () => {
    const fixture = createFixture();
    try {
      const exactCopy = path.join(fixture.repoDir, "exact-source.sql");
      fs.copyFileSync(fixture.migrationPath, exactCopy);
      fs.rmSync(fixture.migrationPath);
      fs.symlinkSync(exactCopy, fixture.migrationPath);
      assertMigrationError(() => build(fixture), "SOURCE_UNSAFE");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("broad run-directory mode", () => {
    const fixture = createFixture();
    try {
      fs.chmodSync(fixture.runDirectory, 0o755);
      assertMigrationError(() => publish(fixture), "DIRECTORY_UNSAFE");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("different run directory", () => {
    const fixture = createFixture();
    try {
      const otherRunDirectory = path.join(
        path.dirname(fixture.runDirectory),
        "223e4567-e89b-42d3-a456-426614174000",
      );
      fs.mkdirSync(otherRunDirectory, { mode: 0o700 });
      assertMigrationError(
        () =>
          publishHistoricalFresh0016RenderedMigration({
            cwd: fixture.repoDir,
            backupDir: fixture.backupDir,
            runDirectory: otherRunDirectory,
            binding,
          }),
        "PATH_UNSAFE",
      );
    } finally {
      fixture.cleanup();
    }
  });

  const fixture = createFixture();
  try {
    assert.equal(
      historicalFresh0016RunDirectory({
        backupDir: fixture.backupDir,
        cutoverRunId: runId,
      }),
      fixture.runDirectory,
    );
    assert.equal(
      historicalFresh0016RenderedMigrationPath({
        backupDir: fixture.backupDir,
        cutoverRunId: runId,
      }),
      fixture.renderedPath,
    );
    assertMigrationError(
      () =>
        historicalFresh0016RunDirectory({
          backupDir: fixture.backupDir,
          cutoverRunId: "../../outside",
        }),
      "CONTRACT_INVALID",
    );
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 migration budget binds the immutable target separately from the sole-serving baseline", () => {
  const evidence = validMigrationBudgetPreparedEvidence();
  const parsed = historicalFresh0016MigrationBudgetPreparedSchema.parse(
    evidence,
  );
  assert.deepEqual(parsed.workerRelease, {
    phase: "uploaded-inactive",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
  });
  assert.equal(
    parsed.maximum.ledger.reservation.candidateVersionId,
    targetCandidateVersionId,
  );
  assert.equal(
    parsed.productionExclusion.owner.candidateVersionId,
    targetCandidateVersionId,
  );
  assert.notEqual(targetCandidateVersionId, serviceBaselineVersionId);

  const baseOperation = historicalFresh0016MigrationOperationId({
    cutoverRunId: parsed.cutoverRunId,
    sourceFingerprint: parsed.sourceFingerprint,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
    liveTopology: parsed.liveTopology,
    productionExclusionOwnerSha256: parsed.productionExclusion.ownerSha256,
    utcDay: parsed.utcDay,
  });
  assert.equal(baseOperation, parsed.operationId);
  assert.notEqual(
    baseOperation,
    historicalFresh0016MigrationOperationId({
      cutoverRunId: parsed.cutoverRunId,
      sourceFingerprint: parsed.sourceFingerprint,
      targetCandidateVersionId,
      serviceBaselineVersionId: "77777777-7777-4777-8777-777777777777",
      uploadEvidenceSha256,
      liveTopology: createHistoricalFresh0016LiveTopologyEvidence({
        observedAt: new Date("2026-07-15T00:09:00.000Z"),
        statusOutput: JSON.stringify({
          id: "66666666-6666-4666-8666-666666666666",
          versions: [{
            version_id: "77777777-7777-4777-8777-777777777777",
            percentage: 100,
          }],
        }),
        targetCandidateVersionId,
        serviceBaselineVersionId:
          "77777777-7777-4777-8777-777777777777",
        uploadEvidenceSha256,
      }),
      productionExclusionOwnerSha256:
        parsed.productionExclusion.ownerSha256,
      utcDay: parsed.utcDay,
    }),
  );
  assert.notEqual(
    baseOperation,
    historicalFresh0016MigrationOperationId({
      cutoverRunId: parsed.cutoverRunId,
      sourceFingerprint: parsed.sourceFingerprint,
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: "0".repeat(64),
      liveTopology: createHistoricalFresh0016LiveTopologyEvidence({
        observedAt: new Date("2026-07-15T00:09:00.000Z"),
        statusOutput: migrationBaselineStatusOutput,
        targetCandidateVersionId,
        serviceBaselineVersionId,
        uploadEvidenceSha256: "0".repeat(64),
      }),
      productionExclusionOwnerSha256:
        parsed.productionExclusion.ownerSha256,
      utcDay: parsed.utcDay,
    }),
  );
});

test("fresh-0016 migration budget rejects identity swaps, early activation, hash drift, and null or wrong target ownership", () => {
  const tamperers: Array<(value: Record<string, unknown>) => void> = [
    (value) => {
      const release = nestedRecord(value, "workerRelease");
      const target = release.targetCandidateVersionId;
      release.targetCandidateVersionId = release.serviceBaselineVersionId;
      release.serviceBaselineVersionId = target;
    },
    (value) => {
      const release = nestedRecord(value, "workerRelease");
      release.serviceBaselineVersionId = release.targetCandidateVersionId;
    },
    (value) => {
      nestedRecord(value, "workerRelease").uploadEvidenceSha256 =
        "0".repeat(64);
    },
    (value) => {
      nestedRecord(
        nestedRecord(nestedRecord(value, "maximum"), "ledger"),
        "reservation",
      ).candidateVersionId = serviceBaselineVersionId;
    },
    (value) => {
      nestedRecord(
        nestedRecord(value, "productionExclusion"),
        "owner",
      ).candidateVersionId = serviceBaselineVersionId;
    },
    (value) => {
      nestedRecord(
        nestedRecord(value, "productionExclusion"),
        "owner",
      ).candidateVersionId = null;
    },
  ];
  for (const tamper of tamperers) {
    const value: unknown = structuredClone(
      validMigrationBudgetPreparedEvidence(),
    );
    assertRecord(value);
    tamper(value);
    assert.throws(() =>
      historicalFresh0016MigrationBudgetPreparedSchema.parse(value));
  }
});

type Fixture = ReturnType<typeof createFixture>;

function validMigrationBudgetPreparedEvidence() {
  const sourceFingerprint = binding.sourceFingerprint;
  const owner = {
    candidateVersionId: targetCandidateVersionId,
    leaseExpiresAt: Date.parse("2026-07-15T01:00:00.000Z"),
    leaseId: "33333333-3333-4333-8333-333333333333",
    runId,
    sourceFingerprintSha256: sourceFingerprint.sha256,
  } as const;
  const ownerSha256 = createHash("sha256")
    .update(canonicalProductionValidationLockOwner(owner))
    .digest("hex");
  const liveTopology = createHistoricalFresh0016LiveTopologyEvidence({
    observedAt: new Date("2026-07-15T00:09:00.000Z"),
    statusOutput: migrationBaselineStatusOutput,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
  });
  const operationId = historicalFresh0016MigrationOperationId({
    cutoverRunId: runId,
    sourceFingerprint,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
    liveTopology,
    productionExclusionOwnerSha256: ownerSha256,
    utcDay: "2026-07-15",
  });
  return {
    kind: HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND,
    schemaVersion: 2,
    createdAt: "2026-07-15T00:10:00.000Z",
    cutoverRunId: runId,
    utcDay: "2026-07-15",
    operationId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint,
    database: { ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database },
    workerRelease: {
      phase: "uploaded-inactive",
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256,
    },
    liveTopology,
    day2BudgetEnvelope: {
      operationId: `historical-fresh-0016-day2-budget:${"4".repeat(64)}`,
      fileSha256: "5".repeat(64),
      predecessorCompleteStageSha256: "6".repeat(64),
    },
    productionExclusion: {
      owner,
      ownerSha256,
      lockBudget: {
        operations: 2,
        reservedRowsRead: 36,
        reservedRowsWritten: 4,
        billedRowsRead: 0,
        billedRowsWritten: 0,
      },
    },
    usage: {
      databaseCount: 1,
      queryGroups: 0,
      rowsRead: 0,
      rowsWritten: 0,
      executions: 0,
      windowMinutes: 5,
    },
    maximum: {
      rowsRead: HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
      rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
      ledger: {
        ledgerPath: path.resolve(
          "/tmp/d1-release-budget-ledger-2026-07-15.json",
        ),
        utcDay: "2026-07-15",
        revision: 1,
        idempotent: false,
        reservation: {
          operationId,
          operation: HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
          candidateVersionId: targetCandidateVersionId,
          phase: "maximum",
          rowsRead: HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
          rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
          maximumRowsRead:
            HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
          maximumRowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
          createdAt: "2026-07-15T00:10:00.000Z",
          updatedAt: "2026-07-15T00:10:00.000Z",
        },
        totals: {
          rowsRead: HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
          rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
        },
        accountedUsage: {
          rowsRead: HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
          rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
        },
      },
    },
    cardinalities: {
      users: 0,
      chats: 0,
      messages: 0,
      aiRuns: 0,
      rateLimitWindows: 0,
      opsEvents: 0,
      activityRuns: 0,
      userMemorySettings: 0,
      memorySourceFeedback: 0,
      suppressionBackfillUsers: 0,
    },
    cardinalityQuery: {
      rowsRead: 0,
      rowsWritten: 0,
      totalAttempts: 1,
      readOnly: true,
    },
    projection: {
      rowsRead: 0,
      rowsWritten: 0,
      indexedRows: 0,
      runtimeIndexRows: 0,
      activityPartialUniqueIndexRows: 0,
      snapshotRows: 0,
      suppressionBackfillRowsRead: 0,
      suppressionBackfillRowsWritten: 0,
      outboxSchemaRowsRead: 0,
      outboxSchemaRowsWritten: 0,
      freshCutoverMarkerRowsRead: 0,
      freshCutoverMarkerRowsWritten: 0,
    },
    applyEnvelope: {
      projectedRowsRead:
        HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
          .projectedRowsRead,
      maximumReadOnlyCalls:
        HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
          .readOnlyCalls,
      maximumWriteCapableCalls:
        HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
          .writeCapableCalls,
      maximumTotalRunnerCalls:
        HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
          .totalRunnerCalls,
    },
    migrationSource: {
      file: HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
      bytes: HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
      sha256: HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
    },
    privacy: "counts-budget-and-release-identities-only",
  } as const;
}

function createFixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "inspir-fresh-0016-migration-")),
  );
  const repoDir = path.join(root, "repo");
  const backupDir = path.join(root, "backup");
  fs.mkdirSync(repoDir, { mode: 0o700 });
  fs.mkdirSync(backupDir, { mode: 0o700 });
  const migrationPath = path.join(
    repoDir,
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
  );
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
  fs.copyFileSync(
    path.resolve(
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
    ),
    migrationPath,
  );
  const runDirectory = historicalFresh0016RunDirectory({
    backupDir,
    cutoverRunId: runId,
  });
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(runDirectory, 0o700);
  const renderedPath = historicalFresh0016RenderedMigrationPath({
    backupDir,
    cutoverRunId: runId,
  });
  return {
    root,
    repoDir,
    backupDir,
    migrationPath,
    runDirectory,
    renderedPath,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function build(fixture: Fixture) {
  return buildHistoricalFresh0016RenderedMigration({
    cwd: fixture.repoDir,
    binding,
  });
}

function publish(fixture: Fixture) {
  return publishHistoricalFresh0016RenderedMigration({
    cwd: fixture.repoDir,
    backupDir: fixture.backupDir,
    runDirectory: fixture.runDirectory,
    binding,
  });
}

function readPublished(fixture: Fixture) {
  return readHistoricalFresh0016RenderedMigration({
    cwd: fixture.repoDir,
    backupDir: fixture.backupDir,
    runDirectory: fixture.runDirectory,
    binding,
  });
}

function assertMigrationError(
  action: () => unknown,
  code: HistoricalFresh0016MigrationErrorCode,
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof HistoricalFresh0016MigrationError);
    assert.equal(error.code, code);
    return true;
  });
}

function nestedRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  assertRecord(nested);
  return nested;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a migration-budget fixture object.");
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
