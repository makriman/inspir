import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { timingSafeBearerEquals } from "../scripts/cloudflare/d1-import-worker";
import { evaluateImporterResponse } from "../scripts/cloudflare/importer-response";
import { freshBackupScopedReportBlockers } from "../scripts/cloudflare/fresh-report-gate";
import {
  providerRetirementDryRunEvidenceBlockers,
  providerRetirementPlanFingerprint,
  providerRetirementRunEvidenceBlockers,
  providerRetirementRunSucceeded,
  providersAbsent,
  redactProviderProcessOutput,
} from "../scripts/cloudflare/provider-retirement-safety";
import { backupDirConfirmationBlocker } from "../scripts/cloudflare/destructive-confirmations";

const backupDir = "/tmp/inspir-backup-a";
const otherBackupDir = "/tmp/inspir-backup-b";
const nowMs = Date.parse("2026-06-26T12:00:00.000Z");
const maxAgeMs = 60 * 60 * 1000;

test("importer response evaluation accepts only fully successful statement batches", () => {
  const evaluation = evaluateImporterResponse({
    responseOk: true,
    status: 200,
    text: JSON.stringify({ ok: true, results: [{ success: true }, { success: true }] }),
  });

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.failedResultCount, 0);
});

test("importer response evaluation rejects HTTP-ok payload failures", () => {
  const evaluation = evaluateImporterResponse({
    responseOk: true,
    status: 200,
    text: JSON.stringify({ ok: false, error: "statement_failed", results: [{ success: false }] }),
  });

  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.retryable, false);
  assert.equal(evaluation.failedResultCount, 1);
  assert.match(evaluation.errorExcerpt, /statement_failed/);
});

test("importer response evaluation rejects missing result arrays", () => {
  const evaluation = evaluateImporterResponse({
    responseOk: true,
    status: 200,
    text: JSON.stringify({ ok: true }),
  });

  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.failedResultCount, 0);
});

test("importer response evaluation rejects malformed successful HTTP responses", () => {
  const evaluation = evaluateImporterResponse({
    responseOk: true,
    status: 200,
    text: "this is not json",
  });

  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.payload, null);
  assert.equal(evaluation.retryable, false);
  assert.match(evaluation.errorExcerpt, /not json/);
});

test("D1 importer authorizes only the exact bearer token with digest comparison", async () => {
  assert.equal(await timingSafeBearerEquals("Bearer migration-token", "migration-token"), true);
  assert.equal(await timingSafeBearerEquals("Bearer migration-token ", "migration-token"), false);
  assert.equal(await timingSafeBearerEquals("migration-token", "migration-token"), false);
  assert.equal(await timingSafeBearerEquals(null, "migration-token"), false);
});

test("D1 import deploy writes temporary Wrangler secret file as private", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/cloudflare/import-d1.ts"), "utf8");

  assert.match(
    source,
    /fs\.writeFileSync\(secretFile,[\s\S]*JSON\.stringify\(\{\s*MIGRATION_IMPORT_TOKEN:\s*token\s*\}\),[\s\S]*\{\s*mode:\s*0o600\s*\}\)/,
  );
  assert.match(source, /fs\.chmodSync\(secretFile,\s*0o600\)/);
});

test("D1 importer cleanup evidence uses Wrangler exit status", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/cloudflare/import-d1.ts"), "utf8");

  assert.match(source, /runWranglerResult\(\["delete",\s*importerName,\s*"--force"\],\s*\{\s*allowFailure:\s*true\s*\}\)/);
  assert.match(source, /ok:\s*result\.ok/);
  assert.match(source, /status:\s*result\.status/);
  assert.doesNotMatch(source, /ok:\s*!\s*\/error\|failed\/i\.test/);
});

test("D1 local rehearsal tightens generated SQLite evidence file permissions", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/cloudflare/rehearse-d1-local.ts"), "utf8");

  assert.match(source, /ensurePrivateSqliteFile\(\)/);
  assert.match(source, /fs\.chmodSync\(dbPath,\s*0o600\)/);
});

test("fresh backup-scoped reports accept only clean fresh evidence for this backup", () => {
  const blockers = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/production-preflight-report.json",
    report: { ok: true, backupDir, createdAt: "2026-06-26T11:45:00.000Z" },
    backupDir,
    maxAgeMs,
    nowMs,
    requireOk: true,
  });

  assert.deepEqual(blockers, []);
});

