import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FREE_PLAN_WORKER_FIRST_ROUTES,
  buildSteadyStateDeployPreflightReport,
} from "../scripts/cloudflare/deploy-preflight";
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
      ["OpenNext cache revalidation architecture", "pass"],
    ],
  );
});

test("production Static Assets config exactly covers the current dynamic routes", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    assets?: { not_found_handling?: string; run_worker_first?: string[] };
  };
  const routes: string[] = [...(config.assets?.run_worker_first ?? [])];
  assert.equal(config.assets?.not_found_handling, "404-page");
  assert.deepEqual([...routes].sort(), [...FREE_PLAN_WORKER_FIRST_ROUTES].sort());
  assert.equal(routes.includes("/api/*"), false);
  assert.equal(routes.includes("/*"), false);
  assert.ok(
    routes.includes("!/_next/static/*"),
    "Next client chunks must take precedence over deep localized Worker-first globs",
  );
  for (const required of ["/*/chat", "/*/chat/*", "/*/admin", "/*/admin/*", "/*/reset_pw"]) {
    assert.ok(routes.includes(required), `missing localized dynamic route ${required}`);
  }

  const apiRouteFiles = listFiles(path.resolve("app/api")).filter((file) => file.endsWith("/route.ts"));
  for (const file of apiRouteFiles) {
    const route = `/${path.relative(path.resolve("app"), path.dirname(file)).split(path.sep).join("/")}`
      .replaceAll(/\[\.\.\.\w+\]/g, "probe")
      .replaceAll(/\[\w+\]/g, "probe");
    assert.ok(routes.some((pattern) => routePatternMatches(pattern, route)), `unrouted dynamic endpoint ${route}`);
  }
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

test("steady-state deploy preflight rejects missing response cache runtime vars", () => {
  const { backupDir, repoDir } = makeFixture();
  replaceWranglerConfig(repoDir, backupDir, (config) => {
    delete (config.vars as Record<string, string | undefined>).AI_RESPONSE_CACHE_TTL_SECONDS;
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
  assert.ok((wrangler?.detail as { missingVars?: string[] } | undefined)?.missingVars?.includes("AI_RESPONSE_CACHE_TTL_SECONDS"));
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
    (routes: string[]) => routes.splice(routes.indexOf("/*/chat/*"), 1),
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

test("steady-state deploy preflight rejects a missing OpenNext Durable Object queue", () => {
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

test("steady-state deploy preflight rejects dummy OpenNext revalidation architecture", () => {
  const { backupDir, repoDir } = makeFixture();
  fs.writeFileSync(
    path.join(repoDir, "open-next.config.ts"),
    'import { defineCloudflareConfig } from "@opennextjs/cloudflare";\nexport default defineCloudflareConfig({});\n',
  );
  writeLocalEvidence(backupDir, buildRepoSourceFingerprint(repoDir));

  const report = buildSteadyStateDeployPreflightReport({
    backupDir,
    cwd: repoDir,
    runWranglerDryRun: false,
    nowMs: Date.parse("2026-06-26T12:00:00Z"),
  });

  assert.equal(report.ok, false);
  const openNext = report.checks.find((check) => check.name === "OpenNext cache revalidation architecture");
  assert.equal(openNext?.status, "fail");
});

function makeFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-repo-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-deploy-preflight-backup-"));
  fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
  runGit(repoDir, ["init"]);
  fs.writeFileSync(path.join(repoDir, "app.ts"), "export const ok = true;\n");
  fs.writeFileSync(path.join(repoDir, "wrangler.jsonc"), `${JSON.stringify(wranglerConfig(), null, 2)}\n`);
  fs.writeFileSync(path.join(repoDir, "open-next.config.ts"), openNextConfig());
  fs.mkdirSync(path.join(repoDir, "public"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "public/_redirects"), "/tnc /terms 308\n");

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

function listFiles(root: string) {
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    const stats = fs.statSync(current);
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
    } else if (stats.isFile()) {
      files.push(current);
    }
  }
  return files;
}

function routePatternMatches(pattern: string, route: string) {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(route);
}

function wranglerConfig() {
  return {
    name: "inspirlearning",
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
    r2_buckets: [
      { binding: "NEXT_INC_CACHE_R2_BUCKET", bucket_name: R2_BUCKET_NAME },
      { binding: "PROFILE_IMAGES_R2_BUCKET", bucket_name: PROFILE_IMAGES_R2_BUCKET_NAME },
    ],
    services: [{ binding: "WORKER_SELF_REFERENCE", service: "inspirlearning" }],
    version_metadata: { binding: "CF_VERSION_METADATA" },
    durable_objects: {
      bindings: [{ name: "NEXT_CACHE_DO_QUEUE", class_name: "DOQueueHandler" }],
    },
    migrations: [{ tag: "opennext-cache-queue-v1", new_sqlite_classes: ["DOQueueHandler"] }],
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
      AI_RESPONSE_CACHE_ENABLED: "1",
      AI_RESPONSE_CACHE_TTL_SECONDS: "2592000",
      AI_RESPONSE_CACHE_MAX_RESPONSE_BYTES: "120000",
      AI_RESPONSE_CACHE_SEMANTIC_ENABLED: "0",
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
      MAX_REVALIDATE_CONCURRENCY: "1",
      NEXT_CACHE_DO_QUEUE_MAX_REVALIDATION: "1",
    },
  };
}

function openNextConfig() {
  return `import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import queueCache from "@opennextjs/cloudflare/overrides/queue/queue-cache";

export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "long-lived" }),
  queue: queueCache(doQueue, { regionalCacheTtlSec: 5, waitForQueueAck: true }),
  enableCacheInterception: true,
  routePreloadingBehavior: "none",
});
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
