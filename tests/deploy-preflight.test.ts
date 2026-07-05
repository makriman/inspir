import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSteadyStateDeployPreflightReport,
  providerRetirementProof,
} from "../scripts/cloudflare/deploy-preflight";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
} from "../scripts/cloudflare/migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";

test("deploy preflight stays in migration mode until provider retirement is proven", () => {
  const { backupDir } = makeFixture();

  fs.writeFileSync(
    path.join(backupDir, "cloudflare/migration-status-report.json"),
    JSON.stringify({ ok: false, backupDir, providersRetired: false }),
  );

  const proof = providerRetirementProof(backupDir);
  assert.equal(proof.ok, false);
  assert.ok(proof.blockers.some((blocker) => blocker.includes("providersRetired=true")));
});

test("steady-state deploy preflight accepts Cloudflare-only evidence after provider retirement", () => {
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
      ["provider retirement proof", "pass"],
      ["local build and test gates", "pass"],
      ["source secret scan", "pass"],
      ["runtime provider dependency scan", "pass"],
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

test("steady-state deploy preflight rejects runtime provider scan findings", () => {
  const { backupDir, repoDir } = makeFixture();
  const runtimeReportPath = path.join(backupDir, "cloudflare/runtime-provider-scan-report.json");
  const runtimeReport = JSON.parse(fs.readFileSync(runtimeReportPath, "utf8")) as Record<string, unknown>;
  runtimeReport.ok = false;
  runtimeReport.findings = [
    {
      rule: "retired-provider-env",
      description: "Runtime source reads a retired provider env var",
      file: "app/api/example/route.ts",
      line: 1,
      column: 1,
      snippet: "process.env.[MATCH]",
    },
  ];
  fs.writeFileSync(runtimeReportPath, `${JSON.stringify(runtimeReport, null, 2)}\n`);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const runtimeScan = report.checks.find((check) => check.name === "runtime provider dependency scan");
  assert.equal(runtimeScan?.status, "fail");
  assert.equal((runtimeScan?.detail as { findings?: number } | undefined)?.findings, 1);
});

test("steady-state deploy preflight rejects empty runtime provider scan evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  const runtimeReportPath = path.join(backupDir, "cloudflare/runtime-provider-scan-report.json");
  const runtimeReport = JSON.parse(fs.readFileSync(runtimeReportPath, "utf8")) as Record<string, unknown>;
  runtimeReport.scannedFiles = [];
  fs.writeFileSync(runtimeReportPath, `${JSON.stringify(runtimeReport, null, 2)}\n`);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const runtimeScan = report.checks.find((check) => check.name === "runtime provider dependency scan");
  assert.equal(runtimeScan?.status, "fail");
  assert.equal((runtimeScan?.detail as { scannedFiles?: number } | undefined)?.scannedFiles, 0);
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

function makeFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-repo-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-backup-"));
  const cloudflareDir = path.join(backupDir, "cloudflare");
  fs.mkdirSync(cloudflareDir, { recursive: true });
  runGit(repoDir, ["init"]);
  fs.writeFileSync(path.join(repoDir, "app.ts"), "export const ok = true;\n");
  fs.writeFileSync(path.join(repoDir, "wrangler.jsonc"), `${JSON.stringify(wranglerConfig(), null, 2)}\n`);

  const fingerprint = buildRepoSourceFingerprint(repoDir);
  writeJson(backupDir, "cloudflare/migration-status-report.json", { ok: true, backupDir, providersRetired: true });
  writeJson(backupDir, "cloudflare/provider-retirement-run.json", {
    ok: true,
    backupDir,
    results: [
      { provider: "vercel", ok: true },
      { provider: "supabase", ok: true },
    ],
    postDeleteIdentity: {
      vercel: { found: false },
      supabase: { found: false },
    },
    retirementSafety: { ok: true, blockers: [] },
  });
  writeJson(backupDir, "cloudflare/credential-rotation-report.json", {
    ok: true,
    backupDir,
    confirmations: [
      { id: "cloudflare-api-token", env: "CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED", confirmed: true },
      { id: "r2-s3-key", env: "CONFIRM_R2_MIGRATION_S3_KEY_REVOKED", confirmed: true },
      { id: "vercel-access", env: "CONFIRM_VERCEL_ACCESS_REVOKED", confirmed: true },
      { id: "supabase-access", env: "CONFIRM_SUPABASE_ACCESS_REVOKED", confirmed: true },
      { id: "retired-provider-env", env: "CONFIRM_RETIRED_PROVIDER_ENV_UNSET", confirmed: true },
    ],
    rotationEvidence: {
      required: true,
      ok: true,
      storedFile: "cloudflare/credential-rotation-evidence.txt",
      bytes: 80,
      sha256: "a".repeat(64),
      problems: [],
    },
    forbiddenEnvPresent: [],
    blockers: [],
  });
  writeLocalEvidence(backupDir, fingerprint);

  return { repoDir, backupDir };
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
  writeJson(backupDir, "cloudflare/runtime-provider-scan-report.json", {
    ok: true,
    createdAt,
    backupDir,
    sourceFingerprint: {
      sha256: fingerprint.sha256,
      fileCount: fingerprint.fileCount,
    },
    scannedFiles: ["wrangler.jsonc"],
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

function wranglerConfig() {
  return {
    name: "inspirlearning",
    main: "./cloudflare-worker.ts",
    account_id: "a1e5e542dc1d5fe5a5c6b2a10d755a81",
    workers_dev: false,
    preview_urls: false,
    vars: {
      APP_URL: "https://inspirlearning.com",
      NEXTAUTH_URL: "https://inspirlearning.com",
      CLOUDFLARE_AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
      CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: "inspir",
      OPENAI_MODEL: "gpt-5",
      OPENAI_FAST_MODEL: "gpt-5-mini",
      OPENAI_REASONING_MODEL: "gpt-5",
      OPENAI_STRUCTURED_MODEL: "gpt-5-mini",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      RATE_LIMIT_USER_CHAT_DAILY: "20",
      RATE_LIMIT_GUEST_SESSION_DAILY: "10",
      RATE_LIMIT_GUEST_IP_DAILY: "20",
      RATE_LIMIT_ACTIVITY_DAILY: "10",
      RATE_LIMIT_MEMORY_DAILY: "20",
      LLM_GLOBAL_DAILY_CALL_LIMIT: "200",
      MEMORY_POST_TURN_SYNTHESIS_THRESHOLD: "2",
      MEMORY_PROFILE_COMPILE_LIMIT: "20",
      APP_WRITE_FREEZE: "0",
      APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
    },
    secrets: {
      required: [
        "OPENAI_API_KEY",
        "CLOUDFLARE_AI_GATEWAY_TOKEN",
        "AUTH_SECRET",
        "NEXTAUTH_SECRET",
        "AUTH_GOOGLE_ID",
        "AUTH_GOOGLE_SECRET",
        "ADMIN_EMAILS",
        "CRON_SECRET",
      ],
    },
    d1_databases: [{ binding: "DB", database_name: D1_DATABASE_NAME, database_id: D1_DATABASE_ID }],
    vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: VECTORIZE_INDEX_NAME }],
    r2_buckets: [{ binding: "NEXT_INC_CACHE_R2_BUCKET", bucket_name: R2_BUCKET_NAME }],
    queues: {
      producers: [{ binding: "MEMORY_POST_TURN_QUEUE", queue: MEMORY_POST_TURN_QUEUE_NAME }],
      consumers: [
        {
          queue: MEMORY_POST_TURN_QUEUE_NAME,
          max_retries: 5,
          dead_letter_queue: MEMORY_POST_TURN_DLQ_NAME,
        },
      ],
    },
    services: [{ binding: "WORKER_SELF_REFERENCE", service: "inspirlearning" }],
    triggers: { crons: ["0 3 * * *"] },
    routes: [{ pattern: "inspirlearning.com" }, { pattern: "www.inspirlearning.com" }],
    observability: {
      enabled: true,
      logs: { enabled: true },
      traces: { enabled: true },
    },
  };
}

function writeJson(backupDir: string, relativePath: string, value: unknown) {
  const filePath = path.join(backupDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
