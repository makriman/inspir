import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SupportedLanguage } from "../../lib/content/languages";
import {
  loadStagedTranslationFallbackD1SiteCorpus,
  type StagedTranslationFallbackD1MainAppRow,
  type StagedTranslationFallbackD1SiteCorpus,
  type StagedTranslationFallbackD1SiteRow,
} from "../staged-translation-fallback-release-attestation";
import {
  assertD1SqlStatementSize,
  assertD1TranslationPayloadSize,
  assertReadOnlyRemoteTranslationVerificationArgs,
  assertExactProductionD1StorageIdentity,
  assertNoUnresolvedTranslationRepair,
  assertRepairArtifactEvidenceUnchanged,
  assertRemoteTranslationSequenceGate,
  buildSiteSourceStorageEntries,
  buildAtomicSeoCtaRepairSql,
  deployPinnedWorkerVersion,
  largestSqlStatementBytes,
  parseD1Billing,
  probeNativeWriteFreeze,
  productionMaintenanceRepairRunId,
  requireSoleActiveWorkerVersion,
  resolveUnresolvedTranslationRepair,
  runBoundedMutationWrangler,
  splitSqlStatements,
  uploadNativeMaintenanceVersion,
  validateNativeMaintenanceProbe,
  writePreWriteDiagnosticEvidence,
  type RemoteRepairReleasePreflight,
  type RemoteTranslationSequenceGateResult,
} from "./repair-seo-cta-translations";
import {
  assertProductionTopicReconciliationReleaseBinding,
  assertProductionTranslationReconciliationReleaseBinding,
  assertReleaseSequenceCurrentReleaseBinding,
  stagedTranslationReconciliationBindingFromAttestation,
  writeTranslationReconciliationPending,
  writeTranslationReconciliationSuccess,
  type StagedTranslationReconciliationBinding,
  type ReleaseSequenceCurrentRelease,
} from "./release-sequence-attestations";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  isValidD1TimeTravelBookmark,
  parseD1TimeTravelBookmark,
  resolveBackupDir,
  runWrangler,
  stableStringify,
  type WranglerRunner,
} from "./migration-config";
import {
  D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  d1ReleaseBudgetLedgerPath,
  readPrivateJsonNoFollow,
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  type D1ReleaseBudgetReservationResult,
} from "./d1-release-budget-ledger";
import {
  assertD1FreeDailyBudget,
  loadAccountD1DailyUsage,
  utcUsageWindowMinutes,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1FreeStorageAdmission,
  projectD1FreeStorageAdmission,
  readD1DatabaseStorageInfo,
  type D1DatabaseStorageInfo,
  type D1SourceStorageEntry,
  type D1TranslationStorageRow,
} from "./d1-free-storage-admission";
import {
  assertGitReleaseIdentity,
} from "./git-release-identity";
import {
  assertFreshHistoricalFresh0016FinalPreservation,
} from "./historical-data-fresh-0016-preservation-cli-adapter";
import {
  buildReleaseArtifactSafetyChecks,
} from "./release-artifact-safety";
import {
  assertSameTemporarySqlFileAttestation,
  attestTemporarySqlFile,
  buildSiteTranslationSourceSyncPlan,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
  readRemoteSiteTranslationSourceSnapshot,
  removeAttestedTemporarySqlFile,
  writeTemporarySqlFile,
  type SiteTranslationSourceSnapshot,
} from "./sync-site-translation-sources";
import {
  acquireProductionValidationExclusion,
  assertNoLiveProductionValidationLock,
  assertProductionValidationExclusionCommandWindow,
  attestProductionValidationExclusion,
  clearProductionMaintenanceState,
  createProductionMaintenanceState,
  releaseProductionValidationExclusion,
  type ProductionMaintenanceState,
  type ProductionValidationExclusion,
} from "./production-validation-lock";
import {
  buildWorkerDeployArtifactEvidence,
} from "./worker-deploy-evidence";
import {
  assertFreshProductionVectorizeReadiness,
} from "./vectorize-readiness-evidence";
import {
  readWorkerCandidateActivationEvidence,
  readWorkerCandidateUploadEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

export const STAGED_TRANSLATION_D1_RELEASE_MODE =
  "staged-canonical-English-fallback" as const;
export const STAGED_TRANSLATION_D1_PLAN_KIND =
  "inspir-staged-translation-d1-reconciliation-plan-v1" as const;
export const STAGED_TRANSLATION_D1_RESUME_KIND =
  "inspir-staged-translation-d1-reconciliation-resume-v1" as const;
export const STAGED_TRANSLATION_D1_LOCAL_AUTHORIZATION_KIND =
  "inspir-staged-translation-d1-local-authorization-v1" as const;
export const STAGED_TRANSLATION_D1_CLEANUP_EVIDENCE_KIND =
  "production-staged-translation-d1-candidate-active-cleanup-v1" as const;
export const STAGED_TRANSLATION_D1_PLAN_READY_PREPARED_KIND =
  "inspir-staged-translation-d1-plan-ready-prepared-v1" as const;
export const CURRENT_FALLBACK_TRANSLATION_SITE_ROWS = 599 as const;
export const CURRENT_FALLBACK_TRANSLATION_MAIN_APP_ROWS = 69 as const;
export const CURRENT_FALLBACK_TRANSLATION_EXACT_ROWS = 668 as const;
export const STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS =
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS;
export const STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES =
  75_000;

const maximumPlanEvidenceBytes = 64 * 1024;
const maximumCleanupEvidenceAgeMs = 30 * 60 * 1_000;
const patchStatementTargetBytes = 90_000;
const verificationMaximumRowsPerQuery = 192;
const verificationTargetPayloadBytes = 4 * 1024 * 1024;
const maximumCleanupReadAttemptEvidenceBytes = 4 * 1024 * 1024;
// app_translations owns the table row, composite-primary-key index, and
// language index. Reserve all three writes for every logical mutation.
const stagedTranslationBilledWritesPerLogicalRow = 3;

function paidExpeditedD1ObservedUsageFloor(now: Date): D1DailyUsage {
  return {
    databaseCount: 1,
    queryGroups: 0,
    rowsRead: 0,
    rowsWritten: 0,
    executions: 0,
    windowMinutes: utcUsageWindowMinutes(now),
  };
}

export function compactReleaseSourceFingerprint(
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>,
) {
  if (
    !isSha256(sourceFingerprint.sha256) ||
    !isPositiveSafeInteger(sourceFingerprint.fileCount)
  ) {
    throw new Error("Release source fingerprint identity is malformed.");
  }
  return Object.freeze({
    sha256: sourceFingerprint.sha256,
    fileCount: sourceFingerprint.fileCount,
  });
}

export function isStagedTranslationD1CleanupRunId(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._:-]{16,160}$/.test(value)
  );
}

export type StagedTranslationD1Row = Readonly<{
  namespace: string;
  language: SupportedLanguage;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
  model: string;
  sourceRelativePath: string;
  sourceFileSha256: string;
  partition: "site" | "main-app";
}>;

export type StagedTranslationD1Plan = Readonly<{
  kind: typeof STAGED_TRANSLATION_D1_PLAN_KIND;
  releaseMode: typeof STAGED_TRANSLATION_D1_RELEASE_MODE;
  stagedRelease: StagedTranslationReconciliationBinding;
  counts: Readonly<{
    siteRows: number;
    mainAppRows: number;
    exactRows: number;
    deferredMissingRows: number;
    deferredStaleRows: number;
  }>;
  rowSetSha256: string;
  payloadCorpusSha256: string;
  sqlSha256: string;
  sqlBytes: number;
  sqlStatements: number;
  largestSqlStatementBytes: number;
  logicalUpsertWrites: number;
  sql: string;
  rows: readonly StagedTranslationD1Row[];
}>;

export type StagedTranslationD1VerificationIssue = Readonly<{
  code:
    | "exact-partition-drift"
    | "payload-or-metadata-drift";
  message: string;
}>;

export type StagedTranslationD1VerificationReport = Readonly<{
  kind: "inspir-staged-translation-d1-verification-v1";
  releaseMode: typeof STAGED_TRANSLATION_D1_RELEASE_MODE;
  createdAt: string;
  ok: boolean;
  status: "reconciled" | "repair-required";
  repairRequired: boolean;
  preActivationPlanReady: true;
  exactAlready: boolean;
  cleanupRequiredAfterCandidateActivation: boolean;
  issues: readonly StagedTranslationD1VerificationIssue[];
  expectedRows: number;
  observedRows: number;
  missingRows: number;
  extraRows: number;
  duplicateRows: number;
  payloadRowsMatched: number;
  remoteQueries: number;
  billedRowsRead: number;
  singleAttemptBillingConfirmed: true;
  databaseWrites: 0;
  planSha256: string;
}>;

type StagedTranslationD1PlanReadyPrepared = Readonly<{
  kind: typeof STAGED_TRANSLATION_D1_PLAN_READY_PREPARED_KIND;
  schemaVersion: 1;
  createdAt: string;
  operationId: string;
  utcDay: string;
  ledgerPath: string;
  candidateVersionId: string;
  uploadEvidenceSha256: string;
  planSha256: string;
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>;
  attemptEvidenceSha256: string;
  report: StagedTranslationD1VerificationReport;
}>;

type StagedTranslationD1PlanReadyAttempt = Readonly<{
  kind: "inspir-staged-translation-d1-plan-ready-attempt-v1";
  schemaVersion: 1;
  createdAt: string;
  operationId: string;
  utcDay: string;
  ledgerPath: string;
  candidateVersionId: string;
  uploadEvidenceSha256: string;
  planSha256: string;
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>;
  d1ReadMayHaveStarted: true;
  automaticRereadAllowed: false;
}>;

type StagedTranslationD1ResumeEvidence = Readonly<{
  kind: typeof STAGED_TRANSLATION_D1_RESUME_KIND;
  schemaVersion: 1;
  createdAt: string;
  releaseMode: typeof STAGED_TRANSLATION_D1_RELEASE_MODE;
  planSha256: string;
  stagedAttestationFileSha256: string;
  stagedAttestationSha256: string;
  rowSetSha256: string;
  payloadCorpusSha256: string;
  sqlSha256: string;
  sqlBytes: number;
  exactRows: number;
  authority: "local-plan-resume-only";
  canReadProduction: false;
  canWriteProduction: false;
  canDeploy: false;
}>;

export type StagedTranslationD1LocalAuthorization = Readonly<{
  kind: typeof STAGED_TRANSLATION_D1_LOCAL_AUTHORIZATION_KIND;
  schemaVersion: 1;
  createdAt: string;
  releaseMode: typeof STAGED_TRANSLATION_D1_RELEASE_MODE;
  planSha256: string;
  stagedAttestationFileSha256: string;
  stagedAttestationSha256: string;
  rowSetSha256: string;
  payloadCorpusSha256: string;
  sqlSha256: string;
  exactRows: number;
  authority: "local-candidate-input-only";
  satisfiesLocalStagedReconciliationInput: true;
  grantsProductionReadByItself: false;
  grantsProductionWriteByItself: false;
  grantsDeploymentByItself: false;
  canReadProduction: false;
  canWriteProduction: false;
  canDeploy: false;
}>;

export type StagedTranslationD1CleanupEvidence = Readonly<{
  kind: typeof STAGED_TRANSLATION_D1_CLEANUP_EVIDENCE_KIND;
  schemaVersion: 1;
  createdAt: string;
  releaseMode: typeof STAGED_TRANSLATION_D1_RELEASE_MODE;
  phase: "candidate-active-post-activation-cleanup";
  ok: true;
  runId: string;
  candidateVersionId: string;
  activationEvidenceSha256: string;
  uploadEvidenceSha256: string;
  planSha256: string;
  localAuthorizationSha256: string;
  sourceSyncSha256: string;
  sourceSyncUpdatedAt: number;
  sourceRowsVerified: number;
  sourceStringRowsVerified: number;
  sourceVerificationBilledRowsRead: number;
  sourceVerificationSingleAttemptBillingConfirmed: true;
  atomicSqlSha256: string;
  exactRows: number;
  rowSetSha256: string;
  payloadCorpusSha256: string;
  removedExtraRows: number;
  remoteQueries: number;
  billedRowsRead: number;
  importRowsRead: number;
  importRowsWritten: number;
  importBillingConfirmed: boolean;
  timeTravelBookmark: string;
  readAttemptEvidencePath: string;
  readAttemptEvidenceSha256: string;
  preWriteEvidencePath: string;
  maintenanceVersionId: string;
  candidateRestored: true;
  exactSymmetricDifference: true;
  exactPayloadBytesVerified: true;
}>;

type StagedTranslationD1CleanupReadAttemptEvidence = Readonly<{
  kind: "inspir-staged-translation-d1-cleanup-read-attempt-v1";
  schemaVersion: 1;
  createdAt: string;
  operationId: string;
  utcDay: string;
  ledgerPath: string;
  runId: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
  uploadEvidenceSha256: string;
  activationEvidenceSha256: string;
  planSha256: string;
  localAuthorizationSha256: string;
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>;
  d1ReadMayHaveStarted: true;
  automaticRetryAllowed: false;
}>;

/**
 * Storage admission for the explicit staged-English-fallback release only.
 * The legacy full-corpus helper intentionally remains pinned to 8,694 rows;
 * keeping a distinct function prevents either release mode from weakening the
 * other's exact cardinality contract.
 */
export function buildExactStagedD1StorageAdmission(input: {
  database: D1DatabaseStorageInfo;
  translationRows: readonly D1TranslationStorageRow[];
  sourceEntries: readonly D1SourceStorageEntry[];
}) {
  const database = assertExactProductionD1StorageIdentity(input.database);
  if (input.translationRows.length !== CURRENT_FALLBACK_TRANSLATION_EXACT_ROWS) {
    throw new Error(
      `Exact staged D1 storage admission requires ${CURRENT_FALLBACK_TRANSLATION_EXACT_ROWS} translation rows; received ${input.translationRows.length}.`,
    );
  }
  const identities = new Set(
    input.translationRows.map(
      (row) => `${row.namespace}\u0000${row.language}`,
    ),
  );
  if (identities.size !== input.translationRows.length) {
    throw new Error(
      "Exact staged D1 storage admission contains duplicate translation rows.",
    );
  }
  return assertD1FreeStorageAdmission(
    projectD1FreeStorageAdmission({
      database,
      translationRows: input.translationRows,
      sourceEntries: input.sourceEntries,
    }),
  );
}

function revalidateExactStagedD1StorageAdmission(input: {
  initialDatabase: D1DatabaseStorageInfo;
  currentDatabase: D1DatabaseStorageInfo;
  translationRows: readonly D1TranslationStorageRow[];
  sourceEntries: readonly D1SourceStorageEntry[];
}) {
  const initialDatabase = assertExactProductionD1StorageIdentity(
    input.initialDatabase,
  );
  const currentDatabase = assertExactProductionD1StorageIdentity(
    input.currentDatabase,
  );
  if (
    currentDatabase.databaseName !== initialDatabase.databaseName ||
    currentDatabase.databaseUuid !== initialDatabase.databaseUuid
  ) {
    throw new Error(
      "Staged D1 storage admission database identity changed before import.",
    );
  }
  return buildExactStagedD1StorageAdmission({
    database: currentDatabase,
    translationRows: input.translationRows,
    sourceEntries: input.sourceEntries,
  });
}

function stagedTranslationStorageRows(
  plan: StagedTranslationD1Plan,
): D1TranslationStorageRow[] {
  if (plan.rows.length !== CURRENT_FALLBACK_TRANSLATION_EXACT_ROWS) {
    throw new Error("Canonical staged plan lost its exact storage row count.");
  }
  return plan.rows.map((row) => ({
    namespace: row.namespace,
    language: row.language,
    sourceHash: row.sourceHash,
    payloadJson: canonicalPayload(row.payload),
    model: row.model,
  }));
}

function stagedTranslationCleanupOperationId(input: {
  candidateVersionId: string;
  activationEvidenceSha256: string;
  plan: StagedTranslationD1Plan;
  localAuthorization: StagedTranslationD1LocalAuthorization;
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>;
}) {
  return `staged-translation-cleanup:${sha256Canonical({
    candidateVersionId: input.candidateVersionId,
    activationEvidenceSha256: input.activationEvidenceSha256,
    admissionMode: D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
    cleanupWriteCeiling: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES,
    planSha256: stagedTranslationD1PlanSha256(input.plan),
    localAuthorizationSha256: sha256Canonical(input.localAuthorization),
    sourceFingerprint: compactReleaseSourceFingerprint(input.sourceFingerprint),
  })}`;
}

function stagedTranslationCleanupReadAttemptPath(input: {
  backupDir: string;
  utcDay: string;
  operationId: string;
}) {
  return path.join(
    path.resolve(input.backupDir),
    "cloudflare",
    `staged-translation-d1-cleanup-read-attempt-${input.utcDay}-${sha256(input.operationId)}.json`,
  );
}

