import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSanitizedCloudflareBuildEnv,
  isForbiddenBuildEnvKey,
  sanitizedDotEnvContent,
  withSanitizedProjectEnvFiles,
} from "../scripts/cloudflare/sanitized-build-env";
import {
  applyNativeWranglerDeployEnvironment,
  blockedOpenNextSkipBuildArgs,
  clearLocalPreviewCacheApiState,
  pruneUnusedOpenNextServerRuntime,
  runSanitizedBuildCommand,
} from "../scripts/cloudflare/run-sanitized-build";
import { buildArtifactScanReport, scanNextEnvFallbacks } from "../scripts/cloudflare/scan-build-artifacts";
import { WORKER_DEPLOY_REPORT, type WorkerDeployEvidenceReport } from "../scripts/cloudflare/worker-deploy-evidence";

test("sanitized build env removes runtime secret keys", () => {
  const cwd = makeRepo();
  const env = buildSanitizedCloudflareBuildEnv(
    {
      PATH: "/bin",
      OPENAI_API_KEY: "secret",
      AUTH_SECRET: "secret",
      CLOUDFLARE_ACCOUNT_ID: "account",
      APP_URL: "https://wrong.example",
    },
    cwd,
  );

  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.AUTH_SECRET, undefined);
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, "account");
  assert.equal(env.APP_URL, "https://inspirlearning.com");
  assert.equal(env.AUTH_URL, "https://inspirlearning.com");
  assert.equal(env.BETTER_AUTH_URL, "https://inspirlearning.com");
  assert.equal(env.NEXTJS_ENV, "production");
});

test("sanitized build path blocks OpenNext skip-build bypasses", () => {
  assert.equal(isForbiddenBuildEnvKey("SKIP_NEXT_APP_BUILD"), true);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("opennext-build", ["--skipNextBuild"]), ["--skipNextBuild"]);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("opennext-deploy", ["--skipBuild=true"]), ["--skipBuild=true"]);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("wrangler-preview", ["--remote"]), []);
});

test("native production deploy cannot delegate back to the retired OpenNext R2 path", () => {
  const deployEnv: Record<string, string | undefined> = {};
  const previewEnv: Record<string, string | undefined> = {};

  assert.equal(
    applyNativeWranglerDeployEnvironment("opennext-deploy", deployEnv).OPEN_NEXT_DEPLOY,
    "true",
  );
  assert.equal(
    applyNativeWranglerDeployEnvironment("wrangler-preview", previewEnv).OPEN_NEXT_DEPLOY,
    undefined,
  );
});

