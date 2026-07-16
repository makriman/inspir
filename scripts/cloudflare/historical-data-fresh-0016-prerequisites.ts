import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  d1ReleaseBudgetLedgerPath,
  readPrivateJsonNoFollow,
  reserveD1ReleaseBudget,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  D1_RUNTIME_0016_ABSENT_CHECK_IDS,
  D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS,
  D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ,
  D1_RUNTIME_PRE_0016_VERIFICATION_BILLABLE_ROWS_READ,
  verifyD1RuntimePre0016State,
  type D1RuntimePre0016StateProof,
} from "./d1-runtime-pre-0016-state";
import {
  D1_RUNTIME_MIGRATION_0017_OUTCOME_KIND,
  D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND,
  runtimeMigration0017ApplyVerificationPath,
  runtimeMigration0017OutcomePath,
  runtimeMigration0017WriteAttemptPath,
} from "./apply-d1-runtime-migration-0017";
import {
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
  RUNTIME_MIGRATION_0017_FILE,
  RUNTIME_MIGRATION_0017_OPERATION_ID,
  RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ,
} from "./check-d1-runtime-migration-0017-budget";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  stableStringify,
  type WranglerRunner,
} from "./migration-config";
import {
  parseStoredProductionValidationLockOwner,
} from "./production-validation-lock";
import {
  stagedTranslationReconciliationBindingFromAttestation,
  topicAttestationPath,
  translationAttestationPath,
} from "./release-sequence-attestations";
import {
  CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
  STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND,
  loadStagedTranslationFallbackD1SiteCorpus,
} from "../staged-translation-fallback-release-attestation";
import {
  RUNTIME_MIGRATION_0017_CHECK_ID,
  RUNTIME_MIGRATION_0017_EVIDENCE_KIND,
  RUNTIME_MIGRATION_0017_VERIFICATION_LOGICAL_ROWS_READ_LIMIT,
  verifyD1RuntimeMigration0017,
  type RuntimeMigration0017VerificationReport,
} from "./verify-d1-runtime-migration-0017";
import {
  RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT,
} from "./verify-d1-runtime-migrations";
import {
  assertHistoricalFresh0016LiveTopologyEvidence,
  createHistoricalFresh0016LiveTopologyEvidence,
  historicalFresh0016LiveTopologyEvidenceSchema,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

export const HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_KIND =
  "inspir-historical-data-fresh-0016-predecessor-prerequisites-v3" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_KIND =
  "inspir-historical-data-fresh-0016-predecessor-runtime-gate-v2" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_OPERATION =
  "Fresh-0016 predecessor live runtime-state gate" as const;
export const HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ =
  D1_RUNTIME_PRE_0016_VERIFICATION_BILLABLE_ROWS_READ +
  RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const gitObjectSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const workerVersionSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);
const positiveIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const nonnegativeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a nonnegative safe integer.",
);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical timestamp.");
const sourceIdentitySchema = z.object({
  sourceFingerprintSha256: sha256Schema,
  sourceFingerprintFileCount: positiveIntegerSchema,
  workerSourceSha256: sha256Schema,
  wranglerConfigSha256: sha256Schema,
  assetManifestSha256: sha256Schema,
  assetManifestFileCount: positiveIntegerSchema,
  assetManifestBytes: positiveIntegerSchema,
}).strict();
const uploadedInactiveWorkerReleaseSchema = z.object({
  phase: z.literal("uploaded-inactive"),
  targetCandidateVersionId: workerVersionSchema,
  serviceBaselineVersionId: workerVersionSchema,
  uploadEvidenceSha256: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.targetCandidateVersionId === value.serviceBaselineVersionId) {
    context.addIssue({
      code: "custom",
      message: "The fresh-0016 target candidate must differ from the serving baseline.",
    });
  }
});
const releaseIdentitySchema = z.object({
  targetCandidateVersionId: workerVersionSchema,
  serviceBaselineVersionId: workerVersionSchema,
  uploadEvidenceSha256: sha256Schema,
  git: z.object({
    head: gitObjectSchema,
    upstream: gitObjectSchema,
    upstreamRef: z.string().min(1).max(2_048),
  }).strict(),
  artifactEvidence: sourceIdentitySchema,
}).strict();
const topicAttestationSchema = z.object({
  kind: z.literal("production-topic-reconciliation-v1"),
  createdAt: canonicalTimestampSchema,
  backupDir: z.string().min(1).max(4_096),
  status: z.literal("reconciled"),
  ok: z.literal(true),
  release: releaseIdentitySchema,
  vectorizeReadinessCreatedAt: canonicalTimestampSchema,
  topic: z.object({
    seedSha256: sha256Schema,
    verifiedTopics: positiveIntegerSchema,
    verifiedArchivedTopics: nonnegativeIntegerSchema,
  }).strict(),
}).strict();
const fullTranslationAttestationSchema = z.object({
  kind: z.literal("production-translation-reconciliation-v1"),
  createdAt: canonicalTimestampSchema,
  backupDir: z.string().min(1).max(4_096),
  status: z.literal("reconciled"),
  ok: z.literal(true),
  release: releaseIdentitySchema,
  vectorizeReadinessCreatedAt: canonicalTimestampSchema,
  topicReconciliationCreatedAt: canonicalTimestampSchema,
  method: z.enum(["read-only-drift", "atomic-repair"]),
  verification: z.object({
    remoteQueries: positiveIntegerSchema,
    billedRowsRead: nonnegativeIntegerSchema,
    repairApplied: z.boolean(),
  }).strict(),
}).strict();
const stagedTranslationCommonBindingSchema = z.object({
  releaseMode: z.literal("staged-canonical-English-fallback"),
  artifactFileSha256: sha256Schema,
  attestationSha256: sha256Schema,
  sourceManifestFileSha256: sha256Schema,
  sourceCatalogRootSha256: sha256Schema,
  availabilityManifestFileSha256: sha256Schema,
  availabilityLogicalSha256: sha256Schema,
  availabilityNamespaceEntries: nonnegativeIntegerSchema,
  localizedHtmlPaths: nonnegativeIntegerSchema,
  localizedHtmlPathsSha256: sha256Schema,
  curatedSiteTreeSha256: sha256Schema,
  staticMainAppTreeSha256: sha256Schema,
  targetSetSha256: sha256Schema,
  cleanTargetSetSha256: sha256Schema,
  pendingLedgerSha256: sha256Schema,
  pendingEntries: nonnegativeIntegerSchema,
  pendingMissing: nonnegativeIntegerSchema,
  pendingStale: nonnegativeIntegerSchema,
  fallbackPolicySha256: sha256Schema,
  d1Corpus: z.object({
    siteRows: positiveIntegerSchema,
    mainAppRows: positiveIntegerSchema,
    exactRows: positiveIntegerSchema,
    rowSetSha256: sha256Schema,
    payloadCorpusSha256: sha256Schema,
    cutoverPolicy: z.literal(
      "preserve-serving-baseline-until-candidate-active-cleanup",
    ),
    preActivationMutationAllowed: z.literal(false),
    postActivationExactCleanupRequired: z.literal(true),
  }).strict(),
}).strict();
const stagedTranslationBindingSchema = z.discriminatedUnion(
  "sitePromotionMode",
  [
    stagedTranslationCommonBindingSchema.extend({
      sitePromotionMode: z.literal("none-current-availability"),
      attestationKind: z.literal(
        CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
      ),
    }).strict(),
    stagedTranslationCommonBindingSchema.extend({
      sitePromotionMode: z.literal("afrikaans-finalized"),
      attestationKind: z.literal(
        STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND,
      ),
      afrikaansProofSha256: sha256Schema,
      afrikaansAuditManifestSha256: sha256Schema,
      afrikaansSemanticEvidenceSha256: sha256Schema,
      afrikaansPromotionTransactionId: sha256Schema,
      afrikaansJournalBindingSha256: sha256Schema,
      afrikaansPostSiteTreeSha256: sha256Schema,
    }).strict(),
  ],
).superRefine((value, context) => {
  if (
    value.d1Corpus.exactRows !==
      value.d1Corpus.siteRows + value.d1Corpus.mainAppRows ||
    value.pendingEntries !== value.pendingMissing + value.pendingStale
  ) {
    context.addIssue({
      code: "custom",
      message: "Staged translation D1 row accounting is inconsistent.",
    });
  }
});
const stagedTranslationAttestationSchema =
  fullTranslationAttestationSchema.omit({
    kind: true,
    method: true,
    verification: true,
  }).extend({
    kind: z.literal("production-staged-translation-reconciliation-v1"),
    method: z.literal("read-only-drift"),
    verification: z.object({
      remoteQueries: positiveIntegerSchema,
      billedRowsRead: nonnegativeIntegerSchema,
      repairApplied: z.literal(false),
    }).strict(),
    stagedRelease: stagedTranslationBindingSchema,
    pendingEvidenceSha256: sha256Schema,
  }).strict();
const translationAttestationSchema = z.union([
  fullTranslationAttestationSchema,
  stagedTranslationAttestationSchema,
]);

const runtimeStateGateSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_KIND),
  schemaVersion: z.literal(2),
  timing: z.literal(
    "live-before-hmac-run-predecessor-ledger-and-snapshot",
  ),
  predecessorUtcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operationId: z.string().regex(
    /^historical-fresh-0016-predecessor-runtime-gate:[a-f0-9]{64}$/,
  ),
  sourceFingerprint: z.object({
    sha256: sha256Schema,
    fileCount: positiveIntegerSchema,
  }).strict(),
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  liveTopology: historicalFresh0016LiveTopologyEvidenceSchema,
  maximum: z.object({
    rowsRead: z.literal(
      HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
    ),
    rowsWritten: z.literal(0),
  }).strict(),
  exactState: z.object({
    migrations0013To0015: z.literal("applied"),
    migration0016: z.literal("absent"),
    migration0017: z.literal("applied"),
    appliedStaticCheckCount: z.literal(
      D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.length,
    ),
    absent0016StaticCheckCount: z.literal(
      D1_RUNTIME_0016_ABSENT_CHECK_IDS.length,
    ),
  }).strict(),
  accounting: z.literal(
    "dedicated-top-level-maximum-reserved-before-live-read-only-queries",
  ),
}).strict().superRefine((value, context) => {
  if (
    stableStringify(value.liveTopology.workerRelease) !==
      stableStringify(value.workerRelease)
  ) {
    context.addIssue({
      code: "custom",
      message: "The runtime gate live topology drifted from its Worker release.",
    });
  }
});

