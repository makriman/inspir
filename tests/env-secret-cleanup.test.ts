import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("env secret cleanup dry run includes duplicate and retired Supabase secret confirmations", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-env-cleanup-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    fs.writeFileSync(
      path.join(backupDir, "cloudflare", "env-migration-inventory.json"),
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          backupDir,
          duplicateSecretAndVarKeys: ["NEXTAUTH_URL"],
          retiredSupabaseSecrets: ["DATABASE_URL"],
          unclassified: [],
          missingRequiredSecretBackups: [],
          missingRequiredVars: [],
        },
        null,
        2,
      )}\n`,
    );

    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/cloudflare/cleanup-duplicate-secrets.ts", "--backup", backupDir],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(
      fs.readFileSync(path.join(backupDir, "cloudflare", "env-secret-cleanup-plan.json"), "utf8"),
    ) as {
      ok?: boolean;
      duplicateKeys?: string[];
      retiredSupabaseKeys?: string[];
      cleanupKeys?: string[];
      confirmationsRequiredForApply?: Record<string, string>;
      commands?: Array<{ key?: string; reasons?: string[] }>;
    };

    assert.equal(report.ok, true);
    assert.deepEqual(report.duplicateKeys, ["NEXTAUTH_URL"]);
    assert.deepEqual(report.retiredSupabaseKeys, ["DATABASE_URL"]);
    assert.deepEqual(report.cleanupKeys, ["DATABASE_URL", "NEXTAUTH_URL"]);
    assert.equal(report.confirmationsRequiredForApply?.CONFIRM_DUPLICATE_SECRET_KEYS, "NEXTAUTH_URL");
    assert.equal(report.confirmationsRequiredForApply?.CONFIRM_RETIRED_SUPABASE_SECRET_KEYS, "DATABASE_URL");
    assert.equal(report.confirmationsRequiredForApply?.CONFIRM_SECRET_CLEANUP_KEYS, "DATABASE_URL,NEXTAUTH_URL");
    assert.deepEqual(report.commands?.find((command) => command.key === "DATABASE_URL")?.reasons, [
      "retired-supabase-postgres",
    ]);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("env secret cleanup apply rejects stale env migration inventory", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-env-cleanup-stale-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    fs.writeFileSync(
      path.join(backupDir, "cloudflare", "env-migration-inventory.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-06-26T00:00:00.000Z",
          backupDir,
          duplicateSecretAndVarKeys: ["NEXTAUTH_URL"],
          retiredSupabaseSecrets: [],
          unclassified: [],
          missingRequiredSecretBackups: [],
          missingRequiredVars: [],
        },
        null,
        2,
      )}\n`,
    );

    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/cloudflare/cleanup-duplicate-secrets.ts", "--backup", backupDir, "--apply"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          CONFIRM_ENV_SECRET_CLEANUP: "1",
          CONFIRM_BACKUP_DIR: backupDir,
          CONFIRM_DUPLICATE_SECRET_KEYS: "NEXTAUTH_URL",
          CONFIRM_RETIRED_SUPABASE_SECRET_KEYS: "",
          CONFIRM_SECRET_CLEANUP_KEYS: "NEXTAUTH_URL",
        },
      },
    );

    assert.notEqual(run.status, 0);
    const report = JSON.parse(
      fs.readFileSync(path.join(backupDir, "cloudflare", "env-secret-cleanup-run.json"), "utf8"),
    ) as { blockers?: string[]; results?: unknown[] };
    assert.ok(report.blockers?.some((blocker) => blocker.includes("env-migration-inventory.json is older than one hour")));
    assert.equal(report.results, undefined);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});
