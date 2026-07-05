import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import { WORKER_DEPLOY_REPORT } from "../scripts/cloudflare/worker-deploy-evidence";

test("migration status accepts preview Playwright evidence only for the current source fingerprint", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-preview-evidence-"));
  const fingerprint = buildRepoSourceFingerprint();
  writePreviewReport(backupDir, fingerprint);

  let stage = runMigrationStatusPreviewStage(backupDir);
  assert.equal(stage?.status, "pass");

  writePreviewReport(backupDir, {
    ...fingerprint,
    sha256: "0".repeat(64),
  });
  stage = runMigrationStatusPreviewStage(backupDir);

  assert.equal(stage?.status, "blocked");
  assert.equal((stage?.detail as { sourceFingerprintOk?: boolean }).sourceFingerprintOk, false);
});

test("migration status accepts Worker deploy evidence only for deploys from the current source fingerprint", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-stage-"));
  const fingerprint = buildRepoSourceFingerprint();
  writeWorkerDeployReport(backupDir, fingerprint);

  let stage = runMigrationStatusStage(backupDir, "worker-deploy");
  assert.equal(stage?.status, "pass");

  writeWorkerDeployReport(backupDir, fingerprint, { mode: "opennext-upload" });
  stage = runMigrationStatusStage(backupDir, "worker-deploy");
  assert.equal(stage?.status, "blocked");
  assert.equal((stage?.detail as { modeOk?: boolean }).modeOk, false);

  writeWorkerDeployReport(backupDir, { ...fingerprint, sha256: "0".repeat(64) });
  stage = runMigrationStatusStage(backupDir, "worker-deploy");
  assert.equal(stage?.status, "blocked");
  assert.equal((stage?.detail as { sourceFingerprintOk?: boolean }).sourceFingerprintOk, false);
});

test("migration status blocks D1 import evidence generated with skip-reset", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-skip-reset-stage-"));
  const now = new Date().toISOString();
  writeJson(backupDir, "cloudflare/d1-validation-report.json", {
    createdAt: now,
    completedAt: now,
    backupDir,
    ok: true,
    quickCheck: [{ quick_check: "ok" }],
    foreignKeyCheck: [],
    tables: [],
    timestampPrecision: { ok: true },
  });
  writeJson(backupDir, "cloudflare/d1-import-run.json", {
    createdAt: now,
    completedAt: now,
    backupDir,
    ok: true,
    resetSkipped: true,
    imported: {},
    cleanup: { attempted: true, ok: true, kept: false },
  });

  const stage = runMigrationStatusStage(backupDir, "d1-import");

  assert.equal(stage?.status, "blocked");
  assert.equal(
    ((stage?.detail as { importRun?: { resetSkipped?: boolean } } | undefined)?.importRun)?.resetSkipped,
    true,
  );
});

function writePreviewReport(backupDir: string, fingerprint: SourceFingerprint) {
  const reportPath = path.join(backupDir, "cloudflare/playwright-preview-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        backupDir,
        baseUrl: "http://localhost:8787",
        ok: true,
        exitCode: 0,
        sourceFingerprintBefore: fingerprint,
        sourceFingerprintAfter: fingerprint,
        sourceFingerprintStable: true,
        stats: {
          expected: 4,
          skipped: 2,
          unexpected: 0,
          flaky: 0,
        },
        playwright: {},
      },
      null,
      2,
    )}\n`,
  );
}

function writeJson(backupDir: string, relativePath: string, value: unknown) {
  const filePath = path.join(backupDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runMigrationStatusPreviewStage(backupDir: string) {
  return runMigrationStatusStage(backupDir, "preview-playwright");
}

function writeWorkerDeployReport(
  backupDir: string,
  fingerprint: SourceFingerprint,
  overrides: Partial<{
    mode: string;
  }> = {},
) {
  const reportPath = path.join(backupDir, WORKER_DEPLOY_REPORT);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        backupDir,
        ok: true,
        mode: "opennext-deploy",
        command: ["opennextjs-cloudflare", "deploy"],
        passthroughArgs: [],
        status: 0,
        commandExecuted: true,
        deployPreflightOk: true,
        deployPreflightStatus: 0,
        scanBeforeOk: true,
        scanAfterOk: null,
        sourceFingerprintBefore: fingerprint,
        sourceFingerprintAfter: fingerprint,
        sourceFingerprintStable: true,
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
}

function runMigrationStatusStage(backupDir: string, stageId: string) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/cloudflare/migration-status.ts", "--backup", backupDir],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: [
          "/Users/makriman/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin",
          "/Users/makriman/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin",
          process.env.PATH ?? "",
        ].join(path.delimiter),
        PNPM_CONFIG_CONFIRM_MODULES_PURGE: "false",
        npm_config_confirm_modules_purge: "false",
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(
    fs.readFileSync(path.join(backupDir, "cloudflare/migration-status-report.json"), "utf8"),
  ) as { stages?: Array<{ id?: string; status?: string; detail?: unknown }> };
  return report.stages?.find((stage) => stage.id === stageId);
}