function parseStagedTranslationCleanupReadAttempt(
  value: unknown,
): StagedTranslationD1CleanupReadAttemptEvidence {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "activationEvidenceSha256",
      "automaticRetryAllowed",
      "candidateVersionId",
      "createdAt",
      "d1ReadMayHaveStarted",
      "kind",
      "ledgerPath",
      "localAuthorizationSha256",
      "maintenanceVersionId",
      "operationId",
      "planSha256",
      "runId",
      "schemaVersion",
      "sourceFingerprint",
      "uploadEvidenceSha256",
      "utcDay",
    ]) ||
    value.kind !==
      "inspir-staged-translation-d1-cleanup-read-attempt-v1" ||
    value.schemaVersion !== 1 ||
    !isCanonicalTimestamp(value.createdAt) ||
    typeof value.operationId !== "string" ||
    !value.operationId.startsWith("staged-translation-cleanup:") ||
    typeof value.utcDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.utcDay) ||
    value.createdAt.slice(0, 10) !== value.utcDay ||
    typeof value.ledgerPath !== "string" ||
    !path.isAbsolute(value.ledgerPath) ||
    !isStagedTranslationD1CleanupRunId(value.runId) ||
    !isWorkerVersion(value.candidateVersionId) ||
    !isWorkerVersion(value.maintenanceVersionId) ||
    !isSha256(value.uploadEvidenceSha256) ||
    !isSha256(value.activationEvidenceSha256) ||
    !isSha256(value.planSha256) ||
    !isSha256(value.localAuthorizationSha256) ||
    value.d1ReadMayHaveStarted !== true ||
    value.automaticRetryAllowed !== false
  ) {
    throw new Error(
      "Candidate-active staged cleanup read-attempt evidence is malformed.",
    );
  }
  return {
    kind: "inspir-staged-translation-d1-cleanup-read-attempt-v1",
    schemaVersion: 1,
    createdAt: value.createdAt,
    operationId: value.operationId,
    utcDay: value.utcDay,
    ledgerPath: value.ledgerPath,
    runId: value.runId,
    candidateVersionId: value.candidateVersionId,
    maintenanceVersionId: value.maintenanceVersionId,
    uploadEvidenceSha256: value.uploadEvidenceSha256,
    activationEvidenceSha256: value.activationEvidenceSha256,
    planSha256: value.planSha256,
    localAuthorizationSha256: value.localAuthorizationSha256,
    sourceFingerprint: parseSourceFingerprintIdentity(
      value.sourceFingerprint,
      "candidate-active staged cleanup read-attempt source fingerprint",
    ),
    d1ReadMayHaveStarted: true,
    automaticRetryAllowed: false,
  };
}

function writeStagedTranslationCleanupReadAttempt(input: {
  backupDir: string;
  operationId: string;
  budget: D1ReleaseBudgetReservationResult;
  runId: string;
  candidateVersionId: string;
  maintenanceVersionId: string;
  uploadEvidenceSha256: string;
  activationEvidenceSha256: string;
  planSha256: string;
  localAuthorizationSha256: string;
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>;
  now: Date;
}) {
  if (input.budget.reservation.phase !== "maximum") {
    throw new Error(
      "Candidate-active staged cleanup cannot begin D1 reads from an invalid budget phase.",
    );
  }
  const createdAt = validClock(
    input.now,
    "candidate-active staged cleanup read-attempt clock",
  ).toISOString();
  assertD1ReleaseBudgetUtcDay(input.budget.utcDay, new Date(createdAt));
  const file = stagedTranslationCleanupReadAttemptPath({
    backupDir: input.backupDir,
    utcDay: input.budget.utcDay,
    operationId: input.operationId,
  });
  if (pathEntryExists(file)) {
    throw new Error(
      "Candidate-active staged cleanup D1 reads may already have started; automatic retry is forbidden.",
    );
  }
  const attempt: StagedTranslationD1CleanupReadAttemptEvidence = Object.freeze({
    kind: "inspir-staged-translation-d1-cleanup-read-attempt-v1",
    schemaVersion: 1,
    createdAt,
    operationId: input.operationId,
    utcDay: input.budget.utcDay,
    ledgerPath: input.budget.ledgerPath,
    runId: input.runId,
    candidateVersionId: input.candidateVersionId,
    maintenanceVersionId: input.maintenanceVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    activationEvidenceSha256: input.activationEvidenceSha256,
    planSha256: input.planSha256,
    localAuthorizationSha256: input.localAuthorizationSha256,
    sourceFingerprint: compactReleaseSourceFingerprint(input.sourceFingerprint),
    d1ReadMayHaveStarted: true,
    automaticRetryAllowed: false,
  });
  writePrivateJsonDurably(file, attempt, { replace: false });
  const stored = parseStagedTranslationCleanupReadAttempt(
    readPrivateJsonNoFollow(file, maximumCleanupReadAttemptEvidenceBytes),
  );
  if (
    stableStringify(stored) !== stableStringify(attempt) ||
    stored.ledgerPath !==
      d1ReleaseBudgetLedgerPath(input.backupDir, input.budget.utcDay)
  ) {
    throw new Error(
      "Candidate-active staged cleanup read-attempt evidence was not durably bound.",
    );
  }
  return Object.freeze({
    path: file,
    sha256: sha256Canonical(stored),
  });
}

export function loadStagedTranslationD1Plan(
  workspaceRoot = process.cwd(),
): StagedTranslationD1Plan {
  return buildStagedTranslationD1Plan(
    loadStagedTranslationFallbackD1SiteCorpus(workspaceRoot),
  );
}

function buildStagedTranslationD1Plan(
  corpus: StagedTranslationFallbackD1SiteCorpus,
): StagedTranslationD1Plan {
  const siteRows = corpus.rows.map(toSiteD1Row);
  const mainAppRows = corpus.mainAppRows.map(toMainAppD1Row);
  const rows = [...siteRows, ...mainAppRows].sort(compareRows);
  assertExactStagedRows(corpus, rows);
  const rowSetSha256 = sha256Canonical(
    rows.map((row) => [row.namespace, row.language, row.sourceHash]),
  );
  const payloadCorpusSha256 = sha256Canonical(
    rows.map((row) => [
      row.namespace,
      row.language,
      row.sourceHash,
      row.model,
      row.sourceRelativePath,
      row.sourceFileSha256,
      row.payload,
    ]),
  );
  if (
    rowSetSha256 !== corpus.rowSetSha256 ||
    payloadCorpusSha256 !== corpus.payloadCorpusSha256
  ) {
    throw new Error(
      "Staged D1 row construction drifted from the nofollow-validated corpus.",
    );
  }
  const stagedRelease = stagedTranslationReconciliationBindingFromAttestation({
    attestation: corpus.attestation,
    d1Corpus: {
      siteRows: siteRows.length,
      mainAppRows: mainAppRows.length,
      exactRows: rows.length,
      rowSetSha256,
      payloadCorpusSha256,
    },
  });
  const sql = buildStagedTranslationD1Sql(rows);
  const sqlSha256 = sha256(sql);
  const planMaterial = {
    kind: STAGED_TRANSLATION_D1_PLAN_KIND,
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    stagedRelease,
    counts: {
      siteRows: siteRows.length,
      mainAppRows: mainAppRows.length,
      exactRows: rows.length,
      deferredMissingRows: corpus.attestation.artifact.inventory.pendingLedger.missing,
      deferredStaleRows: corpus.attestation.artifact.inventory.pendingLedger.stale,
    },
    rowSetSha256,
    payloadCorpusSha256,
    sqlSha256,
    sqlBytes: Buffer.byteLength(sql, "utf8"),
    sqlStatements: splitSqlStatements(sql).length,
    largestSqlStatementBytes: largestSqlStatementBytes(sql),
    logicalUpsertWrites: countLogicalUpsertWrites(sql),
  } as const;
  return Object.freeze({
    ...planMaterial,
    sql,
    rows: Object.freeze(rows),
  });
}

export function stagedTranslationD1PlanSha256(
  plan: StagedTranslationD1Plan,
) {
  return sha256Canonical({
    kind: plan.kind,
    releaseMode: plan.releaseMode,
    stagedRelease: plan.stagedRelease,
    counts: plan.counts,
    rowSetSha256: plan.rowSetSha256,
    payloadCorpusSha256: plan.payloadCorpusSha256,
    sqlSha256: plan.sqlSha256,
    sqlBytes: plan.sqlBytes,
    sqlStatements: plan.sqlStatements,
    largestSqlStatementBytes: plan.largestSqlStatementBytes,
    logicalUpsertWrites: plan.logicalUpsertWrites,
  });
}

export function buildStagedTranslationD1Sql(
  rows: readonly StagedTranslationD1Row[],
) {
  assertStandaloneExactRows(rows);
  const statements: string[] = [buildDeleteNonReleaseRowsSql(rows)];
  for (const row of rows) {
    statements.push(buildResetRowSql(row));
    statements.push(...buildPayloadPatchSql(row));
  }
  statements.push(buildExactPartitionGuardSql(rows));
  return buildAtomicSeoCtaRepairSql(...statements);
}

export function writeStagedTranslationD1ResumeEvidence(input: {
  plan: StagedTranslationD1Plan;
  backupDir: string;
  createdAt?: Date;
}) {
  const createdAt = canonicalTimestamp(input.createdAt ?? new Date());
  const evidence: StagedTranslationD1ResumeEvidence = Object.freeze({
    kind: STAGED_TRANSLATION_D1_RESUME_KIND,
    schemaVersion: 1,
    createdAt,
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    planSha256: stagedTranslationD1PlanSha256(input.plan),
    stagedAttestationFileSha256:
      input.plan.stagedRelease.artifactFileSha256,
    stagedAttestationSha256: input.plan.stagedRelease.attestationSha256,
    rowSetSha256: input.plan.rowSetSha256,
    payloadCorpusSha256: input.plan.payloadCorpusSha256,
    sqlSha256: input.plan.sqlSha256,
    sqlBytes: input.plan.sqlBytes,
    exactRows: input.plan.counts.exactRows,
    authority: "local-plan-resume-only",
    canReadProduction: false,
    canWriteProduction: false,
    canDeploy: false,
  });
  const file = path.join(
    path.resolve(input.backupDir),
    "cloudflare",
    `staged-translation-d1-resume-${stagedTranslationD1PlanSha256(input.plan)}.json`,
  );
  writePrivateJsonDurably(file, evidence, { replace: false });
  return { file, evidence } as const;
}

export function writeStagedTranslationD1LocalAuthorization(input: {
  plan: StagedTranslationD1Plan;
  backupDir: string;
  createdAt?: Date;
}) {
  const authorization = localAuthorizationForPlan(
    input.plan,
    canonicalTimestamp(input.createdAt ?? new Date()),
  );
  const file = stagedTranslationD1LocalAuthorizationPath(
    input.backupDir,
    input.plan,
  );
  writePrivateJsonDurably(file, authorization, { replace: false });
  return { file, authorization } as const;
}

export function readAndValidateStagedTranslationD1LocalAuthorization(input: {
  authorizationPath: string;
  plan: StagedTranslationD1Plan;
}) {
  const authorization = parseLocalAuthorization(
    readPrivateJsonNoFollow(
      path.resolve(input.authorizationPath),
      maximumPlanEvidenceBytes,
    ),
  );
  const expected = localAuthorizationForPlan(
    input.plan,
    authorization.createdAt,
  );
  if (stableStringify(expected) !== stableStringify(authorization)) {
    throw new Error(
      "Staged translation D1 local authorization is stale, mixed, or tampered.",
    );
  }
  return authorization;
}

function readCanonicalStagedTranslationD1LocalAuthorization(input: {
  authorizationPath: string;
  backupDir: string;
  plan: StagedTranslationD1Plan;
}) {
  const expectedPath = stagedTranslationD1LocalAuthorizationPath(
    input.backupDir,
    input.plan,
  );
  if (path.resolve(input.authorizationPath) !== expectedPath) {
    throw new Error(
      "Staged translation D1 release requires the exact canonical local authorization path.",
    );
  }
  return readAndValidateStagedTranslationD1LocalAuthorization({
    authorizationPath: expectedPath,
    plan: input.plan,
  });
}

export function resumeStagedTranslationD1Plan(input: {
  evidencePath: string;
  workspaceRoot?: string;
}): StagedTranslationD1Plan {
  const plan = loadStagedTranslationD1Plan(
    path.resolve(input.workspaceRoot ?? process.cwd()),
  );
  validateStagedTranslationD1ResumeEvidence({
    evidencePath: input.evidencePath,
    plan,
  });
  return plan;
}

export function validateStagedTranslationD1ResumeEvidence(input: {
  evidencePath: string;
  plan: StagedTranslationD1Plan;
}) {
  const evidence = parseResumeEvidence(
    readPrivateJsonNoFollow(
      path.resolve(input.evidencePath),
      maximumPlanEvidenceBytes,
    ),
  );
  const plan = input.plan;
  const current = resumeEvidenceForPlan(plan, evidence.createdAt);
  if (stableStringify(current) !== stableStringify(evidence)) {
    throw new Error(
      "Staged translation D1 resume evidence is stale, mixed, or tampered.",
    );
  }
  return evidence;
}

export function verifyRemoteStagedTranslationD1(input: {
  plan: StagedTranslationD1Plan;
  runner?: WranglerRunner;
  now?: Date;
}): StagedTranslationD1VerificationReport {
  const runner = input.runner ?? runWrangler;
  let remoteQueries = 0;
  let billedRowsRead = 0;
  const query = (sql: string, maxBuffer = 16 * 1024 * 1024) => {
    const args = [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      sql,
    ];
    assertReadOnlyRemoteTranslationVerificationArgs(args);
    const output = runner(args, { maxBuffer });
    const billing = parseD1Billing(output, {
      label: "staged translation read-only verification",
      expectedResultSets: splitSqlStatements(sql).length,
      readOnly: true,
      requireSingleAttempt: true,
    });
    remoteQueries += 1;
    billedRowsRead = safeAdd(billedRowsRead, billing.rowsRead);
    return extractD1ResultSets(output, splitSqlStatements(sql).length);
  };

  const summarySets = query(buildStagedTranslationSummarySql(input.plan.rows));
  const summary = requireSingleRow(summarySets[0], "staged translation summary");
  const observedRows = exactCounter(summary.observed_rows, "observed rows");
  const presentRows = exactCounter(summary.present_rows, "present rows");
  const duplicateRows = exactCounter(summary.duplicate_rows, "duplicate rows");
  if (
    presentRows > input.plan.counts.exactRows ||
    presentRows > observedRows
  ) {
    throw new Error("Staged translation summary returned inconsistent row counts.");
  }
  const missingRows = input.plan.counts.exactRows - presentRows;
  const extraRows = observedRows - presentRows;
  const issues: StagedTranslationD1VerificationIssue[] = [];
  if (
    observedRows !== input.plan.counts.exactRows ||
    missingRows !== 0 ||
    extraRows !== 0 ||
    duplicateRows !== 0
  ) {
    issues.push({
      code: "exact-partition-drift",
      message:
        "Production app_translations does not equal the exact staged allowed identity set.",
    });
  }

  let payloadRowsMatched = 0;
  let payloadMismatch = false;
  for (const chunk of buildVerificationChunks(input.plan.rows)) {
    const [actualRows] = query(chunk.sql, chunk.maxBufferBytes);
    try {
      payloadRowsMatched += verifyPayloadRows(actualRows, chunk.rows);
    } catch {
      payloadMismatch = true;
    }
  }
  if (payloadMismatch || payloadRowsMatched !== input.plan.counts.exactRows) {
    issues.push({
      code: "payload-or-metadata-drift",
      message:
        "One or more staged D1 payloads, source hashes, models, or row bytes differ from the canonical corpus.",
    });
  }
  const ok = issues.length === 0;
  return Object.freeze({
    kind: "inspir-staged-translation-d1-verification-v1",
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    createdAt: canonicalTimestamp(input.now ?? new Date()),
    ok,
    status: ok ? "reconciled" : "repair-required",
    repairRequired: !ok,
    preActivationPlanReady: true,
    exactAlready: ok,
    cleanupRequiredAfterCandidateActivation: true,
    issues: Object.freeze(issues),
    expectedRows: input.plan.counts.exactRows,
    observedRows,
    missingRows,
    extraRows,
    duplicateRows,
    payloadRowsMatched,
    remoteQueries,
    billedRowsRead,
    singleAttemptBillingConfirmed: true,
    databaseWrites: 0,
    planSha256: stagedTranslationD1PlanSha256(input.plan),
  });
}

