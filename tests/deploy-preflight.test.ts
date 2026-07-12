import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FREE_PLAN_WORKER_FIRST_ROUTES,
  buildSteadyStateDeployPreflightReport,
  hasOpenNextRequestRuntimeImport,
} from "../scripts/cloudflare/deploy-preflight";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  PROFILE_IMAGES_R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
  type WranglerRunner,
} from "../scripts/cloudflare/migration-config";
import type { D1DailyUsage } from "../scripts/cloudflare/d1-free-budget";
import type { D1ReleaseBudgetLedger } from "../scripts/cloudflare/d1-release-budget-ledger";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import {
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH,
  RUNTIME_MIGRATION_FILES,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";
import {
  HISTORICAL_DATA_BASELINE_RELATIVE_PATH,
  HISTORICAL_DATA_IDENTITIES_SQL,
  HISTORICAL_DATA_SUMMARY_SQL,
  HISTORICAL_DATASET_NAMES,
  createHistoricalDataBaseline,
  writeHistoricalDataReport,
  type HistoricalDataBaselineReport,
  type HistoricalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";

const HISTORICAL_BASELINE_CHECK = "historical production data preservation baseline";
const PREFLIGHT_NOW_MS = Date.parse("2026-06-26T12:00:00Z");
const HISTORICAL_FIXTURE_CREATED_AT = new Date("2026-06-26T11:45:00.000Z");
const HISTORICAL_FIXTURE_SECRET = "deploy-preflight-historical-fixture-secret";
const HISTORICAL_FIXTURE_USAGE: D1DailyUsage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 0,
  windowMinutes: 721,
};

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
      ["clean pushed Git release identity", "pass"],
      ["local build and test gates", "pass"],
      ["source secret scan", "pass"],
      ["OpenNext build artifact secret scan", "pass"],
      ["D1 runtime migrations 0013-0015", "pass"],
      [HISTORICAL_BASELINE_CHECK, "pass"],
      ["Wrangler production config", "pass"],
      ["Free static and native account architecture", "pass"],
    ],
  );
});

test("steady-state deploy preflight rejects dirty and unpushed release identities", () => {
  for (const state of ["dirty", "unpushed"] as const) {
    const { backupDir, repoDir } = makeFixture();
    fs.writeFileSync(path.join(repoDir, `${state}.txt`), `${state}\n`);
    if (state === "unpushed") {
      runGit(repoDir, ["add", "."]);
      runGit(repoDir, ["commit", "-m", "unpushed release"]);
    }
    writeLocalEvidence(backupDir, buildRepoSourceFingerprint(repoDir));

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const identity = report.checks.find(
      (check) => check.name === "clean pushed Git release identity",
    );
    assert.equal(identity?.status, "fail");
    assert.match(
      JSON.stringify(identity?.detail),
      state === "dirty" ? /clean Git working tree/ : /pushed upstream/,
    );
  }
});

test("production Static Assets routes only exact native account surfaces through the Worker", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    main?: string;
    assets?: { not_found_handling?: string; run_worker_first?: string[] };
    vectorize?: unknown[];
    r2_buckets?: unknown[];
    queues?: { producers?: unknown[]; consumers?: unknown[] };
    triggers?: { crons?: string[] };
    services?: Array<{ binding?: string; service?: string }>;
    durable_objects?: { bindings?: Array<{ name?: string; class_name?: string }> };
    migrations?: Array<{ new_sqlite_classes?: string[] }>;
  };
  const routes = [...(config.assets?.run_worker_first ?? [])] as string[];
  assert.equal(config.main, "./cloudflare-worker.ts");
  assert.equal(config.assets?.not_found_handling, "404-page");
  assert.equal(routes.includes("/api/*"), false);
  assert.equal(routes.includes("/*"), false);
  assert.deepEqual(routes.filter((route) => route.startsWith("!")), ["!/_next/static/*"]);
  assert.deepEqual(routes, [...FREE_PLAN_WORKER_FIRST_ROUTES]);
  assert.equal(config.vectorize?.length, 1);
  assert.equal(config.r2_buckets?.length, 1);
  assert.equal(config.queues?.producers?.length, 1);
  assert.equal(config.queues?.consumers?.length, 1);
  assert.deepEqual(config.triggers?.crons, ["0 3 * * *"]);
  assert.ok(
    config.services?.some(
      (binding) => binding.binding === "WORKER_SELF_REFERENCE" && binding.service === "inspirlearning",
    ),
  );
  assert.ok(
    config.durable_objects?.bindings?.some(
      (binding) => binding.name === "NEXT_CACHE_DO_QUEUE" && binding.class_name === "DOQueueHandler",
    ),
  );
  assert.ok(config.migrations?.some((migration) => migration.new_sqlite_classes?.includes("DOQueueHandler")));
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

