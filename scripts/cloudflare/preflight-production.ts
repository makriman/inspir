import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  R2_BUCKET_NAME,
  RUNTIME_MUTABLE_TABLES,
  TABLE_ORDER,
  TIMESTAMP_PRECISION_RELATIVE_PATH,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  resolveBackupDir,
  runWrangler,
  type TableName,
} from "./migration-config";
import {
  D1_MAX_BOUND_PARAMETERS,
  D1_MAX_ROW_OR_VALUE_BYTES,
  D1_MAX_SQL_STATEMENT_BYTES,
  D1_SIZE_SAFETY_REPORT,
  type D1SizeSafetyReport,
} from "./d1-size-safety";
import { D1_TRANSFORM_FIDELITY_REPORT, type D1TransformFidelityReport } from "./d1-transform-fidelity";
import { SOURCE_TABLE_COVERAGE_REPORT, type SourceTableCoverageReport } from "./source-table-coverage";
import {
  buildD1ArtifactFingerprint,
  buildVectorizeArtifactFingerprint,
  type MigrationArtifactFingerprint,
  type VectorizeArtifactFingerprint,
} from "./migration-artifact-fingerprint";
import { buildRepoSourceFingerprint, fingerprintFile, type SourceFingerprint, type SourceFileFingerprint } from "./source-fingerprint";
import type { SourceSecretScanReport } from "./scan-source-secrets";
import type { RuntimeProviderScanReport } from "./scan-runtime-providers";
import type { BuildArtifactScanReport } from "./scan-build-artifacts";
import { hardenBackupPermissions, type BackupPermissionsReport } from "./harden-backup-permissions";
import {
  WRITE_FREEZE_REPORT,
  validateFinalWriteFreezeEvidenceReport,
  type WriteFreezeEvidenceReport,
} from "./write-freeze-evidence";
import { cloudflareApiTokenInstructions } from "./cloudflare-api-token";
import {
  DNS_PUBLIC_CUTOVER_REPORT,
  validatePublicDnsCutoverEvidence,
} from "./dns-cutover-evidence";
import {
  validatePostCutoverD1Report,
  validatePostCutoverVectorizeReport,
  validateProductionSmokeReport,
} from "./final-cutover-evidence-chain";
import {
  D1_PRE_IMPORT_BACKUP_REPORT,
  D1_PRE_IMPORT_BACKUP_SQL,
  checkD1PreImportBackup,
  type D1PreImportBackupReport,
} from "./d1-pre-import-backup";
import {
  VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
  VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
  checkVectorizePreImportBackup,
  type VectorizePreImportBackupReport,
} from "./vectorize-pre-import-backup";
import {
  isRetiredBuildToolingEnvKey,
  isRetiredSupabaseEnvKey,
  isRetiredTranslationBuildEnvKey,
  isRetiredVercelRuntimeEnvKey,
} from "./retired-provider-env";
import { FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT } from "./backup-frozen-cloudflare-production";

type CheckStatus = "pass" | "fail";

type Check = {
  name: string;
  status: CheckStatus;
  detail?: unknown;
};

type TableManifest = {
  table: TableName;
  rows: number;
  sha256: string;
  file: string;
};

type D1ValidationReport = {
  createdAt?: string;
  completedAt?: string;
  backupDir?: string;
  ok?: boolean;
  artifactFingerprint?: MigrationArtifactFingerprint;
  quickCheck?: Array<{ quick_check?: string }>;
  foreignKeyCheck?: unknown[];
  tables?: Array<{
    table: TableName;
    expectedRows: number;
    actualRows: number;
    expectedSha256?: string;
    actualSha256?: string;
    ok: boolean;
  }>;
  timestampPrecision?: {
    table?: string;
    expectedRows?: number;
    actualRows?: number;
    expectedSha256?: string;
    actualSha256?: string;
    ok?: boolean;
  };
  mismatchedSourceHashes?: unknown[];
};

type D1ImportRunReport = {
  createdAt?: string;
  completedAt?: string;
  backupDir?: string;
  ok?: boolean;
  resetSkipped?: boolean;
  database?: string;
  databaseId?: string;
  imported?: Partial<Record<TableName, number>>;
  preImportBackup?: D1PreImportBackupReport;
  timestampPrecision?: {
    table?: string;
    rows?: number;
    sha256?: string;
    file?: string;
  };
  artifactFingerprint?: MigrationArtifactFingerprint;
  cleanup?: {
    attempted?: boolean;
    ok?: boolean | null;
    kept?: boolean;
  };
};

type VectorizeImportReport = {
  createdAt?: string;
  completedAt?: string;
  backupDir?: string;
  ok?: boolean;
  reset?: boolean;
  artifactSha256?: string;
  manifestSha256?: string;
  artifactSha256MatchesManifest?: boolean;
  artifactFingerprint?: VectorizeArtifactFingerprint;
  expectedRows?: number;
  preImportBackup?: VectorizePreImportBackupReport;
  missingIds?: string[];
  unexpectedIds?: string[];
  remoteVectorChecks?: {
    ok?: boolean;
    fetchedRows?: number;
    expectedRows?: number;
    problems?: unknown[];
  };
  info?: { vectorCount?: number };
};

type VectorizeLocalRehearsalReport = {
  createdAt?: string;
  backupDir?: string;
  ok?: boolean;
  failedChecks?: number;
  artifact?: {
    rows?: number;
    sha256?: string;
    namespaces?: Record<string, number>;
  };
};

type FrozenCloudflareProductionBackupReport = {
  createdAt?: string;
  backupDir?: string;
  ok?: boolean;
  confirmations?: {
    confirmWriteFreeze?: boolean;
    confirmFinalBackup?: boolean;
    confirmFrozenSource?: boolean;
    confirmBackupDir?: boolean;
  };
  writeFreeze?: {
    createdAt?: string;
    ok?: boolean;
    finalBackup?: boolean;
  };
  d1?: {
    file?: string;
    bytes?: number;
    sha256?: string;
  } | null;
  vectorize?: {
    file?: string;
    rows?: number;
    sha256?: string;
  } | null;
};

type LocalGatesReport = {
  createdAt?: string;
  backupDir?: string;
  ok?: boolean;
  sourceFingerprintBefore?: SourceFingerprint;
  sourceFingerprintAfter?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  startupProfile?: SourceFileFingerprint | null;
  results?: Array<{
    id?: string;
    ok?: boolean;
    status?: number | null;
    durationMs?: number;
  }>;
};

type CloudflareTokenCapabilityReport = {
  createdAt?: string;
  backupDir?: string;
  domain?: string;
  accountId?: string;
  credentialSource?: string | null;
  requiredPermissions?: unknown;
  ok?: boolean;
  failedChecks?: number;
  checks?: Array<{
    name?: string;
    status?: CheckStatus;
    detail?: unknown;
  }>;
};

type EnvMigrationEntry = {
  key: string;
  source: "vercel-production";
  target:
    | "cloudflare-secret"
    | "wrangler-var"
    | "retired-supabase"
    | "retired-vercel-runtime"
    | "retired-build-tooling"
    | "retired-translation-build"
    | "unclassified";
  reason?: string;
};

const REQUIRED_SECRET_KEYS = [
  "OPENAI_API_KEY",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "ADMIN_EMAILS",
  "CRON_SECRET",
];

const REQUIRED_WRANGLER_VARS = [
  "APP_URL",
  "NEXTAUTH_URL",
  "CLOUDFLARE_AI_GATEWAY_BASE_URL",
  "CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS",
  "OPENAI_MODEL",
  "OPENAI_FAST_MODEL",
  "OPENAI_REASONING_MODEL",
  "OPENAI_STRUCTURED_MODEL",
  "OPENAI_EMBEDDING_MODEL",
  "RATE_LIMIT_USER_CHAT_DAILY",
  "RATE_LIMIT_GUEST_SESSION_DAILY",
  "RATE_LIMIT_GUEST_IP_DAILY",
  "RATE_LIMIT_ACTIVITY_DAILY",
  "RATE_LIMIT_MEMORY_DAILY",
  "LLM_GLOBAL_DAILY_CALL_LIMIT",
  "MEMORY_POST_TURN_SYNTHESIS_THRESHOLD",
  "MEMORY_PROFILE_COMPILE_LIMIT",
  "APP_WRITE_FREEZE",
  "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS",
];

