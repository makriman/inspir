import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
  D1_RELEASE_BUDGET_LEDGER_KIND,
  reserveD1ReleaseBudget,
  readD1ReleaseBudgetLedger,
  type D1ReleaseBudgetAdmissionMode,
  type D1ReleaseBudgetReservationResult,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import type { D1DailyUsage } from "../scripts/cloudflare/d1-free-budget";
import {
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
  type HistoricalFresh0016MigrationBinding,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
  buildHistoricalFresh0016PredecessorReport,
  historicalFresh0016PredecessorOperationId,
  type HistoricalFresh0016PredecessorReport,
} from "../scripts/cloudflare/historical-data-fresh-0016-predecessor";
import {
  HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME,
  HISTORICAL_FRESH_0016_SUCCESSOR_MAXIMUM_BYTES,
  HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
  captureHistoricalFresh0016SuccessorReport,
  finalizeHistoricalFresh0016SuccessorPreparedCapture,
  historicalFresh0016SuccessorOperationId,
  historicalFresh0016SuccessorPaths,
  historicalFresh0016SuccessorPredecessorReportSha256,
  historicalFresh0016SuccessorPreparedCaptureSha256,
  historicalFresh0016SuccessorProductionExclusionOwnerSha256,
  historicalFresh0016SuccessorRuntimeVerificationReportSha256,
  parseHistoricalFresh0016SuccessorPreparedCapture,
  parseHistoricalFresh0016SuccessorReport,
  readHistoricalFresh0016SuccessorReport,
  writeHistoricalFresh0016SuccessorReport,
  type HistoricalFresh0016SuccessorPreparedCapture,
} from "../scripts/cloudflare/historical-data-fresh-0016-successor";
import {
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  createHistoricalPre0016SnapshotPlan,
  type HistoricalPre0016SnapshotCapture,
} from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import { historicalDataHmacKeyId } from "../scripts/cloudflare/historical-data-hmac-key";
import { stableStringify, type WranglerRunner } from "../scripts/cloudflare/migration-config";
import type { ProductionValidationLockOwner } from "../scripts/cloudflare/production-validation-lock";
import {
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS,
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND,
  historicalFresh0016RuntimeVerificationReportSchema,
  type HistoricalFresh0016RuntimeVerificationReport,
} from "../scripts/cloudflare/verify-historical-data-fresh-0016-migration";
import {
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
  HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
  HISTORICAL_DATA_SNAPSHOT_SQL,
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS,
  HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS,
  HISTORICAL_OPERATIONAL_DATASET_NAMES,
  HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  captureHistoricalDataV2SnapshotEvidence,
  historicalDataSchemaHash,
  historicalGameResultsSchemaObjectResultRows,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalOperationalDatasetName,
  type HistoricalSupplementalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const cutoverRunId = "11111111-1111-4111-8111-111111111111";
const targetCandidateVersionId = "22222222-2222-4222-8222-222222222222";
const serviceBaselineVersionId = "66666666-6666-4666-8666-666666666666";
const baselineDeploymentStatusOutput = JSON.stringify({
  id: "77777777-7777-4777-8777-777777777777",
  versions: [{ version_id: serviceBaselineVersionId, percentage: 100 }],
});
const runtimeVerificationStageSha256 = "9".repeat(64);
const authorizationReceipt = Object.freeze({
  authorizationStageSha256: "c".repeat(64),
});
const hmacSecret = "fresh-0016-successor-hmac-secret-0123456789abcdef";
const privateUserId = "historical-user-id";
const privateSessionToken = "private-session-token";
const privateGameResultId = "private-game-result";
const privateGameResultPayload = '{"moves":[]}';
const privateGameResultIdentity = Object.freeze({
  identity_1: privateGameResultId,
  identity_2: 1,
  identity_3: "chess",
  identity_4: "engine",
  identity_5: "1",
  identity_6: "checkmate",
  identity_7: "human",
  identity_8: "win",
  identity_9: 42,
  identity_10: privateGameResultPayload,
  identity_11: 1,
  identity_12: 2,
  identity_13: 1,
  identity_14: 2,
});
const forbiddenPlaintext = Object.freeze([
  privateUserId,
  privateSessionToken,
  privateGameResultId,
  privateGameResultPayload,
  hmacSecret,
]);
const sourceFingerprint = Object.freeze({
  sha256: "a".repeat(64),
  fileCount: 321,
});
const accountingParentOperationId =
  `historical-fresh-0016-day2-budget:${"f".repeat(64)}` as const;
const usage: D1DailyUsage = Object.freeze({
  databaseCount: 1,
  queryGroups: 10,
  rowsRead: 100,
  rowsWritten: 2,
  executions: 10,
  windowMinutes: 10,
});
const successorClockValues = [
  "2026-07-15T00:10:00.000Z",
  "2026-07-15T00:11:00.000Z",
  "2026-07-15T00:12:00.000Z",
  "2026-07-15T00:13:00.000Z",
  "2026-07-15T00:14:00.000Z",
] as const;

test("low-level V2 evidence runs the canonical 64-result plan only after one synchronous authorization", () => {
  const events: string[] = [];
  const runner = fixtureRunner(databaseFixture(), [], undefined, () => {
    events.push("runner");
    assert.deepEqual(events, ["authorize", "runner"]);
  });
  const evidence = captureHistoricalDataV2SnapshotEvidence({
    hmacSecret,
    authorizeLastPreD1: () => {
      events.push("authorize");
    },
    runner,
  });
  assert.deepEqual(events, ["authorize", "runner"]);
  assert.equal(evidence.resultSetCount, 64);
  assert.equal(evidence.resultSetCount, HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT);
  assert.equal(evidence.automaticAttemptsPerResultSet, 1);
  assert.equal(evidence.rowsWritten, 0);
  assert.equal(evidence.snapshotPlanSha256, HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256);
  assert.equal(evidence.hmacKeyId, historicalDataHmacKeyId(hmacSecret));
  assert.equal(Object.keys(evidence.datasets).length, 10);
  assert.equal(Object.keys(evidence.supplementalDatasets).length, 11);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.datasets.users), true);
  assert.equal(Object.isFrozen(evidence.datasets.users.columns), true);
  const serialized = stableStringify(evidence);
  for (const forbidden of forbiddenPlaintext) {
    assert.equal(serialized.includes(forbidden), false);
  }

  let runnerCalls = 0;
  assert.throws(
    () =>
      captureHistoricalDataV2SnapshotEvidence({
        hmacSecret,
        authorizeLastPreD1: () => {
          throw new Error("authorization refused");
        },
        runner: () => {
          runnerCalls += 1;
          return "[]";
        },
      }),
    /authorization refused/,
  );
  assert.equal(runnerCalls, 0);
});

