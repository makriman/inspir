import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getCuratedMainAppTranslationBundle } from "@/lib/i18n/main-app-curated";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import { getSiteTranslationSource } from "@/lib/i18n/site-source";
import { siteTranslationNamespace } from "@/lib/i18n/site-source-constants";
import { validateTranslationCandidateField } from "@/lib/i18n/translation-candidate-quality";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import {
  isTranslationBundleCompleteAndFluent,
  isTranslationBundleFieldValid,
  isTranslationFieldLikelyFluent,
} from "@/lib/i18n/translation-quality";
import {
  LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH,
  LEGACY_MARKETING_SITE_GRANDFATHERED_ENTRY_MODELS,
  LEGACY_MARKETING_SITE_EXPECTED_SITE_ROW_COUNT,
  LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT,
  LEGACY_MARKETING_SITE_NAMESPACE,
  legacyMarketingSiteContract,
  legacyMarketingSiteTargetLanguages,
  validateLegacyMarketingSiteDatabaseRows,
  type LegacyMarketingSiteComposedCorpus,
  type LegacyMarketingSiteContract,
  type LegacyMarketingSiteDatabaseRow,
  type LegacyMarketingSiteTargetLanguage,
} from "@/lib/i18n/legacy-marketing-site-contract";
import {
  hasExactLongTailInvariantParity,
  protectLongTailSourceText,
} from "../generate-long-tail-translations";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
} from "../long-tail-nllb-execution-profile";
import { buildLegacyMarketingSiteComposedCorpusFromRepository } from
  "../run-legacy-marketing-site-delta-release";
import { assertCurrentSiteSourceManifestFreshness } from "../verify-site-source-manifest";
import {
  assertD1FreeDailyBudget,
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1FreeStorageAdmission,
  measureD1TranslationStorageRow,
  projectD1FreeStorageAdmission,
  readD1DatabaseStorageInfo,
  type D1DatabaseStorageInfo,
  type D1SourceStorageEntry,
  type D1StorageAdmissionProjection,
  type D1TranslationStorageRow,
} from "./d1-free-storage-admission";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  d1ReleaseBudgetLedgerPath,
  readD1ReleaseBudgetLedger,
  readPrivateJsonNoFollow,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  type D1ReleaseBudgetLedger,
  type D1ReleaseBudgetLedgerReservation,
  type D1ReleaseBudgetReservationResult,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  assertGitReleaseIdentity,
  type GitReleaseIdentity,
} from "./git-release-identity";
import { buildReleaseArtifactSafetyChecks } from "./release-artifact-safety";
import {
  assertReleaseSequenceCurrentReleaseBinding,
  assertProductionTopicReconciliationReleaseBinding,
  writeTranslationReconciliationPending,
  writeTranslationReconciliationSuccess,
  type ReleaseSequenceCurrentRelease,
  type TopicReconciliationAttestation,
} from "./release-sequence-attestations";
import {
  CLOUDFLARE_CLI_TIMEOUT_MS,
  cloudflareDir,
  D1_DATABASE_ID,
  commandEnv,
  D1_DATABASE_NAME,
  isValidD1TimeTravelBookmark,
  parseD1TimeTravelBookmark,
  resolveBackupDir,
  runWrangler,
  type RunCommandOptions,
  type WranglerRunner,
} from "./migration-config";
import {
  assertSameTemporarySqlFileAttestation,
  assertSourceSyncReadBudget,
  attestTemporarySqlFile,
  buildSiteTranslationSourceSyncPlan,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  planSiteTranslationSourceSync,
  removeAttestedTemporarySqlFile,
  TemporarySqlFileIntegrityError,
  writeTemporarySqlFile,
} from "./sync-site-translation-sources";
import {
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
  acquireProductionValidationExclusion,
  assertProductionValidationExclusionCommandWindow,
  assertNoLiveProductionValidationLock,
  attestProductionValidationExclusion,
  clearProductionMaintenanceState,
  createProductionMaintenanceState,
  readProductionMaintenanceState,
  releaseProductionValidationExclusion,
  type ProductionMaintenanceState,
  type ProductionValidationExclusion,
  type ProductionValidationLockRunner,
} from "./production-validation-lock";
import type { SourceFingerprint } from "./source-fingerprint";
import {
  buildWorkerDeployArtifactEvidence,
  buildWorkerDeployArtifactManifest,
  type WorkerDeployArtifactEvidence,
  type WorkerDeployArtifactManifest,
} from "./worker-deploy-evidence";
import {
  assertFreshProductionVectorizeReadiness,
  type VectorizeReadinessCurrentRelease,
  type VectorizeReadinessReport,
} from "./vectorize-readiness-evidence";
import { runBoundedReleaseChildSync } from "./run-production-release-operation";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

const seedPath = path.resolve(
  process.cwd(),
  "scripts/translation-seeds/seo-cta-try-public-modes.json",
);
const repairSqlPath = path.resolve(
  process.cwd(),
  "scripts/cloudflare/seo-cta-translation-repair.sql",
);
const unresolvedRepairMarkerFile = "d1-translation-repair-unresolved.json";
const workerName = "inspirlearning";
const productionBaseUrl = "https://inspirlearning.com";
const workerVersionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const curatedRepairModel = "codex-curated-free-static-no-games-v7";
const mainAppRepairModel = "codex-curated-free-static-no-games-main-app-v1";
const longTailCandidateKind = "inspir-long-tail-translation-candidate-v1";
const longTailCuratedProvenanceKind = "inspir-long-tail-curated-provenance-v1";
const longTailPipelineVersion = LONG_TAIL_TRANSLATION_PIPELINE_VERSION;
const longTailExecutionProfileSha256 =
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256;
const longTailProtectorVersion = "inspir-long-tail-literal-protector-v1";
export const nativeWranglerDeployEnv = Object.freeze({
  // Wrangler detects open-next.config.ts even when invoked directly. This
  // marker tells the adapter that Wrangler is already performing the native
  // upload and prevents delegation to the retired OpenNext/R2 deploy path.
  OPEN_NEXT_DEPLOY: "true",
});
const curatedRoot = path.resolve(process.cwd(), "translations/curated");
const staticRepairNamespaces = ["marketing-site"] as const;
const staticRepairNamespaceNames = new Set<string>(staticRepairNamespaces);
const supportedLanguageNames = new Set<string>(supportedLanguages);
const publishedSiteNamespaceNames = new Set<string>(Object.keys(siteSourceManifest));
const maximumD1SqlStatementBytes = 100_000;
const maximumD1FileImportBytes = 5_000_000_000;
const maximumD1TranslationPayloadBytes = 2_000_000;
const maximumWorkerDeployEvidenceBytes = 16 * 1024 * 1024;
const repairPatchStatementTargetBytes = 90_000;
const curatedVerificationTargetPayloadBytes = 4 * 1024 * 1024;
const curatedVerificationMaximumRowsPerQuery = 256;
const marketingSiteVerificationMaximumRowsPerQuery = 16;
const mainAppVerificationMaximumRowsPerQuery = 64;
const curatedVerificationMinimumBufferBytes = 1 * 1024 * 1024;
const curatedVerificationMaximumBufferBytes = 16 * 1024 * 1024;
const remoteTranslationVerificationFixedQueryCount = 2;
const remoteRepairControlRowsReadReservation = 1_128;
const remoteRepairControlRowsWrittenReservation =
  PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN + 8;
const startLearningKey = "site.02d279ce2f7b58c890";
const tryPublicModesKey = "site.fc4ad9c971ade5617d";
const retiredGameTranslationKeys = [
  "site.ee30b035ee17c34450",
  "site.5121f7306ecc75edb5",
  "site.df499d7c6f44a88703",
] as const;
const legacyMarketingCleanupKeys = [
  ...retiredGameTranslationKeys,
  "site.19abb1657a1d5e54c2",
  "site.2ced57f125910a9e8a",
  "site.649df08a448ee3fa90",
  "site.2ac5cdad2988ba0c40",
  "site.b78a38d18d6555118d",
  "site.4b0412c73bb17a566f",
  "site.97d1bd7fe820bd7b27",
] as const;
const grandfatheredEntryNamespaces = new Set<string>([
  "marketing-shell",
  "route:home",
  "route:mission",
]);
const grandfatheredEntryLanguages = new Set<SupportedLanguage>([
  "Arabic",
  "Spanish",
  "Hindi",
  "Malayalam",
]);
const expectedGrandfatheredEntryCuratedPackCount = 691;
const expectedSourceHashes = {
  "marketing-site": LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH,
  "route:home": "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce",
  "route:about": "6aa44ee2349a660b840519a4fc03037976d4e26ee4ceb55d7d94e2959b211a99",
  "route:chat-public": "f5ef074ab3712ef9b40cb5fcbc794e9b7d42efd2089fc22400aeb280abce8689",
  "route:media": "8f437d1337e18df480b2aef7ced339482fa4b1d53653e29fa7b06ae881a77982",
  "route:schools": "2c3294f27d9887dd9fbb10d0ad2147c31960a75ace708d1b3fc750416e6adabe",
} as const;
const projectedBilledWritesPerRepairTranslationRow = 2;
const releasePreflightRunIdPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3])-[0-5]\d-[0-5]\d-\d{3}Z-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

type RepairNamespace = keyof typeof expectedSourceHashes;

export type NativeMaintenanceProbe = {
  active: boolean;
  healthStatus: number;
  mutationStatus: number;
  mutationCode?: string;
  delivery?: string;
  runtime?: string;
  openNext?: boolean;
  maintenance?: boolean;
  versionId?: string;
};

export type RepairArtifactManifest = WorkerDeployArtifactManifest;

export type WorkerDeployRepairEvidence = {
  createdAt: string;
  backupDir: string;
  candidateVersionId: string;
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
  workerSourceSha256: string;
  wranglerConfigSha256: string;
  assetManifest: WorkerDeployArtifactManifest;
  activeDeploymentReadAt: string;
};

export type RemoteRepairReleasePreflight = {
  runId: string;
  createdAt: string;
  candidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  activeVersionId: string;
  gitHead: string;
  gitUpstream: string;
  sourceFingerprint: SourceFingerprint;
  workerSourceSha256: string;
  wranglerConfigSha256: string;
  assetManifest: RepairArtifactManifest;
  safetyChecks: ReturnType<typeof buildReleaseArtifactSafetyChecks>;
  candidateProbe: NativeMaintenanceProbe;
  workerDeployReportPath: string;
  workerDeployEvidence: WorkerDeployRepairEvidence;
  evidencePath: string;
};

export function productionMaintenanceRepairRunId(releasePreflightRunId: string) {
  const match = releasePreflightRunIdPattern.exec(releasePreflightRunId);
  if (!match?.[1]) {
    throw new Error(
      "Translation repair release-preflight run ID must be an exact UTC timestamp followed by a lowercase RFC UUID.",
    );
  }
  releasePreflightRunTimestamp(releasePreflightRunId);
  return match[1];
}

export type ImportVerificationState =
  | "not-attempted"
  | "verified"
  | "mismatch"
  | "indeterminate";

export function decideImportRecovery(input: {
  importAttempted: boolean;
  importResponseConfirmed: boolean;
  verification: ImportVerificationState;
}) {
  if (!input.importAttempted) {
    return { success: false, restoreRequired: false, releaseAllowed: true } as const;
  }
  if (input.verification === "verified") {
    return {
      success: true,
      restoreRequired: false,
      releaseAllowed: true,
      responseRecoveredByVerification: !input.importResponseConfirmed,
    } as const;
  }
  if (input.verification === "mismatch") {
    return { success: false, restoreRequired: false, releaseAllowed: false } as const;
  }
  return { success: false, restoreRequired: false, releaseAllowed: false } as const;
}

class RemoteVerificationMismatchError extends Error {
  override name = "RemoteVerificationMismatchError";
}

class RemoteVerificationIndeterminateError extends Error {
  override name = "RemoteVerificationIndeterminateError";
}

export type CuratedNamespaceRepairRow = {
  namespace: keyof typeof siteSourceManifest;
  language: SupportedLanguage;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
};

export type CuratedRepairVerificationChunk = {
  index: number;
  rows: number;
  expectedPayloadBytes: number;
  sqlBytes: number;
  maxBufferBytes: number;
  expectedRows: readonly CuratedNamespaceRepairRow[];
  sql: string;
};

export type CuratedNamespaceRepairPlan = {
  sql: string;
  legacyPrerequisiteSql: string;
  postLegacyCanonicalSql: string;
  rows: number;
  resetStatements: number;
  patchStatements: number;
  logicalRowWrites: number;
  largestStatementBytes: number;
  payloadBytes: number;
  largestPayloadBytes: number;
  corpusSha256: string;
};

export type MainAppRepairRow = {
  namespace: typeof mainAppTranslationNamespace;
  language: SupportedLanguage;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
};

export type MarketingSiteRepairRow = LegacyMarketingSiteDatabaseRow & Readonly<{
  namespace: typeof LEGACY_MARKETING_SITE_NAMESPACE;
  language: LegacyMarketingSiteTargetLanguage;
}>;

export type MarketingSiteRepairCorpus = Readonly<{
  corpus: LegacyMarketingSiteComposedCorpus;
  rows: readonly MarketingSiteRepairRow[];
}>;

export type MarketingSiteRepairVerificationChunk = {
  index: number;
  rows: number;
  expectedPayloadBytes: number;
  sqlBytes: number;
  maxBufferBytes: number;
  expectedRows: readonly MarketingSiteRepairRow[];
  sql: string;
};

export type MarketingSiteRepairPlan = {
  sql: string;
  rows: number;
  resetStatements: number;
  patchStatements: number;
  logicalRowWrites: number;
  largestStatementBytes: number;
  payloadBytes: number;
  largestPayloadBytes: number;
  corpusSha256: string;
  deltaCorpusSha256: string;
  model: string;
};

export type MainAppRepairVerificationChunk = {
  index: number;
  rows: number;
  expectedPayloadBytes: number;
  sqlBytes: number;
  maxBufferBytes: number;
  expectedRows: readonly MainAppRepairRow[];
  sql: string;
};

export type MainAppRepairPlan = {
  sql: string;
  rows: number;
  resetStatements: number;
  patchStatements: number;
  logicalRowWrites: number;
  largestStatementBytes: number;
  largestPayloadBytes: number;
};

type RepairReport = {
  createdAt: string;
  mode: "verify" | "remote";
  ok: boolean;
  database: string;
  preWriteEvidencePath?: string;
  translationCount: number;
  curatedTranslationRows: number;
  curatedRepairStatements: number;
  curatedRepairLogicalRowWrites: number;
  curatedPayloadBytes: number;
  largestCuratedPayloadBytes: number;
  curatedCorpusSha256: string;
  largestCuratedRepairStatementBytes: number;
  marketingSiteTranslationRows: number;
  marketingSiteRepairStatements: number;
  marketingSiteRepairLogicalRowWrites: number;
  marketingSitePayloadBytes: number;
  largestMarketingSitePayloadBytes: number;
  marketingSiteComposedCorpusSha256: string;
  marketingSiteDeltaCorpusSha256: string;
  marketingSiteModel: string;
  largestMarketingSiteRepairStatementBytes: number;
  mainAppTranslationRows: number;
  mainAppRepairStatements: number;
  mainAppRepairLogicalRowWrites: number;
  largestMainAppRepairStatementBytes: number;
  largestMainAppPayloadBytes: number;
  manifestNamespacesVerified: number;
  sourceHashes: Record<RepairNamespace, string>;
  repairSqlSha256: string;
  repairSqlBytes: number;
  repairSqlStatements: number;
  atomicSqlBytes: number;
  atomicSqlStatements: number;
  largestAtomicSqlStatementBytes: number;
  d1FileImportByteLimit: number;
  executionMode: "single-transaction-wrangler-import";
  exactTranslationPartitions: {
    curatedSiteRows: number;
    marketingSiteRows: number;
    siteRows: number;
    mainAppRows: number;
    finalRows: number;
  };
  maintenance: {
    runtime: "native-cloudflare-worker";
    openNext: false;
    activated: boolean;
    released: boolean;
    importAttempted?: boolean;
    importResponseConfirmed?: boolean;
    importVerification?: ImportVerificationState;
    responseRecoveredByVerification?: boolean;
    candidateVersionId?: string;
    serviceBaselineVersionId?: string;
    uploadEvidenceSha256?: string;
    maintenanceVersionId?: string;
    releasePreflightEvidencePath?: string;
    sourceFingerprintSha256?: string;
    assetManifestSha256?: string;
    activeProbeVersionId?: string;
    releasedProbeVersionId?: string;
  };
  sourceSyncSha256?: string;
  sourceSyncStatements?: number;
  sourceSyncLogicalRowWrites?: number;
  staticRepairRows?: number;
  projectionBasis: "local-static-proof" | "remote-diff";
  projectedBilledRowWrites?: number;
  projectedBilledRowWriteLimit?: number;
  coldCombinedProjectedBilledRowWrites?: number;
  coldCombinedWriteBudgetAdmissible?: boolean;
  projectedBilledRowReads?: number;
  projectedBilledRowReadLimit?: number;
  timeTravelVerified: boolean;
  timeTravelBookmark?: string;
  accountDailyUsage?: D1DailyUsage;
  d1ReleaseBudget?: {
    ledgerPath: string;
    utcDay: string;
    operationId: string;
    revision: number;
    phase: "maximum" | "exact";
    rowsRead: number;
    rowsWritten: number;
  };
  d1Billing?: {
    readOnlyCommands: number;
    readOnlyRowsRead: number;
    importRowsRead?: number;
    importRowsWritten?: number;
    controlRowsReadReserved: number;
    controlRowsWrittenReserved: number;
    disposition: "maximum-retained-metered" | "maximum-retained-import-unmetered";
  };
  d1StorageAdmission?: D1StorageAdmissionProjection;
  productionVerification?: {
    expectedSourceNamespaces: number;
    sourceNamespaces: number;
    freshSourceNamespaces: number;
    observedTranslationRows: number;
    observedFreshTranslationRows: number;
    auditedSiteNamespaces: number;
    auditedSiteRows: number;
    retiredGamePayloads: number;
    curatedRowsMatched: number;
    curatedPayloadBytesMatched: number;
    curatedCorpusSha256: string;
    marketingSiteRowsMatched: number;
    marketingSitePayloadBytesMatched: number;
    marketingSiteCorpusSha256: string;
    mainAppRowsMatched: number;
    exactFinalRows: number;
  };
};

export type RemoteTranslationDriftIssue = {
  scope:
    | "source-snapshot"
    | "translation-summary"
    | "curated-payloads"
    | "marketing-site-payloads"
    | "main-app-payloads";
  code: string;
  message: string;
};

export type RemoteTranslationDriftReport = {
  createdAt: string;
  mode: "remote-verify-only";
  database: string;
  ok: boolean;
  status: "reconciled" | "repair-required";
  repairRequired: boolean;
  issues: RemoteTranslationDriftIssue[];
  expected: {
    sourceNamespaces: number;
    curatedRows: number;
    marketingSiteRows: number;
    mainAppRows: number;
    supportedTargetLanguages: number;
    remoteQueries: number;
  };
  sourceSnapshot: {
    status: "reconciled" | "repair-required";
    expectedSourceNamespaces: number;
    expectedSourceStrings: number;
    reconciliationStatements: number;
    reconciliationLogicalRowWrites: number;
    snapshotBilledRowReads: number;
    projectedBilledRowReads: number;
  };
  payloadSnapshot: {
    status: "reconciled" | "repair-required";
    issues: RemoteTranslationDriftIssue[];
    verification?: NonNullable<RepairReport["productionVerification"]>;
  };
  readOnly: {
    remoteQueries: number;
    billedRowsRead: number;
    workerUploads: 0;
    workerDeployments: 0;
    maintenanceActivations: 0;
    timeTravelReads: 0;
    sqlImports: 0;
    databaseWrites: 0;
    unresolvedMarkersCreated: 0;
    preWriteEvidenceCreated: 0;
    reportsWritten: 0;
  };
};

export type AbortedPrewriteReservationRefinementReport = {
  kind: "d1-translation-repair-prewrite-abort-refinement-v1";
  status: "complete";
  createdAt: string;
  ok: true;
  releasePreflightRunId: string;
  repairRunId: string;
  releasePreflightEvidencePath: string;
  candidateVersionId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  operationId: string;
  proof: {
    candidateVersionBefore: string;
    candidateVersionAfter: string;
    candidateUnfrozenBefore: true;
    candidateUnfrozenAfter: true;
    productionMaintenanceStateAbsent: true;
    preWriteEvidenceAbsent: true;
    unresolvedMarkerAbsent: true;
    importAttempted: false;
    driftStatus: "repair-required";
    driftRemoteQueries: number;
    driftBilledRowsRead: number;
    validationLockRowsReadReserved: number;
    validationLockRowsWrittenReserved: number;
    driftDatabaseWrites: 0;
  };
  ledger: {
    path: string;
    utcDay: string;
    revisionBefore: number;
    revisionAfter: number;
    phaseBefore: "maximum";
    phaseAfter: "exact";
    maximumRowsRead: number;
    maximumRowsWritten: number;
    exactRowsRead: number;
    exactRowsWritten: number;
  };
};

type RefineAbortedPrewriteReservationOptions = {
  backupDir: string;
  releasePreflightRunId: string;
  confirmed: boolean;
  prewriteAbortConfirmed: boolean;
  dailyUsage?: D1DailyUsage;
  now?: Date;
  clock?: () => Date;
  lockRunner?: ProductionValidationLockRunner;
  assertRecoverySource?: () => void;
  buildRecoveryPlan?: (
    sourceFingerprint: D1ReleaseSourceIdentity,
    candidateVersionId: string,
    releasePreflightRunId: string,
  ) => ReturnType<typeof buildAbortedPrewriteRecoveryPlan>;
  readActiveWorkerVersion?: () => string;
  probeCandidate?: (candidateVersionId: string) => NativeMaintenanceProbe;
  verifyDrift?: () => RemoteTranslationDriftReport;
};

type RepairSeoCtaTranslationOptions = {
  remote: boolean;
  confirmed: boolean;
  verifyOnly?: boolean;
  nativeWriteFreezeConfirmed?: boolean;
  candidateVersion?: string;
  backupDir: string;
  dailyUsage?: D1DailyUsage;
  runner?: WranglerRunner;
  now?: number;
  clock?: () => Date;
  releaseSequenceGate?: typeof assertRemoteTranslationSequenceGate;
  attestationClock?: () => Date;
};

export type RemoteTranslationSequenceGateResult = {
  currentRelease: VectorizeReadinessCurrentRelease;
  vectorizeReadiness: Pick<VectorizeReadinessReport, "createdAt">;
  topicAttestation: Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
};

export type RemoteTranslationSequenceGateDependencies = {
  readGitIdentity?: (cwd: string) => GitReleaseIdentity;
  buildArtifactEvidence?: (cwd: string) => WorkerDeployArtifactEvidence;
  readUploadEvidence?: typeof readWorkerCandidateUploadEvidence;
  assertCurrentReleaseBinding?: (
    input: Parameters<typeof assertReleaseSequenceCurrentReleaseBinding>[0],
  ) => unknown;
  readActiveVersion?: () => string;
  validateVectorizeReadiness?: (
    input: Parameters<typeof assertFreshProductionVectorizeReadiness>[0],
  ) => Pick<VectorizeReadinessReport, "createdAt">;
  validateTopicReconciliation?: (
    input: Parameters<typeof assertProductionTopicReconciliationReleaseBinding>[0],
  ) => Pick<
    TopicReconciliationAttestation,
    "createdAt" | "vectorizeReadinessCreatedAt"
  >;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const refinementRequested = process.argv.includes("--refine-aborted-prewrite-reservation");
  const remote = process.argv.includes("--remote");
  const verifyOnly = process.argv.includes("--verify-only");
  assertTranslationReconciliationCliPhase({
    argv: process.argv.slice(2),
    refinementRequested,
    remote,
    verifyOnly,
  });
  const releasePreflightRunId = refinementRequested
    ? requireCliArgument(
        getArg("--refine-aborted-prewrite-reservation"),
        "--refine-aborted-prewrite-reservation",
      )
    : null;
  const report = releasePreflightRunId
    ? refineAbortedPrewriteTranslationRepairReservation({
        backupDir: resolveBackupDir(),
        releasePreflightRunId,
        confirmed: process.argv.includes("--confirm-production"),
        prewriteAbortConfirmed: process.argv.includes("--confirm-prewrite-abort"),
      })
    : repairSeoCtaTranslations({
        remote,
        confirmed: process.argv.includes("--confirm-production"),
        verifyOnly,
        nativeWriteFreezeConfirmed: process.argv.includes("--confirm-native-write-freeze"),
        candidateVersion: getArg("--candidate-version"),
        backupDir: resolveBackupDir(),
      });
  console.log(JSON.stringify(report, null, 2));
  if ("mode" in report && report.mode === "remote-verify-only" && report.repairRequired) {
    process.exitCode = 1;
  }
}

export function assertTranslationReconciliationCliPhase(input: {
  argv: readonly string[];
  refinementRequested: boolean;
  remote: boolean;
  verifyOnly: boolean;
}): "uploaded-inactive" | undefined {
  const phaseIndexes = input.argv.flatMap((argument, index) =>
    argument === "--phase" ? [index] : [],
  );
  if (phaseIndexes.length > 1) {
    throw new Error("Production translation reconciliation accepts --phase exactly once.");
  }
  const phaseIndex = phaseIndexes[0];
  const phase = phaseIndex === undefined ? undefined : input.argv[phaseIndex + 1];
  if (phaseIndex !== undefined && (!phase || phase.startsWith("--"))) {
    throw new Error("Production translation reconciliation --phase requires an exact value.");
  }

  if (input.refinementRequested) {
    if (phase !== undefined) {
      throw new Error("Prewrite-abort refinement does not accept --phase.");
    }
    return undefined;
  }
  if (input.remote && input.verifyOnly) {
    if (phase !== "uploaded-inactive") {
      throw new Error(
        "Production translation verification requires --phase uploaded-inactive; candidate-active verification is forbidden.",
      );
    }
    return phase;
  }
  if (phase !== undefined) {
    throw new Error(
      "Only read-only production translation verification accepts --phase uploaded-inactive.",
    );
  }
  return undefined;
}