const SECRET_KEYS_THAT_MUST_NOT_BE_VARS = [
  "OPENAI_API_KEY",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "AUTH_GOOGLE_SECRET",
  "CRON_SECRET",
];

const REQUIRED_SUPABASE_FILES = [
  "supabase/schema-public.sql",
  "supabase/data-public.sql",
  "supabase/validation.json",
  "checksums/supabase-table-checksums.json",
  "checksums/local-backup-files.sha256",
  SOURCE_TABLE_COVERAGE_REPORT,
  D1_TRANSFORM_FIDELITY_REPORT,
  D1_SIZE_SAFETY_REPORT,
];

const REQUIRED_VERCEL_FILES = [
  "vercel/project.json",
  "vercel/vercel.json",
  "vercel/output-config.json",
  "vercel/output-builds.json",
  "vercel/alias-ls.txt",
  "env/vercel-production-env-pull.local",
];

const REQUIRED_CLOUDFLARE_FILES = [
  WRITE_FREEZE_REPORT,
  "cloudflare/local-gates-report.json",
  "cloudflare/backup-permissions-report.json",
  "cloudflare/source-secret-scan-report.json",
  "cloudflare/runtime-provider-scan-report.json",
  "cloudflare/build-artifact-scan-report.json",
  "cloudflare/worker-startup.cpuprofile",
  "cloudflare/d1-import-manifest.json",
  TIMESTAMP_PRECISION_RELATIVE_PATH,
  D1_PRE_IMPORT_BACKUP_SQL,
  D1_PRE_IMPORT_BACKUP_REPORT,
  "cloudflare/d1-import-run.json",
  "cloudflare/d1-validation-report.json",
  "cloudflare/vectorize-local-rehearsal-report.json",
  "cloudflare/vectorize-manifest.json",
  "cloudflare/vectorize-memory.ndjson",
  VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
  VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
  "cloudflare/vectorize-import-run.json",
  "cloudflare/queues-list.txt",
  "cloudflare/cloudflare-api-token-capability-report.json",
  "cloudflare/secret-key-inventory.json",
  "cloudflare/wrangler-secret-list.json",
];

const checks: Check[] = [];
const backupDir = resolveBackupDir();
const outputPath = path.join(cloudflareDir(backupDir), "production-preflight-report.json");
const MAX_FINAL_DATA_REPORT_AGE_MS = 60 * 60 * 1000;

void main().catch((error) => {
  fail("preflight runtime", error instanceof Error ? error.message : String(error));
  writeReport();
  process.exitCode = 1;
});

async function main() {
  checkRequiredFiles();
  checkProviderCliUnavailableMarkers();
  checkFinalWriteFreezeBackup();
  checkBackupPermissions();
  checkSourceTableCoverage();
  checkCanonicalExports();
  checkD1TransformFidelity();
  checkD1SizeSafety();
  checkLocalGateEvidence();
  checkSourceSecretScan();
  checkRuntimeProviderScan();
  checkBuildArtifactScan();
  checkBackupChecksumManifest();
  checkD1Artifacts();
  checkVectorizeArtifacts();
  checkWranglerConfig();
  checkCloudflareSecretInventory();
  checkEnvironmentMigrationInventory();
  checkLiveCloudflareInventory();
  checkCloudflareTokenCapability();
  checkLiveGateEnvironment();

  const ok = writeReport();
  if (!ok) process.exitCode = 1;
}

function checkD1TransformFidelity() {
  const report = readJson<D1TransformFidelityReport>(D1_TRANSFORM_FIDELITY_REPORT);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const badTables = (report.tables ?? []).filter((table) => !table.ok);
  if (report.ok === true && backupDirOk && report.tables.length === TABLE_ORDER.length && badTables.length === 0) {
    pass("D1 transform fidelity", {
      tables: report.tables.length,
      rows: report.totals.rows,
      timestampValues: report.totals.timestampValues,
      timestampPrecisionRows: report.totals.timestampPrecisionRows,
      vectorValues: report.totals.vectorValues,
    });
    return;
  }

  fail("D1 transform fidelity", {
    reportOk: report.ok,
    backupDirOk,
    tableCount: report.tables?.length ?? 0,
    badTables: badTables.map((table) => ({
      table: table.table,
      problems: table.problems,
      artifactRowsMatchTransform: table.artifactRowsMatchTransform,
    })),
    remediation:
      "Rerun cf:migration:prepare. If this still fails, fix lossy source-to-D1 conversion before importing production D1.",
  });
}

function checkFinalWriteFreezeBackup() {
  if (!fs.existsSync(path.join(backupDir, WRITE_FREEZE_REPORT))) {
    fail("final write-freeze backup evidence", {
      report: WRITE_FREEZE_REPORT,
      missing: true,
      remediation:
        "Take the final provider backup with --final after the production write freeze is active so this backup records frozen-source evidence before exports.",
    });
    return;
  }

  const report = readJson<WriteFreezeEvidenceReport>(WRITE_FREEZE_REPORT);
  const freezeValidation = validateFinalWriteFreezeEvidenceReport(report, {
    backupDir,
    maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
  });
  const sourceValidation = readJson<{ createdAt?: string }>("supabase/validation.json");
  const evidenceBeforeValidation =
    reportTimestamp(report.createdAt) > 0 &&
    reportTimestamp(sourceValidation.createdAt) > 0 &&
    reportTimestamp(report.createdAt) <= reportTimestamp(sourceValidation.createdAt);
  const frozenCloudflareBackup = readJsonIfExists<FrozenCloudflareProductionBackupReport>(
    FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT,
  );
  const frozenCloudflareBackupValidation = validateFrozenCloudflareProductionBackup(frozenCloudflareBackup, report);

  if (freezeValidation.ok && (evidenceBeforeValidation || frozenCloudflareBackupValidation.ok)) {
    pass("final write-freeze backup evidence", {
      report: WRITE_FREEZE_REPORT,
      evidenceCreatedAt: report.createdAt,
      probe: report.probe?.required ? { url: report.probe.url, status: report.probe.status } : { waiverConfirmed: true },
      ...freezeValidation.detail,
      evidenceBeforeValidation,
      frozenCloudflareBackup: frozenCloudflareBackupValidation.detail,
    });
    return;
  }

  fail("final write-freeze backup evidence", {
    report: WRITE_FREEZE_REPORT,
    blockers: freezeValidation.blockers,
    ...freezeValidation.detail,
    evidenceBeforeValidation,
    frozenCloudflareBackup: frozenCloudflareBackupValidation.detail,
    probe: report.probe,
    externalFreeze: report.externalFreeze,
    problems: report.problems,
    remediation:
      "Take the final provider backup with --final after the production write freeze is active so this backup records frozen-source evidence before exports.",
  });
}

function validateFrozenCloudflareProductionBackup(
  report: FrozenCloudflareProductionBackupReport | null,
  writeFreeze: WriteFreezeEvidenceReport,
) {
  const freshness = report ? reportFreshness(report, FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT) : null;
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const confirmationsOk =
    report?.confirmations?.confirmWriteFreeze === true &&
    report.confirmations.confirmFinalBackup === true &&
    report.confirmations.confirmFrozenSource === true &&
    report.confirmations.confirmBackupDir === true;
  const writeFreezeOk =
    report?.writeFreeze?.ok === true &&
    report.writeFreeze.finalBackup === true &&
    report.writeFreeze.createdAt === writeFreeze.createdAt;
  const d1Ok =
    report?.d1?.file === D1_PRE_IMPORT_BACKUP_SQL &&
    typeof report.d1.bytes === "number" &&
    report.d1.bytes > 0 &&
    typeof report.d1.sha256 === "string" &&
    report.d1.sha256.length === 64 &&
    hasNonEmptyBackupFile(report.d1.file);
  const vectorizeOk =
    report?.vectorize?.file === VECTORIZE_PRE_IMPORT_BACKUP_NDJSON &&
    typeof report.vectorize.rows === "number" &&
    report.vectorize.rows >= 0 &&
    typeof report.vectorize.sha256 === "string" &&
    report.vectorize.sha256.length === 64 &&
    hasNonEmptyBackupFile(report.vectorize.file);

  return {
    ok:
      report?.ok === true &&
      backupDirOk &&
      freshness?.ok === true &&
      confirmationsOk &&
      writeFreezeOk &&
      d1Ok &&
      vectorizeOk,
    detail: {
      report: FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT,
      present: Boolean(report),
      reportOk: report?.ok === true,
      backupDirOk,
      fresh: freshness?.ok ?? false,
      freshness: freshness?.detail ?? null,
      confirmationsOk,
      writeFreezeOk,
      d1Ok,
      vectorizeOk,
    },
  };
}

