import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FINAL_PRODUCTION_BASE_URL,
  checkFinalCutoverEvidenceChain,
  validatePostCutoverD1Report,
  validateWorkerDeployReport,
} from "../scripts/cloudflare/final-cutover-evidence-chain";
import { buildVectorizeArtifactFingerprint } from "../scripts/cloudflare/migration-artifact-fingerprint";

const maxAgeMs = 60 * 60 * 1000;
const nowMs = Date.parse("2026-06-26T12:00:00.000Z");

test("final cutover evidence chain accepts ordered production reports", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {});

    const result = checkFinalCutoverEvidenceChain(backupDir, {
      maxAgeMs,
      nowMs,
      requireProviderPreflight: true,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.blockers, []);
  });
});

test("final cutover evidence chain rejects production Playwright from non-production targets", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/playwright-production-report.json": { baseUrl: "http://localhost:8787" },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.some((blocker) =>
        blocker.includes(`cloudflare/playwright-production-report.json must target ${FINAL_PRODUCTION_BASE_URL}`),
      ),
    );
  });
});

test("final cutover evidence chain rejects stale DNS plan evidence", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/dns-cutover-dry-run-plan.json": { createdAt: "2026-06-26T10:00:00.000Z" },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes("cloudflare/dns-cutover-dry-run-plan.json is older than one hour"));
  });
});

