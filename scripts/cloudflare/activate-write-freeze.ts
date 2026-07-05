import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, resolveBackupDir } from "./migration-config";
import { freshBackupScopedReportBlockers } from "./fresh-report-gate";
import { buildSanitizedCloudflareBuildEnv, withSanitizedProjectEnvFiles } from "./sanitized-build-env";
import { writeBuildArtifactScanReport } from "./scan-build-artifacts";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import { buildWriteFreezeReadinessReport, type WriteFreezeReadinessReport } from "./write-freeze-evidence";

export const WRITE_FREEZE_DEPLOY_REPORT = "cloudflare/write-freeze-deploy-report.json";
const WRITE_FREEZE_WRANGLER_CONFIG = "cloudflare/write-freeze.wrangler.jsonc";
const SAFETY_REPORT_MAX_AGE_MS = 60 * 60 * 1000;
const FREEZE_ENV = {
  APP_WRITE_FREEZE: "1",
  APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
} as const;

type CheckStatus = "pass" | "fail";

type SafetyCheck = {
  name: string;
  status: CheckStatus;
  detail?: unknown;
};

type SourceScopedReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprint?: {
    sha256?: string;
    fileCount?: number;
  };
  sourceFingerprintAfter?: SourceFingerprint;
  findings?: unknown[];
  scannedFiles?: unknown;
  results?: unknown[];
  artifactRoot?: string;
  nextEnvFile?: string | null;
};

type WriteFreezeDeployReport = {
  createdAt: string;
  startedAt: string;
  completedAt: string;
  backupDir: string;
  ok: boolean;
  commandExecuted: boolean;
  status: number | null;
  command: string[];
  confirmations: Record<string, boolean>;
  freezeVars: typeof FREEZE_ENV;
  wranglerConfig: string;
  safetyChecks: SafetyCheck[];
  readiness: WriteFreezeReadinessReport | null;
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprintAfter: SourceFingerprint;
  sourceFingerprintStable: boolean;
  error?: string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void activateWriteFreeze().then((report) => {
    if (!report.ok) process.exitCode = report.status ?? 1;
  });
}

