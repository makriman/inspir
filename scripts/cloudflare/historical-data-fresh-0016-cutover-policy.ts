import {
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
} from "./d1-free-budget";
import {
  PRODUCTION_MAINTENANCE_STATE_MAX_BILLED_ROWS_READ,
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
} from "./production-validation-lock";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  createHash,
  stableStringify,
} from "./migration-config";
import {
  HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES,
  HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
  HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
} from "./historical-data-pre-0016-snapshot";
import {
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_PROTECTED_DATASET_COUNT,
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
  HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
  HISTORICAL_BILLED_READ_LIMIT,
} from "./verify-historical-data-preservation";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
  RUNTIME_MIGRATION_FILES,
  RUNTIME_MIGRATION_VERIFICATION_BILLABLE_ROWS_READ_LIMIT,
} from "./verify-d1-runtime-migrations";
import {
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
  RUNTIME_MIGRATION_FRESH_0016_MARKER_ROWS_READ,
  RUNTIME_MIGRATION_FRESH_0016_MARKER_ROWS_WRITTEN,
} from "./check-d1-runtime-migration-budget";
import {
  RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ,
} from "./check-d1-runtime-migration-0017-budget";
import {
  D1_RUNTIME_FRESH_0016_MARKER_KEY,
} from "./d1-runtime-pre-0016-state";
import { z } from "zod";
import {
  parseActivatedWorkerTopology,
  parseWorkerCandidateActivationEvidence,
  parseSoleBaselineTopology,
  workerCandidateEvidenceSha256,
  type WorkerCandidateActivationEvidence,
} from "./worker-candidate-release-evidence";

export const HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG =
  "--confirm-lost-key-fresh-boundary" as const;
export const HISTORICAL_FRESH_0016_CUTOVER_RUNS_RELATIVE_DIRECTORY =
  "cloudflare/fresh-0016-cutover" as const;
export const HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_RELATIVE_PATH =
  "cloudflare/fresh-0016-cutover-complete.json" as const;
export const HISTORICAL_FRESH_0016_CUTOVER_MARKER_KEY =
  D1_RUNTIME_FRESH_0016_MARKER_KEY;
export const HISTORICAL_FRESH_0016_CUTOVER_MAXIMUM_GAP_MS =
  26 * 60 * 60 * 1_000;
const HISTORICAL_FRESH_0016_CUTOVER_TARGET_GAP_MS =
  60 * 60 * 1_000;
export const HISTORICAL_FRESH_0016_CUTOVER_PRE_RESET_WINDOW_MS =
  30 * 60 * 1_000;
export const HISTORICAL_FRESH_0016_CUTOVER_POST_RESET_WINDOW_MS =
  30 * 60 * 1_000;
export const HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_MAX_AGE_MS =
  5 * 60 * 1_000;
const HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_EVIDENCE_KIND =
  "inspir-historical-fresh-0016-live-worker-topology-v1" as const;
const HISTORICAL_FRESH_0016_FINAL_ACTIVE_TOPOLOGY_EVIDENCE_KIND =
  "inspir-historical-fresh-0016-final-active-worker-topology-v1" as const;

const liveTopologyUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);
const liveTopologySha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const liveTopologyTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical live-topology observation timestamp.");
const liveTopologyWorkerReleaseSchema = z.object({
  phase: z.literal("uploaded-inactive"),
  targetCandidateVersionId: liveTopologyUuidSchema,
  serviceBaselineVersionId: liveTopologyUuidSchema,
  uploadEvidenceSha256: liveTopologySha256Schema,
}).strict().superRefine((value, context) => {
  if (value.targetCandidateVersionId === value.serviceBaselineVersionId) {
    context.addIssue({
      code: "custom",
      message: "The live target candidate must differ from the serving baseline.",
    });
  }
});

export const historicalFresh0016LiveTopologyEvidenceSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_EVIDENCE_KIND),
  schemaVersion: z.literal(1),
  observedAt: liveTopologyTimestampSchema,
  authoritativeSource: z.literal("wrangler-deployments-status-json"),
  statusOutputSha256: liveTopologySha256Schema,
  workerRelease: liveTopologyWorkerReleaseSchema,
  topology: z.object({
    deploymentId: liveTopologyUuidSchema,
    serviceBaselineVersionId: liveTopologyUuidSchema,
    baselinePercentage: z.literal(100),
    observedVersions: z.literal(1),
  }).strict(),
  targetCandidate: z.object({
    versionId: liveTopologyUuidSchema,
    state: z.literal("absent"),
    percentage: z.literal(0),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (
    value.topology.serviceBaselineVersionId !==
      value.workerRelease.serviceBaselineVersionId ||
    value.targetCandidate.versionId !==
      value.workerRelease.targetCandidateVersionId
  ) {
    context.addIssue({
      code: "custom",
      message: "Live topology drifted from its immutable candidate/baseline identity.",
    });
  }
});

