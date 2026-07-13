import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertProductionReleaseOperationAllowed,
  assertTopicSequenceBeforeProductionLock,
  boundedReleaseChildCommand,
  parseRollbackArguments,
  productionReleaseOperationCommand,
  runBoundedReleaseChildSync,
} from "../scripts/cloudflare/run-production-release-operation";

const targetVersion = "11111111-1111-4111-8111-111111111111";

test("rollover blocks standalone source sync and prevalidates topic readiness before locking", () => {
  assert.throws(
    () => assertProductionReleaseOperationAllowed("sync-site-translation-sources"),
    /blocked for the 2026-07-13 budget-rollover release/,
  );
  const cwd = path.resolve("/tmp/inspir-topic-prelock");
  const backupDir = path.resolve("/tmp/inspir-topic-prelock-evidence");
  let validated = false;
  const readiness = { createdAt: "2026-07-13T10:00:00.000Z" };
  const result = assertTopicSequenceBeforeProductionLock(
    {
      args: ["--confirm-production", "--candidate-version", targetVersion],
      activeVersionId: targetVersion,
      backupDir,
      cwd,
    },
    {
      readGitIdentity: () => ({
        head: "a".repeat(40),
        upstream: "a".repeat(40),
        upstreamRef: "origin/codex/release",
      }),
      buildArtifactEvidence: () => ({
        sourceFingerprint: {
          sha256: "b".repeat(64),
          fileCount: 1,
          files: [{ file: "package.json", sha256: "c".repeat(64), bytes: 1 }],
        },
        workerSourceSha256: "d".repeat(64),
        wranglerConfigSha256: "e".repeat(64),
        assetManifest: {
          root: path.join(cwd, ".open-next/assets"),
          sha256: "f".repeat(64),
          fileCount: 1,
          bytes: 1,
        },
      }),
      validateVectorizeReadiness: (input) => {
        validated = true;
        assert.equal(input.backupDir, backupDir);
        assert.equal(input.currentRelease.candidateVersionId, targetVersion);
        return readiness;
      },
    },
  );
  assert.equal(validated, true);
  assert.equal(result, readiness);
  assert.throws(
    () => assertTopicSequenceBeforeProductionLock({
      args: ["--confirm-production", "--candidate-version", targetVersion],
      activeVersionId: "22222222-2222-4222-8222-222222222222",
      backupDir,
      cwd,
    }),
    /before exclusion acquisition/,
  );

  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-production-release-operation.ts"),
    "utf8",
  );
  assert.ok(
    source.indexOf("assertProductionReleaseOperationAllowed(operation)") <
      source.indexOf("buildRepoSourceFingerprint(cwd)"),
  );
  assert.ok(
    source.indexOf("assertTopicSequenceBeforeProductionLock({") <
      source.indexOf("acquireProductionValidationExclusion({"),
  );
});

test("guarded rollback accepts one explicit UUID and blocks passthrough overrides", () => {
  assert.deepEqual(
    parseRollbackArguments([
      "--confirm-production",
      "--target-version",
      targetVersion,
    ]),
    { targetVersionId: targetVersion },
  );
  assert.throws(
    () => parseRollbackArguments(["--confirm-production"]),
    /requires --target-version/,
  );
  assert.throws(
    () => parseRollbackArguments([
      "--confirm-production",
      "--target-version",
      targetVersion,
      "--name",
      "other-worker",
    ]),
    /unsupported argument/,
  );
});

test("production release operations use fixed child entry points", () => {
  const cwd = path.resolve("/tmp/inspir-release-operation-test");
  const migration = productionReleaseOperationCommand(
    "apply-d1-runtime-migrations",
    ["--confirm-production"],
    cwd,
  );
  assert.equal(migration.command, process.execPath);
  assert.deepEqual(migration.args.slice(0, 3), [
    "--import",
    "tsx",
    path.join(cwd, "scripts/cloudflare/apply-d1-runtime-migrations.ts"),
  ]);

  const rollback = productionReleaseOperationCommand(
    "rollback",
    ["--target-version", targetVersion, "--confirm-production"],
    cwd,
  );
  assert.equal(rollback.command, path.join(cwd, "node_modules/.bin/wrangler"));
  assert.deepEqual(rollback.args.slice(0, 4), [
    "rollback",
    targetVersion,
    "--name",
    "inspirlearning",
  ]);
  assert.equal(rollback.args.includes("--confirm-production"), false);
});

test("release child, final readback/report, and release stay inside one exclusion", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-production-release-operation.ts"),
    "utf8",
  );
  const acquireIndex = source.indexOf("acquireProductionValidationExclusion({");
  const revalidateIndex = source.indexOf("const lockedActiveVersion = readActiveVersion()", acquireIndex);
  const childIndex = source.indexOf("runChildWithExclusionHeartbeat({", revalidateIndex);
  const finalReadbackIndex = source.indexOf("activeVersionAfter = readActiveVersion()", childIndex);
  const firstReportIndex = source.indexOf("writeReport(backupDir, report)", finalReadbackIndex);
  const releaseIndex = source.indexOf("releaseProductionValidationExclusion(exclusion)", firstReportIndex);
  assert.ok(acquireIndex >= 0);
  assert.ok(revalidateIndex > acquireIndex);
  assert.ok(childIndex > revalidateIndex);
  assert.ok(finalReadbackIndex > childIndex);
  assert.ok(firstReportIndex > finalReadbackIndex);
  assert.ok(releaseIndex > firstReportIndex);
  assert.match(source, /setInterval\(\(\) => \{[\s\S]*attestProductionValidationExclusion/);
  assert.match(source, /process\.kill\(-child\.pid, "SIGKILL"\)/);
});

