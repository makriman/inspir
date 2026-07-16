import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import {
  PREVIEW_E2E_EVIDENCE_KIND,
  PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION,
  analyzePreviewE2EPlaywrightReport,
} from "./preview-e2e-evidence";
import {
  redactPlaywrightJsonEvidence,
  redactProductionPlaywrightOutput,
} from "./production-playwright-safety";
import { clearLocalPreviewCacheApiState } from "./run-sanitized-build";
import {
  localPreviewProviderSecretValues,
  resolveLocalPreviewE2EAuth,
  resolveLocalPreviewProviderRuntimeSecrets,
} from "./sanitized-build-env";
import { buildRepoSourceFingerprint } from "./source-fingerprint";

const backupDir = resolveBackupDir();
const reportPath = path.join(cloudflareDir(backupDir), "playwright-preview-report.json");
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787";
clearLocalPreviewCacheApiState();
const sourceFingerprintBefore = buildRepoSourceFingerprint();
const commandEnvironment = commandEnv();
const localPreviewE2EAuth = resolveLocalPreviewE2EAuth(commandEnvironment);
const authenticatedE2eConfigured = localPreviewE2EAuth.configured;
const localPreviewProviderSecrets =
  resolveLocalPreviewProviderRuntimeSecrets(commandEnvironment);
const providerRuntimeCredentialConfigured = Boolean(
  localPreviewProviderSecrets.CLOUDFLARE_AI_GATEWAY_TOKEN,
);
const sensitiveValues = [
  localPreviewE2EAuth.secret ?? "",
  localPreviewE2EAuth.email ?? "",
  ...localPreviewProviderSecretValues(localPreviewProviderSecrets),
];
const localPreviewE2EAuthEnv = localPreviewE2EAuth.configured
  ? {
      E2E_TEST_AUTH_SECRET: localPreviewE2EAuth.secret,
      E2E_TEST_AUTH_EMAIL: localPreviewE2EAuth.email,
    }
  : {};
const liveEnvironment = {
  requireLiveAi: process.env.REQUIRE_LIVE_AI === "1",
  providerRuntimeCredentialConfigured,
  authenticatedE2eRequired: true,
  migrationE2eAuth: authenticatedE2eConfigured,
  productionE2eReadOnly: false,
  googleEmail: Boolean(process.env.E2E_GOOGLE_EMAIL?.trim()),
  googlePassword: Boolean(process.env.E2E_GOOGLE_PASSWORD?.trim()),
  googleAdmin: process.env.E2E_GOOGLE_IS_ADMIN === "1",
  productScope: "multilingual-static-native-accounts-memory-admin-and-activities",
} as const;
const requirementBlockers = [
  ...(liveEnvironment.requireLiveAi
    ? []
    : ["REQUIRE_LIVE_AI=1 is required for release preview E2E."]),
  ...(authenticatedE2eConfigured
    ? []
    : [
        "A lowercase E2E_TEST_AUTH_EMAIL and 32-to-512-byte printable E2E_TEST_AUTH_SECRET are required for release preview E2E.",
      ]),
  ...(providerRuntimeCredentialConfigured
    ? []
    : [
        "A local CLOUDFLARE_AI_GATEWAY_TOKEN is required for release preview E2E live AI.",
      ]),
];

let exitCode: number | null = null;
let output = requirementBlockers.join("\n");
let parsed: unknown = null;

if (requirementBlockers.length === 0) {
  const localCliBinDir = createLocalCliWrappers();
  const playwrightReportDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-preview-playwright-report-"),
  );
  const playwrightReportPath = path.join(
    playwrightReportDirectory,
    "report.json",
  );
  const playwrightArtifactsDirectory = path.join(
    playwrightReportDirectory,
    "artifacts",
  );
  try {
    const result = spawnSync(
      path.resolve(process.cwd(), "node_modules", ".bin", "playwright"),
      ["test", "--reporter=json", "--output", playwrightArtifactsDirectory],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...commandEnvironment,
          ...localPreviewE2EAuthEnv,
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_START_CF_PREVIEW: "1",
          EXPECTED_WORKER_VERSION: "",
          PLAYWRIGHT_DISABLE_TRACE: "1",
          PRODUCTION_E2E_READ_ONLY: "0",
          REQUIRE_AUTHENTICATED_E2E: "1",
          REQUIRE_LIVE_AI: "1",
          PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightReportPath,
          PATH: [localCliBinDir, commandEnvironment.PATH].join(path.delimiter),
        },
        maxBuffer: 128 * 1024 * 1024,
      },
    );
    exitCode = result.status;
    output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    parsed = redactPlaywrightJsonEvidence(
      readPlaywrightJsonReport(playwrightReportPath),
      sensitiveValues,
    );
  } finally {
    fs.rmSync(localCliBinDir, { recursive: true, force: true });
    fs.rmSync(playwrightReportDirectory, { recursive: true, force: true });
  }
}