function checkLocalGateEvidence() {
  const report = readJson<LocalGatesReport>("cloudflare/local-gates-report.json");
  const freshness = reportFreshness(report, "cloudflare/local-gates-report.json");
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const resultsById = new Map((report.results ?? []).map((result) => [result.id, result]));
  const missingGateIds = LOCAL_GATE_IDS.filter((id) => !resultsById.has(id));
  const failedGateIds = LOCAL_GATE_IDS.filter((id) => resultsById.get(id)?.ok !== true);
  const unexpectedGateIds = (report.results ?? [])
    .map((result) => result.id)
    .filter((id): id is string => Boolean(id) && !LOCAL_GATE_IDS.includes(id as (typeof LOCAL_GATE_IDS)[number]));
  const startupProfilePath = path.join(backupDir, "cloudflare/worker-startup.cpuprofile");
  const actualStartupProfile = fs.existsSync(startupProfilePath) ? fingerprintFile(backupDir, startupProfilePath) : null;
  const startupProfileOk =
    actualStartupProfile !== null &&
    report.startupProfile?.file === "cloudflare/worker-startup.cpuprofile" &&
    report.startupProfile.bytes === actualStartupProfile.bytes &&
    report.startupProfile.sha256 === actualStartupProfile.sha256;
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprintStable === true &&
    report.sourceFingerprintBefore?.sha256 === report.sourceFingerprintAfter?.sha256 &&
    report.sourceFingerprintAfter?.sha256 === currentSourceFingerprint.sha256;

  if (
    report.ok === true &&
    freshness.ok &&
    backupDirOk &&
    !missingGateIds.length &&
    !failedGateIds.length &&
    startupProfileOk &&
    sourceFingerprintOk
  ) {
    pass("local build and Worker startup gates", {
      gates: LOCAL_GATE_IDS,
      freshness: freshness.detail,
      sourceFingerprint: currentSourceFingerprint.sha256,
      sourceFiles: currentSourceFingerprint.fileCount,
      startupProfile: "cloudflare/worker-startup.cpuprofile",
      unexpectedGateIds,
    });
  } else {
    fail("local build and Worker startup gates", {
      reportOk: report.ok,
      fresh: freshness.ok,
      freshness: freshness.detail,
      backupDirOk,
      missingGateIds,
      failedGateIds,
      unexpectedGateIds,
      startupProfileOk,
      sourceFingerprintOk,
      expectedSourceFingerprint: report.sourceFingerprintAfter?.sha256,
      actualSourceFingerprint: currentSourceFingerprint.sha256,
    });
  }
}

function checkBackupPermissions() {
  const relativePath = "cloudflare/backup-permissions-report.json";
  const report = readJson<BackupPermissionsReport>(relativePath);
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const current = hardenBackupPermissions(backupDir, { dryRun: true });
  if (report.ok === true && freshness.ok && backupDirOk && current.ok === true) {
    pass("local backup permissions", {
      report: relativePath,
      freshness: freshness.detail,
      checkedFiles: current.checkedFiles,
      checkedDirectories: current.checkedDirectories,
      desiredFileMode: current.desiredFileMode,
      desiredDirectoryMode: current.desiredDirectoryMode,
    });
    return;
  }

  fail("local backup permissions", {
    report: relativePath,
    reportOk: report.ok,
    fresh: freshness.ok,
    freshness: freshness.detail,
    backupDirOk,
    currentOk: current.ok,
    currentProblems: current.problems.slice(0, 12),
    currentSymlinks: current.symlinks.slice(0, 12),
    reportProblems: report.problems?.slice(0, 12),
    reportSymlinks: report.symlinks?.slice(0, 12),
  });
}

function checkSourceSecretScan() {
  const relativePath = "cloudflare/source-secret-scan-report.json";
  const report = readJson<SourceSecretScanReport>(relativePath);
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const findings = report.findings?.length ?? 0;
  if (report.ok === true && freshness.ok && backupDirOk && sourceFingerprintOk && findings === 0) {
    pass("source secret scan", {
      report: relativePath,
      freshness: freshness.detail,
      sourceFingerprint: currentSourceFingerprint.sha256,
      scannedFiles: report.scannedFiles,
      skippedBinaryFiles: report.skippedBinaryFiles?.length ?? 0,
    });
    return;
  }

  fail("source secret scan", {
    report: relativePath,
    reportOk: report.ok,
    fresh: freshness.ok,
    freshness: freshness.detail,
    backupDirOk,
    sourceFingerprintOk,
    expectedSourceFingerprint: report.sourceFingerprint?.sha256,
    actualSourceFingerprint: currentSourceFingerprint.sha256,
    findings: report.findings?.slice(0, 12),
  });
}

function checkRuntimeProviderScan() {
  const relativePath = "cloudflare/runtime-provider-scan-report.json";
  const report = readJson<RuntimeProviderScanReport>(relativePath);
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const findings = report.findings?.length ?? 0;
  const scannedFiles = report.scannedFiles?.length ?? 0;
  const scannedFilesOk = scannedFiles > 0;
  if (report.ok === true && freshness.ok && backupDirOk && sourceFingerprintOk && findings === 0 && scannedFilesOk) {
    pass("runtime provider dependency scan", {
      report: relativePath,
      freshness: freshness.detail,
      sourceFingerprint: currentSourceFingerprint.sha256,
      scannedFiles,
    });
    return;
  }

  fail("runtime provider dependency scan", {
    report: relativePath,
    reportOk: report.ok,
    fresh: freshness.ok,
    freshness: freshness.detail,
    backupDirOk,
    sourceFingerprintOk,
    expectedSourceFingerprint: report.sourceFingerprint?.sha256,
    actualSourceFingerprint: currentSourceFingerprint.sha256,
    scannedFiles,
    findings: report.findings?.slice(0, 12),
    remediation:
      "Remove runtime references to Supabase/Postgres/Vercel provider APIs from app, component, lib, Worker, and config source before Cloudflare cutover.",
  });
}

function checkBuildArtifactScan() {
  const relativePath = "cloudflare/build-artifact-scan-report.json";
  const report = readJson<BuildArtifactScanReport>(relativePath);
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const findings = report.findings?.length ?? 0;
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  if (
    report.ok === true &&
    freshness.ok &&
    backupDirOk &&
    sourceFingerprintOk &&
    report.artifactRoot === ".open-next" &&
    report.nextEnvFile === ".open-next/cloudflare/next-env.mjs" &&
    findings === 0
  ) {
    pass("OpenNext build artifact secret scan", {
      report: relativePath,
      freshness: freshness.detail,
      sourceFingerprint: currentSourceFingerprint.sha256,
      scannedFiles: report.scannedFiles,
      skippedBinaryFiles: report.skippedBinaryFiles?.length ?? 0,
      nextEnvFile: report.nextEnvFile,
    });
    return;
  }

  fail("OpenNext build artifact secret scan", {
    report: relativePath,
    reportOk: report.ok,
    fresh: freshness.ok,
    freshness: freshness.detail,
    backupDirOk,
    sourceFingerprintOk,
    expectedSourceFingerprint: report.sourceFingerprint?.sha256,
    actualSourceFingerprint: currentSourceFingerprint.sha256,
    artifactRoot: report.artifactRoot,
    nextEnvFile: report.nextEnvFile,
    findings: report.findings?.slice(0, 12),
  });
}

function checkRequiredFiles() {
  for (const file of [...REQUIRED_SUPABASE_FILES, ...REQUIRED_VERCEL_FILES, ...REQUIRED_CLOUDFLARE_FILES]) {
    if (file === TIMESTAMP_PRECISION_RELATIVE_PATH) requireFile(file);
    else requireNonEmptyFile(file);
  }
  requireAnyNonEmptyFile("Vercel deployment inspect", [
    "vercel/inspect-inspirlearning.com.txt",
    "vercel/inspect-inspirlearning.com.err",
  ]);
}