export type HistoricalFresh0016PredecessorRuntimeGate = z.infer<
  typeof runtimeStateGateSchema
>;

export const historicalFresh0016PredecessorPrerequisitesSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_KIND),
  schemaVersion: z.literal(3),
  timing: z.literal("completed-on-earlier-utc-day-before-predecessor"),
  predecessorUtcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceFingerprint: z.object({
    sha256: sha256Schema,
    fileCount: positiveIntegerSchema,
  }).strict(),
  workerRelease: uploadedInactiveWorkerReleaseSchema,
  releaseIdentitySha256: sha256Schema,
  topic: z.object({
    createdAt: canonicalTimestampSchema,
    evidenceSha256: sha256Schema,
    seedSha256: sha256Schema,
    verifiedTopics: positiveIntegerSchema,
    verifiedArchivedTopics: nonnegativeIntegerSchema,
  }).strict(),
  translation: z.union([z.object({
    createdAt: canonicalTimestampSchema,
    evidenceSha256: sha256Schema,
    method: z.enum(["read-only-drift", "atomic-repair"]),
    remoteQueries: positiveIntegerSchema,
    billedRowsRead: nonnegativeIntegerSchema,
    repairApplied: z.boolean(),
  }).strict(), z.object({
    createdAt: canonicalTimestampSchema,
    evidenceSha256: sha256Schema,
    method: z.enum(["read-only-drift", "atomic-repair"]),
    remoteQueries: positiveIntegerSchema,
    billedRowsRead: nonnegativeIntegerSchema,
    repairApplied: z.boolean(),
    releaseMode: z.literal("staged-canonical-English-fallback"),
    stagedReleaseEvidenceSha256: sha256Schema,
    exactD1Rows: positiveIntegerSchema,
    exactD1RowSetSha256: sha256Schema,
    exactD1PayloadCorpusSha256: sha256Schema,
    cutoverPolicy: z.literal(
      "preserve-serving-baseline-until-candidate-active-cleanup",
    ),
    preActivationMutationAllowed: z.literal(false),
    postActivationExactCleanupRequired: z.literal(true),
  }).strict()]),
  runtimeMigration0017: z.object({
    utcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    appliedAt: canonicalTimestampSchema,
    verifiedAt: canonicalTimestampSchema,
    outcomeEvidenceSha256: sha256Schema,
    writeAttemptEvidenceSha256: sha256Schema,
    verificationEvidenceSha256: sha256Schema,
    pre0016RuntimeStateProofSha256: sha256Schema,
    operationId: z.literal(RUNTIME_MIGRATION_0017_OPERATION_ID),
    reservedRowsRead: z.literal(RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ),
    reservedRowsWritten: z.literal(
      RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
    ),
    state: z.literal("applied"),
  }).strict(),
  liveRuntimeState: runtimeStateGateSchema,
  mutationRule: z.literal(
    "no-topic-translation-or-0017-mutation-from-predecessor-through-final-verifier",
  ),
  privacy: z.literal("release-identities-and-aggregate-counts-only"),
}).strict().superRefine((value, context) => {
  if (
    value.topic.createdAt.slice(0, 10) >= value.predecessorUtcDay ||
    value.translation.createdAt.slice(0, 10) >= value.predecessorUtcDay ||
    value.runtimeMigration0017.utcDay >= value.predecessorUtcDay ||
    value.runtimeMigration0017.appliedAt.slice(0, 10) !==
      value.runtimeMigration0017.utcDay ||
    value.runtimeMigration0017.verifiedAt.slice(0, 10) !==
      value.runtimeMigration0017.utcDay ||
    value.liveRuntimeState.predecessorUtcDay !== value.predecessorUtcDay ||
    value.liveRuntimeState.sourceFingerprint.sha256 !==
      value.sourceFingerprint.sha256 ||
    value.liveRuntimeState.sourceFingerprint.fileCount !==
      value.sourceFingerprint.fileCount ||
    stableStringify(value.liveRuntimeState.workerRelease) !==
      stableStringify(value.workerRelease) ||
    Date.parse(value.topic.createdAt) > Date.parse(value.translation.createdAt) ||
    value.translation.repairApplied !==
      (value.translation.method === "atomic-repair")
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Fresh-0016 predecessor prerequisites are not an earlier-day ordered topic/translation/0017 proof with a same-day live state gate.",
    });
  }
});

export type HistoricalFresh0016PredecessorPrerequisites = z.infer<
  typeof historicalFresh0016PredecessorPrerequisitesSchema
>;