test("bounded production child preserves stdin and captured output", () => {
  const result = runBoundedReleaseChildSync(
    {
      command: process.execPath,
      args: [
        "--input-type=module",
        "--eval",
        "let value=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(String(value.length)));",
      ],
    },
    {
      input: "not-logged-secret",
      maxOutputBytes: 1024 * 1024,
      timeoutMs: 5_000,
    },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, String("not-logged-secret".length));
  assert.equal(result.stderr, "");
});

test("independent watchdog kills the complete bounded descendant group", { skip: process.platform === "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-bounded-child-"));
  const marker = path.join(directory, "late-mutation");
  try {
    const descendantSource = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 900); setInterval(() => {}, 1000);`;
    const childSource = `require("node:child_process").spawn(process.execPath, ["--eval", ${JSON.stringify(descendantSource)}], { stdio: "ignore" }); setInterval(() => {}, 1000);`;
    const result = runBoundedReleaseChildSync(
      { command: process.execPath, args: ["--eval", childSource] },
      { maxOutputBytes: 1024 * 1024, timeoutMs: 200 },
    );

    assert.notEqual(result.status, 0);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_100);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded watchdog survives a SIGKILLed synchronous parent", { skip: process.platform === "win32" }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-orphan-guard-"));
  const started = path.join(directory, "started");
  const lateMutation = path.join(directory, "late-mutation");
  const moduleUrl = pathToFileURL(
    path.resolve("scripts/cloudflare/run-production-release-operation.ts"),
  ).href;
  const actualSource = `require("node:fs").writeFileSync(${JSON.stringify(started)}, "started"); setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(lateMutation)}, "late"), 1200); setInterval(() => {}, 1000);`;
  const orchestratorSource = `import { runBoundedReleaseChildSync } from ${JSON.stringify(moduleUrl)}; runBoundedReleaseChildSync({ command: process.execPath, args: ["--eval", ${JSON.stringify(actualSource)}] }, { timeoutMs: 700, maxOutputBytes: 1048576 });`;
  const orchestrator = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", orchestratorSource],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  try {
    const deadline = Date.now() + 3_000;
    while (!fs.existsSync(started) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fs.existsSync(started), true);
    orchestrator.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(fs.existsSync(lateMutation), false);
  } finally {
    if (orchestrator.exitCode === null && orchestrator.signalCode === null) orchestrator.kill("SIGKILL");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded launcher proves watchdog readiness before starting a mutation", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-production-release-operation.ts"),
    "utf8",
  );
  const boundedEntry = source.indexOf("async function runBoundedChild");
  const watchdogReady = source.indexOf("const watchdog = await spawnReadyChild", boundedEntry);
  const mutationSpawn = source.indexOf("child = spawn(command.command", watchdogReady);
  assert.ok(boundedEntry >= 0);
  assert.ok(watchdogReady > boundedEntry);
  assert.ok(mutationSpawn > watchdogReady);
  assert.match(source, /\(\) => killOwnProcessGroup\(groupPid\)/);
  assert.match(source, /child\.on\("error", onPostSpawnError\)/);
  assert.match(source, /if \(!commandFinished\) killOwnProcessGroup/);
  const commandFinished = source.indexOf("commandFinished = true", mutationSpawn);
  const watchdogKilled = source.indexOf('watchdog.kill("SIGKILL")', commandFinished);
  assert.ok(commandFinished > mutationSpawn);
  assert.ok(watchdogKilled > commandFinished);

  const bounded = boundedReleaseChildCommand(
    { command: process.execPath, args: ["--version"] },
    process.cwd(),
    { timeoutMs: 1234, maxOutputBytes: 4096 },
  );
  assert.deepEqual(bounded.args.slice(-2), ["1234", "4096"]);
});

test("every direct production Wrangler mutation uses the bounded watchdog launcher", () => {
  const sanitizedDeploy = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-sanitized-build.ts"),
    "utf8",
  );
  const translationRepair = fs.readFileSync(
    path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
    "utf8",
  );
  const authenticatedValidation = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-authenticated-production-validation.ts"),
    "utf8",
  );

  assert.match(sanitizedDeploy, /requiresProductionDeployPreflight\(mode\)[\s\S]{0,180}runBoundedReleaseChildSync/);
  assert.equal(translationRepair.match(/runBoundedMutationWrangler\(/g)?.length, 4);
  assert.match(translationRepair, /runBoundedMutationWrangler\([\s\S]{0,250}"d1",[\s\S]{0,80}"execute"/);
  assert.doesNotMatch(translationRepair, /runWrangler\(buildPinnedWorkerVersionDeployArgs/);
  assert.match(authenticatedValidation, /runBoundedWranglerMutation\(\["secret", "delete"/);
  assert.match(authenticatedValidation, /runBoundedWranglerMutation\(\["secret", "put"/);
});

test("every production D1 release mutator self-requires the guarded child proof", () => {
  const expected = [
    ["scripts/cloudflare/apply-d1-runtime-migrations.ts", "apply-d1-runtime-migrations"],
    ["scripts/cloudflare/sync-site-translation-sources.ts", "sync-site-translation-sources"],
    ["scripts/cloudflare/sync-topic-seeds.ts", "sync-topic-seeds"],
  ] as const;
  for (const [file, operation] of expected) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(source, new RegExp(`assertProductionReleaseChildExclusion\\(\"${operation}\"\\)`));
  }
  assert.equal(fs.existsSync(path.resolve("scripts/cloudflare/activate-write-freeze.ts")), false);
  assert.equal(fs.existsSync(path.resolve("scripts/cloudflare/backup-frozen-cloudflare-production.ts")), false);
});