export function refineAbortedPrewriteTranslationRepairReservation(
  input: RefineAbortedPrewriteReservationOptions,
): AbortedPrewriteReservationRefinementReport {
  if (!input.confirmed) {
    throw new Error("Prewrite-abort reservation refinement requires --confirm-production.");
  }
  if (!input.prewriteAbortConfirmed) {
    throw new Error("Prewrite-abort reservation refinement requires --confirm-prewrite-abort.");
  }
  const fixedNow = input.now;
  const refinementClock = input.clock ?? (fixedNow
    ? () => new Date(fixedNow.getTime())
    : () => new Date());
  const startedAt = readPrewriteAbortRefinementClock(refinementClock, "start");
  (input.assertRecoverySource ?? assertCleanPushedPrewriteAbortRecoverySource)();
  const evidence = readAbortedPrewriteReleasePreflight(
    input.backupDir,
    input.releasePreflightRunId,
  );
  assertAbortedPrewriteArtifactsAbsent(input.backupDir, evidence.runId);
  const refinementEvidencePath = path.join(
    cloudflareDir(input.backupDir),
    `d1-translation-repair-prewrite-abort-refinement-${evidence.runId}.json`,
  );

  const plan = (input.buildRecoveryPlan ?? buildAbortedPrewriteRecoveryPlan)(
    evidence.sourceFingerprint,
    evidence.candidateVersionId,
    evidence.runId,
  );
  const ledgerPath = d1ReleaseBudgetLedgerPath(
    input.backupDir,
    evidence.createdAt.slice(0, 10),
  );
  const ledgerBefore = readD1ReleaseBudgetLedger(ledgerPath);
  const acceptedOperationIds = new Set([plan.operationId, plan.legacyOperationId]);
  const matchingReservations = ledgerBefore.reservations.filter(
    (reservation) =>
      acceptedOperationIds.has(reservation.operationId) &&
      reservation.sourceFingerprint.sha256 === evidence.sourceFingerprint.sha256 &&
      reservation.sourceFingerprint.fileCount === evidence.sourceFingerprint.fileCount,
  );
  if (matchingReservations.length !== 1) {
    throw new Error(
      "Prewrite-abort refinement requires exactly one source-bound translation repair reservation.",
    );
  }
  const reservationBefore = matchingReservations[0]!;
  const budgetOperationId = reservationBefore.operationId;
  const reservationCreatedAt = exactIsoTimestamp(
    reservationBefore.createdAt,
    "translation repair reservation creation timestamp",
  );
  const reservationDelayMs = Date.parse(reservationCreatedAt) - Date.parse(evidence.createdAt);
  const maximumReservationDelayMs =
    budgetOperationId === plan.legacyOperationId
      ? 5_000
      : CLOUDFLARE_CLI_TIMEOUT_MS + 5_000;
  if (reservationDelayMs < 0 || reservationDelayMs > maximumReservationDelayMs) {
    throw new Error(
      "The translation repair reservation is not tightly bound to the selected release preflight.",
    );
  }
  const isUnreducedMaximum =
    reservationBefore.phase === "maximum" &&
    reservationBefore.updatedAt === reservationBefore.createdAt &&
    reservationBefore.rowsRead === MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS &&
    reservationBefore.rowsWritten === MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES;
  const isRecoveredExactReadOnly =
    reservationBefore.phase === "exact" &&
    reservationBefore.rowsRead > 0 &&
    reservationBefore.rowsRead <= MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS &&
    reservationBefore.rowsWritten === PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN;
  if (
    reservationBefore.operation !== "Remote SEO translation repair" ||
    reservationBefore.candidateVersionId !== evidence.candidateVersionId ||
    reservationBefore.maximumRowsRead !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
    reservationBefore.maximumRowsWritten !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES ||
    (!isUnreducedMaximum && !isRecoveredExactReadOnly)
  ) {
    throw new Error(
      "Prewrite-abort refinement requires the exact unreduced translation repair maximum reservation.",
    );
  }
  if (isUnreducedMaximum) {
    assertD1ReleaseBudgetUtcDay(ledgerBefore.utcDay, startedAt);
  }
  const existingRefinementEvidence = pathEntryExistsNoFollow(refinementEvidencePath)
    ? readPrewriteAbortRefinementEvidence(refinementEvidencePath, {
        runId: evidence.runId,
        candidateVersionId: evidence.candidateVersionId,
        sourceFingerprint: evidence.sourceFingerprint,
        operationId: budgetOperationId,
        ledgerPath,
        utcDay: ledgerBefore.utcDay,
        repairRunId: evidence.repairRunId,
        releasePreflightEvidencePath: evidence.evidencePath,
        currentLedgerRevision: ledgerBefore.revision,
      })
    : null;
  if (isUnreducedMaximum && existingRefinementEvidence?.status === "complete") {
    throw new Error(
      "Completed prewrite-abort evidence cannot accompany an unreduced maximum reservation.",
    );
  }
  if (isRecoveredExactReadOnly && existingRefinementEvidence === null) {
    throw new Error(
      "An exact read-only translation repair reservation requires its matching preliminary recovery evidence.",
    );
  }
  if (
    isRecoveredExactReadOnly &&
    existingRefinementEvidence?.exactRowsRead !== reservationBefore.rowsRead
  ) {
    throw new Error(
      "The exact read-only reservation does not match its prewrite-abort recovery evidence.",
    );
  }
  if (
    isRecoveredExactReadOnly &&
    existingRefinementEvidence &&
    ledgerBefore.revision <= existingRefinementEvidence.revisionBefore
  ) {
    throw new Error(
      "The exact read-only reservation does not postdate its prepared recovery evidence.",
    );
  }
  if (isRecoveredExactReadOnly && existingRefinementEvidence?.completeReport) {
    return existingRefinementEvidence.completeReport;
  }

  const readActiveWorkerVersion = input.readActiveWorkerVersion ?? requireSoleActiveWorkerVersion;
  const probeCandidate =
    input.probeCandidate ??
    ((candidateVersionId: string) => probeNativeWriteFreeze(false, candidateVersionId));
  const verifyDrift =
    input.verifyDrift ??
    (() =>
      verifyRemoteTranslationDrift({
        translations: plan.translations,
        curatedRepairRows: plan.curatedRepairRows,
        marketingSite: plan.marketingSite,
        mainAppRepairRows: plan.mainAppRepairRows,
      }));

  let exclusion: ProductionValidationExclusion | null = null;
  let refined: D1ReleaseBudgetReservationResult | null = null;
  let candidateVersionBefore = "";
  let candidateVersionAfter = "";
  let exactRowsRead = existingRefinementEvidence?.exactRowsRead ?? 0;
  const exactRowsWritten = PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN;
  let driftRemoteQueries = existingRefinementEvidence?.driftRemoteQueries ?? 0;
  let driftBilledRowsRead = existingRefinementEvidence
    ? existingRefinementEvidence.exactRowsRead - PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ
    : 0;
  let reservationAt: Date | null = null;
  let operationError: unknown = null;
  let releaseError: unknown = null;
  try {
    if (existingRefinementEvidence) {
      assertAbortedPrewriteArtifactsAbsent(input.backupDir, evidence.runId);
      // Prepared evidence was durably written only after both original live
      // candidate probes. A replay performs one bounded read-only D1 check so
      // an unresolved lock or maintenance marker can never be promoted to a
      // completed recovery, then finishes only the local ledger/evidence step.
      assertNoLiveProductionValidationLock({ runner: input.lockRunner });
      candidateVersionBefore = assertAbortedCandidateUnfrozen({
        expectedVersionId: evidence.serviceBaselineVersionId,
        readActiveWorkerVersion,
        probeCandidate,
      });
      candidateVersionAfter = candidateVersionBefore;
    } else {
      exclusion = acquireProductionValidationExclusion({
        candidateVersionId: evidence.serviceBaselineVersionId,
        sourceFingerprintSha256: evidence.sourceFingerprint.sha256,
        runner: input.lockRunner,
      });
      exclusion = attestProductionValidationExclusion(exclusion, input.lockRunner);
      assertProductionValidationExclusionCommandWindow(exclusion);
      assertAbortedPrewriteArtifactsAbsent(input.backupDir, evidence.runId);
      if (readProductionMaintenanceState({ runner: input.lockRunner }) !== null) {
        throw new Error("Prewrite-abort refinement found a production maintenance state.");
      }
      candidateVersionBefore = assertAbortedCandidateUnfrozen({
        expectedVersionId: evidence.serviceBaselineVersionId,
        readActiveWorkerVersion,
        probeCandidate,
      });

      const verifiedDrift = verifyDrift();
      assertReadOnlyRepairRequiredDrift(verifiedDrift);
      driftBilledRowsRead = verifiedDrift.readOnly.billedRowsRead;
      exactRowsRead = safeAddBilledRowsRead(
        driftBilledRowsRead,
        PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
      );
      if (exactRowsRead > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS) {
        throw new Error(
          "Prewrite-abort recovery reads plus validation-lock allowance exceed the original maximum.",
        );
      }
      driftRemoteQueries = verifiedDrift.readOnly.remoteQueries;

      exclusion = attestProductionValidationExclusion(exclusion, input.lockRunner);
      assertProductionValidationExclusionCommandWindow(exclusion);
      assertAbortedPrewriteArtifactsAbsent(input.backupDir, evidence.runId);
      if (readProductionMaintenanceState({ runner: input.lockRunner }) !== null) {
        throw new Error(
          "Prewrite-abort refinement found a production maintenance state after drift proof.",
        );
      }
      candidateVersionAfter = assertAbortedCandidateUnfrozen({
        expectedVersionId: evidence.serviceBaselineVersionId,
        readActiveWorkerVersion,
        probeCandidate,
      });

      writePrivateJsonDurably(
        refinementEvidencePath,
        {
          kind: "d1-translation-repair-prewrite-abort-refinement-v1",
          status: "prepared",
          createdAt: readPrewriteAbortRefinementClock(
            refinementClock,
            "preliminary evidence",
          ).toISOString(),
          releasePreflightRunId: evidence.runId,
          repairRunId: evidence.repairRunId,
          releasePreflightEvidencePath: evidence.evidencePath,
          candidateVersionId: evidence.candidateVersionId,
          sourceFingerprint: evidence.sourceFingerprint,
          operationId: budgetOperationId,
          proof: {
            candidateVersionBefore,
            candidateVersionAfter,
            candidateUnfrozenBefore: true,
            candidateUnfrozenAfter: true,
            productionMaintenanceStateAbsent: true,
            preWriteEvidenceAbsent: true,
            unresolvedMarkerAbsent: true,
            importAttempted: false,
            driftStatus: "repair-required",
            driftRemoteQueries,
            driftBilledRowsRead,
            validationLockRowsReadReserved: PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
            validationLockRowsWrittenReserved:
              PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
            driftDatabaseWrites: 0,
          },
          ledger: {
            path: ledgerPath,
            utcDay: ledgerBefore.utcDay,
            revisionBefore: ledgerBefore.revision,
            phaseBefore: "maximum",
            maximumRowsRead: reservationBefore.maximumRowsRead,
            maximumRowsWritten: reservationBefore.maximumRowsWritten,
            intendedExactRowsRead: exactRowsRead,
            intendedExactRowsWritten: exactRowsWritten,
          },
        },
        { replace: false },
      );
    }
    if (isUnreducedMaximum) {
      reservationAt = readPrewriteAbortRefinementClock(
        refinementClock,
        "exact read-only reservation",
      );
      refined = reserveD1ReleaseBudget({
        backupDir: input.backupDir,
        operationId: budgetOperationId,
        operation: "Remote SEO translation repair",
        candidateVersionId: evidence.candidateVersionId,
        sourceFingerprint: evidence.sourceFingerprint,
        phase: "exact",
        rowsRead: exactRowsRead,
        rowsWritten: exactRowsWritten,
        observedUsage: input.dailyUsage ?? loadAccountD1DailyUsage(startedAt),
        now: reservationAt,
        expectedUtcDay: ledgerBefore.utcDay,
      });
    } else {
      reservationAt = new Date(
        exactIsoTimestamp(
          reservationBefore.updatedAt,
          "exact read-only reservation update timestamp",
        ),
      );
      refined = existingExactReservationResult({
        ledgerPath,
        ledger: ledgerBefore,
        reservation: reservationBefore,
      });
    }
  } catch (error) {
    operationError = error;
  } finally {
    if (exclusion) {
      try {
        releaseProductionValidationExclusion(exclusion, input.lockRunner);
      } catch (error) {
        releaseError = error;
      }
    }
  }
  if (operationError || releaseError) {
    throw new AggregateError(
      [operationError, releaseError]
        .filter((error): error is NonNullable<unknown> => error !== null)
        .map(asError),
      "Prewrite-abort reservation refinement failed closed.",
    );
  }
  if (!refined || !isPositiveSafeInteger(exactRowsRead) || !isPositiveSafeInteger(driftRemoteQueries)) {
    throw new Error("Prewrite-abort reservation refinement omitted its exact evidence.");
  }
  if (!reservationAt) {
    throw new Error("Prewrite-abort reservation refinement omitted its reservation timestamp.");
  }
  if (
    refined.reservation.phase !== "exact" ||
    refined.reservation.rowsRead !== exactRowsRead ||
    refined.reservation.rowsWritten !== exactRowsWritten
  ) {
    throw new Error("Prewrite-abort reservation refinement did not exact-verify read-only work.");
  }

  const report: AbortedPrewriteReservationRefinementReport = {
    kind: "d1-translation-repair-prewrite-abort-refinement-v1",
    status: "complete",
    createdAt: reservationAt.toISOString(),
    ok: true,
    releasePreflightRunId: evidence.runId,
    repairRunId: evidence.repairRunId,
    releasePreflightEvidencePath: evidence.evidencePath,
    candidateVersionId: evidence.candidateVersionId,
    sourceFingerprint: evidence.sourceFingerprint,
    operationId: budgetOperationId,
    proof: {
      candidateVersionBefore,
      candidateVersionAfter,
      candidateUnfrozenBefore: true,
      candidateUnfrozenAfter: true,
      productionMaintenanceStateAbsent: true,
      preWriteEvidenceAbsent: true,
      unresolvedMarkerAbsent: true,
      importAttempted: false,
      driftStatus: "repair-required",
      driftRemoteQueries,
      driftBilledRowsRead,
      validationLockRowsReadReserved: PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
      validationLockRowsWrittenReserved: PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
      driftDatabaseWrites: 0,
    },
    ledger: {
      path: refined.ledgerPath,
      utcDay: refined.utcDay,
      revisionBefore:
        existingRefinementEvidence?.revisionBefore ?? ledgerBefore.revision,
      revisionAfter: refined.revision,
      phaseBefore: "maximum",
      phaseAfter: "exact",
      maximumRowsRead: reservationBefore.maximumRowsRead,
      maximumRowsWritten: reservationBefore.maximumRowsWritten,
      exactRowsRead,
      exactRowsWritten,
    },
  };
  writePrivateJsonDurably(
    refinementEvidencePath,
    report,
    { replace: true },
  );
  return report;
}

type AbortedPrewriteReleasePreflightEvidence = {
  runId: string;
  repairRunId: string;
  createdAt: string;
  candidateVersionId: string;
  serviceBaselineVersionId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  evidencePath: string;
};

type ExistingPrewriteAbortRefinementEvidence = {
  status: "prepared" | "complete";
  revisionBefore: number;
  exactRowsRead: number;
  driftRemoteQueries: number;
  completeReport: AbortedPrewriteReservationRefinementReport | null;
};

function readPrewriteAbortRefinementEvidence(
  evidencePath: string,
  expected: {
    runId: string;
    candidateVersionId: string;
    sourceFingerprint: D1ReleaseSourceIdentity;
    operationId: string;
    ledgerPath: string;
    utcDay: string;
    repairRunId: string;
    releasePreflightEvidencePath: string;
    currentLedgerRevision: number;
  },
): ExistingPrewriteAbortRefinementEvidence {
  const value = readPrivateJsonNoFollow(evidencePath);
  const expectedTopLevelKeys = value && isRecord(value) && value.status === "complete"
    ? [
        "candidateVersionId",
        "createdAt",
        "kind",
        "ledger",
        "ok",
        "operationId",
        "proof",
        "releasePreflightEvidencePath",
        "releasePreflightRunId",
        "repairRunId",
        "sourceFingerprint",
        "status",
      ]
    : [
        "candidateVersionId",
        "createdAt",
        "kind",
        "ledger",
        "operationId",
        "proof",
        "releasePreflightEvidencePath",
        "releasePreflightRunId",
        "repairRunId",
        "sourceFingerprint",
        "status",
      ];
  if (
    !isRecord(value) ||
    !hasExactObjectKeys(value, expectedTopLevelKeys) ||
    value.kind !== "d1-translation-repair-prewrite-abort-refinement-v1" ||
    (value.status !== "prepared" && value.status !== "complete") ||
    value.releasePreflightRunId !== expected.runId ||
    value.repairRunId !== expected.repairRunId ||
    value.releasePreflightEvidencePath !== expected.releasePreflightEvidencePath ||
    value.candidateVersionId !== expected.candidateVersionId ||
    value.operationId !== expected.operationId
  ) {
    throw new Error("Existing prewrite-abort refinement evidence has the wrong identity.");
  }
  const createdAt = exactIsoTimestamp(
    value.createdAt,
    "prewrite-abort refinement evidence timestamp",
  );
  const source = requireEvidenceRecord(
    value.sourceFingerprint,
    "prewrite-abort refinement source fingerprint",
  );
  const proof = requireEvidenceRecord(value.proof, "prewrite-abort refinement proof");
  const ledger = requireEvidenceRecord(value.ledger, "prewrite-abort refinement ledger proof");
  const expectedProofKeys = [
    "candidateUnfrozenAfter",
    "candidateUnfrozenBefore",
    "candidateVersionAfter",
    "candidateVersionBefore",
    "driftDatabaseWrites",
    "driftBilledRowsRead",
    "driftRemoteQueries",
    "driftStatus",
    "importAttempted",
    "preWriteEvidenceAbsent",
    "productionMaintenanceStateAbsent",
    "unresolvedMarkerAbsent",
    "validationLockRowsReadReserved",
    "validationLockRowsWrittenReserved",
  ];
  const expectedLedgerKeys = value.status === "prepared"
    ? [
        "intendedExactRowsRead",
        "intendedExactRowsWritten",
        "maximumRowsRead",
        "maximumRowsWritten",
        "path",
        "phaseBefore",
        "revisionBefore",
        "utcDay",
      ]
    : [
        "exactRowsRead",
        "exactRowsWritten",
        "maximumRowsRead",
        "maximumRowsWritten",
        "path",
        "phaseAfter",
        "phaseBefore",
        "revisionAfter",
        "revisionBefore",
        "utcDay",
      ];
  const exactRowsRead = value.status === "prepared"
    ? ledger.intendedExactRowsRead
    : ledger.exactRowsRead;
  const revisionBefore = requirePositiveSafeInteger(
    ledger.revisionBefore,
    "prewrite-abort refinement revision-before",
  );
  const completeRevisionAfter = value.status === "complete"
    ? requirePositiveSafeInteger(
        ledger.revisionAfter,
        "prewrite-abort refinement revision-after",
      )
    : null;
  if (
    !hasExactObjectKeys(source, ["fileCount", "sha256"]) ||
    !hasExactObjectKeys(proof, expectedProofKeys) ||
    !hasExactObjectKeys(ledger, expectedLedgerKeys) ||
    createdAt.slice(0, 10) !== expected.utcDay ||
    source.sha256 !== expected.sourceFingerprint.sha256 ||
    source.fileCount !== expected.sourceFingerprint.fileCount ||
    proof.candidateVersionBefore !== expected.candidateVersionId ||
    proof.candidateVersionAfter !== expected.candidateVersionId ||
    proof.candidateUnfrozenBefore !== true ||
    proof.candidateUnfrozenAfter !== true ||
    proof.productionMaintenanceStateAbsent !== true ||
    proof.preWriteEvidenceAbsent !== true ||
    proof.unresolvedMarkerAbsent !== true ||
    proof.importAttempted !== false ||
    proof.driftStatus !== "repair-required" ||
    !isPositiveSafeInteger(proof.driftRemoteQueries) ||
    !isPositiveSafeInteger(proof.driftBilledRowsRead) ||
    proof.validationLockRowsReadReserved !== PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ ||
    proof.validationLockRowsWrittenReserved !==
      PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN ||
    proof.driftBilledRowsRead + PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ !==
      exactRowsRead ||
    proof.driftDatabaseWrites !== 0 ||
    ledger.path !== expected.ledgerPath ||
    ledger.utcDay !== expected.utcDay ||
    ledger.phaseBefore !== "maximum" ||
    ledger.maximumRowsRead !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
    ledger.maximumRowsWritten !== MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES ||
    revisionBefore > expected.currentLedgerRevision
  ) {
    throw new Error("Existing prewrite-abort refinement evidence is not exact read-only proof.");
  }
  if (
    !isPositiveSafeInteger(exactRowsRead) ||
    exactRowsRead > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS
  ) {
    throw new Error("Existing prewrite-abort refinement evidence has an invalid read charge.");
  }
  if (
    value.status === "prepared" &&
    ledger.intendedExactRowsWritten !== PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN
  ) {
    throw new Error("Prepared prewrite-abort refinement evidence has the wrong lock allowance.");
  }
  if (
    value.status === "complete" &&
    (value.ok !== true ||
      ledger.phaseAfter !== "exact" ||
      ledger.exactRowsWritten !== PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN ||
      completeRevisionAfter === null ||
      completeRevisionAfter <= revisionBefore ||
      completeRevisionAfter > expected.currentLedgerRevision)
  ) {
    throw new Error("Completed prewrite-abort refinement evidence is malformed.");
  }
  const completeReport: AbortedPrewriteReservationRefinementReport | null =
    value.status === "complete" && completeRevisionAfter !== null
      ? {
          kind: "d1-translation-repair-prewrite-abort-refinement-v1",
          status: "complete",
          createdAt,
          ok: true,
          releasePreflightRunId: expected.runId,
          repairRunId: expected.repairRunId,
          releasePreflightEvidencePath: expected.releasePreflightEvidencePath,
          candidateVersionId: expected.candidateVersionId,
          sourceFingerprint: expected.sourceFingerprint,
          operationId: expected.operationId,
          proof: {
            candidateVersionBefore: expected.candidateVersionId,
            candidateVersionAfter: expected.candidateVersionId,
            candidateUnfrozenBefore: true,
            candidateUnfrozenAfter: true,
            productionMaintenanceStateAbsent: true,
            preWriteEvidenceAbsent: true,
            unresolvedMarkerAbsent: true,
            importAttempted: false,
            driftStatus: "repair-required",
            driftRemoteQueries: proof.driftRemoteQueries,
            driftBilledRowsRead:
              exactRowsRead - PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
            validationLockRowsReadReserved: PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_READ,
            validationLockRowsWrittenReserved:
              PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
            driftDatabaseWrites: 0,
          },
          ledger: {
            path: expected.ledgerPath,
            utcDay: expected.utcDay,
            revisionBefore,
            revisionAfter: completeRevisionAfter,
            phaseBefore: "maximum",
            phaseAfter: "exact",
            maximumRowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
            maximumRowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
            exactRowsRead,
            exactRowsWritten: PRODUCTION_VALIDATION_LOCK_MAX_BILLED_ROWS_WRITTEN,
          },
        }
      : null;
  return {
    status: value.status,
    revisionBefore,
    exactRowsRead,
    driftRemoteQueries: proof.driftRemoteQueries,
    completeReport,
  };
}

function readAbortedPrewriteReleasePreflight(
  backupDir: string,
  releasePreflightRunId: string,
): AbortedPrewriteReleasePreflightEvidence {
  const repairRunId = productionMaintenanceRepairRunId(releasePreflightRunId);
  const evidencePath = path.join(
    cloudflareDir(backupDir),
    `d1-translation-repair-release-preflight-${releasePreflightRunId}.json`,
  );
  const value = readPrivateJsonNoFollow(evidencePath);
  if (
    !isRecord(value) ||
    !hasExactObjectKeys(value, [
      "activeVersionId",
      "assetManifest",
      "candidateProbe",
      "candidateVersionId",
      "createdAt",
      "gitHead",
      "gitUpstream",
      "kind",
      "runId",
      "safetyChecks",
      "serviceBaselineVersionId",
      "sourceFingerprint",
      "uploadEvidenceSha256",
      "workerDeployEvidence",
      "workerDeployReportPath",
      "workerSourceSha256",
      "wranglerConfigSha256",
    ]) ||
    value.kind !== "d1-translation-repair-release-preflight" ||
    value.runId !== releasePreflightRunId
  ) {
    throw new Error("Prewrite-abort refinement release-preflight evidence has the wrong contract.");
  }
  const createdAt = exactIsoTimestamp(value.createdAt, "release-preflight creation timestamp");
  const runStartedAt = releasePreflightRunTimestamp(releasePreflightRunId);
  const evidenceDelayMs = Date.parse(createdAt) - Date.parse(runStartedAt);
  if (evidenceDelayMs < 0 || evidenceDelayMs > 5_000) {
    throw new Error("Release-preflight run ID is not bound to its bounded creation timestamp.");
  }
  const candidateVersionId = requireLowercaseWorkerVersion(
    value.candidateVersionId,
    "release-preflight candidate version",
  );
  const serviceBaselineVersionId = requireLowercaseWorkerVersion(
    value.serviceBaselineVersionId,
    "release-preflight service baseline version",
  );
  const uploadEvidenceSha256 =
    typeof value.uploadEvidenceSha256 === "string"
      ? value.uploadEvidenceSha256
      : "";
  if (
    candidateVersionId === serviceBaselineVersionId ||
    value.activeVersionId !== serviceBaselineVersionId ||
    !/^[a-f0-9]{64}$/.test(uploadEvidenceSha256)
  ) {
    throw new Error(
      "Release-preflight evidence must bind a distinct inactive candidate to its exact active service baseline and upload evidence.",
    );
  }
  const canonicalUpload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDir),
  );
  if (
    canonicalUpload.sha256 !== uploadEvidenceSha256 ||
    canonicalUpload.value.targetCandidateVersionId !== candidateVersionId ||
    canonicalUpload.value.serviceBaselineVersionId !== serviceBaselineVersionId
  ) {
    throw new Error(
      "Release-preflight evidence does not match the canonical immutable candidate upload.",
    );
  }
  if (
    typeof value.gitHead !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.gitHead) ||
    value.gitUpstream !== value.gitHead ||
    typeof value.workerSourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.workerSourceSha256) ||
    typeof value.wranglerConfigSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.wranglerConfigSha256) ||
    value.workerDeployReportPath !== workerCandidateUploadEvidencePath(backupDir)
  ) {
    throw new Error("Release-preflight source/deploy evidence is malformed.");
  }
  const sourceFingerprint = parseEvidenceSourceFingerprint(value.sourceFingerprint);
  validateAbortedPrewriteSafetyChecks(value.safetyChecks, sourceFingerprint.sha256);
  const candidateProbe = validateNativeMaintenanceProbe(value.candidateProbe, false);
  if (candidateProbe.versionId !== serviceBaselineVersionId) {
    throw new Error("Release-preflight probe is not bound to its service baseline version.");
  }
  const assetManifest = parseAbortedPrewriteArtifactManifest(
    value.assetManifest,
    "release-preflight asset manifest",
  );
  const workerDeployEvidence = requireEvidenceRecord(
    value.workerDeployEvidence,
    "release-preflight Worker deploy evidence",
  );
  if (
    !hasExactObjectKeys(workerDeployEvidence, [
      "activeDeploymentReadAt",
      "assetManifest",
      "backupDir",
      "candidateVersionId",
      "createdAt",
      "sourceFingerprintFileCount",
      "sourceFingerprintSha256",
      "workerSourceSha256",
      "wranglerConfigSha256",
    ])
  ) {
    throw new Error("Release-preflight Worker deploy evidence has the wrong schema.");
  }
  const nestedAssetManifest = parseAbortedPrewriteArtifactManifest(
    workerDeployEvidence.assetManifest,
    "release-preflight nested asset manifest",
  );
  const workerEvidenceCreatedAt = exactIsoTimestamp(
    workerDeployEvidence.createdAt,
    "release-preflight Worker evidence creation timestamp",
  );
  const activeDeploymentReadAt = exactIsoTimestamp(
    workerDeployEvidence.activeDeploymentReadAt,
    "release-preflight active-deployment timestamp",
  );
  if (
    workerDeployEvidence.candidateVersionId !== candidateVersionId ||
    workerDeployEvidence.sourceFingerprintSha256 !== sourceFingerprint.sha256 ||
    workerDeployEvidence.sourceFingerprintFileCount !== sourceFingerprint.fileCount ||
    workerDeployEvidence.workerSourceSha256 !== value.workerSourceSha256 ||
    workerDeployEvidence.wranglerConfigSha256 !== value.wranglerConfigSha256 ||
    workerDeployEvidence.backupDir !== path.resolve(backupDir) ||
    workerEvidenceCreatedAt !== canonicalUpload.value.createdAt ||
    assetManifest.root !== path.resolve(process.cwd(), ".open-next/assets") ||
    assetManifest.root !== nestedAssetManifest.root ||
    assetManifest.sha256 !== nestedAssetManifest.sha256 ||
    assetManifest.fileCount !== nestedAssetManifest.fileCount ||
    assetManifest.bytes !== nestedAssetManifest.bytes ||
    Date.parse(activeDeploymentReadAt) > Date.parse(workerEvidenceCreatedAt) ||
    Date.parse(workerEvidenceCreatedAt) > Date.parse(createdAt)
  ) {
    throw new Error("Release-preflight Worker deploy evidence is not exactly source-bound.");
  }
  return {
    runId: releasePreflightRunId,
    repairRunId,
    createdAt,
    candidateVersionId,
    serviceBaselineVersionId,
    sourceFingerprint,
    evidencePath,
  };
}

function parseEvidenceSourceFingerprint(value: unknown): D1ReleaseSourceIdentity {
  if (
    !isRecord(value) ||
    !hasExactObjectKeys(value, ["fileCount", "files", "sha256"]) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !isPositiveSafeInteger(value.fileCount) ||
    !Array.isArray(value.files) ||
    value.files.length !== value.fileCount
  ) {
    throw new Error("Release-preflight source fingerprint is malformed.");
  }
  const digest = crypto.createHash("sha256");
  let previousFile = "";
  for (const entry of value.files) {
    const bytes = isRecord(entry) ? entry.bytes : undefined;
    if (
      !isRecord(entry) ||
      !hasExactObjectKeys(entry, ["bytes", "file", "sha256"]) ||
      typeof entry.file !== "string" ||
      !entry.file ||
      entry.file.includes("\0") ||
      path.posix.isAbsolute(entry.file) ||
      path.posix.normalize(entry.file) !== entry.file ||
      entry.file.startsWith("../") ||
      entry.file <= previousFile ||
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error("Release-preflight source fingerprint contains a malformed file entry.");
    }
    previousFile = entry.file;
    digest.update(`${entry.file}\0${bytes}\0${entry.sha256}\n`);
  }
  if (digest.digest("hex") !== value.sha256) {
    throw new Error("Release-preflight source fingerprint digest does not match its file inventory.");
  }
  return { sha256: value.sha256, fileCount: value.fileCount };
}

function validateAbortedPrewriteSafetyChecks(value: unknown, sourceSha256: string) {
  const expected = [
    ["local build and test gates", "cloudflare/local-gates-report.json"],
    ["source secret scan", "cloudflare/source-secret-scan-report.json"],
    ["OpenNext build artifact secret scan", "cloudflare/build-artifact-scan-report.json"],
  ] as const;
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error("Release-preflight evidence omitted its exact passing safety checks.");
  }
  for (const [index, [name, report]] of expected.entries()) {
    const check = value[index];
    const detail = isRecord(check) ? check.detail : undefined;
    if (
      !isRecord(check) ||
      !hasExactObjectKeys(check, ["detail", "name", "status"]) ||
      check.name !== name ||
      check.status !== "pass" ||
      !isRecord(detail) ||
      !hasExactObjectKeys(detail, ["report", "sourceFingerprint"]) ||
      detail.report !== report ||
      detail.sourceFingerprint !== sourceSha256
    ) {
      throw new Error("Release-preflight evidence contains a malformed safety check.");
    }
  }
}

function parseAbortedPrewriteArtifactManifest(
  value: unknown,
  label: string,
): WorkerDeployArtifactManifest {
  if (
    !isRecord(value) ||
    !hasExactObjectKeys(value, ["bytes", "fileCount", "root", "sha256"]) ||
    typeof value.root !== "string" ||
    !path.isAbsolute(value.root) ||
    !isPositiveSafeInteger(value.fileCount) ||
    !isPositiveSafeInteger(value.bytes) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    throw new Error(`${label} is malformed.`);
  }
  return {
    root: value.root,
    fileCount: value.fileCount,
    bytes: value.bytes,
    sha256: value.sha256,
  };
}

function buildAbortedPrewriteRecoveryPlan(
  sourceFingerprint: D1ReleaseSourceIdentity,
  candidateVersionId: string,
  releasePreflightRunId?: string,
) {
  const translations = loadAndValidateTranslationSeed();
  const marketingSite = loadReleasedMarketingSiteRepairCorpus();
  const marketingSiteRepairPlan = buildMarketingSiteRepairPlan(marketingSite);
  const curatedRepairRows = loadCuratedNamespaceRepairRows();
  const curatedRepairPlan = buildCuratedNamespaceRepairPlan(curatedRepairRows);
  const mainAppRepairRows = loadMainAppRepairRows();
  const mainAppRepairPlan = buildMainAppRepairPlan(mainAppRepairRows);
  validateSiteSourceManifestFreshness();
  validateSourceContract();
  const repairSql = fs.readFileSync(repairSqlPath, "utf8");
  validateRepairSql(repairSql);
  const completeRepairSql = buildAtomicSeoCtaRepairSql(
    curatedRepairPlan.legacyPrerequisiteSql,
    repairSql,
    curatedRepairPlan.postLegacyCanonicalSql,
    marketingSiteRepairPlan.sql,
    mainAppRepairPlan.sql,
    buildExactTranslationPartitionGuardSql(),
  );
  const coldSourceSync = buildSiteTranslationSourceSyncPlan();
  const planSha256 = translationRepairBudgetPlanSha256({
    candidateVersionId,
    sourceFingerprint,
    repairSqlSha256: sha256(completeRepairSql),
    sourceSyncSha256: coldSourceSync.sha256,
    curatedCorpusSha256: curatedRepairPlan.corpusSha256,
    marketingSiteCorpusSha256: marketingSiteRepairPlan.corpusSha256,
  });
  const legacyOperationId = translationRepairBudgetOperationId({
    candidateVersionId,
    sourceFingerprint,
    planSha256,
  });
  return {
    translations,
    curatedRepairRows,
    marketingSite,
    mainAppRepairRows,
    operationId: translationRepairBudgetOperationId({
      candidateVersionId,
      sourceFingerprint,
      planSha256,
      ...(releasePreflightRunId ? { releasePreflightRunId } : {}),
    }),
    legacyOperationId,
  };
}

function existingExactReservationResult(input: {
  ledgerPath: string;
  ledger: D1ReleaseBudgetLedger;
  reservation: D1ReleaseBudgetLedgerReservation;
}): D1ReleaseBudgetReservationResult {
  const reservation = input.reservation;
  return {
    ledgerPath: input.ledgerPath,
    utcDay: input.ledger.utcDay,
    revision: input.ledger.revision,
    idempotent: true,
    reservation: {
      operationId: reservation.operationId,
      operation: reservation.operation,
      candidateVersionId: reservation.candidateVersionId,
      phase: reservation.phase,
      rowsRead: reservation.rowsRead,
      rowsWritten: reservation.rowsWritten,
      maximumRowsRead: reservation.maximumRowsRead,
      maximumRowsWritten: reservation.maximumRowsWritten,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    },
    totals: input.ledger.totals,
    accountedUsage: input.ledger.accountedUsage,
  };
}

function assertAbortedPrewriteArtifactsAbsent(backupDir: string, runId: string) {
  const unresolvedMarkerPath = path.join(cloudflareDir(backupDir), unresolvedRepairMarkerFile);
  if (pathEntryExistsNoFollow(unresolvedMarkerPath)) {
    throw new Error(
      `An unresolved D1 translation repair already exists at ${unresolvedMarkerPath}. Resolve it explicitly before starting another run.`,
    );
  }
  const prewriteEvidencePath = path.join(
    cloudflareDir(backupDir),
    `d1-translation-repair-prewrite-${runId}.json`,
  );
  if (pathEntryExistsNoFollow(prewriteEvidencePath)) {
    throw new Error("Prewrite-abort refinement found durable prewrite evidence; zero work is unproven.");
  }
}

function assertAbortedCandidateUnfrozen(input: {
  expectedVersionId: string;
  readActiveWorkerVersion: () => string;
  probeCandidate: (candidateVersionId: string) => NativeMaintenanceProbe;
}) {
  const activeVersion = requireLowercaseWorkerVersion(
    input.readActiveWorkerVersion(),
    "active Worker version",
  );
  if (activeVersion !== input.expectedVersionId) {
    throw new Error("Prewrite-abort refinement candidate is no longer the sole active Worker.");
  }
  const probe = validateNativeMaintenanceProbe(
    input.probeCandidate(input.expectedVersionId),
    false,
  );
  if (probe.versionId !== input.expectedVersionId) {
    throw new Error("Prewrite-abort refinement candidate probe returned a different Worker version.");
  }
  return activeVersion;
}