test("steady-state deploy preflight rejects absent D1 0013-0015 verification evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.rmSync(path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0015");
  assert.equal(migration?.status, "fail");
});

test("steady-state deploy preflight rejects stale D1 0013-0015 verification evidence", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateRuntimeMigrationEvidence(backupDir, (report) => {
    report.createdAt = "2026-06-26T10:45:00Z";
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0015");
  assert.equal(migration?.status, "fail");
});

test("steady-state deploy preflight rejects D1 migration evidence from the wrong source", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateRuntimeMigrationEvidence(backupDir, (report) => {
    report.sourceFingerprint.sha256 = "0".repeat(64);
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0015");
  assert.equal(migration?.status, "fail");
  assert.equal(
    (migration?.detail as { sourceFingerprintOk?: boolean } | undefined)?.sourceFingerprintOk,
    false,
  );
});

test("steady-state deploy preflight rejects non-ok or incomplete D1 migration evidence", () => {
  for (const mutate of [
    (report: RuntimeMigrationFixtureReport) => {
      report.ok = false;
    },
    (report: RuntimeMigrationFixtureReport) => {
      report.checks[0]!.ok = false;
    },
    (report: RuntimeMigrationFixtureReport) => {
      report.migrations = report.migrations.slice(0, 2);
    },
  ]) {
    const { backupDir, repoDir } = makeFixture();
    mutateRuntimeMigrationEvidence(backupDir, mutate);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0015");
    assert.equal(migration?.status, "fail");
  }
});

test("steady-state deploy preflight requires regular non-symlink mode-0600 D1 migration evidence", () => {
  for (const mutateFile of [
    (reportPath: string) => fs.chmodSync(reportPath, 0o644),
    (reportPath: string) => {
      const targetPath = `${reportPath}.target`;
      fs.copyFileSync(reportPath, targetPath);
      fs.chmodSync(targetPath, 0o600);
      fs.rmSync(reportPath);
      fs.symlinkSync(targetPath, reportPath);
    },
  ]) {
    const { backupDir, repoDir } = makeFixture();
    const reportPath = path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH);
    mutateFile(reportPath);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const migration = report.checks.find((check) => check.name === "D1 runtime migrations 0013-0015");
    assert.equal(migration?.status, "fail");
    assert.equal(
      (migration?.detail as { fileSecurity?: { ok?: boolean } } | undefined)?.fileSecurity?.ok,
      false,
    );
  }
});

test("steady-state deploy preflight rejects a missing historical preservation baseline", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.rmSync(historicalBaselinePath(backupDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const baseline = report.checks.find((check) => check.name === HISTORICAL_BASELINE_CHECK);
  assert.equal(baseline?.status, "fail");
  assert.match(historicalBaselineFailureReason(baseline), /regular owner-only mode-0600 file/);
});

for (const scenario of [
  {
    name: "stale",
    expectedReason: /stale or from the future/,
    mutate(backupDir: string) {
      mutateHistoricalBaseline(backupDir, (baseline) => {
        baseline.createdAt = "2026-06-26T11:29:59.000Z";
      });
    },
  },
  {
    name: "wrong-source",
    expectedReason: /source fingerprint changed/,
    mutate(backupDir: string) {
      mutateHistoricalBaseline(backupDir, (baseline) => {
        baseline.sourceFingerprint = makeHistoricalFixtureSource("different preflight source");
      });
    },
  },
  {
    name: "wrong-backup",
    expectedReason: /wrong private backup directory/,
    mutate(backupDir: string) {
      mutateHistoricalBaseline(backupDir, (baseline) => {
        baseline.backupDir = `${backupDir}-wrong`;
      });
    },
  },
  {
    name: "malformed",
    expectedReason: /not valid JSON/,
    mutate(backupDir: string) {
      fs.writeFileSync(historicalBaselinePath(backupDir), "{\n");
      fs.chmodSync(historicalBaselinePath(backupDir), 0o600);
    },
  },
] satisfies ReadonlyArray<{
  name: string;
  expectedReason: RegExp;
  mutate: (backupDir: string) => void;
}>) {
  test(`steady-state deploy preflight rejects ${scenario.name} historical preservation evidence`, () => {
    const { backupDir, repoDir } = makeFixture();
    scenario.mutate(backupDir);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: PREFLIGHT_NOW_MS,
    });

    assert.equal(report.ok, false);
    const baseline = report.checks.find((check) => check.name === HISTORICAL_BASELINE_CHECK);
    assert.equal(baseline?.status, "fail");
    assert.match(historicalBaselineFailureReason(baseline), scenario.expectedReason);
  });
}

