import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHistoricalFresh0016LiveTopologyEvidence,
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_RELATIVE_PATH,
  HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
  HISTORICAL_FRESH_0016_CUTOVER_MARKER_KEY,
  HISTORICAL_FRESH_0016_CUTOVER_MAXIMUM_GAP_MS,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  HISTORICAL_FRESH_0016_CUTOVER_RUNS_RELATIVE_DIRECTORY,
  HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_MAX_AGE_MS,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
  HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
} from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import {
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_PROTECTED_DATASET_COUNT,
  HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import { createHash, stableStringify } from "../scripts/cloudflare/migration-config";

test("fresh 0016 policy preserves the full objective without claiming the lost-key interval", () => {
  const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;

  assert.equal(
    policy.predecessor.protectedDatasets.length,
    HISTORICAL_PROTECTED_DATASET_COUNT,
  );
  assert.equal(
    new Set(policy.predecessor.protectedDatasets).size,
    HISTORICAL_PROTECTED_DATASET_COUNT,
  );
  assert.deepEqual(policy.predecessor.excludedOperationalDatasets, [
    "memory_vector_cleanup_outbox",
  ]);
  assert.equal(
    policy.proof.protectedDatasetCount,
    HISTORICAL_PROTECTED_DATASET_COUNT,
  );
  assert.equal(policy.proof.requireSameHmacKey, true);
  assert.equal(policy.proof.requireNondecreasingCounts, true);
  assert.equal(policy.proof.requireAllPredecessorColumns, true);
  assert.equal(policy.proof.requireAllPredecessorSentinels, true);
  assert.equal(policy.proof.requireEmptyNewOperationalOutbox, true);
  assert.equal(policy.proof.legacyLostKeyIntervalProven, false);
  assert.equal(
    policy.legacyInterval.status,
    "identity-continuity-unverifiable-lost-key",
  );
  assert.equal(
    policy.legacyInterval.retroactiveContinuityClaimPermitted,
    false,
  );
});

test("fresh 0016 policy binds exact Free-plan snapshot ceilings across UTC days", () => {
  const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;

  assert.equal(
    policy.predecessor.logicalSnapshotRowsRead,
    HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
  );
  assert.equal(
    policy.predecessor.logicalRowsReadLimit,
    HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
  );
  assert.equal(
    policy.predecessor.maximumAutomaticReadAttempts,
    HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
  );
  assert.equal(
    policy.predecessor.billableRowsReadReservation,
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  );
  assert.equal(
    policy.predecessor.billableRowsReadReservation,
    policy.predecessor.logicalRowsReadLimit *
      policy.predecessor.maximumAutomaticReadAttempts,
  );
  assert.equal(
    policy.successor.billableRowsReadReservation,
    HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  );
  assert.equal(
    policy.successor.snapshotPlanSha256,
    HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
  );
  assert.ok(
    policy.predecessor.billableRowsReadReservation +
        policy.successor.billableRowsReadReservation >
      4_000_000,
    "the two snapshots must never be admitted on one safe-ledger day",
  );
  assert.equal(
    policy.successor.maximumPredecessorToSuccessorGapMs,
    HISTORICAL_FRESH_0016_CUTOVER_MAXIMUM_GAP_MS,
  );
  assert.ok(
    policy.successor.targetPredecessorToSuccessorGapMs <
      policy.successor.maximumPredecessorToSuccessorGapMs,
  );
});

test("fresh 0016 policy requires a transactional insert-only marker and forbids already-applied admission", () => {
  const migration = HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016;

  assert.deepEqual(migration.requiredStateBefore, {
    "0013": "applied",
    "0014": "applied",
    "0015": "applied",
    "0016": "absent",
  });
  assert.equal(
    migration.trackedFile,
    "drizzle-d1/0016_memory_vector_cleanup_outbox.sql",
  );
  assert.equal(migration.freshCutoverMarkerKey, HISTORICAL_FRESH_0016_CUTOVER_MARKER_KEY);
  assert.equal(migration.markerWritePolicy, "insert-only-in-same-transaction");
  assert.equal(migration.renderedAppendedStatementCount, 1);
  assert.deepEqual(migration.freshMarkerBudget, {
    rowsRead: 1,
    rowsWritten: 2,
  });
  assert.equal(migration.alreadyAppliedAdmissionPermitted, false);
  assert.notEqual(
    migration.freshCutoverMarkerKey,
    migration.fixedCompletionMarker.key,
  );
});

test("fresh 0016 policy freezes the earlier-day 0017 state transition and exact Day-2 envelope", () => {
  const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;
  const prerequisite = policy.runtimeMigration0017Prerequisite;
  const day2 = policy.day2Budget;

  assert.equal(
    prerequisite.timing,
    "strictly-earlier-utc-day-before-predecessor",
  );
  assert.deepEqual(prerequisite.requiredStateBeforeApply, {
    "0013": "applied",
    "0014": "applied",
    "0015": "applied",
    "0016": "absent",
    "0017": "absent",
  });
  assert.deepEqual(prerequisite.requiredStateAtPredecessorLiveGate, {
    "0013": "applied",
    "0014": "applied",
    "0015": "applied",
    "0016": "absent",
    "0017": "applied",
  });
  assert.equal(prerequisite.mutationAfterPredecessorPermitted, false);
  assert.equal(prerequisite.day2ReadOnlyRefreshBillableRowsRead, 36);

  assert.equal(day2.aggregateRowsRead, 3_900_036);
  assert.equal(day2.maximumObservedUsageAtAdmission.rowsRead, 99_964);
  assert.equal(
    day2.aggregateRowsRead + day2.maximumObservedUsageAtAdmission.rowsRead,
    4_000_000,
  );
  assert.equal(day2.allocations.migrationProjectionRowsRead, 805_476);
  assert.equal(
    day2.allocations.runtimeMigration0017VerificationBillableRowsRead,
    36,
  );
  assert.equal(
    day2.allocations.migrationProjectionRowsRead +
      day2.allocations.migrationApplyBillableRowsRead +
      day2.allocations.preservationBranchRowsRead +
      day2.allocations.standaloneRuntimeVerificationBillableRowsRead +
      day2.allocations.runtimeMigration0017VerificationBillableRowsRead +
      day2.allocations.productionLockRowsRead +
      day2.allocations.postdeployAuthorizationRowsRead,
    day2.aggregateRowsRead,
  );
});

test("fresh 0016 policy keeps the uploaded target inactive while the distinct baseline serves 100%", () => {
  const release = HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease;
  assert.equal(release.phase, "uploaded-inactive");
  assert.deepEqual(release.immutableIdentityFields, [
    "targetCandidateVersionId",
    "serviceBaselineVersionId",
    "uploadEvidenceSha256",
  ]);
  assert.equal(release.targetMustDifferFromBaseline, true);
  assert.equal(
    release.preactivationTopology.soleServingRole,
    "serviceBaselineVersionId",
  );
  assert.equal(release.preactivationTopology.soleServingPercentage, 100);
  assert.equal(release.preactivationTopology.observedServingVersions, 1);
  assert.equal(release.preactivationTopology.targetCandidateState, "inactive");
  assert.equal(release.preactivationTopology.targetCandidatePercentage, 0);
  assert.equal(
    release.accountingAndProductionExclusionOwnerRole,
    "targetCandidateVersionId",
  );
  assert.equal(
    release.activationTiming,
    "after-successor-before-final-preservation-proof",
  );
  assert.deepEqual(release.finalVerificationTopology, {
    soleServingRole: "targetCandidateVersionId",
    soleServingPercentage: 100,
    observedServingVersions: 1,
    serviceBaselineState: "absent",
    serviceBaselinePercentage: 0,
    requireCanonicalActivationEvidence: true,
  });
});

test("fresh 0016 live topology evidence rejects early activation, staged traffic records, and stale observations", () => {
  const targetCandidateVersionId =
    "11111111-1111-4111-8111-111111111111";
  const serviceBaselineVersionId =
    "22222222-2222-4222-8222-222222222222";
  const uploadEvidenceSha256 = "a".repeat(64);
  const observedAt = new Date("2026-07-15T00:10:00.000Z");
  const baselineOutput = statusOutput([
    [serviceBaselineVersionId, 100],
  ]);
  const evidence = createHistoricalFresh0016LiveTopologyEvidence({
    observedAt,
    statusOutput: baselineOutput,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
  });
  assert.equal(evidence.topology.serviceBaselineVersionId, serviceBaselineVersionId);
  assert.equal(evidence.topology.baselinePercentage, 100);
  assert.equal(evidence.topology.observedVersions, 1);
  assert.deepEqual(evidence.targetCandidate, {
    versionId: targetCandidateVersionId,
    state: "absent",
    percentage: 0,
  });
  assert.doesNotThrow(() =>
    assertHistoricalFresh0016LiveTopologyEvidence({
      evidence,
      boundaryAt: new Date(
        observedAt.getTime() + HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_MAX_AGE_MS,
      ),
      statusOutput: baselineOutput,
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256,
    }));
  assert.throws(
    () => createHistoricalFresh0016LiveTopologyEvidence({
      observedAt,
      statusOutput: statusOutput([[targetCandidateVersionId, 100]]),
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256,
    }),
    /exact service baseline/,
  );
  assert.throws(
    () => createHistoricalFresh0016LiveTopologyEvidence({
      observedAt,
      statusOutput: statusOutput([
        [serviceBaselineVersionId, 100],
        [targetCandidateVersionId, 0],
      ]),
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256,
    }),
    /exact service baseline/,
  );
  assert.throws(
    () => assertHistoricalFresh0016LiveTopologyEvidence({
      evidence,
      boundaryAt: new Date(
        observedAt.getTime() +
          HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_MAX_AGE_MS +
          1,
      ),
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256,
    }),
    /stale, future-dated/,
  );
});

test("fresh 0016 policy identity and private evidence locations are deterministic", () => {
  assert.equal(
    HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    createHash()
      .update(stableStringify(HISTORICAL_FRESH_0016_CUTOVER_POLICY))
      .digest("hex"),
  );
  assert.match(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(
    HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
    "--confirm-lost-key-fresh-boundary",
  );
  assert.equal(
    HISTORICAL_FRESH_0016_CUTOVER_RUNS_RELATIVE_DIRECTORY,
    "cloudflare/fresh-0016-cutover",
  );
  assert.equal(
    HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_RELATIVE_PATH,
    "cloudflare/fresh-0016-cutover-complete.json",
  );
  assert.equal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.runDirectoryMode, 0o700);
  assert.equal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.evidenceFileMode, 0o600);
});

function statusOutput(
  versions: readonly (readonly [string, number])[],
) {
  return JSON.stringify({
    id: "33333333-3333-4333-8333-333333333333",
    versions: versions.map(([versionId, percentage]) => ({
      version_id: versionId,
      percentage,
    })),
  });
}
