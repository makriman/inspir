import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
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
const STEADY_STATE_REPORT_MAX_AGE_MS = 60 * 60 * 1000;

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

  if (options.runWranglerDryRun !== false) {
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
  const vars = objectValue(config.vars);
  const secrets = objectValue(config.secrets);
  const requiredSecrets = Array.isArray(secrets.required) ? secrets.required.filter(isString) : [];
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
  const routes = arrayValue(config.routes).map((route) => route.pattern);
  const cron = objectValue(config.triggers).crons;
  const observability = objectValue(config.observability);
  const observabilityLogs = objectValue(observability.logs);
  const observabilityTraces = objectValue(observability.traces);

  const problems = {
    missingVars: REQUIRED_WRANGLER_VARS.filter((key) => vars[key] === undefined || vars[key] === ""),
    leakedSecretVars: SECRET_KEYS_THAT_MUST_NOT_BE_VARS.filter((key) => vars[key] !== undefined),
    missingRequiredSecrets: REQUIRED_SECRET_KEYS.filter((key) => !requiredSecrets.includes(key)),
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
  };
  const ok =
    !problems.missingVars.length &&
    !problems.leakedSecretVars.length &&
    !problems.missingRequiredSecrets.length &&
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
    problems.observabilityOk;
  return {
    name: "Wrangler production config",
    status: ok ? "pass" : "fail",
    detail: ok ? { worker: "inspirlearning" } : problems,
  };
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
