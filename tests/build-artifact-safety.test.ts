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
import { blockedOpenNextSkipBuildArgs, runSanitizedBuildCommand } from "../scripts/cloudflare/run-sanitized-build";
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
  assert.equal(env.NEXTAUTH_URL, "https://inspirlearning.com");
  assert.equal(env.NEXTJS_ENV, "production");
});

test("sanitized build path blocks OpenNext skip-build bypasses", () => {
  assert.equal(isForbiddenBuildEnvKey("SKIP_NEXT_APP_BUILD"), true);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("opennext-build", ["--skipNextBuild"]), ["--skipNextBuild"]);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("opennext-deploy", ["--skipBuild=true"]), ["--skipBuild=true"]);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("opennext-preview", ["--remote"]), []);
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
  assert.match(content, /NEXTAUTH_SECRET=local-preview-auth-secret/);
  assert.match(content, /AUTH_GOOGLE_ID=local-preview-google-client-id/);
  assert.equal(content.includes("OPENAI_API_KEY"), false);
  assert.equal(content.includes("CLOUDFLARE_AI_GATEWAY_TOKEN"), false);
});

test("sanitized preview dotenv includes test auth only when explicitly supplied", () => {
  const cwd = makeRepo();
  const previousSecret = process.env.E2E_TEST_AUTH_SECRET;
  const previousEmail = process.env.E2E_TEST_AUTH_EMAIL;

  try {
    delete process.env.E2E_TEST_AUTH_SECRET;
    delete process.env.E2E_TEST_AUTH_EMAIL;
    assert.equal(sanitizedDotEnvContent(cwd, { includeLocalPreviewRuntimeSecrets: true }).includes("E2E_TEST_AUTH"), false);

    process.env.E2E_TEST_AUTH_SECRET = "local-preview-session-secret";
    process.env.E2E_TEST_AUTH_EMAIL = "learner@example.com";
    const content = sanitizedDotEnvContent(cwd, { includeLocalPreviewRuntimeSecrets: true });

    assert.match(content, /E2E_TEST_AUTH_SECRET=local-preview-session-secret/);
    assert.match(content, /E2E_TEST_AUTH_EMAIL=learner@example\.com/);
  } finally {
    if (previousSecret === undefined) delete process.env.E2E_TEST_AUTH_SECRET;
    else process.env.E2E_TEST_AUTH_SECRET = previousSecret;
    if (previousEmail === undefined) delete process.env.E2E_TEST_AUTH_EMAIL;
    else process.env.E2E_TEST_AUTH_EMAIL = previousEmail;
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
        NEXTAUTH_URL: "https://inspirlearning.com",
        OPENAI_MODEL: "gpt-5",
      },
    }),
  );
  return cwd;
}