for (const scenario of [
  {
    name: "broad-permission",
    mutate(reportPath: string) {
      fs.chmodSync(reportPath, 0o640);
    },
  },
  {
    name: "symlink",
    mutate(reportPath: string) {
      const targetPath = `${reportPath}.target`;
      fs.copyFileSync(reportPath, targetPath);
      fs.chmodSync(targetPath, 0o600);
      fs.rmSync(reportPath);
      fs.symlinkSync(targetPath, reportPath);
    },
  },
] satisfies ReadonlyArray<{ name: string; mutate: (reportPath: string) => void }>) {
  test(`steady-state deploy preflight rejects ${scenario.name} historical preservation evidence`, () => {
    const { backupDir, repoDir } = makeFixture();
    scenario.mutate(historicalBaselinePath(backupDir));

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: PREFLIGHT_NOW_MS,
    });

    assert.equal(report.ok, false);
    const baseline = report.checks.find((check) => check.name === HISTORICAL_BASELINE_CHECK);
    assert.equal(baseline?.status, "fail");
    assert.match(historicalBaselineFailureReason(baseline), /owner-only mode-0600 file/);
  });
}

test("steady-state deploy preflight rejects a baseline linked to the wrong release ledger", () => {
  const { backupDir, repoDir } = makeFixture();
  mutateHistoricalBaseline(backupDir, (baseline) => {
    baseline.ledger.ledgerPath = `${baseline.ledger.ledgerPath}.wrong`;
  });

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const baseline = report.checks.find((check) => check.name === HISTORICAL_BASELINE_CHECK);
  assert.equal(baseline?.status, "fail");
  assert.match(historicalBaselineFailureReason(baseline), /ledger linkage is invalid/);
});

test("steady-state deploy preflight rejects a live ledger from the wrong source", () => {
  const { backupDir, repoDir } = makeFixture();
  const baselineEvidence = readHistoricalBaselineFixture(backupDir);
  const ledger = JSON.parse(fs.readFileSync(baselineEvidence.ledger.ledgerPath, "utf8")) as D1ReleaseBudgetLedger;
  ledger.sourceFingerprint.sha256 = "0".repeat(64);
  writePrivateFixtureJson(baselineEvidence.ledger.ledgerPath, ledger);

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: PREFLIGHT_NOW_MS,
  });

  assert.equal(report.ok, false);
  const baseline = report.checks.find((check) => check.name === HISTORICAL_BASELINE_CHECK);
  assert.equal(baseline?.status, "fail");
  assert.match(historicalBaselineFailureReason(baseline), /different source fingerprint/);
});