test("local preview clears only persisted Cache API state", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-preview-cache-reset-"));
  const cacheDir = path.join(cwd, ".wrangler", "state", "v3", "cache");
  const d1Dir = path.join(cwd, ".wrangler", "state", "v3", "d1");
  const r2Dir = path.join(cwd, ".wrangler", "state", "v3", "r2");
  try {
    for (const directory of [cacheDir, d1Dir, r2Dir]) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "sentinel"), directory);
    }

    assert.equal(clearLocalPreviewCacheApiState(cwd), cacheDir);
    assert.equal(fs.existsSync(cacheDir), false);
    assert.equal(fs.existsSync(path.join(d1Dir, "sentinel")), true);
    assert.equal(fs.existsSync(path.join(r2Dir, "sentinel")), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("lean build pruning removes only the unused OpenNext server function", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-lean-opennext-prune-"));
  const serverFile = path.join(cwd, ".open-next/server-functions/default/handler.mjs");
  const queueFile = path.join(cwd, ".open-next/.build/durable-objects/queue.js");
  const assetFile = path.join(cwd, ".open-next/assets/chat/index.html");
  try {
    for (const file of [serverFile, queueFile, assetFile]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "sentinel");
    }

    const result = pruneUnusedOpenNextServerRuntime(cwd);

    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(serverFile), false);
    assert.equal(fs.readFileSync(queueFile, "utf8"), "sentinel");
    assert.equal(fs.readFileSync(assetFile, "utf8"), "sentinel");
    assert.equal(pruneUnusedOpenNextServerRuntime(cwd).removed, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("fresh OpenNext artifacts must pass the resource budget before upload", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/run-sanitized-build.ts"), "utf8");
  const buildIndex = source.indexOf("const buildResult = spawnSync");
  const budgetIndex = source.indexOf("inspectOpenNextResourceBudget(process.cwd())", buildIndex);
  const scanIndex = source.indexOf("if (command.scanBefore)", budgetIndex);

  assert.ok(buildIndex >= 0);
  assert.ok(budgetIndex > buildIndex);
  assert.ok(scanIndex > budgetIndex);
  assert.match(source, /resourceBudgetOk: false/);
  const lockChecks = [...source.matchAll(/options\.assertValidationLockAvailable \?\? assertNoLiveProductionValidationLock/g)]
    .map((match) => match.index ?? -1);
  assert.equal(lockChecks.length, 2);
  assert.ok(lockChecks[0]! < buildIndex);
  assert.ok(lockChecks[1]! > scanIndex);
  assert.ok(lockChecks[1]! < source.indexOf("runBoundedReleaseChildSync(actualCommand", lockChecks[1]!));
  const captureIndex = source.indexOf("commandArtifactEvidence = deployEvidence.captureCommandArtifacts()", lockChecks[1]!);
  const acquireIndex = source.indexOf("acquireProductionValidationExclusion", captureIndex);
  const commandIndex = source.indexOf("runBoundedReleaseChildSync(actualCommand", acquireIndex);
  const releaseIndex = source.indexOf("releaseProductionValidationExclusion", commandIndex);
  assert.ok(captureIndex > lockChecks[1]!);
  assert.ok(acquireIndex > captureIndex);
  assert.ok(commandIndex > acquireIndex);
  assert.ok(releaseIndex > commandIndex);
});

test("production upload revalidates the fresh Static Asset tree after stale preflight evidence", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/run-sanitized-build.ts"), "utf8");
  const preflightIndex = source.indexOf("const preflight = deployPreflight(backupDir)");
  const buildIndex = source.indexOf("const buildResult = spawnSync");
  const materializeIndex = source.indexOf(
    "materializeStaticMarketingAssets(process.cwd())",
    buildIndex,
  );
  const scanIndex = source.indexOf("if (command.scanBefore)", materializeIndex);
  const freshValidationIndex = source.indexOf(
    "freshStaticAssetRelease = validateStaticMarketingAssetRelease(process.cwd())",
    scanIndex,
  );
  const captureIndex = source.indexOf(
    "commandArtifactEvidence = deployEvidence.captureCommandArtifacts()",
    freshValidationIndex,
  );
  const commandIndex = source.indexOf(
    "runBoundedReleaseChildSync(actualCommand",
    captureIndex,
  );

  assert.ok(preflightIndex >= 0);
  assert.ok(buildIndex > preflightIndex);
  assert.ok(materializeIndex > buildIndex);
  assert.ok(scanIndex > materializeIndex);
  assert.ok(freshValidationIndex > scanIndex);
  assert.ok(captureIndex > freshValidationIndex);
  assert.ok(commandIndex > captureIndex);
  assert.match(
    source.slice(freshValidationIndex, commandIndex),
    /Static Assets changed between fresh release validation and deploy artifact capture/,
  );
});

