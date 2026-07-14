import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { supportedLanguages } from "../../lib/content/languages";
import {
  getPublishedLegacySiteTranslationPairs,
  legacyTranslationAssetPath,
} from "../../lib/i18n/legacy-api-compat";
import { parseConfiguredGlobalDailyCallLimit } from "../../lib/free-runtime/global-ai-budget";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  PROFILE_IMAGES_R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import { freshBackupScopedReportBlockers } from "./fresh-report-gate";
import { assertGitReleaseIdentity } from "./git-release-identity";
import {
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
  RUNTIME_MIGRATION_FILES,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
} from "./verify-d1-runtime-migrations";
import { readAndValidateHistoricalDataBaseline } from "./verify-historical-data-preservation";
import {
  readAndValidateHistoricalDataContinuityReport,
  type HistoricalDataContinuityPredecessorLoader,
} from "./verify-historical-data-continuity";
import {
  STATIC_ASSET_RELEASE_FILE_LIMIT,
  validateStaticMarketingAssetRelease,
} from "./materialize-static-marketing-assets";

type CheckStatus = "pass" | "fail";

type DeployPreflightCheck = {
  name: string;
  status: CheckStatus;
  detail?: unknown;
};

type LocalGatesReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprintAfter?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  results?: Array<{ id?: string; ok?: boolean }>;
};

type SourceSecretScanReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprint?: {
    sha256?: string;
    fileCount?: number;
  };
  findings?: unknown[];
};

type BuildArtifactScanReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprint?: SourceFingerprint;
  artifactRoot?: string;
  nextEnvFile?: string | null;
  scannedFiles?: number;
  findings?: unknown[];
};

type RuntimeMigrationEvidenceReport = {
  kind?: string;
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  database?: string;
  migrations?: string[];
  sourceFingerprintBefore?: SourceFingerprint;
  sourceFingerprint?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  rowsWritten?: number;
  checks?: Array<{ id?: string; ok?: boolean }>;
};

type DeployPreflightReport = {
  createdAt: string;
  backupDir: string;
  mode: "steady-state";
  ok: boolean;
  checks: DeployPreflightCheck[];
};

const REQUIRED_SECRET_KEYS = [
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "ADMIN_EMAILS",
  "CRON_SECRET",
];

const REQUIRED_WRANGLER_VARS = [
  "APP_URL",
  "AUTH_URL",
  "BETTER_AUTH_URL",
  "CLOUDFLARE_AI_GATEWAY_BASE_URL",
  "CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS",
  "OPENAI_MODEL",
  "OPENAI_FAST_MODEL",
  "OPENAI_REASONING_MODEL",
  "OPENAI_STRUCTURED_MODEL",
  "OPENAI_EMBEDDING_MODEL",
  "RATE_LIMIT_USER_CHAT_DAILY",
  "RATE_LIMIT_GUEST_SESSION_DAILY",
  "RATE_LIMIT_GUEST_FINGERPRINT_DAILY",
  "RATE_LIMIT_GUEST_IP_DAILY",
  "RATE_LIMIT_ACTIVITY_DAILY",
  "RATE_LIMIT_MEMORY_DAILY",
  "LLM_GLOBAL_DAILY_CALL_LIMIT",
  "MEMORY_POST_TURN_SYNTHESIS_THRESHOLD",
  "MEMORY_PROFILE_COMPILE_LIMIT",
  "OBSERVABILITY_INCIDENT_MODE",
  "APP_WRITE_FREEZE",
  "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS",
];

const SECRET_KEYS_THAT_MUST_NOT_BE_VARS = [
  "OPENAI_API_KEY",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AUTH_SECRET",
  "AUTH_GOOGLE_SECRET",
  "CRON_SECRET",
];
const STEADY_STATE_REPORT_MAX_AGE_MS = 60 * 60 * 1000;
const STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH =
  ".open-next/static-marketing-assets-report.json";
const EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS = {
  total: 280,
  mainApp: 70,
  site: 210,
  complete: 280,
  incomplete: 0,
} as const;
const EXPECTED_LEGACY_MAIN_APP_TRANSLATION_PATHS = supportedLanguages.map((language) =>
  legacyTranslationAssetPath({ kind: "main-app", language }),
);
const EXPECTED_LEGACY_SITE_TRANSLATION_PATHS = getPublishedLegacySiteTranslationPairs().map(
  ({ language, namespace }) =>
    legacyTranslationAssetPath({ kind: "site", language, namespace }),
);
const EXPECTED_LEGACY_TRANSLATION_PATHS = [
  ...EXPECTED_LEGACY_MAIN_APP_TRANSLATION_PATHS,
  ...EXPECTED_LEGACY_SITE_TRANSLATION_PATHS,
].sort();
const EXPECTED_LEGACY_TRANSLATION_PATH_SET = new Set(
  EXPECTED_LEGACY_TRANSLATION_PATHS,
);