test("steady-state deploy preflight rejects historical evidence after its UTC ledger day", () => {
  const { backupDir, repoDir } = makeFixture();
  writeHistoricalBaselineEvidence(
    backupDir,
    buildRepoSourceFingerprint(repoDir),
    new Date("2026-06-26T23:50:00.000Z"),
  );

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-27T00:05:00.000Z"),
  });

  assert.equal(report.ok, false);
  const baseline = report.checks.find((check) => check.name === HISTORICAL_BASELINE_CHECK);
  assert.equal(baseline?.status, "fail");
  assert.match(historicalBaselineFailureReason(baseline), /crossed the UTC billing-day boundary/);
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

test("steady-state deploy preflight rejects missing guest quota runtime vars", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    delete (config.vars as Record<string, string | undefined>).RATE_LIMIT_GUEST_SESSION_DAILY;
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
  assert.ok(
    (wrangler?.detail as { missingVars?: string[] } | undefined)?.missingVars?.includes(
      "RATE_LIMIT_GUEST_SESSION_DAILY",
    ),
  );
});

test("steady-state deploy preflight rejects a direct OpenAI secret in Gateway BYOK production", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.secrets.required.push("OPENAI_API_KEY");
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
  assert.equal((wrangler?.detail as { requiredSecretsOk?: boolean }).requiredSecretsOk, false);
});

test("steady-state deploy preflight rejects missing or retired native memory bindings", () => {
  const mutations: Array<(config: ReturnType<typeof wranglerConfig>) => void> = [
    (config) => {
      Object.assign(config, { vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: "retired" }] });
    },
    (config) => {
      Object.assign(config, { r2_buckets: [{ binding: "NEXT_INC_CACHE_R2_BUCKET", bucket_name: "retired" }] });
    },
    (config) => {
      Object.assign(config, { queues: { producers: [{ binding: "RETIRED", queue: "retired" }] } });
    },
    (config) => {
      Object.assign(config, { triggers: { crons: [] } });
    },
  ];

  for (const mutate of mutations) {
    const { backupDir, repoDir } = makeFixture();
    replaceWranglerConfig(repoDir, backupDir, mutate);

    const report = buildSteadyStateDeployPreflightReport({
      backupDir,
      cwd: repoDir,
      runWranglerDryRun: false,
      nowMs: Date.parse("2026-06-26T12:00:00Z"),
    });

    assert.equal(report.ok, false);
    const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
    assert.equal(wrangler?.status, "fail");
    assert.equal((wrangler?.detail as { memoryBindingsOk?: boolean }).memoryBindingsOk, false);
  }
});

test("steady-state deploy preflight rejects Worker-wide response caching", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    Object.assign(config, { cache: { enabled: true } });
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
  assert.equal((wrangler?.detail as { workerGlobalCacheOk?: boolean }).workerGlobalCacheOk, false);
});

test("steady-state deploy preflight rejects paid-only CPU limits on the Free deployment", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    Object.assign(config, { limits: { cpu_ms: 5_000 } });
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
  assert.equal((wrangler?.detail as { freePlanCpuConfigOk?: boolean }).freePlanCpuConfigOk, false);
});

test("steady-state deploy preflight rejects a missing Static Asset 404 boundary", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    delete (config.assets as { not_found_handling?: string }).not_found_handling;
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
  assert.equal((wrangler?.detail as { staticAssetsOk?: boolean }).staticAssetsOk, false);
});