test("fresh-0016 successor captures, exact-refines, and binds all protected data plus an empty outbox", () => {
  const fixture = createSuccessorFixture();
  const calls: WranglerCall[] = [];
  const events: string[] = [];
  let persistedPreparedCapture:
    | HistoricalFresh0016SuccessorPreparedCapture
    | undefined;
  try {
    const report = captureHistoricalFresh0016SuccessorReport({
      ...fixture.captureOptions,
      clock: sequenceClock(successorClockValues),
      authorizeLastPreD1: (context) => {
        events.push("authorize");
        assert.equal(Object.isFrozen(context), true);
        assert.equal(context.cutoverRunId, cutoverRunId);
        assert.equal(context.operationId, fixture.operationId);
        assert.equal(context.maximumRowsRead, 2_250_000);
        assert.equal(context.maximumRowsWritten, 0);
        assert.equal(
          context.productionExclusionOwnerSha256,
          fixture.productionExclusionOwnerSha256,
        );
        return authorizationReceipt;
      },
      runner: fixtureRunner(databaseFixture(), calls, undefined, () => {
        events.push("runner");
        assert.deepEqual(events, ["authorize", "runner"]);
      }),
      persistPreparedCapture: (prepared) => {
        events.push("persist");
        assert.deepEqual(events, ["authorize", "runner", "persist"]);
        assert.equal(Object.isFrozen(prepared), true);
        assert.equal(Object.isFrozen(prepared.capture.datasets.users), true);
        assert.equal(prepared.operationId, fixture.operationId);
        assert.equal(
          prepared.authorization.maximumReservationRevision,
          fixture.maximumReservation.revision,
        );
        assert.equal(
          prepared.authorization.authorizationStageSha256,
          authorizationReceipt.authorizationStageSha256,
        );
        assert.equal(
          prepared.captureSha256,
          sha256(stableStringify(prepared.capture)),
        );
        assert.equal(prepared.rowsRead, prepared.capture.rowsRead);
        assert.equal(prepared.rowsWritten, 0);
        assert.equal(prepared.resultSetCount, 64);
        assert.equal(prepared.automaticAttemptsPerResultSet, 1);
        const ledger = readD1ReleaseBudgetLedger(
          fixture.maximumReservation.ledgerPath,
        );
        const reservation = ledger.reservations.find(
          (entry) => entry.operationId === fixture.operationId,
        );
        assert.equal(reservation?.phase, "maximum");
        persistedPreparedCapture = prepared;
      },
    });
    assert.deepEqual(events, ["authorize", "runner", "persist"]);
    assert.ok(persistedPreparedCapture);
    assert.deepEqual(
      parseHistoricalFresh0016SuccessorPreparedCapture(
        structuredClone(persistedPreparedCapture),
        { forbiddenPlaintext },
      ),
      persistedPreparedCapture,
    );
    assert.equal(
      historicalFresh0016SuccessorPreparedCaptureSha256(
        persistedPreparedCapture,
        { forbiddenPlaintext },
      ),
      historicalFresh0016SuccessorPreparedCaptureSha256(
        structuredClone(persistedPreparedCapture),
        { forbiddenPlaintext },
      ),
    );
    const preparedSerialized = stableStringify(persistedPreparedCapture);
    for (const forbidden of forbiddenPlaintext) {
      assert.equal(preparedSerialized.includes(forbidden), false);
    }
    assert.doesNotMatch(
      preparedSerialized,
      /"(?:hmacSecret|identityHashes|resultSets)"/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.args.at(-1), HISTORICAL_DATA_SNAPSHOT_SQL);
    assert.equal(report.snapshotExecution.resultSetCount, 64);
    assert.equal(report.snapshotExecution.countResultSetCount, 22);
    assert.equal(report.snapshotExecution.schemaResultSetCount, 20);
    assert.equal(report.snapshotExecution.schemaObjectResultSetCount, 1);
    assert.equal(report.snapshotExecution.identityResultSetCount, 21);
    assert.equal(report.snapshotExecution.automaticAttemptsPerResultSet, 1);
    assert.equal(report.hmacKeyId, fixture.predecessor.hmacKeyId);
    assert.deepEqual(report.sourceFingerprint, sourceFingerprint);
    assert.equal(
      report.workerRelease.targetCandidateVersionId,
      targetCandidateVersionId,
    );
    assert.equal(report.predecessor.reportSha256, fixture.predecessorReportSha256);
    assert.equal(
      report.migrationRuntimeVerification.stageSha256,
      runtimeVerificationStageSha256,
    );
    assert.equal(
      report.migrationRuntimeVerification.reportSha256,
      fixture.runtimeVerificationReportSha256,
    );
    assert.equal(
      report.productionExclusion.ownerSha256,
      fixture.productionExclusionOwnerSha256,
    );
    assert.equal(report.ledger.maximum.reservation.phase, "maximum");
    assert.equal(
      report.ledger.maximum.reservation.rowsRead,
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    );
    assert.equal(report.ledger.exact.reservation.phase, "exact");
    assert.equal(report.ledger.exact.reservation.rowsRead, report.rowsRead);
    assert.equal(report.ledger.exact.reservation.rowsWritten, 0);
    assert.equal(
      report.ledger.exact.reservation.maximumRowsRead,
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    );
    assert.equal(report.ledger.exact.idempotent, false);
    assert.ok(report.ledger.exact.revision > report.ledger.maximum.revision);
    assert.equal(Object.keys(report.datasets).length, 10);
    assert.equal(Object.keys(report.supplementalDatasets).length, 11);
    assert.equal(
      report.operationalDatasets.memory_vector_cleanup_outbox.rowCount,
      0,
    );
    assert.ok(
      report.operationalDatasets.memory_vector_cleanup_outbox.columns.some(
        (column) => column.name === "write_token",
      ),
    );
    assert.equal(report.createdAt, "2026-07-15T00:13:00.000Z");
    assert.equal(
      report.predecessorToSuccessorGapMs,
      Date.parse(report.createdAt) - Date.parse(fixture.predecessor.createdAt),
    );
    assert.ok(
      report.predecessorToSuccessorGapMs <=
        HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor
          .maximumPredecessorToSuccessorGapMs,
    );
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.operationalDatasets), true);
    const serialized = `${stableStringify(report)}\n`;
    for (const forbidden of forbiddenPlaintext) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.doesNotMatch(serialized, /"(?:hmacSecret|resultSets)"/);
    assert.ok(
      Buffer.byteLength(serialized, "utf8") <
        HISTORICAL_FRESH_0016_SUCCESSOR_MAXIMUM_BYTES,
    );

    const ledger = readD1ReleaseBudgetLedger(
      report.ledger.exact.ledgerPath,
    );
    assert.equal(ledger.kind, D1_RELEASE_BUDGET_LEDGER_KIND);
    const reservation = ledger.reservations.find(
      (entry) => entry.operationId === report.operationId,
    );
    assert.equal(reservation?.phase, "exact");
    assert.equal(reservation?.rowsRead, report.rowsRead);
  } finally {
    fixture.cleanup();
  }
});

test("paid-expedited successor capture accepts an exact ledger above Workers Free limits", () => {
  const fixture = createSuccessorFixture({
    admissionMode: D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
    usage: {
      ...usage,
      rowsRead: 4_000_001,
    },
  });
  try {
    const report = successfulCapture(fixture);
    assert.ok(report.ledger.maximum.accountedUsage.rowsRead > 4_000_000);
    assert.ok(report.ledger.exact.accountedUsage.rowsRead > 4_000_000);
    const ledger = readD1ReleaseBudgetLedger(report.ledger.exact.ledgerPath);
    assert.equal(
      ledger.admissionMode,
      D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
    );
  } finally {
    fixture.cleanup();
  }
});