function assertReadOnlyRepairRequiredDrift(report: RemoteTranslationDriftReport) {
  const readOnly = report.readOnly;
  if (
    report.mode !== "remote-verify-only" ||
    report.database !== D1_DATABASE_NAME ||
    report.ok ||
    !report.repairRequired ||
    report.status !== "repair-required" ||
    report.issues.length === 0 ||
    !Number.isSafeInteger(report.expected.remoteQueries) ||
    report.expected.remoteQueries < remoteTranslationVerificationFixedQueryCount + 2 ||
    readOnly.remoteQueries !== report.expected.remoteQueries ||
    !Number.isSafeInteger(readOnly.billedRowsRead) ||
    readOnly.billedRowsRead <= 0 ||
    readOnly.billedRowsRead > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
    !Number.isSafeInteger(report.sourceSnapshot.snapshotBilledRowReads) ||
    report.sourceSnapshot.snapshotBilledRowReads < 0 ||
    readOnly.billedRowsRead < report.sourceSnapshot.snapshotBilledRowReads ||
    readOnly.workerUploads !== 0 ||
    readOnly.workerDeployments !== 0 ||
    readOnly.maintenanceActivations !== 0 ||
    readOnly.timeTravelReads !== 0 ||
    readOnly.sqlImports !== 0 ||
    readOnly.databaseWrites !== 0 ||
    readOnly.unresolvedMarkersCreated !== 0 ||
    readOnly.preWriteEvidenceCreated !== 0 ||
    readOnly.reportsWritten !== 0
  ) {
    throw new Error(
      "Prewrite-abort refinement requires deterministic read-only proof that repair drift remains.",
    );
  }
}

/**
 * Proves that translation work is operating on the exact clean, pushed,
 * deployed candidate and consumes both earlier release-stage attestations.
 * This gate contains no D1 command and must complete before translation code
 * performs its first production D1 read or write.
 */
export function assertRemoteTranslationSequenceGate(
  input: {
    backupDir: string;
    candidateVersionId: string;
    cwd?: string;
  },
  dependencies: RemoteTranslationSequenceGateDependencies = {},
): RemoteTranslationSequenceGateResult {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const backupDir = path.resolve(input.backupDir);
  const upload = (
    dependencies.readUploadEvidence ?? readWorkerCandidateUploadEvidence
  )(workerCandidateUploadEvidencePath(backupDir));
  if (upload.value.targetCandidateVersionId !== candidateVersionId) {
    throw new Error(
      `Translation reconciliation expected uploaded candidate ${candidateVersionId}; canonical upload evidence names ${upload.value.targetCandidateVersionId}.`,
    );
  }
  const git = (dependencies.readGitIdentity ??
    ((gitCwd: string) => assertGitReleaseIdentity({ cwd: gitCwd })))(cwd);
  const artifactEvidence = (
    dependencies.buildArtifactEvidence ?? buildWorkerDeployArtifactEvidence
  )(cwd);
  const activeVersionId = requireWorkerVersion(
    (dependencies.readActiveVersion ?? requireSoleActiveWorkerVersion)(),
  );
  if (activeVersionId !== upload.value.serviceBaselineVersionId) {
    throw new Error(
      `Translation reconciliation requires service baseline ${upload.value.serviceBaselineVersionId} alone at 100% while candidate ${candidateVersionId} remains inactive; received ${activeVersionId}.`,
    );
  }
  const currentRelease: ReleaseSequenceCurrentRelease = {
    phase: "uploaded-inactive",
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: upload.sha256,
    phaseEvidenceCreatedAt: upload.value.createdAt,
    soleServingVersionId: upload.value.serviceBaselineVersionId,
    git,
    artifactEvidence,
  };
  (
    dependencies.assertCurrentReleaseBinding ??
    assertReleaseSequenceCurrentReleaseBinding
  )({ backupDir, currentRelease });
  const vectorizeReadiness = (
    dependencies.validateVectorizeReadiness ?? assertFreshProductionVectorizeReadiness
  )({ backupDir, currentRelease, requiredPhase: "uploaded-inactive" });
  const topicAttestation = (
    dependencies.validateTopicReconciliation ??
    assertProductionTopicReconciliationReleaseBinding
  )({ backupDir, currentRelease });
  return { currentRelease, vectorizeReadiness, topicAttestation };
}

export function repairSeoCtaTranslations(
  options: RepairSeoCtaTranslationOptions & { remote: true; verifyOnly: true },
): RemoteTranslationDriftReport;
export function repairSeoCtaTranslations(
  options: RepairSeoCtaTranslationOptions & { verifyOnly?: false },
): RepairReport;
export function repairSeoCtaTranslations(
  options: RepairSeoCtaTranslationOptions,
): RepairReport | RemoteTranslationDriftReport;
export function repairSeoCtaTranslations(
  options: RepairSeoCtaTranslationOptions,
): RepairReport | RemoteTranslationDriftReport {
  if (options.verifyOnly && !options.remote) {
    throw new Error("Production translation verification requires --remote.");
  }
  if (options.remote && !options.confirmed) {
    throw new Error(
      options.verifyOnly
        ? "Production translation verification requires --confirm-production."
        : "Remote SEO translation repair requires --confirm-production.",
    );
  }
  if (options.remote && !options.verifyOnly && options.nativeWriteFreezeConfirmed !== true) {
    throw new Error(
      "Remote SEO translation repair requires --confirm-native-write-freeze so the native Worker can enter read-only maintenance.",
    );
  }
  if (options.remote && !isWorkerVersionId(options.candidateVersion)) {
    throw new Error(
      options.verifyOnly
        ? "Production translation verification requires --candidate-version with the exact validated Worker version UUID."
        : "Remote SEO translation repair requires --candidate-version with the exact validated Worker version UUID.",
    );
  }
  const candidateVersion =
    options.remote
      ? requireWorkerVersion(options.candidateVersion)
      : undefined;

  const translations = loadAndValidateTranslationSeed();
  const marketingSite = loadReleasedMarketingSiteRepairCorpus();
  const marketingSiteRepairPlan = buildMarketingSiteRepairPlan(marketingSite);
  const curatedRepairRows = loadCuratedNamespaceRepairRows();
  const curatedRepairPlan = buildCuratedNamespaceRepairPlan(curatedRepairRows);
  const mainAppRepairRows = loadMainAppRepairRows();
  const mainAppRepairPlan = buildMainAppRepairPlan(mainAppRepairRows);
  const manifestNamespacesVerified = validateSiteSourceManifestFreshness();
  const sourceHashes = validateSourceContract();
  if (options.verifyOnly) {
    const sequence = (options.releaseSequenceGate ?? assertRemoteTranslationSequenceGate)({
      backupDir: options.backupDir,
      candidateVersionId: requireWorkerVersion(candidateVersion),
    });
    writeTranslationReconciliationPending({
      createdAt: readTranslationAttestationClock(options.attestationClock, "verify-only start"),
      backupDir: options.backupDir,
      currentRelease: sequence.currentRelease,
      vectorizeReadiness: sequence.vectorizeReadiness,
      topicAttestation: sequence.topicAttestation,
      method: "read-only-drift",
    });
    const drift = verifyRemoteTranslationDrift({
      translations,
      curatedRepairRows,
      marketingSite,
      mainAppRepairRows,
      runner: options.runner ?? runWrangler,
      now: options.now ?? Date.now(),
    });
    if (drift.ok && drift.status === "reconciled" && !drift.repairRequired) {
      writeTranslationReconciliationSuccess({
        createdAt: readTranslationAttestationClock(options.attestationClock, "verify-only success"),
        backupDir: options.backupDir,
        currentRelease: sequence.currentRelease,
        vectorizeReadiness: sequence.vectorizeReadiness,
        topicAttestation: sequence.topicAttestation,
        method: "read-only-drift",
        remoteQueries: drift.readOnly.remoteQueries,
        billedRowsRead: drift.readOnly.billedRowsRead,
      });
    }
    return drift;
  }
  const repairSql = fs.readFileSync(repairSqlPath, "utf8");
  validateRepairSql(repairSql);
  // The v7 curated corpus is authoritative for every site route. The only
  // intervening legacy statement is the marketing-site retired-key cleanup,
  // which is forbidden from changing route rows or provenance metadata.
  const completeRepairSql = buildAtomicSeoCtaRepairSql(
    curatedRepairPlan.legacyPrerequisiteSql,
    repairSql,
    curatedRepairPlan.postLegacyCanonicalSql,
    marketingSiteRepairPlan.sql,
    mainAppRepairPlan.sql,
    buildExactTranslationPartitionGuardSql(),
  );
  const coldSourceSync = buildSiteTranslationSourceSyncPlan();
  assertSourceSyncReadBudget(coldSourceSync);
  const maximumStaticRepairRows = staticRepairNamespaces.length * translations.size;
  const localTranslationProjectedBilledRowWrites = projectRepairBilledRowWrites(
    0,
    maximumStaticRepairRows,
    curatedRepairPlan.logicalRowWrites,
    marketingSiteRepairPlan.logicalRowWrites,
    mainAppRepairPlan.logicalRowWrites,
  );
  assertRepairWriteBudget(localTranslationProjectedBilledRowWrites);
  const coldCombinedProjectedBilledRowWrites = projectRepairBilledRowWrites(
    coldSourceSync.projectedBilledRowWrites,
    maximumStaticRepairRows,
    curatedRepairPlan.logicalRowWrites,
    marketingSiteRepairPlan.logicalRowWrites,
    mainAppRepairPlan.logicalRowWrites,
  );
  const coldCombinedWriteBudgetAdmissible =
    coldCombinedProjectedBilledRowWrites <=
    MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES;
  const coldProjectedBilledRowReads = projectRepairBilledRowReads(
    coldSourceSync.projectedBilledRowReads,
    maximumStaticRepairRows,
    curatedRepairRows.length,
    marketingSite.rows.length,
    mainAppRepairRows.length,
  );
  assertRepairReadBudget(coldProjectedBilledRowReads);
  const coldAtomicSql = buildAtomicSeoCtaRepairSql(coldSourceSync.sql, completeRepairSql);
  const common = {
    createdAt: new Date().toISOString(),
    database: D1_DATABASE_NAME,
    translationCount: translations.size,
    curatedTranslationRows: curatedRepairRows.length,
    curatedRepairStatements:
      curatedRepairPlan.resetStatements + curatedRepairPlan.patchStatements,
    curatedRepairLogicalRowWrites: curatedRepairPlan.logicalRowWrites,
    curatedPayloadBytes: curatedRepairPlan.payloadBytes,
    largestCuratedPayloadBytes: curatedRepairPlan.largestPayloadBytes,
    curatedCorpusSha256: curatedRepairPlan.corpusSha256,
    largestCuratedRepairStatementBytes: curatedRepairPlan.largestStatementBytes,
    marketingSiteTranslationRows: marketingSite.rows.length,
    marketingSiteRepairStatements:
      marketingSiteRepairPlan.resetStatements +
      marketingSiteRepairPlan.patchStatements,
    marketingSiteRepairLogicalRowWrites:
      marketingSiteRepairPlan.logicalRowWrites,
    marketingSitePayloadBytes: marketingSiteRepairPlan.payloadBytes,
    largestMarketingSitePayloadBytes:
      marketingSiteRepairPlan.largestPayloadBytes,
    marketingSiteComposedCorpusSha256:
      marketingSiteRepairPlan.corpusSha256,
    marketingSiteDeltaCorpusSha256:
      marketingSiteRepairPlan.deltaCorpusSha256,
    marketingSiteModel: marketingSiteRepairPlan.model,
    largestMarketingSiteRepairStatementBytes:
      marketingSiteRepairPlan.largestStatementBytes,
    mainAppTranslationRows: mainAppRepairRows.length,
    mainAppRepairStatements:
      mainAppRepairPlan.resetStatements + mainAppRepairPlan.patchStatements,
    mainAppRepairLogicalRowWrites: mainAppRepairPlan.logicalRowWrites,
    largestMainAppRepairStatementBytes: mainAppRepairPlan.largestStatementBytes,
    largestMainAppPayloadBytes: mainAppRepairPlan.largestPayloadBytes,
    manifestNamespacesVerified,
    sourceHashes,
    repairSqlSha256: sha256(completeRepairSql),
    repairSqlBytes: Buffer.byteLength(completeRepairSql, "utf8"),
    repairSqlStatements: splitSqlStatements(completeRepairSql).length,
    atomicSqlBytes: Buffer.byteLength(coldAtomicSql, "utf8"),
    atomicSqlStatements: splitSqlStatements(coldAtomicSql).length,
    largestAtomicSqlStatementBytes: largestSqlStatementBytes(coldAtomicSql),
    d1FileImportByteLimit: maximumD1FileImportBytes,
    executionMode: "single-transaction-wrangler-import" as const,
    exactTranslationPartitions: {
      curatedSiteRows: LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT,
      marketingSiteRows: LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT,
      siteRows: LEGACY_MARKETING_SITE_EXPECTED_SITE_ROW_COUNT,
      mainAppRows: LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT,
      finalRows: LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT,
    },
    maintenance: {
      runtime: "native-cloudflare-worker" as const,
      openNext: false as const,
      activated: false,
      released: false,
    },
    sourceSyncSha256: coldSourceSync.sha256,
    sourceSyncStatements: coldSourceSync.statements,
    sourceSyncLogicalRowWrites: coldSourceSync.logicalRowWrites,
    staticRepairRows: maximumStaticRepairRows,
    // A completely empty D1 cannot fit both the source snapshot and the full
    // translation corpus into one Free-plan write day. Local verification
    // proves the immutable corpus and its translation-only ceiling while
    // reporting that cold combined fact explicitly. Only the remote-diff path
    // can admit a mutation, after measuring live source drift under the
    // maximum ledger reservation and the native write freeze.
    projectionBasis: "local-static-proof" as const,
    projectedBilledRowWrites: localTranslationProjectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    coldCombinedProjectedBilledRowWrites,
    coldCombinedWriteBudgetAdmissible,
    projectedBilledRowReads: coldProjectedBilledRowReads,
    projectedBilledRowReadLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
  };

  if (!options.remote) {
    const report: RepairReport = {
      ...common,
      mode: "verify",
      ok: true,
      timeTravelVerified: false,
    };
    writeReport(report, options.backupDir);
    return report;
  }

  const remoteCandidateVersion = requireWorkerVersion(candidateVersion);
  const initialReleaseSequence = (
    options.releaseSequenceGate ?? assertRemoteTranslationSequenceGate
  )({
    backupDir: options.backupDir,
    candidateVersionId: remoteCandidateVersion,
  });
  writeTranslationReconciliationPending({
    createdAt: readTranslationAttestationClock(options.attestationClock, "atomic repair start"),
    backupDir: options.backupDir,
    currentRelease: initialReleaseSequence.currentRelease,
    vectorizeReadiness: initialReleaseSequence.vectorizeReadiness,
    topicAttestation: initialReleaseSequence.topicAttestation,
    method: "atomic-repair",
  });
  assertNoUnresolvedTranslationRepair(options.backupDir);
  const releasePreflight = assertRemoteRepairReleasePreflight({
    backupDir: options.backupDir,
    candidateVersionId: remoteCandidateVersion,
  });
  const maintenanceRepairRunId = productionMaintenanceRepairRunId(releasePreflight.runId);
  const budgetClock = translationRepairClock(options);
  const budgetStartedAt = readTranslationRepairClock(
    budgetClock,
    "translation-repair budget start",
  );
  const budgetSourceFingerprint = releaseBudgetSourceIdentity(
    releasePreflight.sourceFingerprint,
  );
  const budgetPlanSha256 = translationRepairBudgetPlanSha256({
    candidateVersionId: releasePreflight.candidateVersionId,
    sourceFingerprint: budgetSourceFingerprint,
    repairSqlSha256: sha256(completeRepairSql),
    sourceSyncSha256: coldSourceSync.sha256,
    curatedCorpusSha256: curatedRepairPlan.corpusSha256,
    marketingSiteCorpusSha256: marketingSiteRepairPlan.corpusSha256,
  });
  const budgetOperationId = translationRepairBudgetOperationId({
    candidateVersionId: releasePreflight.candidateVersionId,
    sourceFingerprint: budgetSourceFingerprint,
    planSha256: budgetPlanSha256,
    releasePreflightRunId: releasePreflight.runId,
  });
  const accountDailyUsage =
    options.dailyUsage ?? loadAccountD1DailyUsage(budgetStartedAt);
  assertD1FreeDailyBudget(accountDailyUsage, {
    operation: "Remote SEO translation repair preflight",
    rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
    rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  });
  let budgetReservation: D1ReleaseBudgetReservationResult = reserveD1ReleaseBudget({
    backupDir: options.backupDir,
    operationId: budgetOperationId,
    operation: "Remote SEO translation repair",
    candidateVersionId: releasePreflight.candidateVersionId,
    sourceFingerprint: budgetSourceFingerprint,
    phase: "maximum",
    rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
    rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    observedUsage: accountDailyUsage,
    now: budgetStartedAt,
  });
  let maintenanceActivated = false;
  let maintenanceReleased = false;
  let activeProbe: NativeMaintenanceProbe | undefined;
  let releasedProbe: NativeMaintenanceProbe | undefined;
  let operationError: unknown;
  let releaseError: unknown;
  let maintenanceVersionId = "";
  let importAttempted = false;
  let importResponseConfirmed = false;
  let importVerification: ImportVerificationState = "not-attempted";
  let productionVerification: ReturnType<typeof verifyRemoteRepair> | null = null;
  let d1StorageAdmission: D1StorageAdmissionProjection | undefined;
  let timeTravelBookmark = "";
  let preWriteEvidencePath = "";
  let staticRepairRows = 0;
  let sourceSync: ReturnType<typeof planSiteTranslationSourceSync> | null = null;
  let projectedBilledRowWrites = 0;
  let projectedBilledRowReads = 0;
  let remoteAtomicSql = "";
  let maintenanceExclusion: ProductionValidationExclusion | null = null;
  let maintenanceState: ProductionMaintenanceState | null = null;
  const readOnlyBilling = { queries: 0, billedRowsRead: 0 };
  const meteredReadOnlyRunner = readOnlyRemoteVerificationRunner(runWrangler, readOnlyBilling);
  let importBilling: D1Billing | null = null;

  try {
    assertNoLiveProductionValidationLock();
    maintenanceExclusion = acquireProductionValidationExclusion({
      candidateVersionId: releasePreflight.serviceBaselineVersionId,
      sourceFingerprintSha256: releasePreflight.sourceFingerprint.sha256,
    });
    assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
    maintenanceVersionId = uploadNativeMaintenanceVersion(releasePreflight);
    maintenanceState = {
      candidateVersionId: releasePreflight.serviceBaselineVersionId,
      lockRunId: maintenanceExclusion.owner.runId,
      maintenanceVersionId,
      repairRunId: maintenanceRepairRunId,
      sourceFingerprintSha256: releasePreflight.sourceFingerprint.sha256,
      startedAt: Date.now(),
    };
    const persistedMaintenance = createProductionMaintenanceState({
      exclusion: maintenanceExclusion,
      state: maintenanceState,
    });
    maintenanceExclusion = persistedMaintenance.exclusion;
    maintenanceState = persistedMaintenance.state;
    maintenanceExclusion = attestProductionValidationExclusion(maintenanceExclusion);
    assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
    assertRemoteRepairActivationPreflight(releasePreflight);
    deployPinnedWorkerVersion(
      maintenanceVersionId,
      "Native D1 translation maintenance: writes frozen",
    );
    // The deployment-status readback inside deployPinnedWorkerVersion is the
    // authoritative activation confirmation. Mark it before the HTTP probe so
    // a transient probe failure still restores the captured candidate.
    maintenanceActivated = true;
    activeProbe = probeNativeWriteFreeze(true, maintenanceVersionId);
    maintenanceExclusion = attestProductionValidationExclusion(maintenanceExclusion);
    assertProductionValidationExclusionCommandWindow(maintenanceExclusion);

    staticRepairRows = validateRemoteRepairTargets(
      translations,
      curatedRepairRows,
      marketingSite,
      mainAppRepairRows,
      meteredReadOnlyRunner,
    );
    sourceSync = planSiteTranslationSourceSync("remote", meteredReadOnlyRunner);
    assertSourceSyncReadBudget(sourceSync);
    projectedBilledRowWrites = projectRepairBilledRowWrites(
      sourceSync.projectedBilledRowWrites,
      staticRepairRows,
      curatedRepairPlan.logicalRowWrites,
      marketingSiteRepairPlan.logicalRowWrites,
      mainAppRepairPlan.logicalRowWrites,
    );
    assertRepairWriteBudget(projectedBilledRowWrites);
    projectedBilledRowReads = projectRepairBilledRowReads(
      sourceSync.projectedBilledRowReads,
      staticRepairRows,
      curatedRepairRows.length,
      marketingSite.rows.length,
      mainAppRepairRows.length,
    );
    assertRepairReadBudget(projectedBilledRowReads);
    assertD1FreeDailyBudget(accountDailyUsage, {
      operation: "Remote SEO translation repair",
      rowsRead: projectedBilledRowReads,
      rowsWritten: projectedBilledRowWrites,
    });
    remoteAtomicSql = buildAtomicSeoCtaRepairSql(sourceSync.sql, completeRepairSql);
    const exactTranslationStorageRows = buildExactTranslationStorageRows({
      curatedRows: curatedRepairRows,
      marketingSite,
      mainAppRows: mainAppRepairRows,
    });
    const exactSourceStorageEntries = buildSiteSourceStorageEntries();
    const initialD1DatabaseStorageInfo = assertExactProductionD1StorageIdentity(
      readD1DatabaseStorageInfo(runWrangler),
    );
    d1StorageAdmission = buildExactD1StorageAdmission({
      database: initialD1DatabaseStorageInfo,
      translationRows: exactTranslationStorageRows,
      sourceEntries: exactSourceStorageEntries,
    });
    timeTravelBookmark = parseD1TimeTravelBookmark(
      runWrangler([
        "d1",
        "time-travel",
        "info",
        D1_DATABASE_NAME,
        "--json",
      ]),
    );
    preWriteEvidencePath = writePreWriteDiagnosticEvidence({
      backupDir: options.backupDir,
      runId: releasePreflight.runId,
      candidateVersionId: releasePreflight.candidateVersionId,
      maintenanceVersionId,
      releasePreflightEvidencePath: releasePreflight.evidencePath,
      bookmark: timeTravelBookmark,
      atomicSql: remoteAtomicSql,
      activeProbe,
      projectedBilledRowReads,
      projectedBilledRowWrites,
      d1StorageAdmission,
      d1ReleaseBudget: budgetReservation,
    });

    const atomicSqlPath = writeTemporarySqlFile(
      remoteAtomicSql,
      "atomic-seo-cta-translation-repair.sql",
    );
    const initialAtomicSqlAttestation = attestTemporarySqlFile(
      atomicSqlPath,
      remoteAtomicSql,
    );
    let atomicSqlRemoved = false;
    let atomicSqlOperationError: unknown;
    try {
      // D1's import path is the one unavoidable database maintenance window.
      // The native Worker is already write-frozen and the diagnostic bookmark is
      // durably recorded before this single transactional import begins.
      const liveArtifacts = assertRepairArtifactEvidenceUnchanged(releasePreflight);
      assertTranslationRepairPayloadInputsUnchanged({
        expectedCuratedCorpusSha256: curatedRepairPlan.corpusSha256,
        expectedMarketingSiteCorpusSha256:
          marketingSiteRepairPlan.corpusSha256,
        expectedMainAppRepairSqlSha256: sha256(mainAppRepairPlan.sql),
      });
      const liveSourceFingerprint = releaseBudgetSourceIdentity(
        liveArtifacts.sourceFingerprint,
      );
      const livePlanSha256 = translationRepairBudgetPlanSha256({
        candidateVersionId: releasePreflight.candidateVersionId,
        sourceFingerprint: liveSourceFingerprint,
        repairSqlSha256: sha256(completeRepairSql),
        sourceSyncSha256: coldSourceSync.sha256,
        curatedCorpusSha256: curatedRepairPlan.corpusSha256,
        marketingSiteCorpusSha256: marketingSiteRepairPlan.corpusSha256,
      });
      const liveOperationId = translationRepairBudgetOperationId({
        candidateVersionId: releasePreflight.candidateVersionId,
        sourceFingerprint: liveSourceFingerprint,
        planSha256: livePlanSha256,
        releasePreflightRunId: releasePreflight.runId,
      });
      if (livePlanSha256 !== budgetPlanSha256 || liveOperationId !== budgetOperationId) {
        throw new Error("Remote translation repair plan drifted before its D1 write.");
      }
      budgetReservation = assertD1ReleaseBudgetReservation({
        ledgerPath: budgetReservation.ledgerPath,
        utcDay: budgetReservation.utcDay,
        operationId: budgetOperationId,
        candidateVersionId: releasePreflight.candidateVersionId,
        sourceFingerprint: liveSourceFingerprint,
        phase: "maximum",
        rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
        rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
        now: readTranslationRepairClock(
          budgetClock,
          "translation-repair pre-write ledger validation",
        ),
      });
      assertD1ReleaseBudgetUtcDay(
        budgetReservation.utcDay,
        readTranslationRepairClock(
          budgetClock,
          "translation-repair final pre-write UTC day",
        ),
      );
      if (!maintenanceExclusion) {
        throw new Error("Remote translation repair lost its deployment exclusion before import.");
      }
      maintenanceExclusion = attestProductionValidationExclusion(maintenanceExclusion);
      assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
      d1StorageAdmission = revalidateExactD1StorageAdmission({
        initialDatabase: initialD1DatabaseStorageInfo,
        currentDatabase: readD1DatabaseStorageInfo(runWrangler),
        translationRows: exactTranslationStorageRows,
        sourceEntries: exactSourceStorageEntries,
      });
      try {
        const immediatelyBeforeImport = attestTemporarySqlFile(
          atomicSqlPath,
          remoteAtomicSql,
        );
        assertSameTemporarySqlFileAttestation(
          initialAtomicSqlAttestation,
          immediatelyBeforeImport,
        );
      } catch (error) {
        importVerification = "indeterminate";
        throw new TemporarySqlFileIntegrityError(
          "The atomic translation SQL file failed exact attestation immediately before Wrangler could consume it.",
          { cause: error },
        );
      }
      importAttempted = true;
      let importTransportError: unknown;
      let importOutput: string | undefined;
      try {
        importOutput = runBoundedMutationWrangler(
          [
            "d1",
            "execute",
            D1_DATABASE_NAME,
            "--remote",
            "--file",
            atomicSqlPath,
            "--yes",
            "--json",
          ],
          { maxBuffer: 128 * 1024 * 1024 },
        );
      } catch (error) {
        // The ingestion may have committed even if Wrangler lost its final
        // poll response. Exact verification below is authoritative.
        importTransportError = error;
      }
      let immediatelyAfterImport: ReturnType<typeof attestTemporarySqlFile>;
      try {
        immediatelyAfterImport = attestTemporarySqlFile(
          atomicSqlPath,
          remoteAtomicSql,
        );
        assertSameTemporarySqlFileAttestation(
          initialAtomicSqlAttestation,
          immediatelyAfterImport,
        );
      } catch (error) {
        importVerification = "indeterminate";
        throw new TemporarySqlFileIntegrityError(
          "The atomic translation SQL file changed while Wrangler could consume it; production state is indeterminate and must be verified before retry.",
          {
            cause:
              importTransportError === undefined
                ? error
                : new AggregateError(
                    [importTransportError, error],
                    "Wrangler and atomic SQL attestation both failed.",
                  ),
          },
        );
      }
      try {
        removeAttestedTemporarySqlFile(
          immediatelyAfterImport,
          remoteAtomicSql,
        );
        atomicSqlRemoved = true;
      } catch (error) {
        importVerification = "indeterminate";
        throw new TemporarySqlFileIntegrityError(
          "The attested atomic translation SQL file could not be removed through its exact private-file identity.",
          {
            cause:
              importTransportError === undefined
                ? error
                : new AggregateError(
                    [importTransportError, error],
                    "Wrangler and atomic SQL cleanup both failed.",
                  ),
          },
        );
      }
      if (importOutput !== undefined) {
        try {
          importBilling = parseD1Billing(importOutput, {
            label: "atomic translation import",
            expectedResultSets: 1,
          });
          importResponseConfirmed = true;
        } catch (error) {
          importTransportError = error;
        }
      }
      maintenanceExclusion = attestProductionValidationExclusion(maintenanceExclusion);
      assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
      try {
        productionVerification = verifyRemoteRepair(
          translations,
          curatedRepairRows,
          marketingSite,
          mainAppRepairRows,
          meteredReadOnlyRunner,
        );
        assertRemoteRepairBillingWithinMaximum({
          readOnlyRowsRead: readOnlyBilling.billedRowsRead,
          importBilling,
        });
        assertD1ReleaseBudgetUtcDay(
          budgetReservation.utcDay,
          readTranslationRepairClock(
            budgetClock,
            "translation-repair post-verification UTC day",
          ),
        );
        importVerification = "verified";
      } catch (error) {
        importVerification =
          error instanceof RemoteVerificationMismatchError ? "mismatch" : "indeterminate";
        throw new AggregateError(
          [importTransportError, error].filter((entry) => entry !== undefined),
          importVerification === "mismatch"
            ? "Imported translation state failed exact verification."
            : "Imported translation state could not be verified deterministically.",
        );
      }
    } catch (error) {
      atomicSqlOperationError = error;
    }
    if (!atomicSqlRemoved) {
      try {
        removeAttestedTemporarySqlFile(
          initialAtomicSqlAttestation,
          remoteAtomicSql,
        );
        atomicSqlRemoved = true;
      } catch (error) {
        importVerification = "indeterminate";
        atomicSqlOperationError = new TemporarySqlFileIntegrityError(
          "The atomic translation SQL file could not be securely cleaned up through its original attestation.",
          {
            cause:
              atomicSqlOperationError === undefined
                ? error
                : new AggregateError(
                    [atomicSqlOperationError, error],
                    "Atomic SQL operation and exact cleanup both failed.",
                  ),
          },
        );
      }
    }
    if (atomicSqlOperationError !== undefined) {
      throw atomicSqlOperationError;
    }
  } catch (error) {
    operationError = error;
  } finally {
    let exclusionOwned = true;
    if (maintenanceExclusion) {
      try {
        maintenanceExclusion = attestProductionValidationExclusion(maintenanceExclusion);
      } catch (error) {
        exclusionOwned = false;
        releaseError = error;
      }
    }
    const recovery = decideImportRecovery({
      importAttempted,
      importResponseConfirmed,
      verification: importVerification,
    });
    if (maintenanceActivated) {
      // A mismatch or indeterminate read never triggers an automatic
      // whole-database restore: unrelated account/chat/memory writes may have
      // occurred after the bookmark. Cross-store quiescence is not provable on
      // Workers Free, so leave maintenance active for a reviewed forward correction.
      if (recovery.releaseAllowed && exclusionOwned) {
        try {
          if (!maintenanceExclusion) {
            throw new Error("Remote translation repair lost its deployment exclusion before candidate restore.");
          }
          assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
          deployPinnedWorkerVersion(
            releasePreflight.serviceBaselineVersionId,
            "Restore exact service baseline after D1 translation maintenance",
          );
          releasedProbe = probeNativeWriteFreeze(
            false,
            releasePreflight.serviceBaselineVersionId,
          );
          if (!maintenanceState) {
            throw new Error("Remote translation repair lost its durable maintenance state before resolution.");
          }
          const clearedMaintenance = clearProductionMaintenanceState({
            exclusion: maintenanceExclusion,
            state: maintenanceState,
          });
          maintenanceExclusion = clearedMaintenance.exclusion;
          maintenanceState = null;
          maintenanceReleased = true;
        } catch (error) {
          releaseError = error;
        }
      }
    }
    if (maintenanceExclusion) {
      const exclusionErrors: Error[] = [];
      if (exclusionOwned) {
        try {
          maintenanceExclusion = attestProductionValidationExclusion(maintenanceExclusion);
          assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
        } catch (error) {
          exclusionErrors.push(
            error instanceof Error ? error : new Error("Unknown maintenance exclusion failure."),
          );
        }
      }
      try {
        releaseProductionValidationExclusion(maintenanceExclusion);
      } catch (error) {
        exclusionErrors.push(
          error instanceof Error ? error : new Error("Unknown maintenance exclusion release failure."),
        );
      }
      if (exclusionErrors.length) {
        releaseError = new AggregateError(
          [...(releaseError ? [releaseError] : []), ...exclusionErrors],
          "Maintenance release and exclusion cleanup failed.",
        );
      }
    }
  }

  if (operationError || releaseError) {
    throw new AggregateError(
      [operationError, releaseError].filter((error) => error !== undefined),
      !maintenanceReleased && importAttempted
        ? "Remote translation verification failed or was indeterminate; destructive whole-database restore is unsupported on Free, so native maintenance remains active for a reviewed forward correction."
        : "Remote translation repair or pinned candidate release failed.",
    );
  }
  if (
    !sourceSync ||
    !timeTravelBookmark ||
    !preWriteEvidencePath ||
    !remoteAtomicSql ||
    !productionVerification
  ) {
    throw new Error("Remote translation repair completed without its required diagnostic evidence.");
  }
  resolveUnresolvedTranslationRepair({
    backupDir: options.backupDir,
    evidencePath: preWriteEvidencePath,
    candidateVersionId: releasePreflight.candidateVersionId,
    maintenanceVersionId,
  });
  const report: RepairReport = {
    ...common,
    mode: "remote",
    ok: true,
    preWriteEvidencePath,
    sourceSyncSha256: sourceSync.sha256,
    sourceSyncStatements: sourceSync.statements,
    sourceSyncLogicalRowWrites: sourceSync.logicalRowWrites,
    atomicSqlBytes: Buffer.byteLength(remoteAtomicSql, "utf8"),
    atomicSqlStatements: splitSqlStatements(remoteAtomicSql).length,
    largestAtomicSqlStatementBytes: largestSqlStatementBytes(remoteAtomicSql),
    staticRepairRows,
    projectionBasis: "remote-diff",
    projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    projectedBilledRowReads,
    projectedBilledRowReadLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
    timeTravelVerified: true,
    timeTravelBookmark,
    maintenance: {
      runtime: "native-cloudflare-worker",
      openNext: false,
      activated: maintenanceActivated,
      released: maintenanceReleased,
      importAttempted,
      importResponseConfirmed,
      importVerification,
      responseRecoveredByVerification: importAttempted && !importResponseConfirmed,
      candidateVersionId: releasePreflight.candidateVersionId,
      serviceBaselineVersionId: releasePreflight.serviceBaselineVersionId,
      uploadEvidenceSha256: releasePreflight.uploadEvidenceSha256,
      maintenanceVersionId,
      releasePreflightEvidencePath: releasePreflight.evidencePath,
      sourceFingerprintSha256: releasePreflight.sourceFingerprint.sha256,
      assetManifestSha256: releasePreflight.assetManifest.sha256,
      activeProbeVersionId: activeProbe?.versionId,
      releasedProbeVersionId: releasedProbe?.versionId,
    },
    accountDailyUsage,
    d1ReleaseBudget: {
      ledgerPath: budgetReservation.ledgerPath,
      utcDay: budgetReservation.utcDay,
      operationId: budgetReservation.reservation.operationId,
      revision: budgetReservation.revision,
      phase: budgetReservation.reservation.phase,
      rowsRead: budgetReservation.reservation.rowsRead,
      rowsWritten: budgetReservation.reservation.rowsWritten,
    },
    d1Billing: {
      readOnlyCommands: readOnlyBilling.queries,
      readOnlyRowsRead: readOnlyBilling.billedRowsRead,
      ...(importBilling
        ? {
            importRowsRead: importBilling.rowsRead,
            importRowsWritten: importBilling.rowsWritten,
          }
        : {}),
      controlRowsReadReserved: remoteRepairControlRowsReadReservation,
      controlRowsWrittenReserved: remoteRepairControlRowsWrittenReservation,
      disposition: importBilling
        ? "maximum-retained-metered"
        : "maximum-retained-import-unmetered",
    },
    d1StorageAdmission,
    productionVerification,
  };
  writeReport(report, options.backupDir);
  const finalReleaseSequence = (
    options.releaseSequenceGate ?? assertRemoteTranslationSequenceGate
  )({
    backupDir: options.backupDir,
    candidateVersionId: remoteCandidateVersion,
  });
  writeTranslationReconciliationSuccess({
    createdAt: readTranslationAttestationClock(options.attestationClock, "atomic repair success"),
    backupDir: options.backupDir,
    currentRelease: finalReleaseSequence.currentRelease,
    vectorizeReadiness: finalReleaseSequence.vectorizeReadiness,
    topicAttestation: finalReleaseSequence.topicAttestation,
    method: "atomic-repair",
    remoteQueries: readOnlyBilling.queries,
    billedRowsRead: readOnlyBilling.billedRowsRead,
  });
  return report;
}