test("steady-state deploy preflight rejects broad or incomplete Worker-first routing", () => {
  for (const mutate of [
    (routes: string[]) => routes.push("/*"),
    (routes: string[]) => routes.push("/api/topics"),
    (routes: string[]) => routes.splice(routes.indexOf("/api/health"), 1),
    (routes: string[]) => routes.splice(routes.indexOf("!/_next/static/*"), 1),
  ]) {
    const { backupDir, repoDir } = makeFixture();
    replaceWranglerConfig(repoDir, backupDir, (config) => {
      mutate(config.assets.run_worker_first);
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
    assert.equal((wrangler?.detail as { staticAssetsOk?: boolean }).staticAssetsOk, false);
  }
});

test("steady-state deploy preflight rejects a missing zero-CPU legal redirect", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.rmSync(path.join(repoDir, "public/_redirects"));
  writeLocalEvidence(backupDir, buildRepoSourceFingerprint(repoDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const wrangler = report.checks.find((check) => check.name === "Wrangler production config");
  assert.equal(wrangler?.status, "fail");
  assert.equal((wrangler?.detail as { staticLegalRedirectOk?: boolean }).staticLegalRedirectOk, false);
});

test("steady-state deploy preflight rejects a missing legacy Durable Object rollback binding", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    config.durable_objects.bindings = [];
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
  assert.equal((wrangler?.detail as { cacheRevalidationDoOk?: boolean }).cacheRevalidationDoOk, false);
});

test("deploy preflight requires a post-migration Durable Object rollback target", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/deploy-preflight.ts"), "utf8");

  assert.match(source, /remoteDurableObjectInfrastructureCheck/);
  assert.match(source, /deployments", "status", "--json"/);
  assert.match(source, /versions", "view"/);
  assert.match(source, /NEXT_CACHE_DO_QUEUE/);
  assert.match(source, /durable_object_namespace/);
  assert.match(source, /DOQueueHandler/);
});

test("steady-state deploy preflight rejects an OpenNext main Worker", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.writeFileSync(
    path.join(repoDir, "cloudflare-worker.ts"),
    'import handler from "./.open-next/worker.js";\nexport default handler;\n',
  );
  writeLocalEvidence(backupDir, buildRepoSourceFingerprint(repoDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const architecture = report.checks.find((check) => check.name === "Free static and native account architecture");
  assert.equal(architecture?.status, "fail");
  assert.equal(
    (architecture?.detail as { noOpenNextRuntimeImport?: boolean } | undefined)?.noOpenNextRuntimeImport,
    false,
  );
});

test("OpenNext runtime import detection rejects every OpenNext module import", () => {
  assert.equal(
    hasOpenNextRequestRuntimeImport(
      'export { DOQueueHandler } from "./.open-next/.build/durable-objects/queue.js";',
    ),
    true,
  );
  assert.equal(
    hasOpenNextRequestRuntimeImport('import handler from "./.open-next/worker.js";'),
    true,
  );
  assert.equal(
    hasOpenNextRequestRuntimeImport(
      'import handler from "./.open-next/server-functions/default/handler.mjs";',
    ),
    true,
  );
  assert.equal(
    hasOpenNextRequestRuntimeImport('const handler = require("./.open-next/worker.js");'),
    true,
  );
  assert.equal(hasOpenNextRequestRuntimeImport('import { getCloudflareContext } from "@opennextjs/cloudflare";'), true);
  assert.equal(hasOpenNextRequestRuntimeImport('import { NextResponse } from "next/server";'), true);
});

function makeFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-repo-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-backup-"));
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
  runGit(repoDir, ["init"]);
  fs.writeFileSync(path.join(repoDir, "app.ts"), "export const ok = true;\n");
  fs.writeFileSync(path.join(repoDir, "wrangler.jsonc"), `${JSON.stringify(wranglerConfig(), null, 2)}\n`);
  fs.writeFileSync(path.join(repoDir, "cloudflare-worker.ts"), leanWorkerSource());
  fs.mkdirSync(path.join(repoDir, "scripts/cloudflare"), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, "scripts/cloudflare/materialize-static-marketing-assets.ts"),
    leanMaterializerSource(),
  );
  fs.mkdirSync(path.join(repoDir, "public"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "public/_redirects"), "/tnc /terms 308\n");

  configurePushedFixtureRepository(repoDir);

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
  commitAndPushFixture(repoDir, "update Wrangler fixture");
  writeLocalEvidence(backupDir, buildRepoSourceFingerprint(repoDir));
}

function configurePushedFixtureRepository(repoDir: string) {
  runGit(repoDir, ["config", "user.email", "codex-tests@inspirlearning.invalid"]);
  runGit(repoDir, ["config", "user.name", "Codex Tests"]);
  runGit(repoDir, ["add", "."]);
  runGit(repoDir, ["commit", "-m", "fixture"]);
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-remote-"));
  runGit(remoteDir, ["init", "--bare"]);
  runGit(repoDir, ["remote", "add", "origin", remoteDir]);
  runGit(repoDir, ["push", "--set-upstream", "origin", "HEAD"]);
}

function commitAndPushFixture(repoDir: string, message: string) {
  runGit(repoDir, ["add", "."]);
  runGit(repoDir, ["commit", "-m", message]);
  runGit(repoDir, ["push"]);
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
  writeJson(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH, {
    kind: RUNTIME_MIGRATION_EVIDENCE_KIND,
    ok: true,
    createdAt,
    backupDir,
    database: D1_DATABASE_NAME,
    migrations: [...RUNTIME_MIGRATION_FILES],
    sourceFingerprintBefore: fingerprint,
    sourceFingerprint: fingerprint,
    sourceFingerprintStable: true,
    rowsRead: 31,
    rowsWritten: 0,
    checks: RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.map((id) => ({ id, ok: true })),
  });
  fs.chmodSync(path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH), 0o600);
  writeHistoricalBaselineEvidence(backupDir, fingerprint, HISTORICAL_FIXTURE_CREATED_AT);
}

function writeHistoricalBaselineEvidence(
  backupDir: string,
  fingerprint: SourceFingerprint,
  createdAt: Date,
) {
  fs.rmSync(historicalBaselinePath(backupDir), { force: true });
  const evidenceDir = path.join(backupDir, "cloudflare");
  for (const entry of fs.readdirSync(evidenceDir)) {
    if (/^d1-release-budget-ledger-\d{4}-\d{2}-\d{2}\.json(?:\.lock)?$/.test(entry)) {
      fs.rmSync(path.join(evidenceDir, entry), { force: true });
    }
  }
  const baseline = createHistoricalDataBaseline({
    backupDir,
    hmacSecret: HISTORICAL_FIXTURE_SECRET,
    sourceFingerprint: fingerprint,
    runner: historicalFixtureRunner(),
    usageLoader: () => HISTORICAL_FIXTURE_USAGE,
    clock: () => new Date(createdAt),
  });
  writeHistoricalDataReport(backupDir, baseline);
  return baseline;
}

function historicalBaselinePath(backupDir: string) {
  return path.join(backupDir, HISTORICAL_DATA_BASELINE_RELATIVE_PATH);
}

function readHistoricalBaselineFixture(backupDir: string) {
  return JSON.parse(
    fs.readFileSync(historicalBaselinePath(backupDir), "utf8"),
  ) as HistoricalDataBaselineReport;
}

function mutateHistoricalBaseline(
  backupDir: string,
  mutate: (baseline: HistoricalDataBaselineReport) => void,
) {
  const baseline = readHistoricalBaselineFixture(backupDir);
  mutate(baseline);
  writePrivateFixtureJson(historicalBaselinePath(backupDir), baseline);
}

function writePrivateFixtureJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  fs.chmodSync(filePath, 0o600);
}