const sourceFingerprintAfter = buildRepoSourceFingerprint();
const sourceFingerprintStable = sourceFingerprintBefore.sha256 === sourceFingerprintAfter.sha256;
const coverage = analyzePreviewE2EPlaywrightReport(parsed);
const redactedOutput = redactProductionPlaywrightOutput(output, sensitiveValues);
const ok =
  requirementBlockers.length === 0 &&
  exitCode === 0 &&
  parsed !== null &&
  sourceFingerprintStable &&
  coverage.ok;
writeReport({
  kind: PREVIEW_E2E_EVIDENCE_KIND,
  schemaVersion: PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION,
  ok,
  exitCode,
  sourceFingerprintBefore,
  sourceFingerprintAfter,
  sourceFingerprintStable,
  stats: playwrightStats(parsed),
  liveEnvironment,
  coverage,
  requirementBlockers,
  rawOutput: parsed ? undefined : redactedOutput.slice(-12_000),
  playwright: parsed,
});

if (!ok) process.exitCode = 1;

function createLocalCliWrappers() {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-preview-playwright-bin-"));
  const wrapper = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = ${JSON.stringify(process.cwd())};
const args = process.argv.slice(2);

function run(command, finalArgs) {
  const result = spawnSync(command, finalArgs, { cwd: repo, env: process.env, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

function pathEntries() {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter((entry) => entry && path.resolve(entry) !== __dirname);
}

function executableNames(name) {
  return process.platform === "win32" ? [name + ".cmd", name + ".exe", name] : [name];
}

function findOnPath(name) {
  for (const entry of pathEntries()) {
    for (const executable of executableNames(name)) {
      const candidate = path.join(entry, executable);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function packageManagerInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    if (/\\.(?:cjs|mjs|js)$/.test(npmExecPath)) return { command: process.execPath, argsPrefix: [npmExecPath] };
    return { command: npmExecPath, argsPrefix: [] };
  }
  const pnpm = findOnPath("pnpm");
  return { command: pnpm || "pnpm", argsPrefix: [] };
}

if (args[0] === "cf:preview") {
  const tsx = path.join(repo, "node_modules", ".bin", "tsx");
  let result = spawnSync(tsx, ["scripts/cloudflare/setup-local-d1.ts", "--reset-runtime-state"], { cwd: repo, env: process.env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  result = spawnSync(tsx, ["scripts/cloudflare/run-sanitized-build.ts", "wrangler-preview"], { cwd: repo, env: process.env, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (args[0] === "cf:d1:local:setup") {
  run(path.join(repo, "node_modules", ".bin", "tsx"), ["scripts/cloudflare/setup-local-d1.ts", ...args.slice(1)]);
}

if (args[0] === "exec" && args[1]) {
  run(path.join(repo, "node_modules", ".bin", args[1]), args.slice(2));
}

const packageManager = packageManagerInvocation();
run(packageManager.command, [...packageManager.argsPrefix, ...args]);
`;
  const wrapperPath = path.join(binDir, "pnpm");
  fs.writeFileSync(wrapperPath, wrapper, { mode: 0o700 });
  fs.chmodSync(wrapperPath, 0o700);
  return binDir;
}

function writeReport(extra: Record<string, unknown>) {
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    baseUrl,
    ...extra,
  };
  writePrivateReportAtomically(report);
  console.log(JSON.stringify(compactReport(report), null, 2));
}

function writePrivateReportAtomically(report: Record<string, unknown>) {
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  const directory = path.dirname(reportPath);
  const temporaryPath = path.join(
    directory,
    `.playwright-preview-report.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, reportPath);
    const directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

function compactReport(report: Record<string, unknown>) {
  const sourceAfter = isRecord(report.sourceFingerprintAfter)
    ? report.sourceFingerprintAfter
    : null;
  const sourceBefore = isRecord(report.sourceFingerprintBefore)
    ? report.sourceFingerprintBefore
    : null;
  return {
    createdAt: report.createdAt,
    backupDir: report.backupDir,
    baseUrl: report.baseUrl,
    ok: report.ok,
    exitCode: report.exitCode,
    sourceFingerprint: {
      before: sourceBefore?.sha256,
      after: sourceAfter?.sha256,
      stable: report.sourceFingerprintStable,
      fileCount: sourceAfter?.fileCount,
    },
    stats: report.stats,
    liveEnvironment: report.liveEnvironment,
    coverage: report.coverage,
    requirementBlockers: report.requirementBlockers,
    diagnosticOutputPersisted: Boolean(report.rawOutput),
  };
}

function readPlaywrightJsonReport(filePath: string) {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size <= 0 ||
      stat.size > 64 * 1_024 * 1_024
    ) {
      return null;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    return parsed;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function playwrightStats(value: unknown) {
  if (!isRecord(value) || !isRecord(value.stats)) return null;
  return value.stats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