export function verifyHistoricalFresh0016PredecessorRuntimeGate(
  input: Readonly<{
    backupDirectory: string;
    cwd: string;
    sourceFingerprint: D1ReleaseSourceIdentity;
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
    liveDeploymentStatusOutput: string;
    liveTopologyObservedAt: Date;
    predecessorStartAt: Date;
    runner: WranglerRunner;
    clock?: () => Date;
    usageLoader?: (
      now: Date,
      runner: WranglerRunner,
      clock: () => Date,
    ) => D1DailyUsage;
    reserveBudget?: typeof reserveD1ReleaseBudget;
    pre0016StateVerifier?: typeof verifyD1RuntimePre0016State;
    migration0017Verifier?: typeof verifyD1RuntimeMigration0017;
  }>,
): HistoricalFresh0016PredecessorRuntimeGate {
  const predecessorStartAt = validDate(input.predecessorStartAt);
  const predecessorUtcDay = predecessorStartAt.toISOString().slice(0, 10);
  const backupDirectory = path.resolve(input.backupDirectory);
  const cwd = path.resolve(input.cwd);
  const clock = input.clock ?? (() => new Date());
  const workerRelease = requireUploadedInactiveWorkerRelease({
    backupDirectory,
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
  const liveTopology = assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: createHistoricalFresh0016LiveTopologyEvidence({
      observedAt: input.liveTopologyObservedAt,
      statusOutput: input.liveDeploymentStatusOutput,
      ...workerRelease,
    }),
    boundaryAt: predecessorStartAt,
    statusOutput: input.liveDeploymentStatusOutput,
    ...workerRelease,
  });
  assertLiveTopologyPostdatesUpload(backupDirectory, liveTopology.observedAt);
  const operationId = predecessorRuntimeGateOperationId({
    predecessorUtcDay,
    sourceFingerprint: input.sourceFingerprint,
    workerRelease,
    liveTopology,
  });
  const usage = (input.usageLoader ?? loadAccountD1DailyUsage)(
    predecessorStartAt,
    input.runner,
    clock,
  );
  const reservation = (input.reserveBudget ?? reserveD1ReleaseBudget)({
    backupDir: backupDirectory,
    operationId,
    operation: HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_OPERATION,
    sourceFingerprint: input.sourceFingerprint,
    candidateVersionId: workerRelease.targetCandidateVersionId,
    phase: "maximum",
    rowsRead:
      HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
    rowsWritten: 0,
    observedUsage: usage,
    now: predecessorStartAt,
    expectedUtcDay: predecessorUtcDay,
  });
  if (
    reservation.utcDay !== predecessorUtcDay ||
    reservation.reservation.operationId !== operationId ||
    reservation.reservation.candidateVersionId !==
      workerRelease.targetCandidateVersionId ||
    reservation.reservation.phase !== "maximum" ||
    reservation.reservation.rowsRead !==
      HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ ||
    reservation.reservation.rowsWritten !== 0
  ) {
    throw new Error(
      "Fresh-0016 predecessor live runtime gate did not retain its dedicated maximum reservation.",
    );
  }
  const pre0016 = (input.pre0016StateVerifier ??
    verifyD1RuntimePre0016State)({
      backupDir: backupDirectory,
      cwd,
      nowMs: predecessorStartAt.getTime(),
      runner: input.runner,
    });
  assertPre0016Proof(pre0016, input.sourceFingerprint);
  const migration0017 = (input.migration0017Verifier ??
    verifyD1RuntimeMigration0017)({
      backupDir: backupDirectory,
      cwd,
      nowMs: predecessorStartAt.getTime(),
      runner: input.runner,
    });
  assertApplied0017Report(migration0017, input.sourceFingerprint);
  const completedAt = validDate(clock());
  if (completedAt.toISOString().slice(0, 10) !== predecessorUtcDay) {
    throw new Error(
      "Fresh-0016 predecessor live runtime-state gate crossed its UTC billing day.",
    );
  }
  return buildRuntimeGateProof({
    predecessorUtcDay,
    sourceFingerprint: input.sourceFingerprint,
    workerRelease,
    liveTopology,
  });
}

function buildRuntimeGateProof(input: Readonly<{
  predecessorUtcDay: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  workerRelease: z.infer<typeof uploadedInactiveWorkerReleaseSchema>;
  liveTopology: z.infer<typeof historicalFresh0016LiveTopologyEvidenceSchema>;
}>) {
  return runtimeStateGateSchema.parse({
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_KIND,
    schemaVersion: 2,
    timing: "live-before-hmac-run-predecessor-ledger-and-snapshot",
    predecessorUtcDay: input.predecessorUtcDay,
    operationId: predecessorRuntimeGateOperationId(input),
    sourceFingerprint: input.sourceFingerprint,
    workerRelease: input.workerRelease,
    liveTopology: input.liveTopology,
    maximum: {
      rowsRead:
        HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
      rowsWritten: 0,
    },
    exactState: {
      migrations0013To0015: "applied",
      migration0016: "absent",
      migration0017: "applied",
      appliedStaticCheckCount:
        D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.length,
      absent0016StaticCheckCount: D1_RUNTIME_0016_ABSENT_CHECK_IDS.length,
    },
    accounting:
      "dedicated-top-level-maximum-reserved-before-live-read-only-queries",
  });
}