export function buildAtomicSeoCtaRepairSql(...sqlParts: readonly string[]) {
  const statements = sqlParts.map((sql) => sql.trim()).filter(Boolean);
  if (!statements.length) throw new Error("Atomic SEO translation repair SQL must not be empty.");
  const sql = statements.join("\n") + "\n";
  assertNoExplicitTransactionControl(sql);
  assertD1SqlStatementSize(sql);
  const sqlBytes = Buffer.byteLength(sql, "utf8");
  if (sqlBytes > maximumD1FileImportBytes) {
    throw new Error(
      `Atomic D1 repair SQL exceeds the ${maximumD1FileImportBytes}-byte file import limit: ` +
        `${sqlBytes} bytes.`,
    );
  }
  return sql;
}

export function buildNativeMaintenanceUploadArgs(
  maintenanceEntryPath: string,
  versionTag: string,
  assetRoot = ".open-next/assets",
) {
  if (!maintenanceEntryPath || !versionTag || !assetRoot) {
    throw new Error("Native maintenance upload requires an entry point, version tag, and asset root.");
  }
  return [
    "versions",
    "upload",
    maintenanceEntryPath,
    "--name",
    workerName,
    "--assets",
    assetRoot,
    "--strict",
    "--keep-vars",
    "--var",
    "APP_WRITE_FREEZE:1",
    "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS:300",
    "--tag",
    versionTag,
    "--message",
    "Native D1 translation maintenance: writes frozen",
  ];
}

export function buildPinnedWorkerVersionDeployArgs(versionId: string, message: string) {
  return [
    "versions",
    "deploy",
    `${requireWorkerVersion(versionId)}@100`,
    "--name",
    workerName,
    "--yes",
    "--message",
    message,
  ];
}

export function uploadNativeMaintenanceVersion(preflight: RemoteRepairReleasePreflight) {
  fs.mkdirSync(path.resolve(process.cwd(), "tmp"), { recursive: true, mode: 0o700 });
  const temporaryDirectory = fs.mkdtempSync(
    path.join(path.resolve(process.cwd(), "tmp"), "native-d1-maintenance-"),
  );
  const entryPath = path.join(temporaryDirectory, "worker.mjs");
  const versionTag = `d1-maint-${productionMaintenanceRepairRunId(preflight.runId)}`;
  let uploadError: unknown;
  try {
    fs.writeFileSync(entryPath, nativeD1MaintenanceWorkerSource(), { mode: 0o600 });
    assertRepairArtifactEvidenceUnchanged(preflight);
    try {
      runBoundedMutationWrangler(
        buildNativeMaintenanceUploadArgs(
          entryPath,
          versionTag,
          preflight.assetManifest.root,
        ),
        {
          env: nativeWranglerDeployEnv,
          maxBuffer: 128 * 1024 * 1024,
        },
      );
    } catch (error) {
      // A lost upload response is not authoritative. Resolve the unique tag
      // from Cloudflare before deciding that no immutable version exists.
      uploadError = error;
    }
    // Wrangler reads the asset directory during the upload. Refuse to activate
    // any resulting version if a concurrent build changed source or artifacts
    // while that command was in flight, even when its response was lost.
    assertRepairArtifactEvidenceUnchanged(preflight);
    const versionId = resolveWorkerVersionIdByTag(versionTag);
    if (!versionId) {
      throw new AggregateError(
        [uploadError].filter((error): error is NonNullable<unknown> => error !== undefined),
        `Native maintenance version tag ${versionTag} could not be resolved after upload.`,
      );
    }
    assertRepairArtifactEvidenceUnchanged(preflight);
    return versionId;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function assertRepairArtifactEvidenceUnchanged(
  expected: Pick<
    RemoteRepairReleasePreflight,
    "sourceFingerprint" | "workerSourceSha256" | "wranglerConfigSha256" | "assetManifest"
  >,
  current: WorkerDeployArtifactEvidence = buildWorkerDeployArtifactEvidence(process.cwd()),
) {
  const mismatches: string[] = [];
  if (
    current.sourceFingerprint.sha256 !== expected.sourceFingerprint.sha256 ||
    current.sourceFingerprint.fileCount !== expected.sourceFingerprint.fileCount
  ) {
    mismatches.push("source fingerprint");
  }
  if (current.workerSourceSha256 !== expected.workerSourceSha256) {
    mismatches.push("Worker source");
  }
  if (current.wranglerConfigSha256 !== expected.wranglerConfigSha256) {
    mismatches.push("Wrangler config");
  }
  if (!sameEvidenceArtifactManifest(current.assetManifest, expected.assetManifest)) {
    mismatches.push("Static Assets manifest");
  }
  if (mismatches.length) {
    throw new Error(
      `Remote translation repair artifacts changed after release preflight: ${mismatches.join(", ")}.`,
    );
  }
  return current;
}

function assertRemoteRepairActivationPreflight(preflight: RemoteRepairReleasePreflight) {
  assertRepairArtifactEvidenceUnchanged(preflight);
  const activeVersionId = requireSoleActiveWorkerVersion();
  if (activeVersionId !== preflight.serviceBaselineVersionId) {
    throw new Error(
      `Remote translation repair service baseline changed before maintenance activation: expected ${preflight.serviceBaselineVersionId}, received ${activeVersionId}.`,
    );
  }
}

export function deployPinnedWorkerVersion(versionId: string, message: string) {
  let deployError: unknown;
  try {
    runBoundedMutationWrangler(buildPinnedWorkerVersionDeployArgs(versionId, message), {
      env: nativeWranglerDeployEnv,
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (error) {
    deployError = error;
  }
  try {
    confirmPinnedWorkerVersion(versionId);
  } catch (readbackError) {
    throw new AggregateError(
      [deployError, readbackError].filter(
        (error): error is NonNullable<unknown> => error !== undefined,
      ),
      `Expected pinned Worker version ${versionId} at 100% traffic after three authoritative readbacks.`,
    );
  }
}

export function runBoundedMutationWrangler(
  args: string[],
  options: RunCommandOptions = {},
) {
  const result = runBoundedReleaseChildSync(
    {
      command: path.resolve(process.cwd(), "node_modules/.bin/wrangler"),
      args,
    },
    {
      cwd: process.cwd(),
      env: { ...commandEnv(), ...options.env },
      input: options.input,
      maxOutputBytes: options.maxBuffer,
      timeoutMs: options.timeoutMs ?? CLOUDFLARE_CLI_TIMEOUT_MS,
    },
  );
  const output = `${result.stdout}${result.stderr}${result.error ? String(result.error) : ""}`;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(output || `Bounded Wrangler mutation failed: ${args.slice(0, 3).join(" ")}`);
  }
  return output;
}

export function confirmPinnedWorkerVersion(
  versionId: string,
  readActiveVersion: () => string = requireSoleActiveWorkerVersion,
  attempts = 3,
) {
  const expectedVersionId = requireWorkerVersion(versionId);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error("Pinned Worker version readback attempts must be an integer from 1 through 10.");
  }
  const errors: Error[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const activeVersionId = readActiveVersion();
      if (activeVersionId === expectedVersionId) return activeVersionId;
      errors.push(
        new Error(
          `Pinned Worker version readback ${attempt} observed ${activeVersionId || "no version"}.`,
        ),
      );
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  throw new AggregateError(
    errors,
    `Pinned Worker version ${expectedVersionId} was not confirmed after ${attempts} readbacks.`,
  );
}

export function validateWorkerDeployEvidenceForRepair(input: {
  report: unknown;
  backupDir: string;
  candidateVersionId: string;
  currentArtifactEvidence: WorkerDeployArtifactEvidence;
}): WorkerDeployRepairEvidence {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const report = requireEvidenceRecord(input.report, "Worker deploy evidence");
  const createdAt = requireEvidenceString(report, "createdAt");
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error("Worker deploy evidence has an invalid createdAt timestamp.");
  }
  const backupDir = requireEvidenceString(report, "backupDir");
  const sourceFingerprint = requireEvidenceRecord(
    report.sourceFingerprint,
    "Worker deploy source fingerprint",
  );
  const sourceFingerprintBefore = requireEvidenceRecord(
    report.sourceFingerprintBefore,
    "Worker deploy pre-command source fingerprint",
  );
  const sourceFingerprintAfter = requireEvidenceRecord(
    report.sourceFingerprintAfter,
    "Worker deploy post-command source fingerprint",
  );
  const artifactEvidenceAfter = requireEvidenceRecord(
    report.artifactEvidenceAfter,
    "Worker deploy post-command artifact evidence",
  );
  const activeDeployment = requireEvidenceRecord(
    report.activeDeployment,
    "Worker deploy active deployment",
  );
  const assetManifest = parseEvidenceArtifactManifest(
    report.assetManifest,
    "Worker deploy asset manifest",
  );
  const assetManifestAfter = parseEvidenceArtifactManifest(
    artifactEvidenceAfter.assetManifest,
    "Worker deploy post-command asset manifest",
  );
  const current = input.currentArtifactEvidence;
  const currentSourceSha256 = current.sourceFingerprint.sha256;
  const currentSourceFileCount = current.sourceFingerprint.fileCount;
  const reportSourceSha256 = requireEvidenceString(sourceFingerprint, "sha256");
  const reportSourceFileCount = requireEvidenceNumber(sourceFingerprint, "fileCount");
  const workerSourceSha256 = requireEvidenceString(report, "workerSourceSha256");
  const wranglerConfigSha256 = requireEvidenceString(report, "wranglerConfigSha256");
  const activeVersionId = requireEvidenceString(activeDeployment, "versionId");
  const activeDeploymentReadAt = requireEvidenceString(activeDeployment, "readAt");

  const mismatches: string[] = [];
  if (report.ok !== true) mismatches.push("report is not successful");
  if (report.mode !== "opennext-deploy") mismatches.push("report is not an immutable deploy");
  if (report.commandExecuted !== true || report.status !== 0) {
    mismatches.push("deploy command did not complete successfully");
  }
  if (
    report.deployPreflightOk !== true ||
    report.deployPreflightStatus !== 0 ||
    report.resourceBudgetOk !== true ||
    report.scanBeforeOk !== true ||
    report.scanAfterOk !== null
  ) {
    mismatches.push("deploy safety gates did not complete successfully");
  }
  const command = isStringArray(report.command) ? report.command : [];
  const passthroughArgs = isStringArray(report.passthroughArgs) ? report.passthroughArgs : [];
  if (
    command.length !== 4 ||
    path.basename(command[0] ?? "") !== "wrangler" ||
    command[1] !== "deploy" ||
    command[2] !== "--config" ||
    command[3] !== "wrangler.jsonc" ||
    passthroughArgs.length !== 0
  ) {
    mismatches.push("deploy command is not the exact immutable OpenNext deploy command");
  }
  if (path.resolve(backupDir) !== path.resolve(input.backupDir)) {
    mismatches.push("backup directory differs");
  }
  if (report.sourceFingerprintStable !== true) mismatches.push("source fingerprint was not stable");
  if (report.artifactEvidenceStable !== true) mismatches.push("deploy artifacts were not stable");
  for (const [label, fingerprint] of [
    ["command", sourceFingerprint],
    ["pre-command", sourceFingerprintBefore],
    ["post-command", sourceFingerprintAfter],
  ] as const) {
    if (
      requireEvidenceString(fingerprint, "sha256") !== currentSourceSha256 ||
      requireEvidenceNumber(fingerprint, "fileCount") !== currentSourceFileCount
    ) {
      mismatches.push(`${label} source fingerprint differs`);
    }
  }
  if (
    requireEvidenceString(artifactEvidenceAfter, "sourceFingerprintSha256") !==
    currentSourceSha256
  ) {
    mismatches.push("post-command artifact source fingerprint differs");
  }
  if (workerSourceSha256 !== current.workerSourceSha256) {
    mismatches.push("Worker source hash differs");
  }
  if (
    requireEvidenceString(artifactEvidenceAfter, "workerSourceSha256") !==
    current.workerSourceSha256
  ) {
    mismatches.push("post-command Worker source hash differs");
  }
  if (wranglerConfigSha256 !== current.wranglerConfigSha256) {
    mismatches.push("Wrangler config hash differs");
  }
  if (
    requireEvidenceString(artifactEvidenceAfter, "wranglerConfigSha256") !==
    current.wranglerConfigSha256
  ) {
    mismatches.push("post-command Wrangler config hash differs");
  }
  if (!sameEvidenceArtifactManifest(assetManifest, current.assetManifest)) {
    mismatches.push("Static Assets manifest differs");
  }
  if (!sameEvidenceArtifactManifest(assetManifestAfter, current.assetManifest)) {
    mismatches.push("post-command Static Assets manifest differs");
  }
  if (
    activeDeployment.workerName !== workerName ||
    activeDeployment.percentage !== 100 ||
    activeDeployment.observedVersions !== 1
  ) {
    mismatches.push("active deployment is not the sole inspirlearning version at 100 percent");
  }
  if (!isWorkerVersionId(activeVersionId) || activeVersionId !== candidateVersionId) {
    mismatches.push("active deployment version differs from the repair candidate");
  }
  if (!Number.isFinite(Date.parse(activeDeploymentReadAt))) {
    mismatches.push("active deployment readback timestamp is invalid");
  }
  if (mismatches.length) {
    throw new Error(`Worker deploy evidence does not authorize this repair: ${mismatches.join(", ")}.`);
  }

  return {
    createdAt,
    backupDir,
    candidateVersionId,
    sourceFingerprintSha256: reportSourceSha256,
    sourceFingerprintFileCount: reportSourceFileCount,
    workerSourceSha256,
    wranglerConfigSha256,
    assetManifest,
    activeDeploymentReadAt,
  };
}

function assertRemoteRepairReleasePreflight(input: {
  backupDir: string;
  candidateVersionId: string;
}): RemoteRepairReleasePreflight {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const backupDir = path.resolve(input.backupDir);
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDir),
  );
  if (upload.value.targetCandidateVersionId !== candidateVersionId) {
    throw new Error(
      `Remote translation repair expected uploaded candidate ${candidateVersionId}; canonical upload evidence names ${upload.value.targetCandidateVersionId}.`,
    );
  }
  const serviceBaselineVersionId = upload.value.serviceBaselineVersionId;
  const dirty = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.trim()) {
    throw new Error("Remote translation repair requires a clean git working tree.");
  }
  const gitHead = runGit(["rev-parse", "HEAD"]).trim();
  const gitUpstream = runGit(["rev-parse", "@{upstream}"]).trim();
  const gitUpstreamRef = runGit([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]).trim();
  if (
    !/^[a-f0-9]{40,64}$/i.test(gitHead) ||
    gitHead !== gitUpstream ||
    !gitUpstreamRef ||
    gitUpstreamRef === "@{upstream}" ||
    /[\u0000-\u001f\u007f]/.test(gitUpstreamRef)
  ) {
    throw new Error("Remote translation repair requires HEAD to equal its pushed upstream commit.");
  }

  const safetyChecks = buildReleaseArtifactSafetyChecks({
    backupDir: input.backupDir,
    cwd: process.cwd(),
  });
  const failedChecks = safetyChecks.filter((check) => check.status !== "pass");
  if (failedChecks.length) {
    throw new Error(
      `Remote translation repair requires fresh source-scoped local gates: ${failedChecks
        .map((check) => check.name)
        .join(", ")}.`,
    );
  }

  const activeVersionId = requireSoleActiveWorkerVersion();
  if (activeVersionId !== serviceBaselineVersionId) {
    throw new Error(
      `Remote translation repair requires service baseline ${serviceBaselineVersionId} alone at 100% while candidate ${candidateVersionId} remains inactive; received ${activeVersionId}.`,
    );
  }
  const candidateProbe = probeNativeWriteFreeze(false, serviceBaselineVersionId);
  const currentArtifactEvidence = buildWorkerDeployArtifactEvidence(process.cwd());
  const sourceFingerprint = currentArtifactEvidence.sourceFingerprint;
  const workerDeployReportPath = upload.path;
  const workerDeployEvidence: WorkerDeployRepairEvidence = {
    createdAt: upload.value.createdAt,
    backupDir,
    candidateVersionId,
    sourceFingerprintSha256: currentArtifactEvidence.sourceFingerprint.sha256,
    sourceFingerprintFileCount: currentArtifactEvidence.sourceFingerprint.fileCount,
    workerSourceSha256: currentArtifactEvidence.workerSourceSha256,
    wranglerConfigSha256: currentArtifactEvidence.wranglerConfigSha256,
    assetManifest: currentArtifactEvidence.assetManifest,
    activeDeploymentReadAt: upload.value.createdAt,
  };
  const currentRelease: ReleaseSequenceCurrentRelease = {
    phase: "uploaded-inactive",
    targetCandidateVersionId: candidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: upload.sha256,
    phaseEvidenceCreatedAt: upload.value.createdAt,
    soleServingVersionId: serviceBaselineVersionId,
    git: {
      head: gitHead.toLowerCase(),
      upstream: gitUpstream.toLowerCase(),
      upstreamRef: gitUpstreamRef,
    },
    artifactEvidence: currentArtifactEvidence,
  };
  assertReleaseSequenceCurrentReleaseBinding({ backupDir, currentRelease });
  assertFreshProductionVectorizeReadiness({
    backupDir,
    currentRelease,
    requiredPhase: "uploaded-inactive",
  });
  assertProductionTopicReconciliationReleaseBinding({
    backupDir,
    currentRelease,
  });
  const createdAt = new Date().toISOString();
  const runId = `${createdAt.replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
  const evidencePath = path.join(
    cloudflareDir(input.backupDir),
    `d1-translation-repair-release-preflight-${runId}.json`,
  );
  const base = {
    runId,
    createdAt,
    candidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    activeVersionId,
    gitHead,
    gitUpstream,
    sourceFingerprint,
    workerSourceSha256: currentArtifactEvidence.workerSourceSha256,
    wranglerConfigSha256: currentArtifactEvidence.wranglerConfigSha256,
    assetManifest: currentArtifactEvidence.assetManifest,
    safetyChecks,
    candidateProbe,
    workerDeployReportPath,
    workerDeployEvidence,
  };
  writeExclusivePrivateJson(evidencePath, {
    kind: "d1-translation-repair-release-preflight",
    ...base,
  });
  return { ...base, evidencePath };
}

export function readPrivateWorkerDeployEvidence(workerDeployReportPath: string): unknown {
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      workerDeployReportPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new Error(
      `Worker deploy evidence must be a regular owner-only mode-0600 file: ${workerDeployReportPath}.`,
      { cause: error },
    );
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size <= 0 ||
      stat.size > maximumWorkerDeployEvidenceBytes
    ) {
      throw new Error(
        `Worker deploy evidence must be a non-empty owner-only mode-0600 file no larger than ${maximumWorkerDeployEvidenceBytes} bytes: ${workerDeployReportPath}.`,
      );
    }
    return JSON.parse(fs.readFileSync(descriptor, "utf8")) as unknown;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function buildRepairArtifactManifest(root: string): RepairArtifactManifest {
  return buildWorkerDeployArtifactManifest(root);
}

function resolveWorkerVersionIdByTag(versionTag: string) {
  const parsed = parseJsonContainer(
    runWrangler(["versions", "list", "--name", workerName, "--json"]),
  );
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler returned an invalid Worker version list.");
  }
  const matches = parsed.flatMap((entry) => {
    const record = objectRecord(entry);
    const annotations = objectRecord(record?.annotations);
    const id = typeof record?.id === "string" ? record.id : "";
    return annotations?.["workers/tag"] === versionTag && isWorkerVersionId(id) ? [id] : [];
  });
  if (matches.length > 1) {
    throw new Error(`Worker version tag ${versionTag} resolved ambiguously.`);
  }
  return matches[0] ?? null;
}

export function requireSoleActiveWorkerVersion() {
  const parsed = objectRecord(
    parseJsonContainer(
      runWrangler(["deployments", "status", "--name", workerName, "--json"]),
    ),
  );
  const versions = Array.isArray(parsed?.versions) ? parsed.versions : [];
  const active = versions.flatMap((entry) => {
    const record = objectRecord(entry);
    const versionId = typeof record?.version_id === "string" ? record.version_id : "";
    const percentage = typeof record?.percentage === "number" ? record.percentage : Number.NaN;
    return isWorkerVersionId(versionId) && percentage === 100 ? [versionId] : [];
  });
  if (versions.length !== 1 || active.length !== 1) {
    throw new Error(`Expected one ${workerName} version at 100% traffic.`);
  }
  const versionId = active[0];
  if (!versionId) throw new Error(`Expected one ${workerName} version at 100% traffic.`);
  return versionId;
}

function runGit(args: string[]) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Git preflight failed: git ${args.join(" ")}\n${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

function parseJsonContainer(output: string): unknown {
  try {
    return JSON.parse(output.trim()) as unknown;
  } catch {
    for (const [opening, closing] of [["[", "]"], ["{", "}"]] as const) {
      const first = output.indexOf(opening);
      const last = output.lastIndexOf(closing);
      if (first < 0 || last <= first) continue;
      try {
        return JSON.parse(output.slice(first, last + 1)) as unknown;
      } catch {
        // Try the next supported JSON container.
      }
    }
    return null;
  }
}

function objectRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function requireEvidenceRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is missing or malformed.`);
  return value;
}

function requireEvidenceString(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`Worker deploy evidence field ${field} is missing or malformed.`);
  }
  return value;
}

function requireEvidenceNumber(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Worker deploy evidence field ${field} is missing or malformed.`);
  }
  return value;
}

function parseEvidenceArtifactManifest(
  value: unknown,
  label: string,
): WorkerDeployArtifactManifest {
  const record = requireEvidenceRecord(value, label);
  return {
    root: requireEvidenceString(record, "root"),
    fileCount: requireEvidenceNumber(record, "fileCount"),
    bytes: requireEvidenceNumber(record, "bytes"),
    sha256: requireEvidenceString(record, "sha256"),
  };
}

function sameEvidenceArtifactManifest(
  left: WorkerDeployArtifactManifest,
  right: WorkerDeployArtifactManifest,
) {
  return (
    path.resolve(left.root) === path.resolve(right.root) &&
    left.fileCount === right.fileCount &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256
  );
}

export function nativeD1MaintenanceWorkerSource() {
  return String.raw`import { DurableObject } from "cloudflare:workers";

const maintenanceHeaders = {
  "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "content-type": "application/json; charset=utf-8",
  "retry-after": "300",
  "x-content-type-options": "nosniff",
  "x-inspir-delivery": "native-maintenance-worker",
};

function maintenanceResponse() {
  return new Response(JSON.stringify({
    error: "The service is temporarily read-only while database maintenance is in progress.",
    code: "write_freeze_active",
  }), { status: 503, headers: maintenanceHeaders });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({
        ok: true,
        runtime: "cloudflare-workers",
        version: {
          id: env.CF_VERSION_METADATA?.id,
          tag: env.CF_VERSION_METADATA?.tag,
          timestamp: env.CF_VERSION_METADATA?.timestamp,
        },
        architecture: { openNext: false, maintenance: true, deploymentMode: "native-d1-maintenance" },
      }), { status: 200, headers: maintenanceHeaders });
    }
    if (url.pathname.startsWith("/api/") || request.method !== "GET") return maintenanceResponse();
    if (!env.ASSETS) return maintenanceResponse();
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("x-inspir-delivery", "native-maintenance-worker");
    headers.set("x-content-type-options", "nosniff");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  async queue(batch) { batch.retryAll({ delaySeconds: 300 }); },
  async scheduled() {},
};

export class DOQueueHandler extends DurableObject {
  fetch() { return maintenanceResponse(); }
}
`;
}

export function validateNativeMaintenanceProbe(
  value: unknown,
  expectedActive: boolean,
): NativeMaintenanceProbe {
  if (!isRecord(value)) throw new Error("Native maintenance probe did not return an object.");
  const probe: NativeMaintenanceProbe = {
    active: value.mutationCode === "write_freeze_active",
    healthStatus: numeric(value.healthStatus),
    mutationStatus: numeric(value.mutationStatus),
    ...(typeof value.mutationCode === "string" ? { mutationCode: value.mutationCode } : {}),
    ...(typeof value.delivery === "string" ? { delivery: value.delivery } : {}),
    ...(typeof value.runtime === "string" ? { runtime: value.runtime } : {}),
    ...(typeof value.openNext === "boolean" ? { openNext: value.openNext } : {}),
    ...(typeof value.maintenance === "boolean" ? { maintenance: value.maintenance } : {}),
    ...(typeof value.versionId === "string" ? { versionId: value.versionId } : {}),
  };
  const nativeRuntimeOk =
    probe.healthStatus === 200 &&
    probe.delivery ===
      (expectedActive ? "native-maintenance-worker" : "lean-api-worker") &&
    probe.runtime === "cloudflare-workers" &&
    probe.openNext === false &&
    (expectedActive ? probe.maintenance === true : probe.maintenance !== true) &&
    Boolean(probe.versionId);
  const stateOk = expectedActive
    ? probe.active && probe.mutationStatus === 503
    : !probe.active && probe.mutationStatus >= 200 && probe.mutationStatus < 500;
  if (!nativeRuntimeOk || !stateOk || probe.active !== expectedActive) {
    throw new Error(
      `Native Worker write-freeze probe failed for expected state ${expectedActive ? "active" : "inactive"}.`,
    );
  }
  return probe;
}

export function probeNativeWriteFreeze(expectedActive: boolean, expectedVersionId?: string) {
  const probeScript = String.raw`