function parseStagedPlanReadyAttempt(
  value: unknown,
): StagedTranslationD1PlanReadyAttempt {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "automaticRereadAllowed",
      "candidateVersionId",
      "createdAt",
      "d1ReadMayHaveStarted",
      "kind",
      "ledgerPath",
      "operationId",
      "planSha256",
      "schemaVersion",
      "sourceFingerprint",
      "utcDay",
      "uploadEvidenceSha256",
    ]) ||
    value.kind !==
      "inspir-staged-translation-d1-plan-ready-attempt-v1" ||
    value.schemaVersion !== 1 ||
    !isCanonicalTimestamp(value.createdAt) ||
    typeof value.operationId !== "string" ||
    !value.operationId.startsWith("staged-translation-plan-ready:") ||
    typeof value.utcDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.utcDay) ||
    value.createdAt.slice(0, 10) !== value.utcDay ||
    typeof value.ledgerPath !== "string" ||
    !path.isAbsolute(value.ledgerPath) ||
    !isWorkerVersion(value.candidateVersionId) ||
    !isSha256(value.uploadEvidenceSha256) ||
    !isSha256(value.planSha256) ||
    value.d1ReadMayHaveStarted !== true ||
    value.automaticRereadAllowed !== false
  ) {
    throw new Error(
      "Staged translation plan-ready attempt evidence is malformed.",
    );
  }
  return {
    kind: "inspir-staged-translation-d1-plan-ready-attempt-v1",
    schemaVersion: 1,
    createdAt: value.createdAt,
    operationId: value.operationId,
    utcDay: value.utcDay,
    ledgerPath: value.ledgerPath,
    candidateVersionId: value.candidateVersionId,
    uploadEvidenceSha256: value.uploadEvidenceSha256,
    planSha256: value.planSha256,
    sourceFingerprint: parseSourceFingerprintIdentity(
      value.sourceFingerprint,
      "staged translation plan-ready attempt source fingerprint",
    ),
    d1ReadMayHaveStarted: true,
    automaticRereadAllowed: false,
  };
}

function readOrCreateStagedPlanReadyPrepared(input: {
  backupDir: string;
  operationId: string;
  utcDay: string;
  ledgerPath: string;
  candidateVersionId: string;
  uploadEvidenceSha256: string;
  sourceFingerprint: Readonly<{ sha256: string; fileCount: number }>;
  plan: StagedTranslationD1Plan;
  allowFirstQuery: boolean;
  runner?: WranglerRunner;
  now?: Date;
}) {
  const sourceFingerprint = compactReleaseSourceFingerprint(
    input.sourceFingerprint,
  );
  const file = path.join(
    path.resolve(input.backupDir),
    "cloudflare",
    `staged-translation-d1-plan-ready-prepared-${input.utcDay}-${sha256(input.operationId)}.json`,
  );
  const attemptFile = path.join(
    path.resolve(input.backupDir),
    "cloudflare",
    `staged-translation-d1-plan-ready-attempt-${input.utcDay}-${sha256(input.operationId)}.json`,
  );
  const read = () => {
    const attempt = parseStagedPlanReadyAttempt(
      readPrivateJsonNoFollow(attemptFile, maximumPlanEvidenceBytes),
    );
    const prepared = parseStagedPlanReadyPrepared(
      readPrivateJsonNoFollow(file, maximumPlanEvidenceBytes),
    );
    if (
      prepared.operationId !== input.operationId ||
      prepared.utcDay !== input.utcDay ||
      prepared.ledgerPath !== input.ledgerPath ||
      prepared.candidateVersionId !== input.candidateVersionId ||
      prepared.uploadEvidenceSha256 !== input.uploadEvidenceSha256 ||
      prepared.planSha256 !== stagedTranslationD1PlanSha256(input.plan) ||
      prepared.attemptEvidenceSha256 !== sha256Canonical(attempt) ||
      stableStringify(prepared.sourceFingerprint) !==
        stableStringify(sourceFingerprint) ||
      attempt.operationId !== input.operationId ||
      attempt.utcDay !== input.utcDay ||
      attempt.ledgerPath !== input.ledgerPath ||
      attempt.candidateVersionId !== input.candidateVersionId ||
      attempt.uploadEvidenceSha256 !== input.uploadEvidenceSha256 ||
      attempt.planSha256 !== stagedTranslationD1PlanSha256(input.plan) ||
      stableStringify(attempt.sourceFingerprint) !==
        stableStringify(sourceFingerprint) ||
      Date.parse(attempt.createdAt) > Date.parse(prepared.createdAt) ||
      prepared.report.planSha256 !== stagedTranslationD1PlanSha256(input.plan) ||
      prepared.report.expectedRows !== input.plan.counts.exactRows
    ) {
      throw new Error(
        "Staged translation plan-ready prepared evidence is stale or mismatched.",
      );
    }
    return prepared;
  };
  if (pathEntryExists(file)) return read();
  if (pathEntryExists(attemptFile)) {
    throw new Error(
      "Staged translation plan-ready D1 read may already have started without prepared evidence; automatic reread is forbidden.",
    );
  }
  if (!input.allowFirstQuery) {
    throw new Error(
      "Staged translation plan-ready budget is not a fresh maximum; D1 read cannot start without prepared evidence.",
    );
  }
  const attemptAt = validClock(
    input.now ?? new Date(),
    "staged translation plan-ready attempt clock",
  ).toISOString();
  if (attemptAt.slice(0, 10) !== input.utcDay) {
    throw new Error("Staged translation plan-ready attempt crossed its UTC day.");
  }
  writePrivateJsonDurably(
    attemptFile,
    {
      kind: "inspir-staged-translation-d1-plan-ready-attempt-v1",
      schemaVersion: 1,
      createdAt: attemptAt,
      operationId: input.operationId,
      utcDay: input.utcDay,
      ledgerPath: input.ledgerPath,
      candidateVersionId: input.candidateVersionId,
      uploadEvidenceSha256: input.uploadEvidenceSha256,
      planSha256: stagedTranslationD1PlanSha256(input.plan),
      sourceFingerprint,
      d1ReadMayHaveStarted: true,
      automaticRereadAllowed: false,
    },
    { replace: false },
  );
  const storedAttempt = parseStagedPlanReadyAttempt(
    readPrivateJsonNoFollow(attemptFile, maximumPlanEvidenceBytes),
  );
  if (
    storedAttempt.operationId !== input.operationId ||
    storedAttempt.utcDay !== input.utcDay ||
    storedAttempt.ledgerPath !== input.ledgerPath ||
    storedAttempt.candidateVersionId !== input.candidateVersionId ||
    storedAttempt.uploadEvidenceSha256 !== input.uploadEvidenceSha256 ||
    storedAttempt.planSha256 !== stagedTranslationD1PlanSha256(input.plan) ||
    stableStringify(storedAttempt.sourceFingerprint) !==
      stableStringify(sourceFingerprint) ||
    storedAttempt.d1ReadMayHaveStarted !== true ||
    storedAttempt.automaticRereadAllowed !== false
  ) {
    throw new Error("Staged translation plan-ready attempt evidence is mismatched.");
  }
  const report = verifyRemoteStagedTranslationD1({
    plan: input.plan,
    runner: input.runner,
    now: input.now,
  });
  const prepared: StagedTranslationD1PlanReadyPrepared = Object.freeze({
    kind: STAGED_TRANSLATION_D1_PLAN_READY_PREPARED_KIND,
    schemaVersion: 1,
    createdAt: report.createdAt,
    operationId: input.operationId,
    utcDay: input.utcDay,
    ledgerPath: input.ledgerPath,
    candidateVersionId: input.candidateVersionId,
    uploadEvidenceSha256: input.uploadEvidenceSha256,
    planSha256: stagedTranslationD1PlanSha256(input.plan),
    sourceFingerprint,
    attemptEvidenceSha256: sha256Canonical(storedAttempt),
    report,
  });
  writePrivateJsonDurably(file, prepared, { replace: false });
  return read();
}

function parseStagedPlanReadyPrepared(
  value: unknown,
): StagedTranslationD1PlanReadyPrepared {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "attemptEvidenceSha256",
      "candidateVersionId",
      "createdAt",
      "kind",
      "ledgerPath",
      "operationId",
      "planSha256",
      "report",
      "schemaVersion",
      "sourceFingerprint",
      "utcDay",
      "uploadEvidenceSha256",
    ]) ||
    value.kind !== STAGED_TRANSLATION_D1_PLAN_READY_PREPARED_KIND ||
    value.schemaVersion !== 1 ||
    !isCanonicalTimestamp(value.createdAt) ||
    typeof value.operationId !== "string" ||
    !value.operationId.startsWith("staged-translation-plan-ready:") ||
    typeof value.utcDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.utcDay) ||
    typeof value.ledgerPath !== "string" ||
    !path.isAbsolute(value.ledgerPath) ||
    !isWorkerVersion(value.candidateVersionId) ||
    !isSha256(value.uploadEvidenceSha256) ||
    !isSha256(value.planSha256) ||
    !isSha256(value.attemptEvidenceSha256) ||
    !isRecord(value.sourceFingerprint)
  ) {
    throw new Error("Staged translation plan-ready prepared evidence is malformed.");
  }
  const sourceFingerprint = parseSourceFingerprintIdentity(
    value.sourceFingerprint,
    "staged translation plan-ready prepared source fingerprint",
  );
  const report = parseStagedTranslationD1VerificationReport(value.report);
  if (
    report.createdAt !== value.createdAt ||
    report.createdAt.slice(0, 10) !== value.utcDay
  ) {
    throw new Error("Staged translation prepared/report clocks disagree.");
  }
  return {
    kind: STAGED_TRANSLATION_D1_PLAN_READY_PREPARED_KIND,
    schemaVersion: 1,
    createdAt: value.createdAt,
    operationId: value.operationId,
    utcDay: value.utcDay,
    ledgerPath: value.ledgerPath,
    candidateVersionId: value.candidateVersionId,
    uploadEvidenceSha256: value.uploadEvidenceSha256,
    planSha256: value.planSha256,
    sourceFingerprint,
    attemptEvidenceSha256: value.attemptEvidenceSha256,
    report,
  };
}

function parseStagedTranslationD1VerificationReport(
  value: unknown,
): StagedTranslationD1VerificationReport {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "billedRowsRead",
      "cleanupRequiredAfterCandidateActivation",
      "createdAt",
      "databaseWrites",
      "exactAlready",
      "expectedRows",
      "extraRows",
      "issues",
      "kind",
      "missingRows",
      "observedRows",
      "ok",
      "payloadRowsMatched",
      "planSha256",
      "preActivationPlanReady",
      "releaseMode",
      "remoteQueries",
      "repairRequired",
      "singleAttemptBillingConfirmed",
      "status",
      "duplicateRows",
    ]) ||
    value.kind !== "inspir-staged-translation-d1-verification-v1" ||
    value.releaseMode !== STAGED_TRANSLATION_D1_RELEASE_MODE ||
    !isCanonicalTimestamp(value.createdAt) ||
    typeof value.ok !== "boolean" ||
    typeof value.repairRequired !== "boolean" ||
    value.preActivationPlanReady !== true ||
    typeof value.exactAlready !== "boolean" ||
    value.cleanupRequiredAfterCandidateActivation !== true ||
    !Array.isArray(value.issues) ||
    !isPositiveSafeInteger(value.expectedRows) ||
    !isNonNegativeSafeInteger(value.observedRows) ||
    !isNonNegativeSafeInteger(value.missingRows) ||
    !isNonNegativeSafeInteger(value.extraRows) ||
    !isNonNegativeSafeInteger(value.duplicateRows) ||
    !isNonNegativeSafeInteger(value.payloadRowsMatched) ||
    !isPositiveSafeInteger(value.remoteQueries) ||
    !isNonNegativeSafeInteger(value.billedRowsRead) ||
    value.singleAttemptBillingConfirmed !== true ||
    value.databaseWrites !== 0 ||
    !isSha256(value.planSha256)
  ) {
    throw new Error("Staged translation prepared verification report is malformed.");
  }
  const issues: StagedTranslationD1VerificationIssue[] = value.issues.map(
    (issue) => {
      if (
        !isRecord(issue) ||
        !hasExactKeys(issue, ["code", "message"]) ||
        (issue.code !== "exact-partition-drift" &&
          issue.code !== "payload-or-metadata-drift") ||
        typeof issue.message !== "string" ||
        !issue.message
      ) {
        throw new Error("Staged translation prepared issue is malformed.");
      }
      return { code: issue.code, message: issue.message };
    },
  );
  const ok = issues.length === 0;
  const exactCounters =
    value.observedRows === value.expectedRows &&
    value.missingRows === 0 &&
    value.extraRows === 0 &&
    value.duplicateRows === 0 &&
    value.payloadRowsMatched === value.expectedRows;
  if (
    value.ok !== ok ||
    ok !== exactCounters ||
    value.repairRequired !== !ok ||
    value.exactAlready !== ok ||
    value.status !== (ok ? "reconciled" : "repair-required") ||
    value.payloadRowsMatched > value.expectedRows
  ) {
    throw new Error("Staged translation prepared report state is inconsistent.");
  }
  return {
    kind: "inspir-staged-translation-d1-verification-v1",
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    createdAt: value.createdAt,
    ok,
    status: ok ? "reconciled" : "repair-required",
    repairRequired: !ok,
    preActivationPlanReady: true,
    exactAlready: ok,
    cleanupRequiredAfterCandidateActivation: true,
    issues,
    expectedRows: value.expectedRows,
    observedRows: value.observedRows,
    missingRows: value.missingRows,
    extraRows: value.extraRows,
    duplicateRows: value.duplicateRows,
    payloadRowsMatched: value.payloadRowsMatched,
    remoteQueries: value.remoteQueries,
    billedRowsRead: value.billedRowsRead,
    singleAttemptBillingConfirmed: true,
    databaseWrites: 0,
    planSha256: value.planSha256,
  };
}

export function verifyOnlyStagedTranslationD1Release(input: {
  backupDir: string;
  candidateVersionId: string;
  localAuthorizationPath: string;
  runner?: WranglerRunner;
  now?: Date;
  attestationClock?: () => Date;
  budgetClock?: () => Date;
  dailyUsage?: D1DailyUsage;
  releaseSequenceGate?: (input: {
    backupDir: string;
    candidateVersionId: string;
  }) => RemoteTranslationSequenceGateResult;
}) {
  const plan = loadStagedTranslationD1Plan(process.cwd());
  readCanonicalStagedTranslationD1LocalAuthorization({
    authorizationPath: input.localAuthorizationPath,
    backupDir: input.backupDir,
    plan,
  });
  const sequence = (input.releaseSequenceGate ?? assertRemoteTranslationSequenceGate)({
    backupDir: input.backupDir,
    candidateVersionId: input.candidateVersionId,
  });
  const budgetClock = input.budgetClock ?? (() => new Date());
  const budgetStartedAt = validClock(
    budgetClock(),
    "staged translation read-only budget start",
  );
  const budgetSource = {
    sha256: sequence.currentRelease.artifactEvidence.sourceFingerprint.sha256,
    fileCount:
      sequence.currentRelease.artifactEvidence.sourceFingerprint.fileCount,
  };
  const budgetOperationId = `staged-translation-plan-ready:${sha256Canonical({
    candidateVersionId: sequence.currentRelease.targetCandidateVersionId,
    uploadEvidenceSha256: sequence.currentRelease.uploadEvidenceSha256,
    planSha256: stagedTranslationD1PlanSha256(plan),
    sourceFingerprint: budgetSource,
  })}`;
  const usage =
    input.dailyUsage ??
    loadAccountD1DailyUsage(budgetStartedAt, input.runner ?? runWrangler, budgetClock);
  assertD1FreeDailyBudget(usage, {
    operation: "Staged translation read-only plan seal maximum",
    rowsRead: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS,
    rowsWritten: 0,
  });
  let budget = reserveD1ReleaseBudget({
    backupDir: input.backupDir,
    operationId: budgetOperationId,
    operation: "Staged translation read-only plan seal",
    candidateVersionId: sequence.currentRelease.targetCandidateVersionId,
    sourceFingerprint: budgetSource,
    phase: "maximum",
    rowsRead: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS,
    rowsWritten: 0,
    observedUsage: usage,
    now: budgetStartedAt,
  });
  const clock = input.attestationClock ?? (() => new Date());
  writeTranslationReconciliationPending({
    createdAt: canonicalTimestamp(clock()),
    backupDir: input.backupDir,
    currentRelease: sequence.currentRelease,
    vectorizeReadiness: sequence.vectorizeReadiness,
    topicAttestation: sequence.topicAttestation,
    method: "read-only-drift",
    stagedRelease: plan.stagedRelease,
  });
  const report = readOrCreateStagedPlanReadyPrepared({
    backupDir: input.backupDir,
    operationId: budgetOperationId,
    utcDay: budget.utcDay,
    ledgerPath: budget.ledgerPath,
    candidateVersionId: sequence.currentRelease.targetCandidateVersionId,
    uploadEvidenceSha256: sequence.currentRelease.uploadEvidenceSha256,
    sourceFingerprint: budgetSource,
    plan,
    allowFirstQuery:
      budget.reservation.phase === "maximum" && budget.idempotent === false,
    runner: input.runner,
    now: input.now,
  }).report;
  assertD1ReleaseBudgetUtcDay(
    budget.utcDay,
    validClock(budgetClock(), "staged translation read-only completion UTC day"),
  );
  const exactReservationAt = validClock(
    budgetClock(),
    "staged translation read-only exact reservation",
  );
  assertD1ReleaseBudgetUtcDay(budget.utcDay, exactReservationAt);
  budget = reserveD1ReleaseBudget({
    backupDir: input.backupDir,
    operationId: budgetOperationId,
    operation: "Staged translation read-only plan seal",
    candidateVersionId: sequence.currentRelease.targetCandidateVersionId,
    sourceFingerprint: budgetSource,
    phase: "exact",
    rowsRead: report.billedRowsRead,
    rowsWritten: 0,
    observedUsage: usage,
    now: exactReservationAt,
    expectedUtcDay: budget.utcDay,
  });
  if (
    budget.reservation.phase !== "exact" ||
    budget.reservation.rowsRead !== report.billedRowsRead ||
    budget.reservation.rowsWritten !== 0
  ) {
    throw new Error(
      "Staged translation read-only plan seal did not retain exact D1 accounting.",
    );
  }
  const finalSequence =
    (input.releaseSequenceGate ?? assertRemoteTranslationSequenceGate)({
      backupDir: input.backupDir,
      candidateVersionId: input.candidateVersionId,
    });
  assertD1ReleaseBudgetUtcDay(
    budget.utcDay,
    validClock(
      budgetClock(),
      "staged translation read-only success UTC day",
    ),
  );
  writeTranslationReconciliationSuccess({
    createdAt: canonicalTimestamp(clock()),
    backupDir: input.backupDir,
    currentRelease: finalSequence.currentRelease,
    vectorizeReadiness: finalSequence.vectorizeReadiness,
    topicAttestation: finalSequence.topicAttestation,
    method: "read-only-drift",
    remoteQueries: report.remoteQueries,
    billedRowsRead: report.billedRowsRead,
    stagedRelease: plan.stagedRelease,
  });
  return report;
}