test("blocked OpenNext deploy writes non-secret Worker deploy evidence", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-evidence-"));
  const originalArgv = process.argv;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  try {
    process.argv = [process.execPath, "test", "--backup", backupDir];
    console.error = () => undefined;
    console.log = () => undefined;

    const result = runSanitizedBuildCommand("opennext-deploy", ["--skipBuild"]);
    const report = JSON.parse(
      fs.readFileSync(path.join(backupDir, WORKER_DEPLOY_REPORT), "utf8"),
    ) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 2);
    assert.equal(report.ok, false);
    assert.equal(report.mode, "opennext-deploy");
    assert.equal(report.commandExecuted, false);
    assert.deepEqual(report.command.slice(1, 4), ["deploy", "--config", "wrangler.jsonc"]);
    assert.deepEqual(report.blockedArgs, ["--skipBuild"]);
    assert.equal(report.sourceFingerprintStable, true);
    assert.equal(report.sourceFingerprintAfter.sha256.length, 64);
  } finally {
    process.argv = originalArgv;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("direct OpenNext deploy refuses to run when deploy preflight fails", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-preflight-"));
  const originalArgv = process.argv;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  try {
    process.argv = [process.execPath, "test", "--backup", backupDir];
    console.error = () => undefined;
    console.log = () => undefined;

    const result = runSanitizedBuildCommand("opennext-deploy", [], {
      deployPreflight: () => ({ ok: false, status: 1 }),
    });
    const report = JSON.parse(
      fs.readFileSync(path.join(backupDir, WORKER_DEPLOY_REPORT), "utf8"),
    ) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 1);
    assert.equal(report.ok, false);
    assert.equal(report.mode, "opennext-deploy");
    assert.equal(report.commandExecuted, false);
    assert.equal(report.deployPreflightOk, false);
    assert.equal(report.deployPreflightStatus, 1);
    assert.equal(report.scanBeforeOk, null);
  } finally {
    process.argv = originalArgv;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("direct OpenNext deploy refuses an active cross-workspace validation lock before building", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-lock-"));
  const originalArgv = process.argv;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  let lockChecks = 0;
  try {
    process.argv = [process.execPath, "test", "--backup", backupDir];
    console.error = () => undefined;
    console.log = () => undefined;

    const result = runSanitizedBuildCommand("opennext-deploy", [], {
      deployPreflight: () => ({ ok: true, status: 0 }),
      assertValidationLockAvailable: () => {
        lockChecks += 1;
        throw new Error("simulated active validation lock");
      },
    });
    const report = JSON.parse(
      fs.readFileSync(path.join(backupDir, WORKER_DEPLOY_REPORT), "utf8"),
    ) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 1);
    assert.equal(lockChecks, 1);
    assert.equal(report.ok, false);
    assert.equal(report.commandExecuted, false);
    assert.match(report.error ?? "", /lock absence was not proved before build/);
  } finally {
    process.argv = originalArgv;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("sanitized project env files are restored after a build callback", () => {
  const cwd = makeRepo();
  fs.writeFileSync(path.join(cwd, ".env.local"), "CUSTOM_KEEP=1\n");
  fs.writeFileSync(path.join(cwd, ".env.production.local"), "PUBLIC_FLAG=1\n");
  fs.writeFileSync(path.join(cwd, ".dev.vars"), "OPENAI_API_KEY=secret\nAUTH_SECRET=secret\n");

  withSanitizedProjectEnvFiles(() => {
    const local = fs.readFileSync(path.join(cwd, ".env.local"), "utf8");
    const production = fs.readFileSync(path.join(cwd, ".env.production.local"), "utf8");
    const devVars = fs.readFileSync(path.join(cwd, ".dev.vars"), "utf8");
    assert.match(local, /APP_URL=https:\/\/inspirlearning\.com/);
    assert.match(production, /APP_URL=https:\/\/inspirlearning\.com/);
    assert.equal(devVars.includes("OPENAI_API_KEY"), false);
    assert.equal(devVars.includes("AUTH_SECRET"), false);
  }, cwd);

  assert.equal(fs.readFileSync(path.join(cwd, ".env.local"), "utf8"), "CUSTOM_KEEP=1\n");
  assert.equal(fs.readFileSync(path.join(cwd, ".env.production.local"), "utf8"), "PUBLIC_FLAG=1\n");
  assert.equal(fs.readFileSync(path.join(cwd, ".dev.vars"), "utf8"), "OPENAI_API_KEY=secret\nAUTH_SECRET=secret\n");
});

test("next env fallback scan rejects sensitive compiled values", () => {
  const findings = scanNextEnvFallbacks(
    [
      'export const production = {"OPENAI_API_KEY":"sk-test","APP_URL":"https://inspirlearning.com"};',
      "export const development = {};",
      "export const test = {};",
    ].join("\n"),
  );

  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.key]),
    [["sensitive-env-fallback", "OPENAI_API_KEY"]],
  );
  assert.ok(findings.every((finding) => finding.valueSha256 && !JSON.stringify(finding).includes("sk-test")));
});

