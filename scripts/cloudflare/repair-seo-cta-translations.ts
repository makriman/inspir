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
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
} from "@/lib/i18n/site-source";
import { siteTranslationNamespace } from "@/lib/i18n/site-source-constants";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import { isTranslationBundleCompleteAndFluent } from "@/lib/i18n/translation-quality";
import {
  assertD1FreeDailyBudget,
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
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
import { buildReleaseArtifactSafetyChecks } from "./release-artifact-safety";
import {
  CLOUDFLARE_CLI_TIMEOUT_MS,
  cloudflareDir,
  commandEnv,
  D1_DATABASE_NAME,
  parseD1TimeTravelBookmark,
  resolveBackupDir,
  runWrangler,
  type RunCommandOptions,
  type WranglerRunner,
} from "./migration-config";
import {
  assertSourceSyncReadBudget,
  buildSiteTranslationSourceSyncPlan,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  planSiteTranslationSourceSync,
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
  WORKER_DEPLOY_REPORT,
  buildWorkerDeployArtifactEvidence,
  buildWorkerDeployArtifactManifest,
  type WorkerDeployArtifactEvidence,
  type WorkerDeployArtifactManifest,
} from "./worker-deploy-evidence";
import { runBoundedReleaseChildSync } from "./run-production-release-operation";

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
const model = "codex-curated-free-static-no-games-v4";
const curatedRepairModel = "codex-curated-free-static-no-games-v6";
const mainAppRepairModel = "codex-curated-free-static-no-games-main-app-v1";
export const nativeWranglerDeployEnv = Object.freeze({
  // Wrangler detects open-next.config.ts even when invoked directly. This
  // marker tells the adapter that Wrangler is already performing the native
  // upload and prevents delegation to the retired OpenNext/R2 deploy path.
  OPEN_NEXT_DEPLOY: "true",
});
const curatedRoot = path.resolve(process.cwd(), "translations/curated");
const fullCoverageCuratedNamespaces = new Set<string>([
  "marketing-shell",
  "route:home",
  "route:mission",
]);
const bootstrapCuratedLanguages = ["Arabic", "Hindi", "Malayalam", "Spanish"] as const satisfies
  readonly SupportedLanguage[];
const staticRepairNamespaces = [
  "marketing-site",
  "route:chat-public",
  "route:about",
  "route:media",
  "route:schools",
] as const;
const staticRepairNamespaceNames = new Set<string>(staticRepairNamespaces);
const supportedLanguageNames = new Set<string>(supportedLanguages);
const publishedSiteNamespaceNames = new Set<string>(Object.keys(siteSourceManifest));
const maximumD1SqlStatementBytes = 100_000;
const maximumD1FileImportBytes = 5_000_000_000;
const maximumD1TranslationPayloadBytes = 2_000_000;
const maximumWorkerDeployEvidenceBytes = 16 * 1024 * 1024;
const repairPatchStatementTargetBytes = 90_000;
const startLearningKey = "site.02d279ce2f7b58c890";
const tryPublicModesKey = "site.fc4ad9c971ade5617d";
const retiredGameTranslationKeys = [
  "site.ee30b035ee17c34450",
  "site.5121f7306ecc75edb5",
  "site.df499d7c6f44a88703",
] as const;
const previousMarketingSiteHash = "f14328ad17e645fbc8d904da8d2892fae56e9c7a41b54b8aa108c89eaf7611b0";
const expectedSourceHashes = {
  "marketing-site": "8fba4fae8adf717ba9de242b46c5b0f1861b2414209355280f36e25ae6992166",
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
  projectionBasis: "cold-manifest" | "remote-diff";
  projectedBilledRowWrites?: number;
  projectedBilledRowWriteLimit?: number;
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
  productionVerification?: {
    expectedSourceNamespaces: number;
    sourceNamespaces: number;
    freshSourceNamespaces: number;
    observedTranslationRows: number;
    observedFreshTranslationRows: number;
    auditedSiteNamespaces: number;
    auditedSiteRows: number;
    targetNamespaces: number;
    schoolValuesMatched: number;
    retiredGamePayloads: number;
    curatedRowsMatched: number;
    curatedPayloadBytesMatched: number;
    curatedCorpusSha256: string;
    mainAppRowsMatched: number;
  };
};

export type RemoteTranslationDriftIssue = {
  scope:
    | "source-snapshot"
    | "translation-summary"
    | "curated-payloads"
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
    mainAppRows: number;
    supportedTargetLanguages: number;
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
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const refinementRequested = process.argv.includes("--refine-aborted-prewrite-reservation");
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
        remote: process.argv.includes("--remote"),
        confirmed: process.argv.includes("--confirm-production"),
        verifyOnly: process.argv.includes("--verify-only"),
        nativeWriteFreezeConfirmed: process.argv.includes("--confirm-native-write-freeze"),
        candidateVersion: getArg("--candidate-version"),
        backupDir: resolveBackupDir(),
      });
  console.log(JSON.stringify(report, null, 2));
  if ("mode" in report && report.mode === "remote-verify-only" && report.repairRequired) {
    process.exitCode = 1;
  }
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
        expectedVersionId: evidence.candidateVersionId,
        readActiveWorkerVersion,
        probeCandidate,
      });
      candidateVersionAfter = candidateVersionBefore;
    } else {
      exclusion = acquireProductionValidationExclusion({
        candidateVersionId: evidence.candidateVersionId,
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
        expectedVersionId: evidence.candidateVersionId,
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
        expectedVersionId: evidence.candidateVersionId,
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
      "sourceFingerprint",
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
  if (value.activeVersionId !== candidateVersionId) {
    throw new Error("Release-preflight evidence was not captured against its exact active candidate.");
  }
  if (
    typeof value.gitHead !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.gitHead) ||
    value.gitUpstream !== value.gitHead ||
    typeof value.workerSourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.workerSourceSha256) ||
    typeof value.wranglerConfigSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.wranglerConfigSha256) ||
    value.workerDeployReportPath !== path.resolve(backupDir, WORKER_DEPLOY_REPORT)
  ) {
    throw new Error("Release-preflight source/deploy evidence is malformed.");
  }
  const sourceFingerprint = parseEvidenceSourceFingerprint(value.sourceFingerprint);
  validateAbortedPrewriteSafetyChecks(value.safetyChecks, sourceFingerprint.sha256);
  const candidateProbe = validateNativeMaintenanceProbe(value.candidateProbe, false);
  if (candidateProbe.versionId !== candidateVersionId) {
    throw new Error("Release-preflight candidate probe is not bound to its candidate version.");
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
  const curatedRepairRows = loadCuratedNamespaceRepairRows();
  const curatedRepairPlan = buildCuratedNamespaceRepairPlan(curatedRepairRows);
  const mainAppRepairRows = loadMainAppRepairRows();
  const mainAppRepairPlan = buildMainAppRepairPlan(mainAppRepairRows);
  validateSiteSourceManifestFreshness();
  const sourceHashes = validateSourceContract();
  const repairSql = fs.readFileSync(repairSqlPath, "utf8");
  validateRepairSql(repairSql, translations, sourceHashes);
  const completeRepairSql = buildAtomicSeoCtaRepairSql(
    curatedRepairPlan.legacyPrerequisiteSql,
    repairSql,
    curatedRepairPlan.postLegacyCanonicalSql,
    mainAppRepairPlan.sql,
  );
  const coldSourceSync = buildSiteTranslationSourceSyncPlan();
  const planSha256 = translationRepairBudgetPlanSha256({
    candidateVersionId,
    sourceFingerprint,
    repairSqlSha256: sha256(completeRepairSql),
    sourceSyncSha256: coldSourceSync.sha256,
    curatedCorpusSha256: curatedRepairPlan.corpusSha256,
  });
  const legacyOperationId = translationRepairBudgetOperationId({
    candidateVersionId,
    sourceFingerprint,
    planSha256,
  });
  return {
    translations,
    curatedRepairRows,
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

export function abortedPrewriteRecoveryOperationId(
  sourceFingerprint: D1ReleaseSourceIdentity,
  candidateVersionId: string,
) {
  return buildAbortedPrewriteRecoveryPlan(
    releaseBudgetSourceIdentity(sourceFingerprint),
    requireLowercaseWorkerVersion(candidateVersionId, "recovery candidate version"),
  ).operationId;
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
    readOnly.remoteQueries !== 4 ||
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
  if (options.remote && !options.verifyOnly && !isWorkerVersionId(options.candidateVersion)) {
    throw new Error(
      "Remote SEO translation repair requires --candidate-version with the exact validated Worker version UUID.",
    );
  }
  const candidateVersion =
    options.remote && !options.verifyOnly
      ? requireWorkerVersion(options.candidateVersion)
      : undefined;

  const translations = loadAndValidateTranslationSeed();
  const curatedRepairRows = loadCuratedNamespaceRepairRows();
  const curatedRepairPlan = buildCuratedNamespaceRepairPlan(curatedRepairRows);
  const mainAppRepairRows = loadMainAppRepairRows();
  const mainAppRepairPlan = buildMainAppRepairPlan(mainAppRepairRows);
  const manifestNamespacesVerified = validateSiteSourceManifestFreshness();
  const sourceHashes = validateSourceContract();
  if (options.verifyOnly) {
    return verifyRemoteTranslationDrift({
      translations,
      curatedRepairRows,
      mainAppRepairRows,
      runner: options.runner ?? runWrangler,
      now: options.now ?? Date.now(),
    });
  }
  const repairSql = fs.readFileSync(repairSqlPath, "utf8");
  validateRepairSql(repairSql, translations, sourceHashes);
  // Canonical home rows must exist before the legacy copy statements read
  // their CTA. The remaining exact packs run afterward so legacy v4 cannot
  // clobber canonical payloads or provenance in overlapping namespaces.
  const completeRepairSql = buildAtomicSeoCtaRepairSql(
    curatedRepairPlan.legacyPrerequisiteSql,
    repairSql,
    curatedRepairPlan.postLegacyCanonicalSql,
    mainAppRepairPlan.sql,
  );
  const coldSourceSync = buildSiteTranslationSourceSyncPlan();
  assertSourceSyncReadBudget(coldSourceSync);
  const maximumStaticRepairRows = staticRepairNamespaces.length * translations.size;
  const coldProjectedBilledRowWrites = projectRepairBilledRowWrites(
    coldSourceSync.projectedBilledRowWrites,
    maximumStaticRepairRows,
    curatedRepairPlan.logicalRowWrites,
    mainAppRepairPlan.logicalRowWrites,
  );
  assertRepairWriteBudget(coldProjectedBilledRowWrites);
  const coldProjectedBilledRowReads = projectRepairBilledRowReads(
    coldSourceSync.projectedBilledRowReads,
    maximumStaticRepairRows,
    curatedRepairRows.length,
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
    projectionBasis: "cold-manifest" as const,
    projectedBilledRowWrites: coldProjectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
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
  let timeTravelBookmark = "";
  let preWriteEvidencePath = "";
  let staticRepairRows = 0;
  let sourceSync: ReturnType<typeof planSiteTranslationSourceSync> | null = null;
  let projectedBilledRowWrites = 0;
  let projectedBilledRowReads = 0;
  let remoteAtomicSql = "";
  let maintenanceExclusion: ProductionValidationExclusion | null = null;
  let maintenanceState: ProductionMaintenanceState | null = null;

  try {
    assertNoLiveProductionValidationLock();
    maintenanceExclusion = acquireProductionValidationExclusion({
      candidateVersionId: releasePreflight.candidateVersionId,
      sourceFingerprintSha256: releasePreflight.sourceFingerprint.sha256,
    });
    assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
    maintenanceVersionId = uploadNativeMaintenanceVersion(releasePreflight);
    maintenanceState = {
      candidateVersionId: releasePreflight.candidateVersionId,
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
      mainAppRepairRows,
    );
    sourceSync = planSiteTranslationSourceSync("remote");
    assertSourceSyncReadBudget(sourceSync);
    projectedBilledRowWrites = projectRepairBilledRowWrites(
      sourceSync.projectedBilledRowWrites,
      staticRepairRows,
      curatedRepairPlan.logicalRowWrites,
      mainAppRepairPlan.logicalRowWrites,
    );
    assertRepairWriteBudget(projectedBilledRowWrites);
    projectedBilledRowReads = projectRepairBilledRowReads(
      sourceSync.projectedBilledRowReads,
      staticRepairRows,
      curatedRepairRows.length,
      mainAppRepairRows.length,
    );
    assertRepairReadBudget(projectedBilledRowReads);
    assertD1FreeDailyBudget(accountDailyUsage, {
      operation: "Remote SEO translation repair",
      rowsRead: projectedBilledRowReads,
      rowsWritten: projectedBilledRowWrites,
    });
    budgetReservation = reserveD1ReleaseBudget({
      backupDir: options.backupDir,
      operationId: budgetOperationId,
      operation: "Remote SEO translation repair",
      candidateVersionId: releasePreflight.candidateVersionId,
      sourceFingerprint: budgetSourceFingerprint,
      phase: "exact",
      rowsRead: projectedBilledRowReads,
      rowsWritten: projectedBilledRowWrites,
      observedUsage: accountDailyUsage,
      now: readTranslationRepairClock(
        budgetClock,
        "translation-repair exact reservation",
      ),
      expectedUtcDay: budgetReservation.utcDay,
    });

    remoteAtomicSql = buildAtomicSeoCtaRepairSql(sourceSync.sql, completeRepairSql);
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
      d1ReleaseBudget: budgetReservation,
    });

    const atomicSqlPath = writeTemporarySqlFile(
      remoteAtomicSql,
      "atomic-seo-cta-translation-repair.sql",
    );
    try {
      // D1's import path is the one unavoidable database maintenance window.
      // The native Worker is already write-frozen and the diagnostic bookmark is
      // durably recorded before this single transactional import begins.
      const liveArtifacts = assertRepairArtifactEvidenceUnchanged(releasePreflight);
      const liveSourceFingerprint = releaseBudgetSourceIdentity(
        liveArtifacts.sourceFingerprint,
      );
      const livePlanSha256 = translationRepairBudgetPlanSha256({
        candidateVersionId: releasePreflight.candidateVersionId,
        sourceFingerprint: liveSourceFingerprint,
        repairSqlSha256: sha256(completeRepairSql),
        sourceSyncSha256: coldSourceSync.sha256,
        curatedCorpusSha256: curatedRepairPlan.corpusSha256,
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
        phase: "exact",
        rowsRead: projectedBilledRowReads,
        rowsWritten: projectedBilledRowWrites,
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
      importAttempted = true;
      let importTransportError: unknown;
      try {
        runBoundedMutationWrangler(
          [
            "d1",
            "execute",
            D1_DATABASE_NAME,
            "--remote",
            "--file",
            atomicSqlPath,
            "--yes",
          ],
          { maxBuffer: 128 * 1024 * 1024 },
        );
        importResponseConfirmed = true;
      } catch (error) {
        // The ingestion may have committed even if Wrangler lost its final
        // poll response. Exact verification below is authoritative.
        importTransportError = error;
      }
      maintenanceExclusion = attestProductionValidationExclusion(maintenanceExclusion);
      assertProductionValidationExclusionCommandWindow(maintenanceExclusion);
      try {
        productionVerification = verifyRemoteRepair(
          translations,
          curatedRepairRows,
          mainAppRepairRows,
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
    } finally {
      fs.rmSync(path.dirname(atomicSqlPath), { recursive: true, force: true });
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
            releasePreflight.candidateVersionId,
            "Restore exact validated Worker after D1 translation maintenance",
          );
          releasedProbe = probeNativeWriteFreeze(
            false,
            releasePreflight.candidateVersionId,
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
    productionVerification,
  };
  writeReport(report, options.backupDir);
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

function uploadNativeMaintenanceVersion(preflight: RemoteRepairReleasePreflight) {
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
  if (activeVersionId !== preflight.candidateVersionId) {
    throw new Error(
      `Remote translation repair candidate changed before maintenance activation: expected ${preflight.candidateVersionId}, received ${activeVersionId}.`,
    );
  }
}

function deployPinnedWorkerVersion(versionId: string, message: string) {
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

function runBoundedMutationWrangler(
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

export function assertRemoteRepairReleasePreflight(input: {
  backupDir: string;
  candidateVersionId: string;
}): RemoteRepairReleasePreflight {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const dirty = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.trim()) {
    throw new Error("Remote translation repair requires a clean git working tree.");
  }
  const gitHead = runGit(["rev-parse", "HEAD"]).trim();
  const gitUpstream = runGit(["rev-parse", "@{upstream}"]).trim();
  if (!/^[a-f0-9]{40}$/i.test(gitHead) || gitHead !== gitUpstream) {
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
  if (activeVersionId !== candidateVersionId) {
    throw new Error(
      `Remote translation repair expected candidate ${candidateVersionId} at 100% traffic; received ${activeVersionId}.`,
    );
  }
  const candidateProbe = probeNativeWriteFreeze(false, candidateVersionId);
  const currentArtifactEvidence = buildWorkerDeployArtifactEvidence(process.cwd());
  const sourceFingerprint = currentArtifactEvidence.sourceFingerprint;
  const workerDeployReportPath = path.resolve(input.backupDir, WORKER_DEPLOY_REPORT);
  const workerDeployEvidence = validateWorkerDeployEvidenceForRepair({
    report: readPrivateWorkerDeployEvidence(workerDeployReportPath),
    backupDir: input.backupDir,
    candidateVersionId,
    currentArtifactEvidence,
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

function requireSoleActiveWorkerVersion() {
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

function probeNativeWriteFreeze(expectedActive: boolean, expectedVersionId?: string) {
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
  d1ReleaseBudget?: D1ReleaseBudgetReservationResult;
}) {
  if (!/^\S{8,}$/.test(input.bookmark)) {
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
    (input.d1ReleaseBudget.reservation.phase !== "exact" ||
      input.d1ReleaseBudget.reservation.rowsRead !== input.projectedBilledRowReads ||
      input.d1ReleaseBudget.reservation.rowsWritten !== input.projectedBilledRowWrites)
  ) {
    throw new Error("Pre-write diagnostic evidence requires its exact D1 budget reservation.");
  }
  assertNoUnresolvedTranslationRepair(input.backupDir);
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
    d1ReleaseBudget: input.d1ReleaseBudget
      ? {
          ledgerPath: input.d1ReleaseBudget.ledgerPath,
          utcDay: input.d1ReleaseBudget.utcDay,
          operationId: input.d1ReleaseBudget.reservation.operationId,
          revision: input.d1ReleaseBudget.revision,
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

function resolveUnresolvedTranslationRepair(input: {
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

type CuratedPackEntry = {
  key: string;
  source: string;
  value: string;
};

type CuratedPack = {
  schemaVersion: number;
  language: string;
  locale: string;
  namespace: string;
  sourceHash: string;
  entries: CuratedPackEntry[];
};

type CuratedPackIdentifier = {
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
    const languages = fullCoverageCuratedNamespaces.has(namespace)
      ? targetLanguages
      : bootstrapCuratedLanguages;
    for (const language of languages) {
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
  const expectedFiles = new Set(expectedIdentifiers.map((identifier) => identifier.file));
  const actualFiles = collectCuratedJsonFiles(curatedRoot).sort();
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

function buildExactCuratedPackPayload(
  pack: CuratedPack,
  sourceStrings: Readonly<Record<string, string>>,
  identifier: CuratedPackIdentifier,
) {
  const values = new Map<string, string>();
  for (const entry of pack.entries) {
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
      !isValidFieldTranslation(entry.source, entry.value, identifier.language)
    ) {
      throw new Error(
        `Curated pack value is invalid for ${identifier.namespace}/${identifier.language}/${entry.key}.`,
      );
    }
    values.set(entry.key, entry.value);
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
  return payload;
}

function parseCuratedPack(file: string): CuratedPack {
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
    typeof parsed.sourceHash !== "string" ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(`Curated pack schema is invalid: ${path.relative(curatedRoot, file)}.`);
  }
  const entries = parsed.entries.map((entry, index): CuratedPackEntry => {
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
  });
  return {
    schemaVersion: parsed.schemaVersion,
    language: parsed.language,
    locale: parsed.locale,
    namespace: parsed.namespace,
    sourceHash: parsed.sourceHash,
    entries,
  };
}

function curatedPackPath(language: SupportedLanguage, namespace: string) {
  const config = languageConfigs[language];
  return path.join(
    curatedRoot,
    config.prefix || config.locale,
    namespace.replace(/[^a-z0-9.-]+/gi, "__") + ".json",
  );
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
      if (!isValidFieldTranslation(sourceText, value, language) || value !== value.normalize("NFC")) {
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
        !isValidFieldTranslation(sourceStrings[key], value, row.language) ||
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
        !isValidFieldTranslation(sourceText, value, row.language) ||
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
  const values = expectedPacks
    .map(
      (identifier) =>
        `(${sqlString(identifier.namespace)}, ${sqlString(identifier.language)})`,
    )
    .join(",\n    ");
  return [
    "WITH expected_curated(namespace, language) AS (",
    `  VALUES ${values}`,
    ")",
    "SELECT CASE",
    `  WHEN (SELECT COUNT(*) FROM expected_curated) = ${expectedPacks.length}`,
    "    AND (",
    "      SELECT COUNT(*) FROM expected_curated AS expected",
    "      JOIN app_translations AS target",
    "        ON target.namespace = expected.namespace AND target.language = expected.language",
    `    ) <= ${expectedPacks.length}`,
    "  THEN json('{}')",
    "  ELSE json('curated-cardinality-guard-failed')",
    "END AS curated_cardinality_guard;",
  ].join("\n");
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
  mainAppRepairRowWrites: number,
) {
  const counts = [
    sourceSyncProjectedWrites,
    staticRepairRows,
    curatedRepairLogicalRowWrites,
    mainAppRepairRowWrites,
  ];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Projected D1 repair write inputs must be non-negative safe integers.");
  }
  return (
    sourceSyncProjectedWrites +
    (staticRepairRows + curatedRepairLogicalRowWrites + mainAppRepairRowWrites) *
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
}) {
  const candidateVersionId = requireWorkerVersion(input.candidateVersionId);
  const sourceFingerprint = releaseBudgetSourceIdentity(input.sourceFingerprint);
  for (const [label, value] of [
    ["repair SQL", input.repairSqlSha256],
    ["source-sync plan", input.sourceSyncSha256],
    ["curated corpus", input.curatedCorpusSha256],
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
  mainAppRepairRows: number,
) {
  const counts = [
    sourceSyncProjectedReads,
    staticRepairRows,
    curatedRepairRows,
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
    (staticRepairRows + curatedRepairRows + mainAppRepairRows) * 4 +
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
  mainAppRows: readonly MainAppRepairRow[],
) {
  const curatedValues = curatedRows
    .map((row) => `(${sqlString(row.namespace)}, ${sqlString(row.language)})`)
    .join(",\n    ");
  const sql = [
    "SELECT 'static' AS target_kind, namespace, language",
    "FROM app_translations",
    `WHERE namespace IN (${staticRepairNamespaces.map(sqlString).join(", ")})`,
    "ORDER BY namespace, language;",
    "WITH expected_curated(namespace, language) AS (",
    `  VALUES ${curatedValues}`,
    ")",
    "SELECT 'curated' AS target_kind, target.namespace, target.language",
    "FROM expected_curated AS expected",
    "JOIN app_translations AS target",
    "  ON target.namespace = expected.namespace AND target.language = expected.language",
    "ORDER BY target.namespace, target.language;",
    "SELECT 'main-app' AS target_kind, namespace, language",
    "FROM app_translations",
    `WHERE namespace = ${sqlString(mainAppTranslationNamespace)}`,
    "ORDER BY language;",
  ].join("\n");
  assertD1SqlStatementSize(sql);
  const output = runWrangler([
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
  const extractedNamespaces = [
    siteTranslationNamespace,
    ...getAllSiteTranslationNamespaces({ mode: "extract" }),
  ].sort();
  const manifestNamespaces = Object.keys(siteSourceManifest).sort();
  if (
    extractedNamespaces.length !== manifestNamespaces.length ||
    extractedNamespaces.some((namespace, index) => namespace !== manifestNamespaces[index])
  ) {
    throw new Error("Generated site translation manifest namespace set is stale.");
  }

  for (const namespace of extractedNamespaces) {
    const manifestSource = getSiteTranslationSource(namespace);
    const extractedSource = getSiteTranslationSource(namespace, { mode: "extract" });
    if (manifestSource.sourceHash !== extractedSource.sourceHash) {
      throw new Error(
        "Generated site translation manifest is stale for " +
          namespace +
          ": " +
          manifestSource.sourceHash +
          " != " +
          extractedSource.sourceHash +
          ".",
      );
    }
  }
  return extractedNamespaces.length;
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

function validateRepairSql(
  sql: string,
  translations: ReadonlyMap<SupportedLanguage, string>,
  sourceHashes: Record<RepairNamespace, string>,
) {
  for (const hash of Object.values(sourceHashes)) {
    if (!sql.includes(hash)) {
      throw new Error("SEO CTA repair SQL is missing source hash " + hash + ".");
    }
  }
  if (!sql.includes(startLearningKey) || !sql.includes(tryPublicModesKey) || !sql.includes(model)) {
    throw new Error("SEO CTA repair SQL is missing its required keys or provenance.");
  }
  if (!sql.includes(previousMarketingSiteHash)) {
    throw new Error("SEO CTA repair SQL is missing the previous marketing-site source hash.");
  }
  for (const key of retiredGameTranslationKeys) {
    if (!sql.includes(key)) {
      throw new Error("SEO CTA repair SQL is missing retired game translation key " + key + ".");
    }
  }
  for (const [language, value] of translations) {
    const row = "(" + sqlString(language) + ", " + sqlString(value) + ")";
    if (!sql.includes(row)) {
      throw new Error("SEO CTA repair SQL does not match the seed for " + language + ".");
    }
  }
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
  const repairValues = Array.from(translations, ([language, value]) => {
    return "(" + sqlString(language) + ", " + sqlString(value) + ")";
  }).join(",");
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
    "  SUM(t.source_hash = s.source_hash) AS observed_fresh_translation_rows,",
    "  SUM(CASE WHEN s.namespace IS NULL THEN 1 ELSE 0 END) AS unexpected_translation_namespaces,",
    "  SUM(CASE WHEN allowed_languages.language IS NULL THEN 1 ELSE 0 END) AS unsupported_languages",
    "FROM app_translations AS t LEFT JOIN app_translation_sources AS s USING (namespace)",
    "LEFT JOIN allowed_languages ON allowed_languages.language = t.language",
    `WHERE t.namespace <> ${sqlString(mainAppTranslationNamespace)};`,
    "SELECT t.namespace, COUNT(*) AS rows, COUNT(DISTINCT t.language) AS languages,",
    "  SUM(t.source_hash = s.source_hash) AS fresh_rows,",
    "  SUM(CASE WHEN NOT EXISTS (",
    "    SELECT 1 FROM app_translation_source_strings AS ss",
    "    WHERE ss.namespace = t.namespace AND (",
    "      COALESCE(json_type(t.payload, '$.\"' || ss.source_key || '\"'), '') <> 'text'",
    "      OR COALESCE(TRIM(CAST(json_extract(t.payload, '$.\"' || ss.source_key || '\"') AS TEXT)), '') = ''",
    "    )",
    "  ) THEN 1 ELSE 0 END) AS complete_rows",
    "FROM app_translations AS t JOIN app_translation_sources AS s USING (namespace)",
    "WHERE t.namespace IN ('route:about', 'route:media', 'route:schools')",
    "GROUP BY t.namespace ORDER BY t.namespace;",
    "SELECT target.namespace, SUM(CASE WHEN",
    "  json_extract(target.payload, '$.\"" + startLearningKey + "\"') IS",
    "  json_extract(home.payload, '$.\"" + startLearningKey + "\"')",
    "  THEN 0 ELSE 1 END) AS mismatches",
    "FROM app_translations AS target",
    "JOIN app_translations AS home ON home.namespace = 'route:home' AND home.language = target.language",
    "WHERE target.namespace IN ('route:about', 'route:media')",
    "GROUP BY target.namespace ORDER BY target.namespace;",
    "SELECT namespace, model, COUNT(*) AS rows FROM app_translations",
    "WHERE namespace IN ('route:about', 'route:media', 'route:schools')",
    `  AND language NOT IN (${bootstrapCuratedLanguages.map(sqlString).join(", ")})`,
    "GROUP BY namespace, model ORDER BY namespace, model;",
    "WITH repair_values(language, value) AS (VALUES " + repairValues + ")",
    "SELECT COUNT(*) AS school_values_matched",
    "FROM app_translations AS target",
    "JOIN repair_values ON repair_values.language = target.language",
    "WHERE target.namespace = 'route:schools'",
    `  AND target.language NOT IN (${bootstrapCuratedLanguages.map(sqlString).join(", ")})`,
    "  AND json_extract(target.payload, '$.\"" + tryPublicModesKey + "\"') = repair_values.value;",
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
  const value = parseJsonFromOutput(output);
  if (!Array.isArray(value) || value.length === 0) {
    throw new RemoteVerificationIndeterminateError(
      "Read-only D1 verification omitted its billed-row metadata.",
    );
  }
  let total = 0;
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
      meta.rows_written !== 0
    ) {
      throw new RemoteVerificationIndeterminateError(
        "Read-only D1 verification returned malformed or mutating billing metadata.",
      );
    }
    total = safeAddBilledRowsRead(total, meta.rows_read);
  }
  return total;
}

function safeAddBilledRowsRead(left: number, right: number) {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RemoteVerificationIndeterminateError(
      "Read-only D1 billed-row accounting overflowed.",
    );
  }
  return total;
}

export function verifyRemoteTranslationDrift(input: {
  translations: ReadonlyMap<SupportedLanguage, string>;
  curatedRepairRows: readonly CuratedNamespaceRepairRow[];
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
    input.mainAppRepairRows,
    runner,
  );
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
      mainAppRows: input.mainAppRepairRows.length,
      supportedTargetLanguages: input.translations.size,
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
  const targets = rows.filter((row) => typeof row.namespace === "string" && "complete_rows" in row);
  const mismatches = rows.filter((row) => typeof row.namespace === "string" && "mismatches" in row);
  const models = rows.filter((row) => typeof row.namespace === "string" && "model" in row);
  const schools = requireSingleVerificationRow(
    rows,
    (row) => "school_values_matched" in row,
    "school CTA coverage",
  );
  const retired = requireSingleVerificationRow(
    rows,
    (row) => "retired_game_payloads" in row,
    "retired game coverage",
  );
  const classifiedRows = 4 + targets.length + mismatches.length + models.length;
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
  const unexpectedTranslationNamespaces = verificationCounter(
    observed.unexpected_translation_namespaces,
    "unexpected translation namespace count",
  );
  const unsupportedLanguages = verificationCounter(
    observed.unsupported_languages,
    "unsupported translation language count",
  );
  const schoolValuesMatched = verificationCounter(
    schools.school_values_matched,
    "school CTA match count",
  );
  const retiredGamePayloads = verificationCounter(
    retired.retired_game_payloads,
    "retired game payload count",
  );
  for (const row of targets) {
    verificationCounter(row.rows, "target row count");
    verificationCounter(row.languages, "target language count");
    verificationCounter(row.fresh_rows, "target fresh row count");
    verificationCounter(row.complete_rows, "target complete row count");
  }
  for (const row of mismatches) verificationCounter(row.mismatches, "CTA mismatch count");
  for (const row of models) {
    if (typeof row.model !== "string") {
      throw new RemoteVerificationIndeterminateError(
        "Remote translation model verification returned a malformed model.",
      );
    }
    verificationCounter(row.rows, "model row count");
  }

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
    observedTranslationRows < curatedRepairRows.length ||
    observedFreshTranslationRows < curatedRepairRows.length ||
    unexpectedTranslationNamespaces !== 0 ||
    unsupportedLanguages !== 0
  ) {
    addIssue(
      "translation-summary",
      "source-or-translation-coverage-drift",
      "Translation source or audited payload coverage verification failed.",
    );
  }
  if (
    targets.length !== 3 ||
    targets.some((row) =>
      [row.rows, row.languages, row.fresh_rows, row.complete_rows].some(
        (value) => numeric(value) !== translations.size,
      ),
    )
  ) {
    addIssue(
      "translation-summary",
      "target-completeness-drift",
      "Target translation completeness verification failed.",
    );
  }
  if (mismatches.length !== 2 || mismatches.some((row) => numeric(row.mismatches) !== 0)) {
    addIssue(
      "translation-summary",
      "start-learning-drift",
      "Start learning translation verification failed.",
    );
  }
  if (
    models.length !== 3 ||
    models.some(
      (row) =>
        row.model !== model ||
        numeric(row.rows) !== translations.size - bootstrapCuratedLanguages.length,
    )
  ) {
    addIssue(
      "translation-summary",
      "static-provenance-drift",
      "Translation repair provenance verification failed.",
    );
  }
  if (schoolValuesMatched !== translations.size - bootstrapCuratedLanguages.length) {
    addIssue(
      "translation-summary",
      "school-cta-drift",
      "Try public modes translation verification failed.",
    );
  }
  if (retiredGamePayloads !== 0) {
    addIssue(
      "translation-summary",
      "retired-game-payload-drift",
      "Retired game translation payload verification failed.",
    );
  }

  const curatedResultRows = runRemoteVerificationQuery(
    buildCuratedRepairVerificationSql(curatedRepairRows),
    64 * 1024 * 1024,
    runner,
  );
  let curatedVerification: ReturnType<typeof verifyCuratedRepairResultRows> | undefined;
  try {
    curatedVerification = verifyCuratedRepairResultRows(
      curatedResultRows,
      curatedRepairRows,
    );
  } catch {
    addIssue(
      "curated-payloads",
      "exact-curated-payload-drift",
      "Exact curated translation verification failed.",
    );
  }

  const mainAppResultRows = runRemoteVerificationQuery(
    "SELECT namespace, language, payload, source_hash, model FROM app_translations " +
      `WHERE namespace = ${sqlString(mainAppTranslationNamespace)} ORDER BY language;`,
    128 * 1024 * 1024,
    runner,
  );
  let mainAppRowsMatched: number | undefined;
  try {
    mainAppRowsMatched = verifyMainAppRepairResultRows(
      mainAppResultRows,
      mainAppRepairRows,
    );
  } catch {
    addIssue(
      "main-app-payloads",
      "exact-main-app-payload-drift",
      "Exact main-app translation verification failed.",
    );
  }

  if (issues.length || !curatedVerification || mainAppRowsMatched === undefined) {
    return { issues };
  }
  const verification: NonNullable<RepairReport["productionVerification"]> = {
    expectedSourceNamespaces,
    sourceNamespaces,
    freshSourceNamespaces,
    observedTranslationRows,
    observedFreshTranslationRows,
    auditedSiteNamespaces,
    auditedSiteRows: curatedVerification.rowsMatched,
    targetNamespaces: targets.length,
    schoolValuesMatched,
    retiredGamePayloads,
    curatedRowsMatched: curatedVerification.rowsMatched,
    curatedPayloadBytesMatched: curatedVerification.payloadBytesMatched,
    curatedCorpusSha256: curatedVerification.corpusSha256,
    mainAppRowsMatched,
  };
  return { issues, verification };
}

function verifyRemoteRepair(
  translations: ReadonlyMap<SupportedLanguage, string>,
  curatedRepairRows: readonly CuratedNamespaceRepairRow[],
  mainAppRepairRows: readonly MainAppRepairRow[],
  runner: WranglerRunner = runWrangler,
) {
  const inspection = inspectRemoteRepairPayloads(
    translations,
    curatedRepairRows,
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
  const values = [...expectedRows]
    .sort(compareCuratedRepairRows)
    .map((row) => `(${sqlString(row.namespace)}, ${sqlString(row.language)})`)
    .join(",\n    ");
  const sql = [
    "WITH expected_curated(namespace, language) AS (",
    `  VALUES ${values}`,
    ")",
    "SELECT target.namespace, target.language, target.payload, target.source_hash, target.model",
    "FROM expected_curated AS expected",
    "JOIN app_translations AS target",
    "  ON target.namespace = expected.namespace AND target.language = expected.language",
    "ORDER BY target.namespace, target.language;",
  ].join("\n");
  assertD1SqlStatementSize(sql);
  return sql;
}

export function verifyCuratedRepairResultRows(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: readonly CuratedNamespaceRepairRow[],
) {
  const expectedIdentifiers = assertExactCuratedExpectedRows(expectedRows);
  if (actualRows.length !== expectedRows.length) {
    throw new Error(
      `Curated translation row cardinality failed: ${actualRows.length}/${expectedRows.length}.`,
    );
  }

  const expectedByIdentifier = new Map<string, CuratedNamespaceRepairRow>();
  for (const expected of expectedRows) {
    const identifier = translationIdentifier(expected.namespace, expected.language);
    if (!expectedIdentifiers.has(identifier)) {
      throw new Error(
        `Curated expected rows contain an unexpected ${expected.namespace}/${expected.language}.`,
      );
    }
    if (expectedByIdentifier.has(identifier)) {
      throw new Error(
        `Curated expected rows contain a duplicate ${expected.namespace}/${expected.language}.`,
      );
    }
    expectedByIdentifier.set(identifier, expected);
  }

  let matched = 0;
  let payloadBytesMatched = 0;
  const actualHashRows: Array<{
    namespace: keyof typeof siteSourceManifest;
    language: SupportedLanguage;
    sourceHash: string;
    payload: string;
  }> = [];
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
    actualHashRows.push({
      namespace,
      language,
      sourceHash: expected.sourceHash,
      payload: actual.payload,
    });
    expectedByIdentifier.delete(identifier);
    matched += 1;
  }

  if (expectedByIdentifier.size !== 0 || matched !== expectedRows.length) {
    throw new Error(`Curated translation row verification failed: ${matched}/${expectedRows.length}.`);
  }
  const corpusSha256 = curatedResultCorpusSha256(actualHashRows);
  const expectedCorpusSha256 = curatedCorpusSha256(expectedRows);
  if (corpusSha256 !== expectedCorpusSha256) {
    throw new Error("Curated translation corpus SHA-256 verification failed.");
  }
  return { rowsMatched: matched, payloadBytesMatched, corpusSha256 };
}

export function verifyMainAppRepairResultRows(
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

function canonicalPayloadJson(payload: Readonly<Record<string, string>>) {
  const canonical: Record<string, string> = {};
  for (const key of Object.keys(payload).sort()) canonical[key] = payload[key];
  return JSON.stringify(canonical);
}

function curatedCorpusSha256(rows: readonly CuratedNamespaceRepairRow[]) {
  const records = [...rows].sort(compareCuratedRepairRows).map((row) =>
    JSON.stringify([
      row.namespace,
      row.language,
      row.sourceHash,
      canonicalPayloadJson(row.payload),
    ]),
  );
  return sha256(records.join("\n"));
}

function curatedResultCorpusSha256(
  rows: readonly {
    namespace: keyof typeof siteSourceManifest;
    language: SupportedLanguage;
    sourceHash: string;
    payload: string;
  }[],
) {
  const records = [...rows]
    .sort(
      (left, right) =>
        left.namespace.localeCompare(right.namespace) ||
        left.language.localeCompare(right.language),
    )
    .map((row) =>
      JSON.stringify([row.namespace, row.language, row.sourceHash, row.payload]),
    );
  return sha256(records.join("\n"));
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