export async function activateWriteFreeze(options: { cwd?: string; backupDir?: string; env?: NodeJS.ProcessEnv } = {}) {
  const cwd = options.cwd ?? process.cwd();
  const backupDir = options.backupDir ?? resolveBackupDir();
  const env = options.env ?? process.env;
  const startedAt = new Date().toISOString();
  const sourceFingerprintBefore = buildRepoSourceFingerprint(cwd);
  const deployConfigRelativePath = "wrangler.write-freeze.jsonc";
  const deployConfigPath = path.join(cwd, deployConfigRelativePath);
  const command = [
    path.resolve(cwd, "node_modules/.bin/opennextjs-cloudflare"),
    "deploy",
    "--config",
    deployConfigRelativePath,
    "--keep-vars",
  ];

  let commandExecuted = false;
  let status: number | null = null;
  let readiness: WriteFreezeReadinessReport | null = null;
  let safetyChecks: SafetyCheck[] = [];
  let error: string | undefined;

  try {
    const confirmationProblems = writeFreezeDeployConfirmationProblems(backupDir, env);
    if (confirmationProblems.length) throw new Error(`Missing write-freeze deploy confirmations: ${confirmationProblems.join(", ")}`);

    const backupConfigPath = writeFreezeWranglerConfig(cwd, backupDir);
    const artifactScan = writeBuildArtifactScanReport(cwd, backupDir);
    safetyChecks = buildWriteFreezeDeploySafetyChecks({ backupDir, cwd });
    if (!artifactScan.ok || safetyChecks.some((check) => check.status !== "pass")) {
      throw new Error("Write-freeze deploy safety checks did not pass. Run pnpm cf:verify:local and retry.");
    }

    if (fs.existsSync(deployConfigPath)) throw new Error(`Temporary write-freeze config already exists: ${deployConfigPath}`);
    fs.copyFileSync(backupConfigPath, deployConfigPath);
    fs.chmodSync(deployConfigPath, 0o600);

    const deployEnv = buildSanitizedCloudflareBuildEnv(undefined, cwd, FREEZE_ENV);
    const result = withSanitizedProjectEnvFiles(
      () =>
        spawnSync(command[0]!, command.slice(1), {
          cwd,
          env: deployEnv,
          stdio: "inherit",
        }),
      cwd,
      { overrides: FREEZE_ENV },
    );
    commandExecuted = true;
    status = result.status;
    if (result.status !== 0) throw new Error(`OpenNext write-freeze deploy exited with status ${result.status ?? "unknown"}`);

    readiness = await buildWriteFreezeReadinessReport(backupDir, { env });
    if (readiness.writeFreezeActive !== true) {
      throw new Error("Write-freeze deploy completed, but the production readiness probe did not report writeFreezeActive=true.");
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    fs.rmSync(deployConfigPath, { force: true });
  }

  if (!readiness) {
    try {
      readiness = await buildWriteFreezeReadinessReport(backupDir, { env });
    } catch {
      readiness = null;
    }
  }

  const sourceFingerprintAfter = buildRepoSourceFingerprint(cwd);
  const sourceFingerprintStable = sourceFingerprintBefore.sha256 === sourceFingerprintAfter.sha256;
  const report: WriteFreezeDeployReport = {
    createdAt: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    backupDir,
    ok:
      !error &&
      commandExecuted &&
      status === 0 &&
      sourceFingerprintStable &&
      safetyChecks.every((check) => check.status === "pass") &&
      readiness?.writeFreezeActive === true,
    commandExecuted,
    status,
    command,
    confirmations: writeFreezeDeployConfirmations(backupDir, env),
    freezeVars: FREEZE_ENV,
    wranglerConfig: WRITE_FREEZE_WRANGLER_CONFIG,
    safetyChecks,
    readiness,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    sourceFingerprintStable,
    error,
  };
  writeReport(backupDir, report);
  console.log(JSON.stringify(compactReport(report), null, 2));
  return report;
}

export function writeFreezeWranglerConfig(cwd: string, backupDir: string) {
  const sourcePath = path.join(cwd, "wrangler.jsonc");
  const parsed = JSON.parse(stripJsonComments(fs.readFileSync(sourcePath, "utf8"))) as Record<string, unknown>;
  const vars = objectValue(parsed.vars);
  parsed.vars = {
    ...vars,
    ...FREEZE_ENV,
  };
  const outputPath = path.join(backupDir, WRITE_FREEZE_WRANGLER_CONFIG);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

export function buildWriteFreezeDeploySafetyChecks(input: { backupDir: string; cwd: string; nowMs?: number }): SafetyCheck[] {
  const currentSourceFingerprint = buildRepoSourceFingerprint(input.cwd);
  return [
    sourceScopedCheck({
      name: "local build and test gates",
      relativePath: "cloudflare/local-gates-report.json",
      report: readBackupJson<SourceScopedReport>(input.backupDir, "cloudflare/local-gates-report.json"),
      backupDir: input.backupDir,
      currentSourceFingerprint,
      nowMs: input.nowMs,
      fingerprintField: "sourceFingerprintAfter",
      extraOk: (report) => Array.isArray(report?.results),
    }),
    sourceScopedCheck({
      name: "source secret scan",
      relativePath: "cloudflare/source-secret-scan-report.json",
      report: readBackupJson<SourceScopedReport>(input.backupDir, "cloudflare/source-secret-scan-report.json"),
      backupDir: input.backupDir,
      currentSourceFingerprint,
      nowMs: input.nowMs,
      fingerprintField: "sourceFingerprint",
      extraOk: (report) => (report?.findings?.length ?? 0) === 0,
    }),
    sourceScopedCheck({
      name: "runtime provider dependency scan",
      relativePath: "cloudflare/runtime-provider-scan-report.json",
      report: readBackupJson<SourceScopedReport>(input.backupDir, "cloudflare/runtime-provider-scan-report.json"),
      backupDir: input.backupDir,
      currentSourceFingerprint,
      nowMs: input.nowMs,
      fingerprintField: "sourceFingerprint",
      extraOk: (report) => (report?.findings?.length ?? 0) === 0 && Array.isArray(report?.scannedFiles),
    }),
    sourceScopedCheck({
      name: "OpenNext build artifact secret scan",
      relativePath: "cloudflare/build-artifact-scan-report.json",
      report: readBackupJson<SourceScopedReport>(input.backupDir, "cloudflare/build-artifact-scan-report.json"),
      backupDir: input.backupDir,
      currentSourceFingerprint,
      nowMs: input.nowMs,
      fingerprintField: "sourceFingerprint",
      extraOk: (report) =>
        (report?.findings?.length ?? 0) === 0 &&
        report?.artifactRoot === ".open-next" &&
        report?.nextEnvFile === ".open-next/cloudflare/next-env.mjs" &&
        typeof report?.scannedFiles === "number" &&
        report.scannedFiles > 0,
    }),
  ];
}

function sourceScopedCheck(input: {
  name: string;
  relativePath: string;
  report: SourceScopedReport | null;
  backupDir: string;
  currentSourceFingerprint: SourceFingerprint;
  nowMs?: number;
  fingerprintField: "sourceFingerprint" | "sourceFingerprintAfter";
  extraOk?: (report: SourceScopedReport | null) => boolean;
}): SafetyCheck {
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: input.relativePath,
    report: input.report,
    backupDir: input.backupDir,
    maxAgeMs: SAFETY_REPORT_MAX_AGE_MS,
    nowMs: input.nowMs,
    requireOk: true,
  });
  const fingerprint = input.report?.[input.fingerprintField];
  const sourceFingerprintOk =
    fingerprint?.sha256 === input.currentSourceFingerprint.sha256 && fingerprint.fileCount === input.currentSourceFingerprint.fileCount;
  const extraOk = input.extraOk ? input.extraOk(input.report) : true;
  const ok = freshnessBlockers.length === 0 && sourceFingerprintOk && extraOk;
  return {
    name: input.name,
    status: ok ? "pass" : "fail",
    detail: ok
      ? { report: input.relativePath, sourceFingerprint: input.currentSourceFingerprint.sha256 }
      : {
          report: input.relativePath,
          freshnessBlockers,
          sourceFingerprintOk,
          expectedSourceFingerprint: fingerprint?.sha256,
          actualSourceFingerprint: input.currentSourceFingerprint.sha256,
          extraOk,
        },
  };
}