test("next env fallback scan rejects retired provider keys", () => {
  const retiredKey = ["NEXT_PUBLIC", ["SUPA", "BASE"].join(""), "URL"].join("_");
  const findings = scanNextEnvFallbacks(
    [
      `export const production = {"${retiredKey}":"https://old-provider.example","APP_URL":"https://inspirlearning.com"};`,
      "export const development = {};",
      "export const test = {};",
    ].join("\n"),
  );

  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.key]),
    [["retired-env-fallback", retiredKey]],
  );
  assert.ok(findings.every((finding) => finding.valueSha256 && !JSON.stringify(finding).includes("old-provider")));
});

test("artifact scan allows runtime env references but rejects literal credentials", () => {
  const cwd = makeRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-build-artifact-backup-"));
  fs.mkdirSync(path.join(cwd, ".open-next/cloudflare"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".open-next/server-functions/default"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".open-next/cloudflare/next-env.mjs"),
    'export const production = {"APP_URL":"https://inspirlearning.com"};\nexport const development = {};\nexport const test = {};\n',
  );
  fs.writeFileSync(
    path.join(cwd, ".open-next/server-functions/default/handler.mjs"),
    "const key = process.env.OPENAI_API_KEY;\n",
  );

  const cleanReport = buildArtifactScanReport(cwd, backupDir);
  assert.equal(cleanReport.ok, true);
  assert.equal(cleanReport.sourceFingerprint.sha256.length, 64);
  assert.equal(cleanReport.sourceFingerprint.fileCount, 1);

  const token = `cfat_${"A".repeat(32)}`;
  fs.writeFileSync(path.join(cwd, ".open-next/server-functions/default/handler.mjs"), `const leaked = "${token}";\n`);
  const report = buildArtifactScanReport(cwd, backupDir);

  assert.equal(report.ok, false);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]!.rule, "cloudflare-api-token");
  assert.equal(JSON.stringify(report.findings).includes(token), false);
});

test("artifact scan suppresses generated private-key templates but flags real private keys", () => {
  const cwd = makeRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-build-artifact-backup-"));
  const privateKeyBegin = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const privateKeyEnd = ["-----END ", "PRIVATE KEY-----"].join("");
  fs.mkdirSync(path.join(cwd, ".open-next/cloudflare"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".open-next/server-functions/default"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".open-next/cloudflare/next-env.mjs"),
    'export const production = {"APP_URL":"https://inspirlearning.com"};\nexport const development = {};\nexport const test = {};\n',
  );
  fs.writeFileSync(
    path.join(cwd, ".open-next/server-functions/default/handler.mjs"),
    [
      `if (key.indexOf("${privateKeyBegin}") !== 0) throw TypeError('"pkcs8" must be PKCS#8 formatted string');`,
      "const format = `-----BEGIN ${label}-----\\n${body}\\n-----END ${label}-----`;",
    ].join("\n"),
  );

  assert.equal(buildArtifactScanReport(cwd, backupDir).ok, true);

  fs.writeFileSync(
    path.join(cwd, ".open-next/server-functions/default/handler.mjs"),
    `const real = \`${privateKeyBegin}\\nabc\\n${privateKeyEnd}\`;\n`,
  );
  const report = buildArtifactScanReport(cwd, backupDir);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0]!.rule, "private-key");
});

test("sanitized dotenv content contains only non-secret wrangler vars", () => {
  const cwd = makeRepo();
  const content = sanitizedDotEnvContent(cwd);

  assert.match(content, /APP_URL=https:\/\/inspirlearning\.com/);
  assert.match(content, /OPENAI_MODEL=gpt-5/);
  assert.equal(content.includes("OPENAI_API_KEY"), false);
  assert.equal(content.includes("CLOUDFLARE_AI_GATEWAY_TOKEN"), false);
  assert.equal(content.includes("AUTH_SECRET"), false);
});

test("sanitized preview dotenv can include local-only auth placeholders", () => {
  const cwd = makeRepo();
  const content = sanitizedDotEnvContent(cwd, { includeLocalPreviewRuntimeSecrets: true });

  assert.match(content, /AUTH_SECRET=local-preview-auth-secret/);
  assert.match(content, /AUTH_GOOGLE_ID=local-preview-google-client-id/);
  assert.equal(content.includes("OPENAI_API_KEY"), false);
  assert.equal(content.includes("CLOUDFLARE_AI_GATEWAY_TOKEN"), false);
});

