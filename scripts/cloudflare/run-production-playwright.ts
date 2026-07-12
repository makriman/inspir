import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { redactProductionPlaywrightOutput } from "./production-playwright-safety";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";

const backupDir = resolveBackupDir();
const reportPath = path.join(cloudflareDir(backupDir), "playwright-production-report.json");
const FINAL_PRODUCTION_BASE_URL = "https://inspirlearning.com/";
const baseUrl = normalizeBaseUrl(process.env.PLAYWRIGHT_BASE_URL ?? process.env.PRODUCTION_BASE_URL ?? FINAL_PRODUCTION_BASE_URL);
const expectedWorkerVersion = getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION;
const e2eAuthSecret = process.env.E2E_TEST_AUTH_SECRET ?? "";
const e2eAuthEmail = process.env.E2E_TEST_AUTH_EMAIL ?? "";
const e2eMutationRunId = process.env.E2E_TEST_MUTATION_RUN_ID ?? "";
const e2eAuthExpiresAt = process.env.E2E_TEST_AUTH_EXPIRES_AT ?? "";

const missingEnv: string[] = [];
if (process.env.REQUIRE_LIVE_AI !== "1") missingEnv.push("REQUIRE_LIVE_AI");
if (baseUrl !== FINAL_PRODUCTION_BASE_URL) missingEnv.push("PLAYWRIGHT_BASE_URL=https://inspirlearning.com");
if (!expectedWorkerVersion || !isWorkerVersionId(expectedWorkerVersion)) {
  missingEnv.push("--expected-version=<Worker version UUID>");
}
if (Buffer.byteLength(e2eAuthSecret, "utf8") < 32 || !/^[\x21-\x7e]+$/.test(e2eAuthSecret)) {
  missingEnv.push("E2E_TEST_AUTH_SECRET=<at least 32 UTF-8 bytes>");
}
if (!isExactE2EEmail(e2eAuthEmail)) {
  missingEnv.push("E2E_TEST_AUTH_EMAIL=<exact lowercase configured admin email>");
}
if (!isLowercaseWorkerVersionId(e2eMutationRunId)) {
  missingEnv.push("E2E_TEST_MUTATION_RUN_ID=<exact lowercase run UUID>");
}
if (!isLiveE2EExpiry(e2eAuthExpiresAt, Date.now())) {
  missingEnv.push("E2E_TEST_AUTH_EXPIRES_AT=<live epoch-ms no more than two hours ahead>");
}
if (missingEnv.length) {
  writeReport({
    ok: false,
    error: "Missing required production Playwright environment",
    missingEnv,
  });
  process.exit(1);
}

const playwrightOutputDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "inspir-production-playwright-"),
);
fs.chmodSync(playwrightOutputDir, 0o700);
const result = (() => {
  try {
    return spawnSync(
      "pnpm",
      ["exec", "playwright", "test", "--reporter=json", "--output", playwrightOutputDir],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...commandEnv(),
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_DISABLE_TRACE: "1",
          PRODUCTION_E2E_READ_ONLY: "1",
          REQUIRE_LIVE_AI: "1",
          REQUIRE_AUTHENTICATED_E2E: "1",
          EXPECTED_WORKER_VERSION: expectedWorkerVersion ?? "",
          E2E_TEST_AUTH_SECRET: e2eAuthSecret,
          E2E_TEST_AUTH_EMAIL: e2eAuthEmail,
          E2E_TEST_MUTATION_RUN_ID: e2eMutationRunId,
          E2E_TEST_AUTH_EXPIRES_AT: e2eAuthExpiresAt,
        },
        maxBuffer: 128 * 1024 * 1024,
      },
    );
  } finally {
    fs.rmSync(playwrightOutputDir, { recursive: true, force: true });
  }
})();

const output = redactProductionPlaywrightOutput(
  `${result.stdout ?? ""}${result.stderr ?? ""}`,
  [e2eAuthSecret, e2eAuthEmail],
);
const parsed = parsePlaywrightJson(output);
const stats = parsed ? safePlaywrightStats(parsed.stats) : null;
writeReport({
  ok: result.status === 0 && Boolean(parsed) && Boolean(stats),
  exitCode: result.status,
  stats,
  outputBytes: Buffer.byteLength(output),
  detailedOutputPersisted: false,
  liveEnvironment: {
    requireLiveAi: process.env.REQUIRE_LIVE_AI === "1",
    authenticatedE2eRequired: true,
    migrationE2eAuth: true,
    migrationE2eAdminVerifiedByServer: true,
    deterministicExistingSession: true,
    expiringMigrationCapability: true,
    productionUserDataMutations: false,
    productScope: "multilingual-static-native-accounts-memory-admin-and-activities",
    expectedWorkerVersion,
  },
});

if (result.status !== 0 || !parsed || !stats) process.exitCode = 1;

function writeReport(extra: Record<string, unknown>) {
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    baseUrl,
    ...extra,
  };
  writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
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

function safePlaywrightStats(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const startTime = record.startTime;
  const duration = record.duration;
  const expected = record.expected;
  const skipped = record.skipped;
  const unexpected = record.unexpected;
  const flaky = record.flaky;
  if (
    typeof startTime !== "string" ||
    !Number.isFinite(Date.parse(startTime)) ||
    !isNonNegativeFiniteNumber(duration) ||
    !isNonNegativeSafeInteger(expected) ||
    !isNonNegativeSafeInteger(skipped) ||
    !isNonNegativeSafeInteger(unexpected) ||
    !isNonNegativeSafeInteger(flaky)
  ) return null;
  return { startTime, duration, expected, skipped, unexpected, flaky };
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
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

function isLowercaseWorkerVersionId(value: string) {
  return value === value.toLowerCase() && isWorkerVersionId(value);
}

function isLiveE2EExpiry(value: string, now: number) {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return false;
  const expiresAt = Number(value);
  return Number.isSafeInteger(expiresAt) && expiresAt > now && expiresAt <= now + 2 * 60 * 60 * 1_000;
}

function isExactE2EEmail(value: string) {
  return (
    value.length > 3 &&
    value.length <= 320 &&
    value === value.trim() &&
    value === value.toLowerCase() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}