const origin = process.argv[1];
const healthResponse = await fetch(origin + "/api/health", {
  headers: { accept: "application/json", "cache-control": "no-store" },
  signal: AbortSignal.timeout(10000),
});
const health = await healthResponse.json();
const mutationResponse = await fetch(origin + "/api/auth/sign-in/social", {
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/json", "cache-control": "no-store" },
  body: "{}",
  signal: AbortSignal.timeout(10000),
});
let mutation = {};
try { mutation = await mutationResponse.json(); } catch {}
process.stdout.write(JSON.stringify({
  healthStatus: healthResponse.status,
  mutationStatus: mutationResponse.status,
  mutationCode: typeof mutation.code === "string" ? mutation.code : undefined,
  delivery: healthResponse.headers.get("x-inspir-delivery"),
  runtime: health.runtime,
  openNext: health.architecture?.openNext,
  maintenance: health.architecture?.maintenance,
  versionId: health.version?.id,
}));
`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", probeScript, productionBaseUrl],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Native Worker write-freeze probe failed: ${result.stderr || result.stdout}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error("Native Worker write-freeze probe returned invalid JSON.");
  }
  const probe = validateNativeMaintenanceProbe(parsed, expectedActive);
  if (expectedVersionId && probe.versionId !== expectedVersionId) {
    throw new Error(
      `Native Worker probe expected version ${expectedVersionId}; received ${probe.versionId ?? "unknown"}.`,
    );
  }
  return probe;
}

export function writePreWriteDiagnosticEvidence(input: {
  backupDir: string;
  runId: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
  releasePreflightEvidencePath: string;
  bookmark: string;
  atomicSql: string;
  activeProbe: NativeMaintenanceProbe;
  projectedBilledRowReads: number;
  projectedBilledRowWrites: number;
  d1StorageAdmission?: D1StorageAdmissionProjection;
  d1ReleaseBudget?: D1ReleaseBudgetReservationResult;
}) {
  if (!isValidD1TimeTravelBookmark(input.bookmark)) {
    throw new Error("Pre-write diagnostic evidence requires a valid Time Travel bookmark.");
  }
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(input.runId)) {
    throw new Error("Pre-write diagnostic evidence requires a valid immutable run ID.");
  }
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const maintenanceVersionId = requireWorkerVersion(input.maintenanceVersionId);
  const activeProbe = validateNativeMaintenanceProbe(input.activeProbe, true);
  if (activeProbe.versionId !== maintenanceVersionId) {
    throw new Error("Pre-write diagnostic evidence must bind the active maintenance version.");
  }
  if (!path.isAbsolute(input.releasePreflightEvidencePath)) {
    throw new Error("Pre-write diagnostic evidence requires an absolute release-preflight path.");
  }
  if (
    input.d1ReleaseBudget &&
    (input.d1ReleaseBudget.reservation.phase !== "maximum" ||
      input.d1ReleaseBudget.reservation.rowsRead !==
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
      input.d1ReleaseBudget.reservation.rowsWritten !==
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES)
  ) {
    throw new Error(
      "Pre-write diagnostic evidence requires the full D1 maximum reservation through import and verification.",
    );
  }
  assertNoUnresolvedTranslationRepair(input.backupDir);
  if (input.d1StorageAdmission) {
    assertD1FreeStorageAdmission(input.d1StorageAdmission);
  }
  const createdAt = new Date().toISOString();
  const evidence = {
    kind: "d1-translation-repair-prewrite-evidence",
    runId: input.runId,
    createdAt,
    database: D1_DATABASE_NAME,
    candidateVersionId,
    maintenanceVersionId,
    releasePreflightEvidencePath: input.releasePreflightEvidencePath,
    timeTravelBookmark: input.bookmark,
    automaticRestoreAllowed: false,
    recoveryPreference: "reviewed-forward-correction",
    destructiveRestoreSupported: false,
    exportPerformed: false,
    exportReason: "Cloudflare documents that D1 export blocks database requests.",
    atomicSqlSha256: sha256(input.atomicSql),
    atomicSqlBytes: Buffer.byteLength(input.atomicSql, "utf8"),
    atomicSqlStatements: splitSqlStatements(input.atomicSql).length,
    largestStatementBytes: largestSqlStatementBytes(input.atomicSql),
    projectedBilledRowReads: input.projectedBilledRowReads,
    projectedBilledRowWrites: input.projectedBilledRowWrites,
    d1StorageAdmission: input.d1StorageAdmission,
    d1ReleaseBudget: input.d1ReleaseBudget
      ? {
          ledgerPath: input.d1ReleaseBudget.ledgerPath,
          utcDay: input.d1ReleaseBudget.utcDay,
          operationId: input.d1ReleaseBudget.reservation.operationId,
          revision: input.d1ReleaseBudget.revision,
          phase: input.d1ReleaseBudget.reservation.phase,
          rowsRead: input.d1ReleaseBudget.reservation.rowsRead,
          rowsWritten: input.d1ReleaseBudget.reservation.rowsWritten,
        }
      : undefined,
    maintenance: activeProbe,
  } as const;
  const evidenceDirectory = cloudflareDir(input.backupDir);
  const evidencePath = path.join(
    evidenceDirectory,
    `d1-translation-repair-prewrite-${input.runId}.json`,
  );
  writeExclusivePrivateJson(evidencePath, evidence);
  const markerPath = path.join(evidenceDirectory, unresolvedRepairMarkerFile);
  writeExclusivePrivateJson(markerPath, {
    kind: "d1-translation-repair-unresolved",
    runId: input.runId,
    createdAt,
    evidencePath,
    candidateVersionId,
    maintenanceVersionId,
    timeTravelBookmark: input.bookmark,
    automaticRestoreAllowed: false,
  });
  return evidencePath;
}

export function assertNoUnresolvedTranslationRepair(backupDir: string) {
  const markerPath = path.join(cloudflareDir(backupDir), unresolvedRepairMarkerFile);
  if (fs.existsSync(markerPath)) {
    throw new Error(
      `An unresolved D1 translation repair already exists at ${markerPath}. Resolve it explicitly before starting another run.`,
    );
  }
}

export function resolveUnresolvedTranslationRepair(input: {
  backupDir: string;
  evidencePath: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
}) {
  const directory = cloudflareDir(input.backupDir);
  const markerPath = path.join(directory, unresolvedRepairMarkerFile);
  const marker = objectRecord(parseJsonContainer(fs.readFileSync(markerPath, "utf8")));
  if (
    marker?.evidencePath !== input.evidencePath ||
    marker.candidateVersionId !== input.candidateVersionId ||
    marker.maintenanceVersionId !== input.maintenanceVersionId ||
    typeof marker.runId !== "string"
  ) {
    throw new Error("The unresolved D1 translation repair marker does not match the verified run.");
  }
  writeExclusivePrivateJson(
    path.join(directory, `d1-translation-repair-resolved-${marker.runId}.json`),
    {
      kind: "d1-translation-repair-resolved",
      runId: marker.runId,
      createdAt: new Date().toISOString(),
      evidencePath: input.evidencePath,
      candidateVersionId: input.candidateVersionId,
      maintenanceVersionId: input.maintenanceVersionId,
      exactVerificationPassed: true,
      exactCandidateRestored: true,
    },
  );
  fs.rmSync(markerPath);
  fsyncDirectory(directory);
}

function writeExclusivePrivateJson(file: string, value: unknown) {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(file));
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export type CuratedPackEntry = {
  key: string;
  source: string;
  value: string;
};

export type CuratedPackProvenance = {
  kind: string;
  pipelineVersion: string;
  executionProfileSha256: string;
  protectorVersion: string;
  protectorSha256: string;
  masterWorklistSha256: string;
  packWorklistSha256: string;
  jobSha256: string;
  sourceEntriesSha256: string;
  modelSha256: string;
  pipelineImplementationSha256: string;
  workerImplementationSha256: string;
  validatorPolicySha256: string;
  candidateSha256: string;
  provenanceSha256: string;
};

export type CuratedPack = {
  schemaVersion: number;
  language: string;
  locale: string;
  namespace: string;
  sourceHash: string;
  model?: string;
  provenance?: CuratedPackProvenance;
  entries?: readonly CuratedPackEntry[];
  translations?: Readonly<Record<string, string>>;
};

export type CuratedPackIdentifier = {
  namespace: keyof typeof siteSourceManifest | typeof mainAppTranslationNamespace;
  language: SupportedLanguage;
  file: string;
};

export function getExactCuratedPackIdentifiers(): CuratedPackIdentifier[] {
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const siteIdentifiers: CuratedPackIdentifier[] = [];
  for (const namespace of Object.keys(siteSourceManifest)
    .filter((value) => value !== siteTranslationNamespace)
    .sort()) {
    for (const language of targetLanguages) {
      siteIdentifiers.push({
        namespace: namespace as keyof typeof siteSourceManifest,
        language,
        file: curatedPackPath(language, namespace),
      });
    }
  }
  const mainAppIdentifiers: CuratedPackIdentifier[] = targetLanguages.map((language) => ({
    namespace: mainAppTranslationNamespace,
    language,
    file: curatedPackPath(language, mainAppTranslationNamespace),
  }));
  const identifiers = [...siteIdentifiers, ...mainAppIdentifiers].sort(compareCuratedPackIdentifiers);
  const seen = new Set<string>();
  for (const identifier of identifiers) {
    const key = translationIdentifier(identifier.namespace, identifier.language);
    if (seen.has(key)) throw new Error(`Duplicate expected curated pack ${key}.`);
    seen.add(key);
  }
  return identifiers;
}

export function isGrandfatheredEntryCuratedPackIdentifier(
  identifier: Readonly<{ namespace: string; language: SupportedLanguage }>,
) {
  return (
    identifier.namespace !== mainAppTranslationNamespace &&
    (grandfatheredEntryNamespaces.has(identifier.namespace) ||
      grandfatheredEntryLanguages.has(identifier.language))
  );
}

export function getGrandfatheredEntryCuratedPackIdentifiers() {
  const identifiers = getExactCuratedPackIdentifiers().filter(
    isGrandfatheredEntryCuratedPackIdentifier,
  );
  if (identifiers.length !== expectedGrandfatheredEntryCuratedPackCount) {
    throw new Error(
      `Grandfathered entry-form curated-pack contract drifted: ` +
        `${identifiers.length}/${expectedGrandfatheredEntryCuratedPackCount}.`,
    );
  }
  return identifiers;
}

export function loadCuratedNamespaceRepairRows(): CuratedNamespaceRepairRow[] {
  const exactIdentifiers = getExactCuratedPackIdentifiers();
  assertExactCuratedPackFileInventory(exactIdentifiers);
  const rows: CuratedNamespaceRepairRow[] = [];

  for (const identifier of exactIdentifiers) {
    if (identifier.namespace === mainAppTranslationNamespace) continue;
    const source = getSiteTranslationSource(identifier.namespace);
    const parsed = parseCuratedPack(identifier.file);
    if (
      parsed.schemaVersion !== 1 ||
      parsed.language !== identifier.language ||
      parsed.locale !== languageConfigs[identifier.language].locale ||
      parsed.namespace !== identifier.namespace ||
      parsed.sourceHash !== source.sourceHash
    ) {
      throw new Error(
        `Curated pack metadata is stale or invalid for ${identifier.namespace}/${identifier.language}.`,
      );
    }
    const payload = buildExactCuratedPackPayload(parsed, source.sourceStrings, identifier);
    const bundle = {
      namespace: identifier.namespace,
      language: identifier.language,
      sourceHash: source.sourceHash,
      sourceStrings: source.sourceStrings,
      strings: payload,
    };
    if (!isTranslationBundleCompleteAndFluent(source, bundle, identifier.language)) {
      throw new Error(
        `Curated ${identifier.namespace} translation is not conservatively fluent for ${identifier.language}.`,
      );
    }
    rows.push({
      namespace: identifier.namespace,
      language: identifier.language,
      sourceHash: source.sourceHash,
      payload,
    });
  }

  const expectedSiteRows = exactIdentifiers.filter(
    (identifier) => identifier.namespace !== mainAppTranslationNamespace,
  ).length;
  if (rows.length !== expectedSiteRows) {
    throw new Error(`Curated site-pack inventory is incomplete: ${rows.length}/${expectedSiteRows}.`);
  }
  return rows.sort(compareCuratedRepairRows);
}

function assertExactCuratedPackFileInventory(
  expectedIdentifiers: readonly CuratedPackIdentifier[],
) {
  if (!fs.existsSync(curatedRoot) || !fs.statSync(curatedRoot).isDirectory()) {
    throw new Error(`Curated pack root is unavailable: ${curatedRoot}.`);
  }
  // Main-app repair rows come from the compact tracked static-main-app corpus.
  // Full main-app editing packs are intentionally ignored local workbench
  // files, so neither their presence nor absence may change release identity.
  const expectedFiles = new Set(
    expectedIdentifiers
      .filter((identifier) => identifier.namespace !== mainAppTranslationNamespace)
      .map((identifier) => identifier.file),
  );
  const actualFiles = collectCuratedJsonFiles(curatedRoot)
    .filter((file) => !isMainAppWorkbenchPackFile(path.basename(file)))
    .sort();
  if (actualFiles.length !== expectedFiles.size) {
    throw new Error(
      `Curated pack file inventory cardinality failed: ${actualFiles.length}/${expectedFiles.size}.`,
    );
  }
  for (const file of actualFiles) {
    if (!expectedFiles.delete(file)) {
      throw new Error(`Unexpected or duplicate curated pack file ${path.relative(curatedRoot, file)}.`);
    }
  }
  if (expectedFiles.size) {
    const missing = path.relative(curatedRoot, Array.from(expectedFiles).sort()[0] ?? curatedRoot);
    throw new Error(`Missing curated pack file ${missing}.`);
  }
}

export function isMainAppWorkbenchPackFile(fileName: string) {
  return fileName === `${mainAppTranslationNamespace}.json` ||
    (fileName.startsWith(`${mainAppTranslationNamespace}.part-`) && fileName.endsWith(".json"));
}

function collectCuratedJsonFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Curated pack inventory must not contain a symlink: ${entryPath}.`);
    }
    if (entry.isDirectory()) {
      files.push(...collectCuratedJsonFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}

export function buildExactCuratedPackPayload(
  pack: CuratedPack,
  sourceStrings: Readonly<Record<string, string>>,
  identifier: CuratedPackIdentifier,
) {
  const targetLanguage = identifier.language;
  if (targetLanguage === defaultLanguage) {
    throw new Error("Curated translation repair cannot load an English target pack.");
  }
  if (pack.entries !== undefined) {
    if (!isGrandfatheredEntryCuratedPackIdentifier(identifier)) {
      throw new Error(
        `Curated pack representation downgrade is forbidden for ` +
          `${identifier.namespace}/${identifier.language}; immutable compact provenance is required.`,
      );
    }
    if (
      !pack.model ||
      !LEGACY_MARKETING_SITE_GRANDFATHERED_ENTRY_MODELS.some(
        (model) => model === pack.model,
      )
    ) {
      throw new Error(
        `Curated entry-form pack model is not explicitly grandfathered for ` +
          `${identifier.namespace}/${identifier.language}.`,
      );
    }
  }
  const values = new Map<string, string>();
  for (const entry of pack.entries ?? []) {
    if (!(entry.key in sourceStrings)) {
      throw new Error(
        `Curated pack contains an unexpected key for ${identifier.namespace}/${identifier.language}/${entry.key}.`,
      );
    }
    if (values.has(entry.key)) {
      throw new Error(
        `Curated pack contains a duplicate key for ${identifier.namespace}/${identifier.language}/${entry.key}.`,
      );
    }
    if (entry.source !== sourceStrings[entry.key]) {
      throw new Error(
        `Curated pack source text is stale for ${identifier.namespace}/${identifier.language}/${entry.key}.`,
      );
    }
    if (
      entry.value !== entry.value.normalize("NFC") ||
      !isValidFieldTranslation(
        entry.source,
        entry.value,
        identifier.language,
        entry.key,
      )
    ) {
      throw new Error(
        `Curated pack value is invalid for ${identifier.namespace}/${identifier.language}/${entry.key}.`,
      );
    }
    values.set(entry.key, entry.value);
  }

  for (const [key, value] of Object.entries(pack.translations ?? {})) {
    const source = sourceStrings[key];
    if (source === undefined) {
      throw new Error(
        `Curated pack contains an unexpected key for ${identifier.namespace}/${identifier.language}/${key}.`,
      );
    }
    if (values.has(key)) {
      throw new Error(
        `Curated pack contains a duplicate key for ${identifier.namespace}/${identifier.language}/${key}.`,
      );
    }
    if (
      value !== value.normalize("NFC") ||
      !isValidFieldTranslation(source, value, identifier.language, key)
    ) {
      throw new Error(
        `Curated pack value is invalid for ${identifier.namespace}/${identifier.language}/${key}.`,
      );
    }
    values.set(key, value);
  }

  const sourceKeys = Object.keys(sourceStrings).sort();
  if (values.size !== sourceKeys.length) {
    throw new Error(
      `Curated pack is incomplete for ${identifier.namespace}/${identifier.language}: ` +
        `${values.size}/${sourceKeys.length}.`,
    );
  }
  const payload: Record<string, string> = {};
  for (const key of sourceKeys) {
    const value = values.get(key);
    if (value === undefined) {
      throw new Error(
        `Curated pack is missing ${identifier.namespace}/${identifier.language}/${key}.`,
      );
    }
    payload[key] = value;
  }
  const source = {
    namespace: identifier.namespace,
    sourceHash: pack.sourceHash,
    sourceStrings,
  };
  const bundle = {
    namespace: identifier.namespace,
    language: identifier.language,
    sourceHash: pack.sourceHash,
    sourceStrings,
    strings: payload,
  };
  if (
    !isTranslationBundleFieldValid(source, bundle, identifier.language) ||
    !isTranslationBundleCompleteAndFluent(source, bundle, identifier.language)
  ) {
    throw new Error(
      `Curated pack failed exact field or fluent bundle validation for ` +
        `${identifier.namespace}/${identifier.language}.`,
    );
  }
  if (pack.translations) {
    for (const key of sourceKeys) {
      const sourceText = sourceStrings[key];
      const value = payload[key];
      const candidateFailures = validateTranslationCandidateField({
        language: targetLanguage,
        source: sourceText,
        value,
      }).failures;
      if (
        candidateFailures.length > 0 ||
        !hasExactLongTailInvariantParity(sourceText, value) ||
        !isValidFieldTranslation(sourceText, value, targetLanguage, key) ||
        !isTranslationFieldLikelyFluent(sourceText, value, targetLanguage, {
          namespace: identifier.namespace,
          sourceHash: pack.sourceHash,
          key,
        })
      ) {
        throw new Error(
          `Promoted compact pack failed strict candidate preservation for ` +
            `${identifier.namespace}/${identifier.language}/${key}.`,
        );
      }
    }
    assertPromotedCompactCuratedPackProvenance(
      pack,
      payload,
      sourceStrings,
      identifier,
    );
  }
  return payload;
}

function assertPromotedCompactCuratedPackProvenance(
  pack: CuratedPack,
  payload: Readonly<Record<string, string>>,
  sourceStrings: Readonly<Record<string, string>>,
  identifier: CuratedPackIdentifier,
) {
  const provenance = pack.provenance;
  if (!pack.model || !provenance) {
    throw new Error(
      `Promoted compact pack is missing immutable provenance for ` +
        `${identifier.namespace}/${identifier.language}.`,
    );
  }
  const sourceEntries = Object.keys(sourceStrings)
    .sort()
    .map((key) => {
      const source = sourceStrings[key];
      const protectedText = protectLongTailSourceText(source);
      return {
        key,
        source,
        sourceSha256: sha256(source),
        invariantSha256: protectedText.invariantSha256,
        segments: protectedText.segments,
      };
    });
  if (sha256CanonicalJson(sourceEntries) !== provenance.sourceEntriesSha256) {
    throw new Error(
      `Promoted compact pack source-entry provenance drifted for ` +
        `${identifier.namespace}/${identifier.language}.`,
    );
  }
  const candidate = {
    schemaVersion: 1,
    kind: longTailCandidateKind,
    pipelineVersion: longTailPipelineVersion,
    executionProfileSha256: longTailExecutionProfileSha256,
    masterWorklistSha256: provenance.masterWorklistSha256,
    packWorklistSha256: provenance.packWorklistSha256,
    jobSha256: provenance.jobSha256,
    language: identifier.language,
    locale: pack.locale,
    namespace: identifier.namespace,
    sourceHash: pack.sourceHash,
    sourceEntriesSha256: provenance.sourceEntriesSha256,
    modelLabel: pack.model,
    modelSha256: provenance.modelSha256,
    workerImplementationSha256: provenance.workerImplementationSha256,
    validatorPolicySha256: provenance.validatorPolicySha256,
    entries: sourceEntries.map((entry) => ({
      key: entry.key,
      source: entry.source,
      sourceSha256: entry.sourceSha256,
      value: payload[entry.key],
    })),
  };
  if (sha256CanonicalJson(candidate) !== provenance.candidateSha256) {
    throw new Error(
      `Promoted compact pack candidate provenance drifted for ` +
        `${identifier.namespace}/${identifier.language}.`,
    );
  }
  const provenanceMaterial = {
    kind: provenance.kind,
    pipelineVersion: provenance.pipelineVersion,
    executionProfileSha256: provenance.executionProfileSha256,
    protectorVersion: provenance.protectorVersion,
    protectorSha256: provenance.protectorSha256,
    masterWorklistSha256: provenance.masterWorklistSha256,
    packWorklistSha256: provenance.packWorklistSha256,
    jobSha256: provenance.jobSha256,
    sourceEntriesSha256: provenance.sourceEntriesSha256,
    modelSha256: provenance.modelSha256,
    pipelineImplementationSha256: provenance.pipelineImplementationSha256,
    workerImplementationSha256: provenance.workerImplementationSha256,
    validatorPolicySha256: provenance.validatorPolicySha256,
    candidateSha256: provenance.candidateSha256,
  };
  if (sha256CanonicalJson(provenanceMaterial) !== provenance.provenanceSha256) {
    throw new Error(
      `Promoted compact pack provenance digest drifted for ` +
        `${identifier.namespace}/${identifier.language}.`,
    );
  }
}

export function parseCuratedPack(file: string): CuratedPack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    throw new Error(`Curated pack is not valid JSON: ${path.relative(curatedRoot, file)}.`);
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.language !== "string" ||
    typeof parsed.locale !== "string" ||
    typeof parsed.namespace !== "string" ||
    typeof parsed.sourceHash !== "string"
  ) {
    throw new Error(`Curated pack schema is invalid: ${path.relative(curatedRoot, file)}.`);
  }
  const rawEntries = parsed.entries;
  const rawTranslations = parsed.translations;
  const entriesPresent = rawEntries !== undefined;
  const translationsPresent = rawTranslations !== undefined;
  if (entriesPresent === translationsPresent) {
    throw new Error(
      `Curated pack must contain exactly one translation representation: ${path.relative(curatedRoot, file)}.`,
    );
  }
  if (entriesPresent && !Array.isArray(rawEntries)) {
    throw new Error(`Curated pack entries are invalid: ${path.relative(curatedRoot, file)}.`);
  }
  if (translationsPresent && !isRecord(rawTranslations)) {
    throw new Error(`Curated pack translations are invalid: ${path.relative(curatedRoot, file)}.`);
  }
  if (parsed.model !== undefined && (typeof parsed.model !== "string" || !parsed.model)) {
    throw new Error(`Curated pack model is invalid: ${path.relative(curatedRoot, file)}.`);
  }
  const entries = Array.isArray(rawEntries) ? rawEntries.map((entry, index): CuratedPackEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      typeof entry.source !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw new Error(
        `Curated pack entry ${index} is invalid: ${path.relative(curatedRoot, file)}.`,
      );
    }
    return { key: entry.key, source: entry.source, value: entry.value };
  }) : undefined;
  const translations: Record<string, string> | undefined = isRecord(rawTranslations) ? {} : undefined;
  if (isRecord(rawTranslations) && translations) {
    for (const [key, value] of Object.entries(rawTranslations)) {
      if (typeof value !== "string") {
        throw new Error(
          `Curated pack compact value is invalid for ${key}: ${path.relative(curatedRoot, file)}.`,
        );
      }
      translations[key] = value;
    }
  }
  const provenance =
    parsed.provenance === undefined
      ? undefined
      : parseCuratedPackProvenance(parsed.provenance, file);
  return {
    schemaVersion: parsed.schemaVersion,
    language: parsed.language,
    locale: parsed.locale,
    namespace: parsed.namespace,
    sourceHash: parsed.sourceHash,
    model: typeof parsed.model === "string" ? parsed.model : undefined,
    provenance,
    entries,
    translations,
  };
}

function parseCuratedPackProvenance(
  value: unknown,
  file: string,
): CuratedPackProvenance {
  const keys = [
    "kind",
    "pipelineVersion",
    "executionProfileSha256",
    "protectorVersion",
    "protectorSha256",
    "masterWorklistSha256",
    "packWorklistSha256",
    "jobSha256",
    "sourceEntriesSha256",
    "modelSha256",
    "pipelineImplementationSha256",
    "workerImplementationSha256",
    "validatorPolicySha256",
    "candidateSha256",
    "provenanceSha256",
  ] as const;
  if (!isRecord(value) || !hasExactObjectKeys(value, keys)) {
    throw new Error(`Curated pack provenance is invalid: ${path.relative(curatedRoot, file)}.`);
  }
  const read = (key: (typeof keys)[number]) => {
    const entry = value[key];
    if (typeof entry !== "string" || !entry) {
      throw new Error(`Curated pack provenance ${key} is invalid: ${path.relative(curatedRoot, file)}.`);
    }
    return entry;
  };
  const provenance: CuratedPackProvenance = {
    kind: read("kind"),
    pipelineVersion: read("pipelineVersion"),
    executionProfileSha256: read("executionProfileSha256"),
    protectorVersion: read("protectorVersion"),
    protectorSha256: read("protectorSha256"),
    masterWorklistSha256: read("masterWorklistSha256"),
    packWorklistSha256: read("packWorklistSha256"),
    jobSha256: read("jobSha256"),
    sourceEntriesSha256: read("sourceEntriesSha256"),
    modelSha256: read("modelSha256"),
    pipelineImplementationSha256: read("pipelineImplementationSha256"),
    workerImplementationSha256: read("workerImplementationSha256"),
    validatorPolicySha256: read("validatorPolicySha256"),
    candidateSha256: read("candidateSha256"),
    provenanceSha256: read("provenanceSha256"),
  };
  if (
    provenance.kind !== longTailCuratedProvenanceKind ||
    provenance.pipelineVersion !== longTailPipelineVersion ||
    provenance.executionProfileSha256 !==
      longTailExecutionProfileSha256 ||
    provenance.protectorVersion !== longTailProtectorVersion ||
    Object.entries(provenance).some(
      ([key, entry]) =>
        key.endsWith("Sha256") && !/^[a-f0-9]{64}$/.test(entry),
    )
  ) {
    throw new Error(`Curated pack provenance contract is invalid: ${path.relative(curatedRoot, file)}.`);
  }
  return provenance;
}

function curatedPackPath(language: SupportedLanguage, namespace: string) {
  const config = languageConfigs[language];
  return path.join(
    curatedRoot,
    config.prefix || config.locale,
    namespace.replace(/[^a-z0-9.-]+/gi, "__") + ".json",
  );
}

export function loadReleasedMarketingSiteRepairCorpus(
  repoRoot = process.cwd(),
): MarketingSiteRepairCorpus {
  const corpus = buildLegacyMarketingSiteComposedCorpusFromRepository({
    repoRoot: path.resolve(repoRoot),
    contract: legacyMarketingSiteContract,
  });
  const rows = Object.freeze(corpus.payloads.map((payload) => Object.freeze({
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    language: payload.language,
    source_hash: legacyMarketingSiteContract.marketingSourceHash,
    payload: payload.payloadJson,
    model: corpus.identity.model,
  })));
  const release = Object.freeze({ corpus, rows });
  assertExactMarketingSiteRepairCorpus(release);
  return release;
}

export function assertExactMarketingSiteRepairCorpus(
  release: MarketingSiteRepairCorpus,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
) {
  if (
    release.rows.length !== LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT ||
    release.corpus.payloads.length !==
      LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT
  ) {
    throw new Error(
      `Marketing-site repair requires ${LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT} exact released rows.`,
    );
  }
  const validated = validateLegacyMarketingSiteDatabaseRows({
    contract,
    expectedCorpus: release.corpus,
    rows: release.rows,
  });
  if (
    validated.rows !== LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT ||
    validated.corpusSha256 !== release.corpus.identity.corpusSha256 ||
    validated.model !== release.corpus.identity.model
  ) {
    throw new Error("Marketing-site repair corpus identity is not exact.");
  }
  return validated;
}

export function buildMarketingSiteRepairPlan(
  release: MarketingSiteRepairCorpus,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
): MarketingSiteRepairPlan {
  assertExactMarketingSiteRepairCorpus(release, contract);
  const expectedPayloadByLanguage = new Map(
    release.corpus.payloads.map((payload) => [payload.language, payload]),
  );
  const sourceKeys = Object.keys(contract.marketingSourceStrings).sort();
  const statements = [
    buildMarketingSiteCardinalityGuardSql(legacyMarketingSiteTargetLanguages),
  ];
  let resetStatements = 0;
  let patchStatements = 0;
  let payloadBytes = 0;
  let largestPayloadBytes = 0;
  for (const row of [...release.rows].sort((left, right) =>
    left.language.localeCompare(right.language)
  )) {
    const expectedPayload = expectedPayloadByLanguage.get(row.language);
    if (!expectedPayload || expectedPayload.payloadJson !== row.payload) {
      throw new Error(
        `Marketing-site repair payload identity drifted for ${row.language}.`,
      );
    }
    measureD1TranslationStorageRow({
      namespace: row.namespace,
      language: row.language,
      sourceHash: row.source_hash,
      payloadJson: row.payload,
      model: row.model,
    });
    const rowPayloadBytes = assertD1TranslationPayloadSize(
      Buffer.byteLength(row.payload, "utf8"),
      `${LEGACY_MARKETING_SITE_NAMESPACE}/${row.language}`,
    );
    payloadBytes += rowPayloadBytes;
    largestPayloadBytes = Math.max(largestPayloadBytes, rowPayloadBytes);
    statements.push(buildMarketingSiteResetStatement(row));
    resetStatements += 1;
    const patches = buildBoundedJsonPatchStatements({
      namespace: LEGACY_MARKETING_SITE_NAMESPACE,
      language: row.language,
      sourceKeys,
      payload: expectedPayload.payload,
      buildStatement: (chunkJson) =>
        buildMarketingSitePatchStatement(row.language, chunkJson),
    });
    statements.push(...patches);
    patchStatements += patches.length;
  }
  const sql = statements.join("\n\n");
  return {
    sql,
    rows: release.rows.length,
    resetStatements,
    patchStatements,
    logicalRowWrites: resetStatements + patchStatements,
    largestStatementBytes: assertD1SqlStatementSize(sql),
    payloadBytes,
    largestPayloadBytes,
    corpusSha256: release.corpus.identity.corpusSha256,
    deltaCorpusSha256: release.corpus.identity.deltaCorpusSha256,
    model: release.corpus.identity.model,
  };
}

function buildMarketingSiteCardinalityGuardSql(
  languages: readonly LegacyMarketingSiteTargetLanguage[],
) {
  const allowedLanguages = languages.map(sqlString).join(", ");
  return [
    "SELECT CASE",
    `  WHEN COUNT(*) IN (0, ${languages.length})`,
    `    AND COALESCE(SUM(CASE WHEN language IN (${allowedLanguages}) THEN 1 ELSE 0 END), 0) = COUNT(*)`,
    "  THEN json('{}')",
    "  ELSE json('marketing-site-cardinality-guard-failed')",
    "END AS marketing_site_cardinality_guard",
    "FROM app_translations",
    `WHERE namespace = ${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)};`,
  ].join("\n");
}

function buildMarketingSiteResetStatement(row: MarketingSiteRepairRow) {
  const now = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
  return [
    "INSERT INTO app_translations",
    "  (namespace, language, source_hash, payload, model, created_at, updated_at)",
    "VALUES",
    `  (${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}, ${sqlString(row.language)}, ${sqlString(row.source_hash)},`,
    `   json('{}'), ${sqlString(row.model)}, ${now}, ${now})`,
    "ON CONFLICT(namespace, language) DO UPDATE SET",
    "  source_hash = excluded.source_hash,",
    "  payload = excluded.payload,",
    "  model = excluded.model,",
    "  updated_at = excluded.updated_at;",
  ].join("\n");
}

function buildMarketingSitePatchStatement(
  language: LegacyMarketingSiteTargetLanguage,
  chunkJson: string,
) {
  return [
    "UPDATE app_translations",
    `SET payload = json_patch(payload, json(${sqlString(chunkJson)}))`,
    `WHERE namespace = ${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}`,
    `  AND language = ${sqlString(language)};`,
  ].join("\n");
}

export function buildExactTranslationStorageRows(input: {
  curatedRows: readonly CuratedNamespaceRepairRow[];
  marketingSite: MarketingSiteRepairCorpus;
  mainAppRows: readonly MainAppRepairRow[];
  marketingContract?: LegacyMarketingSiteContract;
}): D1TranslationStorageRow[] {
  assertExactCuratedExpectedRows(input.curatedRows);
  assertExactMarketingSiteRepairCorpus(
    input.marketingSite,
    input.marketingContract ?? legacyMarketingSiteContract,
  );
  assertExactMainAppExpectedRows(input.mainAppRows);
  const rows: D1TranslationStorageRow[] = [
    ...input.curatedRows.map((row) => ({
      namespace: row.namespace,
      language: row.language,
      sourceHash: row.sourceHash,
      payloadJson: canonicalPayloadJson(row.payload),
      model: curatedRepairModel,
    })),
    ...input.marketingSite.rows.map((row) => ({
      namespace: row.namespace,
      language: row.language,
      sourceHash: row.source_hash,
      payloadJson: row.payload,
      model: row.model,
    })),
    ...input.mainAppRows.map((row) => ({
      namespace: row.namespace,
      language: row.language,
      sourceHash: row.sourceHash,
      payloadJson: canonicalPayloadJson(row.payload),
      model: mainAppRepairModel,
    })),
  ];
  if (
    rows.length !== LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT
  ) {
    throw new Error(
      `Exact D1 translation storage projection requires ${LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT} rows; received ${rows.length}.`,
    );
  }
  for (const row of rows) measureD1TranslationStorageRow(row);
  return rows;
}