export function readHistoricalFresh0016PredecessorPrerequisites(input: Readonly<{
  backupDirectory: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  predecessorStartAt: Date;
  liveRuntimeState: HistoricalFresh0016PredecessorRuntimeGate;
}>) {
  const predecessorStartAt = validDate(input.predecessorStartAt);
  const predecessorUtcDay = predecessorStartAt.toISOString().slice(0, 10);
  const backupDirectory = path.resolve(input.backupDirectory);
  const workerRelease = requireUploadedInactiveWorkerRelease({
    backupDirectory,
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
  const topic = topicAttestationSchema.parse(
    readPrivateJsonNoFollow(topicAttestationPath(backupDirectory), 64 * 1_024),
  );
  const translation = translationAttestationSchema.parse(
    readPrivateJsonNoFollow(
      translationAttestationPath(backupDirectory),
      64 * 1_024,
    ),
  );
  if (translation.kind === "production-staged-translation-reconciliation-v1") {
    const currentStagedCorpus =
      loadStagedTranslationFallbackD1SiteCorpus(process.cwd());
    const expectedBinding =
      stagedTranslationReconciliationBindingFromAttestation({
        attestation: currentStagedCorpus.attestation,
        d1Corpus: {
          siteRows: currentStagedCorpus.rows.length,
          mainAppRows: currentStagedCorpus.mainAppRows.length,
          exactRows:
            currentStagedCorpus.rows.length +
            currentStagedCorpus.mainAppRows.length,
          rowSetSha256: currentStagedCorpus.rowSetSha256,
          payloadCorpusSha256: currentStagedCorpus.payloadCorpusSha256,
        },
      });
    if (
      stableStringify(expectedBinding) !==
        stableStringify(translation.stagedRelease)
    ) {
      throw new Error(
        "Fresh-0016 predecessor staged translation evidence is stale for the current fallback release.",
      );
    }
  }
  const liveRuntimeState = runtimeStateGateSchema.parse(
    input.liveRuntimeState,
  );
  assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: liveRuntimeState.liveTopology,
    boundaryAt: predecessorStartAt,
    ...workerRelease,
  });
  assertLiveTopologyPostdatesUpload(
    backupDirectory,
    liveRuntimeState.liveTopology.observedAt,
  );
  const runtimeMigration0017 = readEarlierDayRuntimeMigration0017Evidence({
    backupDirectory,
    predecessorUtcDay,
    sourceFingerprint: input.sourceFingerprint,
    targetCandidateVersionId: workerRelease.targetCandidateVersionId,
  });
  const releaseIdentitySha256 = sha256(topic.release);
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
  );
  const expectedReleaseIdentity = {
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    git: upload.value.git,
    artifactEvidence: upload.value.artifacts,
  } as const;
  if (
    path.resolve(topic.backupDir) !== backupDirectory ||
    path.resolve(translation.backupDir) !== backupDirectory ||
    stableStringify(topic.release) !== stableStringify(translation.release) ||
    stableStringify(topic.release) !== stableStringify(expectedReleaseIdentity) ||
    topic.release.git.head !== topic.release.git.upstream ||
    topic.release.artifactEvidence.sourceFingerprintSha256 !==
      input.sourceFingerprint.sha256 ||
    topic.release.artifactEvidence.sourceFingerprintFileCount !==
      input.sourceFingerprint.fileCount ||
    translation.topicReconciliationCreatedAt !== topic.createdAt ||
    translation.verification.repairApplied !==
      (translation.method === "atomic-repair") ||
    liveRuntimeState.predecessorUtcDay !== predecessorUtcDay ||
    liveRuntimeState.sourceFingerprint.sha256 !==
      input.sourceFingerprint.sha256 ||
    liveRuntimeState.sourceFingerprint.fileCount !==
      input.sourceFingerprint.fileCount ||
    stableStringify(liveRuntimeState.workerRelease) !==
      stableStringify(workerRelease) ||
    liveRuntimeState.operationId !== predecessorRuntimeGateOperationId({
      predecessorUtcDay,
      sourceFingerprint: input.sourceFingerprint,
      workerRelease,
      liveTopology: liveRuntimeState.liveTopology,
    }) ||
    Date.parse(topic.vectorizeReadinessCreatedAt) > Date.parse(topic.createdAt) ||
    Date.parse(topic.createdAt) > Date.parse(translation.createdAt) ||
    topic.createdAt.slice(0, 10) >= predecessorUtcDay ||
    translation.createdAt.slice(0, 10) >= predecessorUtcDay
  ) {
    throw new Error(
      "Fresh-0016 predecessor requires source-bound earlier-day topic/translation/0017 evidence and a same-day exact live runtime gate.",
    );
  }
  return historicalFresh0016PredecessorPrerequisitesSchema.parse({
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_KIND,
    schemaVersion: 3,
    timing: "completed-on-earlier-utc-day-before-predecessor",
    predecessorUtcDay,
    sourceFingerprint: input.sourceFingerprint,
    workerRelease,
    releaseIdentitySha256,
    topic: {
      createdAt: topic.createdAt,
      evidenceSha256: sha256(topic),
      seedSha256: topic.topic.seedSha256,
      verifiedTopics: topic.topic.verifiedTopics,
      verifiedArchivedTopics: topic.topic.verifiedArchivedTopics,
    },
    translation: {
      createdAt: translation.createdAt,
      evidenceSha256: sha256(translation),
      method: translation.method,
      remoteQueries: translation.verification.remoteQueries,
      billedRowsRead: translation.verification.billedRowsRead,
      repairApplied: translation.verification.repairApplied,
      ...(translation.kind ===
      "production-staged-translation-reconciliation-v1"
        ? {
            releaseMode: translation.stagedRelease.releaseMode,
            stagedReleaseEvidenceSha256: sha256(
              translation.stagedRelease,
            ),
            exactD1Rows: translation.stagedRelease.d1Corpus.exactRows,
            exactD1RowSetSha256:
              translation.stagedRelease.d1Corpus.rowSetSha256,
            exactD1PayloadCorpusSha256:
              translation.stagedRelease.d1Corpus.payloadCorpusSha256,
            cutoverPolicy:
              translation.stagedRelease.d1Corpus.cutoverPolicy,
            preActivationMutationAllowed:
              translation.stagedRelease.d1Corpus.preActivationMutationAllowed,
            postActivationExactCleanupRequired:
              translation.stagedRelease.d1Corpus
                .postActivationExactCleanupRequired,
          }
        : {}),
    },
    runtimeMigration0017,
    liveRuntimeState,
    mutationRule:
      "no-topic-translation-or-0017-mutation-from-predecessor-through-final-verifier",
    privacy: "release-identities-and-aggregate-counts-only",
  });
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

