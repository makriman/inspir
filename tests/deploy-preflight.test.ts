import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
      ["Free static and lean guest architecture", "pass"],
    ],
  );
});

test("production Static Assets routes only health and guest chat through the Worker", () => {
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
  assert.equal(routes.some((route) => route.includes("*") || route.startsWith("!")), false);
  assert.deepEqual(routes, [...FREE_PLAN_WORKER_FIRST_ROUTES]);
  assert.deepEqual(config.vectorize ?? [], []);
  assert.deepEqual(config.r2_buckets ?? [], []);
  assert.deepEqual(config.queues?.producers ?? [], []);
  assert.deepEqual(config.queues?.consumers ?? [], []);
  assert.deepEqual(config.triggers?.crons ?? [], []);
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

test("steady-state deploy preflight rejects retired dynamic runtime bindings", () => {
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
      Object.assign(config, { triggers: { crons: ["0 3 * * *"] } });
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
    assert.equal((wrangler?.detail as { retiredBindingsAbsent?: boolean }).retiredBindingsAbsent, false);
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
  const architecture = report.checks.find((check) => check.name === "Free static and lean guest architecture");
  assert.equal(architecture?.status, "fail");
  assert.equal(
    (architecture?.detail as { noOpenNextRuntimeImport?: boolean } | undefined)?.noOpenNextRuntimeImport,
    false,
  );
});

test("OpenNext runtime import detection permits the rollback-only Durable Object export", () => {
  assert.equal(
    hasOpenNextRequestRuntimeImport(
      'export { DOQueueHandler } from "./.open-next/.build/durable-objects/queue.js";',
    ),
    false,
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
      required: ["CLOUDFLARE_AI_GATEWAY_TOKEN"],
    },
    vars: {
      CLOUDFLARE_AI_GATEWAY_BASE_URL: "https://gateway.ai.cloudflare.com/v1/account/inspir/openai",
      CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: "inspir",
      OPENAI_MODEL: "gpt-5-mini",
      OPENAI_FAST_MODEL: "gpt-5-mini",
      OPENAI_REASONING_MODEL: "gpt-5-mini",
      OPENAI_STRUCTURED_MODEL: "gpt-5-mini",
      RATE_LIMIT_GUEST_SESSION_DAILY: "10",
      RATE_LIMIT_GUEST_FINGERPRINT_DAILY: "10",
      RATE_LIMIT_GUEST_IP_DAILY: "150",
      LLM_GLOBAL_DAILY_CALL_LIMIT: "1000",
      OBSERVABILITY_INCIDENT_MODE: "0",
      APP_WRITE_FREEZE: "0",
      APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
    },
  };
}

function leanWorkerSource() {
  return `import { handleFreeGuestChat } from "./lib/free-runtime/guest-chat";
type Env = { CF_VERSION_METADATA: { id: string } };
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
const staticTopicRedirect = "/chat/example /chat?topic=example 308";
function writeStaticMainAppBundles() { return staticMainAppBundleRoot; }
// Exact public topic redirects preserve static 404s for unknown and private chat paths.
export { staticChatCacheKeys, staticTopicRedirect, staticTopicsDocument, writeStaticMainAppBundles };
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