/**
 * Performs the destructive exact-set cleanup only after the uploaded candidate
 * is already the sole active Static-Assets-authoritative Worker. The earlier
 * staged reconciliation evidence is deliberately read-only; this function is
 * the distinct maintenance boundary that may delete legacy/stale D1 rows.
 */
export function runCandidateActiveStagedTranslationD1Cleanup(input: {
  backupDir: string;
  candidateVersionId: string;
  localAuthorizationPath: string;
  dailyUsage?: D1DailyUsage;
  clock?: () => Date;
}): StagedTranslationD1CleanupEvidence {
  const workspaceRoot = path.resolve(process.cwd());
  const backupDir = path.resolve(input.backupDir);
  const clock = input.clock ?? (() => new Date());
  const startedAt = validClock(clock(), "candidate-active cleanup start");
  const plan = loadStagedTranslationD1Plan(workspaceRoot);
  const cleanupEvidencePath = stagedTranslationD1CleanupEvidencePath(backupDir);
  if (pathEntryExists(cleanupEvidencePath)) {
    throw new Error(
      "Candidate-active staged cleanup evidence already exists; validate it instead of repeating production mutation.",
    );
  }
  const localAuthorization =
    readCanonicalStagedTranslationD1LocalAuthorization({
      authorizationPath: input.localAuthorizationPath,
      backupDir,
      plan,
    });
  const release = assertCandidateActiveStagedCleanupGate({
    backupDir,
    candidateVersionId: input.candidateVersionId,
    plan,
    workspaceRoot,
  });
  assertNoUnresolvedTranslationRepair(backupDir);
  const safetyChecks = buildReleaseArtifactSafetyChecks({
    backupDir,
    cwd: workspaceRoot,
  });
  const failedChecks = safetyChecks.filter((check) => check.status !== "pass");
  if (failedChecks.length > 0) {
    throw new Error(
      `Candidate-active staged cleanup requires fresh local gates: ${failedChecks
        .map((check) => check.name)
        .join(", ")}.`,
    );
  }
  const activeProbe = probeNativeWriteFreeze(
    false,
    release.currentRelease.targetCandidateVersionId,
  );
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const preflightEvidencePath = path.join(
    backupDir,
    "cloudflare",
    `staged-translation-d1-cleanup-preflight-${runId}.json`,
  );
  const artifacts = release.currentRelease.artifactEvidence;
  const preflight: RemoteRepairReleasePreflight = {
    runId,
    createdAt: startedAt.toISOString(),
    candidateVersionId: release.currentRelease.targetCandidateVersionId,
    // Once the candidate is active it is also the exact version restored after
    // the short native maintenance interval.
    serviceBaselineVersionId: release.currentRelease.targetCandidateVersionId,
    uploadEvidenceSha256: release.currentRelease.uploadEvidenceSha256,
    activeVersionId: release.currentRelease.targetCandidateVersionId,
    gitHead: release.currentRelease.git.head,
    gitUpstream: release.currentRelease.git.upstream,
    sourceFingerprint: artifacts.sourceFingerprint,
    workerSourceSha256: artifacts.workerSourceSha256,
    wranglerConfigSha256: artifacts.wranglerConfigSha256,
    assetManifest: artifacts.assetManifest,
    safetyChecks,
    candidateProbe: activeProbe,
    workerDeployReportPath: release.upload.path,
    workerDeployEvidence: {
      createdAt: release.upload.value.createdAt,
      backupDir,
      candidateVersionId: release.currentRelease.targetCandidateVersionId,
      sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
      sourceFingerprintFileCount: artifacts.sourceFingerprint.fileCount,
      workerSourceSha256: artifacts.workerSourceSha256,
      wranglerConfigSha256: artifacts.wranglerConfigSha256,
      assetManifest: artifacts.assetManifest,
      activeDeploymentReadAt: startedAt.toISOString(),
    },
    evidencePath: preflightEvidencePath,
  };
  writePrivateJsonDurably(
    preflightEvidencePath,
    {
      kind: "staged-translation-d1-candidate-active-cleanup-preflight-v1",
      releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
      planSha256: stagedTranslationD1PlanSha256(plan),
      localAuthorizationSha256: sha256Canonical(localAuthorization),
      currentRelease: release.currentRelease,
      preflight,
    },
    { replace: false },
  );

  const operationId = stagedTranslationCleanupOperationId({
    candidateVersionId: release.currentRelease.targetCandidateVersionId,
    activationEvidenceSha256: release.activation.sha256,
    plan,
    localAuthorization,
    sourceFingerprint: artifacts.sourceFingerprint,
  });
  const usage =
    input.dailyUsage ?? paidExpeditedD1ObservedUsageFloor(startedAt);
  let budget: D1ReleaseBudgetReservationResult = reserveD1ReleaseBudget({
    backupDir,
    operationId,
    operation: "Candidate-active staged translation cleanup",
    candidateVersionId: release.currentRelease.targetCandidateVersionId,
    sourceFingerprint: {
      sha256: artifacts.sourceFingerprint.sha256,
      fileCount: artifacts.sourceFingerprint.fileCount,
    },
    phase: "maximum",
    rowsRead: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS,
    rowsWritten: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES,
    observedUsage: usage,
    admissionMode: D1_RELEASE_BUDGET_PAID_EXPEDITED_ADMISSION_MODE,
    now: startedAt,
  });
  if (budget.reservation.phase !== "maximum") {
    throw new Error(
      "Candidate-active staged cleanup reserved an invalid D1 budget phase.",
    );
  }
  const cleanupReadAttemptPath = stagedTranslationCleanupReadAttemptPath({
    backupDir,
    utcDay: budget.utcDay,
    operationId,
  });
  if (pathEntryExists(cleanupReadAttemptPath)) {
    throw new Error(
      "Candidate-active staged cleanup cannot reuse a prior D1-read attempt.",
    );
  }

  let exclusion: ProductionValidationExclusion | null = null;
  let maintenanceState: ProductionMaintenanceState | null = null;
  let maintenanceVersionId = "";
  let maintenanceActivated = false;
  let importAttempted = false;
  let importVerified = false;
  let importRowsRead = 0;
  let importRowsWritten = 0;
  let importBillingConfirmed = false;
  let preWriteEvidencePath = "";
  let readAttemptEvidencePath = "";
  let readAttemptEvidenceSha256 = "";
  let timeTravelBookmark = "";
  let preVerification: StagedTranslationD1VerificationReport | null = null;
  let postVerification: StagedTranslationD1VerificationReport | null = null;
  let sourceSyncSha256 = "";
  let sourceRowsVerified = 0;
  let sourceStringRowsVerified = 0;
  let sourceVerificationBilledRowsRead = 0;
  let atomicSqlSha256 = "";
  let operationError: unknown;
  let restoreError: unknown;
  try {
    assertNoLiveProductionValidationLock();
    exclusion = acquireProductionValidationExclusion({
      candidateVersionId: release.currentRelease.targetCandidateVersionId,
      sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
    });
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
    assertCandidateActiveStagedCleanupGate({
      backupDir,
      candidateVersionId: input.candidateVersionId,
      plan,
      workspaceRoot,
    });
    maintenanceVersionId = uploadNativeMaintenanceVersion(preflight);
    maintenanceState = {
      candidateVersionId: release.currentRelease.targetCandidateVersionId,
      lockRunId: exclusion.owner.runId,
      maintenanceVersionId,
      repairRunId: productionMaintenanceRepairRunId(runId),
      sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
      startedAt: startedAt.getTime(),
    };
    const persisted = createProductionMaintenanceState({
      exclusion,
      state: maintenanceState,
    });
    exclusion = persisted.exclusion;
    maintenanceState = persisted.state;
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
    assertCandidateActiveStagedCleanupGate({
      backupDir,
      candidateVersionId: input.candidateVersionId,
      plan,
      workspaceRoot,
    });
    deployPinnedWorkerVersion(
      maintenanceVersionId,
      "Native maintenance: candidate-active staged translation cleanup",
    );
    maintenanceActivated = true;
    const maintenanceProbe = probeNativeWriteFreeze(true, maintenanceVersionId);
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);

    const readAttempt = writeStagedTranslationCleanupReadAttempt({
      backupDir,
      operationId,
      budget,
      runId,
      candidateVersionId: release.currentRelease.targetCandidateVersionId,
      maintenanceVersionId,
      uploadEvidenceSha256: release.upload.sha256,
      activationEvidenceSha256: release.activation.sha256,
      planSha256: stagedTranslationD1PlanSha256(plan),
      localAuthorizationSha256: sha256Canonical(localAuthorization),
      sourceFingerprint: artifacts.sourceFingerprint,
      now: validClock(clock(), "candidate-active cleanup pre-read clock"),
    });
    readAttemptEvidencePath = readAttempt.path;
    readAttemptEvidenceSha256 = readAttempt.sha256;
    preVerification = verifyRemoteStagedTranslationD1({ plan });
    const sourceSync = buildSiteTranslationSourceSyncPlan(
      undefined,
      undefined,
      startedAt.getTime(),
    );
    sourceSyncSha256 = sourceSync.sha256;
    const atomicSql = buildAtomicSeoCtaRepairSql(sourceSync.sql, plan.sql);
    atomicSqlSha256 = sha256(atomicSql);
    const projectedWrites =
      sourceSync.projectedBilledRowWrites +
      plan.logicalUpsertWrites * stagedTranslationBilledWritesPerLogicalRow +
      preVerification.extraRows * stagedTranslationBilledWritesPerLogicalRow +
      256;
    if (
      !Number.isSafeInteger(projectedWrites) ||
      projectedWrites < 0 ||
      projectedWrites > STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES
    ) {
      throw new Error(
        "Candidate-active staged cleanup exceeds the cumulative D1 write ceiling.",
      );
    }
    const storageRows = stagedTranslationStorageRows(plan);
    const database = assertExactProductionD1StorageIdentity(
      readD1DatabaseStorageInfo(runWrangler),
    );
    const storageAdmission = buildExactStagedD1StorageAdmission({
      database,
      translationRows: storageRows,
      sourceEntries: buildSiteSourceStorageEntries(),
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
      backupDir,
      runId,
      candidateVersionId: release.currentRelease.targetCandidateVersionId,
      maintenanceVersionId,
      releasePreflightEvidencePath: preflightEvidencePath,
      bookmark: timeTravelBookmark,
      atomicSql,
      activeProbe: maintenanceProbe,
      projectedBilledRowReads: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS,
      projectedBilledRowWrites: projectedWrites,
      d1StorageAdmission: storageAdmission,
      d1ReleaseBudget: budget,
    });

    const livePlan = loadStagedTranslationD1Plan(workspaceRoot);
    if (
      stagedTranslationD1PlanSha256(livePlan) !==
        stagedTranslationD1PlanSha256(plan) ||
      livePlan.sqlSha256 !== plan.sqlSha256
    ) {
      throw new Error("Staged translation cleanup plan drifted before D1 import.");
    }
    assertRepairArtifactEvidenceUnchanged(preflight);
    budget = assertD1ReleaseBudgetReservation({
      ledgerPath: budget.ledgerPath,
      utcDay: budget.utcDay,
      operationId,
      candidateVersionId: release.currentRelease.targetCandidateVersionId,
      sourceFingerprint: {
        sha256: artifacts.sourceFingerprint.sha256,
        fileCount: artifacts.sourceFingerprint.fileCount,
      },
      phase: "maximum",
      rowsRead: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS,
      rowsWritten: STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES,
      now: validClock(clock(), "candidate-active cleanup pre-write ledger check"),
    });
    assertD1ReleaseBudgetUtcDay(
      budget.utcDay,
      validClock(clock(), "candidate-active cleanup pre-write UTC day"),
    );
    if (!exclusion) throw new Error("Staged cleanup lost its production exclusion.");
    exclusion = attestProductionValidationExclusion(exclusion);
    assertProductionValidationExclusionCommandWindow(exclusion);
    revalidateExactStagedD1StorageAdmission({
      initialDatabase: database,
      currentDatabase: readD1DatabaseStorageInfo(runWrangler),
      translationRows: storageRows,
      sourceEntries: buildSiteSourceStorageEntries(),
    });
    const sqlFile = writeTemporarySqlFile(
      atomicSql,
      "candidate-active-staged-translation-cleanup.sql",
    );
    const initialSql = attestTemporarySqlFile(sqlFile, atomicSql);
    let sqlRemoved = false;
    try {
      const immediatelyBefore = attestTemporarySqlFile(sqlFile, atomicSql);
      assertSameTemporarySqlFileAttestation(initialSql, immediatelyBefore);
      importAttempted = true;
      let importOutput: string | undefined;
      let transportError: unknown;
      try {
        importOutput = runBoundedMutationWrangler(
          [
            "d1",
            "execute",
            D1_DATABASE_NAME,
            "--remote",
            "--file",
            sqlFile,
            "--yes",
            "--json",
          ],
          { maxBuffer: 128 * 1024 * 1024 },
        );
      } catch (error) {
        transportError = error;
      }
      const immediatelyAfter = attestTemporarySqlFile(sqlFile, atomicSql);
      assertSameTemporarySqlFileAttestation(initialSql, immediatelyAfter);
      removeAttestedTemporarySqlFile(immediatelyAfter, atomicSql);
      sqlRemoved = true;
      if (importOutput !== undefined) {
        try {
          const billing = parseD1Billing(importOutput, {
            label: "candidate-active staged translation cleanup import",
            expectedResultSets: 1,
          });
          importRowsRead = billing.rowsRead;
          importRowsWritten = billing.rowsWritten;
          importBillingConfirmed = true;
        } catch (error) {
          transportError = error;
        }
      }
      postVerification = verifyRemoteStagedTranslationD1({ plan });
      if (!postVerification.ok) {
        throw new Error(
          "Candidate-active staged cleanup did not produce the exact symmetric D1 set.",
        );
      }
      const postSourceSnapshot = readRemoteSiteTranslationSourceSnapshot(
        runWrangler,
        { requireSingleAttempt: true },
      );
      const sourceVerification = verifyRequiredStagedSourceSnapshot(
        postSourceSnapshot.snapshot,
      );
      if (
        postSourceSnapshot.translationRowCount !== plan.counts.exactRows
      ) {
        throw new Error(
          "Candidate-active staged cleanup source readback observed the wrong translation row count.",
        );
      }
      sourceRowsVerified = sourceVerification.sourceRowsVerified;
      sourceStringRowsVerified = sourceVerification.sourceStringRowsVerified;
      sourceVerificationBilledRowsRead =
        postSourceSnapshot.billedRowReads;
      if (
        safeAdd(
          safeAdd(
            safeAdd(
              preVerification.billedRowsRead,
              postVerification.billedRowsRead,
            ),
            sourceVerificationBilledRowsRead,
          ),
          importRowsRead,
        ) >
          STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS ||
        safeAdd(importRowsWritten, 256) >
          STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES
      ) {
        throw new Error(
          "Candidate-active staged cleanup observed billing exceeded its retained maximum reservation.",
        );
      }
      assertD1ReleaseBudgetUtcDay(
        budget.utcDay,
        validClock(clock(), "candidate-active cleanup post-verification UTC day"),
      );
      if (transportError !== undefined && importOutput === undefined) {
        // Exact post-read is authoritative when Wrangler lost only its final
        // transport response.
        importRowsRead = 0;
        importRowsWritten = 0;
      }
      importVerified = true;
    } finally {
      if (!sqlRemoved) removeAttestedTemporarySqlFile(initialSql, atomicSql);
    }
  } catch (error) {
    operationError = error;
  } finally {
    let exclusionOwned = true;
    if (exclusion) {
      try {
        exclusion = attestProductionValidationExclusion(exclusion);
      } catch (error) {
        exclusionOwned = false;
        restoreError = error;
      }
    }
    if (
      maintenanceActivated &&
      exclusionOwned &&
      (!importAttempted || importVerified)
    ) {
      try {
        if (!exclusion || !maintenanceState) {
          throw new Error("Staged cleanup lost its maintenance ownership.");
        }
        assertProductionValidationExclusionCommandWindow(exclusion);
        deployPinnedWorkerVersion(
          release.currentRelease.targetCandidateVersionId,
          "Restore active candidate after staged translation cleanup",
        );
        probeNativeWriteFreeze(
          false,
          release.currentRelease.targetCandidateVersionId,
        );
        const cleared = clearProductionMaintenanceState({
          exclusion,
          state: maintenanceState,
        });
        exclusion = cleared.exclusion;
        maintenanceState = null;
      } catch (error) {
        restoreError = error;
      }
    } else if (
      !maintenanceActivated &&
      !importAttempted &&
      maintenanceState &&
      exclusionOwned
    ) {
      try {
        if (!exclusion) {
          throw new Error("Staged cleanup lost its pre-maintenance ownership.");
        }
        exclusion = attestProductionValidationExclusion(exclusion);
        assertProductionValidationExclusionCommandWindow(exclusion);
        probeNativeWriteFreeze(
          false,
          release.currentRelease.targetCandidateVersionId,
        );
        const cleared = clearProductionMaintenanceState({
          exclusion,
          state: maintenanceState,
        });
        exclusion = cleared.exclusion;
        maintenanceState = null;
      } catch (error) {
        restoreError = error;
      }
    }
    if (exclusion) {
      try {
        releaseProductionValidationExclusion(exclusion);
      } catch (error) {
        restoreError = restoreError
          ? new AggregateError([restoreError, error], "Staged cleanup restore failed.")
          : error;
      }
    }
  }
  if (operationError !== undefined || restoreError !== undefined) {
    throw new AggregateError(
      [operationError, restoreError].filter(
        (value): value is NonNullable<unknown> => value !== undefined,
      ),
      importAttempted && !importVerified
        ? "Candidate-active staged cleanup is indeterminate; native maintenance remains active for reviewed forward correction."
        : "Candidate-active staged cleanup failed before exact certification.",
    );
  }
  if (
    !preVerification ||
    !postVerification?.ok ||
    !preWriteEvidencePath ||
    !readAttemptEvidencePath ||
    !readAttemptEvidenceSha256 ||
    !timeTravelBookmark ||
    !maintenanceVersionId ||
    !sourceSyncSha256 ||
    !isPositiveSafeInteger(sourceRowsVerified) ||
    !isPositiveSafeInteger(sourceStringRowsVerified) ||
    !atomicSqlSha256
  ) {
    throw new Error("Candidate-active staged cleanup omitted required evidence.");
  }
  const finalRelease = assertCandidateActiveStagedCleanupReleaseBinding({
    backupDir,
    candidateVersionId: input.candidateVersionId,
    plan,
    workspaceRoot,
  });
  if (requireSoleActiveWorkerVersion() !== input.candidateVersionId) {
    throw new Error(
      "Candidate-active staged cleanup did not restore the exact candidate alone at 100%.",
    );
  }
  const completedAt = validClock(
    clock(),
    "candidate-active cleanup completion",
  );
  assertD1ReleaseBudgetUtcDay(budget.utcDay, completedAt);
  const evidence: StagedTranslationD1CleanupEvidence = Object.freeze({
    kind: STAGED_TRANSLATION_D1_CLEANUP_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: completedAt.toISOString(),
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    phase: "candidate-active-post-activation-cleanup",
    ok: true,
    runId,
    candidateVersionId: finalRelease.currentRelease.targetCandidateVersionId,
    activationEvidenceSha256: finalRelease.activation.sha256,
    uploadEvidenceSha256: finalRelease.upload.sha256,
    planSha256: stagedTranslationD1PlanSha256(plan),
    localAuthorizationSha256: sha256Canonical(localAuthorization),
    sourceSyncSha256,
    sourceSyncUpdatedAt: startedAt.getTime(),
    sourceRowsVerified,
    sourceStringRowsVerified,
    sourceVerificationBilledRowsRead,
    sourceVerificationSingleAttemptBillingConfirmed: true,
    atomicSqlSha256,
    exactRows: plan.counts.exactRows,
    rowSetSha256: plan.rowSetSha256,
    payloadCorpusSha256: plan.payloadCorpusSha256,
    removedExtraRows: preVerification.extraRows,
    remoteQueries:
      preVerification.remoteQueries + postVerification.remoteQueries + 1,
    billedRowsRead:
      preVerification.billedRowsRead +
      postVerification.billedRowsRead +
      sourceVerificationBilledRowsRead,
    importRowsRead,
    importRowsWritten,
    importBillingConfirmed,
    timeTravelBookmark,
    readAttemptEvidencePath,
    readAttemptEvidenceSha256,
    preWriteEvidencePath,
    maintenanceVersionId,
    candidateRestored: true,
    exactSymmetricDifference: true,
    exactPayloadBytesVerified: true,
  });
  writePrivateJsonDurably(cleanupEvidencePath, evidence, { replace: false });
  resolveUnresolvedTranslationRepair({
    backupDir,
    evidencePath: preWriteEvidencePath,
    candidateVersionId: release.currentRelease.targetCandidateVersionId,
    maintenanceVersionId,
  });
  assertNoUnresolvedTranslationRepair(backupDir);
  const storedEvidence = parseCleanupEvidence(
    readPrivateJsonNoFollow(cleanupEvidencePath, maximumPlanEvidenceBytes),
  );
  if (stableStringify(storedEvidence) !== stableStringify(evidence)) {
    throw new Error("Candidate-active staged cleanup evidence changed after write.");
  }
  const storedSourceSync = buildSiteTranslationSourceSyncPlan(
    undefined,
    undefined,
    storedEvidence.sourceSyncUpdatedAt,
  );
  validateStagedCleanupPreWriteEvidence({
    backupDir,
    evidence: storedEvidence,
    expectedAtomicSql: buildAtomicSeoCtaRepairSql(
      storedSourceSync.sql,
      plan.sql,
    ),
    expectedSourceSync: storedSourceSync,
    localAuthorization,
    plan,
    release: finalRelease,
  });
  validateStagedCleanupResolvedEvidence({
    backupDir,
    evidence: storedEvidence,
  });
  return storedEvidence;
}

