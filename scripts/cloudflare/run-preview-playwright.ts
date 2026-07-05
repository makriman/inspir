import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { buildRepoSourceFingerprint } from "./source-fingerprint";

const backupDir = resolveBackupDir();
const reportPath = path.join(cloudflareDir(backupDir), "playwright-preview-report.json");
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787";
const localCliBinDir = createLocalCliWrappers();
const sourceFingerprintBefore = buildRepoSourceFingerprint();

const result = spawnSync(path.resolve(process.cwd(), "node_modules", ".bin", "playwright"), ["test", "--reporter=json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: {
    ...commandEnv(),
    PLAYWRIGHT_BASE_URL: baseUrl,
    PLAYWRIGHT_START_CF_PREVIEW: "1",
    PATH: [localCliBinDir, commandEnv().PATH].join(path.delimiter),
  },
  maxBuffer: 128 * 1024 * 1024,
});
fs.rmSync(localCliBinDir, { recursive: true, force: true });

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const parsed = parsePlaywrightJson(output);
const sourceFingerprintAfter = buildRepoSourceFingerprint();
const sourceFingerprintStable = sourceFingerprintBefore.sha256 === sourceFingerprintAfter.sha256;
writeReport({
  ok: result.status === 0 && Boolean(parsed) && sourceFingerprintStable,
  exitCode: result.status,
  sourceFingerprintBefore,
  sourceFingerprintAfter,
  sourceFingerprintStable,
  stats: parsed?.stats ?? null,
  liveEnvironment: {
    requireLiveAi: process.env.REQUIRE_LIVE_AI === "1",
    googleEmail: Boolean(process.env.E2E_GOOGLE_EMAIL?.trim()),
    googlePassword: Boolean(process.env.E2E_GOOGLE_PASSWORD?.trim()),
    googleAdmin: process.env.E2E_GOOGLE_IS_ADMIN === "1",
  },
  rawOutput: parsed ? undefined : output,
  playwright: parsed,
});

if (result.status !== 0 || !parsed || !sourceFingerprintStable) process.exitCode = 1;

function createLocalCliWrappers() {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-preview-playwright-bin-"));
  const realPnpm = "/Users/makriman/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm";
  const wrapper = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repo = ${JSON.stringify(process.cwd())};
const realPnpm = ${JSON.stringify(realPnpm)};
const args = process.argv.slice(2);

function run(command, finalArgs) {
  const result = spawnSync(command, finalArgs, { cwd: repo, env: process.env, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (args[0] === "cf:preview") {
  const tsx = path.join(repo, "node_modules", ".bin", "tsx");
  let result = spawnSync(tsx, ["scripts/cloudflare/setup-local-d1.ts", "--reset-runtime-state"], { cwd: repo, env: process.env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  result = spawnSync(tsx, ["scripts/cloudflare/run-sanitized-build.ts", "opennext-preview"], { cwd: repo, env: process.env, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (args[0] === "cf:d1:local:setup") {
  run(path.join(repo, "node_modules", ".bin", "tsx"), ["scripts/cloudflare/setup-local-d1.ts", ...args.slice(1)]);
}

if (args[0] === "exec" && args[1]) {
  run(path.join(repo, "node_modules", ".bin", args[1]), args.slice(2));
}

run(realPnpm, args);
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
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(compactReport(report), null, 2));
}

function compactReport(report: Record<string, unknown>) {
  const sourceAfter = report.sourceFingerprintAfter as { sha256?: string; fileCount?: number } | undefined;
  const sourceBefore = report.sourceFingerprintBefore as { sha256?: string } | undefined;
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
    rawOutput: report.rawOutput ? String(report.rawOutput).slice(-4000) : undefined,
  };
}

function parsePlaywrightJson(output: string) {
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(output.slice(first, last + 1)) as { stats?: Record<string, unknown> };
  } catch {
    return null;
  }
}
