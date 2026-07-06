import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSteadyStateDeployPreflightReport } from "../scripts/cloudflare/deploy-preflight";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  PROFILE_IMAGES_R2_BUCKET_NAME,
  R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
} from "../scripts/cloudflare/migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";

test("steady-state deploy preflight accepts fresh Cloudflare evidence", () => {
  const { backupDir, repoDir } = makeFixture();

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.mode, "steady-state");
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.checks.map((check) => [check.name, check.status]),
    [
      ["local build and test gates", "pass"],
      ["source secret scan", "pass"],
      ["OpenNext build artifact secret scan", "pass"],
      ["Wrangler production config", "pass"],
    ],
  );
});

test("steady-state deploy preflight rejects stale local-gate source evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.writeFileSync(path.join(repoDir, "changed.txt"), "new source\n");

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const localGates = report.checks.find((check) => check.name === "local build and test gates");
  assert.equal(localGates?.status, "fail");
});

test("steady-state deploy preflight rejects missing React Doctor gate evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateLocalGatesReport(backupDir, (report) => {
    report.results = report.results.filter((result) => result.id !== "react-doctor");
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const localGates = report.checks.find((check) => check.name === "local build and test gates");
  assert.equal(localGates?.status, "fail");
  assert.ok(localGateDetail(localGates).missingGateIds?.includes("react-doctor"));
});

test("steady-state deploy preflight rejects failed React Doctor gate evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateLocalGatesReport(backupDir, (report) => {
    report.ok = false;
    report.results = report.results.map((result) => (result.id === "react-doctor" ? { ...result, ok: false } : result));
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const localGates = report.checks.find((check) => check.name === "local build and test gates");
  assert.equal(localGates?.status, "fail");
  assert.ok(localGateDetail(localGates).failedGateIds?.includes("react-doctor"));
});

test("steady-state deploy preflight rejects stale build artifact scan evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  const artifactReportPath = path.join(backupDir, "cloudflare/build-artifact-scan-report.json");
  const artifactReport = JSON.parse(fs.readFileSync(artifactReportPath, "utf8")) as Record<string, unknown>;
  artifactReport.createdAt = "2026-06-26T10:45:00Z";
  fs.writeFileSync(artifactReportPath, `${JSON.stringify(artifactReport, null, 2)}\n`);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const artifactScan = report.checks.find((check) => check.name === "OpenNext build artifact secret scan");
  assert.equal(artifactScan?.status, "fail");
});

test("steady-state deploy preflight rejects build artifact scan from a different source fingerprint", () => {
  const { backupDir, repoDir } = makeFixture();
  const artifactReportPath = path.join(backupDir, "cloudflare/build-artifact-scan-report.json");
  const artifactReport = JSON.parse(fs.readFileSync(artifactReportPath, "utf8")) as Record<string, unknown>;
  artifactReport.sourceFingerprint = { sha256: "0".repeat(64), fileCount: 1, files: [] };
  fs.writeFileSync(artifactReportPath, `${JSON.stringify(artifactReport, null, 2)}\n`);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const artifactScan = report.checks.find((check) => check.name === "OpenNext build artifact secret scan");
  assert.equal(artifactScan?.status, "fail");
  assert.equal((artifactScan?.detail as { sourceFingerprintOk?: boolean } | undefined)?.sourceFingerprintOk, false);
});

test("steady-state deploy preflight rejects high observability sampling outside incident mode", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.observability.head_sampling_rate = 1;
    config.observability.logs.head_sampling_rate = 1;
    config.observability.traces.head_sampling_rate = 1;
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
});

test("steady-state deploy preflight allows high observability sampling in incident mode", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.vars.OBSERVABILITY_INCIDENT_MODE = "1";
    config.observability.head_sampling_rate = 1;
    config.observability.logs.head_sampling_rate = 1;
    config.observability.traces.head_sampling_rate = 1;
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, true);
});

function makeFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-repo-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-backup-"));
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
  runGit(repoDir, ["init"]);
  fs.writeFileSync(path.join(repoDir, "app.ts"), "export const ok = true;\n");
  fs.writeFileSync(path.join(repoDir, "wrangler.jsonc"), `${JSON.stringify(wranglerConfig(), null, 2)}\n`);

  const fingerprint = buildRepoSourceFingerprint(repoDir);
  writeLocalEvidence(backupDir, fingerprint);

  return { repoDir, backupDir };
}

function replaceWranglerConfig(
  repoDir: string,
  backupDir: string,
  mutate: (config: ReturnType<typeof wranglerConfig>) => void,
) {
  const config = wranglerConfig();
  mutate(config);
  fs.writeFileSync(path.join(repoDir, "wrangler.jsonc"), `${JSON.stringify(config, null, 2)}\n`);
  writeLocalEvidence(backupDir, buildRepoSourceFingerprint(repoDir));
}