export const historicalFresh0016FinalActiveTopologyEvidenceSchema = z.object({
  kind: z.literal(
    HISTORICAL_FRESH_0016_FINAL_ACTIVE_TOPOLOGY_EVIDENCE_KIND,
  ),
  schemaVersion: z.literal(1),
  observedAt: liveTopologyTimestampSchema,
  authoritativeSource: z.literal("wrangler-deployments-status-json"),
  statusOutputSha256: liveTopologySha256Schema,
  workerRelease: liveTopologyWorkerReleaseSchema,
  activationEvidence: z.object({
    sha256: liveTopologySha256Schema,
    createdAt: liveTopologyTimestampSchema,
    deploymentId: liveTopologyUuidSchema,
    stagedEvidenceSha256: liveTopologySha256Schema,
    preActivationSealSha256: liveTopologySha256Schema,
  }).strict(),
  topology: z.object({
    deploymentId: liveTopologyUuidSchema,
    targetCandidateVersionId: liveTopologyUuidSchema,
    candidatePercentage: z.literal(100),
    observedVersions: z.literal(1),
  }).strict(),
  serviceBaseline: z.object({
    versionId: liveTopologyUuidSchema,
    state: z.literal("absent"),
    percentage: z.literal(0),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (
    value.topology.targetCandidateVersionId !==
      value.workerRelease.targetCandidateVersionId ||
    value.serviceBaseline.versionId !==
      value.workerRelease.serviceBaselineVersionId ||
    value.activationEvidence.deploymentId !== value.topology.deploymentId ||
    Date.parse(value.observedAt) <=
      Date.parse(value.activationEvidence.createdAt)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Final active topology drifted from its activation, candidate, or service-baseline identity.",
    });
  }
});

export type HistoricalFresh0016LiveTopologyEvidence = z.infer<
  typeof historicalFresh0016LiveTopologyEvidenceSchema
>;
export type HistoricalFresh0016FinalActiveTopologyEvidence = z.infer<
  typeof historicalFresh0016FinalActiveTopologyEvidenceSchema
>;