test("persisted prepared capture survives a crash and finalizes repeatedly with no second D1", () => {
  const fixture = createSuccessorFixture();
  let preparedCapture:
    | HistoricalFresh0016SuccessorPreparedCapture
    | undefined;
  let runnerCalls = 0;
  try {
    assert.throws(
      () =>
        captureHistoricalFresh0016SuccessorReport({
          ...fixture.captureOptions,
          clock: sequenceClock(successorClockValues),
          authorizeLastPreD1: () => authorizationReceipt,
          runner: fixtureRunner(
            databaseFixture(),
            [],
            undefined,
            () => {
              runnerCalls += 1;
            },
          ),
          persistPreparedCapture: (prepared) => {
            preparedCapture = structuredClone(prepared);
            throw new Error("simulated process crash after prepared persistence");
          },
        }),
      /simulated process crash/,
    );
    assert.equal(runnerCalls, 1);
    assert.ok(preparedCapture);
    assert.equal(
      exactReservationPhase(fixture),
      "maximum",
    );

    const recovered = finalizeHistoricalFresh0016SuccessorPreparedCapture({
      preparedCapture: structuredClone(preparedCapture),
      sourceFingerprint,
      ...finalizationIdentity(fixture),
      productionExclusionOwner: fixture.productionExclusionOwner,
      forbiddenPlaintext,
      clock: sequenceClock([successorClockValues[4]]),
    });
    assert.equal(runnerCalls, 1);
    assert.equal(exactReservationPhase(fixture), "exact");

    const replayed = finalizeHistoricalFresh0016SuccessorPreparedCapture({
      preparedCapture: structuredClone(preparedCapture),
      sourceFingerprint,
      ...finalizationIdentity(fixture),
      productionExclusionOwner: fixture.productionExclusionOwner,
      forbiddenPlaintext,
      clock: sequenceClock([successorClockValues[4]]),
    });
    assert.deepEqual(replayed, recovered);
    assert.equal(runnerCalls, 1);
    assert.equal(recovered.ledger.exact.idempotent, false);
    assert.equal(
      recovered.exactReservedAt,
      preparedCapture.plannedExactReservedAt,
    );
    assert.equal(
      recovered.createdAt,
      preparedCapture.plannedReportCreatedAt,
    );
  } finally {
    fixture.cleanup();
  }
});