test("fresh backup-scoped reports reject stale or wrong-backup evidence", () => {
  const stale = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/production-preflight-report.json",
    report: { ok: true, backupDir, createdAt: "2026-06-26T10:45:00.000Z" },
    backupDir,
    maxAgeMs,
    nowMs,
    requireOk: true,
  });
  const wrongBackup = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/production-preflight-report.json",
    report: { ok: true, backupDir: otherBackupDir, createdAt: "2026-06-26T11:45:00.000Z" },
    backupDir,
    maxAgeMs,
    nowMs,
    requireOk: true,
  });
  const notClean = freshBackupScopedReportBlockers({
    relativePath: "cloudflare/production-preflight-report.json",
    report: { ok: false, backupDir, createdAt: "2026-06-26T11:45:00.000Z" },
    backupDir,
    maxAgeMs,
    nowMs,
    requireOk: true,
  });

  assert.ok(stale.includes("cloudflare/production-preflight-report.json is older than one hour"));
  assert.ok(wrongBackup.includes("cloudflare/production-preflight-report.json was generated for a different backup directory"));
  assert.ok(notClean.includes("cloudflare/production-preflight-report.json is not clean"));
});

test("destructive confirmations require the exact active backup directory", () => {
  const original = process.env.CONFIRM_BACKUP_DIR;
  try {
    delete process.env.CONFIRM_BACKUP_DIR;
    assert.equal(backupDirConfirmationBlocker(backupDir), "Missing CONFIRM_BACKUP_DIR");

    process.env.CONFIRM_BACKUP_DIR = otherBackupDir;
    assert.equal(backupDirConfirmationBlocker(backupDir), "CONFIRM_BACKUP_DIR does not match the active backup directory");

    process.env.CONFIRM_BACKUP_DIR = backupDir;
    assert.equal(backupDirConfirmationBlocker(backupDir), null);
  } finally {
    if (original === undefined) delete process.env.CONFIRM_BACKUP_DIR;
    else process.env.CONFIRM_BACKUP_DIR = original;
  }
});

test("provider absence requires confirmed absence, not lookup failures", () => {
  const absent = providersAbsent({
    vercel: { found: false },
    supabase: { found: false },
  });
  const lookupFailed = providersAbsent({
    vercel: { found: null, detail: { status: 1 } },
    supabase: { found: false },
  });
  const stillPresent = providersAbsent({
    vercel: { found: false },
    supabase: { found: true, detail: { projectRef: "bkbyyrmbeecpnxxjlnrz" } },
  });

  assert.equal(absent.ok, true);
  assert.equal(lookupFailed.ok, false);
  assert.ok(lookupFailed.blockers.includes("Live Vercel project absence was not verified"));
  assert.equal(stillPresent.ok, false);
  assert.ok(stillPresent.blockers.includes("Live Supabase project is still present"));
});

test("provider retirement success requires commands and post-delete absence", () => {
  const success = providerRetirementRunSucceeded(
    [
      { provider: "vercel", ok: true, status: 204 },
      { provider: "supabase", ok: true, status: 0 },
    ],
    { vercel: { found: false }, supabase: { found: false } },
  );
  const commandFailed = providerRetirementRunSucceeded(
    [
      { provider: "vercel", ok: false, status: 500 },
      { provider: "supabase", ok: true, status: 0 },
    ],
    { vercel: { found: false }, supabase: { found: false } },
  );
  const absenceNotVerified = providerRetirementRunSucceeded(
    [
      { provider: "vercel", ok: true, status: 204 },
      { provider: "supabase", ok: true, status: 0 },
    ],
    { vercel: { found: false }, supabase: { found: null } },
  );

  assert.equal(success.ok, true);
  assert.equal(commandFailed.ok, false);
  assert.ok(commandFailed.blockers.includes("vercel deletion command failed"));
  assert.equal(absenceNotVerified.ok, false);
  assert.ok(absenceNotVerified.blockers.includes("Live Supabase project absence was not verified"));
});

test("provider retirement success requires both provider deletion commands", () => {
  const missingSupabaseCommand = providerRetirementRunSucceeded(
    [{ provider: "vercel", ok: true, status: 204 }],
    { vercel: { found: false }, supabase: { found: false } },
  );
  const missingVercelCommand = providerRetirementRunSucceeded(
    [{ provider: "supabase", ok: true, status: 0 }],
    { vercel: { found: false }, supabase: { found: false } },
  );

  assert.equal(missingSupabaseCommand.ok, false);
  assert.ok(missingSupabaseCommand.blockers.includes("supabase deletion command was not recorded"));
  assert.equal(missingVercelCommand.ok, false);
  assert.ok(missingVercelCommand.blockers.includes("vercel deletion command was not recorded"));
});

