import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES,
  PREVIEW_E2E_EVIDENCE_KIND,
  PREVIEW_E2E_EVIDENCE_RELATIVE_PATH,
  PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION,
  PREVIEW_E2E_REQUIRED_TEST_TITLES,
  analyzePreviewE2EPlaywrightReport,
  readAndValidatePreviewE2EEvidence,
  validatePreviewE2EEvidence,
} from "../scripts/cloudflare/preview-e2e-evidence";
import { redactPlaywrightJsonEvidence } from "../scripts/cloudflare/production-playwright-safety";

const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const CREATED_AT = "2026-07-15T11:45:00.000Z";
const SOURCE = Object.freeze({ sha256: "a".repeat(64), fileCount: 42 });

test("release preview runner cannot downgrade live AI, authentication, or canonical JSON evidence", () => {
  const runner = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-preview-playwright.ts"),
    "utf8",
  );

  assert.match(runner, /process\.env\.REQUIRE_LIVE_AI === "1"/);
  assert.match(runner, /REQUIRE_AUTHENTICATED_E2E: "1"/);
  assert.match(runner, /REQUIRE_LIVE_AI: "1"/);
  assert.match(runner, /PRODUCTION_E2E_READ_ONLY: "0"/);
  assert.match(runner, /PLAYWRIGHT_DISABLE_TRACE: "1"/);
  assert.match(runner, /--output", playwrightArtifactsDirectory/);
  assert.match(runner, /PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightReportPath/);
  assert.match(runner, /redactProductionPlaywrightOutput/);
  assert.match(runner, /redactPlaywrightJsonEvidence/);
  assert.match(runner, /resolveLocalPreviewE2EAuth/);
  assert.match(runner, /resolveLocalPreviewProviderRuntimeSecrets/);
  assert.match(runner, /localPreviewProviderSecretValues/);
  assert.match(runner, /providerRuntimeCredentialConfigured/);
  assert.match(
    runner,
    /A local CLOUDFLARE_AI_GATEWAY_TOKEN is required for release preview E2E live AI/,
  );
  assert.match(runner, /analyzePreviewE2EPlaywrightReport\(parsed\)/);
  assert.doesNotMatch(runner, /test\.skip|parsePlaywrightJson/);
});

test("preview JSON and captured output redact every provider credential representation", () => {
  const providerSecret = 'gateway-token-sentinel:"quoted"/?scope=live';
  const evidence = {
    [providerSecret]: {
      raw: `runtime failed with ${providerSecret}`,
      json: JSON.stringify(providerSecret),
      encoded: encodeURIComponent(providerSecret),
      nested: [providerSecret],
    },
  };
  const redacted = redactPlaywrightJsonEvidence(evidence, [providerSecret]);
  const serialized = JSON.stringify(redacted);

  assert.equal(serialized.includes(providerSecret), false);
  assert.equal(
    serialized.includes(JSON.stringify(providerSecret).slice(1, -1)),
    false,
  );
  assert.equal(serialized.includes(encodeURIComponent(providerSecret)), false);
  assert.match(serialized, /\[REDACTED\]/);
});

test("live preview evidence accepts exact source-bound required coverage and two production-only skips", () => {
  const backupDirectory = temporaryBackupDirectory();
  const report = validPreviewEvidence(backupDirectory);
  const validation = validatePreviewE2EEvidence({
    value: report,
    backupDirectory,
    sourceFingerprint: SOURCE,
    nowMs: NOW_MS,
  });

  assert.deepEqual(validation.requiredPassedTitles, PREVIEW_E2E_REQUIRED_TEST_TITLES);
  assert.deepEqual(validation.skippedTitles, PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES);
  assert.equal(validation.sourceFingerprint.sha256, SOURCE.sha256);
});

