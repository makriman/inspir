import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

const backupDir = resolveBackupDir();
const reportPath = path.join(cloudflareDir(backupDir), "playwright-production-report.json");
const FINAL_PRODUCTION_BASE_URL = "https://inspirlearning.com/";
const baseUrl = normalizeBaseUrl(process.env.PLAYWRIGHT_BASE_URL ?? process.env.PRODUCTION_BASE_URL ?? FINAL_PRODUCTION_BASE_URL);
const expectedWorkerVersion = getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION;

const missingEnv: string[] = [];
if (process.env.REQUIRE_LIVE_AI !== "1") missingEnv.push("REQUIRE_LIVE_AI");
if (baseUrl !== FINAL_PRODUCTION_BASE_URL) missingEnv.push("PLAYWRIGHT_BASE_URL=https://inspirlearning.com");
if (!expectedWorkerVersion || !isWorkerVersionId(expectedWorkerVersion)) {
  missingEnv.push("--expected-version=<Worker version UUID>");
}
if (missingEnv.length) {
  writeReport({
    ok: false,
    error: "Missing required production Playwright environment",
    missingEnv,
  });
  process.exit(1);
}

const result = spawnSync("pnpm", ["exec", "playwright", "test", "--reporter=json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: {
    ...commandEnv(),
    PLAYWRIGHT_BASE_URL: baseUrl,
    REQUIRE_LIVE_AI: "1",
    EXPECTED_WORKER_VERSION: expectedWorkerVersion ?? "",
  },
  maxBuffer: 128 * 1024 * 1024,
});

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const parsed = parsePlaywrightJson(output);
writeReport({
  ok: result.status === 0 && Boolean(parsed),
  exitCode: result.status,
  stats: parsed?.stats ?? null,
  rawOutput: parsed ? undefined : output,
  liveEnvironment: {
    requireLiveAi: process.env.REQUIRE_LIVE_AI === "1",
    productScope: "multilingual-static-and-guest-chat",
    expectedWorkerVersion,
  },
  playwright: parsed,
});

if (result.status !== 0 || !parsed) process.exitCode = 1;

function writeReport(extra: Record<string, unknown>) {
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    baseUrl,
    ...extra,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
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

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isWorkerVersionId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