function historicalBaselineFailureReason(check: { detail?: unknown } | undefined) {
  assert.ok(check?.detail && typeof check.detail === "object");
  const reason = (check.detail as { reason?: unknown }).reason;
  if (typeof reason !== "string") {
    throw new TypeError("Historical baseline failure detail did not contain a reason.");
  }
  return reason;
}

function makeHistoricalFixtureSource(content: string): SourceFingerprint {
  const file = {
    file: "source.ts",
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
  return {
    sha256: createHash("sha256")
      .update(`${file.file}\0${file.bytes}\0${file.sha256}\n`)
      .digest("hex"),
    fileCount: 1,
    files: [file],
  };
}

type HistoricalDatabaseFixture = {
  counts: Record<HistoricalDatasetName, number>;
  identities: Record<HistoricalDatasetName, Array<Record<string, unknown>>>;
};

function historicalDatabaseFixture(): HistoricalDatabaseFixture {
  return {
    counts: {
      users: 1,
      accounts: 1,
      sessions: 1,
      chats: 1,
      messages: 1,
      admin_users: 0,
      user_memories: 1,
      activity_runs: 0,
      product_events: 0,
      profile_photo_pointers: 0,
    },
    identities: {
      users: [{ identity_1: "historical-user-id" }],
      accounts: [{ identity_1: "account-id", identity_2: "historical-user-id" }],
      sessions: [{
        identity_1: "session-id",
        identity_2: "historical-user-id",
        identity_3: "private-session-token",
      }],
      chats: [{ identity_1: "chat-id", identity_2: "historical-user-id" }],
      messages: [{ identity_1: "message-id", identity_2: "chat-id" }],
      admin_users: [],
      user_memories: [{ identity_1: "memory-id", identity_2: "historical-user-id" }],
      activity_runs: [],
      product_events: [],
      profile_photo_pointers: [],
    },
  };
}

function historicalFixtureRunner(): WranglerRunner {
  const fixture = historicalDatabaseFixture();
  return (args) => {
    const sql = args.at(-1);
    if (sql === HISTORICAL_DATA_SUMMARY_SQL) {
      const countRows = HISTORICAL_DATASET_NAMES.map((name) => ({
        dataset: name,
        row_count: fixture.counts[name],
      }));
      const schemaRows = historicalSchemaTableNames().map((table) => ({
        table_name: table,
        name: table === "admin_users" ? "email" : "id",
        type: "text",
        not_null: 1,
        primary_key: 1,
      }));
      return historicalWranglerResult([
        { rows: countRows, rowsRead: countRows.length },
        { rows: schemaRows, rowsRead: schemaRows.length },
      ]);
    }
    if (sql === HISTORICAL_DATA_IDENTITIES_SQL) {
      return historicalWranglerResult(HISTORICAL_DATASET_NAMES.map((name) => ({
        rows: fixture.identities[name],
        rowsRead: fixture.identities[name].length,
      })));
    }
    throw new Error("Unexpected D1 SQL in deploy preflight historical fixture.");
  };
}

function historicalWranglerResult(
  sets: Array<{ rows: Array<Record<string, unknown>>; rowsRead: number }>,
) {
  return JSON.stringify(sets.map((set) => ({
    success: true,
    results: set.rows,
    meta: { rows_read: set.rowsRead, rows_written: 0 },
  })));
}

function historicalSchemaTableNames() {
  return [
    "users",
    "accounts",
    "sessions",
    "chats",
    "messages",
    "admin_users",
    "user_memories",
    "activity_runs",
    "product_events",
  ] as const;
}

type RuntimeMigrationFixtureReport = {
  ok: boolean;
  createdAt: string;
  migrations: string[];
  sourceFingerprint: { sha256: string; fileCount: number };
  checks: Array<{ id: string; ok: boolean }>;
};

function mutateRuntimeMigrationEvidence(
  backupDir: string,
  mutate: (report: RuntimeMigrationFixtureReport) => void,
) {
  const reportPath = path.join(backupDir, RUNTIME_MIGRATION_EVIDENCE_RELATIVE_PATH);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as RuntimeMigrationFixtureReport;
  mutate(report);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
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
    main: "./cloudflare-worker.ts",
    compatibility_date: "2026-07-10",
    workers_dev: false,
    preview_urls: false,
    assets: {
      directory: ".open-next/assets",
      binding: "ASSETS",
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
      run_worker_first: [...FREE_PLAN_WORKER_FIRST_ROUTES],
    },
    d1_databases: [{ binding: "DB", database_name: D1_DATABASE_NAME, database_id: D1_DATABASE_ID }],
    vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: VECTORIZE_INDEX_NAME }],
    r2_buckets: [{ binding: "PROFILE_IMAGES_R2_BUCKET", bucket_name: PROFILE_IMAGES_R2_BUCKET_NAME }],
    queues: {
      producers: [{ binding: "MEMORY_POST_TURN_QUEUE", queue: MEMORY_POST_TURN_QUEUE_NAME }],
      consumers: [{
        queue: MEMORY_POST_TURN_QUEUE_NAME,
        max_batch_size: 5,
        max_batch_timeout: 10,
        max_retries: 5,
        retry_delay: 60,
        dead_letter_queue: MEMORY_POST_TURN_DLQ_NAME,
      }],
    },
    triggers: { crons: ["0 3 * * *"] },
    services: [{ binding: "WORKER_SELF_REFERENCE", service: "inspirlearning" }],
    version_metadata: { binding: "CF_VERSION_METADATA" },
    durable_objects: {
      bindings: [{ name: "NEXT_CACHE_DO_QUEUE", class_name: "DOQueueHandler" }],
    },
    migrations: [{ tag: "opennext-cache-queue-v1", new_sqlite_classes: ["DOQueueHandler"] }],
    routes: [{ pattern: "inspirlearning.com" }, { pattern: "www.inspirlearning.com" }],
    observability: {
      enabled: true,
      head_sampling_rate: 0.02,
      logs: { enabled: true, head_sampling_rate: 0.05 },
      traces: { enabled: true, head_sampling_rate: 0.02 },
    },
    secrets: {
      required: [
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
      OPENAI_MODEL: "gpt-5-mini",
      OPENAI_FAST_MODEL: "gpt-5-mini",
      OPENAI_REASONING_MODEL: "gpt-5-mini",
      OPENAI_STRUCTURED_MODEL: "gpt-5-mini",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      RATE_LIMIT_USER_CHAT_DAILY: "20",
      RATE_LIMIT_GUEST_SESSION_DAILY: "10",
      RATE_LIMIT_GUEST_FINGERPRINT_DAILY: "10",
      RATE_LIMIT_GUEST_IP_DAILY: "150",
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

function leanWorkerSource() {
  return `import { handleFreeGuestChat } from "./lib/free-runtime/guest-chat";
import { handleLegacyI18nApiRequest } from "./lib/free-runtime/legacy-i18n-api";
import { handleAccountApiRequest, prewarmAccountApi } from "./lib/free-runtime/account-api";
import { handleStateApiRequest, handleMemoryScheduled, handleMemoryQueue } from "./lib/free-runtime/state-api";
import { handleProtectedAiApiRequest } from "./lib/free-runtime/protected-ai-api";
import { env as workerEnv } from "cloudflare:workers";
type Env = { CF_VERSION_METADATA: { id: string } };
prewarmAccountApi(workerEnv);
export class DOQueueHandler {}
export default {
  fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname === "/api/guest-chat") return handleFreeGuestChat(request, env);
    return Response.json({ version: env.CF_VERSION_METADATA.id });
  },
};
`;
}

function leanMaterializerSource() {
  return `const staticChatCacheKeys = new Set(["chat"]);
const staticTopicsDocument = "api/topics";
const staticMainAppBundleRoot = "i18n/main-app";
const legacyTranslationApiAssets = materializeLegacyTranslationApiAssets();
const staticAdminDocument = "admin/index.html";
const staticTopicRedirect = "/chat/example /chat?topic=example 308";
function writeStaticMainAppBundles() { return staticMainAppBundleRoot; }
function materializeLegacyTranslationApiAssets() { return []; }
// Exact public topic redirects preserve static 404s for unknown and private chat paths.
export { legacyTranslationApiAssets, staticChatCacheKeys, staticTopicRedirect, staticTopicsDocument, writeStaticMainAppBundles };
`;
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