function requireUploadedInactiveWorkerRelease(input: Readonly<{
  backupDirectory: string;
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>) {
  const workerRelease = uploadedInactiveWorkerReleaseSchema.parse({
    phase: "uploaded-inactive",
    targetCandidateVersionId: input.targetCandidateVersionId,
    serviceBaselineVersionId: input.serviceBaselineVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
  });
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(input.backupDirectory),
  );
  if (
    upload.sha256 !== workerRelease.uploadEvidenceSha256 ||
    upload.value.targetCandidateVersionId !==
      workerRelease.targetCandidateVersionId ||
    upload.value.serviceBaselineVersionId !==
      workerRelease.serviceBaselineVersionId ||
    upload.value.soleBaselineTopology.serviceBaselineVersionId !==
      workerRelease.serviceBaselineVersionId ||
    upload.value.soleBaselineTopology.percentage !== 100 ||
    upload.value.soleBaselineTopology.observedVersions !== 1
  ) {
    throw new Error(
      "Fresh-0016 predecessor requires the exact inactive upload evidence while the baseline remains the sole 100% serving Worker.",
    );
  }
  return workerRelease;
}

function assertLiveTopologyPostdatesUpload(
  backupDirectory: string,
  observedAt: string,
) {
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
  );
  if (Date.parse(observedAt) < Date.parse(upload.value.createdAt)) {
    throw new Error(
      "Fresh-0016 predecessor live topology cannot predate candidate upload evidence.",
    );
  }
}