export function stagedTranslationD1LocalAuthorizationPath(
  backupDir: string,
  plan: StagedTranslationD1Plan,
) {
  return path.join(
    path.resolve(backupDir),
    "cloudflare",
    `staged-translation-d1-local-authorization-${stagedTranslationD1PlanSha256(plan)}.json`,
  );
}

function stagedTranslationD1CleanupEvidencePath(backupDir: string) {
  return path.join(
    path.resolve(backupDir),
    "cloudflare",
    "staged-translation-d1-cleanup-attestation.json",
  );
}

export type StagedTranslationD1CleanupProofBinding = Readonly<{
  runId: string;
  cleanupEvidenceSha256: string;
  preWriteEvidenceSha256: string;
  resolvedEvidenceSha256: string;
}>;

export function stagedTranslationD1CleanupProofBinding(input: {
  backupDir: string;
  evidence: StagedTranslationD1CleanupEvidence;
}): StagedTranslationD1CleanupProofBinding {
  const backupDir = path.resolve(input.backupDir);
  const workspaceRoot = path.resolve(process.cwd());
  assertNoUnresolvedTranslationRepair(backupDir);
  const stored = parseCleanupEvidence(
    readPrivateJsonNoFollow(
      stagedTranslationD1CleanupEvidencePath(backupDir),
      maximumPlanEvidenceBytes,
    ),
  );
  if (stableStringify(stored) !== stableStringify(input.evidence)) {
    throw new Error("Staged cleanup proof binding received different cleanup evidence.");
  }
  const validated = readAndValidateCandidateActiveStagedTranslationD1Cleanup({
    backupDir,
    candidateVersionId: stored.candidateVersionId,
    workspaceRoot,
    recovery: true,
  });
  if (stableStringify(validated) !== stableStringify(stored)) {
    throw new Error(
      "Staged cleanup proof binding did not validate the exact stored cleanup evidence.",
    );
  }
  const plan = loadStagedTranslationD1Plan(workspaceRoot);
  const localAuthorization =
    readCanonicalStagedTranslationD1LocalAuthorization({
      authorizationPath: stagedTranslationD1LocalAuthorizationPath(
        backupDir,
        plan,
      ),
      backupDir,
      plan,
    });
  const release = assertCandidateActiveStagedCleanupReleaseBinding({
    backupDir,
    candidateVersionId: stored.candidateVersionId,
    plan,
    workspaceRoot,
  });
  validateStagedTranslationCleanupReadAttempt({
    backupDir,
    evidence: stored,
    plan,
    localAuthorization,
    release,
  });
  const expectedSourceSync = buildSiteTranslationSourceSyncPlan(
    undefined,
    undefined,
    stored.sourceSyncUpdatedAt,
  );
  const expectedAtomicSql = buildAtomicSeoCtaRepairSql(
    expectedSourceSync.sql,
    plan.sql,
  );
  const preWriteValue = readPrivateJsonNoFollow(
    stored.preWriteEvidencePath,
    4 * 1024 * 1024,
  );
  const preWrite = validateStagedCleanupPreWriteEvidence({
    backupDir,
    evidence: stored,
    expectedAtomicSql,
    expectedSourceSync,
    localAuthorization,
    plan,
    release,
    preWriteValue,
  });
  const resolvedPath = path.join(
    backupDir,
    "cloudflare",
    `d1-translation-repair-resolved-${stored.runId}.json`,
  );
  const resolvedValue = readPrivateJsonNoFollow(
    resolvedPath,
    maximumPlanEvidenceBytes,
  );
  const resolved = validateStagedCleanupResolvedEvidence({
    backupDir,
    evidence: stored,
    resolvedValue,
  });
  return Object.freeze({
    runId: stored.runId,
    cleanupEvidenceSha256: sha256Canonical(stored),
    preWriteEvidenceSha256: sha256Canonical(preWrite),
    resolvedEvidenceSha256: sha256Canonical(resolved),
  });
}

function validateStagedTranslationCleanupReadAttempt(input: {
  backupDir: string;
  evidence: StagedTranslationD1CleanupEvidence;
  plan: StagedTranslationD1Plan;
  localAuthorization: StagedTranslationD1LocalAuthorization;
  release: ReturnType<typeof assertCandidateActiveStagedCleanupReleaseBinding>;
}) {
  const attempt = parseStagedTranslationCleanupReadAttempt(
    readPrivateJsonNoFollow(
      input.evidence.readAttemptEvidencePath,
      maximumPlanEvidenceBytes,
    ),
  );
  const artifacts = input.release.currentRelease.artifactEvidence;
  const operationId = stagedTranslationCleanupOperationId({
    candidateVersionId: input.release.currentRelease.targetCandidateVersionId,
    activationEvidenceSha256: input.release.activation.sha256,
    plan: input.plan,
    localAuthorization: input.localAuthorization,
    sourceFingerprint: artifacts.sourceFingerprint,
  });
  const expectedPath = stagedTranslationCleanupReadAttemptPath({
    backupDir: input.backupDir,
    utcDay: attempt.utcDay,
    operationId,
  });
  if (
    path.resolve(input.evidence.readAttemptEvidencePath) !== expectedPath ||
    input.evidence.readAttemptEvidenceSha256 !== sha256Canonical(attempt) ||
    attempt.operationId !== operationId ||
    attempt.ledgerPath !==
      d1ReleaseBudgetLedgerPath(input.backupDir, attempt.utcDay) ||
    attempt.runId !== input.evidence.runId ||
    attempt.candidateVersionId !== input.evidence.candidateVersionId ||
    attempt.maintenanceVersionId !== input.evidence.maintenanceVersionId ||
    attempt.uploadEvidenceSha256 !== input.release.upload.sha256 ||
    attempt.activationEvidenceSha256 !== input.release.activation.sha256 ||
    attempt.planSha256 !== stagedTranslationD1PlanSha256(input.plan) ||
    attempt.localAuthorizationSha256 !==
      sha256Canonical(input.localAuthorization) ||
    stableStringify(attempt.sourceFingerprint) !==
      stableStringify(compactReleaseSourceFingerprint(artifacts.sourceFingerprint)) ||
    Date.parse(attempt.createdAt) < input.evidence.sourceSyncUpdatedAt ||
    attempt.createdAt.slice(0, 10) !== input.evidence.createdAt.slice(0, 10) ||
    Date.parse(attempt.createdAt) > Date.parse(input.evidence.createdAt)
  ) {
    throw new Error(
      "Candidate-active staged cleanup read-attempt evidence is stale or mismatched.",
    );
  }
  return attempt;
}

export function readAndValidateCandidateActiveStagedTranslationD1Cleanup(input: {
  backupDir: string;
  candidateVersionId: string;
  workspaceRoot?: string;
  now?: Date;
  recovery?: boolean;
}) {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const backupDir = path.resolve(input.backupDir);
  const plan = loadStagedTranslationD1Plan(workspaceRoot);
  const localAuthorization =
    readCanonicalStagedTranslationD1LocalAuthorization({
      authorizationPath: stagedTranslationD1LocalAuthorizationPath(
        backupDir,
        plan,
      ),
      backupDir,
      plan,
    });
  const evidence = parseCleanupEvidence(
    readPrivateJsonNoFollow(
      stagedTranslationD1CleanupEvidencePath(backupDir),
      maximumPlanEvidenceBytes,
    ),
  );
  assertNoUnresolvedTranslationRepair(backupDir);
  const release = input.recovery
    ? assertCandidateActiveStagedCleanupReleaseBinding({
        backupDir,
        candidateVersionId: input.candidateVersionId,
        plan,
        workspaceRoot,
      })
    : assertCandidateActiveStagedCleanupGate({
        backupDir,
        candidateVersionId: input.candidateVersionId,
        plan,
        workspaceRoot,
      });
  const now = validClock(
    input.now ?? new Date(),
    "candidate-active staged cleanup validation clock",
  );
  const ageMs = now.getTime() - Date.parse(evidence.createdAt);
  const expectedSources = buildSiteSourceStorageEntries();
  const expectedSourceStringRows = expectedSources.reduce(
    (total, source) => total + Object.keys(source.sourceStrings).length,
    0,
  );
  const expectedSourceSync = buildSiteTranslationSourceSyncPlan(
    undefined,
    undefined,
    evidence.sourceSyncUpdatedAt,
  );
  const expectedAtomicSql = buildAtomicSeoCtaRepairSql(
    expectedSourceSync.sql,
    plan.sql,
  );
  const observedBilledRowsRead = safeAdd(
    evidence.billedRowsRead,
    evidence.importRowsRead,
  );
  const observedBilledRowsWrittenWithGuard = safeAdd(
    evidence.importRowsWritten,
    256,
  );
  if (
    ageMs < 0 ||
    (!input.recovery && ageMs > maximumCleanupEvidenceAgeMs) ||
    evidence.candidateVersionId !== input.candidateVersionId ||
    evidence.activationEvidenceSha256 !== release.activation.sha256 ||
    evidence.uploadEvidenceSha256 !== release.upload.sha256 ||
    evidence.planSha256 !== stagedTranslationD1PlanSha256(plan) ||
    evidence.localAuthorizationSha256 !==
      sha256Canonical(localAuthorization) ||
    evidence.sourceSyncSha256 !== expectedSourceSync.sha256 ||
    evidence.sourceRowsVerified !== expectedSources.length ||
    evidence.sourceStringRowsVerified !== expectedSourceStringRows ||
    evidence.remoteQueries !==
      (1 + buildVerificationChunks(plan.rows).length) * 2 + 1 ||
    evidence.billedRowsRead < evidence.sourceVerificationBilledRowsRead ||
    observedBilledRowsRead > STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS ||
    observedBilledRowsWrittenWithGuard >
      STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES ||
    (!evidence.importBillingConfirmed &&
      (evidence.importRowsRead !== 0 || evidence.importRowsWritten !== 0)) ||
    evidence.atomicSqlSha256 !== sha256(expectedAtomicSql) ||
    evidence.exactRows !== plan.counts.exactRows ||
    evidence.rowSetSha256 !== plan.rowSetSha256 ||
    evidence.payloadCorpusSha256 !== plan.payloadCorpusSha256
  ) {
    throw new Error(
      "Candidate-active staged cleanup evidence is stale or mismatched.",
    );
  }
  validateStagedTranslationCleanupReadAttempt({
    backupDir,
    evidence,
    plan,
    localAuthorization,
    release,
  });
  validateStagedCleanupPreWriteEvidence({
    backupDir,
    evidence,
    expectedAtomicSql,
    expectedSourceSync,
    localAuthorization,
    plan,
    release,
  });
  validateStagedCleanupResolvedEvidence({ backupDir, evidence });
  return evidence;
}

