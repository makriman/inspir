import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_FRESH_0016_APPLY_AUTHORIZATION_KIND,
  HISTORICAL_FRESH_0016_APPLY_COMPLETE_KIND,
  historicalFresh0016ApplyAuthorizationPayloadSchema,
} from "../scripts/cloudflare/apply-historical-data-fresh-0016-migration";
import {
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
  projectRuntimeMigrationUsage,
} from "../scripts/cloudflare/check-d1-runtime-migration-budget";
import {
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  preauthorizeHistoricalFresh0016Day2Budget,
  type HistoricalFresh0016Day2BudgetEnvelopeHandle,
} from "../scripts/cloudflare/historical-data-fresh-0016-day2-budget";
import {
  publishHistoricalFresh0016RenderedMigration,
  type HistoricalFresh0016MigrationBinding,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
  HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND,
  HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
  historicalFresh0016MigrationOperationId,
  writeHistoricalFresh0016MigrationBudgetPrepared,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration-budget";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_KIND,
} from "../scripts/cloudflare/historical-data-fresh-0016-prerequisites";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
  buildHistoricalFresh0016PredecessorReport,
  historicalFresh0016PredecessorOperationId,
  historicalFresh0016PredecessorPreparedCaptureSha256,
  parseHistoricalFresh0016PredecessorPreparedCapture,
  writeHistoricalFresh0016PredecessorReport,
} from "../scripts/cloudflare/historical-data-fresh-0016-predecessor";
import {
  createHistoricalFresh0016RunDirectory,
  historicalFresh0016JsonSha256,
  publishHistoricalFresh0016StateStage,
  type HistoricalFresh0016JsonObject,
  type HistoricalFresh0016JsonValue,
  type HistoricalFresh0016Owner,
  type HistoricalFresh0016StateStage,
} from "../scripts/cloudflare/historical-data-fresh-0016-state";
import {
  HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
  historicalFresh0016SuccessorOperationId,
  historicalFresh0016SuccessorPreparedCaptureSha256,
  historicalFresh0016SuccessorProductionExclusionOwnerSha256,
  historicalFresh0016SuccessorRuntimeVerificationReportSha256,
  parseHistoricalFresh0016SuccessorPreparedCapture,
  parseHistoricalFresh0016SuccessorReport,
  writeHistoricalFresh0016SuccessorReport,
} from "../scripts/cloudflare/historical-data-fresh-0016-successor";
import {
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
  createHistoricalPre0016SnapshotPlan,
  type HistoricalPre0016SnapshotCapture,
} from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";
import { buildRepoSourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import {
  HISTORICAL_CORE_ROW_LIMIT,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_COUNT_RESULT_SET_COUNT,
  HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT,
  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT,
  HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT,
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
  HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
  HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
  HISTORICAL_BILLED_READ_LIMIT,
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS,
  HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS,
  HISTORICAL_OPERATIONAL_ROW_LIMIT,
  HISTORICAL_PROTECTED_DATASET_COUNT,
  HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS,
  HISTORICAL_SCHEMA_COLUMN_LIMIT,
  HISTORICAL_SENTINEL_LIMIT,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
  historicalDataSchemaHash,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalSupplementalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import {
  HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS,
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND,
  historicalFresh0016RuntimeVerificationReportSchema,
} from "../scripts/cloudflare/verify-historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND,
  HISTORICAL_FRESH_0016_CUTOVER_COMPLETION_INTENT_KIND,
  HISTORICAL_FRESH_0016_MANIFEST_KIND,
  HISTORICAL_FRESH_0016_MIGRATION_BUDGET_KIND,
  HISTORICAL_FRESH_0016_PREDECESSOR_AUTHORIZATION_KIND,
  HISTORICAL_FRESH_0016_PREDECESSOR_COMPLETE_KIND,
  HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_KIND,
  HISTORICAL_FRESH_0016_RUNTIME_STAGE_KIND,
  HISTORICAL_FRESH_0016_SUCCESSOR_AUTHORIZATION_KIND,
  HISTORICAL_FRESH_0016_SUCCESSOR_COMPLETE_KIND,
  HistoricalFresh0016CutoverChainError,
  buildHistoricalFresh0016CutoverCompletionIntent,
  historicalFresh0016CanonicalCompletePath,
  historicalFresh0016MigrationBudgetEvidenceSchema,
  readAndValidateHistoricalFresh0016CutoverComplete,
  verifyAndPublishHistoricalFresh0016CutoverComplete,
  type HistoricalFresh0016CutoverChainErrorCode,
} from "../scripts/cloudflare/verify-historical-data-fresh-0016-cutover-chain";
import type {
  D1ReleaseBudgetReservationResult,
  D1ReleaseSourceIdentity,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const runId = "11111111-1111-4111-8111-111111111111";
const targetCandidateVersionId = "22222222-2222-4222-8222-222222222222";
const serviceBaselineVersionId = "33333333-3333-4333-8333-333333333333";
const baselineDeploymentStatusOutput = JSON.stringify({
  id: "55555555-5555-4555-8555-555555555555",
  versions: [{ version_id: serviceBaselineVersionId, percentage: 100 }],
});
const hmacKeyId = sha256("fresh-0016-test-hmac-key");
const owner: HistoricalFresh0016Owner = Object.freeze({
  hostname: os.hostname(),
  pid: process.pid,
});
const dayOne = "2026-07-14";
const dayTwo = "2026-07-15";

test("canonical fresh-0016 verifier publishes once and exact replay is idempotent", () => {
  const fixture = createCompleteFixture();
  try {
    assertChainError(
      () => readAndValidateHistoricalFresh0016CutoverComplete({
        cwd: fixture.repoDirectory,
        backupDirectory: fixture.backupDirectory,
      }),
      "PATH_UNSAFE",
    );
    const created = verifyAndPublishHistoricalFresh0016CutoverComplete(
      fixture.verifyInput,
    );
    assert.equal(created.publication, "created");
    assert.equal(created.path, historicalFresh0016CanonicalCompletePath(fixture.backupDirectory));
    assert.equal(created.artifact.state.verifiedStageCount, 12);
    assert.equal(created.artifact.state.boundStageHashCount, 11);
    assert.equal(created.artifact.continuity.ok, true);
    assert.equal(
      created.artifact.continuity.protectedDatasetCount,
      HISTORICAL_PROTECTED_DATASET_COUNT,
    );
    assert.equal(created.artifact.continuity.outboxRowsBeforeActivation, 0);
    assert.equal(created.artifact.policy.legacyIntervalContinuityProven, false);
    assert.equal(created.artifact.policy.retroactiveContinuityClaimed, false);
    assert.equal(created.artifact.migration.runtimeRowsWritten, 0);
    assert.equal(created.artifact.privacy, "hashes-counts-and-hmac-identities-only");
    const stored = fs.readFileSync(created.path);
    const stat = fs.lstatSync(created.path);
    assert.equal(created.sha256, sha256(stored));
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(stat.nlink, 1);
    assert.equal(stored.toString("utf8").endsWith("\n"), true);

    const replay = verifyAndPublishHistoricalFresh0016CutoverComplete(
      fixture.verifyInput,
    );
    assert.equal(replay.publication, "exact-replay");
    assert.equal(replay.sha256, created.sha256);
    assert.deepEqual(replay.artifact, created.artifact);

    const validated = readAndValidateHistoricalFresh0016CutoverComplete({
      cwd: fixture.repoDirectory,
      backupDirectory: fixture.backupDirectory,
    });
    assert.equal(validated.validation, "existing-full-chain");
    assert.equal(validated.sha256, created.sha256);
    assert.deepEqual(validated.artifact, created.artifact);
  } finally {
    fixture.cleanup();
  }
});

test("canonical verifier refuses every incomplete stage tail without writing completion", () => {
  const fixture = createBaseFixture();
  try {
    publishStage(
      fixture,
      "claim",
      claimPayload(
        fixture.sourceFingerprint,
        hmacKeyId,
        fixture.workerRelease,
        "2026-07-14T23:39:30.000Z",
      ),
      "2026-07-14T23:40:00.000Z",
    );
    assertChainError(
      () => verifyAndPublishHistoricalFresh0016CutoverComplete(fixture.verifyInput),
      "CHAIN_INCOMPLETE",
    );
    assert.equal(
      fs.existsSync(historicalFresh0016CanonicalCompletePath(fixture.backupDirectory)),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test("canonical verifier fails closed on filesystem, source, evidence, and continuity adversaries", async (t) => {
  const cases: ReadonlyArray<{
    name: string;
    options?: FixtureOptions;
    mutate?: (fixture: CompleteFixture) => void;
    code: HistoricalFresh0016CutoverChainErrorCode;
  }> = [
    {
      name: "unexpected run entry",
      mutate: (fixture) => {
        fs.writeFileSync(path.join(fixture.paths.runDirectory, "unexpected.json"), "{}\n", { mode: 0o600 });
      },
      code: "CHAIN_INCOMPLETE",
    },
    {
      name: "hard-linked predecessor report",
      mutate: (fixture) => {
        fs.linkSync(
          fixture.paths.auxiliaryFiles.predecessorReport,
          path.join(fixture.paths.runDirectory, "predecessor-hardlink.json"),
        );
      },
      code: "CHAIN_INCOMPLETE",
    },
    {
      name: "symlinked successor report",
      mutate: (fixture) => {
        fs.unlinkSync(fixture.paths.auxiliaryFiles.successorReport);
        fs.symlinkSync(
          fixture.paths.auxiliaryFiles.predecessorReport,
          fixture.paths.auxiliaryFiles.successorReport,
        );
      },
      code: "CHAIN_INCOMPLETE",
    },
    {
      name: "missing rendered migration artifact",
      mutate: (fixture) => {
        fs.unlinkSync(fixture.paths.auxiliaryFiles.renderedMigration);
      },
      code: "CHAIN_INCOMPLETE",
    },
    {
      name: "noncanonical prepared migration budget",
      mutate: (fixture) => {
        fs.appendFileSync(
          fixture.paths.auxiliaryFiles.migrationBudgetPrepared,
          " ",
        );
      },
      code: "ARTIFACT_INVALID",
    },
    {
      name: "broad stage mode",
      mutate: (fixture) => {
        fs.chmodSync(fixture.paths.stageFiles.manifest, 0o644);
      },
      code: "CHAIN_INCOMPLETE",
    },
    {
      name: "repository source drift",
      mutate: (fixture) => {
        fs.appendFileSync(path.join(fixture.repoDirectory, "source.ts"), "export const drift = true;\n");
      },
      code: "SOURCE_DRIFT",
    },
    {
      name: "HMAC identity drift",
      options: { claimHmacKeyId: sha256("wrong-hmac-key") },
      code: "CHAIN_INVALID",
    },
    {
      name: "Worker version drift",
      options: {
        claimTargetCandidateVersionId:
          "99999999-9999-4999-8999-999999999999",
      },
      code: "CHAIN_INVALID",
    },
    {
      name: "database identity drift",
      options: { claimDatabaseName: "wrong-database" },
      code: "CHAIN_INVALID",
    },
    {
      name: "protected row-count decrease",
      options: { predecessorUsers: 2, successorUsers: 1 },
      code: "CHAIN_INVALID",
    },
    {
      name: "predecessor outside final UTC window",
      options: { predecessorStartAt: "2026-07-14T22:00:00.000Z" },
      code: "CHAIN_INVALID",
    },
    {
      name: "conflicting global completion",
      mutate: (fixture) => {
        fs.writeFileSync(
          historicalFresh0016CanonicalCompletePath(fixture.backupDirectory),
          "{}\n",
          { mode: 0o600 },
        );
      },
      code: "PUBLICATION_CONFLICT",
    },
    {
      name: "symlinked global completion path",
      mutate: (fixture) => {
        fs.symlinkSync(
          fixture.paths.auxiliaryFiles.predecessorReport,
          historicalFresh0016CanonicalCompletePath(fixture.backupDirectory),
        );
      },
      code: "PATH_UNSAFE",
    },
  ];
  for (const adversary of cases) {
    await t.test(adversary.name, () => {
      const fixture = createCompleteFixture(adversary.options);
      try {
        adversary.mutate?.(fixture);
        assertChainError(
          () => verifyAndPublishHistoricalFresh0016CutoverComplete(fixture.verifyInput),
          adversary.code,
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
});

type FixtureOptions = Readonly<{
  claimHmacKeyId?: string;
  claimTargetCandidateVersionId?: string;
  claimDatabaseName?: string;
  predecessorUsers?: number;
  successorUsers?: number;
  predecessorStartAt?: string;
}>;

function createBaseFixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "inspir-fresh-0016-chain-")),
  );
  const repoDirectory = path.join(root, "repo");
  const backupDirectory = path.join(root, "backup");
  fs.mkdirSync(repoDirectory, { mode: 0o700 });
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  runGit(repoDirectory, ["init"]);
  fs.writeFileSync(path.join(repoDirectory, "source.ts"), "export const source = true;\n");
  const migrationPath = path.join(
    repoDirectory,
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
  );
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true, mode: 0o700 });
  fs.copyFileSync(
    path.resolve(HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile),
    migrationPath,
  );
  const fullSource = buildRepoSourceFingerprint(repoDirectory);
  const sourceFingerprint = Object.freeze({
    sha256: fullSource.sha256,
    fileCount: fullSource.fileCount,
  });
  const paths = createHistoricalFresh0016RunDirectory({
    backupDirectory,
    runId,
  });
  fs.chmodSync(path.join(backupDirectory, "cloudflare"), 0o700);
  fs.chmodSync(path.dirname(paths.runDirectory), 0o700);
  fs.chmodSync(paths.runDirectory, 0o700);
  const upload = writeUploadEvidence(backupDirectory, sourceFingerprint);
  const workerRelease = Object.freeze({
    phase: "uploaded-inactive" as const,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
  });
  const verifyInput = Object.freeze({
    cwd: repoDirectory,
    backupDirectory,
    cutoverRunId: runId,
  });
  return {
    root,
    repoDirectory,
    backupDirectory,
    sourceFingerprint,
    workerRelease,
    paths,
    verifyInput,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

type BaseFixture = ReturnType<typeof createBaseFixture>;
type CompleteFixture = ReturnType<typeof createCompleteFixture>;

function createCompleteFixture(options: FixtureOptions = {}) {
  const fixture = createBaseFixture();
  try {
    const effectiveClaimHmacKeyId = options.claimHmacKeyId ?? hmacKeyId;
    const predecessorStartAt =
      options.predecessorStartAt ?? "2026-07-14T23:40:00.000Z";
    const predecessorCompleteAt = addMilliseconds(predecessorStartAt, 60_000);
    const predecessorCreatedAt = addMilliseconds(predecessorStartAt, 120_000);
    const claimLiveTopology = liveTopology(
      fixture.workerRelease,
      addMilliseconds(predecessorStartAt, -330_000),
    );
    const predecessorCaptureLiveTopology = liveTopology(
      fixture.workerRelease,
      addMilliseconds(predecessorStartAt, -90_000),
    );
    const predecessorFinalizationLiveTopology = liveTopology(
      fixture.workerRelease,
      addMilliseconds(predecessorStartAt, 90_000),
    );
    const predecessorCapture = createPredecessorCapture(
      fixture.sourceFingerprint,
      options.predecessorUsers ?? 1,
    );
    const predecessorOperationId = historicalFresh0016PredecessorOperationId({
      cutoverRunId: runId,
      sourceFingerprint: fixture.sourceFingerprint,
      ...fixture.workerRelease,
      captureLiveTopology: predecessorCaptureLiveTopology,
      hmacKeyId,
      snapshotPlanSha256: predecessorCapture.plan.planSha256,
    });
    const predecessorUsage = usage(100, 10);
    const predecessorMaximum = ledgerResult({
      backupDirectory: fixture.backupDirectory,
      utcDay: dayOne,
      revision: 1,
      operationId: predecessorOperationId,
      operation: HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
      phase: "maximum",
      rowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      rowsWritten: 0,
      maximumRowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      maximumRowsWritten: 0,
      createdAt: addMilliseconds(predecessorStartAt, -300_000),
      updatedAt: addMilliseconds(predecessorStartAt, -240_000),
      totalsRowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      totalsRowsWritten: 0,
      usage: predecessorUsage,
    });
    const predecessorExact = ledgerResult({
      backupDirectory: fixture.backupDirectory,
      utcDay: dayOne,
      revision: 2,
      operationId: predecessorOperationId,
      operation: HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
      phase: "exact",
      rowsRead: predecessorCapture.rowsRead,
      rowsWritten: 0,
      maximumRowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      maximumRowsWritten: 0,
      createdAt: addMilliseconds(predecessorStartAt, -300_000),
      updatedAt: addMilliseconds(predecessorCompleteAt, 10_000),
      totalsRowsRead: predecessorCapture.rowsRead,
      totalsRowsWritten: 0,
      usage: predecessorUsage,
    });
    const predecessorReport = buildHistoricalFresh0016PredecessorReport({
      capture: predecessorCapture,
      cutoverRunId: runId,
      backupDirectory: fixture.backupDirectory,
      ...fixture.workerRelease,
      captureLiveTopology: predecessorCaptureLiveTopology,
      finalizationLiveTopology: predecessorFinalizationLiveTopology,
      captureStartedAt: new Date(predecessorStartAt),
      captureCompletedAt: new Date(predecessorCompleteAt),
      createdAt: new Date(predecessorCreatedAt),
      finalizedAt: new Date(predecessorCreatedAt),
      usage: predecessorUsage,
      ledger: predecessorExact,
      forbiddenPlaintext: [],
    });
    const predecessorCanonicalSha256 = historicalFresh0016JsonSha256(
      predecessorReport,
    );
    const predecessorFileSha256 = canonicalFileSha256(predecessorReport);

    const baseClaimPayload = claimPayload(
      fixture.sourceFingerprint,
      effectiveClaimHmacKeyId,
      fixture.workerRelease,
      claimLiveTopology.observedAt,
    );
    const claim = publishStage(
      fixture,
      "claim",
      {
        ...baseClaimPayload,
        workerRelease: options.claimTargetCandidateVersionId === undefined
          ? baseClaimPayload.workerRelease
          : {
              ...baseClaimPayload.workerRelease,
              targetCandidateVersionId:
                options.claimTargetCandidateVersionId,
            },
        database: options.claimDatabaseName === undefined
          ? baseClaimPayload.database
          : {
              ...baseClaimPayload.database,
              name: options.claimDatabaseName,
            },
      },
      addMilliseconds(predecessorStartAt, -300_000),
    );
    const predecessorAuthorized = publishStage(
      fixture,
      "predecessor-authorized",
      {
        kind: HISTORICAL_FRESH_0016_PREDECESSOR_AUTHORIZATION_KIND,
        schemaVersion: 2,
        claimStageSha256: claim.sha256,
        operationId: predecessorOperationId,
        sourceFingerprint: fixture.sourceFingerprint,
        workerRelease: fixture.workerRelease,
        captureLiveTopology: predecessorCaptureLiveTopology,
        hmacKeyId,
        snapshotPlanSha256: predecessorCapture.plan.planSha256,
        utcDay: dayOne,
        usage: predecessorUsage,
        maximumReservation: predecessorMaximum,
        d1ExecutionMayHaveStarted: true,
      },
      addMilliseconds(predecessorStartAt, -60_000),
    );
    const predecessorPreparedCapture =
      parseHistoricalFresh0016PredecessorPreparedCapture({
        kind: HISTORICAL_FRESH_0016_PREDECESSOR_PREPARED_KIND,
        schemaVersion: 2,
        phase: "predecessor-prepared-capture",
        boundary: "before-runtime-migration-0016",
        cutoverRunId: runId,
        policy: {
          id: HISTORICAL_FRESH_0016_CUTOVER_POLICY.policyId,
          sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
          reason: HISTORICAL_FRESH_0016_CUTOVER_POLICY.reason,
        },
        paths: predecessorReport.paths,
        database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
        sourceFingerprint: fixture.sourceFingerprint,
        workerRelease: fixture.workerRelease,
        captureLiveTopology: predecessorCaptureLiveTopology,
        hmacKeyId,
        snapshotPlanSha256: predecessorCapture.plan.planSha256,
        authorization: {
          phase: "predecessor",
          d1ExecutionMayStart: true,
          cutoverRunId: runId,
          operationId: predecessorOperationId,
          sourceFingerprint: fixture.sourceFingerprint,
          workerRelease: fixture.workerRelease,
          captureLiveTopology: predecessorCaptureLiveTopology,
          hmacKeyId,
          snapshotPlanSha256: predecessorCapture.plan.planSha256,
          utcDay: dayOne,
          maximumReservationRevision: predecessorMaximum.revision,
          maximumRowsRead:
            HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
          maximumRowsWritten: 0,
          authorizationStageSha256: predecessorAuthorized.sha256,
        },
        captureStartedAt: predecessorStartAt,
        captureCompletedAt: predecessorCompleteAt,
        plannedExactReservedAt: predecessorExact.reservation.updatedAt,
        plannedReportCreatedAt: predecessorCreatedAt,
        utcDay: dayOne,
        operationId: predecessorOperationId,
        usage: predecessorUsage,
        maximumReservation: predecessorMaximum,
        privacy: "hmac-sha256-no-raw-identifiers",
        captureSha256: historicalFresh0016JsonSha256(predecessorCapture),
        rowsRead: predecessorCapture.rowsRead,
        rowsWritten: 0,
        resultSetCount: HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
        maximumAutomaticReadAttempts:
          HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
        capture: predecessorCapture,
      });
    const predecessorPrepared = publishStage(
      fixture,
      "predecessor-prepared",
      predecessorPreparedCapture,
      addMilliseconds(predecessorCompleteAt, 1_000),
    );
    assert.equal(
      predecessorPrepared.value.payloadSha256,
      historicalFresh0016PredecessorPreparedCaptureSha256(
        predecessorPreparedCapture,
      ),
    );
    const predecessorComplete = publishStage(
      fixture,
      "predecessor-complete",
      {
        kind: HISTORICAL_FRESH_0016_PREDECESSOR_COMPLETE_KIND,
        schemaVersion: 1,
        preparedStageSha256: predecessorPrepared.sha256,
        reportCanonicalValueSha256: predecessorCanonicalSha256,
        reportFileSha256: predecessorFileSha256,
      },
      addMilliseconds(predecessorCreatedAt, 1_000),
    );
    const predecessorArtifact = writeHistoricalFresh0016PredecessorReport(
      predecessorReport,
    );
    assert.equal(predecessorArtifact.sha256, predecessorFileSha256);
    const day2Budget = preauthorizeHistoricalFresh0016Day2Budget({
      backupDirectory: fixture.backupDirectory,
      cutoverRunId: runId,
      now: new Date("2026-07-15T00:00:30.000Z"),
      predecessorCompleteStageSha256: predecessorComplete.sha256,
      predecessorReportSha256: predecessorArtifact.sha256,
      sourceFingerprint: fixture.sourceFingerprint,
      ...fixture.workerRelease,
      liveTopology: liveTopology(
        fixture.workerRelease,
        "2026-07-15T00:00:15.000Z",
      ),
      liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
      initialObservedUsage: usage(300, 30),
    });

    const productionOwner = Object.freeze({
      candidateVersionId: targetCandidateVersionId,
      leaseExpiresAt: Date.parse("2026-07-15T02:00:00.000Z"),
      leaseId: "33333333-3333-4333-8333-333333333333",
      runId: "44444444-4444-4444-8444-444444444444",
      sourceFingerprintSha256: fixture.sourceFingerprint.sha256,
    });
    const productionOwnerSha256 =
      historicalFresh0016SuccessorProductionExclusionOwnerSha256(
        productionOwner,
      );
    const migrationBudget = createMigrationBudgetEvidence(
      fixture,
      productionOwnerSha256,
      day2Budget,
    );
    const preparedMigrationBudget =
      writeHistoricalFresh0016MigrationBudgetPrepared({
        backupDirectory: fixture.backupDirectory,
        runId,
        liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
        evidence: {
          kind: HISTORICAL_FRESH_0016_MIGRATION_BUDGET_PREPARED_KIND,
          schemaVersion: 2,
          createdAt: "2026-07-15T00:02:10.000Z",
          cutoverRunId: runId,
          utcDay: migrationBudget.utcDay,
          operationId: migrationBudget.operationId,
          policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
          sourceFingerprint: fixture.sourceFingerprint,
          database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
          workerRelease: migrationBudget.workerRelease,
          liveTopology: migrationBudget.liveTopology,
          day2BudgetEnvelope: migrationBudget.day2BudgetEnvelope,
          productionExclusion: {
            owner: productionOwner,
            ownerSha256: productionOwnerSha256,
            lockBudget: {
              operations: 2,
              reservedRowsRead: 36,
              reservedRowsWritten: 4,
              billedRowsRead: 2,
              billedRowsWritten: 1,
            },
          },
          usage: migrationBudget.usage,
          maximum: migrationBudget.maximum,
          cardinalities: migrationBudget.cardinalities,
          cardinalityQuery: migrationBudget.cardinalityQuery,
          projection: migrationBudget.projection,
          applyEnvelope: migrationBudget.applyEnvelope,
          migrationSource: migrationBudget.migrationSource,
          privacy: "counts-budget-and-release-identities-only",
        },
      });
    const preWriteEvidenceSha256 = historicalFresh0016JsonSha256(
      migrationBudget,
    );
    const predecessorEvidenceChainSha256 = historicalFresh0016JsonSha256({
      claim: claim.sha256,
      predecessorAuthorized: predecessorAuthorized.sha256,
      predecessorPrepared: predecessorPrepared.sha256,
      predecessorComplete: predecessorComplete.sha256,
    });
    const manifestPayload = {
      kind: HISTORICAL_FRESH_0016_MANIFEST_KIND,
      schemaVersion: 2,
      predecessorCompleteStageSha256: predecessorComplete.sha256,
      predecessorReportSha256: predecessorArtifact.sha256,
      predecessorEvidenceChainSha256,
      predecessorHmacKeyId: hmacKeyId,
      successorSnapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
      policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      sourceFingerprint: fixture.sourceFingerprint,
      database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
      workerRelease: fixture.workerRelease,
      migrationLiveTopology: migrationBudget.liveTopology,
      productionExclusion: {
        owner: productionOwner,
        ownerSha256: productionOwnerSha256,
      },
      preWriteEvidenceSha256,
      migrationBudget: {
        evidence: migrationBudget,
        evidenceSha256: preWriteEvidenceSha256,
        preparedArtifactFileSha256: preparedMigrationBudget.sha256,
      },
      migrationSource: {
        file: HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
        bytes: 4_880,
        sha256: "bb82870924eda639b3f6274c1fbefdf0f088423b9bc5b8fd25e7fa08e4ed2062",
      },
    };
    const manifest = publishStage(
      fixture,
      "manifest",
      manifestPayload,
      "2026-07-15T00:03:00.000Z",
    );
    const binding: HistoricalFresh0016MigrationBinding = {
      cutoverRunId: runId,
      cutoverManifestSha256: manifest.value.payloadSha256,
      migrationBudgetPreparedArtifactFileSha256:
        preparedMigrationBudget.sha256,
      predecessorReportSha256: predecessorArtifact.sha256,
      predecessorCompleteSha256: predecessorComplete.sha256,
      predecessorEvidenceChainSha256,
      predecessorHmacKeyId: hmacKeyId,
      successorSnapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
      policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      sourceFingerprint: fixture.sourceFingerprint,
      database: { ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database },
    };
    const rendered = publishHistoricalFresh0016RenderedMigration({
      cwd: fixture.repoDirectory,
      backupDir: fixture.backupDirectory,
      runDirectory: fixture.paths.runDirectory,
      binding,
    });

    const migrationAuthorizationPayload = historicalFresh0016ApplyAuthorizationPayloadSchema.parse({
      kind: HISTORICAL_FRESH_0016_APPLY_AUTHORIZATION_KIND,
      schemaVersion: 1,
      binding,
      manifestStageSha256: manifest.sha256,
      predecessorCompleteStageSha256: predecessorComplete.sha256,
      predecessorReportSha256: predecessorArtifact.sha256,
      preWriteEvidenceSha256,
      renderedMigrationSha256: rendered.evidence.renderedMigration.sha256,
      productionExclusionOwnerSha256: productionOwnerSha256,
      activeWorkerVersion: targetCandidateVersionId,
      sourceFingerprint: fixture.sourceFingerprint,
      preState: {
        classification: "exact-pre-0016",
        staticRowsRead: 10,
        probeRowsRead: 5,
        staticTotalAttempts: 1,
        probeTotalAttempts: 1,
        appliedCheckCount: 8,
        absentCheckCount: 5,
        schemaObjectsAbsent: true,
        fixedMarkerAbsent: true,
        freshMarkerAbsent: true,
      },
      attemptPlan: {
        maximumAttempts: 1,
        explicitSameInvocationRetryAuthorized: false,
        retryPolicy: "one-same-live-invocation-retry-after-exact-absence",
        laterInvocationPolicy: "readback-only-no-retry",
      },
      d1ExecutionMayHaveStarted: true,
    });
    const migrationAuthorized = publishStage(
      fixture,
      "migration-authorized",
      migrationAuthorizationPayload,
      "2026-07-15T00:04:00.000Z",
    );
    const runtimeReport = createRuntimeReport({
      fixture,
      binding,
      predecessorCompleteSha256: predecessorComplete.sha256,
      preWriteEvidenceSha256,
      migrationAuthorizationSha256: migrationAuthorized.sha256,
      rendered,
      productionOwnerSha256,
    });
    const runtimeValueSha256 = historicalFresh0016JsonSha256(runtimeReport);
    const migrationComplete = publishStage(
      fixture,
      "migration-complete",
      {
        kind: HISTORICAL_FRESH_0016_APPLY_COMPLETE_KIND,
        schemaVersion: 1,
        bindingSha256: historicalFresh0016JsonSha256(binding),
        migrationAuthorizedStageSha256: migrationAuthorized.sha256,
        verifierMigrationAuthorizationSha256: migrationAuthorized.sha256,
        runtimeVerificationReportSha256: runtimeValueSha256,
        renderedMigrationSha256: rendered.evidence.renderedMigration.sha256,
        readbackResolutionSha256: null,
        status: "verified",
        attempts: [{
          attempt: 1,
          startedAt: "2026-07-15T00:04:05.000Z",
          completedAt: "2026-07-15T00:04:30.000Z",
          responseConfirmed: true,
          runnerOutcome: "confirmed-success",
          readback: "verified-committed",
        }],
        d1ExecutionVerified: true,
      },
      "2026-07-15T00:05:30.000Z",
    );
    const runtimeStage = publishStage(
      fixture,
      "runtime-verification",
      {
        kind: HISTORICAL_FRESH_0016_RUNTIME_STAGE_KIND,
        schemaVersion: 1,
        migrationCompleteStageSha256: migrationComplete.sha256,
        reportCanonicalValueSha256: runtimeValueSha256,
        reportCanonicalFileSha256: canonicalFileSha256(runtimeReport),
        report: runtimeReport,
      },
      "2026-07-15T00:06:00.000Z",
    );

    const successorCapture = createSuccessorCapture(
      predecessorCapture,
      options.successorUsers ?? options.predecessorUsers ?? 1,
    );
    const successorUsage = usage(200, 20);
    const runtimeFileSha256 =
      historicalFresh0016SuccessorRuntimeVerificationReportSha256(
        runtimeReport,
      );
    const successorCaptureLiveTopology = liveTopology(
      fixture.workerRelease,
      "2026-07-15T00:06:30.000Z",
    );
    const successorFinalizationLiveTopology = liveTopology(
      fixture.workerRelease,
      "2026-07-15T00:10:30.000Z",
    );
    const successorOperationId = historicalFresh0016SuccessorOperationId({
      cutoverRunId: runId,
      sourceFingerprint: fixture.sourceFingerprint,
      ...fixture.workerRelease,
      captureLiveTopology: successorCaptureLiveTopology,
      hmacKeyId,
      predecessorReportSha256: predecessorArtifact.sha256,
      runtimeVerificationStageSha256: runtimeStage.sha256,
      runtimeVerificationReportSha256: runtimeFileSha256,
      productionExclusionOwnerSha256: productionOwnerSha256,
    });
    const successorMaximum = ledgerResult({
      backupDirectory: fixture.backupDirectory,
      utcDay: dayTwo,
      revision: 5,
      operationId: successorOperationId,
      operation: HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
      phase: "maximum",
      rowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      rowsWritten: 0,
      maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      maximumRowsWritten: 0,
      createdAt: "2026-07-15T00:06:10.000Z",
      updatedAt: "2026-07-15T00:06:20.000Z",
      totalsRowsRead: 3_900_000,
      totalsRowsWritten: 70_192,
      usage: successorUsage,
    });
    const successorExact = ledgerResult({
      backupDirectory: fixture.backupDirectory,
      utcDay: dayTwo,
      revision: 6,
      operationId: successorOperationId,
      operation: HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
      phase: "exact",
      rowsRead: successorCapture.rowsRead,
      rowsWritten: 0,
      maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      maximumRowsWritten: 0,
      createdAt: "2026-07-15T00:06:10.000Z",
      updatedAt: "2026-07-15T00:10:00.000Z",
      totalsRowsRead: 3_900_000,
      totalsRowsWritten: 70_192,
      usage: successorUsage,
    });
    const successorAuthorizationContext = {
      phase: "successor",
      d1ExecutionMayStart: true,
      cutoverRunId: runId,
      operationId: successorOperationId,
      accountingParentOperationId: day2Budget.evidence.operationId,
      sourceFingerprint: fixture.sourceFingerprint,
      workerRelease: fixture.workerRelease,
      captureLiveTopology: successorCaptureLiveTopology,
      hmacKeyId,
      snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
      predecessorReportSha256: predecessorArtifact.sha256,
      runtimeVerificationStageSha256: runtimeStage.sha256,
      runtimeVerificationReportSha256: runtimeFileSha256,
      productionExclusionOwnerSha256: productionOwnerSha256,
      utcDay: dayTwo,
      maximumReservationRevision: successorMaximum.revision,
      maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      maximumRowsWritten: 0,
    } as const;
    const successorAuthorized = publishStage(
      fixture,
      "successor-authorized",
      {
        kind: HISTORICAL_FRESH_0016_SUCCESSOR_AUTHORIZATION_KIND,
        schemaVersion: 2,
        runtimeVerificationStageSha256: runtimeStage.sha256,
        operationId: successorOperationId,
        accountingParentOperationId: day2Budget.evidence.operationId,
        authorizationContextSha256: historicalFresh0016JsonSha256(
          successorAuthorizationContext,
        ),
        sourceFingerprint: fixture.sourceFingerprint,
        workerRelease: fixture.workerRelease,
        captureLiveTopology: successorCaptureLiveTopology,
        hmacKeyId,
        predecessorReportSha256: predecessorArtifact.sha256,
        runtimeVerificationReportSha256: runtimeFileSha256,
        productionExclusionOwnerSha256: productionOwnerSha256,
        utcDay: dayTwo,
        usage: successorUsage,
        maximumReservation: successorMaximum,
        d1ExecutionMayHaveStarted: true,
      },
      "2026-07-15T00:07:00.000Z",
    );
    const successorPreparedValue = parseHistoricalFresh0016SuccessorPreparedCapture({
      kind: "inspir-historical-data-fresh-0016-successor-prepared-capture-v2",
      schemaVersion: 2,
      phase: "successor-prepared-capture",
      boundary: "after-runtime-migration-0016-before-worker-activation",
      cutoverRunId: runId,
      policy: {
        id: HISTORICAL_FRESH_0016_CUTOVER_POLICY.policyId,
        sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      },
      paths: {
        backupDirectory: fixture.backupDirectory,
        runDirectory: fixture.paths.runDirectory,
        reportPath: fixture.paths.auxiliaryFiles.successorReport,
      },
      database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
      sourceFingerprint: fixture.sourceFingerprint,
      workerRelease: fixture.workerRelease,
      captureLiveTopology: successorCaptureLiveTopology,
      hmacKeyId,
      snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
      predecessor: {
        reportSha256: predecessorArtifact.sha256,
        createdAt: predecessorReport.createdAt,
        hmacKeyId,
        sourceFingerprint: fixture.sourceFingerprint,
        snapshotPlanSha256: predecessorReport.snapshotPlanSha256,
      },
      migrationRuntimeVerification: {
        stageSha256: runtimeStage.sha256,
        reportSha256: runtimeFileSha256,
        createdAt: runtimeReport.createdAt,
        predecessorCompleteSha256: predecessorComplete.sha256,
        productionExclusionOwnerSha256: productionOwnerSha256,
      },
      productionExclusion: {
        ownerSha256: productionOwnerSha256,
        leaseExpiresAt: productionOwner.leaseExpiresAt,
      },
      authorization: {
        ...successorAuthorizationContext,
        authorizationStageSha256: successorAuthorized.sha256,
      },
      captureStartedAt: "2026-07-15T00:08:00.000Z",
      captureCompletedAt: "2026-07-15T00:09:00.000Z",
      plannedExactReservedAt: "2026-07-15T00:10:00.000Z",
      plannedReportCreatedAt: "2026-07-15T00:11:00.000Z",
      utcDay: dayTwo,
      predecessorToSuccessorGapMs:
        Date.parse("2026-07-15T00:11:00.000Z") -
        Date.parse(predecessorReport.createdAt),
      operationId: successorOperationId,
      accountingParentOperationId: day2Budget.evidence.operationId,
      usage: successorUsage,
      maximumReservation: successorMaximum,
      privacy: "hmac-sha256-no-raw-identifiers",
      captureSha256: historicalFresh0016JsonSha256(successorCapture),
      rowsRead: successorCapture.rowsRead,
      rowsWritten: 0,
      resultSetCount: HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
      automaticAttemptsPerResultSet: 1,
      capture: successorCapture,
    });
    assert.equal(
      successorPreparedValue.captureSha256,
      historicalFresh0016JsonSha256(successorCapture),
    );
    const successorPrepared = publishStage(
      fixture,
      "successor-prepared",
      successorPreparedValue,
      "2026-07-15T00:09:01.000Z",
    );
    assert.equal(
      successorPrepared.value.payloadSha256,
      historicalFresh0016SuccessorPreparedCaptureSha256(successorPreparedValue),
    );
    const successorReport = createSuccessorReport({
      fixture,
      predecessorReport,
      predecessorReportSha256: predecessorArtifact.sha256,
      runtimeReport,
      runtimeStageSha256: runtimeStage.sha256,
      runtimeFileSha256,
      predecessorCompleteSha256: predecessorComplete.sha256,
      productionOwnerSha256,
      productionOwnerLeaseExpiresAt: productionOwner.leaseExpiresAt,
      successorCapture,
      successorOperationId,
      accountingParentOperationId: day2Budget.evidence.operationId,
      successorUsage,
      successorMaximum,
      successorExact,
      successorCaptureLiveTopology,
      successorFinalizationLiveTopology,
    });
    const successorCanonicalSha256 = historicalFresh0016JsonSha256(
      successorReport,
    );
    const successorFileSha256 = canonicalFileSha256(successorReport);
    const successorComplete = publishStage(
      fixture,
      "successor-complete",
      {
        kind: HISTORICAL_FRESH_0016_SUCCESSOR_COMPLETE_KIND,
        schemaVersion: 1,
        preparedStageSha256: successorPrepared.sha256,
        reportCanonicalValueSha256: successorCanonicalSha256,
        reportFileSha256: successorFileSha256,
      },
      "2026-07-15T00:12:00.000Z",
    );
    const successorArtifact = writeHistoricalFresh0016SuccessorReport(
      successorReport,
    );
    assert.equal(successorArtifact.sha256, successorFileSha256);

    const hasSemanticAdversary =
      options.claimHmacKeyId !== undefined ||
      options.claimTargetCandidateVersionId !== undefined ||
      options.claimDatabaseName !== undefined ||
      (options.successorUsers ?? options.predecessorUsers ?? 1) <
        (options.predecessorUsers ?? 1) ||
      options.predecessorStartAt !== undefined;
    let completionPayload: unknown;
    if (hasSemanticAdversary) {
      completionPayload = {
        kind: HISTORICAL_FRESH_0016_CUTOVER_COMPLETION_INTENT_KIND,
        schemaVersion: 1,
        successorCompleteStageSha256: successorComplete.sha256,
        completedAt: "2026-07-15T00:13:00.000Z",
        canonicalCompletePath: historicalFresh0016CanonicalCompletePath(
          fixture.backupDirectory,
        ),
        canonicalArtifactSha256: "a".repeat(64),
      };
    } else {
      const candidate = buildHistoricalFresh0016CutoverCompletionIntent({
        ...fixture.verifyInput,
        completedAt: new Date("2026-07-15T00:13:00.000Z"),
      });
      completionPayload = {
        ...candidate.payload,
        kind: HISTORICAL_FRESH_0016_CUTOVER_COMPLETION_INTENT_KIND,
        canonicalArtifactSha256: candidate.artifactSha256,
      };
    }
    publishStage(
      fixture,
      "cutover-complete",
      completionPayload,
      "2026-07-15T00:13:00.000Z",
    );
    assert.ok(successorComplete.sha256);
    return fixture;
  } catch (error) {
    fixture.cleanup();
    throw error;
  }
}

function claimPayload(
  sourceFingerprint: D1ReleaseSourceIdentity,
  claimHmacKeyId: string,
  workerRelease: BaseFixture["workerRelease"],
  claimTopologyObservedAt: string,
) {
  const claimLiveTopology = liveTopology(
    workerRelease,
    claimTopologyObservedAt,
  );
  return {
    kind: HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND,
    schemaVersion: 2,
    operatorConfirmationFlag: HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
    lostKeyBoundaryAccepted: true,
    legacyIntervalContinuityProven: false,
    retroactiveContinuityClaimed: false,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
    sourceFingerprint,
    workerRelease,
    claimLiveTopology,
    hmacKeyId: claimHmacKeyId,
    predecessorPrerequisites: {
      kind: HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_KIND,
      schemaVersion: 3,
      timing: "completed-on-earlier-utc-day-before-predecessor",
      predecessorUtcDay: "2026-07-14",
      sourceFingerprint,
      workerRelease,
      releaseIdentitySha256: "1".repeat(64),
      topic: {
        createdAt: "2026-07-13T20:00:00.000Z",
        evidenceSha256: "2".repeat(64),
        seedSha256: "3".repeat(64),
        verifiedTopics: 12,
        verifiedArchivedTopics: 1,
      },
      translation: {
        createdAt: "2026-07-13T21:00:00.000Z",
        evidenceSha256: "4".repeat(64),
        method: "read-only-drift",
        remoteQueries: 3,
        billedRowsRead: 100,
        repairApplied: false,
      },
      runtimeMigration0017: {
        utcDay: "2026-07-13",
        appliedAt: "2026-07-13T18:00:00.000Z",
        verifiedAt: "2026-07-13T18:05:00.000Z",
        outcomeEvidenceSha256: "5".repeat(64),
        writeAttemptEvidenceSha256: "6".repeat(64),
        verificationEvidenceSha256: "7".repeat(64),
        pre0016RuntimeStateProofSha256: "8".repeat(64),
        operationId: "d1-runtime-migration-0017",
        reservedRowsRead: 125_000,
        reservedRowsWritten: 50_000,
        state: "applied",
      },
      liveRuntimeState: {
        kind: "inspir-historical-data-fresh-0016-predecessor-runtime-gate-v2",
        schemaVersion: 2,
        timing: "live-before-hmac-run-predecessor-ledger-and-snapshot",
        predecessorUtcDay: "2026-07-14",
        operationId: `historical-fresh-0016-predecessor-runtime-gate:${"9".repeat(64)}`,
        sourceFingerprint,
        workerRelease,
        liveTopology: claimLiveTopology,
        maximum: { rowsRead: 15_132, rowsWritten: 0 },
        exactState: {
          migrations0013To0015: "applied",
          migration0016: "absent",
          migration0017: "applied",
          appliedStaticCheckCount: 8,
          absent0016StaticCheckCount: 5,
        },
        accounting:
          "dedicated-top-level-maximum-reserved-before-live-read-only-queries",
      },
      mutationRule:
        "no-topic-translation-or-0017-mutation-from-predecessor-through-final-verifier",
      privacy: "release-identities-and-aggregate-counts-only",
    },
  };
}

function createPredecessorCapture(
  sourceFingerprint: D1ReleaseSourceIdentity,
  users: number,
): HistoricalPre0016SnapshotCapture {
  const evidence = createProtectedEvidence(users);
  return Object.freeze({
    plan: createHistoricalPre0016SnapshotPlan(sourceFingerprint),
    rowsRead: 100,
    rowsWritten: 0,
    hmacKeyId,
    datasets: evidence.datasets,
    supplementalDatasets: evidence.supplementalDatasets,
  });
}

function createSuccessorCapture(
  predecessor: HistoricalPre0016SnapshotCapture,
  users: number,
) {
  const datasets = cloneCoreEvidence(predecessor.datasets);
  const supplementalDatasets = cloneSupplementalEvidence(
    predecessor.supplementalDatasets,
  );
  datasets.users = datasetEvidence("users", users);
  const outboxColumns = [
    ["vector_id", "text", 1, 1],
    ["absence_count", "integer", 1, 0],
    ["attempt_count", "integer", 1, 0],
    ["created_at", "integer", 1, 0],
    ["last_attempt_at", "integer", 0, 0],
    ["last_error", "text", 0, 0],
    ["lease_token", "text", 0, 0],
    ["lease_until", "integer", 1, 0],
    ["next_attempt_at", "integer", 1, 0],
    ["owner_user_id", "text", 0, 0],
    ["reason", "text", 1, 0],
    ["source_namespace", "text", 0, 0],
    ["source_row_id", "text", 0, 0],
    ["source_row_revision", "integer", 0, 0],
    ["state", "text", 1, 0],
    ["updated_at", "integer", 1, 0],
    ["write_fence_expires_at", "integer", 0, 0],
    ["write_token", "text", 0, 0],
  ].map(([name, type, notNull, primaryKey]) => ({
    name: requiredString(name),
    type: requiredString(type),
    notNull: requiredBit(notNull),
    primaryKey: requiredNumber(primaryKey),
  }));
  return Object.freeze({
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    resultSetCount: HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
    automaticAttemptsPerResultSet: 1,
    rowsRead: 150,
    rowsWritten: 0,
    hmacKeyId,
    datasets,
    supplementalDatasets,
    operationalDatasets: {
      memory_vector_cleanup_outbox: {
        lifecycle: "mutable-drainable-outbox",
        rowCount: 0,
        schemaTable: "memory_vector_cleanup_outbox",
        schemaSha256: historicalDataSchemaHash(outboxColumns),
        columns: outboxColumns,
      },
    },
  } as const);
}

function createProtectedEvidence(users: number) {
  const datasets: Partial<
    Record<HistoricalDatasetName, HistoricalDatasetEvidence>
  > = {};
  const supplementalDatasets: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  > = {};
  for (const spec of HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS) {
    const rowCount = spec.name === "users" ? users : requiredDataset(spec.name) ? 1 : 0;
    const evidence = datasetEvidence(spec.name, rowCount);
    if (isCoreDatasetName(spec.name)) datasets[spec.name] = evidence;
    else if (isSupplementalDatasetName(spec.name)) {
      supplementalDatasets[spec.name] = evidence;
    } else {
      throw new Error(`Unknown protected dataset ${spec.name}.`);
    }
  }
  assertCoreEvidence(datasets);
  assertSupplementalEvidence(supplementalDatasets);
  return { datasets, supplementalDatasets };
}

function datasetEvidence(
  name: HistoricalDatasetName | HistoricalSupplementalDatasetName,
  rowCount: number,
): HistoricalDatasetEvidence {
  const spec = HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS.find(
    (candidate) => candidate.name === name,
  );
  if (!spec) throw new Error(`Missing dataset spec ${name}.`);
  const columns = name === "game_results"
    ? HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.map((column) => ({ ...column }))
    : [{
        name: "id",
        type: "text",
        notNull: 1 as const,
        primaryKey: 1,
      }];
  return {
    rowCount,
    schemaTable: spec.table,
    schemaSha256: historicalDataSchemaHash(columns),
    columns,
    sentinels: Array.from(
      { length: Math.min(rowCount, 2) },
      (_, index) => sha256(`sentinel:${name}:${index}`),
    ),
    ...(name === "game_results"
      ? { schemaObjects: { ...HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS } }
      : {}),
  };
}

function cloneCoreEvidence(
  input: Readonly<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
) {
  return {
    users: cloneDataset(input.users),
    accounts: cloneDataset(input.accounts),
    sessions: cloneDataset(input.sessions),
    chats: cloneDataset(input.chats),
    messages: cloneDataset(input.messages),
    admin_users: cloneDataset(input.admin_users),
    user_memories: cloneDataset(input.user_memories),
    activity_runs: cloneDataset(input.activity_runs),
    product_events: cloneDataset(input.product_events),
    profile_photo_pointers: cloneDataset(input.profile_photo_pointers),
  };
}

function cloneSupplementalEvidence(
  input: Readonly<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
) {
  return {
    ai_runs: cloneDataset(input.ai_runs),
    user_memory_graph_edges: cloneDataset(input.user_memory_graph_edges),
    user_memory_settings: cloneDataset(input.user_memory_settings),
    chat_memory_summaries: cloneDataset(input.chat_memory_summaries),
    chat_memory_turns: cloneDataset(input.chat_memory_turns),
    user_memory_profiles: cloneDataset(input.user_memory_profiles),
    user_memory_summaries: cloneDataset(input.user_memory_summaries),
    memory_synthesis_runs: cloneDataset(input.memory_synthesis_runs),
    memory_source_feedback: cloneDataset(input.memory_source_feedback),
    memory_events: cloneDataset(input.memory_events),
    game_results: cloneDataset(input.game_results),
  };
}

function cloneDataset(input: HistoricalDatasetEvidence): HistoricalDatasetEvidence {
  return {
    rowCount: input.rowCount,
    schemaTable: input.schemaTable,
    schemaSha256: input.schemaSha256,
    columns: input.columns.map((column) => ({ ...column })),
    sentinels: [...input.sentinels],
    ...(input.schemaObjects
      ? { schemaObjects: { ...input.schemaObjects } }
      : {}),
  };
}

function createMigrationBudgetEvidence(
  fixture: BaseFixture,
  exclusionOwnerSha256: string,
  day2Budget: HistoricalFresh0016Day2BudgetEnvelopeHandle,
) {
  const cardinalities = {
    users: 1,
    chats: 1,
    messages: 1,
    aiRuns: 1,
    rateLimitWindows: 1,
    opsEvents: 1,
    activityRuns: 1,
    userMemorySettings: 1,
    memorySourceFeedback: 1,
    suppressionBackfillUsers: 1,
  };
  const projection = projectRuntimeMigrationUsage(cardinalities, 10);
  const runtimeUsage = usage(300, 30);
  const maximumRowsRead =
    HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ;
  const exactRowsRead = projection.rowsRead + 20_128;
  const migrationLiveTopology = liveTopology(
    fixture.workerRelease,
    "2026-07-15T00:01:50.000Z",
  );
  const operationId = historicalFresh0016MigrationOperationId({
    cutoverRunId: runId,
    sourceFingerprint: fixture.sourceFingerprint,
    ...fixture.workerRelease,
    liveTopology: migrationLiveTopology,
    productionExclusionOwnerSha256: exclusionOwnerSha256,
    utcDay: dayTwo,
  });
  const maximum = ledgerResult({
    backupDirectory: fixture.backupDirectory,
    utcDay: dayTwo,
    revision: 3,
    operationId,
    operation: HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
    phase: "maximum",
    rowsRead: maximumRowsRead,
    rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
    maximumRowsRead,
    maximumRowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
    createdAt: "2026-07-15T00:01:00.000Z",
    updatedAt: "2026-07-15T00:01:10.000Z",
    totalsRowsRead: 3_900_000,
    totalsRowsWritten: 70_192,
    usage: runtimeUsage,
  });
  const exact = ledgerResult({
    backupDirectory: fixture.backupDirectory,
    utcDay: dayTwo,
    revision: 4,
    operationId,
    operation: HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
    phase: "exact",
    rowsRead: exactRowsRead,
    rowsWritten: projection.rowsWritten,
    maximumRowsRead,
    maximumRowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
    createdAt: "2026-07-15T00:01:00.000Z",
    updatedAt: "2026-07-15T00:02:00.000Z",
    totalsRowsRead: 3_900_000,
    totalsRowsWritten: 70_192,
    usage: runtimeUsage,
  });
  return historicalFresh0016MigrationBudgetEvidenceSchema.parse({
    kind: HISTORICAL_FRESH_0016_MIGRATION_BUDGET_KIND,
    schemaVersion: 2,
    createdAt: "2026-07-15T00:02:00.000Z",
    cutoverRunId: runId,
    utcDay: dayTwo,
    operationId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint: fixture.sourceFingerprint,
    database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
    workerRelease: fixture.workerRelease,
    liveTopology: migrationLiveTopology,
    day2BudgetEnvelope: {
      operationId: day2Budget.evidence.operationId,
      fileSha256: day2Budget.sha256,
      predecessorCompleteStageSha256:
        day2Budget.evidence.predecessorCompleteStageSha256,
    },
    productionExclusionOwnerSha256: exclusionOwnerSha256,
    usage: runtimeUsage,
    cardinalities,
    cardinalityQuery: {
      rowsRead: 10,
      rowsWritten: 0,
      totalAttempts: 1,
      readOnly: true,
    },
    projection,
    applyEnvelope: {
      projectedRowsRead: 20_128,
      maximumReadOnlyCalls: 8,
      maximumWriteCapableCalls: 2,
      maximumTotalRunnerCalls: 10,
    },
    maximum: {
      rowsRead: maximumRowsRead,
      rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
      ledger: maximum,
    },
    exact: {
      rowsRead: exactRowsRead,
      rowsWritten: projection.rowsWritten,
      ledger: exact,
    },
    migrationSource: {
      file: HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
      bytes: 4_880,
      sha256:
        "bb82870924eda639b3f6274c1fbefdf0f088423b9bc5b8fd25e7fa08e4ed2062",
    },
  });
}

function createRuntimeReport(input: {
  fixture: BaseFixture;
  binding: HistoricalFresh0016MigrationBinding;
  predecessorCompleteSha256: string;
  preWriteEvidenceSha256: string;
  migrationAuthorizationSha256: string;
  rendered: ReturnType<typeof publishHistoricalFresh0016RenderedMigration>;
  productionOwnerSha256: string;
}) {
  const staticRowsRead = 10;
  const postRowsRead = 5;
  return historicalFresh0016RuntimeVerificationReportSchema.parse({
    kind: HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND,
    schemaVersion: 2,
    createdAt: "2026-07-15T00:05:00.000Z",
    ok: true,
    backupDir: input.fixture.backupDirectory,
    runDirectory: input.fixture.paths.runDirectory,
    renderedMigrationPath: input.rendered.path,
    database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
    binding: input.binding,
    evidence: {
      predecessorCompleteSha256: input.predecessorCompleteSha256,
      preWriteEvidenceSha256: input.preWriteEvidenceSha256,
      migrationAuthorizationSha256: input.migrationAuthorizationSha256,
      renderedMigrationSha256:
        input.rendered.evidence.renderedMigration.sha256,
      productionExclusionOwnerSha256: input.productionOwnerSha256,
    },
    activeWorkerVersion: targetCandidateVersionId,
    sourceFingerprint: input.fixture.sourceFingerprint,
    sourceFingerprintStable: true,
    renderedMigration: {
      sourceBytes: input.rendered.evidence.migrationSource.bytes,
      sourceSha256: input.rendered.evidence.migrationSource.sha256,
      renderedSha256: input.rendered.evidence.renderedMigration.sha256,
      freshMarkerValueSha256:
        input.rendered.evidence.freshMarker.valueSha256,
    },
    staticVerification: {
      kind: RUNTIME_MIGRATION_EVIDENCE_KIND,
      createdAt: "2026-07-15T00:04:50.000Z",
      rowsRead: staticRowsRead,
      rowsWritten: 0,
      totalAttempts: 1,
      checkCount: RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length,
    },
    post0016Verification: {
      querySha256: sha256(HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL),
      rowsRead: postRowsRead,
      rowsWritten: 0,
      totalAttempts: 1,
      fixedMarker: {
        key: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
        valueSha256: sha256(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE),
        updatedAt: 1_752_000_000_000,
      },
      freshMarker: {
        key: HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
          .freshCutoverMarkerKey,
        valueSha256: input.rendered.evidence.freshMarker.valueSha256,
        updatedAt: 1_752_000_000_001,
      },
      cleanupOutboxRowCount: 0,
    },
    totalRowsRead: staticRowsRead + postRowsRead,
    totalRowsWritten: 0,
    checks: HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS.map(
      (id) => ({ id, ok: true }),
    ),
  });
}

function createSuccessorReport(input: {
  fixture: BaseFixture;
  predecessorReport: ReturnType<typeof buildHistoricalFresh0016PredecessorReport>;
  predecessorReportSha256: string;
  runtimeReport: ReturnType<typeof createRuntimeReport>;
  runtimeStageSha256: string;
  runtimeFileSha256: string;
  predecessorCompleteSha256: string;
  productionOwnerSha256: string;
  productionOwnerLeaseExpiresAt: number;
  successorCapture: ReturnType<typeof createSuccessorCapture>;
  successorOperationId: string;
  accountingParentOperationId: string;
  successorUsage: ReturnType<typeof usage>;
  successorMaximum: D1ReleaseBudgetReservationResult;
  successorExact: D1ReleaseBudgetReservationResult;
  successorCaptureLiveTopology: ReturnType<typeof liveTopology>;
  successorFinalizationLiveTopology: ReturnType<typeof liveTopology>;
}) {
  const report = {
    kind: "inspir-historical-data-fresh-0016-successor-v2",
    schemaVersion: 2,
    phase: "successor",
    boundary: "after-runtime-migration-0016-before-worker-activation",
    cutoverRunId: runId,
    policy: {
      id: HISTORICAL_FRESH_0016_CUTOVER_POLICY.policyId,
      sha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    },
    paths: {
      backupDirectory: input.fixture.backupDirectory,
      runDirectory: input.fixture.paths.runDirectory,
      reportPath: input.fixture.paths.auxiliaryFiles.successorReport,
    },
    database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
    sourceFingerprint: input.fixture.sourceFingerprint,
    workerRelease: input.fixture.workerRelease,
    captureLiveTopology: input.successorCaptureLiveTopology,
    finalizationLiveTopology: input.successorFinalizationLiveTopology,
    hmacKeyId,
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    predecessor: {
      reportSha256: input.predecessorReportSha256,
      createdAt: input.predecessorReport.createdAt,
      hmacKeyId,
      sourceFingerprint: input.fixture.sourceFingerprint,
      snapshotPlanSha256: input.predecessorReport.snapshotPlanSha256,
    },
    migrationRuntimeVerification: {
      stageSha256: input.runtimeStageSha256,
      reportSha256: input.runtimeFileSha256,
      createdAt: input.runtimeReport.createdAt,
      predecessorCompleteSha256: input.predecessorCompleteSha256,
      productionExclusionOwnerSha256: input.productionOwnerSha256,
    },
    productionExclusion: {
      ownerSha256: input.productionOwnerSha256,
      leaseExpiresAt: input.productionOwnerLeaseExpiresAt,
    },
    captureStartedAt: "2026-07-15T00:08:00.000Z",
    captureCompletedAt: "2026-07-15T00:09:00.000Z",
    exactReservedAt: input.successorExact.reservation.updatedAt,
    createdAt: "2026-07-15T00:11:00.000Z",
    finalizedAt: "2026-07-15T00:11:30.000Z",
    utcDay: dayTwo,
    predecessorToSuccessorGapMs:
      Date.parse("2026-07-15T00:11:00.000Z") -
      Date.parse(input.predecessorReport.createdAt),
    operationId: input.successorOperationId,
    accountingParentOperationId: input.accountingParentOperationId,
    rowsRead: input.successorCapture.rowsRead,
    rowsWritten: 0,
    snapshotExecution: {
      resultSetCount: HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
      countResultSetCount: HISTORICAL_DATA_COUNT_RESULT_SET_COUNT,
      schemaResultSetCount: HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT,
      schemaObjectResultSetCount:
        HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT,
      identityResultSetCount: HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT,
      automaticAttemptsPerResultSet: 1,
    },
    usage: input.successorUsage,
    ledger: {
      maximum: input.successorMaximum,
      exact: input.successorExact,
    },
    limits: {
      protectedDatasetCount: HISTORICAL_PROTECTED_DATASET_COUNT,
      operationalDatasetCount: 1,
      coreRows: HISTORICAL_CORE_ROW_LIMIT,
      supplementalRows: HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
      operationalRows: HISTORICAL_OPERATIONAL_ROW_LIMIT,
      schemaColumnsPerTable: HISTORICAL_SCHEMA_COLUMN_LIMIT,
      sentinelsPerDataset: HISTORICAL_SENTINEL_LIMIT,
      logicalSnapshotRowsRead: HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      logicalRowsReadLimit: HISTORICAL_BILLED_READ_LIMIT,
      maximumAutomaticReadAttempts: HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
      billableRowsReadReservation:
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      requiredCleanupOutboxRows: 0,
    },
    privacy: "hmac-sha256-no-raw-identifiers",
    datasets: input.successorCapture.datasets,
    supplementalDatasets: input.successorCapture.supplementalDatasets,
    operationalDatasets: input.successorCapture.operationalDatasets,
  };
  return parseHistoricalFresh0016SuccessorReport(report);
}

function ledgerResult(input: {
  backupDirectory: string;
  utcDay: string;
  revision: number;
  operationId: string;
  operation: string;
  phase: "maximum" | "exact";
  rowsRead: number;
  rowsWritten: number;
  maximumRowsRead: number;
  maximumRowsWritten: number;
  createdAt: string;
  updatedAt: string;
  totalsRowsRead: number;
  totalsRowsWritten: number;
  usage: ReturnType<typeof usage>;
}): D1ReleaseBudgetReservationResult {
  return {
    ledgerPath: path.join(
      input.backupDirectory,
      "cloudflare",
      `d1-release-budget-ledger-${input.utcDay}.json`,
    ),
    utcDay: input.utcDay,
    revision: input.revision,
    idempotent: false,
    reservation: {
      operationId: input.operationId,
      operation: input.operation,
      candidateVersionId: targetCandidateVersionId,
      phase: input.phase,
      rowsRead: input.rowsRead,
      rowsWritten: input.rowsWritten,
      maximumRowsRead: input.maximumRowsRead,
      maximumRowsWritten: input.maximumRowsWritten,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    },
    totals: {
      rowsRead: input.totalsRowsRead,
      rowsWritten: input.totalsRowsWritten,
    },
    accountedUsage: {
      rowsRead: input.usage.rowsRead + input.totalsRowsRead,
      rowsWritten: input.usage.rowsWritten + input.totalsRowsWritten,
    },
  };
}

function liveTopology(
  workerRelease: Readonly<{
    phase: "uploaded-inactive";
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
  }>,
  observedAt: string,
) {
  return createHistoricalFresh0016LiveTopologyEvidence({
    observedAt: new Date(observedAt),
    statusOutput: baselineDeploymentStatusOutput,
    ...workerRelease,
  });
}

function writeUploadEvidence(
  backupDirectory: string,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  const releaseMessageSha256 = workerReleaseMessageSha256(
    "fresh-0016 cutover-chain fixture",
  );
  const evidence = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-13T23:30:00.000Z",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    expectedReleaseTag: "fresh-0016-cutover-chain-fixture",
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
      timestamp: "2026-07-13T23:29:00.000Z",
    },
    versionView: {
      versionId: targetCandidateVersionId,
      createdAt: "2026-07-13T23:28:00.000Z",
      source: "fixture",
      releaseTag: "fresh-0016-cutover-chain-fixture",
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

function usage(rowsRead: number, rowsWritten: number) {
  return {
    databaseCount: 1,
    queryGroups: 1,
    rowsRead,
    rowsWritten,
    executions: 1,
    windowMinutes: 15,
  };
}

function publishStage(
  fixture: BaseFixture,
  stage: HistoricalFresh0016StateStage,
  payload: unknown,
  createdAt: string,
) {
  return publishHistoricalFresh0016StateStage({
    backupDirectory: fixture.backupDirectory,
    runId,
    stage,
    sourceFingerprint: fixture.sourceFingerprint,
    payload: requireJsonObject(payload),
    now: new Date(createdAt),
    owner,
  });
}

function requireJsonObject(value: unknown): HistoricalFresh0016JsonObject {
  if (!isJsonObject(value)) throw new Error("Fixture value is not a JSON object.");
  return value;
}

function isJsonObject(value: unknown): value is HistoricalFresh0016JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is HistoricalFresh0016JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalFileSha256(value: unknown) {
  return sha256(`${stableCanonicalJson(value)}\n`);
}

function stableCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableCanonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Cannot canonicalize fixture value.");
}

function assertChainError(
  action: () => unknown,
  code: HistoricalFresh0016CutoverChainErrorCode,
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof HistoricalFresh0016CutoverChainError);
    assert.equal(error.code, code);
    return true;
  });
}

function addMilliseconds(value: string, milliseconds: number) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function requiredDataset(name: string) {
  return name === "accounts" ||
    name === "chats" ||
    name === "messages" ||
    name === "user_memories" ||
    name === "user_memory_graph_edges";
}

function isCoreDatasetName(name: string): name is HistoricalDatasetName {
  return HISTORICAL_DATASET_NAMES.some((candidate) => candidate === name);
}

function isSupplementalDatasetName(
  name: string,
): name is HistoricalSupplementalDatasetName {
  return HISTORICAL_SUPPLEMENTAL_DATASET_NAMES.some(
    (candidate) => candidate === name,
  );
}

function assertCoreEvidence(
  value: Partial<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
): asserts value is Record<HistoricalDatasetName, HistoricalDatasetEvidence> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!value[name]) throw new Error(`Fixture omitted ${name}.`);
  }
}

function assertSupplementalEvidence(
  value: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
): asserts value is Record<
  HistoricalSupplementalDatasetName,
  HistoricalDatasetEvidence
> {
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    if (!value[name]) throw new Error(`Fixture omitted ${name}.`);
  }
}

function requiredString(value: unknown) {
  if (typeof value !== "string") throw new Error("Expected fixture string.");
  return value;
}

function requiredNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Expected fixture integer.");
  }
  return value;
}

function requiredBit(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error("Expected fixture bit.");
  return value;
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