test("final cutover evidence chain accepts manual public DNS cutover evidence", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/dns-cutover-dry-run-plan.json": { omit: true },
      "cloudflare/dns-cutover-plan.json": { omit: true },
      "cloudflare/dns-cutover-apply-report.json": { omit: true },
      "cloudflare/dns-cutover-report.json": { omit: true },
    });
    fs.writeFileSync(
      path.join(backupDir, "cloudflare", "dns-public-cutover-report.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-06-26T11:20:00.000Z",
          backupDir,
          domain: "inspirlearning.com",
          mode: "manual-public-dns",
          ok: true,
          failedChecks: 0,
          checks: publicDnsChecks(),
        },
        null,
        2,
      )}\n`,
    );

    const result = checkFinalCutoverEvidenceChain(backupDir, {
      maxAgeMs,
      nowMs,
      requireProviderPreflight: true,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.blockers, []);
  });
});

test("final cutover evidence chain rejects production smoke missing required probes", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/production-smoke-report.json": {
        checks: [{ name: "home status", status: "pass" }],
      },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.some((blocker) =>
        blocker.includes("cloudflare/production-smoke-report.json is missing or failing required smoke checks"),
      ),
    );
  });
});

test("final cutover evidence chain rejects missing Worker deploy evidence", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/worker-deploy-report.json": { omit: true },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes("cloudflare/worker-deploy-report.json is missing or unreadable"));
  });
});

test("final cutover evidence chain rejects upload-only Worker evidence", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/worker-deploy-report.json": { mode: "opennext-upload" },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((blocker) => blocker.includes("modeOk=false")));
  });
});

test("final cutover evidence chain rejects production Playwright missing required E2E titles", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/playwright-production-report.json": {
        playwright: playwrightJson(["public, localized, SEO, and topic API routes work on Cloudflare preview"]),
      },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.some((blocker) =>
        blocker.includes("cloudflare/playwright-production-report.json is missing required E2E tests"),
      ),
    );
  });
});

test("final cutover evidence chain rejects post-cutover D1 missing timestamp precision proof", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/d1-post-cutover-validation-report.json": {
        timestampPrecision: undefined,
      },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.some((blocker) =>
        blocker.includes("cloudflare/d1-post-cutover-validation-report.json must prove D1 integrity"),
      ),
    );
  });
});

test("final cutover evidence chain rejects post-cutover D1 missing artifact fingerprint proof", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/d1-post-cutover-validation-report.json": {
        artifactFingerprint: undefined,
      },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.some((blocker) =>
        blocker.includes("artifactFingerprintOk=false"),
      ),
    );
  });
});

test("final cutover evidence chain rejects mutable D1 tables without imported-row parity proof", async () => {
  await withBackupFixture((backupDir) => {
    const report = d1PostCutoverReport();
    for (const table of report.tables) {
      if (table.mutableAfterCutover) table.mutableImportedRows = undefined;
    }
    writeReports(backupDir, {
      "cloudflare/d1-post-cutover-validation-report.json": report,
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.some((blocker) =>
        blocker.includes("cloudflare/d1-post-cutover-validation-report.json must prove D1 integrity"),
      ),
    );
  });
});

test("post-cutover D1 validation accepts expired transient rate-limit windows", () => {
  const report = {
    ok: true,
    ...d1PostCutoverReport(),
  };
  const rateLimit = report.tables.find((table) => table.table === "rate_limit_windows");
  assert.ok(rateLimit);
  rateLimit.ok = true;
  rateLimit.actualRows = 32;
  rateLimit.transientAfterCutover = true;
  rateLimit.mutableImportedRows = {
    checkedRows: rateLimit.expectedRows,
    mismatchedRows: 0,
    missingRows: rateLimit.expectedRows,
    expectedSha256: rateLimit.expectedSha256,
    actualSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    expectedPrimaryKeySha256: rateLimit.expectedSha256,
    actualImportedPrimaryKeySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    extraRows: 32,
    ok: false,
  };

  const validation = validatePostCutoverD1Report(report);

  assert.equal(validation.ok, true);
  assert.equal(validation.mutableTablesOk, true);
});

test("post-cutover D1 validation accepts changed but present runtime-mutable imported rows", () => {
  const report = {
    ok: true,
    ...d1PostCutoverReport(),
  };
  for (const table of report.tables) {
    if (table.mutableAfterCutover && table.mutableImportedRows) {
      table.mutableImportedRows.mismatchedRows = 1;
      table.mutableImportedRows.ok = true;
    }
  }

  const validation = validatePostCutoverD1Report(report);

  assert.equal(validation.ok, true);
  assert.equal(validation.mutableTablesOk, true);
});

test("post-cutover D1 validation rejects mismatched artifact fingerprints", () => {
  const report = {
    ok: true,
    ...d1PostCutoverReport(),
  };

  const matching = validatePostCutoverD1Report(report, {
    expectedArtifactFingerprint: { sha256: "b".repeat(64) },
  });
  assert.equal(matching.ok, true);
  assert.equal(matching.artifactFingerprintOk, true);

  const mismatched = validatePostCutoverD1Report(report, {
    expectedArtifactFingerprint: { sha256: "c".repeat(64) },
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.artifactFingerprintOk, false);
  assert.equal(mismatched.artifactFingerprint, "b".repeat(64));
  assert.equal(mismatched.expectedArtifactFingerprint, "c".repeat(64));
});

test("Worker deploy validation rejects source fingerprint drift", () => {
  const report = workerDeployReport("2026-06-26T11:15:00.000Z");

  const matching = validateWorkerDeployReport(report, {
    expectedSourceFingerprint: { sha256: "f".repeat(64), fileCount: 10 },
  });
  assert.equal(matching.ok, true);

  const mismatched = validateWorkerDeployReport(report, {
    expectedSourceFingerprint: { sha256: "0".repeat(64), fileCount: 10 },
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.sourceFingerprintOk, false);
});

test("Worker deploy validation rejects missing deploy preflight proof", () => {
  const report = workerDeployReport("2026-06-26T11:15:00.000Z");
  delete (report as { deployPreflightOk?: boolean }).deployPreflightOk;

  const validation = validateWorkerDeployReport(report, {
    expectedSourceFingerprint: { sha256: "f".repeat(64), fileCount: 10 },
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.deployPreflightOk, false);
});

test("final cutover evidence chain rejects post-cutover D1 validation that predates Playwright", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/d1-post-cutover-validation-report.json": { createdAt: "2026-06-26T11:10:00.000Z" },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, { maxAgeMs, nowMs });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.includes(
        "cloudflare/d1-post-cutover-validation-report.json must be generated after cloudflare/playwright-production-report.json",
      ),
    );
  });
});

test("final cutover evidence chain rejects provider preflight that predates post-cutover D1 validation", async () => {
  await withBackupFixture((backupDir) => {
    writeReports(backupDir, {
      "cloudflare/provider-retirement-preflight-report.json": { createdAt: "2026-06-26T11:20:00.000Z" },
    });

    const result = checkFinalCutoverEvidenceChain(backupDir, {
      maxAgeMs,
      nowMs,
      requireProviderPreflight: true,
    });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.includes(
        "cloudflare/provider-retirement-preflight-report.json must be generated after cloudflare/vectorize-post-cutover-validation-report.json",
      ),
    );
  });
});

async function withBackupFixture(callback: (backupDir: string) => void | Promise<void>) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-final-evidence-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    await callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function writeReports(backupDir: string, overrides: Record<string, Record<string, unknown>>) {
  writeVectorizeArtifact(backupDir);
  const dnsPlan = dnsDryRunPlan(backupDir);
  const dnsApply = dnsApplyReport(backupDir);
  const reports = [
    ["cloudflare/production-preflight-report.json", "2026-06-26T11:00:00.000Z", {}],
    ["cloudflare/dns-cutover-dry-run-plan.json", "2026-06-26T11:05:00.000Z", dnsPlan],
    ["cloudflare/dns-cutover-plan.json", "2026-06-26T11:05:00.000Z", dnsPlan],
    ["cloudflare/dns-cutover-apply-report.json", "2026-06-26T11:08:00.000Z", dnsApply],
    [
      "cloudflare/dns-cutover-report.json",
      "2026-06-26T11:10:00.000Z",
      { domain: "inspirlearning.com", failedChecks: 0, checks: dnsChecks() },
    ],
    [
      "cloudflare/production-smoke-report.json",
      "2026-06-26T11:25:00.000Z",
      { baseUrl: FINAL_PRODUCTION_BASE_URL, failedChecks: 0, checks: smokeChecks() },
    ],
    [
      "cloudflare/playwright-production-report.json",
      "2026-06-26T11:30:00.000Z",
      {
        baseUrl: FINAL_PRODUCTION_BASE_URL,
        stats: { expected: 8, skipped: 0, unexpected: 0, flaky: 0 },
        playwright: playwrightJson(),
      },
    ],
    ["cloudflare/worker-deploy-report.json", "2026-06-26T11:15:00.000Z", workerDeployReport("2026-06-26T11:15:00.000Z")],
    ["cloudflare/d1-post-cutover-validation-report.json", "2026-06-26T11:40:00.000Z", d1PostCutoverReport()],
    ["cloudflare/vectorize-post-cutover-validation-report.json", "2026-06-26T11:45:00.000Z", vectorizePostCutoverReport(backupDir)],
    ["cloudflare/provider-retirement-preflight-report.json", "2026-06-26T11:50:00.000Z", {}],
  ] as const;

  for (const [relativePath, createdAt, extra] of reports) {
    if ((overrides[relativePath] as { omit?: boolean } | undefined)?.omit === true) continue;
    const report = {
      createdAt,
      backupDir,
      ok: true,
      ...extra,
      ...(overrides[relativePath] ?? {}),
    };
    fs.writeFileSync(path.join(backupDir, relativePath), `${JSON.stringify(report, null, 2)}\n`);
  }
}

function workerDeployReport(createdAt: string) {
  const sourceFingerprint = {
    sha256: "f".repeat(64),
    fileCount: 10,
    files: [],
  };
  return {
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
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
    sourceFingerprintBefore: sourceFingerprint,
    sourceFingerprintAfter: sourceFingerprint,
    sourceFingerprintStable: true,
  };
}

function dnsDryRunPlan(backupDir: string) {
  const fingerprint = "d".repeat(64);
  return {
    backupDir,
    domain: "inspirlearning.com",
    gateVersion: 2,
    apply: false,
    planFingerprint: "e".repeat(64),
    zone: {
      name: "inspirlearning.com",
      status: "active",
      accountId: "a1e5e542dc1d5fe5a5c6b2a10d755a81",
    },
    plannedActions: [
      {
        action: "delete",
        reason: "record targets Vercel",
        fingerprint,
        record: {
          id: "dns-record-1",
          name: "www.inspirlearning.com",
          type: "CNAME",
          content: "example.vercel-dns.com",
        },
      },
    ],
  };
}

function dnsApplyReport(backupDir: string) {
  const plan = dnsDryRunPlan(backupDir);
  const fingerprint = plan.plannedActions[0].fingerprint;
  return {
    ...plan,
    apply: true,
    reviewedPlanFingerprint: plan.planFingerprint,
    preApplyFingerprint: plan.planFingerprint,
    appliedActions: [
      {
        record: { id: "dns-record-1", name: "www.inspirlearning.com" },
        reviewedFingerprint: fingerprint,
        currentFingerprint: fingerprint,
        beforeDeleteFingerprint: fingerprint,
      },
    ],
  };
}

function d1PostCutoverReport() {
  const mutableTables = new Set([
    "llm_usage_daily",
    "rate_limit_windows",
    "users",
    "accounts",
    "sessions",
    "verification_tokens",
    "topics",
    "topic_legacy_ids",
    "chats",
    "messages",
    "activity_runs",
    "ai_runs",
    "user_memory_settings",
    "user_memories",
    "chat_memory_summaries",
    "chat_memory_turns",
    "user_memory_profiles",
    "user_memory_summaries",
    "memory_synthesis_runs",
    "memory_events",
    "memory_source_feedback",
  ]);
  const transientTables = new Set(["rate_limit_windows"]);
  const tables = tableNames().map((table, index) => {
    const mutableAfterCutover = mutableTables.has(table);
    const transientAfterCutover = transientTables.has(table);
    const expectedRows = index + 1;
    const actualRows = mutableAfterCutover ? expectedRows + 1 : expectedRows;
    const expectedSha256 = `${String(index).padStart(64, "0")}`;
    return {
      table,
      expectedRows,
      actualRows,
      expectedSha256,
      actualSha256: mutableAfterCutover ? null : expectedSha256,
      mutableAfterCutover,
      transientAfterCutover,
      mutableImportedRows: mutableAfterCutover
        ? {
            checkedRows: expectedRows,
            mismatchedRows: 0,
            missingRows: 0,
            expectedSha256,
            actualSha256: expectedSha256,
            expectedPrimaryKeySha256: expectedSha256,
            actualImportedPrimaryKeySha256: expectedSha256,
            extraRows: 1,
            ok: true,
          }
        : undefined,
      ok: true,
    };
  });
  return {
    database: "inspirlearning-prod",
    quickCheck: [{ quick_check: "ok" }],
    foreignKeyCheck: [],
    exactTableCount: tableNames().length - mutableTables.size,
    mutableTableCount: mutableTables.size,
    tables,
    transformedSourceHashCheck: tableNames().map((table, index) => ({
      table,
      expectedSha256: `${String(index).padStart(64, "0")}`,
      sourceSha256: `${String(index).padStart(64, "0")}`,
    })),
    mismatchedSourceHashes: [],
    timestampPrecision: {
      table: "source_timestamp_precision",
      expectedRows: 18032,
      actualRows: 18032,
      expectedSha256: "a".repeat(64),
      actualSha256: "a".repeat(64),
      ok: true,
    },
    artifactFingerprint: {
      sha256: "b".repeat(64),
      files: [],
    },
  };
}

function writeVectorizeArtifact(backupDir: string) {
  const row = {
    id: "user_memories:fixture",
    namespace: "",
    values: Array.from({ length: 512 }, () => 0),
    metadata: { sourceTable: "user_memories" },
  };
  const artifactPath = path.join(backupDir, "cloudflare", "vectorize-memory.ndjson");
  const content = `${JSON.stringify(row)}\n`;
  fs.writeFileSync(artifactPath, content);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  fs.writeFileSync(
    path.join(backupDir, "cloudflare", "vectorize-manifest.json"),
    `${JSON.stringify({ rows: 1, sha256, file: "cloudflare/vectorize-memory.ndjson" }, null, 2)}\n`,
  );
}

function vectorizePostCutoverReport(backupDir: string) {
  const artifactFingerprint = buildVectorizeArtifactFingerprint(backupDir);
  return {
    index: "inspirlearning-memory-prod",
    importedFrom: "cloudflare/vectorize-memory.ndjson",
    artifactFingerprint,
    artifactSha256: artifactFingerprint.artifactSha256,
    manifestSha256: artifactFingerprint.artifactSha256,
    artifactSha256MatchesManifest: true,
    expectedRows: 1,
    allowUnexpectedIds: true,
    missingIds: [],
    unexpectedIds: ["runtime-memory:extra"],
    remoteVectorChecks: {
      ok: true,
      fetchedRows: 1,
      expectedRows: 1,
      problems: [],
    },
    info: { vectorCount: 2 },
  };
}

function tableNames() {
  return [
    "users",
    "topics",
    "app_metadata",
    "llm_usage_daily",
    "rate_limit_windows",
    "accounts",
    "sessions",
    "verification_tokens",
    "topic_legacy_ids",
    "chats",
    "messages",
    "activity_runs",
    "ai_runs",
    "user_memory_settings",
    "user_memories",
    "chat_memory_summaries",
    "chat_memory_turns",
    "user_memory_profiles",
    "user_memory_summaries",
    "memory_synthesis_runs",
    "memory_events",
    "memory_source_feedback",
    "legacy_chat_snapshots",
    "legacy_dummy_data",
    "app_translations",
  ];
}

function smokeChecks() {
  return [
    "home status",
    "home body: free ai learning",
    "home body: learn",
    "home Cloudflare edge signal",
    "home not served by Vercel",
    "localized Hindi route status",
    "localized Hindi route language cookie",
    "localized Hindi route not served by Vercel",
    "robots status",
    "robots body: User-Agent",
    "robots not served by Vercel",
    "sitemap index status",
    "sitemap index body: <sitemapindex",
    "sitemap index not served by Vercel",
    "English sitemap status",
    "English sitemap body: <urlset",
    "English sitemap not served by Vercel",
    "RSS status",
    "RSS body: <rss",
    "RSS not served by Vercel",
    "OG image status",
    "OG image content type",
    "OG image not served by Vercel",
    "topics API status",
    "topics API content type",
    "topics API not served by Vercel",
    "topics API payload",
    "live guest chat status",
    "live guest chat not served by Vercel",
    "live guest chat streamed body",
    "live guest chat limit headers",
  ].map((name) => ({ name, status: "pass" }));
}

function dnsChecks() {
  return [
    "reviewed DNS dry-run plan evidence",
    "DNS apply report matches reviewed plan",
    "public nameservers use Cloudflare",
    "Cloudflare zone active",
    "reviewed DNS records were removed",
    "public DNS resolves inspirlearning.com",
    "public DNS target is not Vercel for inspirlearning.com",
    "HTTP status inspirlearning.com",
    "HTTP served through Cloudflare inspirlearning.com",
    "HTTP not served by Vercel inspirlearning.com",
    "Cloudflare DNS records exist for inspirlearning.com",
    "Cloudflare DNS records are proxied for inspirlearning.com",
    "Cloudflare DNS records do not target Vercel for inspirlearning.com",
    "public DNS resolves www.inspirlearning.com",
    "public DNS target is not Vercel for www.inspirlearning.com",
    "HTTP status www.inspirlearning.com",
    "HTTP served through Cloudflare www.inspirlearning.com",
    "HTTP not served by Vercel www.inspirlearning.com",
    "Cloudflare DNS records exist for www.inspirlearning.com",
    "Cloudflare DNS records are proxied for www.inspirlearning.com",
    "Cloudflare DNS records do not target Vercel for www.inspirlearning.com",
  ].map((name) => ({ name, status: "pass" }));
}

function publicDnsChecks() {
  return [
    "manual DNS cutover confirmed",
    "public nameservers use Cloudflare",
    "public DNS resolves inspirlearning.com",
    "public DNS target is not Vercel for inspirlearning.com",
    "HTTP status inspirlearning.com",
    "HTTP served through Cloudflare inspirlearning.com",
    "HTTP not served by Vercel inspirlearning.com",
    "public DNS resolves www.inspirlearning.com",
    "public DNS target is not Vercel for www.inspirlearning.com",
    "HTTP status www.inspirlearning.com",
    "HTTP served through Cloudflare www.inspirlearning.com",
    "HTTP not served by Vercel www.inspirlearning.com",
  ].map((name) => ({ name, status: "pass" }));
}

function playwrightJson(
  titles = [
    "public, localized, SEO, and topic API routes work on Cloudflare preview",
    "guest-only activity modes show the Google gate instead of private tooling",
    "private and admin APIs fail closed for signed-out users",
    "guest chat returns streamed text with sane limit headers or an explicit provider failure",
    "Google sign-in and sign-out work with the dedicated test account",
    "authenticated profile, activity, memory, admin, and private chat APIs work",
  ],
) {
  return {
    suites: [
      {
        title: "tests/e2e/cloudflare-preview.spec.ts",
        specs: titles.map((title) => ({
          title,
          tests: [{ status: "expected" }],
        })),
      },
    ],
  };
}
