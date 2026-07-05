import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("DNS cutover dry run writes a structured blocked report when Cloudflare token is absent", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-dns-cutover-"));
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CF_API_TOKEN;
  delete env.CLOUDFLARE_API_TOKEN_FILE;
  delete env.CF_API_TOKEN_FILE;

  const prepare = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/cloudflare/prepare-dns-cutover.ts", "--backup", backupDir],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );

  assert.equal(prepare.status, 1);

  const planPath = path.join(backupDir, "cloudflare", "dns-cutover-dry-run-plan.json");
  const legacyPlanPath = path.join(backupDir, "cloudflare", "dns-cutover-plan.json");
  assert.equal(fs.existsSync(planPath), true);
  assert.equal(fs.existsSync(legacyPlanPath), true);

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as {
    domain?: string;
    gateVersion?: number;
    apply?: boolean;
    ok?: boolean;
    plannedActions?: unknown[];
    error?: string;
  };
  assert.equal(plan.domain, "inspirlearning.com");
  assert.equal(plan.gateVersion, 2);
  assert.equal(plan.apply, false);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.plannedActions, []);
  assert.match(plan.error ?? "", /CLOUDFLARE_API_TOKEN|CF_API_TOKEN/);

  const status = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/cloudflare/migration-status.ts", "--backup", backupDir],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );
  assert.equal(status.status, 0, status.stderr || status.stdout);

  const statusReport = JSON.parse(
    fs.readFileSync(path.join(backupDir, "cloudflare", "migration-status-report.json"), "utf8"),
  ) as {
    stages?: Array<{
      id?: string;
      status?: string;
      detail?: {
        gateVersion?: number;
        reportProblems?: unknown[];
        actionProblems?: unknown[];
        consistencyProblems?: unknown[];
        error?: string;
      };
    }>;
  };
  const dnsStage = statusReport.stages?.find((stage) => stage.id === "dns-dry-run");
  assert.equal(dnsStage?.status, "blocked");
  assert.equal(dnsStage.detail?.gateVersion, 2);
  assert.deepEqual(dnsStage.detail?.reportProblems, []);
  assert.deepEqual(dnsStage.detail?.actionProblems, []);
  assert.deepEqual(dnsStage.detail?.consistencyProblems, []);
  assert.match(dnsStage.detail?.error ?? "", /CLOUDFLARE_API_TOKEN|CF_API_TOKEN/);

  const tokenStage = statusReport.stages?.find((stage) => stage.id === "cloudflare-token-capability");
  assert.equal(tokenStage?.status, "missing");
});

test("DNS cutover dry run rejects group-readable token files without leaking the token", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-dns-cutover-token-file-"));
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-cf-token-file-"));
  const tokenFile = path.join(tokenDir, "token.txt");
  const token = "do_not_print_test_token";
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CF_API_TOKEN;
  delete env.CF_API_TOKEN_FILE;
  env.CLOUDFLARE_API_TOKEN_FILE = tokenFile;

  try {
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o644 });
    fs.chmodSync(tokenFile, 0o644);

    const prepare = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/cloudflare/prepare-dns-cutover.ts", "--backup", backupDir],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );

    assert.equal(prepare.status, 1);
    assert.doesNotMatch(prepare.stdout, new RegExp(token));
    assert.doesNotMatch(prepare.stderr, new RegExp(token));

    const plan = JSON.parse(
      fs.readFileSync(path.join(backupDir, "cloudflare", "dns-cutover-dry-run-plan.json"), "utf8"),
    ) as { error?: string; credentialSource?: string | null };
    assert.equal(plan.credentialSource, null);
    assert.match(plan.error ?? "", /mode is 0644/);
    assert.doesNotMatch(JSON.stringify(plan), new RegExp(token));
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.rmSync(tokenDir, { recursive: true, force: true });
  }
});