function writeFreezeDeployConfirmations(backupDir: string, env: NodeJS.ProcessEnv) {
  return {
    confirmWriteFreeze: env.CONFIRM_WRITE_FREEZE === "1",
    confirmWriteFreezeDeploy: env.CONFIRM_WRITE_FREEZE_DEPLOY === "1",
    confirmBackupDir: env.CONFIRM_BACKUP_DIR === backupDir,
  };
}

function writeFreezeDeployConfirmationProblems(backupDir: string, env: NodeJS.ProcessEnv) {
  const confirmations = writeFreezeDeployConfirmations(backupDir, env);
  const problems: string[] = [];
  if (!confirmations.confirmWriteFreeze) problems.push("CONFIRM_WRITE_FREEZE=1");
  if (!confirmations.confirmWriteFreezeDeploy) problems.push("CONFIRM_WRITE_FREEZE_DEPLOY=1");
  if (!confirmations.confirmBackupDir) problems.push(`CONFIRM_BACKUP_DIR=${backupDir}`);
  return problems;
}

function writeReport(backupDir: string, report: WriteFreezeDeployReport) {
  fs.writeFileSync(path.join(cloudflareDir(backupDir), path.basename(WRITE_FREEZE_DEPLOY_REPORT)), `${JSON.stringify(report, null, 2)}\n`, {
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

function compactReport(report: WriteFreezeDeployReport) {
  return {
    createdAt: report.createdAt,
    backupDir: report.backupDir,
    ok: report.ok,
    status: report.status,
    commandExecuted: report.commandExecuted,
    writeFreezeActive: report.readiness?.writeFreezeActive ?? null,
    sourceFingerprint: {
      before: report.sourceFingerprintBefore.sha256,
      after: report.sourceFingerprintAfter.sha256,
      stable: report.sourceFingerprintStable,
    },
    failedChecks: report.safetyChecks.filter((check) => check.status !== "pass").map((check) => check.name),
    error: report.error,
  };
}