function assertCandidateActiveStagedCleanupGate(input: {
  backupDir: string;
  candidateVersionId: string;
  plan: StagedTranslationD1Plan;
  workspaceRoot?: string;
}) {
  const release = assertCandidateActiveStagedCleanupReleaseBinding(input);
  const activeVersionId = requireSoleActiveWorkerVersion();
  if (activeVersionId !== input.candidateVersionId) {
    throw new Error("Staged cleanup requires the exact candidate alone at 100% traffic.");
  }
  assertFreshHistoricalFresh0016FinalPreservation({
    backupDirectory: path.resolve(input.backupDir),
    cwd: path.resolve(input.workspaceRoot ?? process.cwd()),
    targetCandidateVersionId: release.currentRelease.targetCandidateVersionId,
    serviceBaselineVersionId: release.currentRelease.serviceBaselineVersionId,
    uploadEvidenceSha256: release.currentRelease.uploadEvidenceSha256,
    activationEvidenceSha256: release.activation.sha256,
  });
  assertFreshProductionVectorizeReadiness({
    backupDir: path.resolve(input.backupDir),
    currentRelease: release.currentRelease,
    requiredPhase: "candidate-active",
  });
  return release;
}

function assertCandidateActiveStagedCleanupReleaseBinding(input: {
  backupDir: string;
  candidateVersionId: string;
  plan: StagedTranslationD1Plan;
  workspaceRoot?: string;
}) {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
  const backupDir = path.resolve(input.backupDir);
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDir),
  );
  const activation = readWorkerCandidateActivationEvidence(
    workerCandidateActivationEvidencePath(backupDir),
  );
  if (
    upload.value.targetCandidateVersionId !== input.candidateVersionId ||
    activation.value.targetCandidateVersionId !== input.candidateVersionId
  ) {
    throw new Error("Staged cleanup candidate differs from upload or activation evidence.");
  }
  const git = assertGitReleaseIdentity({ cwd: workspaceRoot });
  const artifacts = buildWorkerDeployArtifactEvidence(workspaceRoot);
  const currentRelease: ReleaseSequenceCurrentRelease = {
    phase: "candidate-active",
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    phaseEvidenceSha256: activation.sha256,
    phaseEvidenceCreatedAt: activation.value.createdAt,
    soleServingVersionId: input.candidateVersionId,
    git,
    artifactEvidence: artifacts,
  };
  assertReleaseSequenceCurrentReleaseBinding({
    backupDir,
    currentRelease,
  });
  const translation = assertProductionTranslationReconciliationReleaseBinding({
    backupDir,
    currentRelease,
  });
  if (
    translation.kind !== "production-staged-translation-reconciliation-v1" ||
    translation.method !== "read-only-drift" ||
    translation.verification?.repairApplied !== false ||
    stableStringify(translation.stagedRelease) !==
      stableStringify(input.plan.stagedRelease) ||
    translation.stagedRelease.d1Corpus.preActivationMutationAllowed !== false ||
    translation.stagedRelease.d1Corpus.postActivationExactCleanupRequired !== true
  ) {
    throw new Error(
      "Candidate-active cleanup requires the exact preactivation staged plan-ready evidence.",
    );
  }
  assertProductionTopicReconciliationReleaseBinding({
    backupDir,
    currentRelease,
  });
  return { currentRelease, upload, activation, translation } as const;
}

function assertExactStagedRows(
  corpus: StagedTranslationFallbackD1SiteCorpus,
  rows: readonly StagedTranslationD1Row[],
) {
  const inventory = corpus.attestation.artifact.inventory;
  if (
    corpus.rows.length !== inventory.counts.cleanPhysicalSitePacks ||
    corpus.mainAppRows.length !== inventory.counts.staticMainAppPacks ||
    rows.length !== corpus.rows.length + corpus.mainAppRows.length ||
    corpus.rows.length !== CURRENT_FALLBACK_TRANSLATION_SITE_ROWS ||
    corpus.mainAppRows.length !== CURRENT_FALLBACK_TRANSLATION_MAIN_APP_ROWS ||
    rows.length !== CURRENT_FALLBACK_TRANSLATION_EXACT_ROWS ||
    inventory.pendingLedger.entries.length !==
      inventory.pendingLedger.missing + inventory.pendingLedger.stale
  ) {
    throw new Error("Staged translation D1 row accounting is inconsistent.");
  }
  assertStandaloneExactRows(rows);
  const pending = new Set(
    inventory.pendingLedger.entries.map(
      ([locale, namespace]) => `${locale}\u0000${namespace}`,
    ),
  );
  if (
    corpus.rows.some((row) => pending.has(`${row.locale}\u0000${row.namespace}`))
  ) {
    throw new Error("Deferred translation identity entered the staged D1 corpus.");
  }
}

function assertStandaloneExactRows(rows: readonly StagedTranslationD1Row[]) {
  if (rows.length === 0) throw new Error("Staged translation D1 corpus is empty.");
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      !row.namespace ||
      !row.language ||
      !/^[a-f0-9]{64}$/.test(row.sourceHash) ||
      !row.model ||
      !/^[a-f0-9]{64}$/.test(row.sourceFileSha256)
    ) {
      throw new Error("Staged translation D1 row metadata is malformed.");
    }
    const identity = rowIdentity(row);
    if (seen.has(identity)) {
      throw new Error(`Staged translation D1 corpus duplicates ${identity}.`);
    }
    seen.add(identity);
    const payload = canonicalPayload(row.payload);
    if (
      Object.keys(row.payload).length === 0 ||
      Object.values(row.payload).some(
        (value) =>
          typeof value !== "string" ||
          !value.trim() ||
          value !== value.normalize("NFC"),
      )
    ) {
      throw new Error(`Staged translation payload is unsafe for ${identity}.`);
    }
    assertD1TranslationPayloadSize(
      Buffer.byteLength(payload, "utf8"),
      identity,
    );
  }
  const sorted = [...rows].sort(compareRows);
  if (rows.some((row, index) => row !== sorted[index])) {
    throw new Error("Staged translation D1 rows must be in canonical order.");
  }
}

function verifyRequiredStagedSourceSnapshot(
  snapshot: SiteTranslationSourceSnapshot,
) {
  const expected = buildSiteSourceStorageEntries();
  let sourceStringRowsVerified = 0;
  for (const source of expected) {
    if (snapshot.sources[source.namespace] !== source.sourceHash) {
      throw new Error(
        `Staged source readback differs for ${source.namespace}.`,
      );
    }
    const actualStrings = snapshot.sourceStrings[source.namespace] ?? {};
    for (const [key, value] of Object.entries(source.sourceStrings)) {
      if (actualStrings[key] !== value) {
        throw new Error(
          `Staged source-string readback differs for ${source.namespace}/${key}.`,
        );
      }
      sourceStringRowsVerified += 1;
    }
  }
  if (expected.length === 0 || sourceStringRowsVerified === 0) {
    throw new Error("Staged source readback did not verify a non-empty catalog.");
  }
  return {
    sourceRowsVerified: expected.length,
    sourceStringRowsVerified,
  } as const;
}

function toSiteD1Row(
  row: StagedTranslationFallbackD1SiteRow,
): StagedTranslationD1Row {
  return Object.freeze({
    namespace: row.namespace,
    language: row.language,
    sourceHash: row.sourceHash,
    payload: row.payload,
    model: row.model,
    sourceRelativePath: `translations/curated/${row.relativePath}`,
    sourceFileSha256: row.fileSha256,
    partition: "site",
  });
}

function toMainAppD1Row(
  row: StagedTranslationFallbackD1MainAppRow,
): StagedTranslationD1Row {
  return Object.freeze({
    namespace: row.namespace,
    language: row.language,
    sourceHash: row.sourceHash,
    payload: row.payload,
    model: row.model,
    sourceRelativePath: `translations/static-main-app/${row.relativePath}`,
    sourceFileSha256: row.fileSha256,
    partition: "main-app",
  });
}

function buildDeleteNonReleaseRowsSql(rows: readonly StagedTranslationD1Row[]) {
  return [
    buildExpectedIdentityCte(rows),
    "DELETE FROM app_translations",
    "WHERE NOT EXISTS (",
    "  SELECT 1 FROM expected_staged AS expected",
    "  WHERE expected.namespace = app_translations.namespace",
    "    AND expected.language = app_translations.language",
    ");",
  ].join("\n");
}

function buildResetRowSql(row: StagedTranslationD1Row) {
  const now = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
  return [
    "INSERT INTO app_translations",
    "  (namespace, language, source_hash, payload, model, created_at, updated_at)",
    "VALUES",
    `  (${sqlString(row.namespace)}, ${sqlString(row.language)}, ${sqlString(row.sourceHash)},`,
    `   json('{}'), ${sqlString(row.model)}, ${now}, ${now})`,
    "ON CONFLICT(namespace, language) DO UPDATE SET",
    "  source_hash = excluded.source_hash,",
    "  payload = excluded.payload,",
    "  model = excluded.model,",
    "  updated_at = excluded.updated_at;",
  ].join("\n");
}

function buildPayloadPatchSql(row: StagedTranslationD1Row) {
  const keys = Object.keys(row.payload).sort(compareCodePoints);
  const statements: string[] = [];
  let fragments: string[] = [];
  const flush = () => {
    if (fragments.length === 0) return;
    const json = `{${fragments.join(",")}}`;
    const statement = [
      "UPDATE app_translations",
      `SET payload = json_patch(payload, json(${sqlString(json)}))`,
      `WHERE namespace = ${sqlString(row.namespace)}`,
      `  AND language = ${sqlString(row.language)};`,
    ].join("\n");
    if (Buffer.byteLength(statement, "utf8") > patchStatementTargetBytes) {
      throw new Error(`Staged translation patch is oversized for ${rowIdentity(row)}.`);
    }
    statements.push(statement);
    fragments = [];
  };
  for (const key of keys) {
    const fragment = `${JSON.stringify(key)}:${JSON.stringify(row.payload[key])}`;
    const candidate = [...fragments, fragment];
    const candidateJson = `{${candidate.join(",")}}`;
    const estimated = Buffer.byteLength(candidateJson.replaceAll("'", "''"), "utf8") + 512;
    if (estimated > patchStatementTargetBytes && fragments.length > 0) flush();
    fragments.push(fragment);
    if (Buffer.byteLength(`{${fragment}}`.replaceAll("'", "''"), "utf8") + 512 > patchStatementTargetBytes) {
      throw new Error(`Staged translation field is oversized for ${rowIdentity(row)}/${key}.`);
    }
  }
  flush();
  return statements;
}

function buildExactPartitionGuardSql(rows: readonly StagedTranslationD1Row[]) {
  return [
    buildExpectedIdentityCte(rows),
    "SELECT CASE",
    `  WHEN (SELECT COUNT(*) FROM app_translations) = ${rows.length}`,
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM expected_staged AS expected",
    "      WHERE NOT EXISTS (",
    "        SELECT 1 FROM app_translations AS target",
    "        WHERE target.namespace = expected.namespace",
    "          AND target.language = expected.language",
    "      )",
    "    )",
    "    AND NOT EXISTS (",
    "      SELECT 1 FROM app_translations AS target",
    "      WHERE NOT EXISTS (",
    "        SELECT 1 FROM expected_staged AS expected",
    "        WHERE expected.namespace = target.namespace",
    "          AND expected.language = target.language",
    "      )",
    "    )",
    "  THEN json('{}')",
    "  ELSE json('staged-translation-exact-partition-guard-failed')",
    "END AS staged_translation_exact_partition_guard;",
  ].join("\n");
}

function buildExpectedIdentityCte(rows: readonly StagedTranslationD1Row[]) {
  return [
    "WITH expected_staged(namespace, language) AS (",
    `  VALUES ${rows
      .map((row) => `(${sqlString(row.namespace)}, ${sqlString(row.language)})`)
      .join(",\n    ")}`,
    ")",
  ].join("\n");
}

function buildStagedTranslationSummarySql(rows: readonly StagedTranslationD1Row[]) {
  const sql = [
    buildExpectedIdentityCte(rows),
    ", expected_presence AS (",
    "  SELECT COUNT(*) AS present_rows",
    "  FROM expected_staged AS expected",
    "  WHERE EXISTS (SELECT 1 FROM app_translations AS target",
    "    WHERE target.namespace = expected.namespace",
    "      AND target.language = expected.language)",
    ")",
    "SELECT",
    "  (SELECT COUNT(*) FROM app_translations) AS observed_rows,",
    "  (SELECT present_rows FROM expected_presence) AS present_rows,",
    "  (SELECT COUNT(*) FROM (",
    "     SELECT namespace, language FROM app_translations",
    "     GROUP BY namespace, language HAVING COUNT(*) > 1",
    "   )) AS duplicate_rows;",
  ].join("\n");
  assertD1SqlStatementSize(sql);
  return sql;
}

function buildVerificationChunks(rows: readonly StagedTranslationD1Row[]) {
  const chunks: Array<{
    rows: readonly StagedTranslationD1Row[];
    sql: string;
    maxBufferBytes: number;
  }> = [];
  let pending: StagedTranslationD1Row[] = [];
  let payloadBytes = 0;
  const flush = () => {
    if (pending.length === 0) return;
    const exactRows = Object.freeze([...pending]);
    const sql = [
      buildExpectedIdentityCte(exactRows),
      "SELECT target.namespace, target.language, target.source_hash, target.payload, target.model",
      "FROM expected_staged AS expected",
      "JOIN app_translations AS target",
      "  ON target.namespace = expected.namespace",
      " AND target.language = expected.language",
      "ORDER BY target.namespace, target.language;",
    ].join("\n");
    assertD1SqlStatementSize(sql);
    chunks.push({
      rows: exactRows,
      sql,
      maxBufferBytes: Math.min(
        16 * 1024 * 1024,
        Math.max(1024 * 1024, payloadBytes * 3 + 64 * 1024),
      ),
    });
    pending = [];
    payloadBytes = 0;
  };
  for (const row of rows) {
    const bytes = Buffer.byteLength(canonicalPayload(row.payload), "utf8");
    if (
      pending.length > 0 &&
      (pending.length >= verificationMaximumRowsPerQuery ||
        payloadBytes + bytes > verificationTargetPayloadBytes)
    ) {
      flush();
    }
    pending.push(row);
    payloadBytes += bytes;
  }
  flush();
  if (
    chunks.length === 0 ||
    chunks.reduce((total, chunk) => total + chunk.rows.length, 0) !== rows.length
  ) {
    throw new Error("Staged translation verification chunk plan is incomplete.");
  }
  return chunks;
}

function verifyPayloadRows(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: readonly StagedTranslationD1Row[],
) {
  if (actualRows.length !== expectedRows.length) {
    throw new Error("Staged translation payload query returned the wrong row count.");
  }
  const expected = new Map(expectedRows.map((row) => [rowIdentity(row), row]));
  for (const actual of actualRows) {
    const namespace = typeof actual.namespace === "string" ? actual.namespace : "";
    const language = typeof actual.language === "string" ? actual.language : "";
    const row = expected.get(`${namespace}\u0000${language}`);
    if (
      !row ||
      actual.source_hash !== row.sourceHash ||
      actual.model !== row.model ||
      typeof actual.payload !== "string" ||
      actual.payload !== canonicalPayload(row.payload)
    ) {
      throw new Error("Staged translation payload or metadata mismatch.");
    }
    expected.delete(rowIdentity(row));
  }
  if (expected.size !== 0) {
    throw new Error("Staged translation payload query omitted expected rows.");
  }
  return actualRows.length;
}

