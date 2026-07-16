import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  type D1DailyUsage,
} from "../scripts/cloudflare/d1-free-budget";
import {
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
  type D1ReleaseBudgetReservationResult,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME,
  HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES,
  HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
  buildHistoricalFresh0016PredecessorReport,
  captureHistoricalFresh0016PredecessorReport,
  finalizeHistoricalFresh0016PredecessorPreparedCapture,
  historicalFresh0016PredecessorOperationId,
  historicalFresh0016PredecessorPaths,
  historicalFresh0016PredecessorPreparedCaptureSha256,
  parseHistoricalFresh0016PredecessorPreparedCapture,
  parseHistoricalFresh0016PredecessorReport,
  readHistoricalFresh0016PredecessorReport,
  writeHistoricalFresh0016PredecessorReport,
  type HistoricalFresh0016PredecessorPreparedCapture,
  type HistoricalFresh0016PredecessorReport,
} from "../scripts/cloudflare/historical-data-fresh-0016-predecessor";
import {
  HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
  HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
  HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SNAPSHOT_SQL,
  createHistoricalPre0016SnapshotPlan,
  type HistoricalPre0016SnapshotCapture,
} from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import { historicalDataHmacKeyId } from "../scripts/cloudflare/historical-data-hmac-key";
import {
  stableStringify,
  type WranglerRunner,
} from "../scripts/cloudflare/migration-config";
import {
  HISTORICAL_CORE_ROW_LIMIT,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS,
  HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS,
  HISTORICAL_PROTECTED_DATASET_COUNT,
  HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS,
  HISTORICAL_SCHEMA_COLUMN_LIMIT,
  HISTORICAL_SENTINEL_LIMIT,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
  historicalDataSchemaHash,
  historicalGameResultsSchemaObjectResultRows,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalSupplementalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import {
  buildWorkerCandidateUploadEvidence,
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const cutoverRunId = "11111111-1111-4111-8111-111111111111";
const targetCandidateVersionId = "22222222-2222-4222-8222-222222222222";
const serviceBaselineVersionId = "99999999-9999-4999-8999-999999999999";
const standaloneUploadEvidenceSha256 = "b".repeat(64);
const sourceFingerprint = Object.freeze({
  sha256: "a".repeat(64),
  fileCount: 321,
});
const hmacSecret = "fresh-0016-private-hmac-secret-0123456789abcdef";
const privateUserId = "private-user-id-0016";
const privateSessionToken = "private-session-token-0016";
const privateGameResultId = "private-game-result";
const privateGameResultPayload = '{"moves":[]}';
const privateGameResultValues = Object.freeze([
  privateGameResultId,
  1,
  "chess",
  "engine",
  "1",
  "checkmate",
  "human",
  "win",
  42,
  privateGameResultPayload,
  1,
  2,
  1,
  2,
] as const);
const forbiddenPlaintext = Object.freeze([
  hmacSecret,
  privateUserId,
  privateSessionToken,
  privateGameResultId,
  privateGameResultPayload,
]);
const captureStartedAt = new Date("2026-07-14T00:10:00.000Z");
const captureCompletedAt = new Date("2026-07-14T00:11:00.000Z");
const reportCreatedAt = new Date("2026-07-14T00:12:00.000Z");
const reportFinalizedAt = new Date("2026-07-14T00:12:30.000Z");
const captureRowsRead = 1_234;
const authorizationReceipt = Object.freeze({
  authorizationStageSha256: "c".repeat(64),
});
const predecessorClockValues = [
  "2026-07-14T00:10:00.000Z",
  "2026-07-14T00:11:00.000Z",
  "2026-07-14T00:12:00.000Z",
  "2026-07-14T00:13:00.000Z",
  "2026-07-14T00:14:00.000Z",
] as const;
const baselineDeploymentStatusOutput = deploymentStatusOutput(
  "77777777-7777-4777-8777-777777777777",
  serviceBaselineVersionId,
);

test("fresh-0016 predecessor report binds the exact truthful privacy-safe boundary", () => {
  const fixture = createFilesystemFixture();
  try {
    const report = buildReport(fixture.backupDirectory);
    const serialized = `${stableStringify(report)}\n`;

    assert.equal(report.cutoverRunId, cutoverRunId);
    assert.equal(
      path.basename(report.paths.reportPath),
      HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME,
    );
    assert.equal(report.policy.id, HISTORICAL_FRESH_0016_CUTOVER_POLICY.policyId);
    assert.equal(report.policy.sha256, HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256);
    assert.equal(
      report.lostKeyBoundary.status,
      "identity-continuity-unverifiable-lost-key",
    );
    assert.equal(report.lostKeyBoundary.predecessorHmacKeyAvailable, false);
    assert.equal(report.lostKeyBoundary.legacyIntervalContinuityProven, false);
    assert.equal(report.lostKeyBoundary.retroactiveContinuityClaimed, false);
    assert.equal(report.sourceFingerprint.sha256, sourceFingerprint.sha256);
    assert.equal(report.sourceFingerprint.fileCount, sourceFingerprint.fileCount);
    assert.deepEqual(report.workerRelease, {
      phase: "uploaded-inactive",
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: fixture.upload.sha256,
    });
    assert.equal(
      report.snapshotPlanSha256,
      createHistoricalPre0016SnapshotPlan(sourceFingerprint).planSha256,
    );
    assert.equal(report.utcDay, "2026-07-14");
    assert.equal(report.rowsRead, captureRowsRead);
    assert.equal(report.rowsWritten, 0);
    assert.equal(report.ledger.reservation.phase, "exact");
    assert.equal(report.ledger.reservation.rowsRead, captureRowsRead);
    assert.equal(report.ledger.reservation.rowsWritten, 0);
    assert.equal(
      report.ledger.reservation.maximumRowsRead,
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    );
    assert.equal(report.ledger.reservation.maximumRowsWritten, 0);
    assert.equal(
      report.ledger.reservation.candidateVersionId,
      targetCandidateVersionId,
    );
    assert.equal(
      report.limits.protectedDatasetCount,
      HISTORICAL_PROTECTED_DATASET_COUNT,
    );
    assert.equal(report.limits.coreRows, HISTORICAL_CORE_ROW_LIMIT);
    assert.equal(
      report.limits.supplementalRows,
      HISTORICAL_SUPPLEMENTAL_ROW_LIMIT,
    );
    assert.equal(
      report.limits.schemaColumnsPerTable,
      HISTORICAL_SCHEMA_COLUMN_LIMIT,
    );
    assert.equal(report.limits.sentinelsPerDataset, HISTORICAL_SENTINEL_LIMIT);
    assert.equal(
      report.limits.logicalSnapshotRowsRead,
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    );
    assert.equal(
      report.limits.logicalRowsReadLimit,
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
    );
    assert.equal(
      report.limits.maximumAutomaticReadAttempts,
      HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
    );
    assert.equal(
      report.limits.billableRowsReadReservation,
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    );
    assert.deepEqual(
      Object.keys(report.datasets).sort(),
      [...HISTORICAL_DATASET_NAMES].sort(),
    );
    assert.deepEqual(
      Object.keys(report.supplementalDatasets).sort(),
      [...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES].sort(),
    );
    assert.deepEqual(
      [...HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES].sort(),
      [
        ...Object.keys(report.datasets),
        ...Object.keys(report.supplementalDatasets),
      ].sort(),
    );
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.paths), true);
    assert.equal(Object.isFrozen(report.datasets.users), true);
    assert.equal(Object.isFrozen(report.datasets.users.columns), true);
    assert.equal(Reflect.set(report.policy, "sha256", "f".repeat(64)), false);
    for (const forbidden of forbiddenPlaintext) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.doesNotMatch(serialized, /"(?:hmacSecret|resultSets)"/);
    assert.ok(Buffer.byteLength(serialized, "utf8") < HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES);
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 predecessor parser rejects tampered source, policy, plan, operation, ledger, paths, and chronology", () => {
  const fixture = createFilesystemFixture();
  try {
    const report = buildReport(fixture.backupDirectory);
    const tamperers: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        nestedRecord(value, "policy").sha256 = "f".repeat(64);
      },
      (value) => {
        nestedRecord(value, "lostKeyBoundary").legacyIntervalContinuityProven = true;
      },
      (value) => {
        nestedRecord(value, "sourceFingerprint").sha256 = "b".repeat(64);
      },
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
        value.snapshotPlanSha256 = "b".repeat(64);
      },
      (value) => {
        value.operationId = `historical-fresh-0016-predecessor:${"f".repeat(64)}`;
      },
      (value) => {
        nestedRecord(nestedRecord(value, "ledger"), "reservation").maximumRowsRead =
          HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION - 1;
      },
      (value) => {
        nestedRecord(nestedRecord(value, "ledger"), "reservation").rowsRead =
          captureRowsRead - 1;
      },
      (value) => {
        nestedRecord(
          nestedRecord(value, "ledger"),
          "reservation",
        ).candidateVersionId = serviceBaselineVersionId;
      },
      (value) => {
        nestedRecord(value, "ledger").ledgerPath = path.join(
          fixture.backupDirectory,
          "cloudflare",
          "wrong-ledger.json",
        );
      },
      (value) => {
        nestedRecord(
          nestedRecord(value, "ledger"),
          "accountedUsage",
        ).rowsRead = D1_FREE_SAFE_ROWS_READ_LIMIT + 1;
      },
      (value) => {
        nestedRecord(value, "paths").reportPath = path.join(
          fixture.paths.runDirectory,
          "wrong-report.json",
        );
      },
      (value) => {
        value.captureStartedAt = "2026-07-14T00:08:00.000Z";
      },
      (value) => {
        value.createdAt = "2026-07-15T00:12:00.000Z";
      },
    ];

    for (const tamper of tamperers) {
      const value: unknown = structuredClone(report);
      assertRecord(value);
      tamper(value);
      assert.throws(
        () =>
          parseHistoricalFresh0016PredecessorReport(value, {
            forbiddenPlaintext,
          }),
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 predecessor privacy scan rejects raw identities and HMAC secrets before publication", () => {
  const fixture = createFilesystemFixture();
  try {
    const report = buildReport(fixture.backupDirectory);
    const rawIdentityValue: unknown = structuredClone(report);
    assertRecord(rawIdentityValue);
    const datasets = nestedRecord(rawIdentityValue, "datasets");
    nestedRecord(datasets, "users").schemaTable = privateUserId;
    assert.throws(
      () =>
        parseHistoricalFresh0016PredecessorReport(rawIdentityValue, {
          forbiddenPlaintext,
        }),
      /forbidden raw identity or secret plaintext/,
    );

    const rawSecretValue: unknown = structuredClone(report);
    assertRecord(rawSecretValue);
    rawSecretValue.hmacKeyId = hmacSecret;
    assert.throws(
      () =>
        parseHistoricalFresh0016PredecessorReport(rawSecretValue, {
          forbiddenPlaintext,
        }),
      /forbidden raw identity or secret plaintext/,
    );
    assert.throws(
      () =>
        parseHistoricalFresh0016PredecessorReport(report, {
          forbiddenPlaintext: ["short"],
        }),
      /at least eight characters/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 predecessor operation identity is deterministic and source-bound", () => {
  const plan = createHistoricalPre0016SnapshotPlan(sourceFingerprint);
  const hmacKeyId = historicalDataHmacKeyId(hmacSecret);
  const captureLiveTopology = liveTopologyEvidence(
    standaloneUploadEvidenceSha256,
    "2026-07-14T00:09:00.000Z",
  );
  const base = {
    cutoverRunId,
    sourceFingerprint,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256: standaloneUploadEvidenceSha256,
    captureLiveTopology,
    hmacKeyId,
    snapshotPlanSha256: plan.planSha256,
  };
  const operationId = historicalFresh0016PredecessorOperationId(base);
  assert.equal(
    operationId,
    historicalFresh0016PredecessorOperationId({ ...base }),
  );
  assert.match(
    operationId,
    /^historical-fresh-0016-predecessor:[a-f0-9]{64}$/,
  );
  assert.notEqual(
    operationId,
    historicalFresh0016PredecessorOperationId({
      ...base,
      sourceFingerprint: { ...sourceFingerprint, sha256: "b".repeat(64) },
    }),
  );
  assert.throws(
    () => historicalFresh0016PredecessorOperationId({
      ...base,
      targetCandidateVersionId: "33333333-3333-4333-8333-333333333333",
    }),
    /topology drifted/,
  );
  assert.notEqual(
    operationId,
    historicalFresh0016PredecessorOperationId({
      ...base,
      hmacKeyId: "c".repeat(64),
    }),
  );
  assert.notEqual(
    operationId,
    historicalFresh0016PredecessorOperationId({
      ...base,
      snapshotPlanSha256: "d".repeat(64),
    }),
  );
});

test("fresh-0016 predecessor authorizes, captures, persists, and only then exact-refines", () => {
  const fixture = createPredecessorCaptureFixture();
  const events: string[] = [];
  let preparedCapture:
    | HistoricalFresh0016PredecessorPreparedCapture
    | undefined;
  try {
    const report = captureHistoricalFresh0016PredecessorReport({
      ...fixture.captureOptions,
      clock: sequenceClock(predecessorClockValues),
      authorizeLastPreD1: (context) => {
        events.push("authorize");
        assert.equal(Object.isFrozen(context), true);
        assert.equal(context.cutoverRunId, cutoverRunId);
        assert.equal(context.operationId, fixture.operationId);
        assert.deepEqual(context.workerRelease, fixture.workerRelease);
        assert.equal(
          context.snapshotPlanSha256,
          createHistoricalPre0016SnapshotPlan(sourceFingerprint).planSha256,
        );
        assert.equal(
          context.maximumReservationRevision,
          fixture.maximumReservation.revision,
        );
        return authorizationReceipt;
      },
      runner: predecessorFixtureRunner(() => {
        events.push("runner");
        assert.deepEqual(events, ["authorize", "runner"]);
      }),
      persistPreparedCapture: (prepared) => {
        events.push("persist");
        assert.deepEqual(events, ["authorize", "runner", "persist"]);
        assert.equal(Object.isFrozen(prepared), true);
        assert.equal(Object.isFrozen(prepared.capture.datasets.users), true);
        assert.equal(
          prepared.authorization.authorizationStageSha256,
          authorizationReceipt.authorizationStageSha256,
        );
        assert.equal(
          prepared.authorization.maximumReservationRevision,
          fixture.maximumReservation.revision,
        );
        assert.equal(
          prepared.captureSha256,
          sha256(stableStringify(prepared.capture)),
        );
        assert.notEqual(
          prepared.captureSha256,
          sha256(`${stableStringify(prepared.capture)}\n`),
        );
        assert.equal(prepared.rowsRead, prepared.capture.rowsRead);
        assert.equal(prepared.rowsWritten, 0);
        assert.equal(
          prepared.resultSetCount,
          HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
        );
        assert.equal(
          prepared.maximumAutomaticReadAttempts,
          HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
        );
        assert.equal(exactReservationPhase(fixture), "maximum");
        preparedCapture = prepared;
      },
    });

    assert.deepEqual(events, ["authorize", "runner", "persist"]);
    assert.ok(preparedCapture);
    assert.deepEqual(
      parseHistoricalFresh0016PredecessorPreparedCapture(
        structuredClone(preparedCapture),
        { forbiddenPlaintext },
      ),
      preparedCapture,
    );
    assert.equal(
      historicalFresh0016PredecessorPreparedCaptureSha256(
        preparedCapture,
        { forbiddenPlaintext },
      ),
      sha256(stableStringify(preparedCapture)),
    );
    const serialized = stableStringify(preparedCapture);
    for (const forbidden of forbiddenPlaintext) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.doesNotMatch(
      serialized,
      /"(?:hmacSecret|identityHashes|resultSets)"/,
    );
    assert.equal(report.rowsRead, 63);
    assert.equal(report.rowsWritten, 0);
    assert.equal(report.ledger.reservation.phase, "exact");
    assert.equal(report.ledger.idempotent, false);
    assert.equal(report.createdAt, "2026-07-14T00:13:00.000Z");
    assert.equal(exactReservationPhase(fixture), "exact");
  } finally {
    fixture.cleanup();
  }
});

test("persisted predecessor capture survives a crash and replays without a second D1 capture", () => {
  const fixture = createPredecessorCaptureFixture();
  let persisted:
    | HistoricalFresh0016PredecessorPreparedCapture
    | undefined;
  let runnerCalls = 0;
  try {
    assert.throws(
      () =>
        captureHistoricalFresh0016PredecessorReport({
          ...fixture.captureOptions,
          clock: sequenceClock(predecessorClockValues),
          authorizeLastPreD1: () => authorizationReceipt,
          runner: predecessorFixtureRunner(() => {
            runnerCalls += 1;
          }),
          persistPreparedCapture: (prepared) => {
            persisted = structuredClone(prepared);
            throw new Error("simulated predecessor crash after persistence");
          },
        }),
      /simulated predecessor crash/,
    );
    assert.equal(runnerCalls, 1);
    assert.ok(persisted);
    assert.equal(exactReservationPhase(fixture), "maximum");

    const recovered = finalizeHistoricalFresh0016PredecessorPreparedCapture({
      preparedCapture: structuredClone(persisted),
      sourceFingerprint,
      ...fixture.workerRelease,
      finalizationLiveTopology: fixture.finalizationLiveTopology,
      liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
      hmacSecret,
      forbiddenPlaintext,
      clock: sequenceClock([predecessorClockValues[4]]),
    });
    assert.equal(runnerCalls, 1);
    assert.equal(exactReservationPhase(fixture), "exact");

    const replayed = finalizeHistoricalFresh0016PredecessorPreparedCapture({
      preparedCapture: structuredClone(persisted),
      sourceFingerprint,
      ...fixture.workerRelease,
      finalizationLiveTopology: fixture.finalizationLiveTopology,
      liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
      hmacSecret,
      forbiddenPlaintext,
      clock: sequenceClock([predecessorClockValues[4]]),
    });
    assert.deepEqual(replayed, recovered);
    assert.equal(runnerCalls, 1);
    assert.equal(replayed.ledger.idempotent, false);
    assert.equal(
      replayed.ledger.reservation.updatedAt,
      persisted.plannedExactReservedAt,
    );
    assert.equal(replayed.createdAt, persisted.plannedReportCreatedAt);
  } finally {
    fixture.cleanup();
  }
});

test("predecessor finalizer rejects plan, source, day, ledger, Worker, HMAC, usage, and privacy drift", () => {
  const scenarios: ReadonlyArray<{
    label: string;
    mutate?: (prepared: Record<string, unknown>) => void;
    liveSource?: Readonly<{ sha256: string; fileCount: number }>;
    targetCandidateVersionId?: string;
    serviceBaselineVersionId?: string;
    uploadEvidenceSha256?: string;
    secret?: string;
    finalizationTime?: string;
    expected?: RegExp;
  }> = [
    {
      label: "plan",
      mutate: (prepared) => {
        nestedRecord(nestedRecord(prepared, "capture"), "plan").planSha256 =
          "0".repeat(64);
      },
    },
    {
      label: "source",
      liveSource: { ...sourceFingerprint, sha256: "b".repeat(64) },
      expected: /exact inactive upload evidence/,
    },
    {
      label: "UTC day",
      finalizationTime: "2026-07-15T00:00:00.000Z",
      expected: /stale, future-dated/,
    },
    {
      label: "ledger",
      mutate: (prepared) => {
        const maximum = nestedRecord(prepared, "maximumReservation");
        const authorization = nestedRecord(prepared, "authorization");
        const revision = maximum.revision;
        if (typeof revision !== "number") {
          throw new Error("Fixture maximum revision must be numeric.");
        }
        maximum.revision = revision + 1;
        authorization.maximumReservationRevision = revision + 1;
      },
      expected: /neither its exact live maximum nor exact ledger reservation/,
    },
    {
      label: "target candidate",
      targetCandidateVersionId: "33333333-3333-4333-8333-333333333333",
      expected: /exact inactive upload evidence/,
    },
    {
      label: "baseline drift",
      serviceBaselineVersionId: "44444444-4444-4444-8444-444444444444",
      expected: /exact inactive upload evidence/,
    },
    {
      label: "upload hash drift",
      uploadEvidenceSha256: "0".repeat(64),
      expected: /exact inactive upload evidence/,
    },
    {
      label: "target active early",
      serviceBaselineVersionId: targetCandidateVersionId,
      expected: /must differ from the serving baseline/,
    },
    {
      label: "HMAC",
      secret: "different-fresh-0016-hmac-secret-0123456789abcdef",
      expected: /live source, Worker, or HMAC key/,
    },
    {
      label: "usage",
      mutate: (prepared) => {
        const preparedUsage = nestedRecord(prepared, "usage");
        const rowsRead = preparedUsage.rowsRead;
        if (typeof rowsRead !== "number") {
          throw new Error("Fixture usage rows read must be numeric.");
        }
        preparedUsage.rowsRead = rowsRead + 1;
      },
      expected: /ledger does not cover exact usage/,
    },
    {
      label: "privacy",
      mutate: (prepared) => {
        nestedRecord(
          nestedRecord(nestedRecord(prepared, "capture"), "datasets"),
          "users",
        ).schemaTable = privateUserId;
      },
      expected: /forbidden raw identity or secret plaintext/,
    },
  ];

  for (const scenario of scenarios) {
    const fixture = createPredecessorCaptureFixture();
    try {
      const prepared: unknown = structuredClone(
        capturePreparedThenCrash(fixture),
      );
      assertRecord(prepared);
      scenario.mutate?.(prepared);
      const finalize = () =>
          finalizeHistoricalFresh0016PredecessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint: scenario.liveSource ?? sourceFingerprint,
            targetCandidateVersionId:
              scenario.targetCandidateVersionId ??
              fixture.workerRelease.targetCandidateVersionId,
            serviceBaselineVersionId:
              scenario.serviceBaselineVersionId ??
              fixture.workerRelease.serviceBaselineVersionId,
            uploadEvidenceSha256:
              scenario.uploadEvidenceSha256 ??
              fixture.workerRelease.uploadEvidenceSha256,
            finalizationLiveTopology: fixture.finalizationLiveTopology,
            liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
            hmacSecret: scenario.secret ?? hmacSecret,
            forbiddenPlaintext,
            clock: sequenceClock([
              scenario.finalizationTime ?? predecessorClockValues[4],
            ]),
          });
      if (scenario.expected) {
        assert.throws(finalize, scenario.expected, scenario.label);
      } else {
        assert.throws(finalize, scenario.label);
      }
      assert.equal(
        exactReservationPhase(fixture),
        "maximum",
        `${scenario.label} must fail before exact refinement`,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("predecessor rejects non-strict or asynchronous authorization before D1", () => {
  const scenarios: ReadonlyArray<{
    label: string;
    replacement: () => unknown;
    expected?: RegExp;
  }> = [
    {
      label: "extra receipt keys",
      replacement: () => ({ ...authorizationReceipt, unexpected: true }),
    },
    {
      label: "thenable receipt",
      replacement: () => ({ ...authorizationReceipt, then: () => undefined }),
      expected: /Promise or thenable/,
    },
    {
      label: "Promise receipt",
      replacement: () => Promise.resolve(authorizationReceipt),
      expected: /Promise or thenable/,
    },
  ];

  for (const scenario of scenarios) {
    const fixture = createPredecessorCaptureFixture();
    let runnerCalls = 0;
    try {
      const options = {
        ...fixture.captureOptions,
        clock: sequenceClock(predecessorClockValues),
        authorizeLastPreD1: () => authorizationReceipt,
        runner: () => {
          runnerCalls += 1;
          return "[]";
        },
      };
      assert.equal(
        Reflect.set(options, "authorizeLastPreD1", scenario.replacement),
        true,
      );
      const capture = () =>
        captureHistoricalFresh0016PredecessorReport(options);
      if (scenario.expected) {
        assert.throws(capture, scenario.expected, scenario.label);
      } else {
        assert.throws(capture, scenario.label);
      }
      assert.equal(runnerCalls, 0, scenario.label);
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  }
});

test("predecessor rejects drifted maximum ledger evidence before D1", () => {
  const fixture = createPredecessorCaptureFixture();
  let runnerCalls = 0;
  try {
    const maximumReservation = {
      ...fixture.maximumReservation,
      revision: fixture.maximumReservation.revision + 1,
    };
    assert.throws(
      () =>
        captureHistoricalFresh0016PredecessorReport({
          ...fixture.captureOptions,
          maximumReservation,
          clock: sequenceClock(predecessorClockValues),
          runner: () => {
            runnerCalls += 1;
            return "[]";
          },
        }),
      /does not match the exact live pre-D1 reservation/,
    );
    assert.equal(runnerCalls, 0);
    assert.equal(exactReservationPhase(fixture), "maximum");
  } finally {
    fixture.cleanup();
  }
});

test("predecessor rejects an already-active target or stale topology before D1", () => {
  const fixture = createPredecessorCaptureFixture();
  let runnerCalls = 0;
  try {
    assert.throws(
      () => captureHistoricalFresh0016PredecessorReport({
        ...fixture.captureOptions,
        liveDeploymentStatusOutput: deploymentStatusOutput(
          "66666666-6666-4666-8666-666666666666",
          targetCandidateVersionId,
        ),
        clock: sequenceClock(predecessorClockValues),
        runner: () => {
          runnerCalls += 1;
          return "[]";
        },
      }),
      /exact service baseline/,
    );
    assert.equal(runnerCalls, 0);
    assert.throws(
      () => captureHistoricalFresh0016PredecessorReport({
        ...fixture.captureOptions,
        captureLiveTopology: liveTopologyEvidence(
          fixture.workerRelease.uploadEvidenceSha256,
          "2026-07-14T00:00:00.000Z",
        ),
        clock: sequenceClock(predecessorClockValues),
        runner: () => {
          runnerCalls += 1;
          return "[]";
        },
      }),
      /stale, future-dated/,
    );
    assert.equal(runnerCalls, 0);
    assert.equal(exactReservationPhase(fixture), "maximum");
  } finally {
    fixture.cleanup();
  }
});

test("predecessor persistence omission, throw, or async return blocks exact refinement", () => {
  const omittedFixture = createPredecessorCaptureFixture();
  let omittedRunnerCalls = 0;
  try {
    const options = {
      ...omittedFixture.captureOptions,
      clock: sequenceClock(predecessorClockValues),
      authorizeLastPreD1: () => authorizationReceipt,
      runner: () => {
        omittedRunnerCalls += 1;
        return "[]";
      },
    };
    assert.equal(Reflect.deleteProperty(options, "persistPreparedCapture"), true);
    assert.throws(
      () => captureHistoricalFresh0016PredecessorReport(options),
      /requires a synchronous prepared-capture persistence callback/,
    );
    assert.equal(omittedRunnerCalls, 0);
    assert.equal(exactReservationPhase(omittedFixture), "maximum");
  } finally {
    omittedFixture.cleanup();
  }

  for (const mode of ["throw", "async"] as const) {
    const fixture = createPredecessorCaptureFixture();
    let runnerCalls = 0;
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016PredecessorReport({
            ...fixture.captureOptions,
            clock: sequenceClock(predecessorClockValues),
            authorizeLastPreD1: () => authorizationReceipt,
            runner: predecessorFixtureRunner(() => {
              runnerCalls += 1;
            }),
            persistPreparedCapture:
              mode === "throw"
                ? () => {
                    throw new Error("prepared persistence failed");
                  }
                : () => Promise.resolve(),
          }),
        mode === "throw"
          ? /prepared persistence failed/
          : /must complete synchronously without a return value/,
      );
      assert.equal(runnerCalls, 1);
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  }
});

test("fresh-0016 predecessor writer publishes canonical owner-only bytes exactly once and reads them back", () => {
  const fixture = createFilesystemFixture();
  try {
    const report = buildReport(fixture.backupDirectory);
    const artifact = writeHistoricalFresh0016PredecessorReport(report, {
      forbiddenPlaintext,
    });
    const bytes = fs.readFileSync(artifact.path);
    const stat = fs.lstatSync(artifact.path);
    assert.equal(artifact.path, fixture.paths.reportPath);
    assert.equal(artifact.bytes, bytes.byteLength);
    assert.equal(
      artifact.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(bytes.toString("utf8"), `${stableStringify(report)}\n`);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(stat.nlink, 1);
    assert.deepEqual(artifact.report, report);

    const readback = readHistoricalFresh0016PredecessorReport({
      backupDirectory: fixture.backupDirectory,
      cutoverRunId,
      forbiddenPlaintext,
    });
    assert.deepEqual(readback, artifact);
    assert.throws(
      () =>
        writeHistoricalFresh0016PredecessorReport(report, {
          forbiddenPlaintext,
        }),
      /created once at its absent reserved path/,
    );

    fs.chmodSync(artifact.path, 0o644);
    assert.throws(
      () =>
        readHistoricalFresh0016PredecessorReport({
          backupDirectory: fixture.backupDirectory,
          cutoverRunId,
          forbiddenPlaintext,
        }),
      /owner-only|unsafe ownership/,
    );
    fs.chmodSync(artifact.path, 0o600);
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 predecessor reader rejects noncanonical bytes and hard-linked evidence", () => {
  const fixture = createFilesystemFixture();
  try {
    const report = buildReport(fixture.backupDirectory);
    writeHistoricalFresh0016PredecessorReport(report, { forbiddenPlaintext });
    fs.writeFileSync(
      fixture.paths.reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
    fs.chmodSync(fixture.paths.reportPath, 0o600);
    assert.throws(
      () =>
        readHistoricalFresh0016PredecessorReport({
          backupDirectory: fixture.backupDirectory,
          cutoverRunId,
          forbiddenPlaintext,
        }),
      /bytes are not canonical/,
    );

    fs.writeFileSync(
      fixture.paths.reportPath,
      `${stableStringify(report)}\n`,
      { mode: 0o600 },
    );
    const alias = path.join(fixture.paths.runDirectory, "predecessor-hardlink.json");
    fs.linkSync(fixture.paths.reportPath, alias);
    assert.equal(fs.lstatSync(fixture.paths.reportPath).nlink, 2);
    assert.throws(
      () =>
        readHistoricalFresh0016PredecessorReport({
          backupDirectory: fixture.backupDirectory,
          cutoverRunId,
          forbiddenPlaintext,
        }),
      /link count|immutable owner-only/,
    );
    fs.unlinkSync(alias);
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 predecessor helpers reject symlinks, missing or broad directories, and preexisting paths", () => {
  const symlinkFixture = createFilesystemFixture();
  try {
    const report = buildReport(symlinkFixture.backupDirectory);
    const victim = path.join(symlinkFixture.paths.runDirectory, "victim.json");
    fs.writeFileSync(victim, "{}\n", { mode: 0o600 });
    fs.symlinkSync(victim, symlinkFixture.paths.reportPath);
    assert.throws(
      () =>
        writeHistoricalFresh0016PredecessorReport(report, {
          forbiddenPlaintext,
        }),
      /created once at its absent reserved path/,
    );
    assert.throws(
      () =>
        readHistoricalFresh0016PredecessorReport({
          backupDirectory: symlinkFixture.backupDirectory,
          cutoverRunId,
          forbiddenPlaintext,
        }),
      /real immutable owner-only file/,
    );
  } finally {
    symlinkFixture.cleanup();
  }

  const missingFixture = createFilesystemFixture(false);
  try {
    const report = buildReport(missingFixture.backupDirectory);
    assert.throws(
      () =>
        writeHistoricalFresh0016PredecessorReport(report, {
          forbiddenPlaintext,
        }),
      /owner-only mode-0700 directory/,
    );
  } finally {
    missingFixture.cleanup();
  }

  const broadFixture = createFilesystemFixture();
  try {
    const report = buildReport(broadFixture.backupDirectory);
    fs.chmodSync(broadFixture.paths.runDirectory, 0o755);
    assert.throws(
      () =>
        writeHistoricalFresh0016PredecessorReport(report, {
          forbiddenPlaintext,
        }),
      /owner-only mode-0700 directory/,
    );
    fs.chmodSync(broadFixture.paths.runDirectory, 0o700);
  } finally {
    broadFixture.cleanup();
  }
});

type PredecessorCaptureFixture = ReturnType<
  typeof createPredecessorCaptureFixture
>;

function createPredecessorCaptureFixture() {
  const filesystem = createFilesystemFixture();
  if (!filesystem.upload) {
    throw new Error("Predecessor capture fixture lacks upload evidence.");
  }
  const workerRelease = workerReleaseInput(filesystem.upload.sha256);
  const captureLiveTopology = liveTopologyEvidence(
    filesystem.upload.sha256,
    "2026-07-14T00:08:30.000Z",
  );
  const finalizationLiveTopology = liveTopologyEvidence(
    filesystem.upload.sha256,
    "2026-07-14T00:13:30.000Z",
  );
  const plan = createHistoricalPre0016SnapshotPlan(sourceFingerprint);
  const operationId = historicalFresh0016PredecessorOperationId({
    cutoverRunId,
    sourceFingerprint,
    ...workerRelease,
    captureLiveTopology,
    hmacKeyId: historicalDataHmacKeyId(hmacSecret),
    snapshotPlanSha256: plan.planSha256,
  });
  const usage: D1DailyUsage = Object.freeze({
    databaseCount: 1,
    queryGroups: 1,
    rowsRead: 100,
    rowsWritten: 0,
    executions: 1,
    windowMinutes: 10,
  });
  const maximumReservation = reserveD1ReleaseBudget({
    backupDir: filesystem.backupDirectory,
    operationId,
    operation: HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
    sourceFingerprint,
    candidateVersionId: targetCandidateVersionId,
    phase: "maximum",
    rowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    rowsWritten: 0,
    observedUsage: usage,
    now: new Date("2026-07-14T00:09:00.000Z"),
    expectedUtcDay: "2026-07-14",
  });
  const captureOptions = {
    cutoverRunId,
    backupDirectory: filesystem.backupDirectory,
    sourceFingerprint,
    ...workerRelease,
    captureLiveTopology,
    liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
    hmacSecret,
    usage,
    maximumReservation,
    authorizeLastPreD1: () => authorizationReceipt,
    persistPreparedCapture: () => undefined,
    observeFinalizationTopology: () => ({
      evidence: finalizationLiveTopology,
      statusOutput: baselineDeploymentStatusOutput,
    }),
    forbiddenPlaintext,
  };
  return Object.freeze({
    ...filesystem,
    workerRelease,
    captureLiveTopology,
    finalizationLiveTopology,
    operationId,
    usage,
    maximumReservation,
    captureOptions,
  });
}

function capturePreparedThenCrash(
  fixture: PredecessorCaptureFixture,
): HistoricalFresh0016PredecessorPreparedCapture {
  const persisted: {
    value?: HistoricalFresh0016PredecessorPreparedCapture;
  } = {};
  assert.throws(
    () =>
      captureHistoricalFresh0016PredecessorReport({
        ...fixture.captureOptions,
        clock: sequenceClock(predecessorClockValues),
        runner: predecessorFixtureRunner(),
        persistPreparedCapture: (prepared) => {
          persisted.value = structuredClone(prepared);
          throw new Error("simulated predecessor prepared-capture crash");
        },
      }),
    /simulated predecessor prepared-capture crash/,
  );
  if (!persisted.value) {
    throw new Error("Predecessor fixture did not persist its prepared capture.");
  }
  return persisted.value;
}

function exactReservationPhase(fixture: PredecessorCaptureFixture) {
  const ledger = readD1ReleaseBudgetLedger(
    fixture.maximumReservation.ledgerPath,
  );
  const reservation = ledger.reservations.find(
    (entry) => entry.operationId === fixture.operationId,
  );
  if (!reservation) {
    throw new Error("Predecessor fixture reservation is missing.");
  }
  return reservation.phase;
}

type PredecessorD1Entry = {
  success: true;
  results: Array<Record<string, unknown>>;
  meta: {
    rows_read: number;
    rows_written: 0;
    total_attempts: 1;
  };
};

function predecessorFixtureRunner(beforeReturn?: () => void): WranglerRunner {
  return (args) => {
    if (args.at(-1) !== HISTORICAL_PRE_0016_SNAPSHOT_SQL) {
      throw new Error("Unexpected D1 SQL in predecessor fixture.");
    }
    beforeReturn?.();
    return JSON.stringify(validPredecessorD1Entries());
  };
}

function validPredecessorD1Entries(): PredecessorD1Entry[] {
  const statements = predecessorSnapshotStatements();
  const schemaStart = HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT;
  const schemaObjectStart =
    schemaStart + HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT;
  const identityStart =
    schemaObjectStart + HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT;
  const rawIdentities: Readonly<
    Partial<
      Record<
        (typeof HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES)[number],
        readonly (string | number | null)[]
      >
    >
  > = {
    users: [privateUserId],
    accounts: ["private-provider", "private-account-id", privateUserId],
    sessions: [privateSessionToken, privateUserId],
    chats: ["private-chat-id", privateUserId],
    messages: ["private-message-id", "private-chat-id"],
    user_memories: ["private-memory-id", privateUserId],
    user_memory_graph_edges: [
      "private-memory-id",
      privateUserId,
      "private-turn-ids",
      "private-memory-ids",
      "private-chat-id",
      "private-message-id",
      "private-superseding-memory-id",
    ],
    game_results: privateGameResultValues,
  };
  return statements.map((statement, index) => {
    let results: Array<Record<string, unknown>>;
    if (index < schemaStart) {
      const dataset = /^SELECT '([a-z0-9_]+)' AS dataset,/i.exec(statement)?.[1];
      assert.ok(dataset);
      const protectedDataset =
        HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES[index];
      assert.equal(dataset, protectedDataset);
      results = [{
        dataset,
        row_count:
          protectedDataset && rawIdentities[protectedDataset] ? 1 : 0,
      }];
    } else if (index < schemaObjectStart) {
      const table = /^SELECT '([a-z0-9_]+)' AS table_name,/i.exec(statement)?.[1];
      assert.ok(table);
      results = table === "game_results"
        ? HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.map((column) => ({
            table_name: table,
            name: column.name,
            type: column.type,
            not_null: column.notNull,
            primary_key: column.primaryKey,
          }))
        : [{
            table_name: table,
            name: "id",
            type: "text",
            not_null: 1,
            primary_key: 1,
          }];
    } else if (index < identityStart) {
      results = historicalGameResultsSchemaObjectResultRows();
    } else {
      const identityIndex = index - identityStart;
      const dataset =
        HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES[identityIndex];
      assert.ok(dataset);
      const values = rawIdentities[dataset];
      if (!values) {
        results = [];
      } else {
        const keys = [
          ...statement.matchAll(/\bAS identity_([1-9]|1[0-4])\b/gi),
        ].map((match) => `identity_${match[1]}`);
        assert.equal(keys.length, values.length);
        results = [Object.fromEntries(
          keys.map((key, keyIndex) => [key, values[keyIndex]]),
        )];
      }
    }
    return {
      success: true,
      results,
      meta: {
        rows_read: results.length,
        rows_written: 0,
        total_attempts: 1,
      },
    };
  });
}

function predecessorSnapshotStatements() {
  const parts = HISTORICAL_PRE_0016_SNAPSHOT_SQL.split(";");
  assert.equal(parts.pop()?.trim(), "");
  return parts.map((statement) => statement.trim());
}

function sequenceClock(values: readonly string[]) {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (!value) throw new Error("Predecessor fixture clock exhausted.");
    return new Date(value);
  };
}

function buildReport(
  backupDirectory: string,
): HistoricalFresh0016PredecessorReport {
  const uploadEvidenceSha256 = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
  ).sha256;
  const captureLiveTopology = liveTopologyEvidence(
    uploadEvidenceSha256,
    "2026-07-14T00:09:00.000Z",
  );
  const finalizationLiveTopology = liveTopologyEvidence(
    uploadEvidenceSha256,
    "2026-07-14T00:12:00.000Z",
  );
  const capture = createCapture();
  const operationId = historicalFresh0016PredecessorOperationId({
    cutoverRunId,
    sourceFingerprint,
    ...workerReleaseInput(uploadEvidenceSha256),
    captureLiveTopology,
    hmacKeyId: capture.hmacKeyId,
    snapshotPlanSha256: capture.plan.planSha256,
  });
  const usage: D1DailyUsage = {
    databaseCount: 1,
    queryGroups: 7,
    rowsRead: 2_000,
    rowsWritten: 3,
    executions: 9,
    windowMinutes: 15,
  };
  const totals = { rowsRead: captureRowsRead + 66, rowsWritten: 4 };
  const ledger: D1ReleaseBudgetReservationResult = {
    ledgerPath: path.join(
      backupDirectory,
      "cloudflare",
      "d1-release-budget-ledger-2026-07-14.json",
    ),
    utcDay: "2026-07-14",
    revision: 2,
    idempotent: false,
    reservation: {
      operationId,
      operation: HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
      candidateVersionId: targetCandidateVersionId,
      phase: "exact",
      rowsRead: captureRowsRead,
      rowsWritten: 0,
      maximumRowsRead:
        HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      maximumRowsWritten: 0,
      createdAt: "2026-07-14T00:09:00.000Z",
      updatedAt: "2026-07-14T00:11:30.000Z",
    },
    totals,
    accountedUsage: {
      rowsRead: usage.rowsRead + totals.rowsRead,
      rowsWritten: usage.rowsWritten + totals.rowsWritten,
    },
  };
  return buildHistoricalFresh0016PredecessorReport({
    capture,
    cutoverRunId,
    backupDirectory,
    ...workerReleaseInput(uploadEvidenceSha256),
    captureLiveTopology,
    finalizationLiveTopology,
    captureStartedAt,
    captureCompletedAt,
    createdAt: reportCreatedAt,
    finalizedAt: reportFinalizedAt,
    usage,
    ledger,
    forbiddenPlaintext,
  });
}

function createCapture(): HistoricalPre0016SnapshotCapture {
  const datasets: Partial<
    Record<HistoricalDatasetName, HistoricalDatasetEvidence>
  > = {};
  const supplementalDatasets: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  > = {};
  for (const spec of HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS) {
    const rowCount = isRequiredNonemptyDataset(spec.name) ? 1 : 0;
    const columns = spec.name === "game_results"
      ? HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.map((column) => ({ ...column }))
      : [
          { name: "id", type: "text", notNull: 1 as const, primaryKey: 1 },
        ];
    const evidence: HistoricalDatasetEvidence = {
      rowCount,
      schemaTable: spec.table,
      schemaSha256: historicalDataSchemaHash(columns),
      columns,
      sentinels:
        rowCount === 0 ? [] : [sha256(`fresh-0016-sentinel:${spec.name}`)],
      ...(spec.name === "game_results"
        ? { schemaObjects: { ...HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS } }
        : {}),
    };
    if (isCoreDatasetName(spec.name)) {
      datasets[spec.name] = evidence;
    } else if (isSupplementalDatasetName(spec.name)) {
      supplementalDatasets[spec.name] = evidence;
    } else {
      throw new Error(`Unknown predecessor fixture dataset ${spec.name}.`);
    }
  }
  assertCompleteDatasets(datasets);
  assertCompleteSupplementalDatasets(supplementalDatasets);
  return Object.freeze({
    plan: createHistoricalPre0016SnapshotPlan(sourceFingerprint),
    rowsRead: captureRowsRead,
    rowsWritten: 0,
    hmacKeyId: historicalDataHmacKeyId(hmacSecret),
    datasets,
    supplementalDatasets,
  });
}

function workerReleaseInput(uploadEvidenceSha256: string) {
  return Object.freeze({
    phase: "uploaded-inactive" as const,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
  });
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

function liveTopologyEvidence(
  uploadEvidenceSha256: string,
  observedAt: string,
) {
  return createHistoricalFresh0016LiveTopologyEvidence({
    observedAt: new Date(observedAt),
    statusOutput: baselineDeploymentStatusOutput,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
  });
}

function writeUploadEvidence(backupDirectory: string) {
  const releaseMessageSha256 = workerReleaseMessageSha256(
    "fresh-0016 predecessor fixture",
  );
  const evidence = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-13T23:51:00.000Z",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    expectedReleaseTag: "fresh-0016-predecessor-fixture",
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
      timestamp: "2026-07-13T23:50:00.000Z",
    },
    versionView: {
      versionId: targetCandidateVersionId,
      createdAt: "2026-07-13T23:49:00.000Z",
      source: "fixture",
      releaseTag: "fresh-0016-predecessor-fixture",
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

function createFilesystemFixture(createRunDirectory = true) {
  const rawBackupDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-0016-predecessor-"),
  );
  const backupDirectory = fs.realpathSync.native(rawBackupDirectory);
  fs.chmodSync(backupDirectory, 0o700);
  const paths = historicalFresh0016PredecessorPaths(
    backupDirectory,
    cutoverRunId,
  );
  const cloudflareDirectory = path.join(backupDirectory, "cloudflare");
  fs.mkdirSync(cloudflareDirectory, { mode: 0o700 });
  fs.chmodSync(cloudflareDirectory, 0o700);
  if (createRunDirectory) {
    fs.mkdirSync(paths.runDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(paths.runDirectory), 0o700);
    fs.chmodSync(paths.runDirectory, 0o700);
  }
  const upload = writeUploadEvidence(backupDirectory);
  return Object.freeze({
    backupDirectory,
    paths,
    upload,
    cleanup: () => fs.rmSync(backupDirectory, { recursive: true, force: true }),
  });
}

function isRequiredNonemptyDataset(name: string) {
  return (
    name === "users" ||
    name === "accounts" ||
    name === "chats" ||
    name === "messages" ||
    name === "user_memories" ||
    name === "user_memory_graph_edges"
  );
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

function assertCompleteDatasets(
  value: Partial<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
): asserts value is Record<HistoricalDatasetName, HistoricalDatasetEvidence> {
  for (const name of HISTORICAL_DATASET_NAMES) {
    if (!value[name]) throw new Error(`Fixture omitted ${name}.`);
  }
}

function assertCompleteSupplementalDatasets(
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

function nestedRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  assertRecord(nested);
  return nested;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a fixture object.");
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