test("live preview evidence rejects every extra, missing, or critical skipped outcome even when ok is forged", async (t) => {
  const scenarios: ReadonlyArray<{
    name: string;
    mutate: (playwright: Record<string, unknown>) => void;
    expected: RegExp;
  }> = [
    {
      name: "critical quiz skipped",
      mutate: (playwright) => {
        setOutcomeStatus(
          playwright,
          "configured native quiz reaches a complete, answer-revealing result",
          "skipped",
        );
      },
      expected: /wrong exact skipped-test set|required live preview test/i,
    },
    {
      name: "unknown additional skip",
      mutate: (playwright) => {
        setOutcomeStatus(playwright, "ordinary preview contract", "skipped");
      },
      expected: /wrong exact skipped-test set/i,
    },
    {
      name: "required tutor-memory test missing",
      mutate: (playwright) => {
        removeOutcome(
          playwright,
          "authenticated tutor uses saved memory and recalls an earlier chat without changing consent",
        );
      },
      expected: /required live preview test is missing/i,
    },
    {
      name: "critical test retried despite an eventual pass",
      mutate: (playwright) => {
        const quiz = findSpec(
          playwright,
          "configured native quiz reaches a complete, answer-revealing result",
        );
        const projectTest = requiredRecord(
          requiredArray(quiz.tests, "quiz tests")[0],
          "quiz project test",
        );
        projectTest.results = [{ status: "failed" }, { status: "passed" }];
      },
      expected: /did not pass exactly once without retry/i,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const backupDirectory = temporaryBackupDirectory();
      const report = validPreviewEvidence(backupDirectory);
      const playwright = requiredRecord(report.playwright, "playwright report");
      scenario.mutate(playwright);
      refreshStats(playwright);
      report.stats = requiredRecord(playwright.stats, "playwright stats");
      report.coverage = forgedPassingCoverage(playwright);
      report.ok = true;

      assert.throws(
        () => validatePreviewE2EEvidence({
          value: report,
          backupDirectory,
          sourceFingerprint: SOURCE,
          nowMs: NOW_MS,
        }),
        scenario.expected,
      );
    });
  }
});

test("live preview evidence rejects missing live requirements, stale time, and wrong source", async (t) => {
  const scenarios: ReadonlyArray<{
    name: string;
    mutate: (report: Record<string, unknown>) => void;
    expected: RegExp;
  }> = [
    {
      name: "REQUIRE_LIVE_AI absent",
      mutate: (report) => {
        requiredRecord(report.liveEnvironment, "live environment").requireLiveAi = false;
      },
      expected: /live AI and authenticated preview requirements/i,
    },
    {
      name: "authenticated preview absent",
      mutate: (report) => {
        requiredRecord(report.liveEnvironment, "live environment").migrationE2eAuth = false;
      },
      expected: /live AI and authenticated preview requirements/i,
    },
    {
      name: "provider runtime credential false",
      mutate: (report) => {
        requiredRecord(
          report.liveEnvironment,
          "live environment",
        ).providerRuntimeCredentialConfigured = false;
      },
      expected: /live AI and authenticated preview requirements/i,
    },
    {
      name: "provider runtime credential omitted",
      mutate: (report) => {
        delete requiredRecord(
          report.liveEnvironment,
          "live environment",
        ).providerRuntimeCredentialConfigured;
      },
      expected: /live AI and authenticated preview requirements/i,
    },
    {
      name: "runner retained a release blocker",
      mutate: (report) => {
        report.requirementBlockers = ["forged unmet requirement"];
      },
      expected: /retained unmet release requirements/i,
    },
    {
      name: "stale report",
      mutate: (report) => {
        report.createdAt = "2026-07-15T10:59:59.000Z";
      },
      expected: /stale/i,
    },
    {
      name: "wrong source",
      mutate: (report) => {
        report.sourceFingerprintAfter = { sha256: "b".repeat(64), fileCount: 42 };
      },
      expected: /exact current source/i,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const backupDirectory = temporaryBackupDirectory();
      const report = validPreviewEvidence(backupDirectory);
      scenario.mutate(report);
      assert.throws(
        () => validatePreviewE2EEvidence({
          value: report,
          backupDirectory,
          sourceFingerprint: SOURCE,
          nowMs: NOW_MS,
        }),
        scenario.expected,
      );
    });
  }
});

test("file-backed preview evidence requires a private regular non-symlink file", async (t) => {
  for (const scenario of ["broad-mode", "symlink"] as const) {
    await t.test(scenario, () => {
      const backupDirectory = temporaryBackupDirectory();
      const reportPath = path.join(
        backupDirectory,
        PREVIEW_E2E_EVIDENCE_RELATIVE_PATH,
      );
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(
        reportPath,
        `${JSON.stringify(validPreviewEvidence(backupDirectory), null, 2)}\n`,
        { mode: 0o600 },
      );
      if (scenario === "broad-mode") {
        fs.chmodSync(reportPath, 0o644);
      } else {
        const target = `${reportPath}.target`;
        fs.renameSync(reportPath, target);
        fs.symlinkSync(target, reportPath);
      }

      assert.throws(
        () => readAndValidatePreviewE2EEvidence({
          backupDirectory,
          sourceFingerprint: SOURCE,
          nowMs: NOW_MS,
        }),
        /owner-only regular file/i,
      );
    });
  }
});