function checkProviderCliUnavailableMarkers() {
  const markers = [
    "vercel/vercel-cli-unavailable.txt",
    "cloudflare/wrangler-cli-unavailable.txt",
  ].filter((file) => fs.existsSync(path.join(backupDir, file)));
  if (markers.length) fail("provider cli snapshots", { unavailableMarkers: markers });
  else pass("provider cli snapshots");
}

function checkD1SizeSafety() {
  const report = readJson<D1SizeSafetyReport>(D1_SIZE_SAFETY_REPORT);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const badTables = (report.tables ?? []).filter((table) => !table.ok);
  const limitsOk =
    report.limits?.maxRowOrValueBytes === D1_MAX_ROW_OR_VALUE_BYTES &&
    report.limits?.maxSqlStatementBytes === D1_MAX_SQL_STATEMENT_BYTES &&
    report.limits?.maxBoundParameters === D1_MAX_BOUND_PARAMETERS;

  if (report.ok === true && backupDirOk && limitsOk && badTables.length === 0 && report.tables.length === TABLE_ORDER.length) {
    pass("D1 size safety", {
      tables: report.tables.length,
      maxRowBytes: Math.max(...report.tables.map((table) => table.maxRowBytes)),
      maxValueBytes: Math.max(...report.tables.map((table) => table.maxValueBytes)),
    });
  } else {
    fail("D1 size safety", {
      reportOk: report.ok,
      backupDirOk,
      limitsOk,
      tableCount: report.tables?.length ?? 0,
      badTables: badTables.map((table) => ({
        table: table.table,
        problems: table.problems,
        columns: table.columns,
        insertStatementBytes: table.insertStatementBytes,
        maxRowBytes: table.maxRowBytes,
        maxValueBytes: table.maxValueBytes,
      })),
    });
  }
}

function checkSourceTableCoverage() {
  const report = readJson<SourceTableCoverageReport>(SOURCE_TABLE_COVERAGE_REPORT);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const problems = {
    reportOk: report.ok === true,
    backupDirOk,
    expectedTables: report.expectedTables?.length ?? 0,
    schemaTables: report.schemaTables?.length ?? 0,
    unexpectedTables: report.unexpectedTables ?? [],
    missingExpectedTables: report.missingExpectedTables ?? [],
    duplicateSchemaTables: report.duplicateSchemaTables ?? [],
    missingCanonicalExports: report.missingCanonicalExports ?? [],
    missingTransformedExports: report.missingTransformedExports ?? [],
    validationMissingTables: report.validationMissingTables ?? [],
  };

  if (
    problems.reportOk &&
    problems.backupDirOk &&
    problems.unexpectedTables.length === 0 &&
    problems.missingExpectedTables.length === 0 &&
    problems.duplicateSchemaTables.length === 0 &&
    problems.missingCanonicalExports.length === 0 &&
    problems.missingTransformedExports.length === 0 &&
    problems.validationMissingTables.length === 0 &&
    problems.expectedTables === TABLE_ORDER.length &&
    problems.schemaTables === TABLE_ORDER.length
  ) {
    pass("Supabase public table coverage", { tables: TABLE_ORDER.length });
  } else {
    fail("Supabase public table coverage", {
      ...problems,
      remediation:
        "Rerun cf:migration:backup and cf:migration:prepare, or explicitly add/ignore every public Supabase table before D1 cutover.",
    });
  }
}

function checkCanonicalExports() {
  const missing = [];
  for (const table of TABLE_ORDER) {
    for (const prefix of ["supabase/canonical", "cloudflare/d1-transformed"]) {
      const file = `${prefix}/${table}.ndjson`;
      if (!fs.existsSync(path.join(backupDir, file))) missing.push(file);
    }
  }

  const vectorExports = [
    "supabase/user_memories-vectors.ndjson",
    "supabase/chat_memory_summaries-vectors.ndjson",
    "supabase/chat_memory_turns-vectors.ndjson",
  ].filter((file) => !fs.existsSync(path.join(backupDir, file)));

  if (missing.length || vectorExports.length) {
    fail("canonical exports", { missing, missingVectorExports: vectorExports });
  } else {
    pass("canonical exports", { tables: TABLE_ORDER.length });
  }
}

function checkBackupChecksumManifest() {
  const manifestPath = path.join(backupDir, "checksums/local-backup-files.sha256");
  const mismatches: Array<{ file: string; reason: string }> = [];
  for (const line of fs.readFileSync(manifestPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) {
      mismatches.push({ file: line, reason: "invalid manifest line" });
      continue;
    }
    const [, expectedHash, relativeFile] = match;
    const absoluteFile = path.isAbsolute(relativeFile) ? relativeFile : path.join(backupDir, relativeFile);
    if (path.resolve(absoluteFile) === path.resolve(manifestPath)) continue;
    if (!fs.existsSync(absoluteFile)) {
      mismatches.push({ file: relativeFile, reason: "missing" });
      continue;
    }
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(absoluteFile)).digest("hex");
    if (actualHash !== expectedHash) mismatches.push({ file: relativeFile, reason: "sha256 mismatch" });
  }

  if (mismatches.length) fail("backup checksum manifest", mismatches);
  else pass("backup checksum manifest");
}