export const FREE_PLAN_WORKER_FIRST_ROUTES = [
  "!/_next/static/*",
  "/api/account/topics",
  "/api/activities/flashcards",
  "/api/activities/flashcards/*",
  "/api/activities/quiz",
  "/api/activities/quiz/*",
  "/api/admin/dashboard",
  "/api/admin/topics",
  "/api/admin/users",
  "/api/analytics/events",
  "/api/auth",
  "/api/auth/*",
  "/api/chat",
  "/api/chat/finalize",
  "/api/chats",
  "/api/chats/*",
  "/api/cron/memory-dreaming",
  "/api/guest-chat",
  "/api/health",
  "/api/language-preference",
  "/api/logout",
  "/api/main-app-translations",
  "/api/migration/e2e-auth",
  "/api/migration/write-freeze",
  "/api/me",
  "/api/me/photo",
  "/api/memory",
  "/api/memory/*",
  "/api/site-translations",
  "/chat/*",
  "/*/chat/*",
] as const;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backupDir = resolveBackupDir();
  const report = buildSteadyStateDeployPreflightReport({ backupDir });
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function buildSteadyStateDeployPreflightReport(options: {
  backupDir: string;
  cwd?: string;
  nowMs?: number;
  runWranglerDryRun?: boolean;
  historicalDataContinuityPredecessorLoader?: HistoricalDataContinuityPredecessorLoader;
}): DeployPreflightReport {
  const cwd = options.cwd ?? process.cwd();
  const checks: DeployPreflightCheck[] = [];
  const currentSourceFingerprint = buildRepoSourceFingerprint(cwd);

  checks.push(gitReleaseIdentityCheck(cwd));
  checks.push(localGatesCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(sourceSecretScanCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(buildArtifactScanCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(staticMarketingAssetReleaseCheck(cwd, options.nowMs));
  checks.push(runtimeMigrationEvidenceCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(historicalDataBaselineCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(historicalDataContinuityCheck(
    options.backupDir,
    cwd,
    currentSourceFingerprint,
    options.nowMs,
    options.historicalDataContinuityPredecessorLoader,
  ));
  checks.push(wranglerConfigCheck(cwd));
  checks.push(leanWorkerArchitectureCheck(cwd));

  if (options.runWranglerDryRun !== false) {
    checks.push(remoteDurableObjectInfrastructureCheck());
    checks.push(wranglerDeployDryRunCheck());
  }

  return {
    createdAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    backupDir: options.backupDir,
    mode: "steady-state",
    ok: checks.every((check) => check.status === "pass"),
    checks,
  };
}

function gitReleaseIdentityCheck(cwd: string): DeployPreflightCheck {
  try {
    const identity = assertGitReleaseIdentity({ cwd });
    return {
      name: "clean pushed Git release identity",
      status: "pass",
      detail: identity,
    };
  } catch (error) {
    return {
      name: "clean pushed Git release identity",
      status: "fail",
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function remoteDurableObjectInfrastructureCheck(): DeployPreflightCheck {
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  const status = spawnSync(wrangler, ["deployments", "status", "--json", "--name", "inspirlearning"], {
    cwd: process.cwd(),
    env: commandEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (status.status !== 0) {
    return {
      name: "post-migration Durable Object infrastructure",
      status: "fail",
      detail: { status: status.status, outputTail: `${status.stdout ?? ""}${status.stderr ?? ""}`.slice(-2000) },
    };
  }
  const deployment = parseJsonFromOutput<{
    versions?: Array<{ version_id?: string; percentage?: number }>;
  }>(`${status.stdout ?? ""}${status.stderr ?? ""}`, {});
  const active = deployment.versions?.length === 1 && deployment.versions[0]?.percentage === 100
    ? deployment.versions[0]
    : null;
  if (!active?.version_id) {
    return {
      name: "post-migration Durable Object infrastructure",
      status: "fail",
      detail: { reason: "A single 100% infrastructure-compatible version is required.", versions: deployment.versions },
    };
  }

  const viewed = spawnSync(
    wrangler,
    ["versions", "view", active.version_id, "--name", "inspirlearning", "--json"],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (viewed.status !== 0) {
    return {
      name: "post-migration Durable Object infrastructure",
      status: "fail",
      detail: { status: viewed.status, outputTail: `${viewed.stdout ?? ""}${viewed.stderr ?? ""}`.slice(-2000) },
    };
  }
  const version = parseJsonFromOutput<Record<string, unknown>>(
    `${viewed.stdout ?? ""}${viewed.stderr ?? ""}`,
    {},
  );
  const resources = objectValue(version.resources);
  const bindings = Array.isArray(resources.bindings)
    ? resources.bindings.filter(
        (binding): binding is Record<string, unknown> =>
          binding !== null && typeof binding === "object" && !Array.isArray(binding),
      )
    : [];
  const queueBinding = bindings.find((binding) => binding.name === "NEXT_CACHE_DO_QUEUE");
  const ok =
    queueBinding?.type === "durable_object_namespace" &&
    queueBinding.class_name === "DOQueueHandler";
  return {
    name: "post-migration Durable Object infrastructure",
    status: ok ? "pass" : "fail",
    detail: ok
      ? { activeVersion: active.version_id, binding: "NEXT_CACHE_DO_QUEUE", className: "DOQueueHandler" }
      : { activeVersion: active.version_id, queueBinding: queueBinding ?? null },
  };
}

function localGatesCheck(backupDir: string, currentSourceFingerprint: SourceFingerprint, nowMs?: number): DeployPreflightCheck {
  const report = readBackupJson<LocalGatesReport>(backupDir, "cloudflare/local-gates-report.json");
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/local-gates-report.json",
    report,
    backupDir,
    maxAgeMs: STEADY_STATE_REPORT_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const resultsById = new Map((report?.results ?? []).map((result) => [result.id, result]));
  const missingGateIds = LOCAL_GATE_IDS.filter((id) => !resultsById.has(id));
  const failedGateIds = LOCAL_GATE_IDS.filter((id) => resultsById.get(id)?.ok !== true);
  const sourceFingerprintOk =
    report?.sourceFingerprintStable === true &&
    report.sourceFingerprintAfter?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprintAfter?.fileCount === currentSourceFingerprint.fileCount;
  const ok =
    report?.ok === true &&
    !freshnessBlockers.length &&
    backupDirOk &&
    sourceFingerprintOk &&
    !missingGateIds.length &&
    !failedGateIds.length;
  return {
    name: "local build and test gates",
    status: ok ? "pass" : "fail",
    detail: ok
      ? {
          sourceFingerprint: currentSourceFingerprint.sha256,
          gates: LOCAL_GATE_IDS,
        }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          backupDirOk,
          sourceFingerprintOk,
          missingGateIds,
          failedGateIds,
          expectedSourceFingerprint: report?.sourceFingerprintAfter?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
        },
  };
}

function sourceSecretScanCheck(backupDir: string, currentSourceFingerprint: SourceFingerprint, nowMs?: number): DeployPreflightCheck {
  const report = readBackupJson<SourceSecretScanReport>(backupDir, "cloudflare/source-secret-scan-report.json");
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/source-secret-scan-report.json",
    report,
    backupDir,
    maxAgeMs: STEADY_STATE_REPORT_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const sourceFingerprintOk =
    report?.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const findings = report?.findings?.length ?? 0;
  const ok = report?.ok === true && !freshnessBlockers.length && backupDirOk && sourceFingerprintOk && findings === 0;
  return {
    name: "source secret scan",
    status: ok ? "pass" : "fail",
    detail: ok
      ? { sourceFingerprint: currentSourceFingerprint.sha256 }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          backupDirOk,
          sourceFingerprintOk,
          findings,
        },
  };
}

function buildArtifactScanCheck(backupDir: string, currentSourceFingerprint: SourceFingerprint, nowMs?: number): DeployPreflightCheck {
  const report = readBackupJson<BuildArtifactScanReport>(backupDir, "cloudflare/build-artifact-scan-report.json");
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/build-artifact-scan-report.json",
    report,
    backupDir,
    maxAgeMs: STEADY_STATE_REPORT_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const findings = report?.findings?.length ?? 0;
  const scannedFilesOk = typeof report?.scannedFiles === "number" && report.scannedFiles > 0;
  const sourceFingerprintOk =
    report?.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const ok =
    report?.ok === true &&
    !freshnessBlockers.length &&
    backupDirOk &&
    sourceFingerprintOk &&
    report.artifactRoot === ".open-next" &&
    report.nextEnvFile === ".open-next/cloudflare/next-env.mjs" &&
    scannedFilesOk &&
    findings === 0;
  return {
    name: "OpenNext build artifact secret scan",
    status: ok ? "pass" : "fail",
    detail: ok
      ? { nextEnvFile: report?.nextEnvFile, sourceFingerprint: currentSourceFingerprint.sha256 }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          backupDirOk,
          sourceFingerprintOk,
          expectedSourceFingerprint: report?.sourceFingerprint?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
          artifactRoot: report?.artifactRoot,
          nextEnvFile: report?.nextEnvFile,
          scannedFiles: report?.scannedFiles,
          findings,
        },
  };
}

function staticMarketingAssetReleaseCheck(cwd: string, nowMs?: number): DeployPreflightCheck {
  const reportPath = path.join(cwd, STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    return {
      name: "Static Asset release and legacy translation report",
      status: "fail",
      detail: {
        reportPath: STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (!isRecord(parsed)) {
    return {
      name: "Static Asset release and legacy translation report",
      status: "fail",
      detail: {
        reportPath: STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH,
        reason: "The materialization report must be a JSON object.",
      },
    };
  }

  const generatedPaths = stringArrayValue(parsed.generatedPaths);
  const safeGeneratedPaths = generatedPaths ?? [];
  const legacyPaths = safeGeneratedPaths.filter((entry) =>
    entry.startsWith("i18n/legacy-api/"),
  );
  const actualLegacyPathSet = new Set(legacyPaths);
  const missingLegacyPaths = EXPECTED_LEGACY_TRANSLATION_PATHS.filter(
    (entry) => !actualLegacyPathSet.has(entry),
  );
  const extraLegacyPaths = [...actualLegacyPathSet]
    .filter((entry) => !EXPECTED_LEGACY_TRANSLATION_PATH_SET.has(entry))
    .sort();
  const duplicateLegacyPaths = duplicateStrings(legacyPaths);
  const incompleteLegacyPaths = [...actualLegacyPathSet]
    .filter((entry) => entry.includes(".incomplete"))
    .sort();
  const manifestCounts = {
    mainApp: EXPECTED_LEGACY_MAIN_APP_TRANSLATION_PATHS.length,
    site: EXPECTED_LEGACY_SITE_TRANSLATION_PATHS.length,
    total: EXPECTED_LEGACY_TRANSLATION_PATHS.length,
    unique: EXPECTED_LEGACY_TRANSLATION_PATH_SET.size,
  };
  const manifestCountsOk =
    manifestCounts.mainApp === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.mainApp &&
    manifestCounts.site === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.site &&
    manifestCounts.total === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.total &&
    manifestCounts.unique === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.total;
  const reportCounts = {
    total: parsed.legacyTranslationApiAssets,
    mainApp: parsed.legacyMainAppTranslationResponses,
    site: parsed.legacySiteTranslationResponses,
    complete: parsed.legacyCompleteTranslationResponses,
    incomplete: parsed.legacyIncompleteTranslationResponses,
  };
  const reportCountsOk =
    reportCounts.total === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.total &&
    reportCounts.mainApp === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.mainApp &&
    reportCounts.site === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.site &&
    reportCounts.complete === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.complete &&
    reportCounts.incomplete === EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS.incomplete;
  const assetFiles = parsed.assetFiles;
  const assetFileCountOk =
    typeof assetFiles === "number" &&
    Number.isSafeInteger(assetFiles) &&
    assetFiles >= safeGeneratedPaths.length &&
    assetFiles <= STATIC_ASSET_RELEASE_FILE_LIMIT;
  const legacyPathsOk =
    generatedPaths !== null &&
    sameStringSet(legacyPaths, EXPECTED_LEGACY_TRANSLATION_PATHS) &&
    incompleteLegacyPaths.length === 0;
  let releaseValidation: ReturnType<typeof validateStaticMarketingAssetRelease> | null = null;
  let releaseValidationError: string | null = null;
  try {
    releaseValidation = validateStaticMarketingAssetRelease(cwd, { nowMs });
  } catch (error) {
    releaseValidationError = error instanceof Error ? error.message : String(error);
  }
  const actualReleaseTreeOk = releaseValidation !== null;
  const ok =
    manifestCountsOk &&
    reportCountsOk &&
    assetFileCountOk &&
    legacyPathsOk &&
    actualReleaseTreeOk;

  return {
    name: "Static Asset release and legacy translation report",
    status: ok ? "pass" : "fail",
    detail: ok
      ? {
          assetFiles,
          assetFileLimit: STATIC_ASSET_RELEASE_FILE_LIMIT,
          legacyTranslationPaths: legacyPaths.length,
          mainAppTranslationPaths: manifestCounts.mainApp,
          siteTranslationPaths: manifestCounts.site,
          incompleteTranslationPaths: 0,
          assetManifestBytes: releaseValidation?.assetManifest.bytes,
          assetManifestSha256: releaseValidation?.assetManifest.sha256,
        }
      : {
          reportPath: STATIC_MARKETING_ASSET_REPORT_RELATIVE_PATH,
          manifestCounts,
          manifestCountsOk,
          expectedReportCounts: EXPECTED_LEGACY_TRANSLATION_REPORT_COUNTS,
          reportCounts,
          reportCountsOk,
          assetFiles,
          assetFileLimit: STATIC_ASSET_RELEASE_FILE_LIMIT,
          assetFileCountOk,
          generatedPathsOk: generatedPaths !== null,
          generatedPathCount: safeGeneratedPaths.length,
          legacyPathCount: legacyPaths.length,
          legacyPathsOk,
          missingLegacyPathCount: missingLegacyPaths.length,
          missingLegacyPaths: missingLegacyPaths.slice(0, 20),
          extraLegacyPathCount: extraLegacyPaths.length,
          extraLegacyPaths: extraLegacyPaths.slice(0, 20),
          duplicateLegacyPathCount: duplicateLegacyPaths.length,
          duplicateLegacyPaths: duplicateLegacyPaths.slice(0, 20),
          incompleteLegacyPathCount: incompleteLegacyPaths.length,
          incompleteLegacyPaths: incompleteLegacyPaths.slice(0, 20),
          actualReleaseTreeOk,
          releaseValidationError,
        },
  };
}

function runtimeMigrationEvidenceCheck(
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
): DeployPreflightCheck {
  const fileSecurity = backupEvidenceFileSecurity(
    backupDir,
    RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
  );
  const report = fileSecurity.ok
    ? readBackupJson<RuntimeMigrationEvidenceReport>(
        backupDir,
        RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
      )
    : null;
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
    report,
    backupDir,
    maxAgeMs: STEADY_STATE_REPORT_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const sourceFingerprintOk =
    report?.sourceFingerprintStable === true &&
    report.sourceFingerprintBefore?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprintBefore?.fileCount === currentSourceFingerprint.fileCount &&
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const migrationsOk = sameStringSequence(report?.migrations ?? [], RUNTIME_MIGRATION_FILES);
  const checksById = new Map((report?.checks ?? []).map((check) => [check.id, check]));
  const requiredChecksOk =
    report?.checks?.length === RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length &&
    checksById.size === RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length &&
    RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.every((id) => checksById.get(id)?.ok === true);
  const reportShapeOk =
    report?.kind === RUNTIME_MIGRATION_EVIDENCE_KIND &&
    report.database === D1_DATABASE_NAME &&
    report.rowsWritten === 0 &&
    migrationsOk &&
    requiredChecksOk;
  const ok =
    report?.ok === true &&
    freshnessBlockers.length === 0 &&
    fileSecurity.ok &&
    backupDirOk &&
    sourceFingerprintOk &&
    reportShapeOk;
  return {
    name: "D1 runtime migrations 0013-0016",
    status: ok ? "pass" : "fail",
    detail: ok
      ? {
          sourceFingerprint: currentSourceFingerprint.sha256,
          migrations: RUNTIME_MIGRATION_FILES,
          checks: RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
        }
      : {
          reportOk: report?.ok,
          freshnessBlockers,
          fileSecurity,
          backupDirOk,
          sourceFingerprintOk,
          reportShapeOk,
          migrationsOk,
          requiredChecksOk,
          expectedSourceFingerprint: currentSourceFingerprint.sha256,
          actualSourceFingerprint: report?.sourceFingerprint?.sha256,
        },
  };
}

function historicalDataBaselineCheck(
  backupDir: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
): DeployPreflightCheck {
  try {
    const baseline = readAndValidateHistoricalDataBaseline({
      backupDir,
      expectedSourceFingerprint: currentSourceFingerprint,
      now: new Date(nowMs ?? Date.now()),
    });
    return {
      name: "historical production data preservation baseline",
      status: "pass",
      detail: {
        createdAt: baseline.createdAt,
        utcDay: baseline.utcDay,
        operationId: baseline.operationId,
        sourceFingerprint: baseline.sourceFingerprint.sha256,
        rowsRead: baseline.rowsRead,
        rowsWritten: baseline.rowsWritten,
        ledgerRevision: baseline.ledger.revision,
      },
    };
  } catch (error) {
    return {
      name: "historical production data preservation baseline",
      status: "fail",
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function historicalDataContinuityCheck(
  backupDir: string,
  cwd: string,
  currentSourceFingerprint: SourceFingerprint,
  nowMs?: number,
  predecessorLoader?: HistoricalDataContinuityPredecessorLoader,
): DeployPreflightCheck {
  try {
    const report = readAndValidateHistoricalDataContinuityReport({
      backupDir,
      cwd,
      expectedSourceFingerprint: currentSourceFingerprint,
      predecessorLoader,
      now: new Date(nowMs ?? Date.now()),
    });
    return {
      name: "budget-rollover historical data continuity",
      status: "pass",
      detail: {
        policyId: report.policyId,
        predecessorSource: report.predecessor.source.sha256,
        successorSource: report.successor.source.sha256,
        successorBaselineCreatedAt: report.successor.baselineCreatedAt,
        gapMs: report.gapMs,
      },
    };
  } catch (error) {
    return {
      name: "budget-rollover historical data continuity",
      status: "fail",
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function backupEvidenceFileSecurity(backupDir: string, relativePath: string) {
  const filePath = path.join(backupDir, relativePath);
  try {
    const stat = fs.lstatSync(filePath);
    const mode = stat.mode & 0o777;
    const regularFile = stat.isFile();
    const symlink = stat.isSymbolicLink();
    return {
      ok: regularFile && !symlink && mode === 0o600,
      regularFile,
      symlink,
      mode,
    };
  } catch {
    return { ok: false, regularFile: false, symlink: false, mode: null };
  }
}

function wranglerConfigCheck(cwd: string): DeployPreflightCheck {
  const config = readRepoJson<Record<string, unknown>>(cwd, "wrangler.jsonc");
  const staticRedirectsPath = path.resolve(cwd, "public/_redirects");
  const staticRedirects = fs.existsSync(staticRedirectsPath)
    ? fs.readFileSync(staticRedirectsPath, "utf8")
    : "";
  const vars = objectValue(config.vars);
  const secrets = objectValue(config.secrets);
  const requiredSecrets = Array.isArray(secrets.required) ? secrets.required.filter(isString) : [];
  const d1 = arrayValue(config.d1_databases).find((binding) => binding.binding === "DB");
  const vectorize = arrayValue(config.vectorize).find((binding) => binding.binding === "MEMORY_VECTORIZE");
  const profileImagesR2 = arrayValue(config.r2_buckets).find(
    (binding) => binding.binding === "PROFILE_IMAGES_R2_BUCKET",
  );
  const nextCacheR2 = arrayValue(config.r2_buckets).find(
    (binding) => binding.binding === "NEXT_INC_CACHE_R2_BUCKET",
  );
  const queueProducer = arrayValue(objectValue(config.queues).producers).find(
    (binding) => binding.binding === "MEMORY_POST_TURN_QUEUE",
  );
  const queueConsumer = arrayValue(objectValue(config.queues).consumers).find(
    (binding) => binding.queue === MEMORY_POST_TURN_QUEUE_NAME,
  );
  const services = arrayValue(config.services).find((binding) => binding.binding === "WORKER_SELF_REFERENCE");
  const versionMetadata = objectValue(config.version_metadata);
  const cacheQueueDo = arrayValue(objectValue(config.durable_objects).bindings).find(
    (binding) => binding.name === "NEXT_CACHE_DO_QUEUE",
  );
  const cacheQueueMigration = arrayValue(config.migrations).find((migration) =>
    Array.isArray(migration.new_sqlite_classes) && migration.new_sqlite_classes.includes("DOQueueHandler"),
  );
  const routes = arrayValue(config.routes).map((route) => route.pattern);
  const observability = objectValue(config.observability);
  const configuredCrons = objectValue(config.triggers).crons;
  const assets = objectValue(config.assets);
  const workerFirstRoutes = Array.isArray(assets.run_worker_first)
    ? assets.run_worker_first.filter(isString)
    : [];
  const observabilityLogs = objectValue(observability.logs);
  const observabilityTraces = objectValue(observability.traces);
  const observabilityIncidentMode = vars.OBSERVABILITY_INCIDENT_MODE === "1";
  const observabilitySamplingOk = observabilityIncidentMode
    ? samplingRateAtMost(observability.head_sampling_rate, 1) &&
      samplingRateAtMost(observabilityLogs.head_sampling_rate, 1) &&
      samplingRateAtMost(observabilityTraces.head_sampling_rate, 1)
    : samplingRateAtMost(observability.head_sampling_rate, 0.05) &&
      samplingRateAtMost(observabilityLogs.head_sampling_rate, 0.1) &&
      samplingRateAtMost(observabilityTraces.head_sampling_rate, 0.05);

  const problems = {
    missingVars: REQUIRED_WRANGLER_VARS.filter((key) => vars[key] === undefined || vars[key] === ""),
    globalDailyCallLimitOk:
      parseConfiguredGlobalDailyCallLimit(vars.LLM_GLOBAL_DAILY_CALL_LIMIT) !== null,
    embeddingModelCompatible: vars.OPENAI_EMBEDDING_MODEL === "text-embedding-3-small",
    leakedSecretVars: SECRET_KEYS_THAT_MUST_NOT_BE_VARS.filter((key) => vars[key] !== undefined),
    requiredSecretsOk: sameStringSet(requiredSecrets, REQUIRED_SECRET_KEYS),
    d1Ok: d1?.database_name === D1_DATABASE_NAME && d1?.database_id === D1_DATABASE_ID,
    memoryBindingsOk:
      vectorize?.index_name === VECTORIZE_INDEX_NAME &&
      profileImagesR2?.bucket_name === PROFILE_IMAGES_R2_BUCKET_NAME &&
      nextCacheR2 === undefined &&
      arrayValue(config.r2_buckets).length === 1 &&
      queueProducer?.queue === MEMORY_POST_TURN_QUEUE_NAME &&
      queueConsumer?.queue === MEMORY_POST_TURN_QUEUE_NAME &&
      queueConsumer.dead_letter_queue === MEMORY_POST_TURN_DLQ_NAME &&
      Number(queueConsumer.max_batch_size) === 1 &&
      Number(queueConsumer.max_batch_timeout) <= 10 &&
      Number(queueConsumer.max_retries) >= 1 &&
      Array.isArray(configuredCrons) &&
      sameStringSet(configuredCrons.filter(isString), ["0 3 * * *"]),
    serviceOk: services?.service === "inspirlearning",
    versionMetadataOk: versionMetadata.binding === "CF_VERSION_METADATA",
    cacheRevalidationDoOk: cacheQueueDo?.class_name === "DOQueueHandler",
    cacheRevalidationMigrationOk: cacheQueueMigration !== undefined,
    routesOk: routes.includes("inspirlearning.com") && routes.includes("www.inspirlearning.com"),
    appUrlOk:
      vars.APP_URL === "https://inspirlearning.com" &&
      vars.AUTH_URL === "https://inspirlearning.com" &&
      vars.BETTER_AUTH_URL === "https://inspirlearning.com",
    mainEntryOk: config.main === "./cloudflare-worker.ts",
    workersDevOk: config.workers_dev === false,
    previewUrlsOk: config.preview_urls === false,
    workerGlobalCacheOk: config.cache === undefined || objectValue(config.cache).enabled === false,
    freePlanCpuConfigOk: config.limits === undefined,
    staticAssetsOk:
      assets.directory === ".open-next/assets" &&
      assets.binding === "ASSETS" &&
      assets.html_handling === "drop-trailing-slash" &&
      assets.not_found_handling === "404-page" &&
      sameStringSet(workerFirstRoutes, FREE_PLAN_WORKER_FIRST_ROUTES),
    staticLegalRedirectOk: /^\/tnc\s+\/terms\s+308\s*$/m.test(staticRedirects),
    observabilityOk:
      observability.enabled === true &&
      observabilityLogs.enabled === true &&
      observabilityTraces.enabled === true &&
      observabilitySamplingOk,
    observabilitySampling: {
      incidentMode: observabilityIncidentMode,
      worker: observability.head_sampling_rate,
      logs: observabilityLogs.head_sampling_rate,
      traces: observabilityTraces.head_sampling_rate,
    },
  };
  const ok =
    !problems.missingVars.length &&
    problems.globalDailyCallLimitOk &&
    problems.embeddingModelCompatible &&
    !problems.leakedSecretVars.length &&
    problems.requiredSecretsOk &&
    problems.d1Ok &&
    problems.memoryBindingsOk &&
    problems.serviceOk &&
    problems.versionMetadataOk &&
    problems.cacheRevalidationDoOk &&
    problems.cacheRevalidationMigrationOk &&
    problems.routesOk &&
    problems.appUrlOk &&
    problems.mainEntryOk &&
    problems.workersDevOk &&
    problems.previewUrlsOk &&
    problems.workerGlobalCacheOk &&
    problems.freePlanCpuConfigOk &&
    problems.staticAssetsOk &&
    problems.staticLegalRedirectOk &&
    problems.observabilityOk;
  return {
    name: "Wrangler production config",
    status: ok ? "pass" : "fail",
    detail: ok ? { worker: "inspirlearning", deploymentMode: "free-static-native-accounts" } : problems,
  };
}

function leanWorkerArchitectureCheck(cwd: string): DeployPreflightCheck {
  const filePath = path.join(cwd, "cloudflare-worker.ts");
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const materializerPath = path.join(cwd, "scripts/cloudflare/materialize-static-marketing-assets.ts");
  const materializer = fs.existsSync(materializerPath) ? fs.readFileSync(materializerPath, "utf8") : "";
  const translationAssetPath = path.join(cwd, "lib/i18n/main-app-static-asset.ts");
  const translationAsset = fs.existsSync(translationAssetPath) ? fs.readFileSync(translationAssetPath, "utf8") : "";
  const architecture = {
    noOpenNextRuntimeImport: !hasOpenNextRequestRuntimeImport(source),
    nativeGuestHandler: /handleFreeGuestChat/.test(source),
    nativeLegacyI18nHandler: /handleLegacyI18nApiRequest/.test(source),
    nativeAccountHandler: /handleAccountApiRequest/.test(source),
    nativeAccountPrewarm:
      /prewarmAccountApi/.test(source) && /env as workerEnv/.test(source),
    nativeStateHandler: /handleStateApiRequest/.test(source),
    nativeProtectedAiHandler: /handleProtectedAiApiRequest/.test(source),
    nativeMemoryBackgroundHandlers: /handleMemoryScheduled/.test(source) && /handleMemoryQueue/.test(source),
    nativeHealthHandler: /CF_VERSION_METADATA/.test(source),
    legacyDoExportRetained: /DOQueueHandler/.test(source),
    staticChatDocuments: /staticChatCacheKeys/.test(materializer),
    exactStaticChatRedirects:
      /Exact public topic redirects/.test(materializer) &&
      /\/chat\?topic=/.test(materializer) &&
      / 308/.test(materializer),
    staticTopicsDocument: /api\/topics/.test(materializer),
    staticAdminDocument: /admin\/index\.html/.test(materializer),
    staticMainAppBundles:
      /writeStaticMainAppBundles/.test(materializer) && /i18n\/main-app/.test(materializer),
    staticLegacyTranslationResponses:
      /materializeLegacyTranslationApiAssets/.test(materializer) && /legacyTranslationApiAssets/.test(materializer),
    accountTranslationsIncluded: !/retiredStaticGuestAuthTranslationKeys/.test(translationAsset),
  };
  const ok = Object.values(architecture).every(Boolean);
  return {
    name: "Free static and native account architecture",
    status: ok ? "pass" : "fail",
    detail: ok
      ? { workerRuntime: "native-auth-state-ai", publicRuntime: "static-assets", openNextRuntime: false }
      : architecture,
  };
}

export function hasOpenNextRequestRuntimeImport(source: string): boolean {
  const importSpecifiers = [
    ...source.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/g),
  ]
    .map((match) => match[1])
    .filter((specifier): specifier is string => typeof specifier === "string");

  return importSpecifiers.some(
    (specifier) =>
      specifier.includes(".open-next/") ||
      specifier === "@opennextjs/cloudflare" ||
      specifier.startsWith("@opennextjs/cloudflare/") ||
      specifier === "next" ||
      specifier.startsWith("next/"),
  );
}

function wranglerDeployDryRunCheck(): DeployPreflightCheck {
  const result = spawnSync(path.resolve(process.cwd(), "node_modules/.bin/wrangler"), ["deploy", "--dry-run"], {
    cwd: process.cwd(),
    env: commandEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name: "Wrangler deploy dry run",
    status: result.status === 0 ? "pass" : "fail",
    detail:
      result.status === 0
        ? { status: result.status }
        : {
            status: result.status,
            outputTail: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000),
          },
  };
}

function writeReport(report: DeployPreflightReport) {
  fs.writeFileSync(path.join(cloudflareDir(report.backupDir), "deploy-preflight-report.json"), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}

function readBackupJson<T>(backupDir: string, relativePath: string): T | null {
  const filePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function readRepoJson<T>(cwd: string, relativePath: string): T {
  return JSON.parse(stripJsonComments(fs.readFileSync(path.join(cwd, relativePath), "utf8"))) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): Array<Record<string, string>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, string> => Boolean(item && typeof item === "object")) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function stringArrayValue(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isString) ? value : null;
}

function duplicateStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates].sort();
}

function samplingRateAtMost(value: unknown, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= max;
}

function sameStringSet(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
}

function sameStringSequence(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && expected.every((value, index) => actual[index] === value);
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
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  }
}

function stripJsonComments(input: string) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}