function validPreviewEvidence(backupDirectory: string): Record<string, unknown> {
  const playwright = validPlaywrightReport();
  const coverage = analyzePreviewE2EPlaywrightReport(playwright);
  assert.equal(coverage.ok, true, coverage.blockers.join("; "));
  return {
    kind: PREVIEW_E2E_EVIDENCE_KIND,
    schemaVersion: PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION,
    createdAt: CREATED_AT,
    backupDir: backupDirectory,
    baseUrl: "http://localhost:8787",
    ok: true,
    exitCode: 0,
    sourceFingerprintBefore: SOURCE,
    sourceFingerprintAfter: SOURCE,
    sourceFingerprintStable: true,
    stats: requiredRecord(playwright.stats, "playwright stats"),
    liveEnvironment: {
      requireLiveAi: true,
      providerRuntimeCredentialConfigured: true,
      authenticatedE2eRequired: true,
      migrationE2eAuth: true,
      productionE2eReadOnly: false,
      productScope: "multilingual-static-native-accounts-memory-admin-and-activities",
    },
    coverage,
    requirementBlockers: [],
    playwright,
  };
}

function validPlaywrightReport(): Record<string, unknown> {
  const passingTitles = [
    ...PREVIEW_E2E_REQUIRED_TEST_TITLES,
    "ordinary preview contract",
  ];
  const specs = [
    ...passingTitles.map((title) => testSpec(title, "passed")),
    ...PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES.map((title) =>
      testSpec(title, "skipped"),
    ),
  ];
  return {
    config: {
      projects: [{ name: "chromium", retries: 0, repeatEach: 1 }],
    },
    suites: [{ title: "preview", specs }],
    errors: [],
    stats: {
      startTime: CREATED_AT,
      duration: 1_000,
      expected: passingTitles.length,
      unexpected: 0,
      flaky: 0,
      skipped: PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES.length,
    },
  };
}

function testSpec(title: string, status: "passed" | "skipped") {
  const skipped = status === "skipped";
  return {
    title,
    ok: true,
    tests: [
      {
        projectName: "chromium",
        expectedStatus: skipped ? "skipped" : "passed",
        status: skipped ? "skipped" : "expected",
        results: [{ status }],
      },
    ],
  };
}

function setOutcomeStatus(
  playwright: Record<string, unknown>,
  title: string,
  status: "skipped",
) {
  const spec = findSpec(playwright, title);
  const testResult = requiredRecord(
    requiredArray(spec.tests, `${title} tests`)[0],
    `${title} test`,
  );
  testResult.expectedStatus = status;
  testResult.status = status;
  testResult.results = [{ status }];
}

function removeOutcome(playwright: Record<string, unknown>, title: string) {
  const suite = requiredRecord(
    requiredArray(playwright.suites, "playwright suites")[0],
    "playwright suite",
  );
  suite.specs = requiredArray(suite.specs, "playwright specs").filter(
    (value) => requiredRecord(value, "playwright spec").title !== title,
  );
}

function findSpec(playwright: Record<string, unknown>, title: string) {
  const suite = requiredRecord(
    requiredArray(playwright.suites, "playwright suites")[0],
    "playwright suite",
  );
  const spec = requiredArray(suite.specs, "playwright specs").find(
    (value) => requiredRecord(value, "playwright spec").title === title,
  );
  return requiredRecord(spec, `playwright spec ${title}`);
}

function refreshStats(playwright: Record<string, unknown>) {
  const suite = requiredRecord(
    requiredArray(playwright.suites, "playwright suites")[0],
    "playwright suite",
  );
  const tests = requiredArray(suite.specs, "playwright specs").map((value) => {
    const spec = requiredRecord(value, "playwright spec");
    return requiredRecord(requiredArray(spec.tests, "spec tests")[0], "spec test");
  });
  playwright.stats = {
    startTime: CREATED_AT,
    duration: 1_000,
    expected: tests.filter((value) => value.status === "expected").length,
    unexpected: 0,
    flaky: 0,
    skipped: tests.filter((value) => value.status === "skipped").length,
  };
}

function forgedPassingCoverage(playwright: Record<string, unknown>) {
  const analysis = analyzePreviewE2EPlaywrightReport(playwright);
  return {
    ok: true,
    blockers: [],
    totalTests: analysis.totalTests,
    requiredPassedTitles: [...PREVIEW_E2E_REQUIRED_TEST_TITLES],
    skippedTitles: analysis.skippedTitles,
  };
}

function temporaryBackupDirectory() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "inspir-preview-evidence-"));
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