function checkD1Artifacts() {
  const postCutover = currentPostCutoverD1Evidence();
  const manifest = readJson<TableManifest[]>("cloudflare/d1-import-manifest.json");
  const transformFidelity = readJson<D1TransformFidelityReport>(D1_TRANSFORM_FIDELITY_REPORT);
  const expectedTimestampPrecision = transformFidelity.timestampPrecisionArtifact;
  const currentArtifactFingerprint = buildD1ArtifactFingerprint(backupDir);
  const importRun = readJson<D1ImportRunReport>("cloudflare/d1-import-run.json");
  const preImportBackup = readJsonIfExists<D1PreImportBackupReport>("cloudflare/d1-pre-import-backup-report.json");
  const preImportBackupCheck = checkD1PreImportBackup({
    backupDir,
    database: D1_DATABASE_NAME,
    databaseId: D1_DATABASE_ID,
    report: preImportBackup,
    importRunReport: importRun.preImportBackup,
    maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
  });
  const importRunFreshness = reportFreshness(importRun, "cloudflare/d1-import-run.json");
  const missingTables = TABLE_ORDER.filter((table) => !manifest.some((entry) => entry.table === table));
  const importedCountMismatches = manifest.filter((entry) => importRun.imported?.[entry.table] !== entry.rows);
  const timestampPrecisionImportOk =
    importRun.timestampPrecision?.rows === expectedTimestampPrecision?.rows &&
    importRun.timestampPrecision?.sha256 === expectedTimestampPrecision?.sha256;
  const importRunProblems = {
    reportOk: importRun.ok === true,
    databaseOk: importRun.database === D1_DATABASE_NAME && importRun.databaseId === D1_DATABASE_ID,
    backupDirOk: path.resolve(importRun.backupDir ?? "") === path.resolve(backupDir),
    fresh: importRunFreshness.ok,
    freshness: importRunFreshness.detail,
    cleanupOk: importRun.cleanup?.attempted === true && importRun.cleanup.ok === true && importRun.cleanup.kept === false,
    resetOk: importRun.resetSkipped === false,
    missingImportedTables: TABLE_ORDER.filter((table) => importRun.imported?.[table] === undefined),
    importedCountMismatches,
    timestampPrecisionImportOk,
    timestampPrecision: importRun.timestampPrecision,
    preImportBackupOk: preImportBackupCheck.ok,
    preImportBackup: preImportBackupCheck.detail,
    artifactFingerprintOk: importRun.artifactFingerprint?.sha256 === currentArtifactFingerprint.sha256,
  };
  if (
    importRunProblems.reportOk &&
    importRunProblems.databaseOk &&
    importRunProblems.backupDirOk &&
    importRunProblems.fresh &&
    importRunProblems.cleanupOk &&
    importRunProblems.resetOk &&
    !importRunProblems.missingImportedTables.length &&
    !importRunProblems.importedCountMismatches.length &&
    importRunProblems.timestampPrecisionImportOk &&
    importRunProblems.preImportBackupOk &&
    importRunProblems.artifactFingerprintOk
  ) {
    pass("D1 import run evidence", {
      tables: TABLE_ORDER.length,
      timestampPrecisionRows: expectedTimestampPrecision?.rows ?? 0,
      preImportBackup: preImportBackupCheck.detail,
      cleanup: "temporary importer deleted",
      artifactFingerprint: currentArtifactFingerprint.sha256,
    });
  } else {
    if (postCutover.ok) {
      pass("D1 import run evidence", {
        mode: "post-cutover-production-validation",
        postCutover: postCutover.detail,
      });
    } else {
      fail("D1 import run evidence", {
        ...importRunProblems,
        postCutover: postCutover.detail,
        remediation:
          "Rerun cf:migration:import:d1 with the current migration scripts during final write-freeze so d1-import-run.json records ok=true and temporary importer cleanup.",
      });
    }
  }

  const validation = readJson<D1ValidationReport>("cloudflare/d1-validation-report.json");
  const validationFreshness = reportFreshness(validation, "cloudflare/d1-validation-report.json");
  const badTables = validation.tables?.filter((table) => !table.ok) ?? [];
  const runtimeMutableBadTables = badTables.filter((table) => isRuntimeMutableTable(table.table));
  const durableBadTables = badTables.filter((table) => !isRuntimeMutableTable(table.table));
  const runtimeMutableDriftOnly = badTables.length > 0 && runtimeMutableBadTables.length === badTables.length;
  const quickCheckOk = validation.quickCheck?.[0]?.quick_check === "ok";
  const foreignKeyOk = (validation.foreignKeyCheck?.length ?? 0) === 0;

  const validationBackupDirOk = path.resolve(validation.backupDir ?? "") === path.resolve(backupDir);
  const validationAfterImport = reportTimestamp(validation.completedAt ?? validation.createdAt) >= reportTimestamp(importRun.completedAt ?? importRun.createdAt);
  const validationMatchesCurrentArtifact = validation.artifactFingerprint?.sha256 === currentArtifactFingerprint.sha256;
  const validationMatchesImportRun =
    Boolean(importRun.artifactFingerprint?.sha256) && validation.artifactFingerprint?.sha256 === importRun.artifactFingerprint?.sha256;
  const validationArtifactFingerprintOk = validationMatchesCurrentArtifact && validationMatchesImportRun;
  const timestampPrecisionValidationOk =
    validation.timestampPrecision?.ok === true &&
    validation.timestampPrecision.expectedRows === expectedTimestampPrecision?.rows &&
    validation.timestampPrecision.expectedSha256 === expectedTimestampPrecision?.sha256;

  if (
    !missingTables.length &&
    validation.ok &&
    quickCheckOk &&
    foreignKeyOk &&
    !badTables.length &&
    validationBackupDirOk &&
    validationFreshness.ok &&
    validationAfterImport &&
    timestampPrecisionValidationOk &&
    validationArtifactFingerprintOk
  ) {
    pass("D1 import validation", {
      tables: manifest.length,
      timestampPrecisionRows: expectedTimestampPrecision?.rows ?? 0,
      artifactFingerprint: currentArtifactFingerprint.sha256,
    });
  } else {
    if (postCutover.ok) {
      pass("D1 import validation", {
        mode: "post-cutover-production-validation",
        postCutover: postCutover.detail,
      });
    } else {
      fail("D1 import validation", {
        missingTables,
        reportOk: Boolean(validation.ok),
        backupDirOk: validationBackupDirOk,
        fresh: validationFreshness.ok,
        freshness: validationFreshness.detail,
        validationAfterImport,
        artifactFingerprintOk: validationArtifactFingerprintOk,
        validationMatchesCurrentArtifact,
        validationMatchesImportRun,
        importArtifactFingerprint: importRun.artifactFingerprint?.sha256,
        validationArtifactFingerprint: validation.artifactFingerprint?.sha256,
        currentArtifactFingerprint: currentArtifactFingerprint.sha256,
        timestampPrecisionValidationOk,
        timestampPrecision: validation.timestampPrecision,
        quickCheckOk,
        foreignKeyOk,
        badTables: badTables.map((table) => ({
          table: table.table,
          expectedRows: table.expectedRows,
          actualRows: table.actualRows,
        })),
        durableBadTables: durableBadTables.map((table) => table.table),
        runtimeMutableBadTables: runtimeMutableBadTables.map((table) => table.table),
        runtimeMutableDriftOnly,
        postCutover: postCutover.detail,
        remediation: runtimeMutableDriftOnly
          ? "Remote D1 has only runtime quota-table drift. During final write-freeze, rerun cf:migration:import:d1 and cf:migration:validate:d1 immediately before production deploy."
          : "Remote D1 durable tables are not in exact source parity. Recreate migration artifacts or re-import D1 before production deploy.",
        mismatchedSourceHashes: validation.mismatchedSourceHashes?.length ?? 0,
      });
    }
  }

  const appTranslations = manifest.find((entry) => entry.table === "app_translations");
  if (appTranslations && appTranslations.rows > 0 && appTranslations.sha256) {
    pass("translation checksum", { rows: appTranslations.rows, sha256: appTranslations.sha256 });
  } else {
    fail("translation checksum", { appTranslations });
  }
}

function readJsonIfExists<T>(relativePath: string): T | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) return null;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
}

function currentPostCutoverD1Evidence() {
  const relativePath = "cloudflare/d1-post-cutover-validation-report.json";
  const report = readJsonIfExists<NonNullable<Parameters<typeof validatePostCutoverD1Report>[0]>>(relativePath);
  if (!report) return { ok: false, detail: { report: relativePath, missing: true } };

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const artifactFingerprint = buildD1ArtifactFingerprint(backupDir);
  const validation = validatePostCutoverD1Report(report, {
    expectedArtifactFingerprint: artifactFingerprint,
  });

  return {
    ok: validation.ok && freshness.ok && backupDirOk,
    detail: {
      report: relativePath,
      reportOk: report.ok === true,
      backupDirOk,
      fresh: freshness.ok,
      freshness: freshness.detail,
      databaseOk: validation.databaseOk,
      integrityOk: validation.integrityOk,
      tableCoverageOk: validation.tableCoverageOk,
      exactTablesOk: validation.exactTablesOk,
      mutableTablesOk: validation.mutableTablesOk,
      sourceHashesOk: validation.sourceHashesOk,
      timestampPrecisionOk: validation.timestampPrecisionOk,
      artifactFingerprintOk: validation.artifactFingerprintOk,
      artifactFingerprint: validation.artifactFingerprint,
      expectedArtifactFingerprint: validation.expectedArtifactFingerprint,
      badExactTables: validation.badExactTables,
      badMutableTables: validation.badMutableTables,
    },
  };
}