export function assertExactProductionD1StorageIdentity(
  database: D1DatabaseStorageInfo,
) {
  if (
    database.databaseName !== D1_DATABASE_NAME ||
    database.databaseUuid.toLowerCase() !== D1_DATABASE_ID
  ) {
    throw new Error(
      "D1 storage admission does not identify the configured production database.",
    );
  }
  return database;
}

export function buildExactD1StorageAdmission(input: {
  database: D1DatabaseStorageInfo;
  translationRows: readonly D1TranslationStorageRow[];
  sourceEntries: readonly D1SourceStorageEntry[];
}) {
  assertExactProductionD1StorageIdentity(input.database);
  if (
    input.translationRows.length !==
    LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT
  ) {
    throw new Error(
      `Exact D1 storage admission requires ${LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT} translation rows; received ${input.translationRows.length}.`,
    );
  }
  const identifiers = new Set(
    input.translationRows.map((row) => `${row.namespace}\0${row.language}`),
  );
  if (identifiers.size !== input.translationRows.length) {
    throw new Error("Exact D1 storage admission contains duplicate translation rows.");
  }
  return assertD1FreeStorageAdmission(
    projectD1FreeStorageAdmission({
      database: input.database,
      translationRows: input.translationRows,
      sourceEntries: input.sourceEntries,
    }),
  );
}

export function revalidateExactD1StorageAdmission(input: {
  initialDatabase: D1DatabaseStorageInfo;
  currentDatabase: D1DatabaseStorageInfo;
  translationRows: readonly D1TranslationStorageRow[];
  sourceEntries: readonly D1SourceStorageEntry[];
}) {
  const initialDatabase = assertExactProductionD1StorageIdentity(
    input.initialDatabase,
  );
  if (
    input.currentDatabase.databaseName !== initialDatabase.databaseName ||
    input.currentDatabase.databaseUuid.toLowerCase() !==
      initialDatabase.databaseUuid.toLowerCase()
  ) {
    throw new Error("D1 storage admission database identity changed before import.");
  }
  const currentDatabase = assertExactProductionD1StorageIdentity(
    input.currentDatabase,
  );
  return buildExactD1StorageAdmission({
    database: currentDatabase,
    translationRows: input.translationRows,
    sourceEntries: input.sourceEntries,
  });
}

export function buildSiteSourceStorageEntries(): D1SourceStorageEntry[] {
  return Object.entries(siteSourceManifest).map(([namespace, source]) => ({
    namespace,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
  }));
}

export function loadMainAppRepairRows(): MainAppRepairRow[] {
  const rows: MainAppRepairRow[] = [];
  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  const source = {
    namespace: mainAppTranslationNamespace,
    sourceHash,
    sourceStrings,
  };
  const sourceKeys = Object.keys(sourceStrings).sort();
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);

  for (const language of targetLanguages) {
    const bundle = getCuratedMainAppTranslationBundle(language);
    if (
      !bundle ||
      bundle.namespace !== mainAppTranslationNamespace ||
      bundle.language !== language ||
      bundle.sourceHash !== sourceHash ||
      !isTranslationBundleCompleteAndFluent(source, bundle, language)
    ) {
      throw new Error(`Tracked main-app translation is not render-ready for ${language}.`);
    }

    const bundleKeys = Object.keys(bundle.strings).sort();
    if (
      bundleKeys.length !== sourceKeys.length ||
      sourceKeys.some((key, index) => key !== bundleKeys[index])
    ) {
      throw new Error(`Tracked main-app translation is incomplete for ${language}.`);
    }

    const payload: Record<string, string> = {};
    for (const key of sourceKeys) {
      const sourceText = sourceStrings[key];
      const value = bundle.strings[key];
      if (
        !isValidFieldTranslation(sourceText, value, language, key) ||
        value !== value.normalize("NFC")
      ) {
        throw new Error(`Tracked main-app translation is invalid for ${language}/${key}.`);
      }
      payload[key] = value;
    }
    rows.push({
      namespace: mainAppTranslationNamespace,
      language,
      sourceHash,
      payload,
    });
  }

  return rows;
}

/**
 * Re-reads and revalidates every translation payload immediately before the
 * atomic import. This binds the already-built SQL to the same reviewed corpus
 * that exists after the final clean/pushed artifact gate, closing the window
 * where a pack could be changed while the release process is waiting.
 */
export function assertTranslationRepairPayloadInputsUnchanged(input: {
  expectedCuratedCorpusSha256: string;
  expectedMarketingSiteCorpusSha256: string;
  expectedMainAppRepairSqlSha256: string;
  loadCuratedRows?: () => CuratedNamespaceRepairRow[];
  loadMarketingSite?: () => MarketingSiteRepairCorpus;
  loadMainAppRows?: () => MainAppRepairRow[];
}) {
  if (
    !/^[a-f0-9]{64}$/.test(input.expectedCuratedCorpusSha256) ||
    !/^[a-f0-9]{64}$/.test(input.expectedMarketingSiteCorpusSha256) ||
    !/^[a-f0-9]{64}$/.test(input.expectedMainAppRepairSqlSha256)
  ) {
    throw new Error("Translation payload revalidation expected malformed SHA-256 evidence.");
  }
  const liveCuratedRows = (input.loadCuratedRows ?? loadCuratedNamespaceRepairRows)();
  assertExactCuratedExpectedRows(liveCuratedRows);
  const liveCuratedCorpusSha256 = curatedCorpusSha256(liveCuratedRows);
  if (liveCuratedCorpusSha256 !== input.expectedCuratedCorpusSha256) {
    throw new Error("Curated translation corpus drifted before its D1 write.");
  }

  const liveMarketingSite = (
    input.loadMarketingSite ?? loadReleasedMarketingSiteRepairCorpus
  )();
  assertExactMarketingSiteRepairCorpus(liveMarketingSite);
  const liveMarketingSiteCorpusSha256 =
    liveMarketingSite.corpus.identity.corpusSha256;
  if (
    liveMarketingSiteCorpusSha256 !==
    input.expectedMarketingSiteCorpusSha256
  ) {
    throw new Error("Marketing-site translation corpus drifted before its D1 write.");
  }

  const liveMainAppRows = (input.loadMainAppRows ?? loadMainAppRepairRows)();
  const liveMainAppRepairSqlSha256 = sha256(buildMainAppRepairPlan(liveMainAppRows).sql);
  if (liveMainAppRepairSqlSha256 !== input.expectedMainAppRepairSqlSha256) {
    throw new Error("Main-app translation corpus drifted before its D1 write.");
  }
  return {
    curatedCorpusSha256: liveCuratedCorpusSha256,
    marketingSiteCorpusSha256: liveMarketingSiteCorpusSha256,
    mainAppRepairSqlSha256: liveMainAppRepairSqlSha256,
  };
}

export function buildMainAppRepairPlan(rows: readonly MainAppRepairRow[]): MainAppRepairPlan {
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const expectedLanguages = new Set<SupportedLanguage>(targetLanguages);
  if (rows.length !== expectedLanguages.size) {
    throw new Error(
      `Expected ${expectedLanguages.size} main-app translation rows, received ${rows.length}.`,
    );
  }

  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  const source = {
    namespace: mainAppTranslationNamespace,
    sourceHash,
    sourceStrings,
  };
  const sourceKeys = Object.keys(sourceStrings).sort();
  const seenLanguages = new Set<SupportedLanguage>();
  const statements = [buildMainAppCardinalityGuardSql(targetLanguages)];
  let resetStatements = 0;
  let patchStatements = 0;
  let largestPayloadBytes = 0;

  for (const row of rows) {
    if (
      row.namespace !== mainAppTranslationNamespace ||
      !expectedLanguages.has(row.language) ||
      row.sourceHash !== sourceHash
    ) {
      throw new Error(`Unexpected main-app translation row ${row.namespace}/${row.language}.`);
    }
    if (seenLanguages.has(row.language)) {
      throw new Error(`Duplicate main-app translation row for ${row.language}.`);
    }
    seenLanguages.add(row.language);

    const payloadKeys = Object.keys(row.payload).sort();
    if (
      payloadKeys.length !== sourceKeys.length ||
      sourceKeys.some((key, index) => key !== payloadKeys[index])
    ) {
      throw new Error(`Incomplete main-app translation payload for ${row.language}.`);
    }
    for (const key of sourceKeys) {
      const value = row.payload[key];
      if (
        !isValidFieldTranslation(sourceStrings[key], value, row.language, key) ||
        value !== value.normalize("NFC")
      ) {
        throw new Error(`Invalid main-app translation payload for ${row.language}/${key}.`);
      }
    }
    if (
      !isTranslationBundleCompleteAndFluent(
        source,
        {
          namespace: row.namespace,
          language: row.language,
          sourceHash: row.sourceHash,
          sourceStrings,
          strings: row.payload,
        },
        row.language,
      )
    ) {
      throw new Error(`Main-app translation payload is not fluent for ${row.language}.`);
    }
    const payloadBytes = Buffer.byteLength(canonicalPayloadJson(row.payload), "utf8");
    assertD1TranslationPayloadSize(
      payloadBytes,
      `${mainAppTranslationNamespace}/${row.language}`,
    );
    largestPayloadBytes = Math.max(largestPayloadBytes, payloadBytes);

    statements.push(buildMainAppResetStatement(row));
    resetStatements += 1;
    const patchSql = buildMainAppPatchStatements(row, sourceKeys);
    statements.push(...patchSql);
    patchStatements += patchSql.length;
  }

  if (seenLanguages.size !== expectedLanguages.size) {
    throw new Error(
      `Main-app translation row set is incomplete: ${seenLanguages.size}/${expectedLanguages.size}.`,
    );
  }

  const sql = statements.join("\n\n");
  return {
    sql,
    rows: rows.length,
    resetStatements,
    patchStatements,
    logicalRowWrites: resetStatements + patchStatements,
    largestStatementBytes: assertD1SqlStatementSize(sql),
    largestPayloadBytes,
  };
}

function buildMainAppCardinalityGuardSql(languages: readonly SupportedLanguage[]) {
  const allowedLanguages = languages.map(sqlString).join(", ");
  return [
    "SELECT CASE",
    `  WHEN COUNT(*) <= ${languages.length}`,
    `    AND COALESCE(SUM(CASE WHEN language IN (${allowedLanguages}) THEN 1 ELSE 0 END), 0) = COUNT(*)`,
    "  THEN json('{}')",
    "  ELSE json('main-app-cardinality-guard-failed')",
    "END AS main_app_cardinality_guard",
    "FROM app_translations",
    `WHERE namespace = ${sqlString(mainAppTranslationNamespace)};`,
  ].join("\n");
}

function buildMainAppResetStatement(row: MainAppRepairRow) {
  const now = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
  return [
    "INSERT INTO app_translations",
    "  (namespace, language, source_hash, payload, model, created_at, updated_at)",
    "VALUES",
    `  (${sqlString(mainAppTranslationNamespace)}, ${sqlString(row.language)}, ${sqlString(row.sourceHash)},`,
    `   json('{}'), ${sqlString(mainAppRepairModel)}, ${now}, ${now})`,
    "ON CONFLICT(namespace, language) DO UPDATE SET",
    "  source_hash = excluded.source_hash,",
    "  payload = excluded.payload,",
    "  model = excluded.model,",
    "  updated_at = excluded.updated_at;",
  ].join("\n");
}

function buildMainAppPatchStatements(
  row: MainAppRepairRow,
  sourceKeys: readonly string[],
) {
  return buildBoundedJsonPatchStatements({
    namespace: mainAppTranslationNamespace,
    language: row.language,
    sourceKeys,
    payload: row.payload,
    buildStatement: (chunkJson) => buildMainAppPatchStatement(row.language, chunkJson),
  });
}

function buildBoundedJsonPatchStatements(input: {
  namespace: string;
  language: SupportedLanguage;
  sourceKeys: readonly string[];
  payload: Readonly<Record<string, string>>;
  buildStatement: (chunkJson: string) => string;
}) {
  if (input.sourceKeys.some((key, index) => index > 0 && input.sourceKeys[index - 1]! > key)) {
    throw new Error(
      `D1 translation patch keys are not sorted for ${input.namespace}/${input.language}.`,
    );
  }
  const statements: string[] = [];
  const emptyStatement = input.buildStatement("{}");
  const fixedStatementBytes =
    Buffer.byteLength(emptyStatement, "utf8") - Buffer.byteLength(sqlString("{}"), "utf8");
  let fragments: string[] = [];
  let encodedFragmentBytes = 0;

  const flush = () => {
    if (!fragments.length) return;
    const chunkJson = `{${fragments.join(",")}}`;
    const statement = input.buildStatement(chunkJson);
    const bytes = Buffer.byteLength(statement, "utf8");
    if (bytes > repairPatchStatementTargetBytes) {
      throw new Error(
        `Translation patch statement exceeds the ${repairPatchStatementTargetBytes}-byte target: ` +
          `${input.namespace}/${input.language} is ${bytes} bytes.`,
      );
    }
    statements.push(statement);
    fragments = [];
    encodedFragmentBytes = 0;
  };

  for (const key of input.sourceKeys) {
    const fragment = `${JSON.stringify(key)}:${JSON.stringify(input.payload[key])}`;
    const encodedBytes = Buffer.byteLength(fragment.replaceAll("'", "''"), "utf8");
    const commaBytes = fragments.length ? 1 : 0;
    const candidateStatementBytes =
      fixedStatementBytes +
      4 +
      encodedFragmentBytes +
      commaBytes +
      encodedBytes;
    if (candidateStatementBytes > repairPatchStatementTargetBytes && fragments.length) {
      flush();
    }

    const singleFragmentStatementBytes = fixedStatementBytes + 4 + encodedBytes;
    if (singleFragmentStatementBytes > repairPatchStatementTargetBytes) {
      throw new Error(
        `Translation entry exceeds the D1 patch target for ` +
          `${input.namespace}/${input.language}/${key}.`,
      );
    }
    if (fragments.length) encodedFragmentBytes += 1;
    fragments.push(fragment);
    encodedFragmentBytes += encodedBytes;
  }
  flush();
  return statements;
}

function buildMainAppPatchStatement(language: SupportedLanguage, chunkJson: string) {
  return [
    "UPDATE app_translations",
    `SET payload = json_patch(payload, json(${sqlString(chunkJson)}))`,
    `WHERE namespace = ${sqlString(mainAppTranslationNamespace)}`,
    `  AND language = ${sqlString(language)};`,
  ].join("\n");
}

export function buildCuratedNamespaceRepairSql(rows: readonly CuratedNamespaceRepairRow[]) {
  return buildCuratedNamespaceRepairPlan(rows).sql;
}

export function buildCuratedNamespaceRepairPlan(
  rows: readonly CuratedNamespaceRepairRow[],
): CuratedNamespaceRepairPlan {
  const expectedPacks = getExactCuratedPackIdentifiers().filter(
    (identifier) => identifier.namespace !== mainAppTranslationNamespace,
  );
  const expectedIdentifiers = new Set(
    expectedPacks.map((identifier) =>
      translationIdentifier(identifier.namespace, identifier.language),
    ),
  );
  if (rows.length !== expectedIdentifiers.size) {
    throw new Error(
      `Expected ${expectedIdentifiers.size} curated translation rows, received ${rows.length}.`,
    );
  }

  const sortedRows = [...rows].sort(compareCuratedRepairRows);
  const seenIdentifiers = new Set<string>();
  const legacyPrerequisiteStatements = [buildCuratedCardinalityGuardSql(expectedPacks)];
  const postLegacyCanonicalStatements: string[] = [];
  let resetStatements = 0;
  let patchStatements = 0;
  let payloadBytes = 0;
  let largestPayloadBytes = 0;

  for (const row of sortedRows) {
    const identifier = translationIdentifier(row.namespace, row.language);
    if (!expectedIdentifiers.has(identifier)) {
      throw new Error(`Unexpected curated translation row ${row.namespace}/${row.language}.`);
    }
    if (seenIdentifiers.has(identifier)) {
      throw new Error(`Duplicate curated translation row ${row.namespace}/${row.language}.`);
    }
    seenIdentifiers.add(identifier);

    const source = getSiteTranslationSource(row.namespace);
    if (row.sourceHash !== source.sourceHash) {
      throw new Error(`Stale curated translation source hash for ${row.namespace}/${row.language}.`);
    }
    const sourceKeys = Object.keys(source.sourceStrings).sort();
    const payloadKeys = Object.keys(row.payload).sort();
    if (
      payloadKeys.length !== sourceKeys.length ||
      sourceKeys.some((key, index) => key !== payloadKeys[index])
    ) {
      throw new Error(`Incomplete curated translation payload for ${row.namespace}/${row.language}.`);
    }
    const canonicalPayload: Record<string, string> = {};
    for (const key of sourceKeys) {
      const sourceText = source.sourceStrings[key];
      const value = row.payload[key];
      if (
        !isValidFieldTranslation(sourceText, value, row.language, key) ||
        value !== value.normalize("NFC")
      ) {
        throw new Error(
          `Invalid curated translation payload for ${row.namespace}/${row.language}/${key}.`,
        );
      }
      canonicalPayload[key] = value;
    }
    if (
      !isTranslationBundleCompleteAndFluent(
        source,
        {
          namespace: row.namespace,
          language: row.language,
          sourceHash: row.sourceHash,
          sourceStrings: source.sourceStrings,
          strings: canonicalPayload,
        },
        row.language,
      )
    ) {
      throw new Error(
        `Curated translation payload is not fluent for ${row.namespace}/${row.language}.`,
      );
    }

    const rowStatements = [buildCuratedResetStatement(row)];
    resetStatements += 1;
    const patches = buildCuratedPatchStatements(row, canonicalPayload, sourceKeys);
    rowStatements.push(...patches);
    if (row.namespace === "route:home") {
      legacyPrerequisiteStatements.push(...rowStatements);
    } else {
      postLegacyCanonicalStatements.push(...rowStatements);
    }
    patchStatements += patches.length;
    const rowPayloadBytes = Buffer.byteLength(JSON.stringify(canonicalPayload), "utf8");
    assertD1TranslationPayloadSize(
      rowPayloadBytes,
      `${row.namespace}/${row.language}`,
    );
    payloadBytes += rowPayloadBytes;
    largestPayloadBytes = Math.max(largestPayloadBytes, rowPayloadBytes);
  }
  if (seenIdentifiers.size !== expectedIdentifiers.size) {
    throw new Error(
      `Curated translation row set is incomplete: ${seenIdentifiers.size}/${expectedIdentifiers.size}.`,
    );
  }

  const legacyPrerequisiteSql = legacyPrerequisiteStatements.join("\n\n");
  const postLegacyCanonicalSql = postLegacyCanonicalStatements.join("\n\n");
  const sql = [legacyPrerequisiteSql, postLegacyCanonicalSql].join("\n\n");
  return {
    sql,
    legacyPrerequisiteSql,
    postLegacyCanonicalSql,
    rows: sortedRows.length,
    resetStatements,
    patchStatements,
    logicalRowWrites: resetStatements + patchStatements,
    largestStatementBytes: assertD1SqlStatementSize(sql),
    payloadBytes,
    largestPayloadBytes,
    corpusSha256: curatedCorpusSha256(sortedRows),
  };
}

function buildCuratedCardinalityGuardSql(
  expectedPacks: readonly CuratedPackIdentifier[],
) {
  const excludedNamespaces = [
    mainAppTranslationNamespace,
    ...staticRepairNamespaces,
  ].map(sqlString).join(", ");
  return [
    buildExpectedCuratedCte(expectedPacks),
    "SELECT CASE",
    `  WHEN (SELECT COUNT(*) FROM expected_curated) = ${expectedPacks.length}`,
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM app_translations AS target",
    `      WHERE target.namespace NOT IN (${excludedNamespaces})`,
    "        AND NOT EXISTS (",
    "          SELECT 1 FROM expected_curated AS expected",
    "          WHERE expected.namespace = target.namespace",
    "            AND expected.language = target.language",
    "        )",
    "    )",
    "  THEN json('{}')",
    "  ELSE json('curated-cardinality-guard-failed')",
    "END AS curated_cardinality_guard;",
  ].join("\n");
}

export function buildExpectedCuratedCte(
  expected: readonly Readonly<{ namespace: string; language: SupportedLanguage }>[],
) {
  const namespaces = [...new Set(expected.map((row) => row.namespace))].sort();
  const languages = [...new Set(expected.map((row) => row.language))].sort();
  const identifiers = new Set(
    expected.map((row) => translationIdentifier(row.namespace, row.language)),
  );
  const isExactCartesianProduct =
    identifiers.size === expected.length &&
    expected.length === namespaces.length * languages.length &&
    namespaces.every((namespace) =>
      languages.every((language) =>
        identifiers.has(translationIdentifier(namespace, language)),
      ),
    );
  if (isExactCartesianProduct) {
    const namespaceValues = namespaces.map((namespace) => `(${sqlString(namespace)})`).join(",\n    ");
    const languageValues = languages.map((language) => `(${sqlString(language)})`).join(",\n    ");
    return [
      "WITH expected_curated_namespaces(namespace) AS (",
      `  VALUES ${namespaceValues}`,
      "),",
      "expected_curated_languages(language) AS (",
      `  VALUES ${languageValues}`,
      "),",
      "expected_curated(namespace, language) AS (",
      "  SELECT namespace, language",
      "  FROM expected_curated_namespaces",
      "  CROSS JOIN expected_curated_languages",
      ")",
    ].join("\n");
  }

  const values = expected
    .map((row) => `(${sqlString(row.namespace)}, ${sqlString(row.language)})`)
    .join(",\n    ");
  return [
    "WITH expected_curated(namespace, language) AS (",
    `  VALUES ${values}`,
    ")",
  ].join("\n");
}

export function buildExactTranslationPartitionGuardSql() {
  const curated = getExactCuratedPackIdentifiers().filter(
    (identifier) => identifier.namespace !== mainAppTranslationNamespace,
  );
  if (
    curated.length !== LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT
  ) {
    throw new Error("Final translation partition guard has a stale curated row count.");
  }
  const allowedLanguages = legacyMarketingSiteTargetLanguages
    .map((language) => `(${sqlString(language)})`)
    .join(",\n    ");
  const sql = [
    buildExpectedCuratedCte(curated),
    ",",
    "expected_target_languages(language) AS (",
    `  VALUES ${allowedLanguages}`,
    ")",
    "SELECT CASE",
    `  WHEN (SELECT COUNT(*) FROM app_translations) = ${LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT}`,
    `    AND (SELECT COUNT(*) FROM app_translations WHERE namespace = ${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}) = ${LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT}`,
    `    AND (SELECT COUNT(*) FROM app_translations WHERE namespace = ${sqlString(mainAppTranslationNamespace)}) = ${LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT}`,
    `    AND (SELECT COUNT(*) FROM app_translations WHERE namespace NOT IN (${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}, ${sqlString(mainAppTranslationNamespace)})) = ${LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT}`,
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM app_translations AS target",
    "      WHERE NOT (",
    `        (target.namespace IN (${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}, ${sqlString(mainAppTranslationNamespace)})`,
    "          AND EXISTS (SELECT 1 FROM expected_target_languages AS expected",
    "            WHERE expected.language = target.language))",
    "        OR EXISTS (SELECT 1 FROM expected_curated AS expected",
    "          WHERE expected.namespace = target.namespace",
    "            AND expected.language = target.language)",
    "      )",
    "    )",
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM expected_curated AS expected",
    "      WHERE NOT EXISTS (SELECT 1 FROM app_translations AS target",
    "        WHERE target.namespace = expected.namespace",
    "          AND target.language = expected.language)",
    "    )",
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM expected_target_languages AS expected",
    "      WHERE NOT EXISTS (SELECT 1 FROM app_translations AS target",
    `        WHERE target.namespace = ${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}`,
    "          AND target.language = expected.language)",
    "        OR NOT EXISTS (SELECT 1 FROM app_translations AS target",
    `          WHERE target.namespace = ${sqlString(mainAppTranslationNamespace)}`,
    "            AND target.language = expected.language)",
    "    )",
    "  THEN json('{}')",
    "  ELSE json('exact-translation-partition-guard-failed')",
    "END AS exact_translation_partition_guard;",
  ].join("\n");
  assertD1SqlStatementSize(sql);
  return sql;
}

function buildCuratedResetStatement(row: CuratedNamespaceRepairRow) {
  const now = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
  return [
    "INSERT INTO app_translations",
    "  (namespace, language, source_hash, payload, model, created_at, updated_at)",
    "VALUES",
    `  (${sqlString(row.namespace)}, ${sqlString(row.language)}, ${sqlString(row.sourceHash)},`,
    `   json('{}'), ${sqlString(curatedRepairModel)}, ${now}, ${now})`,
    "ON CONFLICT(namespace, language) DO UPDATE SET",
    "  source_hash = excluded.source_hash,",
    "  payload = excluded.payload,",
    "  model = excluded.model,",
    "  updated_at = excluded.updated_at;",
  ].join("\n");
}

function buildCuratedPatchStatements(
  row: CuratedNamespaceRepairRow,
  canonicalPayload: Readonly<Record<string, string>>,
  sourceKeys: readonly string[],
) {
  const buildStatement = (chunkJson: string) =>
    [
      "UPDATE app_translations",
      `SET payload = json_patch(payload, json(${sqlString(chunkJson)}))`,
      `WHERE namespace = ${sqlString(row.namespace)}`,
      `  AND language = ${sqlString(row.language)};`,
    ].join("\n");
  return buildBoundedJsonPatchStatements({
    namespace: row.namespace,
    language: row.language,
    sourceKeys,
    payload: canonicalPayload,
    buildStatement,
  });
}

export function largestSqlStatementBytes(sql: string) {
  return Math.max(
    0,
    ...splitSqlStatements(sql).map((statement) => Buffer.byteLength(statement, "utf8")),
  );
}

export function assertD1SqlStatementSize(sql: string) {
  const largest = largestSqlStatementBytes(sql);
  if (largest > maximumD1SqlStatementBytes) {
    throw new Error(
      `SQL exceeds the D1 ${maximumD1SqlStatementBytes}-byte statement limit: ` +
        `${largest} bytes.`,
    );
  }
  return largest;
}

export function assertD1TranslationPayloadSize(bytes: number, identifier: string) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`D1 translation payload size is invalid for ${identifier}.`);
  }
  if (bytes > maximumD1TranslationPayloadBytes) {
    throw new Error(
      `D1 translation payload exceeds the ${maximumD1TranslationPayloadBytes}-byte row limit for ` +
        `${identifier}: ${bytes} bytes.`,
    );
  }
  return bytes;
}

export function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let statementStart = 0;
  let quote: "'" | '"' | "`" | "]" | undefined;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (quote !== "]" && next === quote) {
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (character === "-" && next === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") {
      quote = "]";
      continue;
    }
    if (character !== ";") continue;

    const statement = sql.slice(statementStart, index + 1).trim();
    if (statement) statements.push(statement);
    statementStart = index + 1;
  }

  if (quote || inBlockComment) {
    throw new Error("SQL statement parsing failed because a quote or block comment is unterminated.");
  }

  const trailingStatement = sql.slice(statementStart).trim();
  if (trailingStatement) statements.push(trailingStatement);
  return statements;
}

export function projectRepairBilledRowWrites(
  sourceSyncProjectedWrites: number,
  staticRepairRows: number,
  curatedRepairLogicalRowWrites: number,
  marketingSiteRepairLogicalRowWrites: number,
  mainAppRepairRowWrites: number,
) {
  const counts = [
    sourceSyncProjectedWrites,
    staticRepairRows,
    curatedRepairLogicalRowWrites,
    marketingSiteRepairLogicalRowWrites,
    mainAppRepairRowWrites,
  ];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Projected D1 repair write inputs must be non-negative safe integers.");
  }
  return (
    sourceSyncProjectedWrites +
    (staticRepairRows +
      curatedRepairLogicalRowWrites +
      marketingSiteRepairLogicalRowWrites +
      mainAppRepairRowWrites) *
      projectedBilledWritesPerRepairTranslationRow +
    4 // exact indexed create + clear of the durable production maintenance marker
  );
}

export function translationRepairBudgetPlanSha256(input: {
  candidateVersionId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  repairSqlSha256: string;
  sourceSyncSha256: string;
  curatedCorpusSha256: string;
  marketingSiteCorpusSha256: string;
}) {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const sourceFingerprint = releaseBudgetSourceIdentity(input.sourceFingerprint);
  for (const [label, value] of [
    ["repair SQL", input.repairSqlSha256],
    ["source-sync plan", input.sourceSyncSha256],
    ["curated corpus", input.curatedCorpusSha256],
    ["marketing-site corpus", input.marketingSiteCorpusSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`Translation repair budget requires an exact ${label} SHA-256.`);
    }
  }
  return sha256(
    JSON.stringify({
      kind: "remote-seo-cta-translation-repair-plan",
      candidateVersionId,
      sourceFingerprint,
      repairSqlSha256: input.repairSqlSha256,
      sourceSyncSha256: input.sourceSyncSha256,
      curatedCorpusSha256: input.curatedCorpusSha256,
      marketingSiteCorpusSha256: input.marketingSiteCorpusSha256,
    }),
  );
}

export function translationRepairBudgetOperationId(input: {
  candidateVersionId: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  planSha256: string;
  releasePreflightRunId?: string;
}) {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const sourceFingerprint = releaseBudgetSourceIdentity(input.sourceFingerprint);
  if (!/^[a-f0-9]{64}$/.test(input.planSha256)) {
    throw new Error("Translation repair budget requires an exact plan SHA-256.");
  }
  const releasePreflightRunId = input.releasePreflightRunId;
  if (releasePreflightRunId !== undefined) {
    productionMaintenanceRepairRunId(releasePreflightRunId);
  }
  const binding = sha256(JSON.stringify(
    releasePreflightRunId === undefined
      ? {
          kind: "remote-seo-cta-translation-repair",
          candidateVersionId,
          sourceFingerprint,
          planSha256: input.planSha256,
        }
      : {
          kind: "remote-seo-cta-translation-repair-v2",
          candidateVersionId,
          sourceFingerprint,
          planSha256: input.planSha256,
          releasePreflightRunId,
        },
  ));
  return `seo-cta-translation-repair:${binding}`;
}

function translationRepairClock(options: RepairSeoCtaTranslationOptions) {
  if (options.clock) return options.clock;
  if (options.now !== undefined) {
    const fixed = new Date(options.now);
    return () => new Date(fixed.getTime());
  }
  return () => new Date();
}

function readTranslationRepairClock(clock: () => Date, label: string) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Remote ${label} clock is invalid.`);
  }
  return value;
}

function readTranslationAttestationClock(clock: (() => Date) | undefined, label: string) {
  const value = (clock ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Remote translation attestation ${label} clock is invalid.`);
  }
  return value.toISOString();
}

function releaseBudgetSourceIdentity(
  fingerprint: Pick<D1ReleaseSourceIdentity, "sha256" | "fileCount">,
): D1ReleaseSourceIdentity {
  if (!/^[a-f0-9]{64}$/.test(fingerprint.sha256)) {
    throw new Error("Translation repair budget requires an exact source fingerprint.");
  }
  if (!Number.isSafeInteger(fingerprint.fileCount) || fingerprint.fileCount <= 0) {
    throw new Error("Translation repair budget requires a positive source file count.");
  }
  return { sha256: fingerprint.sha256, fileCount: fingerprint.fileCount };
}

export function projectRepairBilledRowReads(
  sourceSyncProjectedReads: number,
  staticRepairRows: number,
  curatedRepairRows: number,
  marketingSiteRepairRows: number,
  mainAppRepairRows: number,
) {
  const counts = [
    sourceSyncProjectedReads,
    staticRepairRows,
    curatedRepairRows,
    marketingSiteRepairRows,
    mainAppRepairRows,
  ];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Projected D1 repair read inputs must be non-negative safe integers.");
  }
  // The source-sync plan already reserves its snapshot, backup-scale reads, and
  // whole-site verification. Reserve four indexed reads for every exact repair
  // identifier (target discovery, the atomic guard, verification, and headroom).
  return (
    sourceSyncProjectedReads +
    (staticRepairRows +
      curatedRepairRows +
      marketingSiteRepairRows +
      mainAppRepairRows) * 4 +
    1_128 // verification headroom plus bounded marker create/clear ownership reads
  );
}

