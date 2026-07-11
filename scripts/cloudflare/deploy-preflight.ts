import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import { freshBackupScopedReportBlockers } from "./fresh-report-gate";

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

type DeployPreflightReport = {
  createdAt: string;
  backupDir: string;
  mode: "steady-state";
  ok: boolean;
  checks: DeployPreflightCheck[];
};

const REQUIRED_SECRET_KEYS = [
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
];

const REQUIRED_WRANGLER_VARS = [
  "CLOUDFLARE_AI_GATEWAY_BASE_URL",
  "CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS",
  "OPENAI_MODEL",
  "OPENAI_FAST_MODEL",
  "OPENAI_REASONING_MODEL",
  "OPENAI_STRUCTURED_MODEL",
  "RATE_LIMIT_GUEST_SESSION_DAILY",
  "RATE_LIMIT_GUEST_FINGERPRINT_DAILY",
  "RATE_LIMIT_GUEST_IP_DAILY",
  "LLM_GLOBAL_DAILY_CALL_LIMIT",
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

export const FREE_PLAN_WORKER_FIRST_ROUTES = [
  "/api/guest-chat",
  "/api/health",
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
}): DeployPreflightReport {
  const cwd = options.cwd ?? process.cwd();
  const checks: DeployPreflightCheck[] = [];
  const currentSourceFingerprint = buildRepoSourceFingerprint(cwd);

  checks.push(localGatesCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(sourceSecretScanCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
  checks.push(buildArtifactScanCheck(options.backupDir, currentSourceFingerprint, options.nowMs));
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
    leakedSecretVars: SECRET_KEYS_THAT_MUST_NOT_BE_VARS.filter((key) => vars[key] !== undefined),
    requiredSecretsOk: sameStringSet(requiredSecrets, REQUIRED_SECRET_KEYS),
    d1Ok: d1?.database_name === D1_DATABASE_NAME && d1?.database_id === D1_DATABASE_ID,
    retiredBindingsAbsent:
      arrayValue(config.vectorize).length === 0 &&
      arrayValue(config.r2_buckets).length === 0 &&
      arrayValue(objectValue(config.queues).producers).length === 0 &&
      arrayValue(objectValue(config.queues).consumers).length === 0 &&
      (!Array.isArray(configuredCrons) || configuredCrons.length === 0),
    serviceOk: services?.service === "inspirlearning",
    versionMetadataOk: versionMetadata.binding === "CF_VERSION_METADATA",
    cacheRevalidationDoOk: cacheQueueDo?.class_name === "DOQueueHandler",
    cacheRevalidationMigrationOk: cacheQueueMigration !== undefined,
    routesOk: routes.includes("inspirlearning.com") && routes.includes("www.inspirlearning.com"),
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
    !problems.leakedSecretVars.length &&
    problems.requiredSecretsOk &&
    problems.d1Ok &&
    problems.retiredBindingsAbsent &&
    problems.serviceOk &&
    problems.versionMetadataOk &&
    problems.cacheRevalidationDoOk &&
    problems.cacheRevalidationMigrationOk &&
    problems.routesOk &&
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
    detail: ok ? { worker: "inspirlearning", deploymentMode: "free-static-lean-guest" } : problems,
  };
}

function leanWorkerArchitectureCheck(cwd: string): DeployPreflightCheck {
  const filePath = path.join(cwd, "cloudflare-worker.ts");
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const materializerPath = path.join(cwd, "scripts/cloudflare/materialize-static-marketing-assets.ts");
  const materializer = fs.existsSync(materializerPath) ? fs.readFileSync(materializerPath, "utf8") : "";
  const architecture = {
    noOpenNextRuntimeImport: !hasOpenNextRequestRuntimeImport(source),
    nativeGuestHandler: /handleFreeGuestChat/.test(source),
    nativeHealthHandler: /CF_VERSION_METADATA/.test(source),
    legacyDoExportRetained: /DOQueueHandler/.test(source),
    staticChatDocuments: /staticChatCacheKeys/.test(materializer),
    exactStaticChatRedirects:
      /Exact public topic redirects/.test(materializer) &&
      /\/chat\?topic=/.test(materializer) &&
      / 308/.test(materializer),
    staticTopicsDocument: /api\/topics/.test(materializer),
    staticMainAppBundles:
      /writeStaticMainAppBundles/.test(materializer) && /i18n\/main-app/.test(materializer),
  };
  const ok = Object.values(architecture).every(Boolean);
  return {
    name: "Free static and lean guest architecture",
    status: ok ? "pass" : "fail",
    detail: ok ? { workerRuntime: "native-health-and-guest-chat", publicRuntime: "static-assets" } : architecture,
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
      (specifier.includes(".open-next/") &&
        specifier !== "./.open-next/.build/durable-objects/queue.js") ||
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): Array<Record<string, string>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, string> => Boolean(item && typeof item === "object")) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function samplingRateAtMost(value: unknown, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= max;
}

function sameStringSet(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
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