function readEarlierDayRuntimeMigration0017Evidence(input: Readonly<{
  backupDirectory: string;
  predecessorUtcDay: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  targetCandidateVersionId: string;
}>) {
  const outcomeValue = readPrivateJsonNoFollow(
    runtimeMigration0017OutcomePath(input.backupDirectory),
    2 * 1024 * 1024,
  );
  const markerValue = readPrivateJsonNoFollow(
    runtimeMigration0017WriteAttemptPath(input.backupDirectory),
    2 * 1024 * 1024,
  );
  const verificationValue = readPrivateJsonNoFollow(
    runtimeMigration0017ApplyVerificationPath(input.backupDirectory),
    2 * 1024 * 1024,
  );
  const outcome = requiredRecord(outcomeValue, "0017 apply outcome");
  const marker = requiredRecord(markerValue, "0017 write-attempt marker");
  const verification = requiredRecord(
    verificationValue,
    "0017 exact verification report",
  );
  const outcomeSource = requiredSourceIdentity(
    outcome.sourceFingerprint,
    "0017 outcome source",
  );
  const markerSource = requiredSourceIdentity(
    marker.sourceFingerprint,
    "0017 marker source",
  );
  const outcomeProof = requiredPre0016Proof(
    outcome.pre0016RuntimeStateProof,
    input.sourceFingerprint,
  );
  const markerProof = requiredPre0016Proof(
    marker.pre0016RuntimeStateProof,
    input.sourceFingerprint,
  );
  const outcomeCreatedAt = requiredTimestamp(
    outcome.createdAt,
    "0017 outcome timestamp",
  );
  const markerCreatedAt = requiredTimestamp(
    marker.createdAt,
    "0017 marker timestamp",
  );
  const verifiedAt = requiredTimestamp(
    verification.createdAt,
    "0017 verification timestamp",
  );
  const utcDay = requiredUtcDay(outcome.utcDay, "0017 outcome UTC day");
  const markerUtcDay = requiredUtcDay(marker.utcDay, "0017 marker UTC day");
  const outcomeDatabase = requiredRecord(outcome.database, "0017 outcome database");
  const markerDatabase = requiredRecord(marker.database, "0017 marker database");
  const markerLedger = requiredRecord(marker.ledger, "0017 marker ledger");
  const markerReservation = requiredRecord(
    markerLedger.reservation,
    "0017 marker reservation",
  );
  const owner = parseStoredProductionValidationLockOwner(
    marker.productionExclusionOwner,
  );
  const applyVerificationEvidencePath = path.resolve(
    requiredText(
      outcome.applyVerificationEvidencePath,
      "0017 immutable apply-verification path",
    ),
  );
  const applyVerificationEvidenceSha256 = requiredText(
    outcome.applyVerificationEvidenceSha256,
    "0017 immutable apply-verification SHA-256",
  );
  const outcomeBudgetReportPath = path.resolve(
    requiredText(outcome.budgetReportPath, "0017 outcome budget path"),
  );
  const markerBudgetReportPath = path.resolve(
    requiredText(marker.budgetReportPath, "0017 marker budget path"),
  );
  const outcomePreWriteEvidencePath = path.resolve(
    requiredText(outcome.preWriteEvidencePath, "0017 outcome prewrite path"),
  );
  const markerPreWriteEvidencePath = path.resolve(
    requiredText(marker.preWriteEvidencePath, "0017 marker prewrite path"),
  );
  if (
    outcome.kind !== D1_RUNTIME_MIGRATION_0017_OUTCOME_KIND ||
    outcome.schemaVersion !== 3 ||
    outcome.ok !== true ||
    (outcome.status !== "verified" &&
      outcome.status !== "verified-after-ambiguous-response") ||
    outcome.stateBefore !== "absent" ||
    outcome.stateAfter !== "applied" ||
    outcome.writeAttempted !== true ||
    outcome.responseConfirmed !== (outcome.status === "verified") ||
    outcome.recoveredByVerification !==
      (outcome.status === "verified-after-ambiguous-response") ||
    applyVerificationEvidencePath !==
      runtimeMigration0017ApplyVerificationPath(input.backupDirectory) ||
    !/^[a-f0-9]{64}$/.test(applyVerificationEvidenceSha256) ||
    applyVerificationEvidenceSha256 !== sha256(verificationValue) ||
    marker.kind !== D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND ||
    marker.schemaVersion !== 2 ||
    marker.operationId !== RUNTIME_MIGRATION_0017_OPERATION_ID ||
    marker.stateBefore !== "absent" ||
    marker.writeAttempted !== true ||
    marker.responseConfirmed !== false ||
    marker.automaticRetryPermitted !== false ||
    outcomeDatabase.id !== D1_DATABASE_ID ||
    outcomeDatabase.name !== D1_DATABASE_NAME ||
    markerDatabase.id !== D1_DATABASE_ID ||
    markerDatabase.name !== D1_DATABASE_NAME ||
    path.resolve(requiredText(outcome.backupDir, "0017 outcome backup")) !==
      input.backupDirectory ||
    path.resolve(requiredText(marker.backupDir, "0017 marker backup")) !==
      input.backupDirectory ||
    outcomeBudgetReportPath !== markerBudgetReportPath ||
    outcomePreWriteEvidencePath !== markerPreWriteEvidencePath ||
    !outcomeBudgetReportPath.startsWith(
      `${path.join(input.backupDirectory, "cloudflare")}${path.sep}`,
    ) ||
    !outcomePreWriteEvidencePath.startsWith(
      `${path.join(input.backupDirectory, "cloudflare")}${path.sep}`,
    ) ||
    outcomeSource.sha256 !== input.sourceFingerprint.sha256 ||
    outcomeSource.fileCount !== input.sourceFingerprint.fileCount ||
    markerSource.sha256 !== input.sourceFingerprint.sha256 ||
    markerSource.fileCount !== input.sourceFingerprint.fileCount ||
    stableStringify(outcomeProof) !== stableStringify(markerProof) ||
    markerUtcDay !== utcDay ||
    outcomeCreatedAt.slice(0, 10) !== utcDay ||
    markerCreatedAt.slice(0, 10) !== utcDay ||
    verifiedAt.slice(0, 10) !== utcDay ||
    Date.parse(markerCreatedAt) > Date.parse(outcomeCreatedAt) ||
    Date.parse(verifiedAt) > Date.parse(outcomeCreatedAt) ||
    utcDay >= input.predecessorUtcDay ||
    markerLedger.reservationRetainedAtMaximum !== true ||
    path.resolve(requiredText(markerLedger.path, "0017 marker ledger path")) !==
      d1ReleaseBudgetLedgerPath(input.backupDirectory, utcDay) ||
    markerReservation.operationId !== RUNTIME_MIGRATION_0017_OPERATION_ID ||
    markerReservation.accountingParentOperationId !== null ||
    markerReservation.phase !== "maximum" ||
    markerReservation.candidateVersionId !== input.targetCandidateVersionId ||
    markerReservation.rowsRead !== RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ ||
    markerReservation.rowsWritten !==
      RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN ||
    markerReservation.maximumRowsRead !==
      RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ ||
    markerReservation.maximumRowsWritten !==
      RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN ||
    owner.candidateVersionId !== input.targetCandidateVersionId ||
    owner.sourceFingerprintSha256 !== input.sourceFingerprint.sha256
  ) {
    throw new Error(
      "Fresh-0016 predecessor rejected the source-bound earlier-day 0017 apply/write fence.",
    );
  }
  assertApplied0017EvidenceRecord(verification, input);
  return Object.freeze({
    utcDay,
    appliedAt: outcomeCreatedAt,
    verifiedAt,
    outcomeEvidenceSha256: sha256(outcomeValue),
    writeAttemptEvidenceSha256: sha256(markerValue),
    verificationEvidenceSha256: sha256(verificationValue),
    pre0016RuntimeStateProofSha256: sha256(outcomeProof),
    operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
    reservedRowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
    reservedRowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
    state: "applied" as const,
  });
}