function checkVectorizeArtifacts() {
  const postCutover = currentPostCutoverVectorizeEvidence();
  const manifest = readJson<{ rows: number; sha256: string }>("cloudflare/vectorize-manifest.json");
  const currentArtifactFingerprint = buildVectorizeArtifactFingerprint(backupDir);
  const localRehearsal = readJson<VectorizeLocalRehearsalReport>("cloudflare/vectorize-local-rehearsal-report.json");
  const report = readJson<VectorizeImportReport>("cloudflare/vectorize-import-run.json");
  const preImportBackup = readJsonIfExists<VectorizePreImportBackupReport>(VECTORIZE_PRE_IMPORT_BACKUP_REPORT);
  const preImportBackupCheck = checkVectorizePreImportBackup({
    backupDir,
    index: VECTORIZE_INDEX_NAME,
    report: preImportBackup,
    importRunReport: report.preImportBackup,
    maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
  });
  const localFreshness = reportFreshness(localRehearsal, "cloudflare/vectorize-local-rehearsal-report.json");
  const freshness = reportFreshness(report, "cloudflare/vectorize-import-run.json");
  const localBackupDirOk = path.resolve(localRehearsal.backupDir ?? "") === path.resolve(backupDir);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const missingIds = report.missingIds?.length ?? 0;
  const unexpectedIds = report.unexpectedIds?.length ?? 0;
  const vectorCountExact = report.info?.vectorCount === manifest.rows;
  const remoteChecksOk =
    report.remoteVectorChecks?.ok === true &&
    report.remoteVectorChecks.fetchedRows === manifest.rows &&
    report.remoteVectorChecks.expectedRows === manifest.rows &&
    (report.remoteVectorChecks.problems?.length ?? 0) === 0;
  const localOk =
    localRehearsal.ok === true &&
    localBackupDirOk &&
    localFreshness.ok &&
    localRehearsal.artifact?.rows === manifest.rows &&
    localRehearsal.artifact?.sha256 === manifest.sha256;
  if (
    localOk &&
    report.ok &&
    report.reset === true &&
    report.artifactSha256 === manifest.sha256 &&
    report.artifactSha256 === currentArtifactFingerprint.artifactSha256 &&
    report.manifestSha256 === manifest.sha256 &&
    report.artifactSha256MatchesManifest === true &&
    report.artifactFingerprint?.sha256 === currentArtifactFingerprint.sha256 &&
    preImportBackupCheck.ok &&
    manifest.rows === report.expectedRows &&
    vectorCountExact &&
    remoteChecksOk &&
    !missingIds &&
    !unexpectedIds &&
    backupDirOk &&
    freshness.ok
  ) {
    pass("Vectorize import validation", {
      rows: manifest.rows,
      vectorCount: report.info?.vectorCount,
      artifactFingerprint: currentArtifactFingerprint.sha256,
      preImportBackup: preImportBackupCheck.detail,
      localFreshness: localFreshness.detail,
      freshness: freshness.detail,
    });
  } else {
    if (postCutover.ok) {
      pass("Vectorize import validation", {
        mode: "post-cutover-production-validation",
        postCutover: postCutover.detail,
      });
    } else {
      fail("Vectorize import validation", {
        localRehearsalOk: localRehearsal.ok,
        localBackupDirOk,
        localFresh: localFreshness.ok,
        localFreshness: localFreshness.detail,
        localRows: localRehearsal.artifact?.rows,
        localSha256: localRehearsal.artifact?.sha256,
        reset: report.reset,
        artifactSha256: report.artifactSha256,
        actualArtifactSha256: currentArtifactFingerprint.artifactSha256,
        manifestSha256: report.manifestSha256,
        artifactSha256MatchesManifest: report.artifactSha256MatchesManifest,
        artifactFingerprintOk: report.artifactFingerprint?.sha256 === currentArtifactFingerprint.sha256,
        preImportBackupOk: preImportBackupCheck.ok,
        preImportBackup: preImportBackupCheck.detail,
        reportOk: Boolean(report.ok),
        backupDirOk,
        fresh: freshness.ok,
        freshness: freshness.detail,
        manifestRows: manifest.rows,
        expectedRows: report.expectedRows,
        vectorCountExact,
        remoteChecksOk,
        remoteVectorChecks: report.remoteVectorChecks,
        missingIds,
        unexpectedIds,
        vectorCount: report.info?.vectorCount,
        postCutover: postCutover.detail,
      });
    }
  }
}

function currentPostCutoverVectorizeEvidence() {
  const relativePath = "cloudflare/vectorize-post-cutover-validation-report.json";
  const report = readJsonIfExists<NonNullable<Parameters<typeof validatePostCutoverVectorizeReport>[0]>>(relativePath);
  if (!report) return { ok: false, detail: { report: relativePath, missing: true } };

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const artifactFingerprint = buildVectorizeArtifactFingerprint(backupDir);
  const validation = validatePostCutoverVectorizeReport(report, {
    expectedArtifactFingerprint: artifactFingerprint,
  });

  return {
    ok: validation.ok && freshness.ok && backupDirOk,
    detail: {
      report: relativePath,
      reportOk: report.ok === true,
      backupDirOk,
      fresh: freshness.ok,
      freshness: freshness.detail,
      artifactFingerprintOk: validation.artifactFingerprintOk,
      artifactSha256Ok: validation.artifactSha256Ok,
      manifestSha256Ok: validation.manifestSha256Ok,
      rowCountOk: validation.rowCountOk,
      migratedIdsOk: validation.migratedIdsOk,
      remoteChecksOk: validation.remoteChecksOk,
      extrasAllowed: validation.extrasAllowed,
      expectedRows: validation.expectedRows,
      fetchedRows: validation.fetchedRows,
      missingIds: validation.missingIds,
      unexpectedIds: validation.unexpectedIds,
      artifactFingerprint: validation.artifactFingerprint,
      expectedArtifactFingerprint: validation.expectedArtifactFingerprint,
    },
  };
}

function checkWranglerConfig() {
  const config = readRepoJson<Record<string, unknown>>("wrangler.jsonc");
  const vars = objectValue(config.vars);
  const missingVars = REQUIRED_WRANGLER_VARS.filter((key) => vars[key] === undefined || vars[key] === "");
  const leakedSecretVars = SECRET_KEYS_THAT_MUST_NOT_BE_VARS.filter((key) => vars[key] !== undefined);
  const d1 = arrayValue(config.d1_databases).find((binding) => binding.binding === "DB");
  const vectorize = arrayValue(config.vectorize).find((binding) => binding.binding === "MEMORY_VECTORIZE");
  const r2 = arrayValue(config.r2_buckets).find((binding) => binding.binding === "NEXT_INC_CACHE_R2_BUCKET");
  const queueProducer = arrayValue(objectValue(config.queues).producers).find(
    (binding) => binding.binding === "MEMORY_POST_TURN_QUEUE",
  );
  const queueConsumer = arrayValue(objectValue(config.queues).consumers).find(
    (binding) => binding.queue === MEMORY_POST_TURN_QUEUE_NAME,
  );
  const services = arrayValue(config.services).find((binding) => binding.binding === "WORKER_SELF_REFERENCE");
  const observability = objectValue(config.observability);
  const observabilityLogs = objectValue(observability.logs);
  const observabilityTraces = objectValue(observability.traces);
  const secrets = objectValue(config.secrets);
  const requiredSecrets = Array.isArray(secrets.required) ? secrets.required.filter(isString) : [];
  const cron = objectValue(config.triggers).crons;
  const routes = arrayValue(config.routes).map((route) => route.pattern);

  const problems = {
    missingVars,
    leakedSecretVars,
    d1Ok: d1?.database_name === D1_DATABASE_NAME && d1?.database_id === D1_DATABASE_ID,
    vectorizeOk: vectorize?.index_name === VECTORIZE_INDEX_NAME,
    r2Ok: r2?.bucket_name === R2_BUCKET_NAME,
    queueProducerOk: queueProducer?.queue === MEMORY_POST_TURN_QUEUE_NAME,
    queueConsumerOk:
      queueConsumer?.queue === MEMORY_POST_TURN_QUEUE_NAME &&
      queueConsumer.dead_letter_queue === MEMORY_POST_TURN_DLQ_NAME &&
      Number(queueConsumer.max_retries) >= 1,
    serviceOk: services?.service === "inspirlearning",
    cronOk: Array.isArray(cron) && cron.includes("0 3 * * *"),
    routesOk: routes.includes("inspirlearning.com") && routes.includes("www.inspirlearning.com"),
    appUrlOk: vars.APP_URL === "https://inspirlearning.com" && vars.NEXTAUTH_URL === "https://inspirlearning.com",
    workersDevOk: config.workers_dev === false,
    previewUrlsOk: config.preview_urls === false,
    observabilityOk:
      observability.enabled === true &&
      observabilityLogs.enabled === true &&
      observabilityTraces.enabled === true,
    missingRequiredSecrets: REQUIRED_SECRET_KEYS.filter((key) => !requiredSecrets.includes(key)),
  };

  if (
    !missingVars.length &&
    !leakedSecretVars.length &&
    problems.d1Ok &&
    problems.vectorizeOk &&
    problems.r2Ok &&
    problems.queueProducerOk &&
    problems.queueConsumerOk &&
    problems.serviceOk &&
    problems.cronOk &&
    problems.routesOk &&
    problems.appUrlOk &&
    problems.workersDevOk &&
    problems.previewUrlsOk &&
    problems.observabilityOk &&
    !problems.missingRequiredSecrets.length
  ) {
    pass("Wrangler production config");
  } else {
    fail("Wrangler production config", problems);
  }
}

