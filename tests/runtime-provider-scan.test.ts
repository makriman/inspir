import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRuntimeProviderScanReport,
  scanRuntimeProviderText,
} from "../scripts/cloudflare/scan-runtime-providers";

test("runtime provider scan detects retired provider dependencies in runtime source", () => {
  const findings = scanRuntimeProviderText(
    "app/api/example/route.ts",
    [
      'import { createClient } from "@supabase/supabase-js";',
      'import "@vercel/analytics";',
      'import "postgres/cf";',
      'const url = process.env.DATABASE_URL;',
      'const direct = env.SUPABASE_URL;',
      'const literal = "NEXT_PUBLIC_SUPABASE_URL";',
      'const country = request.headers.get("x-vercel-ip-country");',
      'const vector = "pgvector";',
      'const remote = "https://example.supabase.co";',
      'const local = "postgres://example.invalid/app";',
    ].join("\n"),
  );

  assert.deepEqual(
    findings.map((finding) => finding.rule),
    [
      "supabase-package",
      "vercel-package",
      "postgres-package",
      "retired-provider-env",
      "retired-provider-env",
      "retired-provider-env-literal",
      "vercel-header",
      "pgvector-runtime",
      "supabase-url",
      "postgres-url",
    ],
  );
});

test("runtime provider scan accepts Cloudflare runtime source", () => {
  const { repoDir, backupDir } = makeFixture();
  fs.mkdirSync(path.join(repoDir, "app/api/chat"), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, "app/api/chat/route.ts"),
    [
      "export async function POST() {",
      "  return Response.json({ provider: 'cloudflare' });",
      "}",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(repoDir, "scripts/cloudflare"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "scripts/cloudflare/export-supabase.ts"), "const legacy = process.env.DATABASE_URL;\n");

  const report = buildRuntimeProviderScanReport(repoDir, backupDir);

  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.scannedFiles.sort(), ["app/api/chat/route.ts"]);
});

test("runtime provider scan rejects reports that scan no runtime files", () => {
  const { repoDir, backupDir } = makeFixture();
  fs.mkdirSync(path.join(repoDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "docs/migration.md"), "Cloudflare migration notes\n");

  const report = buildRuntimeProviderScanReport(repoDir, backupDir);

  assert.equal(report.ok, false);
  assert.deepEqual(report.scannedFiles, []);
  assert.deepEqual(report.findings, []);
});

test("runtime provider scan reports runtime findings and ignores non-runtime files", () => {
  const { repoDir, backupDir } = makeFixture();
  fs.mkdirSync(path.join(repoDir, "app/api/example"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "app/api/example/route.ts"), "const url = process.env.POSTGRES_URL;\n");
  fs.mkdirSync(path.join(repoDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "docs/migration.md"), "Old value: process.env.POSTGRES_URL\n");

  const report = buildRuntimeProviderScanReport(repoDir, backupDir);

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.findings.map((finding) => [finding.rule, finding.file]),
    [["retired-provider-env", "app/api/example/route.ts"]],
  );
});

function makeFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-runtime-provider-repo-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-runtime-provider-backup-"));
  runGit(repoDir, ["init"]);
  return { repoDir, backupDir };
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