export function assertRepairWriteBudget(projectedBilledRowWrites: number) {
  if (!Number.isSafeInteger(projectedBilledRowWrites) || projectedBilledRowWrites < 0) {
    throw new Error("Projected D1 repair writes must be a non-negative safe integer.");
  }
  if (projectedBilledRowWrites > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES) {
    throw new Error(
      "Projected atomic translation repair writes exceed the Workers Free safety budget: " +
        projectedBilledRowWrites +
        " > " +
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES +
        ".",
    );
  }
  return projectedBilledRowWrites;
}

export function assertRepairReadBudget(projectedBilledRowReads: number) {
  if (!Number.isSafeInteger(projectedBilledRowReads) || projectedBilledRowReads < 0) {
    throw new Error("Projected D1 repair reads must be a non-negative safe integer.");
  }
  if (projectedBilledRowReads > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS) {
    throw new Error(
      "Projected atomic translation repair reads exceed the Workers Free safety budget: " +
        projectedBilledRowReads +
        " > " +
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS +
        ".",
    );
  }
  return projectedBilledRowReads;
}

export type RemoteRepairTargetIdentifier = {
  namespace: string;
  language: string;
};

export function validateStaticRepairTargetIdentifiers(
  rows: readonly RemoteRepairTargetIdentifier[],
  expectedLanguages: readonly SupportedLanguage[],
) {
  const expectedLanguageNames = new Set<string>(expectedLanguages);
  if (!expectedLanguages.length || expectedLanguageNames.size !== expectedLanguages.length) {
    throw new Error("Expected static repair languages must be non-empty and unique.");
  }
  const identifiers = new Set<string>();
  const byNamespace = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!staticRepairNamespaceNames.has(row.namespace)) {
      throw new Error(`Unexpected production translation namespace ${row.namespace}.`);
    }
    if (!expectedLanguageNames.has(row.language)) {
      throw new Error(
        `Unexpected production translation language ${row.namespace}/${row.language}.`,
      );
    }
    const identifier = translationIdentifier(row.namespace, row.language);
    if (identifiers.has(identifier)) {
      throw new Error(`Duplicate production translation identifier ${row.namespace}/${row.language}.`);
    }
    identifiers.add(identifier);
    const languages = byNamespace.get(row.namespace) ?? new Set<string>();
    languages.add(row.language);
    byNamespace.set(row.namespace, languages);
  }

  let totalRows = 0;
  for (const namespace of staticRepairNamespaces) {
    const actualLanguages = byNamespace.get(namespace) ?? new Set<string>();
    const allowedCardinality =
      namespace === "marketing-site"
        ? actualLanguages.size === 0 || actualLanguages.size === expectedLanguages.length
        : actualLanguages.size === expectedLanguages.length;
    const exact = expectedLanguages.every((language) => actualLanguages.has(language));
    if (!allowedCardinality || (actualLanguages.size > 0 && !exact)) {
      throw new Error(
        `Unexpected production translation identifiers for ${namespace}: ` +
          `${actualLanguages.size}/${expectedLanguages.length}.`,
      );
    }
    totalRows += actualLanguages.size;
  }
  return totalRows;
}

export function validateExistingCuratedTargetIdentifiers(
  rows: readonly RemoteRepairTargetIdentifier[],
  expectedRows: readonly CuratedNamespaceRepairRow[],
) {
  const expectedIdentifiers = new Set(
    expectedRows.map((row) => translationIdentifier(row.namespace, row.language)),
  );
  if (expectedIdentifiers.size !== expectedRows.length) {
    throw new Error("Expected curated repair identifiers contain duplicates.");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const identifier = translationIdentifier(row.namespace, row.language);
    if (!expectedIdentifiers.has(identifier)) {
      throw new Error(
        `Unexpected curated production translation identifier ${row.namespace}/${row.language}.`,
      );
    }
    if (seen.has(identifier)) {
      throw new Error(
        `Duplicate curated production translation identifier ${row.namespace}/${row.language}.`,
      );
    }
    seen.add(identifier);
  }
  return seen.size;
}

export function validateExistingMainAppTargetIdentifiers(
  rows: readonly RemoteRepairTargetIdentifier[],
  expectedRows: readonly MainAppRepairRow[],
) {
  const expectedIdentifiers = new Set(
    expectedRows.map((row) => translationIdentifier(row.namespace, row.language)),
  );
  if (expectedIdentifiers.size !== expectedRows.length) {
    throw new Error("Expected main-app repair identifiers contain duplicates.");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const identifier = translationIdentifier(row.namespace, row.language);
    if (!expectedIdentifiers.has(identifier)) {
      throw new Error(`Unexpected main-app translation identifier ${row.namespace}/${row.language}.`);
    }
    if (seen.has(identifier)) {
      throw new Error(`Duplicate main-app translation identifier ${row.namespace}/${row.language}.`);
    }
    seen.add(identifier);
  }
  return seen.size;
}

function validateRemoteRepairTargets(
  translations: ReadonlyMap<SupportedLanguage, string>,
  curatedRows: readonly CuratedNamespaceRepairRow[],
  marketingSite: MarketingSiteRepairCorpus,
  mainAppRows: readonly MainAppRepairRow[],
  runner: WranglerRunner = runWrangler,
) {
  assertExactMarketingSiteRepairCorpus(marketingSite);
  const marketingLanguages = new Set<string>(
    marketingSite.rows.map((row) => row.language),
  );
  if (
    marketingLanguages.size !== translations.size ||
    [...translations.keys()].some(
      (language) => !marketingLanguages.has(language),
    )
  ) {
    throw new Error(
      "Remote marketing-site target discovery is not bound to the exact released language set.",
    );
  }
  const sql = [
    "SELECT 'static' AS target_kind, namespace, language",
    "FROM app_translations",
    `WHERE namespace IN (${staticRepairNamespaces.map(sqlString).join(", ")})`,
    "ORDER BY namespace, language;",
    "SELECT 'curated' AS target_kind, target.namespace, target.language",
    "FROM app_translations AS target",
    `WHERE target.namespace <> ${sqlString(mainAppTranslationNamespace)}`,
    `  AND target.namespace NOT IN (${staticRepairNamespaces.map(sqlString).join(", ")})`,
    "ORDER BY target.namespace, target.language;",
    "SELECT 'main-app' AS target_kind, namespace, language",
    "FROM app_translations",
    `WHERE namespace = ${sqlString(mainAppTranslationNamespace)}`,
    "ORDER BY language;",
  ].join("\n");
  assertD1SqlStatementSize(sql);
  const output = runner([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  const resultRows = d1ResultRows(output);
  const parseTargets = (kind: string) =>
    resultRows
      .filter((row) => row.target_kind === kind)
      .map((row) => {
        if (typeof row.namespace !== "string" || typeof row.language !== "string") {
          throw new Error(`Remote ${kind} translation target row is malformed.`);
        }
        return { namespace: row.namespace, language: row.language };
      });
  const staticTargets = parseTargets("static");
  const curatedTargets = parseTargets("curated");
  const mainAppTargets = parseTargets("main-app");
  if (staticTargets.length + curatedTargets.length + mainAppTargets.length !== resultRows.length) {
    throw new Error("Remote translation target discovery returned an unexpected result row.");
  }
  validateExistingCuratedTargetIdentifiers(curatedTargets, curatedRows);
  validateExistingMainAppTargetIdentifiers(mainAppTargets, mainAppRows);
  return validateStaticRepairTargetIdentifiers(staticTargets, Array.from(translations.keys()));
}

export function validateSiteSourceManifestFreshness() {
  return assertCurrentSiteSourceManifestFreshness().namespaceCount;
}

export function loadAndValidateTranslationSeed() {
  const parsed: unknown = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("SEO CTA translation seed must be an object.");
  }

  const translations = new Map<SupportedLanguage, string>();
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const expected = new Set<string>(targetLanguages);
  const extra = Object.keys(parsed).filter((language) => !expected.has(language));
  if (extra.length) {
    throw new Error("Unexpected SEO CTA translation languages: " + extra.join(", "));
  }

  for (const language of targetLanguages) {
    const value = parsed[language];
    if (typeof value !== "string" || value !== value.normalize("NFC")) {
      throw new Error("Missing or non-NFC SEO CTA translation for " + language + ".");
    }
    if (!isValidFieldTranslation("Try public modes", value, language)) {
      throw new Error("SEO CTA translation failed field validation for " + language + ".");
    }
    translations.set(language, value);
  }
  return translations;
}

function validateSourceContract(): Record<RepairNamespace, string> {
  const marketingSite = getSiteTranslationSource("marketing-site");
  if (marketingSite.sourceHash !== expectedSourceHashes["marketing-site"]) {
    throw new Error("Translation source hash drift for marketing-site: " + marketingSite.sourceHash);
  }
  for (const key of retiredGameTranslationKeys) {
    if (key in marketingSite.sourceStrings) {
      throw new Error("Retired game translation key remains in marketing-site: " + key);
    }
  }

  const contracts: ReadonlyArray<{
    namespace: RepairNamespace;
    key: string;
    sourceText: string;
  }> = [
    { namespace: "route:home", key: startLearningKey, sourceText: "Start learning" },
    { namespace: "route:about", key: startLearningKey, sourceText: "Start learning" },
    { namespace: "route:media", key: startLearningKey, sourceText: "Start learning" },
    { namespace: "route:schools", key: tryPublicModesKey, sourceText: "Try public modes" },
  ];
  const hashes: Record<RepairNamespace, string> = {
    "marketing-site": marketingSite.sourceHash,
    "route:home": "",
    "route:about": "",
    "route:chat-public": "",
    "route:media": "",
    "route:schools": "",
  };

  const publicChat = getSiteTranslationSource("route:chat-public");
  if (publicChat.sourceHash !== expectedSourceHashes["route:chat-public"]) {
    throw new Error("Translation source hash drift for route:chat-public: " + publicChat.sourceHash);
  }
  hashes["route:chat-public"] = publicChat.sourceHash;

  for (const contract of contracts) {
    const source = getSiteTranslationSource(contract.namespace);
    if (source.sourceHash !== expectedSourceHashes[contract.namespace]) {
      throw new Error(
        "Translation source hash drift for " + contract.namespace + ": " + source.sourceHash,
      );
    }
    if (source.sourceStrings[contract.key] !== contract.sourceText) {
      throw new Error("Translation source key drift for " + contract.namespace + ".");
    }
    hashes[contract.namespace] = source.sourceHash;
  }
  return hashes;
}

export function buildCanonicalLegacyMarketingCleanupSql() {
  if (
    legacyMarketingCleanupKeys.length !== 10 ||
    new Set<string>(legacyMarketingCleanupKeys).size !==
      legacyMarketingCleanupKeys.length ||
    retiredGameTranslationKeys.some(
      (key, index) => legacyMarketingCleanupKeys[index] !== key,
    )
  ) {
    throw new Error("Canonical legacy marketing cleanup key contract drifted.");
  }
  const jsonPath = (key: (typeof legacyMarketingCleanupKeys)[number]) =>
    `'$."${key}"'`;
  return [
    "UPDATE app_translations",
    "SET",
    "  payload = json_remove(",
    "    payload,",
    ...legacyMarketingCleanupKeys.map(
      (key, index) =>
        `    ${jsonPath(key)}${index + 1 === legacyMarketingCleanupKeys.length ? "" : ","}`,
    ),
    "  ),",
    "  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000",
    "WHERE namespace = 'marketing-site'",
    "  AND (",
    ...legacyMarketingCleanupKeys.map(
      (key, index) =>
        `    ${index === 0 ? "" : "OR "}json_type(payload, ${jsonPath(key)}) IS NOT NULL`,
    ),
    "  );",
    "",
  ].join("\n");
}

export function validateRepairSql(sql: string) {
  const expected = buildCanonicalLegacyMarketingCleanupSql();
  if (sql !== expected) {
    throw new Error(
      "Legacy marketing cleanup SQL must byte-match the canonical 10-key allowlist.",
    );
  }
  return expected;
}

export function buildRemoteRepairVerificationSql(
  translations: ReadonlyMap<SupportedLanguage, string>,
) {
  const expectedSourceValues = Object.entries(siteSourceManifest)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([namespace, source]) =>
        `(${sqlString(namespace)}, ${sqlString(source.sourceHash)})`,
    )
    .join(",");
  const allowedLanguageValues = Array.from(
    translations.keys(),
    (language) => `(${sqlString(language)})`,
  ).join(",");
  return [
    `WITH expected_sources(namespace, source_hash) AS (VALUES ${expectedSourceValues})`,
    "SELECT COUNT(*) AS expected_source_namespaces,",
    "  COUNT(source.namespace) AS source_namespaces,",
    "  SUM(source.source_hash = expected_sources.source_hash) AS fresh_source_namespaces,",
    "  (SELECT COUNT(*) FROM app_translation_sources) AS total_source_namespaces,",
    "  (SELECT COUNT(*) FROM app_translation_sources AS actual",
    "   WHERE NOT EXISTS (SELECT 1 FROM expected_sources WHERE expected_sources.namespace = actual.namespace))",
    "   AS unexpected_source_namespaces",
    "FROM expected_sources",
    "LEFT JOIN app_translation_sources AS source USING (namespace);",
    `WITH allowed_languages(language) AS (VALUES ${allowedLanguageValues})`,
    "SELECT COUNT(*) AS observed_translation_rows,",
    `  SUM(CASE WHEN t.namespace <> ${sqlString(mainAppTranslationNamespace)} THEN 1 ELSE 0 END) AS observed_site_translation_rows,`,
    `  SUM(CASE WHEN t.namespace NOT IN (${sqlString(mainAppTranslationNamespace)}, ${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}) THEN 1 ELSE 0 END) AS observed_curated_site_rows,`,
    `  SUM(CASE WHEN t.namespace = ${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)} THEN 1 ELSE 0 END) AS observed_marketing_site_rows,`,
    `  SUM(CASE WHEN t.namespace = ${sqlString(mainAppTranslationNamespace)} THEN 1 ELSE 0 END) AS observed_main_app_rows,`,
    `  SUM(CASE WHEN t.namespace <> ${sqlString(mainAppTranslationNamespace)} AND t.source_hash = s.source_hash THEN 1 ELSE 0 END) AS observed_fresh_translation_rows,`,
    `  SUM(CASE WHEN s.namespace IS NULL AND t.namespace <> ${sqlString(mainAppTranslationNamespace)} THEN 1 ELSE 0 END) AS unexpected_translation_namespaces,`,
    "  SUM(CASE WHEN allowed_languages.language IS NULL THEN 1 ELSE 0 END) AS unsupported_languages",
    "FROM app_translations AS t LEFT JOIN app_translation_sources AS s USING (namespace)",
    "LEFT JOIN allowed_languages ON allowed_languages.language = t.language;",
    "SELECT COUNT(*) AS retired_game_payloads FROM app_translations",
    "WHERE namespace = 'marketing-site' AND (",
    ...retiredGameTranslationKeys.flatMap((key, index) => [
      (index === 0 ? "  " : "  OR ") + "json_type(payload, '$.\"" + key + "\"') IS NOT NULL",
    ]),
    ");",
  ].join("\n");
}

export function assertReadOnlyRemoteTranslationVerificationArgs(args: readonly string[]) {
  const commandIndex = args.indexOf("--command");
  if (
    args[0] !== "d1" ||
    args[1] !== "execute" ||
    args[2] !== D1_DATABASE_NAME ||
    !args.includes("--remote") ||
    !args.includes("--json") ||
    commandIndex < 0 ||
    commandIndex !== args.length - 2 ||
    args.includes("--local") ||
    args.includes("--file") ||
    args.includes("--yes") ||
    args.includes("time-travel")
  ) {
    throw new Error("Verify-only translation drift detection attempted a non-read-only Wrangler command.");
  }
  const sql = args[commandIndex + 1];
  if (!sql) throw new Error("Verify-only translation drift detection requires an exact SQL query.");
  const statements = splitSqlStatements(sql);
  if (
    !statements.length ||
    statements.some((statement) => {
      const normalized = stripLeadingSqlComments(statement).trim();
      return (
        !/^(?:SELECT|WITH)\b/i.test(normalized) ||
        /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(
          normalized,
        )
      );
    })
  ) {
    throw new Error("Verify-only translation drift detection rejected mutating or malformed SQL.");
  }
  return sql;
}

function readOnlyRemoteVerificationRunner(
  runner: WranglerRunner,
  counter: { queries: number; billedRowsRead: number },
): WranglerRunner {
  return (args, options = {}) => {
    assertReadOnlyRemoteTranslationVerificationArgs(args);
    counter.queries += 1;
    const output = runner(args, options);
    counter.billedRowsRead = safeAddBilledRowsRead(
      counter.billedRowsRead,
      readOnlyD1BilledRowsRead(output),
    );
    return output;
  };
}

function readOnlyD1BilledRowsRead(output: string) {
  return parseD1Billing(output, {
    label: "read-only D1 verification",
    readOnly: true,
  }).rowsRead;
}

export type D1Billing = {
  rowsRead: number;
  rowsWritten: number;
};

export function parseD1Billing(
  output: string,
  options: {
    label: string;
    expectedResultSets?: number;
    readOnly?: boolean;
    requireSingleAttempt?: boolean;
  },
): D1Billing {
  const value = parseJsonFromOutput(output);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    (options.expectedResultSets !== undefined && value.length !== options.expectedResultSets)
  ) {
    throw new RemoteVerificationIndeterminateError(
      `${options.label} omitted or returned the wrong number of billed-row result sets.`,
    );
  }
  let rowsRead = 0;
  let rowsWritten = 0;
  for (const entry of value) {
    const meta = isRecord(entry) ? entry.meta : undefined;
    if (
      !isRecord(entry) ||
      entry.success !== true ||
      !isRecord(meta) ||
      typeof meta.rows_read !== "number" ||
      !Number.isSafeInteger(meta.rows_read) ||
      meta.rows_read < 0 ||
      typeof meta.rows_written !== "number" ||
      !Number.isSafeInteger(meta.rows_written) ||
      meta.rows_written < 0 ||
      (options.readOnly === true && meta.rows_written !== 0) ||
      (options.requireSingleAttempt === true && meta.total_attempts !== 1)
    ) {
      throw new RemoteVerificationIndeterminateError(
        `${options.label} returned malformed or unexpectedly mutating billing metadata.`,
      );
    }
    rowsRead = safeAddD1Billing(rowsRead, meta.rows_read, `${options.label} rows read`);
    rowsWritten = safeAddD1Billing(
      rowsWritten,
      meta.rows_written,
      `${options.label} rows written`,
    );
  }
  return { rowsRead, rowsWritten };
}

function safeAddBilledRowsRead(left: number, right: number) {
  return safeAddD1Billing(left, right, "Read-only D1 billed rows read");
}

function safeAddD1Billing(left: number, right: number, label: string) {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0
  ) {
    throw new RemoteVerificationIndeterminateError(
      `${label} inputs were not non-negative safe integers.`,
    );
  }
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RemoteVerificationIndeterminateError(
      `${label} accounting overflowed.`,
    );
  }
  return total;
}

export function assertRemoteRepairBillingWithinMaximum(input: {
  readOnlyRowsRead: number;
  importBilling: D1Billing | null;
}) {
  const observedRowsRead = safeAddD1Billing(
    input.readOnlyRowsRead,
    input.importBilling?.rowsRead ?? 0,
    "Remote translation repair observed rows read",
  );
  const reservedRowsRead = safeAddD1Billing(
    observedRowsRead,
    remoteRepairControlRowsReadReservation,
    "Remote translation repair reserved rows read",
  );
  const reservedRowsWritten = safeAddD1Billing(
    input.importBilling?.rowsWritten ?? 0,
    remoteRepairControlRowsWrittenReservation,
    "Remote translation repair reserved rows written",
  );
  if (
    reservedRowsRead > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS ||
    reservedRowsWritten > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES
  ) {
    throw new RemoteVerificationIndeterminateError(
      "Observed remote translation repair billing exceeded its retained maximum reservation.",
    );
  }
  return { rowsRead: reservedRowsRead, rowsWritten: reservedRowsWritten };
}

export function verifyRemoteTranslationDrift(input: {
  translations: ReadonlyMap<SupportedLanguage, string>;
  curatedRepairRows: readonly CuratedNamespaceRepairRow[];
  marketingSite: MarketingSiteRepairCorpus;
  mainAppRepairRows: readonly MainAppRepairRow[];
  runner?: WranglerRunner;
  now?: number;
}): RemoteTranslationDriftReport {
  const counter = { queries: 0, billedRowsRead: 0 };
  const runner = readOnlyRemoteVerificationRunner(input.runner ?? runWrangler, counter);
  let sourcePlan: ReturnType<typeof planSiteTranslationSourceSync>;
  try {
    sourcePlan = planSiteTranslationSourceSync("remote", runner);
  } catch (error) {
    throw new RemoteVerificationIndeterminateError(
      "Production translation source snapshot could not be read deterministically.",
      { cause: error },
    );
  }
  const sourceStatus = sourcePlan.statements === 0 ? "reconciled" : "repair-required";
  const sourceIssues: RemoteTranslationDriftIssue[] =
    sourceStatus === "reconciled"
      ? []
      : [
          {
            scope: "source-snapshot",
            code: "exact-source-snapshot-drift",
            message:
              `Exact production source reconciliation requires ${sourcePlan.statements} ` +
              `statement(s) covering ${sourcePlan.logicalRowWrites} logical row write(s).`,
          },
        ];
  const payloadInspection = inspectRemoteRepairPayloads(
    input.translations,
    input.curatedRepairRows,
    input.marketingSite,
    input.mainAppRepairRows,
    runner,
  );
  if (counter.queries !== payloadInspection.expectedRemoteQueries) {
    throw new RemoteVerificationIndeterminateError(
      `Production translation verification executed ${counter.queries} read-only queries; ` +
        `expected exactly ${payloadInspection.expectedRemoteQueries}.`,
    );
  }
  const issues = [...sourceIssues, ...payloadInspection.issues];
  const status = issues.length ? "repair-required" : "reconciled";
  return {
    createdAt: new Date(input.now ?? Date.now()).toISOString(),
    mode: "remote-verify-only",
    database: D1_DATABASE_NAME,
    ok: status === "reconciled",
    status,
    repairRequired: status === "repair-required",
    issues,
    expected: {
      sourceNamespaces: Object.keys(siteSourceManifest).length,
      curatedRows: input.curatedRepairRows.length,
      marketingSiteRows: input.marketingSite.rows.length,
      mainAppRows: input.mainAppRepairRows.length,
      supportedTargetLanguages: input.translations.size,
      remoteQueries: payloadInspection.expectedRemoteQueries,
    },
    sourceSnapshot: {
      status: sourceStatus,
      expectedSourceNamespaces: sourcePlan.rows,
      expectedSourceStrings: sourcePlan.sourceStringCount,
      reconciliationStatements: sourcePlan.statements,
      reconciliationLogicalRowWrites: sourcePlan.logicalRowWrites,
      snapshotBilledRowReads: sourcePlan.snapshotBilledRowReads,
      projectedBilledRowReads: sourcePlan.projectedBilledRowReads,
    },
    payloadSnapshot: {
      status: payloadInspection.issues.length ? "repair-required" : "reconciled",
      issues: payloadInspection.issues,
      ...(payloadInspection.verification
        ? { verification: payloadInspection.verification }
        : {}),
    },
    readOnly: {
      remoteQueries: counter.queries,
      billedRowsRead: counter.billedRowsRead,
      workerUploads: 0,
      workerDeployments: 0,
      maintenanceActivations: 0,
      timeTravelReads: 0,
      sqlImports: 0,
      databaseWrites: 0,
      unresolvedMarkersCreated: 0,
      preWriteEvidenceCreated: 0,
      reportsWritten: 0,
    },
  };
}

function runRemoteVerificationQuery(
  sql: string,
  maxBuffer: number,
  runner: WranglerRunner = runWrangler,
) {
  try {
    const output = runner(
      [
        "d1",
        "execute",
        D1_DATABASE_NAME,
        "--remote",
        "--json",
        "--command",
        sql,
      ],
      { maxBuffer },
    );
    return strictD1ResultRows(output, splitSqlStatements(sql).length);
  } catch (error) {
    if (error instanceof RemoteVerificationIndeterminateError) throw error;
    throw new RemoteVerificationIndeterminateError(
      "Remote D1 verification query did not return a deterministic result.",
      { cause: error },
    );
  }
}

function inspectRemoteRepairPayloads(
  translations: ReadonlyMap<SupportedLanguage, string>,
  curatedRepairRows: readonly CuratedNamespaceRepairRow[],
  marketingSite: MarketingSiteRepairCorpus,
  mainAppRepairRows: readonly MainAppRepairRow[],
  runner: WranglerRunner,
) {
  const expectedSourceNamespaces = Object.keys(siteSourceManifest).length;
  const auditedSiteNamespaces = new Set(curatedRepairRows.map((row) => row.namespace)).size;
  const verificationSql = buildRemoteRepairVerificationSql(translations);
  const rows = runRemoteVerificationQuery(verificationSql, 64 * 1024 * 1024, runner);
  const sources = requireSingleVerificationRow(
    rows,
    (row) => "expected_source_namespaces" in row,
    "source coverage",
  );
  const observed = requireSingleVerificationRow(
    rows,
    (row) => "observed_translation_rows" in row,
    "translation coverage",
  );
  const retired = requireSingleVerificationRow(
    rows,
    (row) => "retired_game_payloads" in row,
    "retired game coverage",
  );
  const classifiedRows = 3;
  if (classifiedRows !== rows.length) {
    throw new RemoteVerificationIndeterminateError(
      `Remote translation summary returned ${rows.length - classifiedRows} unclassified row(s).`,
    );
  }
  const expectedSourceNamespacesRead = verificationCounter(
    sources.expected_source_namespaces,
    "expected source namespace count",
  );
  const sourceNamespaces = verificationCounter(sources.source_namespaces, "source namespace count");
  const freshSourceNamespaces = verificationCounter(
    sources.fresh_source_namespaces,
    "fresh source namespace count",
  );
  const totalSourceNamespaces = verificationCounter(
    sources.total_source_namespaces,
    "total source namespace count",
  );
  const unexpectedSourceNamespaces = verificationCounter(
    sources.unexpected_source_namespaces,
    "unexpected source namespace count",
  );
  const observedTranslationRows = verificationCounter(
    observed.observed_translation_rows,
    "observed translation row count",
  );
  const observedFreshTranslationRows = verificationCounter(
    observed.observed_fresh_translation_rows,
    "observed fresh translation row count",
  );
  const observedSiteTranslationRows = verificationCounter(
    observed.observed_site_translation_rows,
    "observed site translation row count",
  );
  const observedCuratedSiteRows = verificationCounter(
    observed.observed_curated_site_rows,
    "observed curated site row count",
  );
  const observedMarketingSiteRows = verificationCounter(
    observed.observed_marketing_site_rows,
    "observed marketing-site row count",
  );
  const observedMainAppRows = verificationCounter(
    observed.observed_main_app_rows,
    "observed main-app row count",
  );
  const unexpectedTranslationNamespaces = verificationCounter(
    observed.unexpected_translation_namespaces,
    "unexpected translation namespace count",
  );
  const unsupportedLanguages = verificationCounter(
    observed.unsupported_languages,
    "unsupported translation language count",
  );
  const retiredGamePayloads = verificationCounter(
    retired.retired_game_payloads,
    "retired game payload count",
  );
  const issues: RemoteTranslationDriftIssue[] = [];
  const addIssue = (
    scope: RemoteTranslationDriftIssue["scope"],
    code: string,
    message: string,
  ) => issues.push({ scope, code, message });

  if (
    expectedSourceNamespacesRead !== expectedSourceNamespaces ||
    sourceNamespaces !== expectedSourceNamespaces ||
    freshSourceNamespaces !== expectedSourceNamespaces ||
    totalSourceNamespaces !== expectedSourceNamespaces ||
    unexpectedSourceNamespaces !== 0 ||
    observedTranslationRows !==
      LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT ||
    observedFreshTranslationRows !==
      LEGACY_MARKETING_SITE_EXPECTED_SITE_ROW_COUNT ||
    observedSiteTranslationRows !==
      LEGACY_MARKETING_SITE_EXPECTED_SITE_ROW_COUNT ||
    observedCuratedSiteRows !==
      LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT ||
    observedMarketingSiteRows !==
      LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT ||
    observedMainAppRows !==
      LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT ||
    unexpectedTranslationNamespaces !== 0 ||
    unsupportedLanguages !== 0
  ) {
    addIssue(
      "translation-summary",
      "source-or-translation-coverage-drift",
      "Translation source or audited payload coverage verification failed.",
    );
  }
  if (retiredGamePayloads !== 0) {
    addIssue(
      "translation-summary",
      "retired-game-payload-drift",
      "Retired game translation payload verification failed.",
    );
  }

  const curatedVerificationChunks = buildCuratedRepairVerificationChunks(curatedRepairRows);
  let curatedVerification: ReturnType<typeof verifyCuratedRepairResultChunks> | undefined;
  try {
    curatedVerification = verifyCuratedRepairPlannedResultChunks(
      curatedRepairRows,
      curatedVerificationChunks,
      (chunk) => runRemoteVerificationQuery(chunk.sql, chunk.maxBufferBytes, runner),
    );
  } catch (error) {
    if (error instanceof RemoteVerificationIndeterminateError) throw error;
    addIssue(
      "curated-payloads",
      "exact-curated-payload-drift",
      "Exact curated translation verification failed.",
    );
  }

  const marketingSiteVerificationChunks =
    buildMarketingSiteRepairVerificationChunks(marketingSite);
  let marketingSiteVerification:
    | ReturnType<typeof verifyMarketingSiteRepairResultChunks>
    | undefined;
  try {
    marketingSiteVerification = verifyMarketingSiteRepairPlannedResultChunks(
      marketingSite,
      marketingSiteVerificationChunks,
      (chunk) => runRemoteVerificationQuery(chunk.sql, chunk.maxBufferBytes, runner),
    );
  } catch (error) {
    if (error instanceof RemoteVerificationIndeterminateError) throw error;
    addIssue(
      "marketing-site-payloads",
      "exact-marketing-site-payload-drift",
      "Exact composed marketing-site translation verification failed.",
    );
  }

  const mainAppVerificationChunks = buildMainAppRepairVerificationChunks(mainAppRepairRows);
  let mainAppRowsMatched: number | undefined;
  try {
    mainAppRowsMatched = verifyMainAppRepairPlannedResultChunks(
      mainAppRepairRows,
      mainAppVerificationChunks,
      (chunk) => runRemoteVerificationQuery(chunk.sql, chunk.maxBufferBytes, runner),
    ).rowsMatched;
  } catch (error) {
    if (error instanceof RemoteVerificationIndeterminateError) throw error;
    addIssue(
      "main-app-payloads",
      "exact-main-app-payload-drift",
      "Exact main-app translation verification failed.",
    );
  }

  const expectedRemoteQueries =
    remoteTranslationVerificationFixedQueryCount +
    curatedVerificationChunks.length +
    marketingSiteVerificationChunks.length +
    mainAppVerificationChunks.length;
  if (
    issues.length ||
    !curatedVerification ||
    !marketingSiteVerification ||
    mainAppRowsMatched === undefined
  ) {
    return { issues, expectedRemoteQueries };
  }
  const verification: NonNullable<RepairReport["productionVerification"]> = {
    expectedSourceNamespaces,
    sourceNamespaces,
    freshSourceNamespaces,
    observedTranslationRows,
    observedFreshTranslationRows,
    auditedSiteNamespaces,
    auditedSiteRows: curatedVerification.rowsMatched,
    retiredGamePayloads,
    curatedRowsMatched: curatedVerification.rowsMatched,
    curatedPayloadBytesMatched: curatedVerification.payloadBytesMatched,
    curatedCorpusSha256: curatedVerification.corpusSha256,
    marketingSiteRowsMatched: marketingSiteVerification.rowsMatched,
    marketingSitePayloadBytesMatched:
      marketingSiteVerification.payloadBytesMatched,
    marketingSiteCorpusSha256:
      marketingSiteVerification.corpusSha256,
    mainAppRowsMatched,
    exactFinalRows:
      curatedVerification.rowsMatched +
      marketingSiteVerification.rowsMatched +
      mainAppRowsMatched,
  };
  return { issues, verification, expectedRemoteQueries };
}