function checkCloudflareSecretInventory() {
  const inventory = readJson<{ keys?: string[] }>("cloudflare/secret-key-inventory.json");
  const missing = REQUIRED_SECRET_KEYS.filter((key) => !inventory.keys?.includes(key));
  if (missing.length) fail("Cloudflare secret backup inventory", { missing });
  else pass("Cloudflare secret backup inventory", { keys: REQUIRED_SECRET_KEYS });
}

function checkEnvironmentMigrationInventory() {
  const backedUpVercelKeys = parseEnvKeys("env/vercel-production-env-pull.local");
  const config = readRepoJson<Record<string, unknown>>("wrangler.jsonc");
  const wranglerVars = new Set(Object.keys(objectValue(config.vars)));
  const configuredSecretList = objectValue(config.secrets).required;
  const configuredSecrets = new Set(Array.isArray(configuredSecretList) ? configuredSecretList.filter(isString) : []);
  const backupSecretInventory = readJson<{ keys?: string[] }>("cloudflare/secret-key-inventory.json");
  const backupSecretKeys = new Set((backupSecretInventory.keys ?? []).filter(isString));
  const liveSecretKeys = new Set(secretNamesFromWranglerOutput(runWrangler(["secret", "list", "--format=json"], { allowFailure: true })));
  const retiredSupabaseSecrets = [...liveSecretKeys].filter(isRetiredSupabaseEnvKey).sort();

  const entries = backedUpVercelKeys.map((key): EnvMigrationEntry => {
    if (isRetiredSupabaseEnvKey(key)) {
      return {
        key,
        source: "vercel-production",
        target: "retired-supabase",
        reason: "Supabase/Postgres dependency is replaced by D1 and Vectorize.",
      };
    }
    if (isRetiredVercelRuntimeEnvKey(key)) {
      return {
        key,
        source: "vercel-production",
        target: "retired-vercel-runtime",
        reason: "Vercel runtime metadata is not used on Cloudflare Workers.",
      };
    }
    if (isRetiredBuildToolingEnvKey(key)) {
      return {
        key,
        source: "vercel-production",
        target: "retired-build-tooling",
        reason: "CI/build cache toggles are not production runtime configuration.",
      };
    }
    if (isRetiredTranslationBuildEnvKey(key)) {
      return {
        key,
        source: "vercel-production",
        target: "retired-translation-build",
        reason: "Translations are backed up and migrated; generation-time provider knobs are not production runtime keys.",
      };
    }
    if (configuredSecrets.has(key) || liveSecretKeys.has(key)) {
      return { key, source: "vercel-production", target: "cloudflare-secret" };
    }
    if (wranglerVars.has(key)) {
      return { key, source: "vercel-production", target: "wrangler-var" };
    }
    return { key, source: "vercel-production", target: "unclassified" };
  });

  const unclassified = entries.filter((entry) => entry.target === "unclassified").map((entry) => entry.key);
  const duplicateSecretAndVarKeys = [...new Set([...configuredSecrets, ...liveSecretKeys])]
    .filter((key) => wranglerVars.has(key))
    .sort();
  const missingRequiredSecretBackups = REQUIRED_SECRET_KEYS.filter(
    (key) => !configuredSecrets.has(key) || (!backupSecretKeys.has(key) && !liveSecretKeys.has(key)),
  );
  const missingRequiredVars = REQUIRED_WRANGLER_VARS.filter((key) => !wranglerVars.has(key));
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    backedUpVercelEnvKeys: backedUpVercelKeys.length,
    wranglerVars: [...wranglerVars].sort(),
    configuredSecrets: [...configuredSecrets].sort(),
    liveSecrets: [...liveSecretKeys].sort(),
    entries,
    retired: {
      supabase: entries.filter((entry) => entry.target === "retired-supabase").map((entry) => entry.key),
      vercelRuntime: entries.filter((entry) => entry.target === "retired-vercel-runtime").map((entry) => entry.key),
      buildTooling: entries.filter((entry) => entry.target === "retired-build-tooling").map((entry) => entry.key),
      translationBuild: entries.filter((entry) => entry.target === "retired-translation-build").map((entry) => entry.key),
    },
    unclassified,
    duplicateSecretAndVarKeys,
    retiredSupabaseSecrets,
    missingRequiredSecretBackups,
    missingRequiredVars,
  };
  fs.writeFileSync(path.join(cloudflareDir(backupDir), "env-migration-inventory.json"), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });

  if (
    !unclassified.length &&
    !duplicateSecretAndVarKeys.length &&
    !retiredSupabaseSecrets.length &&
    !missingRequiredSecretBackups.length &&
    !missingRequiredVars.length
  ) {
    pass("environment migration inventory", {
      backedUpVercelEnvKeys: backedUpVercelKeys.length,
      retiredKeys:
        report.retired.supabase.length +
        report.retired.vercelRuntime.length +
        report.retired.buildTooling.length +
        report.retired.translationBuild.length,
    });
  } else {
    fail("environment migration inventory", {
      report: "cloudflare/env-migration-inventory.json",
      unclassified,
      duplicateSecretAndVarKeys,
      retiredSupabaseSecrets,
      missingRequiredSecretBackups,
      missingRequiredVars,
      remediation:
        "Every backed-up Vercel env key must be mapped to a Cloudflare secret/var or an explicit retired category. Delete live Cloudflare secrets that duplicate wrangler vars or retired Supabase/Postgres keys before deploy so config values are not shadowed.",
    });
  }
}

function checkLiveCloudflareInventory() {
  const secretOutput = runWrangler(["secret", "list", "--format=json"], { allowFailure: true });
  const liveSecrets = secretNamesFromWranglerOutput(secretOutput);
  const missingSecrets = REQUIRED_SECRET_KEYS.filter((key) => !liveSecrets.includes(key));

  const d1Output = runWrangler(["d1", "list", "--json"], { allowFailure: true });
  const d1Databases = parseJsonFromOutput<Array<{ uuid?: string; name?: string }>>(d1Output, []);
  const d1Ok = d1Databases.some((database) => database.uuid === D1_DATABASE_ID && database.name === D1_DATABASE_NAME);

  const r2Output = runWrangler(["r2", "bucket", "list"], { allowFailure: true });
  const r2Buckets = parseJsonFromOutput<Array<{ name?: string }>>(r2Output, []);
  const r2Ok = r2Buckets.some((bucket) => bucket.name === R2_BUCKET_NAME) || r2Output.includes(R2_BUCKET_NAME);

  const vectorOutput = runWrangler(["vectorize", "info", VECTORIZE_INDEX_NAME, "--json"], { allowFailure: true });
  const vectorInfo = parseJsonFromOutput<{ dimensions?: number; vectorCount?: number }>(vectorOutput, {});
  const vectorOk = vectorInfo.dimensions === 512 && typeof vectorInfo.vectorCount === "number";
  const queueOutput = runWrangler(["queues", "list"], { allowFailure: true });
  const queueOk = queueOutput.includes(MEMORY_POST_TURN_QUEUE_NAME);
  const queueDlqOk = queueOutput.includes(MEMORY_POST_TURN_DLQ_NAME);

  if (!missingSecrets.length && d1Ok && r2Ok && vectorOk && queueOk && queueDlqOk) {
    pass("live Cloudflare inventory", {
      d1: D1_DATABASE_NAME,
      r2: R2_BUCKET_NAME,
      vectorize: VECTORIZE_INDEX_NAME,
      queue: MEMORY_POST_TURN_QUEUE_NAME,
      queueDlq: MEMORY_POST_TURN_DLQ_NAME,
      secretKeys: REQUIRED_SECRET_KEYS,
    });
  } else {
    fail("live Cloudflare inventory", {
      missingSecrets,
      d1Ok,
      r2Ok,
      vectorOk,
      queueOk,
      queueDlqOk,
      vectorCount: vectorInfo.vectorCount,
    });
  }
}