test("rollover runbook enforces Vectorize, topic, then translation release order", () => {
  const runbook = fs.readFileSync(path.resolve("deploy.md"), "utf8");
  const deploy = runbook.indexOf("## Atomic main deploy");
  const vectorize = runbook.indexOf("## Post-deploy Vectorize readiness gate");
  const topics = runbook.indexOf("## Atomic managed-topic reconciliation");
  const translations = runbook.indexOf("## Post-deploy translation reconciliation");
  const productionValidation = runbook.indexOf("## Production verification");

  assert.ok(deploy >= 0);
  assert.ok(vectorize > deploy);
  assert.ok(topics > vectorize);
  assert.ok(translations > topics);
  assert.ok(productionValidation > translations);
  assert.match(runbook, /2,500,000 reads and 50,000 writes/);
  assert.match(runbook, /4,000,000-read and 80,000-write lag-safe ceilings/);
  assert.match(runbook, /standalone source synchronizer is\nexplicitly forbidden/);
  assert.doesNotMatch(runbook, /pnpm cf:sync:site-translation-sources/);
});

test("post-deploy stages consume durable readiness and reconciliation predecessors", () => {
  const topicSync = fs.readFileSync(
    path.resolve("scripts/cloudflare/sync-topic-seeds.ts"),
    "utf8",
  );
  const translationRepair = fs.readFileSync(
    path.resolve("scripts/cloudflare/repair-seo-cta-translations.ts"),
    "utf8",
  );
  const authenticatedValidation = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-authenticated-production-validation.ts"),
    "utf8",
  );

  assert.match(topicSync, /assertFreshProductionVectorizeReadiness/);
  assert.match(
    topicSync,
    /verifyTopicSeedSnapshot[\s\S]*createTopicReconciliationAttestation[\s\S]*writeTopicReconciliationAttestation/,
  );
  assert.match(
    translationRepair,
    /assertRemoteRepairReleasePreflight[\s\S]*assertFreshProductionVectorizeReadiness/,
  );
  assert.match(translationRepair, /assertProductionTopicReconciliationReleaseBinding/);
  assert.match(
    translationRepair,
    /writeTranslationReconciliationPending[\s\S]*verifyRemoteTranslationDrift[\s\S]*writeTranslationReconciliationSuccess/,
  );
  assert.match(
    authenticatedValidation,
    /function assertCandidateReleaseEvidence[\s\S]*assertFreshProductionVectorizeReadiness/,
  );
  assert.match(
    authenticatedValidation,
    /assertFreshProductionVectorizeReadiness[\s\S]*assertFreshProductionTranslationReconciliation/,
  );
});

test("durable maintenance has one confirmed exact-state resolver", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/resolve-production-maintenance.ts"),
    "utf8",
  );
  const readIndex = source.indexOf("readProductionMaintenanceState()");
  const acquireIndex = source.indexOf("acquireProductionMaintenanceRecoveryExclusion", readIndex);
  const deployIndex = source.indexOf('"versions",', acquireIndex);
  const probeIndex = source.indexOf("assertCandidateIsUnfrozen", deployIndex);
  const preliminaryIndex = source.indexOf("writeReport(backupDir, preliminary)", probeIndex);
  const clearIndex = source.indexOf("clearProductionMaintenanceState", preliminaryIndex);
  const releaseIndex = source.indexOf("releaseProductionValidationExclusion", clearIndex);
  assert.ok(readIndex >= 0);
  assert.ok(acquireIndex > readIndex);
  assert.ok(deployIndex > acquireIndex);
  assert.ok(probeIndex > deployIndex);
  assert.ok(preliminaryIndex > probeIndex);
  assert.ok(clearIndex > preliminaryIndex);
  assert.ok(releaseIndex > clearIndex);
  assert.match(source, /--confirm-production/);
  assert.match(source, /--repair-run-id/);
  assert.match(source, /freezeRecord\?\.versionId !== expectedVersionId/);
});