function extractD1ResultSets(output: string, expected: number) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed) || parsed.length !== expected) {
    throw new Error("Staged translation D1 query returned the wrong result-set count.");
  }
  return parsed.map((entry) => {
    if (!isRecord(entry) || entry.success !== true || !Array.isArray(entry.results)) {
      throw new Error("Staged translation D1 query returned malformed results.");
    }
    return entry.results.map((row) => {
      if (!isRecord(row)) throw new Error("Staged translation D1 row is malformed.");
      return row;
    });
  });
}

function parseJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first < 0 || last <= first) {
      throw new Error("Staged translation Wrangler output is not JSON.");
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function parseResumeEvidence(value: unknown): StagedTranslationD1ResumeEvidence {
  if (!isRecord(value)) throw new Error("Staged translation resume evidence is malformed.");
  const expectedKeys = [
    "authority",
    "canDeploy",
    "canReadProduction",
    "canWriteProduction",
    "createdAt",
    "exactRows",
    "kind",
    "payloadCorpusSha256",
    "planSha256",
    "releaseMode",
    "rowSetSha256",
    "schemaVersion",
    "sqlBytes",
    "sqlSha256",
    "stagedAttestationFileSha256",
    "stagedAttestationSha256",
  ].sort(compareCodePoints);
  if (
    stableStringify(Object.keys(value).sort(compareCodePoints)) !==
      stableStringify(expectedKeys) ||
    value.kind !== STAGED_TRANSLATION_D1_RESUME_KIND ||
    value.schemaVersion !== 1 ||
    value.releaseMode !== STAGED_TRANSLATION_D1_RELEASE_MODE ||
    value.authority !== "local-plan-resume-only" ||
    value.canReadProduction !== false ||
    value.canWriteProduction !== false ||
    value.canDeploy !== false ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isSha256(value.planSha256) ||
    !isSha256(value.stagedAttestationFileSha256) ||
    !isSha256(value.stagedAttestationSha256) ||
    !isSha256(value.rowSetSha256) ||
    !isSha256(value.payloadCorpusSha256) ||
    !isSha256(value.sqlSha256) ||
    !isPositiveSafeInteger(value.sqlBytes) ||
    !isPositiveSafeInteger(value.exactRows)
  ) {
    throw new Error("Staged translation resume evidence has the wrong contract.");
  }
  return value as StagedTranslationD1ResumeEvidence;
}

function parseLocalAuthorization(
  value: unknown,
): StagedTranslationD1LocalAuthorization {
  if (!isRecord(value)) {
    throw new Error("Staged translation D1 local authorization is malformed.");
  }
  const expectedKeys = [
    "authority",
    "canDeploy",
    "canReadProduction",
    "canWriteProduction",
    "createdAt",
    "exactRows",
    "grantsDeploymentByItself",
    "grantsProductionReadByItself",
    "grantsProductionWriteByItself",
    "kind",
    "payloadCorpusSha256",
    "planSha256",
    "releaseMode",
    "rowSetSha256",
    "satisfiesLocalStagedReconciliationInput",
    "schemaVersion",
    "sqlSha256",
    "stagedAttestationFileSha256",
    "stagedAttestationSha256",
  ].sort(compareCodePoints);
  if (
    stableStringify(Object.keys(value).sort(compareCodePoints)) !==
      stableStringify(expectedKeys) ||
    value.kind !== STAGED_TRANSLATION_D1_LOCAL_AUTHORIZATION_KIND ||
    value.schemaVersion !== 1 ||
    value.releaseMode !== STAGED_TRANSLATION_D1_RELEASE_MODE ||
    value.authority !== "local-candidate-input-only" ||
    value.satisfiesLocalStagedReconciliationInput !== true ||
    value.grantsProductionReadByItself !== false ||
    value.grantsProductionWriteByItself !== false ||
    value.grantsDeploymentByItself !== false ||
    value.canReadProduction !== false ||
    value.canWriteProduction !== false ||
    value.canDeploy !== false ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isSha256(value.planSha256) ||
    !isSha256(value.stagedAttestationFileSha256) ||
    !isSha256(value.stagedAttestationSha256) ||
    !isSha256(value.rowSetSha256) ||
    !isSha256(value.payloadCorpusSha256) ||
    !isSha256(value.sqlSha256) ||
    !isPositiveSafeInteger(value.exactRows)
  ) {
    throw new Error(
      "Staged translation D1 local authorization has the wrong non-authority contract.",
    );
  }
  return value as StagedTranslationD1LocalAuthorization;
}

function parseCleanupEvidence(value: unknown): StagedTranslationD1CleanupEvidence {
  if (!isRecord(value)) {
    throw new Error("Candidate-active staged cleanup evidence is malformed.");
  }
  const expectedKeys = [
    "activationEvidenceSha256",
    "atomicSqlSha256",
    "billedRowsRead",
    "candidateRestored",
    "candidateVersionId",
    "createdAt",
    "exactPayloadBytesVerified",
    "exactRows",
    "exactSymmetricDifference",
    "importRowsRead",
    "importRowsWritten",
    "importBillingConfirmed",
    "kind",
    "localAuthorizationSha256",
    "maintenanceVersionId",
    "ok",
    "payloadCorpusSha256",
    "phase",
    "planSha256",
    "preWriteEvidencePath",
    "readAttemptEvidencePath",
    "readAttemptEvidenceSha256",
    "releaseMode",
    "remoteQueries",
    "removedExtraRows",
    "rowSetSha256",
    "runId",
    "schemaVersion",
    "sourceSyncSha256",
    "sourceSyncUpdatedAt",
    "sourceRowsVerified",
    "sourceStringRowsVerified",
    "sourceVerificationBilledRowsRead",
    "sourceVerificationSingleAttemptBillingConfirmed",
    "timeTravelBookmark",
    "uploadEvidenceSha256",
  ].sort(compareCodePoints);
  if (
    stableStringify(Object.keys(value).sort(compareCodePoints)) !==
      stableStringify(expectedKeys) ||
    value.kind !== STAGED_TRANSLATION_D1_CLEANUP_EVIDENCE_KIND ||
    value.schemaVersion !== 1 ||
    value.releaseMode !== STAGED_TRANSLATION_D1_RELEASE_MODE ||
    value.phase !== "candidate-active-post-activation-cleanup" ||
    value.ok !== true ||
    value.candidateRestored !== true ||
    value.exactSymmetricDifference !== true ||
    value.exactPayloadBytesVerified !== true ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isStagedTranslationD1CleanupRunId(value.runId) ||
    !isWorkerVersion(value.candidateVersionId) ||
    !isSha256(value.activationEvidenceSha256) ||
    !isSha256(value.uploadEvidenceSha256) ||
    !isSha256(value.planSha256) ||
    !isSha256(value.localAuthorizationSha256) ||
    !isSha256(value.sourceSyncSha256) ||
    !isPositiveSafeInteger(value.sourceSyncUpdatedAt) ||
    !isPositiveSafeInteger(value.sourceRowsVerified) ||
    !isPositiveSafeInteger(value.sourceStringRowsVerified) ||
    !isNonNegativeSafeInteger(value.sourceVerificationBilledRowsRead) ||
    value.sourceVerificationSingleAttemptBillingConfirmed !== true ||
    !isSha256(value.atomicSqlSha256) ||
    !isSha256(value.rowSetSha256) ||
    !isSha256(value.payloadCorpusSha256) ||
    !isPositiveSafeInteger(value.exactRows) ||
    !isNonNegativeSafeInteger(value.removedExtraRows) ||
    !isPositiveSafeInteger(value.remoteQueries) ||
    !isNonNegativeSafeInteger(value.billedRowsRead) ||
    !isNonNegativeSafeInteger(value.importRowsRead) ||
    !isNonNegativeSafeInteger(value.importRowsWritten) ||
    typeof value.importBillingConfirmed !== "boolean" ||
    !isValidD1TimeTravelBookmark(value.timeTravelBookmark) ||
    typeof value.readAttemptEvidencePath !== "string" ||
    !path.isAbsolute(value.readAttemptEvidencePath) ||
    !isSha256(value.readAttemptEvidenceSha256) ||
    typeof value.preWriteEvidencePath !== "string" ||
    !path.isAbsolute(value.preWriteEvidencePath) ||
    !isWorkerVersion(value.maintenanceVersionId)
  ) {
    throw new Error(
      "Candidate-active staged cleanup evidence has the wrong exact contract.",
    );
  }
  return {
    kind: STAGED_TRANSLATION_D1_CLEANUP_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: value.createdAt,
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    phase: "candidate-active-post-activation-cleanup",
    ok: true,
    runId: value.runId,
    candidateVersionId: value.candidateVersionId,
    activationEvidenceSha256: value.activationEvidenceSha256,
    uploadEvidenceSha256: value.uploadEvidenceSha256,
    planSha256: value.planSha256,
    localAuthorizationSha256: value.localAuthorizationSha256,
    sourceSyncSha256: value.sourceSyncSha256,
    sourceSyncUpdatedAt: value.sourceSyncUpdatedAt,
    sourceRowsVerified: value.sourceRowsVerified,
    sourceStringRowsVerified: value.sourceStringRowsVerified,
    sourceVerificationBilledRowsRead:
      value.sourceVerificationBilledRowsRead,
    sourceVerificationSingleAttemptBillingConfirmed: true,
    atomicSqlSha256: value.atomicSqlSha256,
    exactRows: value.exactRows,
    rowSetSha256: value.rowSetSha256,
    payloadCorpusSha256: value.payloadCorpusSha256,
    removedExtraRows: value.removedExtraRows,
    remoteQueries: value.remoteQueries,
    billedRowsRead: value.billedRowsRead,
    importRowsRead: value.importRowsRead,
    importRowsWritten: value.importRowsWritten,
    importBillingConfirmed: value.importBillingConfirmed,
    timeTravelBookmark: value.timeTravelBookmark,
    readAttemptEvidencePath: value.readAttemptEvidencePath,
    readAttemptEvidenceSha256: value.readAttemptEvidenceSha256,
    preWriteEvidencePath: value.preWriteEvidencePath,
    maintenanceVersionId: value.maintenanceVersionId,
    candidateRestored: true,
    exactSymmetricDifference: true,
    exactPayloadBytesVerified: true,
  };
}

function validateStagedCleanupPreWriteEvidence(input: {
  backupDir: string;
  evidence: StagedTranslationD1CleanupEvidence;
  expectedAtomicSql: string;
  expectedSourceSync: ReturnType<typeof buildSiteTranslationSourceSyncPlan>;
  localAuthorization: StagedTranslationD1LocalAuthorization;
  plan: StagedTranslationD1Plan;
  release: Readonly<{
    currentRelease: ReleaseSequenceCurrentRelease;
    upload: Readonly<{ sha256: string }>;
    activation: Readonly<{ sha256: string }>;
  }>;
  preWriteValue?: unknown;
}) {
  const evidenceDirectory = path.join(input.backupDir, "cloudflare");
  const expectedPreWritePath = path.join(
    evidenceDirectory,
    `d1-translation-repair-prewrite-${input.evidence.runId}.json`,
  );
  if (input.evidence.preWriteEvidencePath !== expectedPreWritePath) {
    throw new Error(
      "Candidate-active staged cleanup pre-write evidence escaped its exact run path.",
    );
  }
  const preWrite =
    input.preWriteValue ??
    readPrivateJsonNoFollow(expectedPreWritePath, 4 * 1024 * 1024);
  if (
    !isRecord(preWrite) ||
    !hasExactKeys(preWrite, [
      "atomicSqlBytes",
      "atomicSqlSha256",
      "atomicSqlStatements",
      "automaticRestoreAllowed",
      "candidateVersionId",
      "createdAt",
      "d1ReleaseBudget",
      "d1StorageAdmission",
      "database",
      "destructiveRestoreSupported",
      "exportPerformed",
      "exportReason",
      "kind",
      "largestStatementBytes",
      "maintenance",
      "maintenanceVersionId",
      "projectedBilledRowReads",
      "projectedBilledRowWrites",
      "recoveryPreference",
      "releasePreflightEvidencePath",
      "runId",
      "timeTravelBookmark",
    ])
  ) {
    throw new Error("Candidate-active staged cleanup pre-write schema is malformed.");
  }
  if (
    input.evidence.removedExtraRows >
    Math.floor(
      STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES /
        stagedTranslationBilledWritesPerLogicalRow,
    )
  ) {
    throw new Error("Staged cleanup extra-row projection exceeds its write ceiling.");
  }
  const expectedProjectedWrites =
    input.expectedSourceSync.projectedBilledRowWrites +
    input.plan.logicalUpsertWrites * stagedTranslationBilledWritesPerLogicalRow +
    input.evidence.removedExtraRows * stagedTranslationBilledWritesPerLogicalRow +
    256;
  const preWriteCreatedAt = Date.parse(
    typeof preWrite.createdAt === "string" ? preWrite.createdAt : "",
  );
  const cleanupCreatedAt = Date.parse(input.evidence.createdAt);
  if (
    preWrite.kind !== "d1-translation-repair-prewrite-evidence" ||
    preWrite.runId !== input.evidence.runId ||
    !isCanonicalTimestamp(preWrite.createdAt) ||
    preWriteCreatedAt < input.evidence.sourceSyncUpdatedAt ||
    preWriteCreatedAt > cleanupCreatedAt ||
    preWrite.database !== D1_DATABASE_NAME ||
    preWrite.candidateVersionId !== input.evidence.candidateVersionId ||
    preWrite.maintenanceVersionId !== input.evidence.maintenanceVersionId ||
    preWrite.timeTravelBookmark !== input.evidence.timeTravelBookmark ||
    preWrite.automaticRestoreAllowed !== false ||
    preWrite.recoveryPreference !== "reviewed-forward-correction" ||
    preWrite.destructiveRestoreSupported !== false ||
    preWrite.exportPerformed !== false ||
    preWrite.exportReason !==
      "Cloudflare documents that D1 export blocks database requests." ||
    preWrite.atomicSqlSha256 !== input.evidence.atomicSqlSha256 ||
    preWrite.atomicSqlBytes !==
      Buffer.byteLength(input.expectedAtomicSql, "utf8") ||
    preWrite.atomicSqlStatements !==
      splitSqlStatements(input.expectedAtomicSql).length ||
    preWrite.largestStatementBytes !==
      largestSqlStatementBytes(input.expectedAtomicSql) ||
    preWrite.projectedBilledRowReads !==
      STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS ||
    preWrite.projectedBilledRowWrites !== expectedProjectedWrites
  ) {
    throw new Error(
      "Candidate-active staged cleanup pre-write evidence is mismatched.",
    );
  }
  if (expectedProjectedWrites > STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES) {
    throw new Error(
      "Candidate-active staged cleanup pre-write projection exceeds its write ceiling.",
    );
  }
  const maintenanceProbe = validateNativeMaintenanceProbe(
    preWrite.maintenance,
    true,
  );
  if (maintenanceProbe.versionId !== input.evidence.maintenanceVersionId) {
    throw new Error("Staged cleanup pre-write maintenance probe is mismatched.");
  }

  const expectedPreflightPath = path.join(
    evidenceDirectory,
    `staged-translation-d1-cleanup-preflight-${input.evidence.runId}.json`,
  );
  if (preWrite.releasePreflightEvidencePath !== expectedPreflightPath) {
    throw new Error("Staged cleanup pre-write release-preflight path is mismatched.");
  }
  const preflight = readPrivateJsonNoFollow(expectedPreflightPath, 4 * 1024 * 1024);
  if (
    !isRecord(preflight) ||
    !hasExactKeys(preflight, [
      "currentRelease",
      "kind",
      "localAuthorizationSha256",
      "planSha256",
      "preflight",
      "releaseMode",
    ]) ||
    preflight.kind !==
      "staged-translation-d1-candidate-active-cleanup-preflight-v1" ||
    preflight.releaseMode !== STAGED_TRANSLATION_D1_RELEASE_MODE ||
    preflight.planSha256 !== stagedTranslationD1PlanSha256(input.plan) ||
    preflight.localAuthorizationSha256 !==
      sha256Canonical(input.localAuthorization) ||
    stableStringify(preflight.currentRelease) !==
      stableStringify(input.release.currentRelease) ||
    !isRecord(preflight.preflight) ||
    !hasExactKeys(preflight.preflight, [
      "activeVersionId",
      "assetManifest",
      "candidateProbe",
      "candidateVersionId",
      "createdAt",
      "evidencePath",
      "gitHead",
      "gitUpstream",
      "runId",
      "safetyChecks",
      "serviceBaselineVersionId",
      "sourceFingerprint",
      "uploadEvidenceSha256",
      "workerDeployEvidence",
      "workerDeployReportPath",
      "workerSourceSha256",
      "wranglerConfigSha256",
    ])
  ) {
    throw new Error("Staged cleanup release-preflight evidence is malformed.");
  }
  const releasePreflight = preflight.preflight;
  const candidateProbe = validateNativeMaintenanceProbe(
    releasePreflight.candidateProbe,
    false,
  );
  if (
    releasePreflight.runId !== input.evidence.runId ||
    releasePreflight.createdAt !==
      new Date(input.evidence.sourceSyncUpdatedAt).toISOString() ||
    releasePreflight.evidencePath !== expectedPreflightPath ||
    releasePreflight.candidateVersionId !== input.evidence.candidateVersionId ||
    releasePreflight.serviceBaselineVersionId !== input.evidence.candidateVersionId ||
    releasePreflight.activeVersionId !== input.evidence.candidateVersionId ||
    releasePreflight.uploadEvidenceSha256 !== input.release.upload.sha256 ||
    releasePreflight.gitHead !== input.release.currentRelease.git.head ||
    releasePreflight.gitUpstream !== input.release.currentRelease.git.upstream ||
    stableStringify(releasePreflight.sourceFingerprint) !==
      stableStringify(
        input.release.currentRelease.artifactEvidence.sourceFingerprint,
      ) ||
    releasePreflight.workerSourceSha256 !==
      input.release.currentRelease.artifactEvidence.workerSourceSha256 ||
    releasePreflight.wranglerConfigSha256 !==
      input.release.currentRelease.artifactEvidence.wranglerConfigSha256 ||
    stableStringify(releasePreflight.assetManifest) !==
      stableStringify(
        input.release.currentRelease.artifactEvidence.assetManifest,
      ) ||
    candidateProbe.versionId !== input.evidence.candidateVersionId ||
    !Array.isArray(releasePreflight.safetyChecks) ||
    releasePreflight.safetyChecks.length === 0 ||
    releasePreflight.safetyChecks.some(
      (check) => !isRecord(check) || check.status !== "pass",
    )
  ) {
    throw new Error("Staged cleanup release-preflight binding is mismatched.");
  }

  if (!isRecord(preWrite.d1StorageAdmission)) {
    throw new Error("Staged cleanup storage admission is malformed.");
  }
  const storedAdmission = preWrite.d1StorageAdmission;
  if (
    !isNonNegativeSafeInteger(storedAdmission.currentDatabaseBytes) ||
    !isNonNegativeSafeInteger(storedAdmission.currentTableCount)
  ) {
    throw new Error("Staged cleanup storage admission counters are malformed.");
  }
  const expectedAdmission = buildExactStagedD1StorageAdmission({
    database: {
      databaseName: D1_DATABASE_NAME,
      databaseUuid: D1_DATABASE_ID,
      databaseSizeBytes: storedAdmission.currentDatabaseBytes,
      tableCount: storedAdmission.currentTableCount,
    },
    translationRows: stagedTranslationStorageRows(input.plan),
    sourceEntries: buildSiteSourceStorageEntries(),
  });
  if (stableStringify(storedAdmission) !== stableStringify(expectedAdmission)) {
    throw new Error("Staged cleanup storage admission is not canonical.");
  }

  if (
    !isRecord(preWrite.d1ReleaseBudget) ||
    !hasExactKeys(preWrite.d1ReleaseBudget, [
      "ledgerPath",
      "operationId",
      "phase",
      "revision",
      "rowsRead",
      "rowsWritten",
      "utcDay",
    ])
  ) {
    throw new Error("Staged cleanup D1 budget binding is malformed.");
  }
  const budget = preWrite.d1ReleaseBudget;
  const readAttempt = parseStagedTranslationCleanupReadAttempt(
    readPrivateJsonNoFollow(
      input.evidence.readAttemptEvidencePath,
      maximumPlanEvidenceBytes,
    ),
  );
  const operationId = stagedTranslationCleanupOperationId({
    candidateVersionId: input.evidence.candidateVersionId,
    activationEvidenceSha256: input.release.activation.sha256,
    plan: input.plan,
    localAuthorization: input.localAuthorization,
    sourceFingerprint:
      input.release.currentRelease.artifactEvidence.sourceFingerprint,
  });
  if (
    typeof budget.utcDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(budget.utcDay) ||
    budget.utcDay !== readAttempt.utcDay ||
    budget.utcDay !== input.evidence.createdAt.slice(0, 10) ||
    Date.parse(readAttempt.createdAt) < input.evidence.sourceSyncUpdatedAt ||
    Date.parse(readAttempt.createdAt) > preWriteCreatedAt ||
    typeof budget.ledgerPath !== "string" ||
    budget.ledgerPath !==
      d1ReleaseBudgetLedgerPath(input.backupDir, budget.utcDay) ||
    typeof budget.operationId !== "string" ||
    budget.operationId !== operationId ||
    !isPositiveSafeInteger(budget.revision) ||
    budget.phase !== "maximum" ||
    budget.rowsRead !== STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS ||
    budget.rowsWritten !== STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES
  ) {
    throw new Error("Staged cleanup D1 budget binding is mismatched.");
  }
  const ledger = readD1ReleaseBudgetLedger(budget.ledgerPath);
  const reservation = ledger.reservations.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (
    ledger.utcDay !== budget.utcDay ||
    ledger.revision < budget.revision ||
    !reservation ||
    reservation.candidateVersionId !== input.evidence.candidateVersionId ||
    reservation.phase !== "maximum" ||
    reservation.rowsRead !== STAGED_TRANSLATION_D1_MAX_BILLED_ROW_READS ||
    reservation.rowsWritten !== STAGED_TRANSLATION_D1_MAX_BILLED_ROW_WRITES ||
    reservation.sourceFingerprint.sha256 !==
      input.release.currentRelease.artifactEvidence.sourceFingerprint.sha256 ||
    reservation.sourceFingerprint.fileCount !==
      input.release.currentRelease.artifactEvidence.sourceFingerprint.fileCount
  ) {
    throw new Error("Staged cleanup D1 budget ledger is mismatched.");
  }
  return preWrite;
}

function validateStagedCleanupResolvedEvidence(input: {
  backupDir: string;
  evidence: StagedTranslationD1CleanupEvidence;
  resolvedValue?: unknown;
}) {
  const resolvedPath = path.join(
    input.backupDir,
    "cloudflare",
    `d1-translation-repair-resolved-${input.evidence.runId}.json`,
  );
  const resolved =
    input.resolvedValue ??
    readPrivateJsonNoFollow(resolvedPath, maximumPlanEvidenceBytes);
  if (
    !isRecord(resolved) ||
    !hasExactKeys(resolved, [
      "candidateVersionId",
      "createdAt",
      "evidencePath",
      "exactCandidateRestored",
      "exactVerificationPassed",
      "kind",
      "maintenanceVersionId",
      "runId",
    ]) ||
    resolved.kind !== "d1-translation-repair-resolved" ||
    resolved.runId !== input.evidence.runId ||
    !isCanonicalTimestamp(resolved.createdAt) ||
    Date.parse(resolved.createdAt) < Date.parse(input.evidence.createdAt) ||
    resolved.evidencePath !== input.evidence.preWriteEvidencePath ||
    resolved.candidateVersionId !== input.evidence.candidateVersionId ||
    resolved.maintenanceVersionId !== input.evidence.maintenanceVersionId ||
    resolved.exactVerificationPassed !== true ||
    resolved.exactCandidateRestored !== true
  ) {
    throw new Error("Staged cleanup resolved evidence is missing or mismatched.");
  }
  return resolved;
}

function resumeEvidenceForPlan(
  plan: StagedTranslationD1Plan,
  createdAt: string,
): StagedTranslationD1ResumeEvidence {
  return {
    kind: STAGED_TRANSLATION_D1_RESUME_KIND,
    schemaVersion: 1,
    createdAt,
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    planSha256: stagedTranslationD1PlanSha256(plan),
    stagedAttestationFileSha256: plan.stagedRelease.artifactFileSha256,
    stagedAttestationSha256: plan.stagedRelease.attestationSha256,
    rowSetSha256: plan.rowSetSha256,
    payloadCorpusSha256: plan.payloadCorpusSha256,
    sqlSha256: plan.sqlSha256,
    sqlBytes: plan.sqlBytes,
    exactRows: plan.counts.exactRows,
    authority: "local-plan-resume-only",
    canReadProduction: false,
    canWriteProduction: false,
    canDeploy: false,
  };
}

function localAuthorizationForPlan(
  plan: StagedTranslationD1Plan,
  createdAt: string,
): StagedTranslationD1LocalAuthorization {
  return {
    kind: STAGED_TRANSLATION_D1_LOCAL_AUTHORIZATION_KIND,
    schemaVersion: 1,
    createdAt,
    releaseMode: STAGED_TRANSLATION_D1_RELEASE_MODE,
    planSha256: stagedTranslationD1PlanSha256(plan),
    stagedAttestationFileSha256: plan.stagedRelease.artifactFileSha256,
    stagedAttestationSha256: plan.stagedRelease.attestationSha256,
    rowSetSha256: plan.rowSetSha256,
    payloadCorpusSha256: plan.payloadCorpusSha256,
    sqlSha256: plan.sqlSha256,
    exactRows: plan.counts.exactRows,
    authority: "local-candidate-input-only",
    satisfiesLocalStagedReconciliationInput: true,
    grantsProductionReadByItself: false,
    grantsProductionWriteByItself: false,
    grantsDeploymentByItself: false,
    canReadProduction: false,
    canWriteProduction: false,
    canDeploy: false,
  };
}

function countLogicalUpsertWrites(sql: string) {
  return splitSqlStatements(sql).filter((statement) =>
    /^(?:INSERT|UPDATE)\b/i.test(statement.trim()),
  ).length;
}

function requireSingleRow(
  rows: readonly Record<string, unknown>[] | undefined,
  label: string,
) {
  if (!rows || rows.length !== 1) throw new Error(`${label} returned the wrong row count.`);
  return rows[0]!;
}

function exactCounter(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is not a non-negative safe integer.`);
  }
  return value as number;
}

function safeAdd(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Staged translation billed-row accounting overflowed.");
  }
  return result;
}

function pathEntryExists(file: string) {
  const directory = path.dirname(file);
  return (
    existsSync(directory) &&
    readdirSync(directory).includes(path.basename(file))
  );
}

function canonicalPayload(payload: Readonly<Record<string, string>>) {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(payload).sort(compareCodePoints)) {
    sorted[key] = payload[key]!;
  }
  return JSON.stringify(sorted);
}

function rowIdentity(row: Pick<StagedTranslationD1Row, "namespace" | "language">) {
  return `${row.namespace}\u0000${row.language}`;
}

function compareRows(left: StagedTranslationD1Row, right: StagedTranslationD1Row) {
  return compareCodePoints(rowIdentity(left), rowIdentity(right));
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value: unknown) {
  return sha256(stableStringify(value));
}

function canonicalTimestamp(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("Timestamp is invalid.");
  return value.toISOString();
}

function validClock(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWorkerVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSourceFingerprintIdentity(value: unknown, label: string) {
  if (
    !isRecord(value) ||
    !isSha256(value.sha256) ||
    !isPositiveSafeInteger(value.fileCount)
  ) {
    throw new Error(`${label} is malformed.`);
  }
  return compactReleaseSourceFingerprint({
    sha256: value.sha256,
    fileCount: value.fileCount,
  });
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  return (
    stableStringify(Object.keys(value).sort(compareCodePoints)) ===
    stableStringify([...expectedKeys].sort(compareCodePoints))
  );
}

function requireArg(args: readonly string[], flag: string) {
  const indexes = args.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length !== 1) throw new Error(`${flag} must appear exactly once.`);
  const value = args[indexes[0]! + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function assertKnownCliArgs(args: readonly string[]) {
  const valueFlags = new Set([
    "--candidate-version",
    "--local-authorization",
    "--phase",
    "--release-mode",
    "--resume-plan",
  ]);
  const booleanFlags = new Set([
    "--apply-cleanup",
    "--confirm-native-write-freeze",
    "--confirm-production",
    "--prepare-local-authorization",
    "--remote",
    "--verify-only",
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!valueFlags.has(argument) && !booleanFlags.has(argument)) {
      throw new Error(`Unknown staged translation reconciliation argument: ${argument}.`);
    }
    if (seen.has(argument)) {
      throw new Error(`Duplicate staged translation reconciliation argument: ${argument}.`);
    }
    seen.add(argument);
    if (valueFlags.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires one value.`);
      }
      index += 1;
    }
  }
}