function writeLocalEvidence(backupDir: string, fingerprint: SourceFingerprint) {
  const createdAt = "2026-06-26T11:45:00Z";
  writeJson(backupDir, "cloudflare/local-gates-report.json", {
    ok: true,
    createdAt,
    backupDir,
    sourceFingerprintStable: true,
    sourceFingerprintAfter: fingerprint,
    results: LOCAL_GATE_IDS.map((id) => ({ id, ok: true })),
  });
  writeJson(backupDir, "cloudflare/source-secret-scan-report.json", {
    ok: true,
    createdAt,
    backupDir,
    sourceFingerprint: {
      sha256: fingerprint.sha256,
      fileCount: fingerprint.fileCount,
    },
    findings: [],
  });
  writeJson(backupDir, "cloudflare/build-artifact-scan-report.json", {
    ok: true,
    createdAt,
    backupDir,
    sourceFingerprint: fingerprint,
    artifactRoot: ".open-next",
    nextEnvFile: ".open-next/cloudflare/next-env.mjs",
    scannedFiles: 42,
    findings: [],
  });
}

function mutateLocalGatesReport(
  backupDir: string,
  mutate: (report: { ok: boolean; results: Array<{ id: string; ok: boolean }> }) => void,
) {
  const reportPath = path.join(backupDir, "cloudflare/local-gates-report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    ok: boolean;
    results: Array<{ id: string; ok: boolean }>;
  };
  mutate(report);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function localGateDetail(check: { detail?: unknown } | undefined) {
  assert.ok(check?.detail && typeof check.detail === "object");
  return check.detail as { missingGateIds?: string[]; failedGateIds?: string[] };
}

function wranglerConfig() {
  return {
    name: "inspirlearning",
    workers_dev: false,
    preview_urls: false,
    d1_databases: [{ binding: "DB", database_name: D1_DATABASE_NAME, database_id: D1_DATABASE_ID }],
    vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: VECTORIZE_INDEX_NAME }],
    r2_buckets: [
      { binding: "NEXT_INC_CACHE_R2_BUCKET", bucket_name: R2_BUCKET_NAME },
      { binding: "PROFILE_IMAGES_R2_BUCKET", bucket_name: PROFILE_IMAGES_R2_BUCKET_NAME },
    ],
    services: [{ binding: "WORKER_SELF_REFERENCE", service: "inspirlearning" }],
    queues: {
      producers: [{ binding: "MEMORY_POST_TURN_QUEUE", queue: MEMORY_POST_TURN_QUEUE_NAME }],
      consumers: [
        {
          queue: MEMORY_POST_TURN_QUEUE_NAME,
          dead_letter_queue: MEMORY_POST_TURN_DLQ_NAME,
          max_retries: 5,
        },
      ],
    },
    triggers: { crons: ["0 3 * * *"] },
    routes: [{ pattern: "inspirlearning.com" }, { pattern: "www.inspirlearning.com" }],
    observability: {
      enabled: true,
      head_sampling_rate: 0.02,
      logs: { enabled: true, head_sampling_rate: 0.05 },
      traces: { enabled: true, head_sampling_rate: 0.02 },
    },
    secrets: {
      required: [
        "OPENAI_API_KEY",
        "CLOUDFLARE_AI_GATEWAY_TOKEN",
        "AUTH_SECRET",
        "AUTH_GOOGLE_ID",
        "AUTH_GOOGLE_SECRET",
        "ADMIN_EMAILS",
        "CRON_SECRET",
      ],
    },
    vars: {
      APP_URL: "https://inspirlearning.com",
      AUTH_URL: "https://inspirlearning.com",
      BETTER_AUTH_URL: "https://inspirlearning.com",
      CLOUDFLARE_AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/account/inspir/openai",
      CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: "inspir",
      OPENAI_MODEL: "gpt-5",
      OPENAI_FAST_MODEL: "gpt-5-mini",
      OPENAI_REASONING_MODEL: "gpt-5",
      OPENAI_STRUCTURED_MODEL: "gpt-5-mini",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      RATE_LIMIT_USER_CHAT_DAILY: "20",
      RATE_LIMIT_GUEST_SESSION_DAILY: "10",
      RATE_LIMIT_GUEST_FINGERPRINT_DAILY: "10",
      RATE_LIMIT_GUEST_IP_DAILY: "20",
      RATE_LIMIT_ACTIVITY_DAILY: "10",
      RATE_LIMIT_MEMORY_DAILY: "20",
      LLM_GLOBAL_DAILY_CALL_LIMIT: "1000",
      MEMORY_POST_TURN_SYNTHESIS_THRESHOLD: "2",
      MEMORY_PROFILE_COMPILE_LIMIT: "20",
      OBSERVABILITY_INCIDENT_MODE: "0",
      APP_WRITE_FREEZE: "0",
      APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
    },
  };
}

function writeJson(root: string, relativePath: string, value: unknown) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