test("prepared-capture finalizer rejects tamper, source, UTC day, owner, ledger, and privacy drift before refinement", async (t) => {
  await t.test("tamper", () => {
    const fixture = createSuccessorFixture();
    try {
      const prepared = capturePreparedThenCrash(fixture);
      const tampered = structuredClone(prepared);
      tampered.capture.hmacKeyId = "0".repeat(64);
      assert.throws(() =>
        finalizeHistoricalFresh0016SuccessorPreparedCapture({
          preparedCapture: tampered,
          sourceFingerprint,
          ...finalizationIdentity(fixture),
          productionExclusionOwner: fixture.productionExclusionOwner,
          forbiddenPlaintext,
          clock: sequenceClock([successorClockValues[4]]),
        }),
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("source", () => {
    const fixture = createSuccessorFixture();
    try {
      const prepared = capturePreparedThenCrash(fixture);
      assert.throws(
        () =>
          finalizeHistoricalFresh0016SuccessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint: { ...sourceFingerprint, sha256: "b".repeat(64) },
            ...finalizationIdentity(fixture),
            productionExclusionOwner: fixture.productionExclusionOwner,
            forbiddenPlaintext,
            clock: sequenceClock([successorClockValues[4]]),
          }),
        /exact inactive upload evidence/,
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("UTC day", () => {
    const fixture = createSuccessorFixture();
    try {
      const prepared = capturePreparedThenCrash(fixture);
      assert.throws(
        () =>
          finalizeHistoricalFresh0016SuccessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint,
            ...finalizationIdentity(fixture),
            finalizationLiveTopology: liveTopologyEvidence(
              fixture.workerRelease.uploadEvidenceSha256,
              "2026-07-15T23:59:30.000Z",
            ),
            productionExclusionOwner: fixture.productionExclusionOwner,
            forbiddenPlaintext,
            clock: sequenceClock(["2026-07-16T00:00:00.000Z"]),
          }),
        /UTC billing-day boundary/,
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("owner", () => {
    const fixture = createSuccessorFixture();
    try {
      const prepared = capturePreparedThenCrash(fixture);
      assert.throws(
        () =>
          finalizeHistoricalFresh0016SuccessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint,
            ...finalizationIdentity(fixture),
            productionExclusionOwner: {
              ...fixture.productionExclusionOwner,
              leaseId: "55555555-5555-4555-8555-555555555555",
            },
            forbiddenPlaintext,
            clock: sequenceClock([successorClockValues[4]]),
          }),
        /exact production-exclusion owner/,
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("expired owner", () => {
    const fixture = createSuccessorFixture();
    try {
      const prepared = capturePreparedThenCrash(fixture);
      assert.throws(
        () =>
          finalizeHistoricalFresh0016SuccessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint,
            ...finalizationIdentity(fixture),
            finalizationLiveTopology: liveTopologyEvidence(
              fixture.workerRelease.uploadEvidenceSha256,
              "2026-07-15T03:59:30.000Z",
            ),
            productionExclusionOwner: fixture.productionExclusionOwner,
            forbiddenPlaintext,
            clock: sequenceClock(["2026-07-15T04:00:00.000Z"]),
          }),
        /production exclusion expired/,
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("ledger", () => {
    const fixture = createSuccessorFixture();
    try {
      const prepared = structuredClone(capturePreparedThenCrash(fixture));
      prepared.maximumReservation.revision += 1;
      prepared.authorization.maximumReservationRevision += 1;
      assert.throws(
        () =>
          finalizeHistoricalFresh0016SuccessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint,
            ...finalizationIdentity(fixture),
            productionExclusionOwner: fixture.productionExclusionOwner,
            forbiddenPlaintext,
            clock: sequenceClock([successorClockValues[4]]),
          }),
        /neither its exact live maximum nor exact ledger reservation/,
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("privacy", () => {
    const fixture = createSuccessorFixture();
    try {
      const prepared: unknown = structuredClone(
        capturePreparedThenCrash(fixture),
      );
      assertRecord(prepared);
      nestedRecord(
        nestedRecord(nestedRecord(prepared, "capture"), "datasets"),
        "users",
      ).schemaTable = privateUserId;
      assert.throws(
        () =>
          finalizeHistoricalFresh0016SuccessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint,
            ...finalizationIdentity(fixture),
            productionExclusionOwner: fixture.productionExclusionOwner,
            forbiddenPlaintext,
            clock: sequenceClock([successorClockValues[4]]),
          }),
        /forbidden raw identity or secret plaintext/,
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });
});

test("successor finalization rejects stale, staged, or active candidate topology before exact refinement", async (t) => {
  const cases = [
    {
      name: "stale",
      evidenceAt: "2026-07-15T00:08:00.000Z",
      statusOutput: baselineDeploymentStatusOutput,
    },
    {
      name: "staged-zero-traffic",
      evidenceAt: "2026-07-15T00:13:30.000Z",
      statusOutput: JSON.stringify({
        id: "88888888-8888-4888-8888-888888888888",
        versions: [
          { version_id: serviceBaselineVersionId, percentage: 100 },
          { version_id: targetCandidateVersionId, percentage: 0 },
        ],
      }),
    },
    {
      name: "active-candidate",
      evidenceAt: "2026-07-15T00:13:30.000Z",
      statusOutput: JSON.stringify({
        id: "99999999-9999-4999-8999-999999999999",
        versions: [
          { version_id: targetCandidateVersionId, percentage: 100 },
        ],
      }),
    },
  ] as const;
  for (const topologyCase of cases) {
    await t.test(topologyCase.name, () => {
      const fixture = createSuccessorFixture();
      try {
        const prepared = capturePreparedThenCrash(fixture);
        assert.throws(() =>
          finalizeHistoricalFresh0016SuccessorPreparedCapture({
            preparedCapture: prepared,
            sourceFingerprint,
            ...fixture.workerRelease,
            finalizationLiveTopology: liveTopologyEvidence(
              fixture.workerRelease.uploadEvidenceSha256,
              topologyCase.evidenceAt,
            ),
            liveDeploymentStatusOutput: topologyCase.statusOutput,
            productionExclusionOwner: fixture.productionExclusionOwner,
            forbiddenPlaintext,
            clock: sequenceClock([successorClockValues[4]]),
          }),
        );
        assert.equal(exactReservationPhase(fixture), "maximum");
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("prepared-capture callback omission, throw, or async return fails closed without exact refinement", async (t) => {
  await t.test("omission", () => {
    const fixture = createSuccessorFixture();
    let runnerCalls = 0;
    try {
      const options = {
        ...fixture.captureOptions,
        clock: sequenceClock(successorClockValues),
        authorizeLastPreD1: () => authorizationReceipt,
        runner: () => {
          runnerCalls += 1;
          return "[]";
        },
      };
      Reflect.deleteProperty(options, "persistPreparedCapture");
      assert.throws(
        () => captureHistoricalFresh0016SuccessorReport(options),
        /requires a synchronous prepared-capture persistence callback/,
      );
      assert.equal(runnerCalls, 0);
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("throw", () => {
    const fixture = createSuccessorFixture();
    let runnerCalls = 0;
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016SuccessorReport({
            ...fixture.captureOptions,
            clock: sequenceClock(successorClockValues),
            authorizeLastPreD1: () => authorizationReceipt,
            runner: fixtureRunner(
              databaseFixture(),
              [],
              undefined,
              () => {
                runnerCalls += 1;
              },
            ),
            persistPreparedCapture: () => {
              throw new Error("prepared persistence failed");
            },
          }),
        /prepared persistence failed/,
      );
      assert.equal(runnerCalls, 1);
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("async return", () => {
    const fixture = createSuccessorFixture();
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016SuccessorReport({
            ...fixture.captureOptions,
            clock: sequenceClock(successorClockValues),
            authorizeLastPreD1: () => authorizationReceipt,
            runner: fixtureRunner(databaseFixture()),
            persistPreparedCapture: () => Promise.resolve(),
          }),
        /must complete synchronously without a return value/,
      );
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });
});

test("fresh-0016 successor fails before D1 for drifted evidence, reservation, HMAC, owner, or async authorization", async (t) => {
  await t.test("different HMAC", () => {
    const fixture = createSuccessorFixture();
    let runnerCalls = 0;
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016SuccessorReport({
            ...fixture.captureOptions,
            hmacSecret: "different-successor-hmac-secret-0123456789abcdef",
            clock: sequenceClock(successorClockValues),
            authorizeLastPreD1: () => authorizationReceipt,
            runner: () => {
              runnerCalls += 1;
              return "[]";
            },
          }),
        /same fresh predecessor HMAC key/,
      );
      assert.equal(runnerCalls, 0);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("different active owner", () => {
    const fixture = createSuccessorFixture();
    let runnerCalls = 0;
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016SuccessorReport({
            ...fixture.captureOptions,
            productionExclusionOwner: {
              ...fixture.productionExclusionOwner,
              candidateVersionId:
                "33333333-3333-4333-8333-333333333333",
            },
            clock: sequenceClock(successorClockValues),
            authorizeLastPreD1: () => authorizationReceipt,
            runner: () => {
              runnerCalls += 1;
              return "[]";
            },
          }),
        /same uploaded-inactive candidate and serving baseline/,
      );
      assert.equal(runnerCalls, 0);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("tampered maximum reservation", () => {
    const fixture = createSuccessorFixture();
    let runnerCalls = 0;
    const maximumReservation: D1ReleaseBudgetReservationResult = {
      ...fixture.maximumReservation,
      reservation: {
        ...fixture.maximumReservation.reservation,
        operationId: `historical-fresh-0016-successor:${"0".repeat(64)}`,
      },
    };
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016SuccessorReport({
            ...fixture.captureOptions,
            maximumReservation,
            clock: sequenceClock(successorClockValues),
            authorizeLastPreD1: () => authorizationReceipt,
            runner: () => {
              runnerCalls += 1;
              return "[]";
            },
          }),
        /maximum ledger evidence/,
      );
      assert.equal(runnerCalls, 0);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("runtime source drift", () => {
    const fixture = createSuccessorFixture();
    const runtimeVerification: unknown = structuredClone(
      fixture.runtimeVerification,
    );
    assertRecord(runtimeVerification);
    nestedRecord(runtimeVerification, "sourceFingerprint").sha256 = "b".repeat(64);
    let runnerCalls = 0;
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016SuccessorReport({
            ...fixture.captureOptions,
            runtimeVerification,
            clock: sequenceClock(successorClockValues),
            authorizeLastPreD1: () => authorizationReceipt,
            runner: () => {
              runnerCalls += 1;
              return "[]";
            },
          }),
      );
      assert.equal(runnerCalls, 0);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("non-strict authorization receipt", () => {
    const fixture = createSuccessorFixture();
    const nonStrictReceipt = {
      ...authorizationReceipt,
      unexpected: true,
    };
    let runnerCalls = 0;
    try {
      assert.throws(() =>
        captureHistoricalFresh0016SuccessorReport({
          ...fixture.captureOptions,
          clock: sequenceClock(successorClockValues),
          authorizeLastPreD1: () => nonStrictReceipt,
          runner: () => {
            runnerCalls += 1;
            return "[]";
          },
        }),
      );
      assert.equal(runnerCalls, 0);
      assert.equal(exactReservationPhase(fixture), "maximum");
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("async authorization", () => {
    const fixture = createSuccessorFixture();
    const thenableReceipt = {
      ...authorizationReceipt,
      then: () => undefined,
    };
    let runnerCalls = 0;
    try {
      assert.throws(
        () =>
          captureHistoricalFresh0016SuccessorReport({
            ...fixture.captureOptions,
            clock: sequenceClock(successorClockValues),
            authorizeLastPreD1: () => thenableReceipt,
            runner: () => {
              runnerCalls += 1;
              return "[]";
            },
          }),
        /Promise or thenable/,
      );
      assert.equal(runnerCalls, 0);
    } finally {
      fixture.cleanup();
    }
  });
});

test("failed or retried successor snapshots leave the maximum reservation unresolved and publish no report", async (t) => {
  const cases: Array<{
    name: string;
    mutateFixture?: (fixture: DatabaseFixture) => void;
    mutateSets?: (sets: FixtureResultSet[]) => void;
    pattern: RegExp;
  }> = [
    {
      name: "automatic retry",
      mutateSets: (sets) => {
        const first = sets[0];
        if (!first) throw new Error("Missing result set fixture.");
        first.totalAttempts = 2;
      },
      pattern: /used 2 automatic attempts/,
    },
    {
      name: "reported write",
      mutateSets: (sets) => {
        const first = sets[0];
        if (!first) throw new Error("Missing result set fixture.");
        first.rowsWritten = 1;
      },
      pattern: /unexpectedly wrote rows/,
    },
    {
      name: "nonempty cleanup outbox",
      mutateFixture: (fixture) => {
        fixture.counts.memory_vector_cleanup_outbox = 1;
      },
      pattern: /empty cleanup outbox/,
    },
    {
      name: "missing result set",
      mutateSets: (sets) => {
        sets.pop();
      },
      pattern: /unexpected result-set count/,
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const fixture = createSuccessorFixture();
      const database = databaseFixture();
      entry.mutateFixture?.(database);
      try {
        assert.throws(
          () =>
            captureHistoricalFresh0016SuccessorReport({
              ...fixture.captureOptions,
              clock: sequenceClock(successorClockValues),
              authorizeLastPreD1: () => authorizationReceipt,
              runner: fixtureRunner(database, [], entry.mutateSets),
            }),
          entry.pattern,
        );
        const ledger = readD1ReleaseBudgetLedger(
          fixture.maximumReservation.ledgerPath,
        );
        const reservation = ledger.reservations.find(
          (candidate) => candidate.operationId === fixture.operationId,
        );
        assert.equal(reservation?.phase, "maximum");
        assert.equal(
          reservation?.rowsRead,
          HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
        );
        assert.equal(fs.existsSync(fixture.paths.reportPath), false);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("fresh-0016 successor parser rejects binding, gap, ledger, and outbox tampering", () => {
  const fixture = createSuccessorFixture();
  try {
    const report = successfulCapture(fixture);
    const tamperers: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value.operationId = `historical-fresh-0016-successor:${"0".repeat(64)}`;
      },
      (value) => {
        nestedRecord(value, "predecessor").hmacKeyId = "0".repeat(64);
      },
      (value) => {
        nestedRecord(
          value,
          "migrationRuntimeVerification",
        ).stageSha256 = "0".repeat(64);
      },
      (value) => {
        nestedRecord(value, "productionExclusion").ownerSha256 = "0".repeat(64);
      },
      (value) => {
        value.predecessorToSuccessorGapMs = 1;
      },
      (value) => {
        nestedRecord(
          nestedRecord(nestedRecord(value, "ledger"), "exact"),
          "reservation",
        ).rowsRead = report.rowsRead - 1;
      },
      (value) => {
        nestedRecord(
          nestedRecord(value, "operationalDatasets"),
          "memory_vector_cleanup_outbox",
        ).rowCount = 1;
      },
      (value) => {
        value.captureStartedAt = "2026-07-15T00:08:00.000Z";
      },
    ];
    for (const tamper of tamperers) {
      const value: unknown = structuredClone(report);
      assertRecord(value);
      tamper(value);
      assert.throws(() =>
        parseHistoricalFresh0016SuccessorReport(value, {
          forbiddenPlaintext,
        }),
      );
    }

    const rawIdentity: unknown = structuredClone(report);
    assertRecord(rawIdentity);
    nestedRecord(
      nestedRecord(rawIdentity, "datasets"),
      "users",
    ).schemaTable = privateUserId;
    assert.throws(
      () =>
        parseHistoricalFresh0016SuccessorReport(rawIdentity, {
          forbiddenPlaintext,
        }),
      /forbidden raw identity or secret plaintext/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 successor artifact is canonical owner-only immutable evidence created exactly once", () => {
  const fixture = createSuccessorFixture();
  try {
    const report = successfulCapture(fixture);
    const artifact = writeHistoricalFresh0016SuccessorReport(report, {
      forbiddenPlaintext,
    });
    const bytes = fs.readFileSync(artifact.path);
    const stat = fs.lstatSync(artifact.path);
    assert.equal(path.basename(artifact.path), HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME);
    assert.equal(artifact.path, fixture.paths.reportPath);
    assert.equal(artifact.bytes, bytes.byteLength);
    assert.equal(artifact.sha256, sha256(bytes));
    assert.equal(bytes.toString("utf8"), `${stableStringify(report)}\n`);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(stat.nlink, 1);
    assert.deepEqual(
      readHistoricalFresh0016SuccessorReport({
        backupDirectory: fixture.backupDirectory,
        cutoverRunId,
        forbiddenPlaintext,
      }),
      artifact,
    );
    assert.throws(
      () =>
        writeHistoricalFresh0016SuccessorReport(report, {
          forbiddenPlaintext,
        }),
      /created once at its absent reserved path/,
    );

    const alias = path.join(fixture.paths.runDirectory, "successor-alias.json");
    fs.linkSync(artifact.path, alias);
    assert.throws(
      () =>
        readHistoricalFresh0016SuccessorReport({
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

test("fresh-0016 successor artifact rejects symlinks, broad directories, and noncanonical bytes", async (t) => {
  await t.test("symlink", () => {
    const fixture = createSuccessorFixture();
    try {
      const report = successfulCapture(fixture);
      const victim = path.join(fixture.paths.runDirectory, "victim.json");
      fs.writeFileSync(victim, "{}\n", { mode: 0o600 });
      fs.symlinkSync(victim, fixture.paths.reportPath);
      assert.throws(
        () => writeHistoricalFresh0016SuccessorReport(report),
        /created once at its absent reserved path/,
      );
      assert.throws(
        () =>
          readHistoricalFresh0016SuccessorReport({
            backupDirectory: fixture.backupDirectory,
            cutoverRunId,
          }),
        /real immutable owner-only file/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("broad directory", () => {
    const fixture = createSuccessorFixture();
    try {
      const report = successfulCapture(fixture);
      fs.chmodSync(fixture.paths.runDirectory, 0o755);
      assert.throws(
        () => writeHistoricalFresh0016SuccessorReport(report),
        /owner-only mode-0700 directory/,
      );
      fs.chmodSync(fixture.paths.runDirectory, 0o700);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("noncanonical bytes", () => {
    const fixture = createSuccessorFixture();
    try {
      const report = successfulCapture(fixture);
      writeHistoricalFresh0016SuccessorReport(report, { forbiddenPlaintext });
      fs.writeFileSync(
        fixture.paths.reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        { mode: 0o600 },
      );
      fs.chmodSync(fixture.paths.reportPath, 0o600);
      assert.throws(
        () =>
          readHistoricalFresh0016SuccessorReport({
            backupDirectory: fixture.backupDirectory,
            cutoverRunId,
            forbiddenPlaintext,
          }),
        /bytes are not canonical/,
      );
    } finally {
      fixture.cleanup();
    }
  });
});

function capturePreparedThenCrash(
  fixture: SuccessorFixture,
): HistoricalFresh0016SuccessorPreparedCapture {
  const persisted: {
    value?: HistoricalFresh0016SuccessorPreparedCapture;
  } = {};
  assert.throws(
    () =>
      captureHistoricalFresh0016SuccessorReport({
        ...fixture.captureOptions,
        clock: sequenceClock(successorClockValues),
        authorizeLastPreD1: () => authorizationReceipt,
        runner: fixtureRunner(databaseFixture()),
        persistPreparedCapture: (prepared) => {
          persisted.value = structuredClone(prepared);
          throw new Error("simulated prepared-capture crash");
        },
      }),
    /simulated prepared-capture crash/,
  );
  if (!persisted.value) {
    throw new Error("Prepared capture was not persisted by the fixture.");
  }
  return persisted.value;
}

function exactReservationPhase(fixture: SuccessorFixture) {
  const ledger = readD1ReleaseBudgetLedger(
    fixture.maximumReservation.ledgerPath,
  );
  const reservation = ledger.reservations.find(
    (entry) => entry.operationId === fixture.operationId,
  );
  if (!reservation) {
    throw new Error("Successor reservation is missing from the fixture ledger.");
  }
  return reservation.phase;
}

function successfulCapture(fixture: SuccessorFixture) {
  return captureHistoricalFresh0016SuccessorReport({
    ...fixture.captureOptions,
    clock: sequenceClock(successorClockValues),
    authorizeLastPreD1: () => authorizationReceipt,
    runner: fixtureRunner(databaseFixture()),
  });
}

type SuccessorFixture = ReturnType<typeof createSuccessorFixture>;

function createSuccessorFixture(options: {
  usage?: D1DailyUsage;
  admissionMode?: D1ReleaseBudgetAdmissionMode;
} = {}) {
  const rawBackupDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-0016-successor-"),
  );
  const backupDirectory = fs.realpathSync.native(rawBackupDirectory);
  fs.chmodSync(backupDirectory, 0o700);
  const paths = historicalFresh0016SuccessorPaths(
    backupDirectory,
    cutoverRunId,
  );
  fs.mkdirSync(paths.runDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(backupDirectory, "cloudflare"), 0o700);
  fs.chmodSync(path.dirname(paths.runDirectory), 0o700);
  fs.chmodSync(paths.runDirectory, 0o700);

  const upload = writeUploadEvidence(backupDirectory);
  const workerRelease = {
    phase: "uploaded-inactive" as const,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
  };
  const predecessor = createPredecessorReport(
    backupDirectory,
    workerRelease,
  );
  const predecessorReportSha256 =
    historicalFresh0016SuccessorPredecessorReportSha256(predecessor, {
      forbiddenPlaintext,
    });
  const productionExclusionOwner: ProductionValidationLockOwner = {
    candidateVersionId: targetCandidateVersionId,
    leaseExpiresAt: Date.parse("2026-07-15T03:00:00.000Z"),
    leaseId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    sourceFingerprintSha256: sourceFingerprint.sha256,
  };
  const productionExclusionOwnerSha256 =
    historicalFresh0016SuccessorProductionExclusionOwnerSha256(
      productionExclusionOwner,
    );
  const runtimeVerification = createRuntimeVerification({
    backupDirectory,
    runDirectory: paths.runDirectory,
    predecessor,
    predecessorReportSha256,
    productionExclusionOwnerSha256,
  });
  const runtimeVerificationReportSha256 =
    historicalFresh0016SuccessorRuntimeVerificationReportSha256(
      runtimeVerification,
    );
  const operationId = historicalFresh0016SuccessorOperationId({
    cutoverRunId,
    sourceFingerprint,
    ...workerRelease,
    captureLiveTopology: liveTopologyEvidence(
      upload.sha256,
      "2026-07-15T00:09:30.000Z",
    ),
    hmacKeyId: predecessor.hmacKeyId,
    predecessorReportSha256,
    runtimeVerificationStageSha256,
    runtimeVerificationReportSha256,
    productionExclusionOwnerSha256,
  });
  const fixtureUsage = options.usage ?? usage;
  reserveD1ReleaseBudget({
    backupDir: backupDirectory,
    operationId: accountingParentOperationId,
    operation: "Fixture Day-2 aggregate envelope",
    sourceFingerprint,
    candidateVersionId: targetCandidateVersionId,
    phase: "maximum",
    rowsRead: 3_900_000,
    rowsWritten: 70_192,
    observedUsage: fixtureUsage,
    admissionMode: options.admissionMode,
    now: new Date("2026-07-15T00:08:00.000Z"),
    expectedUtcDay: "2026-07-15",
  });
  const maximumReservation = reserveD1ReleaseBudget({
    backupDir: backupDirectory,
    operationId,
    operation: HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
    sourceFingerprint,
    candidateVersionId: targetCandidateVersionId,
    accountingParentOperationId,
    phase: "maximum",
    rowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    rowsWritten: 0,
    observedUsage: fixtureUsage,
    now: new Date("2026-07-15T00:09:00.000Z"),
    expectedUtcDay: "2026-07-15",
  });
  const captureOptions = {
    cutoverRunId,
    backupDirectory,
    ...workerRelease,
    captureLiveTopology: liveTopologyEvidence(
      upload.sha256,
      "2026-07-15T00:09:30.000Z",
    ),
    liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
    hmacSecret,
    predecessor,
    runtimeVerification,
    runtimeVerificationStageSha256,
    productionExclusionOwner,
    usage: fixtureUsage,
    maximumReservation,
    accountingParentOperationId,
    persistPreparedCapture: () => undefined,
    observeFinalizationTopology: () => ({
      evidence: liveTopologyEvidence(
        upload.sha256,
        "2026-07-15T00:13:30.000Z",
      ),
      statusOutput: baselineDeploymentStatusOutput,
    }),
    forbiddenPlaintext,
  };
  return Object.freeze({
    backupDirectory,
    paths,
    predecessor,
    predecessorReportSha256,
    runtimeVerification,
    runtimeVerificationReportSha256,
    productionExclusionOwner,
    productionExclusionOwnerSha256,
    workerRelease,
    operationId,
    maximumReservation,
    captureOptions,
    cleanup: () => fs.rmSync(backupDirectory, { recursive: true, force: true }),
  });
}

function finalizationIdentity(fixture: SuccessorFixture) {
  return {
    ...fixture.workerRelease,
    finalizationLiveTopology: liveTopologyEvidence(
      fixture.workerRelease.uploadEvidenceSha256,
      "2026-07-15T00:13:30.000Z",
    ),
    liveDeploymentStatusOutput: baselineDeploymentStatusOutput,
  };
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
    "fresh-0016 successor fixture",
  );
  const evidence = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-13T23:41:00.000Z",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    expectedReleaseTag: "fresh-0016-successor-fixture",
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
      timestamp: "2026-07-13T23:40:00.000Z",
    },
    versionView: {
      versionId: targetCandidateVersionId,
      createdAt: "2026-07-13T23:39:00.000Z",
      source: "fixture",
      releaseTag: "fresh-0016-successor-fixture",
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

function createPredecessorReport(
  backupDirectory: string,
  workerRelease: Readonly<{
    phase: "uploaded-inactive";
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
  }>,
): HistoricalFresh0016PredecessorReport {
  const capture = createPredecessorCapture();
  const operationId = historicalFresh0016PredecessorOperationId({
    cutoverRunId,
    sourceFingerprint,
    ...workerRelease,
    captureLiveTopology: liveTopologyEvidence(
      workerRelease.uploadEvidenceSha256,
      "2026-07-14T23:46:30.000Z",
    ),
    hmacKeyId: capture.hmacKeyId,
    snapshotPlanSha256: capture.plan.planSha256,
  });
  const predecessorUsage: D1DailyUsage = {
    databaseCount: 1,
    queryGroups: 1,
    rowsRead: 10,
    rowsWritten: 0,
    executions: 1,
    windowMinutes: 1_430,
  };
  const totals = { rowsRead: capture.rowsRead, rowsWritten: 0 };
  return buildHistoricalFresh0016PredecessorReport({
    capture,
    cutoverRunId,
    backupDirectory,
    ...workerRelease,
    captureLiveTopology: liveTopologyEvidence(
      workerRelease.uploadEvidenceSha256,
      "2026-07-14T23:46:30.000Z",
    ),
    finalizationLiveTopology: liveTopologyEvidence(
      workerRelease.uploadEvidenceSha256,
      "2026-07-14T23:49:30.000Z",
    ),
    captureStartedAt: new Date("2026-07-14T23:47:00.000Z"),
    captureCompletedAt: new Date("2026-07-14T23:48:00.000Z"),
    createdAt: new Date("2026-07-14T23:50:00.000Z"),
    finalizedAt: new Date("2026-07-14T23:51:00.000Z"),
    usage: predecessorUsage,
    ledger: {
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
        rowsRead: capture.rowsRead,
        rowsWritten: 0,
        maximumRowsRead:
          HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
        maximumRowsWritten: 0,
        createdAt: "2026-07-14T23:46:00.000Z",
        updatedAt: "2026-07-14T23:49:00.000Z",
      },
      totals,
      accountedUsage: {
        rowsRead: predecessorUsage.rowsRead + totals.rowsRead,
        rowsWritten: 0,
      },
    },
    forbiddenPlaintext,
  });
}

function createPredecessorCapture(): HistoricalPre0016SnapshotCapture {
  const datasets: Partial<
    Record<HistoricalDatasetName, HistoricalDatasetEvidence>
  > = {};
  const supplementalDatasets: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  > = {};
  for (const spec of HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS) {
    const rowCount = isRequiredDataset(spec.name) ? 1 : 0;
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
      sentinels: rowCount === 0 ? [] : [sha256(`predecessor:${spec.name}`)],
      ...(spec.name === "game_results"
        ? { schemaObjects: { ...HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS } }
        : {}),
    };
    if (isCoreDatasetName(spec.name)) datasets[spec.name] = evidence;
    else if (isSupplementalDatasetName(spec.name)) {
      supplementalDatasets[spec.name] = evidence;
    }
  }
  assertCompleteDatasets(datasets);
  assertCompleteSupplementalDatasets(supplementalDatasets);
  return Object.freeze({
    plan: createHistoricalPre0016SnapshotPlan(sourceFingerprint),
    rowsRead: 1_234,
    rowsWritten: 0,
    hmacKeyId: historicalDataHmacKeyId(hmacSecret),
    datasets,
    supplementalDatasets,
  });
}

function createRuntimeVerification(input: {
  backupDirectory: string;
  runDirectory: string;
  predecessor: HistoricalFresh0016PredecessorReport;
  predecessorReportSha256: string;
  productionExclusionOwnerSha256: string;
}): HistoricalFresh0016RuntimeVerificationReport {
  const binding: HistoricalFresh0016MigrationBinding = {
    cutoverRunId,
    cutoverManifestSha256: "1".repeat(64),
    migrationBudgetPreparedArtifactFileSha256: "9".repeat(64),
    predecessorReportSha256: input.predecessorReportSha256,
    predecessorCompleteSha256: "2".repeat(64),
    predecessorEvidenceChainSha256: "3".repeat(64),
    predecessorHmacKeyId: input.predecessor.hmacKeyId,
    successorSnapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint,
    database: { ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database },
  };
  const staticRowsRead = 3;
  const postRowsRead = 2;
  return historicalFresh0016RuntimeVerificationReportSchema.parse({
    kind: HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND,
    schemaVersion: 2,
    createdAt: "2026-07-15T00:05:00.000Z",
    ok: true,
    backupDir: input.backupDirectory,
    runDirectory: input.runDirectory,
    renderedMigrationPath: path.join(input.runDirectory, "06a-0016-rendered.sql"),
    database: { ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database },
    binding,
    evidence: {
      predecessorCompleteSha256: binding.predecessorCompleteSha256,
      preWriteEvidenceSha256: "4".repeat(64),
      migrationAuthorizationSha256: "5".repeat(64),
      renderedMigrationSha256: "6".repeat(64),
      productionExclusionOwnerSha256:
        input.productionExclusionOwnerSha256,
    },
    activeWorkerVersion: targetCandidateVersionId,
    sourceFingerprint,
    sourceFingerprintStable: true,
    renderedMigration: {
      sourceBytes: HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
      sourceSha256: HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
      renderedSha256: "6".repeat(64),
      freshMarkerValueSha256: "7".repeat(64),
    },
    staticVerification: {
      kind: RUNTIME_MIGRATION_EVIDENCE_KIND,
      createdAt: "2026-07-15T00:04:00.000Z",
      rowsRead: staticRowsRead,
      rowsWritten: 0,
      totalAttempts: 1,
      checkCount: RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length,
    },
    post0016Verification: {
      querySha256: "8".repeat(64),
      rowsRead: postRowsRead,
      rowsWritten: 0,
      totalAttempts: 1,
      fixedMarker: {
        key: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
        valueSha256: "a".repeat(64),
        updatedAt: Date.parse("2026-07-15T00:01:00.000Z"),
      },
      freshMarker: {
        key:
          HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
            .freshCutoverMarkerKey,
        valueSha256: "b".repeat(64),
        updatedAt: Date.parse("2026-07-15T00:02:00.000Z"),
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

type HistoricalProtectedFixtureDatasetName =
  | HistoricalDatasetName
  | HistoricalSupplementalDatasetName;
type HistoricalFixtureDatasetName =
  | HistoricalProtectedFixtureDatasetName
  | HistoricalOperationalDatasetName;
type DatabaseFixture = {
  counts: Record<HistoricalFixtureDatasetName, number>;
  identities: Record<
    HistoricalProtectedFixtureDatasetName,
    Array<Record<string, unknown>>
  >;
};

function databaseFixture(): DatabaseFixture {
  return {
    counts: {
      users: 1,
      accounts: 1,
      sessions: 1,
      chats: 1,
      messages: 1,
      admin_users: 0,
      user_memories: 1,
      activity_runs: 0,
      product_events: 0,
      profile_photo_pointers: 0,
      ai_runs: 1,
      user_memory_graph_edges: 1,
      user_memory_settings: 1,
      chat_memory_summaries: 1,
      chat_memory_turns: 1,
      user_memory_profiles: 1,
      user_memory_summaries: 1,
      memory_synthesis_runs: 1,
      memory_source_feedback: 1,
      memory_events: 1,
      game_results: 1,
      memory_vector_cleanup_outbox: 0,
    },
    identities: {
      users: [{ identity_1: privateUserId }],
      accounts: [{
        identity_1: "provider",
        identity_2: "provider-account-id",
        identity_3: privateUserId,
      }],
      sessions: [{
        identity_1: privateSessionToken,
        identity_2: privateUserId,
      }],
      chats: [{ identity_1: "chat-id", identity_2: privateUserId }],
      messages: [{ identity_1: "message-id", identity_2: "chat-id" }],
      admin_users: [],
      user_memories: [{ identity_1: "memory-id", identity_2: privateUserId }],
      activity_runs: [],
      product_events: [],
      profile_photo_pointers: [],
      ai_runs: [{
        identity_1: "ai-run-id",
        identity_2: "chat-id",
        identity_3: "user-message-id",
      }],
      user_memory_graph_edges: [{
        identity_1: "memory-id",
        identity_2: privateUserId,
        identity_3: '["memory-turn-id"]',
        identity_4: "[]",
        identity_5: "chat-id",
        identity_6: "user-message-id",
        identity_7: "",
      }],
      user_memory_settings: [{ identity_1: privateUserId }],
      chat_memory_summaries: [{ identity_1: "chat-id", identity_2: privateUserId }],
      chat_memory_turns: [{
        identity_1: "memory-turn-id",
        identity_2: privateUserId,
        identity_3: "chat-id",
        identity_4: "topic-id",
        identity_5: "user-message-id",
        identity_6: "assistant-message-id",
      }],
      user_memory_profiles: [{ identity_1: privateUserId, identity_2: "goals" }],
      user_memory_summaries: [{ identity_1: privateUserId }],
      memory_synthesis_runs: [{ identity_1: "synthesis-run-id", identity_2: privateUserId }],
      memory_source_feedback: [{
        identity_1: "memory-feedback-id",
        identity_2: privateUserId,
        identity_3: "ai-run-id",
        identity_4: "memory-id",
        identity_5: "memory-turn-id",
        identity_6: "summary-section-id",
      }],
      memory_events: [{
        identity_1: "memory-event-id",
        identity_2: privateUserId,
        identity_3: "memory-id",
        identity_4: "chat-id",
        identity_5: "message-id",
      }],
      game_results: [{ ...privateGameResultIdentity }],
    },
  };
}

type WranglerCall = {
  args: string[];
  options: Parameters<WranglerRunner>[1];
};
type FixtureResultSet = {
  rows: Array<Record<string, unknown>>;
  rowsRead: number;
  rowsWritten?: number;
  totalAttempts?: number | null;
};

function fixtureRunner(
  fixture: DatabaseFixture,
  calls: WranglerCall[] = [],
  mutate?: (sets: FixtureResultSet[]) => void,
  beforeReturn?: () => void,
): WranglerRunner {
  return (args, options) => {
    calls.push({ args, options });
    if (args.at(-1) !== HISTORICAL_DATA_SNAPSHOT_SQL) {
      throw new Error("Unexpected D1 SQL in successor fixture.");
    }
    const datasetNames = [
      ...HISTORICAL_DATASET_NAMES,
      ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
      ...HISTORICAL_OPERATIONAL_DATASET_NAMES,
    ] as const;
    const protectedDatasetNames = [
      ...HISTORICAL_DATASET_NAMES,
      ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
    ] as const;
    const countSets = datasetNames.map((name) => ({
      rows: [{ dataset: name, row_count: fixture.counts[name] }],
      rowsRead: fixture.counts[name],
    }));
    const schemaSets = schemaTableNames().map((table) => {
      const rows = table === "memory_vector_cleanup_outbox"
        ? memoryVectorCleanupOutboxSchemaRows()
        : table === "game_results"
          ? gameResultsSchemaRows()
          : [{
            table_name: table,
            name: table === "admin_users" ? "email" : "id",
            type: "text",
            not_null: 1,
            primary_key: 1,
          }];
      return { rows, rowsRead: rows.length };
    });
    const schemaObjectSets = [{
      rows: historicalGameResultsSchemaObjectResultRows(),
      rowsRead: 2,
    }];
    const identitySets = protectedDatasetNames.map((name) => ({
      rows: fixture.identities[name],
      rowsRead: fixture.identities[name].length,
    }));
    const sets: FixtureResultSet[] = [
      ...countSets,
      ...schemaSets,
      ...schemaObjectSets,
      ...identitySets,
    ];
    mutate?.(sets);
    beforeReturn?.();
    return JSON.stringify(sets.map((set) => ({
      success: true,
      results: set.rows,
      meta: {
        rows_read: set.rowsRead,
        rows_written: set.rowsWritten ?? 0,
        ...(set.totalAttempts === null
          ? {}
          : { total_attempts: set.totalAttempts ?? 1 }),
      },
    })));
  };
}

function schemaTableNames() {
  return [
    "users",
    "accounts",
    "sessions",
    "chats",
    "messages",
    "admin_users",
    "user_memories",
    "activity_runs",
    "product_events",
    "ai_runs",
    "user_memory_settings",
    "chat_memory_summaries",
    "chat_memory_turns",
    "user_memory_profiles",
    "user_memory_summaries",
    "memory_synthesis_runs",
    "memory_source_feedback",
    "memory_events",
    "game_results",
    "memory_vector_cleanup_outbox",
  ] as const;
}

function gameResultsSchemaRows() {
  return HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.map((column) => ({
    table_name: "game_results",
    name: column.name,
    type: column.type,
    not_null: column.notNull,
    primary_key: column.primaryKey,
  }));
}

function memoryVectorCleanupOutboxSchemaRows() {
  const columns = [
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
  ] as const;
  return columns.map(([name, type, notNull, primaryKey]) => ({
    table_name: "memory_vector_cleanup_outbox",
    name,
    type,
    not_null: notNull,
    primary_key: primaryKey,
  }));
}

function sequenceClock(values: readonly string[]) {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (!value) throw new Error("Successor fixture clock exhausted.");
    return new Date(value);
  };
}

function isRequiredDataset(name: string) {
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

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
