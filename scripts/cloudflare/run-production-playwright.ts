import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { FINAL_PRODUCTION_BASE_URL, normalizeBaseUrl } from "./final-cutover-evidence-chain";

const backupDir = resolveBackupDir();
const reportPath = path.join(cloudflareDir(backupDir), "playwright-production-report.json");
const baseUrl = normalizeBaseUrl(process.env.PLAYWRIGHT_BASE_URL ?? process.env.PRODUCTION_BASE_URL ?? FINAL_PRODUCTION_BASE_URL);
const usingMigrationSessionAuth = Boolean(process.env.E2E_TEST_AUTH_SECRET?.trim());

const missingEnv = ["E2E_GOOGLE_EMAIL"].filter((key) => !process.env[key]?.trim());
if (!usingMigrationSessionAuth && !process.env.E2E_GOOGLE_PASSWORD?.trim()) missingEnv.push("E2E_GOOGLE_PASSWORD");
if (process.env.REQUIRE_LIVE_AI !== "1") missingEnv.push("REQUIRE_LIVE_AI");
if (process.env.E2E_GOOGLE_IS_ADMIN !== "1") missingEnv.push("E2E_GOOGLE_IS_ADMIN");
if (baseUrl !== FINAL_PRODUCTION_BASE_URL) missingEnv.push("PLAYWRIGHT_BASE_URL=https://inspirlearning.com");
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
    googleEmail: Boolean(process.env.E2E_GOOGLE_EMAIL?.trim()),
    googlePassword: Boolean(process.env.E2E_GOOGLE_PASSWORD?.trim()),
    googleAdmin: process.env.E2E_GOOGLE_IS_ADMIN === "1",
    migrationSessionAuth: usingMigrationSessionAuth,
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