export function createHistoricalFresh0016LiveTopologyEvidence(input: Readonly<{
  observedAt: Date;
  statusOutput: string;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>) {
  const observedAt = canonicalLiveTopologyDate(input.observedAt, "observation");
  const workerRelease = liveTopologyWorkerReleaseSchema.parse({
    phase: "uploaded-inactive",
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
  const topology = parseSoleBaselineTopology(
    input.statusOutput,
    workerRelease.serviceBaselineVersionId,
  );
  return historicalFresh0016LiveTopologyEvidenceSchema.parse({
    kind: HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_EVIDENCE_KIND,
    schemaVersion: 1,
    observedAt: observedAt.toISOString(),
    authoritativeSource: "wrangler-deployments-status-json",
    statusOutputSha256: createHash()
      .update(input.statusOutput, "utf8")
      .digest("hex"),
    workerRelease,
    topology: {
      deploymentId: topology.deploymentId,
      serviceBaselineVersionId: topology.serviceBaselineVersionId,
      baselinePercentage: topology.percentage,
      observedVersions: topology.observedVersions,
    },
    targetCandidate: {
      versionId: workerRelease.targetCandidateVersionId,
      state: "absent",
      percentage: 0,
    },
  });
}

export function createHistoricalFresh0016FinalActiveTopologyEvidence(
  input: Readonly<{
    observedAt: Date;
    statusOutput: string;
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
    activationEvidence: WorkerCandidateActivationEvidence;
    activationEvidenceSha256: string;
  }>,
) {
  const observedAt = canonicalLiveTopologyDate(input.observedAt, "observation");
  const workerRelease = liveTopologyWorkerReleaseSchema.parse({
    phase: "uploaded-inactive",
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
  const activation = parseWorkerCandidateActivationEvidence(
    input.activationEvidence,
  );
  const activationEvidenceSha256 = liveTopologySha256Schema.parse(
    input.activationEvidenceSha256,
  );
  if (
    workerCandidateEvidenceSha256(activation) !== activationEvidenceSha256 ||
    activation.targetCandidateVersionId !==
      workerRelease.targetCandidateVersionId ||
    activation.serviceBaselineVersionId !==
      workerRelease.serviceBaselineVersionId ||
    activation.uploadEvidenceSha256 !== workerRelease.uploadEvidenceSha256
  ) {
    throw new Error(
      "Fresh-0016 final topology activation evidence lost its exact candidate, baseline, upload, or canonical hash binding.",
    );
  }
  const topology = parseActivatedWorkerTopology(
    input.statusOutput,
    workerRelease.targetCandidateVersionId,
    activation.topology.deploymentId,
  );
  if (stableStringify(topology) !== stableStringify(activation.topology)) {
    throw new Error(
      "Fresh-0016 final topology no longer matches the canonical activation evidence.",
    );
  }
  return historicalFresh0016FinalActiveTopologyEvidenceSchema.parse({
    kind: HISTORICAL_FRESH_0016_FINAL_ACTIVE_TOPOLOGY_EVIDENCE_KIND,
    schemaVersion: 1,
    observedAt: observedAt.toISOString(),
    authoritativeSource: "wrangler-deployments-status-json",
    statusOutputSha256: createHash()
      .update(input.statusOutput, "utf8")
      .digest("hex"),
    workerRelease,
    activationEvidence: {
      sha256: activationEvidenceSha256,
      createdAt: activation.createdAt,
      deploymentId: activation.topology.deploymentId,
      stagedEvidenceSha256: activation.stagedEvidenceSha256,
      preActivationSealSha256: activation.preActivationSealSha256,
    },
    topology: {
      deploymentId: topology.deploymentId,
      targetCandidateVersionId: topology.targetCandidateVersionId,
      candidatePercentage: topology.percentage,
      observedVersions: topology.observedVersions,
    },
    serviceBaseline: {
      versionId: workerRelease.serviceBaselineVersionId,
      state: "absent",
      percentage: 0,
    },
  });
}

export function assertHistoricalFresh0016LiveTopologyEvidence(input: Readonly<{
  evidence: HistoricalFresh0016LiveTopologyEvidence;
  boundaryAt: Date;
  statusOutput?: string;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>) {
  const boundaryAt = canonicalLiveTopologyDate(input.boundaryAt, "boundary");
  const evidence = historicalFresh0016LiveTopologyEvidenceSchema.parse(
    input.evidence,
  );
  const observedAt = Date.parse(evidence.observedAt);
  if (
    evidence.workerRelease.targetCandidateVersionId !==
      input.targetCandidateVersionId ||
    evidence.workerRelease.serviceBaselineVersionId !==
      input.serviceBaselineVersionId ||
    evidence.workerRelease.uploadEvidenceSha256 !==
      input.uploadEvidenceSha256 ||
    observedAt > boundaryAt.getTime() ||
    boundaryAt.getTime() - observedAt >
      HISTORICAL_FRESH_0016_LIVE_TOPOLOGY_MAX_AGE_MS
  ) {
    throw new Error(
      "Fresh-0016 live topology is stale, future-dated, or release-identity drifted.",
    );
  }
  if (input.statusOutput !== undefined) {
    const recreated = createHistoricalFresh0016LiveTopologyEvidence({
      observedAt: new Date(evidence.observedAt),
      statusOutput: input.statusOutput,
      targetCandidateVersionId: input.targetCandidateVersionId,
      serviceBaselineVersionId: input.serviceBaselineVersionId,
      uploadEvidenceSha256: input.uploadEvidenceSha256,
    });
    if (stableStringify(recreated) !== stableStringify(evidence)) {
      throw new Error(
        "Fresh-0016 live topology does not match the exact authoritative status output.",
      );
    }
  }
  return evidence;
}

function canonicalLiveTopologyDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Fresh-0016 live topology ${label} time is invalid.`);
  }
  return new Date(value.getTime());
}

// One aggregate Day-2 envelope is admitted before the first D1 lock mutation.
// Child operations retain their own crash evidence but account under this
// parent, so delayed Insights cannot count the same reads a second time.
export const HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_READ_LIMIT =
  99_964 as const;
export const HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_WRITTEN_LIMIT =
  5_000 as const;
export const HISTORICAL_FRESH_0016_DAY2_POSTDEPLOY_AUTH_ROWS_READ_ALLOWANCE =
  25_000 as const;
const HISTORICAL_FRESH_0016_DAY2_POSTDEPLOY_AUTH_ROWS_WRITTEN_ALLOWANCE =
  20_000 as const;
const HISTORICAL_FRESH_0016_DAY2_PRODUCTION_LOCK_LIFECYCLES = 3 as const;
export const HISTORICAL_FRESH_0016_DAY2_LOCK_ROWS_READ_ALLOWANCE =
  HISTORICAL_FRESH_0016_DAY2_PRODUCTION_LOCK_LIFECYCLES *
    PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ +
  HISTORICAL_FRESH_0016_DAY2_PRODUCTION_LOCK_LIFECYCLES *
    2 *
    PRODUCTION_MAINTENANCE_STATE_MAX_BILLED_ROWS_READ *
    HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS;
const HISTORICAL_FRESH_0016_DAY2_LOCK_ROWS_WRITTEN_ALLOWANCE =
  HISTORICAL_FRESH_0016_DAY2_PRODUCTION_LOCK_LIFECYCLES *
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN;
const HISTORICAL_FRESH_0016_DAY2_APPLY_LOGICAL_ROWS_READ =
  20_128 as const;
export const HISTORICAL_FRESH_0016_DAY2_APPLY_BILLABLE_ROWS_READ =
  HISTORICAL_FRESH_0016_DAY2_APPLY_LOGICAL_ROWS_READ *
  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS;
export const HISTORICAL_FRESH_0016_DAY2_PRESERVATION_BRANCH_ROWS_READ =
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ +
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT;
export const HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ =
  D1_FREE_SAFE_ROWS_READ_LIMIT -
  HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_READ_LIMIT;
export const HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN =
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES +
  HISTORICAL_FRESH_0016_DAY2_LOCK_ROWS_WRITTEN_ALLOWANCE +
  HISTORICAL_FRESH_0016_DAY2_POSTDEPLOY_AUTH_ROWS_WRITTEN_ALLOWANCE;
export const HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT =
  HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ -
  HISTORICAL_FRESH_0016_DAY2_APPLY_BILLABLE_ROWS_READ -
  HISTORICAL_FRESH_0016_DAY2_PRESERVATION_BRANCH_ROWS_READ -
  RUNTIME_MIGRATION_VERIFICATION_BILLABLE_ROWS_READ_LIMIT -
  RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ -
  HISTORICAL_FRESH_0016_DAY2_LOCK_ROWS_READ_ALLOWANCE -
  HISTORICAL_FRESH_0016_DAY2_POSTDEPLOY_AUTH_ROWS_READ_ALLOWANCE;

const migration0016File = RUNTIME_MIGRATION_FILES[3];
if (migration0016File !== "drizzle-d1/0016_memory_vector_cleanup_outbox.sql") {
  throw new Error("Fresh 0016 cutover policy lost its exact tracked migration file.");
}

export const HISTORICAL_FRESH_0016_CUTOVER_POLICY = {
  kind: "inspir-historical-data-fresh-0016-cutover-policy-v2",
  schemaVersion: 2,
  policyId: "lost-predecessor-key-fresh-0016-cutover-2026-07-14",
  reason: "predecessor-hmac-key-unavailable-and-successor-window-expired",
  database: {
    id: D1_DATABASE_ID,
    name: D1_DATABASE_NAME,
  },
  operatorConfirmationFlag: HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
  legacyInterval: {
    startsAt: "2026-07-13T01:10:08.863Z",
    endsAt: "fresh-pre-0016-predecessor-capture",
    status: "identity-continuity-unverifiable-lost-key",
    retroactiveContinuityClaimPermitted: false,
  },
  workerRelease: {
    phase: "uploaded-inactive",
    immutableIdentityFields: [
      "targetCandidateVersionId",
      "serviceBaselineVersionId",
      "uploadEvidenceSha256",
    ],
    targetMustDifferFromBaseline: true,
    preactivationTopology: {
      soleServingRole: "serviceBaselineVersionId",
      soleServingPercentage: 100,
      observedServingVersions: 1,
      targetCandidateState: "inactive",
      targetCandidatePercentage: 0,
    },
    finalVerificationTopology: {
      soleServingRole: "targetCandidateVersionId",
      soleServingPercentage: 100,
      observedServingVersions: 1,
      serviceBaselineState: "absent",
      serviceBaselinePercentage: 0,
      requireCanonicalActivationEvidence: true,
    },
    accountingAndProductionExclusionOwnerRole:
      "targetCandidateVersionId",
    activationTiming: "after-successor-before-final-preservation-proof",
  },
  storage: {
    runsRelativeDirectory:
      HISTORICAL_FRESH_0016_CUTOVER_RUNS_RELATIVE_DIRECTORY,
    canonicalCompleteRelativePath:
      HISTORICAL_FRESH_0016_CUTOVER_COMPLETE_RELATIVE_PATH,
    runDirectoryMode: 0o700,
    evidenceFileMode: 0o600,
    maximumResumeLeasesPerStage: 8,
  },
  predecessor: {
    boundary: "before-runtime-migration-0016",
    protectedDatasets: HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
    excludedOperationalDatasets:
      HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES,
    logicalSnapshotRowsRead:
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
    logicalRowsReadLimit:
      HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
    maximumAutomaticReadAttempts:
      HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
    billableRowsReadReservation:
      HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    targetFinalUtcDayWindowMs:
      HISTORICAL_FRESH_0016_CUTOVER_PRE_RESET_WINDOW_MS,
  },
  runtimeMigration0017Prerequisite: {
    timing: "same-utc-day-read-only-predecessor-runtime-gate",
    releaseState: "deferred-free-plan",
    reason:
      "production-user-cardinality-exceeds-free-plan-index-write-envelope",
    runtimePath:
      "users-email-unique-exact-lookup-with-bounded-casefold-fallback",
    requiredStateBeforeApply: {
      "0013": "applied",
      "0014": "applied",
      "0015": "applied",
      "0016": "absent",
      "0017": "absent",
    },
    requiredStateAtPredecessorLiveGate: {
      "0013": "applied",
      "0014": "applied",
      "0015": "applied",
      "0016": "absent",
      "0017": "absent-deferred-free-plan",
    },
    durableEvidence:
      "source-bound-read-only-absence-verification",
    mutationAfterPredecessorPermitted: false,
    writeAttemptPermittedInFreePlanRelease: false,
    day2ReadOnlyRefreshBillableRowsRead:
      RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ,
  },
  migration0016: {
    migrationId: "0016",
    requiredStateBefore: {
      "0013": "applied",
      "0014": "applied",
      "0015": "applied",
      "0016": "absent",
    },
    trackedFile: migration0016File,
    fixedCompletionMarker: {
      key: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
      value: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
    },
    freshCutoverMarkerKey: HISTORICAL_FRESH_0016_CUTOVER_MARKER_KEY,
    markerWritePolicy: "insert-only-in-same-transaction",
    renderedAppendedStatementCount: 1,
    freshMarkerBudget: {
      rowsRead: RUNTIME_MIGRATION_FRESH_0016_MARKER_ROWS_READ,
      rowsWritten: RUNTIME_MIGRATION_FRESH_0016_MARKER_ROWS_WRITTEN,
    },
    alreadyAppliedAdmissionPermitted: false,
  },
  successor: {
    boundary: "after-runtime-migration-0016-before-worker-activation",
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    logicalSnapshotRowsRead: HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
    logicalRowsReadLimit: HISTORICAL_BILLED_READ_LIMIT,
    maximumAutomaticReadAttempts:
      HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
    billableRowsReadReservation:
      HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    cleanupOutboxRowsRequired: 0,
    maximumPredecessorToSuccessorGapMs:
      HISTORICAL_FRESH_0016_CUTOVER_MAXIMUM_GAP_MS,
    targetPredecessorToSuccessorGapMs:
      HISTORICAL_FRESH_0016_CUTOVER_TARGET_GAP_MS,
    targetFirstNextUtcDayWindowMs:
      HISTORICAL_FRESH_0016_CUTOVER_POST_RESET_WINDOW_MS,
  },
  day2Budget: {
    accounting: "one-preauthorized-aggregate-with-state-bound-children",
    aggregateRowsRead: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
    aggregateRowsWritten:
      HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
    maximumObservedUsageAtAdmission: {
      rowsRead: HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_READ_LIMIT,
      rowsWritten:
        HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_WRITTEN_LIMIT,
    },
    allocations: {
      migrationProjectionRowsRead:
        HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT,
      migrationApplyBillableRowsRead:
        HISTORICAL_FRESH_0016_DAY2_APPLY_BILLABLE_ROWS_READ,
      preservationBranchRowsRead:
        HISTORICAL_FRESH_0016_DAY2_PRESERVATION_BRANCH_ROWS_READ,
      standaloneRuntimeVerificationBillableRowsRead:
        RUNTIME_MIGRATION_VERIFICATION_BILLABLE_ROWS_READ_LIMIT,
      runtimeMigration0017VerificationBillableRowsRead:
        RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ,
      productionLockRowsRead:
        HISTORICAL_FRESH_0016_DAY2_LOCK_ROWS_READ_ALLOWANCE,
      productionLockRowsWritten:
        HISTORICAL_FRESH_0016_DAY2_LOCK_ROWS_WRITTEN_ALLOWANCE,
      postdeployAuthorizationRowsRead:
        HISTORICAL_FRESH_0016_DAY2_POSTDEPLOY_AUTH_ROWS_READ_ALLOWANCE,
      postdeployAuthorizationRowsWritten:
        HISTORICAL_FRESH_0016_DAY2_POSTDEPLOY_AUTH_ROWS_WRITTEN_ALLOWANCE,
    },
    childAccounting: "exclude-from-ledger-totals-and-bind-to-live-parent-maximum",
    refinement: "only-after-final-preservation-proof-retain-maximum-on-ambiguity",
    topicAndTranslationMutationTiming: "completed-before-predecessor",
  },
  proof: {
    protectedDatasetCount: HISTORICAL_PROTECTED_DATASET_COUNT,
    requireSameHmacKey: true,
    requireNondecreasingCounts: true,
    requireAllPredecessorColumns: true,
    requireAllPredecessorSentinels: true,
    requireFreshDatabaseMarker: true,
    requireEmptyNewOperationalOutbox: true,
    legacyLostKeyIntervalProven: false,
  },
} as const;

if (
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.predecessor.protectedDatasets.length !==
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.proof.protectedDatasetCount ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.predecessor.logicalSnapshotRowsRead >
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.predecessor.logicalRowsReadLimit ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.predecessor.billableRowsReadReservation !==
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.predecessor.logicalRowsReadLimit *
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.predecessor
        .maximumAutomaticReadAttempts ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.logicalSnapshotRowsRead >
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.logicalRowsReadLimit ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.billableRowsReadReservation !==
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.logicalRowsReadLimit *
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor
        .maximumAutomaticReadAttempts ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.legacyInterval
    .retroactiveContinuityClaimPermitted !== false ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.phase !==
    "uploaded-inactive" ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.preactivationTopology
    .soleServingPercentage !== 100 ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.preactivationTopology
    .targetCandidatePercentage !== 0 ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.finalVerificationTopology
    .soleServingRole !== "targetCandidateVersionId" ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.finalVerificationTopology
    .soleServingPercentage !== 100 ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.finalVerificationTopology
    .observedServingVersions !== 1 ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.finalVerificationTopology
    .serviceBaselineState !== "absent" ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.finalVerificationTopology
    .serviceBaselinePercentage !== 0 ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.finalVerificationTopology
    .requireCanonicalActivationEvidence !== true ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.workerRelease.activationTiming !==
    "after-successor-before-final-preservation-proof"
) {
  throw new Error("Fresh 0016 cutover policy is internally inconsistent.");
}

const day2AllocatedRowsRead =
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT +
  HISTORICAL_FRESH_0016_DAY2_APPLY_BILLABLE_ROWS_READ +
  HISTORICAL_FRESH_0016_DAY2_PRESERVATION_BRANCH_ROWS_READ +
  RUNTIME_MIGRATION_VERIFICATION_BILLABLE_ROWS_READ_LIMIT +
  RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ +
  HISTORICAL_FRESH_0016_DAY2_LOCK_ROWS_READ_ALLOWANCE +
  HISTORICAL_FRESH_0016_DAY2_POSTDEPLOY_AUTH_ROWS_READ_ALLOWANCE;
if (
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT !==
    804_744 ||
  day2AllocatedRowsRead !==
    HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ ||
  HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ +
      HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_READ_LIMIT !==
    D1_FREE_SAFE_ROWS_READ_LIMIT ||
  HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN +
      HISTORICAL_FRESH_0016_DAY2_OBSERVED_ROWS_WRITTEN_LIMIT >
    D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
) {
  throw new Error("Fresh 0016 Day-2 aggregate budget arithmetic is inconsistent.");
}

export type HistoricalFresh0016CutoverPolicy =
  typeof HISTORICAL_FRESH_0016_CUTOVER_POLICY;

export const HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256 = createHash()
  .update(stableStringify(HISTORICAL_FRESH_0016_CUTOVER_POLICY))
  .digest("hex");