test("provider retirement evidence rejects shallow clean flags", () => {
  const blockers = providerRetirementRunEvidenceBlockers({
    results: [{ provider: "vercel", ok: true, status: 204 }],
    postDeleteIdentity: { vercel: { found: false }, supabase: { found: false } },
    retirementSafety: { ok: true, blockers: [] },
  });

  assert.ok(blockers.includes("cloudflare/provider-retirement-run.json: supabase deletion command was not recorded"));
});

test("provider retirement evidence requires a clean recorded safety proof", () => {
  const blockers = providerRetirementRunEvidenceBlockers({
    results: [
      { provider: "vercel", ok: true, status: 204 },
      { provider: "supabase", ok: true, status: 0 },
    ],
    postDeleteIdentity: { vercel: { found: false }, supabase: { found: false } },
    retirementSafety: { ok: true, blockers: ["manual check failed"] },
  });

  assert.ok(blockers.includes("cloudflare/provider-retirement-run.json: recorded retirementSafety blocker: manual check failed"));
});

test("provider retirement dry run records a reviewed deletion plan fingerprint", () => {
  const targets = {
    vercelProjectId: "prj_123",
    supabaseProjectRef: "abcdefghijklmnopqrst",
  };
  const commands = [
    { provider: "vercel", command: "vercel-api", args: ["DELETE", "/v9/projects/prj_123?teamId=team_123"] },
    { provider: "supabase", command: "supabase", args: ["projects", "delete", "abcdefghijklmnopqrst", "--yes"] },
  ];
  const planFingerprint = providerRetirementPlanFingerprint({ backupDir, targets, commands });

  assert.equal(planFingerprint.length, 64);
  assert.deepEqual(
    providerRetirementDryRunEvidenceBlockers(
      {
        ok: true,
        apply: false,
        dryRun: true,
        backupDir,
        targets,
        commands,
        planFingerprint,
      },
      { backupDir, targets, commands, planFingerprint },
    ),
    [],
  );
});

test("provider retirement dry run evidence rejects unreviewed or stale deletion plans", () => {
  const targets = { vercelProjectId: "prj_123", supabaseProjectRef: "abcdefghijklmnopqrst" };
  const commands = [
    { provider: "vercel", command: "vercel-api", args: ["DELETE", "/v9/projects/prj_123?teamId=team_123"] },
    { provider: "supabase", command: "supabase", args: ["projects", "delete", "abcdefghijklmnopqrst", "--yes"] },
  ];
  const planFingerprint = providerRetirementPlanFingerprint({ backupDir, targets, commands });

  const missing = providerRetirementDryRunEvidenceBlockers(null, { backupDir, targets, commands, planFingerprint });
  const stale = providerRetirementDryRunEvidenceBlockers(
    {
      ok: true,
      apply: false,
      dryRun: true,
      backupDir: otherBackupDir,
      targets,
      commands,
      planFingerprint,
    },
    { backupDir, targets, commands, planFingerprint },
  );
  const tampered = providerRetirementDryRunEvidenceBlockers(
    {
      ok: true,
      apply: false,
      dryRun: true,
      backupDir,
      targets,
      commands: commands.slice(0, 1),
      planFingerprint,
    },
    { backupDir, targets, commands, planFingerprint },
  );

  assert.ok(missing.includes("cloudflare/provider-retirement-run.json dry-run deletion plan is missing"));
  assert.ok(stale.includes("cloudflare/provider-retirement-run.json was generated for a different backup directory"));
  assert.ok(
    tampered.includes("cloudflare/provider-retirement-run.json planFingerprint does not match the recorded dry-run targets and commands"),
  );
});

test("provider process output redaction strips migration credentials before reports persist it", () => {
  const cloudflareToken = ["cfat", "exampleCloudflareMigrationTokenValue"].join("_");
  const redacted = redactProviderProcessOutput(
    [
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      "temporary token=abcdefghijklmnopqrstuvwxyz0123456789",
      "temporary secret=abcdefghijklmnopqrstuvwxyz0123456789",
      cloudflareToken,
    ].join("\n"),
  );

  assert.match(redacted, /Bearer \[REDACTED\]/);
  assert.match(redacted, /\[REDACTED_TOKEN\]/);
  assert.match(redacted, /\[REDACTED_SECRET\]/);
  assert.match(redacted, /\[REDACTED_CLOUDFLARE_TOKEN\]/);
  assert.doesNotMatch(redacted, /cfat_example/);
  assert.ok(redactProviderProcessOutput("x".repeat(2500)).length <= 2000);
});
