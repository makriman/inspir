import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSanitizedCloudflareBuildEnv,
  isForbiddenBuildEnvKey,
  localPreviewProviderSecretValues,
  localPreviewRuntimeDotEnvContent,
  resolveLocalPreviewE2EAuth,
  resolveLocalPreviewProviderRuntimeSecrets,
  sanitizedDotEnvContent,
  withSanitizedProjectEnvFiles,
} from "../scripts/cloudflare/sanitized-build-env";
import {
  applyNativeWranglerDeployEnvironment,
  assertWorkerCandidatePreActivationSealValidityWindow,
  blockedOpenNextSkipBuildArgs,
  buildCandidateActivationVersionCommand,
  buildCandidateStagingVersionCommand,
  buildCandidateUploadVersionCommand,
  clearLocalPreviewCacheApiState,
  pruneUnusedOpenNextServerRuntime,
  requiresProductionDeployPreflight,
  requiresSealedProductionArtifacts,
  runAfterFinalProductionDeployPreflight,
  runSanitizedBuildCommand,
  WORKER_CANDIDATE_ACTIVATION_COMMAND_TIMEOUT_MS,
  WORKER_CANDIDATE_ACTIVATION_SEAL_MARGIN_MS,
} from "../scripts/cloudflare/run-sanitized-build";
import { buildArtifactScanReport, scanNextEnvFallbacks } from "../scripts/cloudflare/scan-build-artifacts";
import { buildRepoSourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
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

test("preview provider credential is runtime-only and ignored by source identity", () => {
  const cwd = makeRepo();
  const gatewayToken = "preview-gateway-runtime-token-sentinel";
  const unsupportedProviderKey = "unsupported-openai-provider-sentinel";
  const originalDevVars = [
    `CLOUDFLARE_AI_GATEWAY_TOKEN=${gatewayToken}`,
    `OPENAI_API_KEY=${unsupportedProviderKey}`,
    "",
  ].join("\n");
  fs.writeFileSync(
    path.join(cwd, ".gitignore"),
    [".dev.vars*", ".env*", ".wrangler.preview.local.jsonc", ""].join(
      "\n",
    ),
  );
  fs.writeFileSync(path.join(cwd, ".dev.vars"), originalDevVars, {
    mode: 0o600,
  });

  try {
    const sourceBefore = buildRepoSourceFingerprint(cwd);
    const providerSecrets = resolveLocalPreviewProviderRuntimeSecrets(
      { OPENAI_API_KEY: unsupportedProviderKey },
      cwd,
    );
    const providerValues = localPreviewProviderSecretValues(providerSecrets);
    assert.deepEqual(Object.keys(providerSecrets), [
      "CLOUDFLARE_AI_GATEWAY_TOKEN",
    ]);
    assert.equal(providerValues.length, 1);
    assert.equal(providerValues[0]?.length, gatewayToken.length);

    const buildEnv = buildSanitizedCloudflareBuildEnv(
      {
        CLOUDFLARE_AI_GATEWAY_TOKEN: gatewayToken,
        OPENAI_API_KEY: unsupportedProviderKey,
      },
      cwd,
      {
        CLOUDFLARE_AI_GATEWAY_TOKEN: gatewayToken,
        OPENAI_API_KEY: unsupportedProviderKey,
      },
    );
    assert.equal(buildEnv.CLOUDFLARE_AI_GATEWAY_TOKEN, undefined);
    assert.equal(buildEnv.OPENAI_API_KEY, undefined);
    assert.equal(sanitizedDotEnvContent(cwd).includes(gatewayToken), false);
    assert.equal(
      sanitizedDotEnvContent(cwd, {
        overrides: {
          CLOUDFLARE_AI_GATEWAY_TOKEN: gatewayToken,
          OPENAI_API_KEY: unsupportedProviderKey,
        },
      }).includes(gatewayToken),
      false,
    );

    withSanitizedProjectEnvFiles(
      () => {
        const buildDotEnv = fs.readFileSync(
          path.join(cwd, ".dev.vars"),
          "utf8",
        );
        assert.equal(buildDotEnv.includes(gatewayToken), false);
        assert.equal(buildDotEnv.includes(unsupportedProviderKey), false);

        const runtimeDotEnv = localPreviewRuntimeDotEnvContent(
          cwd,
          providerSecrets,
        );
        assert.equal(runtimeDotEnv.includes(gatewayToken), true);
        assert.equal(runtimeDotEnv.includes(unsupportedProviderKey), false);
        fs.writeFileSync(path.join(cwd, ".dev.vars"), runtimeDotEnv, {
          mode: 0o600,
        });

        const sourceDuringRuntimeInjection = buildRepoSourceFingerprint(cwd);
        assert.equal(
          sourceDuringRuntimeInjection.sha256,
          sourceBefore.sha256,
        );
        assert.equal(
          JSON.stringify(sourceDuringRuntimeInjection).includes(gatewayToken),
          false,
        );
      },
      cwd,
    );

    assert.equal(
      fs.readFileSync(path.join(cwd, ".dev.vars"), "utf8"),
      originalDevVars,
    );
    assert.equal(buildRepoSourceFingerprint(cwd).sha256, sourceBefore.sha256);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("preview E2E auth resolves only from process env or a private local env file", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-preview-e2e-auth-"));
  const email = "preview-admin@example.com";
  const secret = "preview-e2e-auth-secret-32-bytes-minimum";
  const localEnv = [
    `E2E_TEST_AUTH_EMAIL=${email}`,
    `E2E_TEST_AUTH_SECRET=${secret}`,
    "",
  ].join("\n");

  try {
    fs.writeFileSync(path.join(cwd, ".dev.vars"), localEnv, { mode: 0o600 });
    const fromFile = resolveLocalPreviewE2EAuth({}, cwd);
    assert.equal(fromFile.configured, true);
    assert.equal(fromFile.email, email);
    assert.equal(fromFile.secret, secret);

    fs.chmodSync(path.join(cwd, ".dev.vars"), 0o644);
    assert.equal(resolveLocalPreviewE2EAuth({}, cwd).configured, false);

    fs.chmodSync(path.join(cwd, ".dev.vars"), 0o600);
    fs.writeFileSync(
      path.join(cwd, ".dev.vars"),
      `${localEnv}E2E_TEST_AUTH_SECRET=${secret}\n`,
      { mode: 0o600 },
    );
    assert.equal(resolveLocalPreviewE2EAuth({}, cwd).configured, false);

    const fromProcess = resolveLocalPreviewE2EAuth(
      {
        E2E_TEST_AUTH_EMAIL: email,
        E2E_TEST_AUTH_SECRET: secret,
      },
      cwd,
    );
    assert.equal(fromProcess.configured, true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("preview runner injects provider credentials only after the sanitized build", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-sanitized-build.ts"),
    "utf8",
  );
  const captureIndex = source.indexOf(
    "const localPreviewProviderSecrets =",
  );
  const sanitizedFilesIndex = source.indexOf(
    "return withSanitizedProjectEnvFiles",
    captureIndex,
  );
  const buildIndex = source.indexOf(
    "const buildResult = spawnSync",
    sanitizedFilesIndex,
  );
  const runtimeInjectionIndex = source.indexOf(
    "writeLocalPreviewRuntimeVars(localPreviewProviderSecrets)",
    buildIndex,
  );
  const commandIndex = source.indexOf(
    "result: spawnSync(actualCommand.command",
    runtimeInjectionIndex,
  );

  assert.ok(captureIndex >= 0);
  assert.ok(sanitizedFilesIndex > captureIndex);
  assert.ok(buildIndex > sanitizedFilesIndex);
  assert.ok(runtimeInjectionIndex > buildIndex);
  assert.ok(commandIndex > runtimeInjectionIndex);
  assert.match(
    source,
    /requiredSecrets\.add\("CLOUDFLARE_AI_GATEWAY_TOKEN"\)/,
  );
  assert.doesNotMatch(
    source.slice(runtimeInjectionIndex, commandIndex),
    /Object\.assign\(env,\s*localPreviewProviderSecrets\)/,
  );
});

test("sanitized build path blocks OpenNext skip-build bypasses", () => {
  assert.equal(isForbiddenBuildEnvKey("SKIP_NEXT_APP_BUILD"), true);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("opennext-build", ["--skipNextBuild"]), ["--skipNextBuild"]);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("worker-stage-candidate", ["--skipBuild"]), ["--skipBuild"]);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("worker-activate-candidate", ["--skipBuild=true"]), ["--skipBuild=true"]);
  assert.deepEqual(blockedOpenNextSkipBuildArgs("wrangler-preview", ["--remote"]), []);
});

test("native production deploy cannot delegate back to the retired OpenNext R2 path", () => {
  const deployEnv: Record<string, string | undefined> = {};
  const previewEnv: Record<string, string | undefined> = {};

  assert.equal(
    applyNativeWranglerDeployEnvironment("worker-activate-candidate", deployEnv).OPEN_NEXT_DEPLOY,
    undefined,
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

test("sealed production artifacts pass resource and lock gates without rebuilding", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/run-sanitized-build.ts"), "utf8");
  const candidateCommandBlock = source.slice(
    source.indexOf('"worker-upload-candidate": {'),
    source.indexOf('"wrangler-preview": {'),
  );
  assert.doesNotMatch(candidateCommandBlock, /buildBefore/);
  assert.match(
    candidateCommandBlock,
    /args: \["versions", "upload", "--config", "wrangler\.jsonc", "--strict"\]/,
  );
  assert.match(candidateCommandBlock, /args: \["versions", "deploy"\]/);
  assert.match(source, /"candidate-staged"/);
  assert.match(source, /assertExactDeployPreparationUnchanged/);
  assert.match(source, /assertCandidateStartingTopology/);
  assert.match(source, /createPrivateWranglerOutputFile/);
  assert.match(source, /env\.WRANGLER_OUTPUT_FILE_PATH = wranglerOutputPath/);
  assert.match(source, /runBoundedReleaseChildSync\(actualCommand/);
  assert.match(source, /buildArtifactScanReport/);
  assert.match(source, /resourceBudgetOk: false/);
  const lockChecks = [...source.matchAll(/options\.assertValidationLockAvailable \?\? assertNoLiveProductionValidationLock/g)]
    .map((match) => match.index ?? -1);
  assert.equal(lockChecks.length, 2);
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

test("candidate upload, staging, and activation use exact immutable Wrangler commands", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/run-sanitized-build.ts"), "utf8");
  const gitHead = "a".repeat(40);
  const preparationSha256 = "b".repeat(64);
  const upload = buildCandidateUploadVersionCommand({
    gitHead,
    preparationSha256,
  });
  const candidateVersionId = "22222222-2222-4222-8222-222222222222";
  const baselineVersionId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(upload.args, [
    "versions",
    "upload",
    "--config",
    "wrangler.jsonc",
    "--strict",
    "--tag",
    `inspir-${gitHead.slice(0, 16)}-${preparationSha256.slice(0, 16)}`,
    "--message",
    `inspirlearning candidate git ${gitHead} sealed preparation ${preparationSha256}`,
  ]);
  assert.match(upload.annotations.messageSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    buildCandidateActivationVersionCommand(candidateVersionId),
    [
      "versions",
      "deploy",
      `${candidateVersionId}@100%`,
      "--config",
      "wrangler.jsonc",
      "--yes",
    ],
  );
  assert.throws(
    () => buildCandidateActivationVersionCommand("latest"),
    /UUID is malformed/,
  );
  assert.deepEqual(
    buildCandidateStagingVersionCommand(
      baselineVersionId,
      candidateVersionId,
    ),
    [
      "versions",
      "deploy",
      `${baselineVersionId}@100%`,
      `${candidateVersionId}@0%`,
      "--config",
      "wrangler.jsonc",
      "--yes",
    ],
  );
  assert.throws(
    () => buildCandidateStagingVersionCommand("latest", candidateVersionId),
    /staging baseline UUID is malformed/,
  );
  assert.throws(
    () => buildCandidateStagingVersionCommand(baselineVersionId, "latest"),
    /staging candidate UUID is malformed/,
  );
  assert.throws(
    () =>
      buildCandidateStagingVersionCommand(
        candidateVersionId,
        candidateVersionId,
      ),
    /UUIDs must differ/,
  );
  assert.equal(requiresProductionDeployPreflight("worker-stage-candidate"), false);
  assert.equal(requiresSealedProductionArtifacts("worker-stage-candidate"), true);
  assert.match(source, /mode === "worker-upload-candidate"/);
  assert.match(source, /mode === "worker-stage-candidate"/);
  assert.match(source, /"--tag"/);
  assert.match(source, /"--message"/);
  assert.match(source, /"--yes"/);
  assert.match(source, /verifyWorkerCandidateStagedEvidence/);
  assert.match(source, /readAndValidateWorkerCandidatePreActivationSeal/);
  assert.match(source, /preActivationSealHandle/);
  assert.match(source, /finalizeWorkerCandidateUploadEvidence/);
  assert.match(source, /finalizeWorkerCandidateStagedEvidence/);
  assert.match(source, /finalizeWorkerCandidateActivationEvidence/);
  assert.doesNotMatch(source, /args:\s*\["deploy", "--config", "wrangler\.jsonc"\]/);
});

test("staging requires inactive upload evidence and never reads an activation seal", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-sanitized-build.ts"),
    "utf8",
  );
  const start = source.indexOf(
    '  if (input.mode === "worker-stage-candidate") {',
  );
  const end = source.indexOf(
    "\n  assertCandidateEvidenceTargetAbsent(",
    start + 1,
  );
  const stagingResolution = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(stagingResolution, /workerCandidateUploadEvidencePath/);
  assert.match(stagingResolution, /workerCandidateStagedEvidencePath/);
  assert.match(stagingResolution, /workerCandidateActivationEvidencePath/);
  assert.match(stagingResolution, /parseSoleBaselineTopology/);
  assert.match(stagingResolution, /assertUploadEvidenceMatchesCurrentRelease/);
  assert.doesNotMatch(stagingResolution, /readCandidatePreActivationSeal/);
  assert.doesNotMatch(stagingResolution, /versions["',\s]+upload/);
});

test("the immediate activation seal gate covers the bounded command plus safety margin", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");
  const minimumRemainingValidityMs =
    WORKER_CANDIDATE_ACTIVATION_COMMAND_TIMEOUT_MS +
    WORKER_CANDIDATE_ACTIVATION_SEAL_MARGIN_MS;
  const exactlyValid = new Date(
    now.getTime() + minimumRemainingValidityMs,
  ).toISOString();
  const oneMillisecondShort = new Date(
    now.getTime() + minimumRemainingValidityMs - 1,
  ).toISOString();

  assert.doesNotThrow(() =>
    assertWorkerCandidatePreActivationSealValidityWindow(
      exactlyValid,
      minimumRemainingValidityMs,
      now,
    ),
  );
  assert.throws(
    () =>
      assertWorkerCandidatePreActivationSealValidityWindow(
        oneMillisecondShort,
        minimumRemainingValidityMs,
        now,
      ),
    /does not have enough validity remaining/,
  );
  assert.throws(
    () =>
      assertWorkerCandidatePreActivationSealValidityWindow(
        exactlyValid,
        -1,
        now,
      ),
    /non-negative safe integer/,
  );
});

test("live pre-activation seals are issued after the expensive preflight", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "scripts/cloudflare/worker-candidate-pre-activation-seal.ts",
    ),
    "utf8",
  );

  assert.match(source, /const sealIssuedAt = options\.now \?\? new Date\(\);/);
  assert.match(source, /const createdAt = sealIssuedAt\.toISOString\(\);/);
  assert.match(
    source.replace(/\s+/g, " "),
    /sealIssuedAt\.getTime\(\) \+ WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS/,
  );
  assert.doesNotMatch(
    source,
    /createWorkerCandidatePreActivationSeal\(\{[\s\S]{0,240}\n\s+now,/,
  );
});

test("a stale final production preflight blocks the command after an earlier pass", () => {
  const events: string[] = [];
  let preflightCalls = 0;
  let commandCalls = 0;
  const deployPreflight = () => {
    preflightCalls += 1;
    events.push(`preflight-${preflightCalls}`);
    return preflightCalls === 1
      ? { ok: true, status: 0 }
      : { ok: false, status: 1 };
  };

  const initialPreflight = deployPreflight();
  assert.equal(initialPreflight.ok, true);
  events.push("build-and-artifact-validation");

  const result = runAfterFinalProductionDeployPreflight({
    backupDir: "/owner-only/release-evidence",
    deployPreflight,
    onRejected: (finalPreflight) => ({
      commandExecuted: false as const,
      status: finalPreflight.status,
    }),
    runCommand: () => {
      commandCalls += 1;
      events.push("external-command");
      return { commandExecuted: true as const, status: 0 };
    },
  });

  assert.equal(preflightCalls, 2);
  assert.equal(commandCalls, 0);
  assert.deepEqual(result, { commandExecuted: false, status: 1 });
  assert.deepEqual(events, [
    "preflight-1",
    "build-and-artifact-validation",
    "preflight-2",
  ]);
});

test("blocked candidate activation writes non-secret Worker command evidence", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-evidence-"));
  const originalArgv = process.argv;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  try {
    process.argv = [process.execPath, "test", "--backup", backupDir];
    console.error = () => undefined;
    console.log = () => undefined;

    const result = runSanitizedBuildCommand("worker-activate-candidate", ["--skipBuild"]);
    const report = JSON.parse(
      fs.readFileSync(path.join(backupDir, WORKER_DEPLOY_REPORT), "utf8"),
    ) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 2);
    assert.equal(report.ok, false);
    assert.equal(report.mode, "worker-candidate-activation");
    assert.equal(report.commandExecuted, false);
    assert.deepEqual(report.command.slice(1, 3), ["versions", "deploy"]);
    assert.deepEqual(report.blockedArgs, ["--skipBuild"]);
    assert.equal(report.sourceFingerprintAfter.sha256.length, 64);
  } finally {
    process.argv = originalArgv;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("direct remote Wrangler preview fails before build or network without trust acceptance", () => {
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-remote-preview-trust-"),
  );
  const originalArgv = process.argv;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  let acceptanceReads = 0;
  try {
    process.argv = [process.execPath, "test", "--backup", backupDir];
    console.error = () => undefined;
    console.log = () => undefined;
    const result = runSanitizedBuildCommand("wrangler-preview", ["--remote"], {
      readTrustAcceptance: () => {
        acceptanceReads += 1;
        throw new Error("acceptance absent");
      },
    });
    assert.equal(result.status, 1);
    assert.equal(acceptanceReads, 1);
  } finally {
    process.argv = originalArgv;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("candidate activation refuses to run before preflight when its preparation is absent", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-preflight-"));
  const originalArgv = process.argv;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  try {
    process.argv = [process.execPath, "test", "--backup", backupDir];
    console.error = () => undefined;
    console.log = () => undefined;

    let preflightCalls = 0;
    const result = runSanitizedBuildCommand("worker-activate-candidate", [], {
      deployPreflight: () => {
        preflightCalls += 1;
        return { ok: false, status: 1 };
      },
    });
    const report = JSON.parse(
      fs.readFileSync(path.join(backupDir, WORKER_DEPLOY_REPORT), "utf8"),
    ) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 1);
    assert.equal(preflightCalls, 0);
    assert.equal(report.ok, false);
    assert.equal(report.mode, "worker-candidate-activation");
    assert.equal(report.commandExecuted, false);
    assert.equal(report.deployPreflightOk, false);
    assert.equal(report.deployPreflightStatus, null);
    assert.equal(report.scanBeforeOk, null);
    assert.match(report.error ?? "", /deploy preparation is missing or invalid/);
  } finally {
    process.argv = originalArgv;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("candidate activation checks its preparation before a cross-workspace validation lock", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-lock-"));
  const originalArgv = process.argv;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  let lockChecks = 0;
  try {
    process.argv = [process.execPath, "test", "--backup", backupDir];
    console.error = () => undefined;
    console.log = () => undefined;

    const result = runSanitizedBuildCommand("worker-activate-candidate", [], {
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
    assert.equal(lockChecks, 0);
    assert.equal(report.ok, false);
    assert.equal(report.commandExecuted, false);
    assert.match(report.error ?? "", /deploy preparation is missing or invalid/);
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