test("sanitized preview dotenv includes test auth only when explicitly supplied", () => {
  const cwd = makeRepo();
  const previousSecret = process.env.E2E_TEST_AUTH_SECRET;
  const previousEmail = process.env.E2E_TEST_AUTH_EMAIL;
  const previousAllowLocalCreate = process.env.E2E_TEST_AUTH_ALLOW_LOCAL_CREATE;
  const previousMutationRunId = process.env.E2E_TEST_MUTATION_RUN_ID;
  const previousExpiresAt = process.env.E2E_TEST_AUTH_EXPIRES_AT;

  try {
    delete process.env.E2E_TEST_AUTH_SECRET;
    delete process.env.E2E_TEST_AUTH_EMAIL;
    process.env.E2E_TEST_AUTH_ALLOW_LOCAL_CREATE = "1";
    process.env.E2E_TEST_MUTATION_RUN_ID = "22222222-2222-4222-8222-222222222222";
    process.env.E2E_TEST_AUTH_EXPIRES_AT = "1783872000000";
    assert.equal(sanitizedDotEnvContent(cwd, { includeLocalPreviewRuntimeSecrets: true }).includes("E2E_TEST_AUTH"), false);
    assert.doesNotMatch(
      sanitizedDotEnvContent(cwd, { includeLocalPreviewRuntimeSecrets: true }),
      /E2E_TEST_MUTATION_RUN_ID/,
    );
    assert.doesNotMatch(
      sanitizedDotEnvContent(cwd, { includeLocalPreviewRuntimeSecrets: true }),
      /E2E_TEST_AUTH_EXPIRES_AT/,
    );

    process.env.E2E_TEST_AUTH_SECRET = "local-preview-session-secret-32-bytes-minimum";
    process.env.E2E_TEST_AUTH_EMAIL = "learner@example.com";
    const content = sanitizedDotEnvContent(cwd, { includeLocalPreviewRuntimeSecrets: true });

    assert.match(content, /E2E_TEST_AUTH_SECRET=local-preview-session-secret-32-bytes-minimum/);
    assert.match(content, /E2E_TEST_AUTH_EMAIL=learner@example\.com/);
    assert.match(content, /E2E_TEST_AUTH_ALLOW_LOCAL_CREATE=1/);
    assert.match(content, /E2E_TEST_AUTH_REQUIRE_EXISTING=0/);
    assert.match(content, /ADMIN_EMAILS=learner@example\.com/);
    assert.doesNotMatch(content, /E2E_TEST_AUTH_IS_ADMIN/);
  } finally {
    if (previousSecret === undefined) delete process.env.E2E_TEST_AUTH_SECRET;
    else process.env.E2E_TEST_AUTH_SECRET = previousSecret;
    if (previousEmail === undefined) delete process.env.E2E_TEST_AUTH_EMAIL;
    else process.env.E2E_TEST_AUTH_EMAIL = previousEmail;
    if (previousAllowLocalCreate === undefined) delete process.env.E2E_TEST_AUTH_ALLOW_LOCAL_CREATE;
    else process.env.E2E_TEST_AUTH_ALLOW_LOCAL_CREATE = previousAllowLocalCreate;
    if (previousMutationRunId === undefined) delete process.env.E2E_TEST_MUTATION_RUN_ID;
    else process.env.E2E_TEST_MUTATION_RUN_ID = previousMutationRunId;
    if (previousExpiresAt === undefined) delete process.env.E2E_TEST_AUTH_EXPIRES_AT;
    else process.env.E2E_TEST_AUTH_EXPIRES_AT = previousExpiresAt;
  }
});

function makeRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-build-safety-"));
  const git = spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  fs.writeFileSync(
    path.join(cwd, "wrangler.jsonc"),
    JSON.stringify({
      vars: {
        APP_URL: "https://inspirlearning.com",
        AUTH_URL: "https://inspirlearning.com",
        BETTER_AUTH_URL: "https://inspirlearning.com",
        OPENAI_MODEL: "gpt-5",
      },
    }),
  );
  return cwd;
}