function verifyRemoteRepair(
  translations: ReadonlyMap<SupportedLanguage, string>,
  curatedRepairRows: readonly CuratedNamespaceRepairRow[],
  marketingSite: MarketingSiteRepairCorpus,
  mainAppRepairRows: readonly MainAppRepairRow[],
  runner: WranglerRunner = runWrangler,
) {
  const inspection = inspectRemoteRepairPayloads(
    translations,
    curatedRepairRows,
    marketingSite,
    mainAppRepairRows,
    runner,
  );
  if (inspection.issues.length) {
    throw new RemoteVerificationMismatchError(
      `Exact production translation verification found ${inspection.issues.length} drift issue(s): ` +
        inspection.issues.map((issue) => issue.code).join(", "),
    );
  }
  if (!inspection.verification) {
    throw new RemoteVerificationIndeterminateError(
      "Exact production translation verification returned no deterministic result.",
    );
  }
  return inspection.verification;
}

export function buildCuratedRepairVerificationSql(
  expectedRows: readonly CuratedNamespaceRepairRow[],
) {
  assertExactCuratedExpectedRows(expectedRows);
  return buildCuratedRepairVerificationQuery(expectedRows);
}

function buildCuratedRepairVerificationQuery(
  expectedRows: readonly CuratedNamespaceRepairRow[],
) {
  if (expectedRows.length === 0) {
    throw new Error("Curated translation verification query must not be empty.");
  }
  const sql = [
    buildExpectedCuratedCte([...expectedRows].sort(compareCuratedRepairRows)),
    "SELECT target.namespace, target.language, target.payload, target.source_hash, target.model",
    "FROM expected_curated AS expected",
    "JOIN app_translations AS target",
    "  ON target.namespace = expected.namespace AND target.language = expected.language",
    "ORDER BY target.namespace, target.language;",
  ].join("\n");
  assertD1SqlStatementSize(sql);
  return sql;
}

function curatedVerificationMaxBufferBytes(
  expectedPayloadBytes: number,
  rows: number,
) {
  if (
    !Number.isSafeInteger(expectedPayloadBytes) ||
    expectedPayloadBytes < 0 ||
    !Number.isSafeInteger(rows) ||
    rows <= 0
  ) {
    throw new Error("Curated translation verification buffer inputs are invalid.");
  }
  const estimatedJsonEnvelopeBytes =
    expectedPayloadBytes * 3 + rows * 4_096 + 64 * 1_024;
  if (!Number.isSafeInteger(estimatedJsonEnvelopeBytes)) {
    throw new Error("Curated translation verification buffer estimate overflowed.");
  }
  return Math.min(
    curatedVerificationMaximumBufferBytes,
    Math.max(curatedVerificationMinimumBufferBytes, estimatedJsonEnvelopeBytes),
  );
}

export function buildCuratedRepairVerificationChunks(
  expectedRows: readonly CuratedNamespaceRepairRow[],
): CuratedRepairVerificationChunk[] {
  assertExactCuratedExpectedRows(expectedRows);
  const sortedRows = [...expectedRows].sort(compareCuratedRepairRows);
  const chunks: CuratedRepairVerificationChunk[] = [];
  let pendingRows: CuratedNamespaceRepairRow[] = [];
  let pendingPayloadBytes = 0;

  const flush = () => {
    if (pendingRows.length === 0) return;
    const exactRows = Object.freeze([...pendingRows]);
    const sql = buildCuratedRepairVerificationQuery(exactRows);
    chunks.push({
      index: chunks.length,
      rows: exactRows.length,
      expectedPayloadBytes: pendingPayloadBytes,
      sqlBytes: Buffer.byteLength(sql, "utf8"),
      maxBufferBytes: curatedVerificationMaxBufferBytes(
        pendingPayloadBytes,
        exactRows.length,
      ),
      expectedRows: exactRows,
      sql,
    });
    pendingRows = [];
    pendingPayloadBytes = 0;
  };

  for (const row of sortedRows) {
    const rowPayloadBytes = assertD1TranslationPayloadSize(
      Buffer.byteLength(canonicalPayloadJson(row.payload), "utf8"),
      `${row.namespace}/${row.language}`,
    );
    if (
      pendingRows.length > 0 &&
      (pendingRows.length >= curatedVerificationMaximumRowsPerQuery ||
        pendingPayloadBytes + rowPayloadBytes > curatedVerificationTargetPayloadBytes)
    ) {
      flush();
    }
    pendingRows.push(row);
    pendingPayloadBytes += rowPayloadBytes;
  }
  flush();

  if (
    chunks.length === 0 ||
    chunks.reduce((total, chunk) => total + chunk.rows, 0) !== expectedRows.length ||
    chunks.some(
      (chunk) =>
        chunk.rows <= 0 ||
        chunk.rows > curatedVerificationMaximumRowsPerQuery ||
        chunk.sqlBytes > maximumD1SqlStatementBytes ||
        chunk.maxBufferBytes > curatedVerificationMaximumBufferBytes,
    )
  ) {
    throw new Error("Curated translation verification chunk planning failed closed.");
  }
  return chunks;
}

export function curatedRepairVerificationQueryCount(
  expectedRows: readonly CuratedNamespaceRepairRow[],
) {
  return buildCuratedRepairVerificationChunks(expectedRows).length;
}

export function buildMarketingSiteRepairVerificationChunks(
  release: MarketingSiteRepairCorpus,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
): MarketingSiteRepairVerificationChunk[] {
  assertExactMarketingSiteRepairCorpus(release, contract);
  const sortedRows = [...release.rows].sort((left, right) =>
    left.language.localeCompare(right.language)
  );
  const chunks: MarketingSiteRepairVerificationChunk[] = [];
  let pendingRows: MarketingSiteRepairRow[] = [];
  let pendingPayloadBytes = 0;
  const flush = () => {
    if (pendingRows.length === 0) return;
    const exactRows = Object.freeze([...pendingRows]);
    const sql = [
      "SELECT namespace, language, payload, source_hash, model",
      "FROM app_translations",
      `WHERE namespace = ${sqlString(LEGACY_MARKETING_SITE_NAMESPACE)}`,
      `  AND language IN (${exactRows.map((row) => sqlString(row.language)).join(", ")})`,
      "ORDER BY language;",
    ].join("\n");
    const sqlBytes = assertD1SqlStatementSize(sql);
    chunks.push({
      index: chunks.length,
      rows: exactRows.length,
      expectedPayloadBytes: pendingPayloadBytes,
      sqlBytes,
      maxBufferBytes: curatedVerificationMaxBufferBytes(
        pendingPayloadBytes,
        exactRows.length,
      ),
      expectedRows: exactRows,
      sql,
    });
    pendingRows = [];
    pendingPayloadBytes = 0;
  };
  for (const row of sortedRows) {
    const rowPayloadBytes = assertD1TranslationPayloadSize(
      Buffer.byteLength(row.payload, "utf8"),
      `${row.namespace}/${row.language}`,
    );
    if (
      pendingRows.length > 0 &&
      (pendingRows.length >= marketingSiteVerificationMaximumRowsPerQuery ||
        pendingPayloadBytes + rowPayloadBytes >
          curatedVerificationTargetPayloadBytes)
    ) {
      flush();
    }
    pendingRows.push(row);
    pendingPayloadBytes += rowPayloadBytes;
  }
  flush();
  if (
    chunks.length === 0 ||
    chunks.reduce((total, chunk) => total + chunk.rows, 0) !==
      release.rows.length ||
    chunks.some(
      (chunk) =>
        chunk.rows <= 0 ||
        chunk.rows > marketingSiteVerificationMaximumRowsPerQuery ||
        chunk.sqlBytes > maximumD1SqlStatementBytes ||
        chunk.maxBufferBytes > curatedVerificationMaximumBufferBytes,
    )
  ) {
    throw new Error("Marketing-site translation verification chunk planning failed closed.");
  }
  return chunks;
}

export function marketingSiteRepairVerificationQueryCount(
  release: MarketingSiteRepairCorpus,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
) {
  return buildMarketingSiteRepairVerificationChunks(release, contract).length;
}

export function verifyMarketingSiteRepairResultRows(
  actualRows: readonly Record<string, unknown>[],
  release: MarketingSiteRepairCorpus,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
) {
  assertExactMarketingSiteRepairCorpus(release, contract);
  if (actualRows.length !== release.rows.length) {
    throw new Error(
      `Marketing-site translation row cardinality failed: ${actualRows.length}/${release.rows.length}.`,
    );
  }
  const rows: MarketingSiteRepairRow[] = actualRows.map((actual) => {
    const language = isLegacyMarketingSiteTargetLanguage(actual.language)
      ? actual.language
      : null;
    if (
      actual.namespace !== LEGACY_MARKETING_SITE_NAMESPACE ||
      !language ||
      typeof actual.source_hash !== "string" ||
      typeof actual.payload !== "string" ||
      typeof actual.model !== "string"
    ) {
      throw new Error("Marketing-site translation verification returned a malformed row.");
    }
    return {
      namespace: LEGACY_MARKETING_SITE_NAMESPACE,
      language,
      source_hash: actual.source_hash,
      payload: actual.payload,
      model: actual.model,
    };
  });
  const validated = validateLegacyMarketingSiteDatabaseRows({
    contract,
    expectedCorpus: release.corpus,
    rows,
  });
  return {
    rowsMatched: validated.rows,
    payloadBytesMatched: rows.reduce(
      (total, row) => total + Buffer.byteLength(row.payload, "utf8"),
      0,
    ),
    corpusSha256: validated.corpusSha256,
    model: validated.model,
  };
}

function isLegacyMarketingSiteTargetLanguage(
  value: unknown,
): value is LegacyMarketingSiteTargetLanguage {
  return (
    typeof value === "string" &&
    legacyMarketingSiteTargetLanguages.some(
      (candidate) => candidate === value,
    )
  );
}

export function verifyMarketingSiteRepairResultChunks(
  release: MarketingSiteRepairCorpus,
  readChunk: (
    chunk: MarketingSiteRepairVerificationChunk,
  ) => readonly Record<string, unknown>[],
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
) {
  return verifyMarketingSiteRepairPlannedResultChunks(
    release,
    buildMarketingSiteRepairVerificationChunks(release, contract),
    readChunk,
    contract,
  );
}

function verifyMarketingSiteRepairPlannedResultChunks(
  release: MarketingSiteRepairCorpus,
  chunks: readonly MarketingSiteRepairVerificationChunk[],
  readChunk: (
    chunk: MarketingSiteRepairVerificationChunk,
  ) => readonly Record<string, unknown>[],
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
) {
  const actualRows: Record<string, unknown>[] = [];
  let firstVerificationError: unknown;
  for (const chunk of chunks) {
    try {
      const rows = readChunk(chunk);
      if (rows.length !== chunk.expectedRows.length) {
        throw new Error(
          `Marketing-site verification chunk ${chunk.index} returned ${rows.length}/${chunk.expectedRows.length} rows.`,
        );
      }
      actualRows.push(...rows);
    } catch (error) {
      firstVerificationError ??= error;
    }
  }
  if (firstVerificationError !== undefined) throw firstVerificationError;
  return {
    ...verifyMarketingSiteRepairResultRows(actualRows, release, contract),
    queryCount: chunks.length,
  };
}

export function buildMainAppRepairVerificationChunks(
  expectedRows: readonly MainAppRepairRow[],
): MainAppRepairVerificationChunk[] {
  assertExactMainAppExpectedRows(expectedRows);
  const sortedRows = [...expectedRows].sort((left, right) =>
    left.language.localeCompare(right.language),
  );
  const chunks: MainAppRepairVerificationChunk[] = [];
  let pendingRows: MainAppRepairRow[] = [];
  let pendingPayloadBytes = 0;

  const flush = () => {
    if (pendingRows.length === 0) return;
    const exactRows = Object.freeze([...pendingRows]);
    const sql = [
      "SELECT namespace, language, payload, source_hash, model",
      "FROM app_translations",
      `WHERE namespace = ${sqlString(mainAppTranslationNamespace)}`,
      `  AND language IN (${exactRows.map((row) => sqlString(row.language)).join(", ")})`,
      "ORDER BY language;",
    ].join("\n");
    const sqlBytes = assertD1SqlStatementSize(sql);
    chunks.push({
      index: chunks.length,
      rows: exactRows.length,
      expectedPayloadBytes: pendingPayloadBytes,
      sqlBytes,
      maxBufferBytes: curatedVerificationMaxBufferBytes(
        pendingPayloadBytes,
        exactRows.length,
      ),
      expectedRows: exactRows,
      sql,
    });
    pendingRows = [];
    pendingPayloadBytes = 0;
  };

  for (const row of sortedRows) {
    const rowPayloadBytes = assertD1TranslationPayloadSize(
      Buffer.byteLength(canonicalPayloadJson(row.payload), "utf8"),
      `${mainAppTranslationNamespace}/${row.language}`,
    );
    if (
      pendingRows.length > 0 &&
      (pendingRows.length >= mainAppVerificationMaximumRowsPerQuery ||
        pendingPayloadBytes + rowPayloadBytes > curatedVerificationTargetPayloadBytes)
    ) {
      flush();
    }
    pendingRows.push(row);
    pendingPayloadBytes += rowPayloadBytes;
  }
  flush();

  if (
    chunks.length === 0 ||
    chunks.reduce((total, chunk) => total + chunk.rows, 0) !== expectedRows.length ||
    chunks.some(
      (chunk) =>
        chunk.rows <= 0 ||
        chunk.rows > mainAppVerificationMaximumRowsPerQuery ||
        chunk.sqlBytes > maximumD1SqlStatementBytes ||
        chunk.maxBufferBytes > curatedVerificationMaximumBufferBytes,
    )
  ) {
    throw new Error("Main-app translation verification chunk planning failed closed.");
  }
  return chunks;
}

export function mainAppRepairVerificationQueryCount(
  expectedRows: readonly MainAppRepairRow[],
) {
  return buildMainAppRepairVerificationChunks(expectedRows).length;
}

type CuratedVerificationHashRow = {
  namespace: keyof typeof siteSourceManifest;
  language: SupportedLanguage;
  sourceHash: string;
  payload: string;
};

function verifyCuratedRepairChunkResultRows(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: readonly CuratedNamespaceRepairRow[],
) {
  if (actualRows.length !== expectedRows.length) {
    throw new Error(
      `Curated translation row cardinality failed: ${actualRows.length}/${expectedRows.length}.`,
    );
  }

  const expectedByIdentifier = new Map<string, CuratedNamespaceRepairRow>();
  for (const expected of expectedRows) {
    const identifier = translationIdentifier(expected.namespace, expected.language);
    if (expectedByIdentifier.has(identifier)) {
      throw new Error(
        `Curated expected rows contain a duplicate ${expected.namespace}/${expected.language}.`,
      );
    }
    expectedByIdentifier.set(identifier, expected);
  }

  let payloadBytesMatched = 0;
  const hashRows: CuratedVerificationHashRow[] = [];
  for (const actual of actualRows) {
    const namespace = isPublishedSiteNamespace(actual.namespace) ? actual.namespace : null;
    const language = isSupportedLanguageValue(actual.language) ? actual.language : null;
    const identifier =
      namespace && language ? translationIdentifier(namespace, language) : null;
    const expected = identifier ? expectedByIdentifier.get(identifier) : undefined;
    if (!namespace || !language || !identifier || !expected) {
      throw new Error(
        "Curated translation verification found an unexpected or duplicate namespace/language.",
      );
    }
    if (
      actual.source_hash !== expected.sourceHash ||
      actual.model !== curatedRepairModel ||
      typeof actual.payload !== "string"
    ) {
      throw new Error(`Curated translation metadata verification failed for ${namespace}/${language}.`);
    }

    const expectedPayload = canonicalPayloadJson(expected.payload);
    if (actual.payload !== expectedPayload) {
      throw new Error(
        `Curated translation payload byte verification failed for ${namespace}/${language}.`,
      );
    }
    payloadBytesMatched += Buffer.byteLength(actual.payload, "utf8");
    hashRows.push({
      namespace,
      language,
      sourceHash: expected.sourceHash,
      payload: actual.payload,
    });
    expectedByIdentifier.delete(identifier);
  }

  if (expectedByIdentifier.size !== 0 || hashRows.length !== expectedRows.length) {
    throw new Error(
      `Curated translation row verification failed: ${hashRows.length}/${expectedRows.length}.`,
    );
  }
  hashRows.sort(compareCuratedVerificationHashRows);
  return { rowsMatched: hashRows.length, payloadBytesMatched, hashRows };
}

export function verifyCuratedRepairResultChunks(
  expectedRows: readonly CuratedNamespaceRepairRow[],
  readChunk: (
    chunk: CuratedRepairVerificationChunk,
  ) => readonly Record<string, unknown>[],
) {
  const chunks = buildCuratedRepairVerificationChunks(expectedRows);
  return verifyCuratedRepairPlannedResultChunks(expectedRows, chunks, readChunk);
}

function verifyCuratedRepairPlannedResultChunks(
  expectedRows: readonly CuratedNamespaceRepairRow[],
  chunks: readonly CuratedRepairVerificationChunk[],
  readChunk: (
    chunk: CuratedRepairVerificationChunk,
  ) => readonly Record<string, unknown>[],
) {
  const digest = crypto.createHash("sha256");
  let firstDigestRow = true;
  let rowsMatched = 0;
  let payloadBytesMatched = 0;
  let firstVerificationError: unknown;

  for (const chunk of chunks) {
    const actualRows = readChunk(chunk);
    let verified: ReturnType<typeof verifyCuratedRepairChunkResultRows>;
    try {
      verified = verifyCuratedRepairChunkResultRows(actualRows, chunk.expectedRows);
    } catch (error) {
      firstVerificationError ??= error;
      continue;
    }
    rowsMatched += verified.rowsMatched;
    payloadBytesMatched += verified.payloadBytesMatched;
    for (const row of verified.hashRows) {
      updateCuratedCorpusDigest(digest, row, firstDigestRow);
      firstDigestRow = false;
    }
  }

  if (firstVerificationError !== undefined) throw firstVerificationError;

  if (rowsMatched !== expectedRows.length) {
    throw new Error(
      `Curated translation row verification failed: ${rowsMatched}/${expectedRows.length}.`,
    );
  }
  const corpusSha256 = digest.digest("hex");
  const expectedCorpusSha256 = curatedCorpusSha256(expectedRows);
  if (corpusSha256 !== expectedCorpusSha256) {
    throw new Error("Curated translation corpus SHA-256 verification failed.");
  }
  return {
    rowsMatched,
    payloadBytesMatched,
    corpusSha256,
    queryCount: chunks.length,
  };
}

export function verifyCuratedRepairResultRows(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: readonly CuratedNamespaceRepairRow[],
) {
  assertExactCuratedExpectedRows(expectedRows);
  const verified = verifyCuratedRepairChunkResultRows(actualRows, expectedRows);
  const corpusSha256 = curatedResultCorpusSha256(verified.hashRows);
  const expectedCorpusSha256 = curatedCorpusSha256(expectedRows);
  if (corpusSha256 !== expectedCorpusSha256) {
    throw new Error("Curated translation corpus SHA-256 verification failed.");
  }
  return {
    rowsMatched: verified.rowsMatched,
    payloadBytesMatched: verified.payloadBytesMatched,
    corpusSha256,
  };
}

export function verifyMainAppRepairResultRows(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: readonly MainAppRepairRow[],
) {
  assertExactMainAppExpectedRows(expectedRows);
  return verifyMainAppRepairChunkResultRows(actualRows, expectedRows);
}

function verifyMainAppRepairChunkResultRows(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: readonly MainAppRepairRow[],
) {
  if (actualRows.length !== expectedRows.length) {
    throw new Error(
      `Main-app translation row cardinality failed: ${actualRows.length}/${expectedRows.length}.`,
    );
  }

  const expectedByLanguage = new Map<SupportedLanguage, MainAppRepairRow>(
    expectedRows.map((row) => [row.language, row]),
  );
  let matched = 0;
  for (const actual of actualRows) {
    const language = isSupportedLanguageValue(actual.language) ? actual.language : null;
    const expected = language ? expectedByLanguage.get(language) : undefined;
    if (!language || !expected) {
      throw new Error("Main-app translation verification found an unexpected or duplicate language.");
    }
    if (
      actual.namespace !== mainAppTranslationNamespace ||
      actual.source_hash !== expected.sourceHash ||
      actual.model !== mainAppRepairModel ||
      typeof actual.payload !== "string"
    ) {
      throw new Error(`Main-app translation metadata verification failed for ${language}.`);
    }
    const expectedPayload = JSON.stringify(expected.payload);
    if (actual.payload !== expectedPayload) {
      throw new Error(`Main-app translation byte equality verification failed for ${language}.`);
    }
    expectedByLanguage.delete(language);
    matched += 1;
  }

  if (expectedByLanguage.size !== 0 || matched !== expectedRows.length) {
    throw new Error(`Main-app translation row verification failed: ${matched}/${expectedRows.length}.`);
  }
  return matched;
}

export function verifyMainAppRepairResultChunks(
  expectedRows: readonly MainAppRepairRow[],
  readChunk: (
    chunk: MainAppRepairVerificationChunk,
  ) => readonly Record<string, unknown>[],
) {
  const chunks = buildMainAppRepairVerificationChunks(expectedRows);
  return verifyMainAppRepairPlannedResultChunks(expectedRows, chunks, readChunk);
}

function verifyMainAppRepairPlannedResultChunks(
  expectedRows: readonly MainAppRepairRow[],
  chunks: readonly MainAppRepairVerificationChunk[],
  readChunk: (
    chunk: MainAppRepairVerificationChunk,
  ) => readonly Record<string, unknown>[],
) {
  let rowsMatched = 0;
  let firstVerificationError: unknown;
  for (const chunk of chunks) {
    const actualRows = readChunk(chunk);
    try {
      rowsMatched += verifyMainAppRepairChunkResultRows(
        actualRows,
        chunk.expectedRows,
      );
    } catch (error) {
      firstVerificationError ??= error;
    }
  }
  if (firstVerificationError !== undefined) throw firstVerificationError;
  if (rowsMatched !== expectedRows.length) {
    throw new Error(
      `Main-app translation row verification failed: ${rowsMatched}/${expectedRows.length}.`,
    );
  }
  return { rowsMatched, queryCount: chunks.length };
}

function translationIdentifier(namespace: string, language: string) {
  return `${namespace}\u0000${language}`;
}

function compareCuratedPackIdentifiers(
  left: CuratedPackIdentifier,
  right: CuratedPackIdentifier,
) {
  return (
    left.namespace.localeCompare(right.namespace) || left.language.localeCompare(right.language)
  );
}

function compareCuratedRepairRows(
  left: CuratedNamespaceRepairRow,
  right: CuratedNamespaceRepairRow,
) {
  return (
    left.namespace.localeCompare(right.namespace) || left.language.localeCompare(right.language)
  );
}

function assertExactCuratedExpectedRows(
  rows: readonly CuratedNamespaceRepairRow[],
) {
  const expectedIdentifiers = new Set(
    getExactCuratedPackIdentifiers()
      .filter((identifier) => identifier.namespace !== mainAppTranslationNamespace)
      .map((identifier) => translationIdentifier(identifier.namespace, identifier.language)),
  );
  if (rows.length !== expectedIdentifiers.size) {
    throw new Error(
      `Curated expected row cardinality failed: ${rows.length}/${expectedIdentifiers.size}.`,
    );
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const identifier = translationIdentifier(row.namespace, row.language);
    if (!expectedIdentifiers.has(identifier)) {
      throw new Error(
        `Curated expected rows contain an unexpected ${row.namespace}/${row.language}.`,
      );
    }
    if (seen.has(identifier)) {
      throw new Error(
        `Curated expected rows contain a duplicate ${row.namespace}/${row.language}.`,
      );
    }
    seen.add(identifier);
  }
  return expectedIdentifiers;
}

function assertExactMainAppExpectedRows(rows: readonly MainAppRepairRow[]) {
  const expectedLanguages = new Set<SupportedLanguage>(
    supportedLanguages.filter((language) => language !== defaultLanguage),
  );
  if (rows.length !== expectedLanguages.size) {
    throw new Error(
      `Main-app expected row cardinality failed: ${rows.length}/${expectedLanguages.size}.`,
    );
  }
  const seen = new Set<SupportedLanguage>();
  for (const row of rows) {
    if (
      row.namespace !== mainAppTranslationNamespace ||
      !expectedLanguages.has(row.language)
    ) {
      throw new Error(
        `Main-app expected rows contain an unexpected ${row.namespace}/${row.language}.`,
      );
    }
    if (seen.has(row.language)) {
      throw new Error(`Main-app expected rows contain a duplicate ${row.language}.`);
    }
    seen.add(row.language);
  }
  return expectedLanguages;
}

function canonicalPayloadJson(payload: Readonly<Record<string, string>>) {
  const canonical: Record<string, string> = {};
  for (const key of Object.keys(payload).sort()) canonical[key] = payload[key];
  return JSON.stringify(canonical);
}

function curatedCorpusSha256(rows: readonly CuratedNamespaceRepairRow[]) {
  const digest = crypto.createHash("sha256");
  let firstRow = true;
  for (const row of [...rows].sort(compareCuratedRepairRows)) {
    updateCuratedCorpusDigest(
      digest,
      {
        namespace: row.namespace,
        language: row.language,
        sourceHash: row.sourceHash,
        payload: canonicalPayloadJson(row.payload),
      },
      firstRow,
    );
    firstRow = false;
  }
  return digest.digest("hex");
}

function curatedResultCorpusSha256(
  rows: readonly CuratedVerificationHashRow[],
) {
  const digest = crypto.createHash("sha256");
  let firstRow = true;
  for (const row of [...rows].sort(compareCuratedVerificationHashRows)) {
    updateCuratedCorpusDigest(digest, row, firstRow);
    firstRow = false;
  }
  return digest.digest("hex");
}

function compareCuratedVerificationHashRows(
  left: CuratedVerificationHashRow,
  right: CuratedVerificationHashRow,
) {
  return (
    left.namespace.localeCompare(right.namespace) ||
    left.language.localeCompare(right.language)
  );
}

function updateCuratedCorpusDigest(
  digest: ReturnType<typeof crypto.createHash>,
  row: CuratedVerificationHashRow,
  firstRow: boolean,
) {
  if (!firstRow) digest.update("\n");
  digest.update(
    JSON.stringify([row.namespace, row.language, row.sourceHash, row.payload]),
    "utf8",
  );
}

function assertNoExplicitTransactionControl(sql: string) {
  const transactionStatement = splitSqlStatements(sql).find((statement) =>
    /^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END(?:\s+TRANSACTION)?|ROLLBACK)\b/i.test(
      stripLeadingSqlComments(statement),
    ),
  );
  if (transactionStatement) {
    throw new Error(
      "Atomic D1 repair SQL must rely on Wrangler file rollback and not contain transaction control.",
    );
  }
}

function stripLeadingSqlComments(statement: string) {
  let remainder = statement.trimStart();
  while (remainder.startsWith("--") || remainder.startsWith("/*")) {
    if (remainder.startsWith("--")) {
      const newline = remainder.indexOf("\n");
      if (newline === -1) return "";
      remainder = remainder.slice(newline + 1).trimStart();
      continue;
    }
    const end = remainder.indexOf("*/", 2);
    if (end === -1) return remainder;
    remainder = remainder.slice(end + 2).trimStart();
  }
  return remainder;
}

function strictD1ResultRows(output: string, expectedResultSets: number) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed) || parsed.length !== expectedResultSets) {
    throw new Error(
      `Wrangler D1 verification returned ${Array.isArray(parsed) ? parsed.length : "a non-array"} ` +
        `result sets; expected ${expectedResultSets}.`,
    );
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const [resultSetIndex, entry] of parsed.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Wrangler D1 verification result set ${resultSetIndex + 1} is malformed.`);
    }
    if (entry.success !== true) {
      throw new Error(`Wrangler D1 verification result set ${resultSetIndex + 1} was unsuccessful.`);
    }
    if (!Array.isArray(entry.results)) {
      throw new Error(`Wrangler D1 verification result set ${resultSetIndex + 1} has no row array.`);
    }
    for (const [rowIndex, row] of entry.results.entries()) {
      if (!isRecord(row)) {
        throw new Error(
          `Wrangler D1 verification result set ${resultSetIndex + 1} row ${rowIndex + 1} is malformed.`,
        );
      }
      rows.push(row);
    }
  }
  return rows;
}

function requireSingleVerificationRow(
  rows: readonly Record<string, unknown>[],
  predicate: (row: Record<string, unknown>) => boolean,
  label: string,
) {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) {
    throw new RemoteVerificationIndeterminateError(
      `Remote ${label} verification returned ${matches.length} rows; expected exactly one.`,
    );
  }
  return matches[0]!;
}

function verificationCounter(value: unknown, label: string) {
  const parsed = numeric(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RemoteVerificationIndeterminateError(
      `Remote translation verification returned an invalid ${label}.`,
    );
  }
  return parsed;
}

function d1ResultRows(output: string) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler D1 verification did not return an array.");
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of parsed) {
    if (!isRecord(entry) || entry.success !== true || !Array.isArray(entry.results)) continue;
    for (const result of entry.results) {
      if (isRecord(result)) rows.push(result);
    }
  }
  return rows;
}

function parseJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw new Error("Could not parse Wrangler JSON output.");
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function writeReport(report: RepairReport, backupDir: string) {
  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), "seo-cta-translation-repair-" + report.mode + ".json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}

function sqlString(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256CanonicalJson(value: unknown) {
  return sha256(canonicalJsonForHash(value));
}

function canonicalJsonForHash(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot contain a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonForHash).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonForHash(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}.`);
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireCliArgument(value: string | undefined, name: string) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires its exact release-preflight run ID.`);
  }
  return value;
}

function readPrewriteAbortRefinementClock(clock: () => Date, label: string) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Prewrite-abort reservation refinement ${label} clock is invalid.`);
  }
  return new Date(value.getTime());
}

function assertCleanPushedPrewriteAbortRecoverySource() {
  if (runGit(["status", "--porcelain=v1", "--untracked-files=all"]).trim()) {
    throw new Error("Prewrite-abort reservation refinement requires a clean git working tree.");
  }
  const head = runGit(["rev-parse", "HEAD"]).trim();
  const upstream = runGit(["rev-parse", "@{upstream}"]).trim();
  if (!/^[a-f0-9]{40}$/.test(head) || head !== upstream) {
    throw new Error("Prewrite-abort reservation refinement requires HEAD to equal its pushed upstream.");
  }
}

function releasePreflightRunTimestamp(runId: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(runId);
  if (!match) throw new Error("Release-preflight run timestamp is malformed.");
  return exactIsoTimestamp(
    `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`,
    "release-preflight run timestamp",
  );
}

function exactIsoTimestamp(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is malformed.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function requireLowercaseWorkerVersion(value: unknown, label: string) {
  if (!isWorkerVersionId(value) || value !== value.toLowerCase()) {
    throw new Error(`${label} must be a lowercase Worker version UUID.`);
  }
  return value;
}

function hasExactObjectKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function requirePositiveSafeInteger(value: unknown, label: string) {
  if (!isPositiveSafeInteger(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function pathEntryExistsNoFollow(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown prewrite-abort refinement failure.");
}

function isWorkerVersionId(value: unknown): value is string {
  return typeof value === "string" && workerVersionPattern.test(value);
}

function requireWorkerVersion(value: unknown) {
  if (!isWorkerVersionId(value)) {
    throw new Error("A valid Worker version UUID is required.");
  }
  return value;
}

function numeric(value: unknown) {
  return typeof value === "number" ? value : Number(value);
}

function isSupportedLanguageValue(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && supportedLanguageNames.has(value);
}

function isPublishedSiteNamespace(
  value: unknown,
): value is keyof typeof siteSourceManifest {
  return typeof value === "string" && publishedSiteNamespaceNames.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