function assertOnlyCliFlags(
  args: readonly string[],
  allowedFlags: readonly string[],
) {
  const allowed = new Set(allowedFlags);
  const unexpected = args.find(
    (argument) => argument.startsWith("--") && !allowed.has(argument),
  );
  if (unexpected) {
    throw new Error(
      `Staged translation reconciliation mode does not accept ${unexpected}.`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  assertKnownCliArgs(args);
  const releaseMode = requireArg(args, "--release-mode");
  if (releaseMode !== STAGED_TRANSLATION_D1_RELEASE_MODE) {
    throw new Error(
      `This command accepts only --release-mode ${STAGED_TRANSLATION_D1_RELEASE_MODE}.`,
    );
  }
  const resumeIndex = args.indexOf("--resume-plan");
  const plan = resumeIndex >= 0
    ? resumeStagedTranslationD1Plan({
        evidencePath: requireArg(args, "--resume-plan"),
      })
    : loadStagedTranslationD1Plan();
  if (args.includes("--apply-cleanup")) {
    assertOnlyCliFlags(args, [
      "--apply-cleanup",
      "--candidate-version",
      "--confirm-native-write-freeze",
      "--confirm-production",
      "--local-authorization",
      "--phase",
      "--release-mode",
      "--remote",
      "--resume-plan",
    ]);
    if (
      !args.includes("--remote") ||
      args.includes("--verify-only") ||
      !args.includes("--confirm-production") ||
      !args.includes("--confirm-native-write-freeze") ||
      requireArg(args, "--phase") !== "candidate-active"
    ) {
      throw new Error(
        "Staged translation cleanup requires --apply-cleanup --remote --confirm-production --confirm-native-write-freeze --phase candidate-active.",
      );
    }
    const report = runCandidateActiveStagedTranslationD1Cleanup({
      backupDir: resolveBackupDir(),
      candidateVersionId: requireArg(args, "--candidate-version"),
      localAuthorizationPath: requireArg(args, "--local-authorization"),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (args.includes("--remote") || args.includes("--verify-only")) {
    assertOnlyCliFlags(args, [
      "--candidate-version",
      "--confirm-production",
      "--local-authorization",
      "--phase",
      "--release-mode",
      "--remote",
      "--resume-plan",
      "--verify-only",
    ]);
    if (
      !args.includes("--remote") ||
      !args.includes("--verify-only") ||
      !args.includes("--confirm-production") ||
      requireArg(args, "--phase") !== "uploaded-inactive"
    ) {
      throw new Error(
        "Staged translation production verification requires --remote --verify-only --confirm-production --phase uploaded-inactive.",
      );
    }
    const report = verifyOnlyStagedTranslationD1Release({
      backupDir: resolveBackupDir(),
      candidateVersionId: requireArg(args, "--candidate-version"),
      localAuthorizationPath: requireArg(args, "--local-authorization"),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (args.includes("--prepare-local-authorization")) {
    assertOnlyCliFlags(args, [
      "--prepare-local-authorization",
      "--release-mode",
      "--resume-plan",
    ]);
    const authorization = writeStagedTranslationD1LocalAuthorization({
      plan,
      backupDir: resolveBackupDir(),
    });
    const resume = writeStagedTranslationD1ResumeEvidence({
      plan,
      backupDir: resolveBackupDir(),
    });
    process.stdout.write(`${JSON.stringify({
      releaseMode: plan.releaseMode,
      planSha256: stagedTranslationD1PlanSha256(plan),
      localAuthorizationPath: authorization.file,
      resumeEvidencePath: resume.file,
      authorities: authorization.authorization,
      counts: plan.counts,
    }, null, 2)}\n`);
  } else {
    assertOnlyCliFlags(args, ["--release-mode", "--resume-plan"]);
    process.stdout.write(`${JSON.stringify({
      releaseMode: plan.releaseMode,
      planSha256: stagedTranslationD1PlanSha256(plan),
      counts: plan.counts,
      sqlSha256: plan.sqlSha256,
      sqlBytes: plan.sqlBytes,
      sqlStatements: plan.sqlStatements,
      largestSqlStatementBytes: plan.largestSqlStatementBytes,
    }, null, 2)}\n`);
  }
}