function checkCloudflareTokenCapability() {
  const manualDns = validatePublicDnsCutoverEvidence(backupDir, { maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS });
  if (manualDns.ok) {
    pass("Cloudflare API token capability", {
      waivedForManualDns: true,
      manualDnsReport: DNS_PUBLIC_CUTOVER_REPORT,
      remediation:
        "Cloudflare DNS edit token is not required because DNS cutover was already performed manually and public DNS/HTTP evidence is fresh and clean.",
    });
    return;
  }

  const relativePath = "cloudflare/cloudflare-api-token-capability-report.json";
  const report = readJson<CloudflareTokenCapabilityReport>(relativePath);
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const failedChecks = (report.checks ?? []).filter((check) => check.status === "fail");
  const passedCheckNames = new Set(
    (report.checks ?? []).filter((check) => check.status === "pass").map((check) => check.name).filter(isString),
  );
  const missingRequiredPasses = [
    "Cloudflare API token loaded",
    "Cloudflare API token active",
    "Cloudflare zone read",
    "Cloudflare DNS records read",
    "Cloudflare DNS records write/delete probe",
  ].filter((name) => !passedCheckNames.has(name));

  if (
    report.ok === true &&
    report.failedChecks === 0 &&
    failedChecks.length === 0 &&
    freshness.ok &&
    backupDirOk &&
    report.domain === "inspirlearning.com" &&
    report.accountId === CLOUDFLARE_ACCOUNT_ID &&
    Boolean(report.credentialSource) &&
    missingRequiredPasses.length === 0
  ) {
    pass("Cloudflare API token capability", {
      report: relativePath,
      freshness: freshness.detail,
      credentialSource: report.credentialSource,
      domain: report.domain,
      accountId: report.accountId,
    });
    return;
  }

  fail("Cloudflare API token capability", {
    report: relativePath,
    reportOk: report.ok,
    failedChecks: report.failedChecks,
    failingChecks: failedChecks.slice(0, 12),
    missingRequiredPasses,
    fresh: freshness.ok,
    freshness: freshness.detail,
    backupDirOk,
    domain: report.domain,
    accountId: report.accountId,
    expectedAccountId: CLOUDFLARE_ACCOUNT_ID,
    credentialSource: report.credentialSource,
    requiredPermissions: report.requiredPermissions ?? cloudflareApiTokenInstructions().requiredPermissions,
    remediation:
      "Run CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 pnpm cf:verify:cloudflare-token with a 0600 token file. The token must be active and able to read DNS records plus create/delete the temporary TXT probe before DNS cutover.",
  });
}

function checkLiveGateEnvironment() {
  const postCutoverProduction = currentPostCutoverProductionEvidence();
  const migrationSessionAuth = Boolean(process.env.E2E_TEST_AUTH_SECRET?.trim());
  const requiredEnv = {
    REQUIRE_LIVE_AI: "1",
    E2E_GOOGLE_IS_ADMIN: "1",
    ...(postCutoverProduction.ok ? {} : { CONFIRM_WRITE_FREEZE: "1" }),
  };
  const missingEnv = Object.entries(requiredEnv)
    .filter(([key, expected]) => process.env[key] !== expected)
    .map(([key]) => key);
  const missingGoogleCreds = ["E2E_GOOGLE_EMAIL"].filter((key) => !process.env[key]?.trim());
  if (!migrationSessionAuth && !process.env.E2E_GOOGLE_PASSWORD?.trim()) missingGoogleCreds.push("E2E_GOOGLE_PASSWORD");

  if (!missingEnv.length && !missingGoogleCreds.length) {
    pass("live cutover gates", {
      writeFreeze: postCutoverProduction.ok ? "not-required-after-post-cutover-validation" : true,
      liveAi: true,
      googleE2E: !migrationSessionAuth,
      migrationSessionAuth,
      googleE2EAdmin: true,
      postCutoverProduction: postCutoverProduction.detail,
    });
  } else {
    fail("live cutover gates", { missingEnv, missingGoogleCreds, postCutoverProduction: postCutoverProduction.detail });
  }
}

function currentPostCutoverProductionEvidence() {
  const d1 = currentPostCutoverD1Evidence();
  const vectorize = currentPostCutoverVectorizeEvidence();
  const smokePath = "cloudflare/production-smoke-report.json";
  const smokeReport = readJsonIfExists<NonNullable<Parameters<typeof validateProductionSmokeReport>[0]>>(smokePath);
  const smokeFreshness = smokeReport ? reportFreshness(smokeReport, smokePath) : null;
  const smokeBackupDirOk = path.resolve(smokeReport?.backupDir ?? "") === path.resolve(backupDir);
  const smokeValidation = validateProductionSmokeReport(smokeReport);
  const smokeOk = smokeValidation.ok && smokeFreshness?.ok === true && smokeBackupDirOk;

  return {
    ok: d1.ok && vectorize.ok && smokeOk,
    detail: {
      d1: d1.detail,
      vectorize: vectorize.detail,
      productionSmoke: {
        report: smokePath,
        reportOk: smokeReport?.ok === true,
        backupDirOk: smokeBackupDirOk,
        fresh: smokeFreshness?.ok ?? false,
        freshness: smokeFreshness?.detail ?? null,
        validationOk: smokeValidation.ok,
        missingChecks: smokeValidation.missingChecks,
        failingRequiredChecks: smokeValidation.failingRequiredChecks,
      },
    },
  };
}

function requireFile(relativePath: string) {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`required file: ${relativePath}`, "missing");
    return;
  }
  pass(`required file: ${relativePath}`);
}

function requireNonEmptyFile(relativePath: string) {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`required file: ${relativePath}`, "missing");
    return;
  }
  if (fs.statSync(absolutePath).size === 0) {
    fail(`required file: ${relativePath}`, "empty");
    return;
  }
  pass(`required file: ${relativePath}`);
}

function requireAnyNonEmptyFile(name: string, relativePaths: string[]) {
  const found = relativePaths.find((relativePath) => {
    const absolutePath = path.join(backupDir, relativePath);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0;
  });
  if (found) pass(`required file group: ${name}`, { file: found });
  else fail(`required file group: ${name}`, { missingOrEmpty: relativePaths });
}

function hasNonEmptyBackupFile(relativePath: string) {
  const absolutePath = path.join(backupDir, relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(backupDir, relativePath), "utf8")) as T;
}

function readRepoJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8")) as T;
}

function parseEnvKeys(relativePath: string) {
  const filePath = path.join(backupDir, relativePath);
  const keys = new Set<string>();
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match?.[1]) keys.add(match[1]);
  }
  return [...keys].sort();
}

function reportFreshness(report: { createdAt?: string }, relativePath: string) {
  if (!report.createdAt) {
    return { ok: false, detail: { report: relativePath, missing: "createdAt" } };
  }
  const createdAt = Date.parse(report.createdAt);
  if (!Number.isFinite(createdAt)) {
    return { ok: false, detail: { report: relativePath, invalidCreatedAt: report.createdAt } };
  }
  const ageMs = Date.now() - createdAt;
  return {
    ok: ageMs >= 0 && ageMs <= MAX_FINAL_DATA_REPORT_AGE_MS,
    detail: {
      report: relativePath,
      createdAt: report.createdAt,
      maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
      ageMs,
    },
  };
}

function reportTimestamp(value: string | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): Array<Record<string, string>> {
  return Array.isArray(value) ? (value as Array<Record<string, string>>) : [];
}

function secretNamesFromWranglerOutput(output: string) {
  const parsed = parseJsonFromOutput<unknown>(output, []);
  if (Array.isArray(parsed)) {
    return parsed.map((entry) => objectValue(entry).name ?? objectValue(entry).key).filter(isString);
  }
  const record = objectValue(parsed);
  if (Array.isArray(record.keys)) return record.keys.filter(isString);
  if (Array.isArray(record.secrets)) {
    return record.secrets.map((entry) => objectValue(entry).name ?? objectValue(entry).key).filter(isString);
  }
  return [];
}

function parseJsonFromOutput<T>(output: string, fallback: T): T {
  const trimmed = output.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const first =
      firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
    const last = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (first === -1 || last === -1 || last <= first) return fallback;
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as T;
    } catch {
      return fallback;
    }
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRuntimeMutableTable(table: TableName) {
  return (RUNTIME_MUTABLE_TABLES as readonly TableName[]).includes(table);
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}

function writeReport() {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: failed.length === 0,
    failedChecks: failed.length,
    checks,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}