function assertApplied0017EvidenceRecord(
  report: Record<string, unknown>,
  input: Readonly<{
    backupDirectory: string;
    sourceFingerprint: D1ReleaseSourceIdentity;
  }>,
) {
  const before = requiredSourceIdentity(
    report.sourceFingerprintBefore,
    "0017 verification initial source",
  );
  const after = requiredSourceIdentity(
    report.sourceFingerprint,
    "0017 verification source",
  );
  const checks = report.checks;
  const check = Array.isArray(checks) && checks.length === 1
    ? requiredRecord(checks[0], "0017 verification check")
    : null;
  const detail = check
    ? requiredRecord(check.detail, "0017 verification detail")
    : null;
  if (
    report.kind !== RUNTIME_MIGRATION_0017_EVIDENCE_KIND ||
    report.schemaVersion !== 1 ||
    report.database !== D1_DATABASE_NAME ||
    report.migration !== RUNTIME_MIGRATION_0017_FILE ||
    path.resolve(requiredText(report.backupDir, "0017 verification backup")) !==
      input.backupDirectory ||
    report.ok !== true ||
    report.state !== "applied" ||
    report.sourceFingerprintStable !== true ||
    before.sha256 !== input.sourceFingerprint.sha256 ||
    before.fileCount !== input.sourceFingerprint.fileCount ||
    after.sha256 !== input.sourceFingerprint.sha256 ||
    after.fileCount !== input.sourceFingerprint.fileCount ||
    typeof report.rowsRead !== "number" ||
    !Number.isSafeInteger(report.rowsRead) ||
    report.rowsRead < 0 ||
    report.rowsRead > RUNTIME_MIGRATION_0017_VERIFICATION_LOGICAL_ROWS_READ_LIMIT ||
    report.rowsWritten !== 0 ||
    report.totalAttempts !== 1 ||
    check?.id !== RUNTIME_MIGRATION_0017_CHECK_ID ||
    check.ok !== true ||
    detail?.state !== "applied" ||
    detail.schemaRows !== 1 ||
    detail.catalogRows !== 1 ||
    detail.keyRows !== 3 ||
    detail.tableMatches !== true ||
    detail.sqlMatches !== true ||
    detail.catalogMatches !== true ||
    detail.keySequenceMatches !== true
  ) {
    throw new Error(
      "Fresh-0016 predecessor requires an exact source-bound read-only applied-0017 report.",
    );
  }
}

function assertApplied0017Report(
  report: RuntimeMigration0017VerificationReport,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  assertApplied0017EvidenceRecord(report, {
    backupDirectory: path.resolve(report.backupDir),
    sourceFingerprint,
  });
}

function requiredPre0016Proof(
  value: unknown,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  const proof = requiredRecord(value, "pre-0016 runtime-state proof");
  const source = requiredSourceIdentity(
    proof.sourceFingerprint,
    "pre-0016 proof source",
  );
  if (
    proof.classification !== "exact-pre-0016" ||
    source.sha256 !== sourceFingerprint.sha256 ||
    source.fileCount !== sourceFingerprint.fileCount ||
    typeof proof.staticRowsRead !== "number" ||
    !Number.isSafeInteger(proof.staticRowsRead) ||
    proof.staticRowsRead < 0 ||
    proof.staticRowsRead > RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT ||
    typeof proof.probeRowsRead !== "number" ||
    !Number.isSafeInteger(proof.probeRowsRead) ||
    proof.probeRowsRead < 0 ||
    proof.probeRowsRead > D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ ||
    proof.staticTotalAttempts !== 1 ||
    proof.probeTotalAttempts !== 1 ||
    proof.appliedCheckCount !== D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.length ||
    proof.absentCheckCount !== D1_RUNTIME_0016_ABSENT_CHECK_IDS.length ||
    proof.schemaObjectsAbsent !== true ||
    proof.fixedMarkerAbsent !== true ||
    proof.freshMarkerAbsent !== true
  ) {
    throw new Error("The pre-0016 runtime-state proof is not exact or source-bound.");
  }
  return value;
}

function assertPre0016Proof(
  proof: D1RuntimePre0016StateProof,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  requiredPre0016Proof(proof, sourceFingerprint);
}

function predecessorRuntimeGateOperationId(input: Readonly<{
  predecessorUtcDay: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  workerRelease: z.infer<typeof uploadedInactiveWorkerReleaseSchema>;
  liveTopology: z.infer<typeof historicalFresh0016LiveTopologyEvidenceSchema>;
}>) {
  const identity = {
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_KIND,
    schemaVersion: 2,
    predecessorUtcDay: input.predecessorUtcDay,
    sourceFingerprint: input.sourceFingerprint,
    workerRelease: input.workerRelease,
    liveTopology: input.liveTopology,
  } as const;
  return `historical-fresh-0016-predecessor-runtime-gate:${sha256(identity)}`;
}

function requiredSourceIdentity(value: unknown, label: string) {
  const record = requiredRecord(value, label);
  const sha256 = requiredText(record.sha256, `${label} SHA-256`);
  const fileCount = record.fileCount;
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    typeof fileCount !== "number" ||
    !Number.isSafeInteger(fileCount) ||
    fileCount <= 0
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return { sha256, fileCount };
}

function requiredTimestamp(value: unknown, label: string) {
  const timestamp = requiredText(value, label);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${label} is not canonical.`);
  }
  return timestamp;
}

function requiredUtcDay(value: unknown, label: string) {
  const day = requiredText(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return day;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new Error(`${label} must be nonempty text.`);
  }
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validDate(value: Date) {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Fresh-0016 predecessor prerequisite clock is invalid.");
  }
  return new Date(value.getTime());
}
