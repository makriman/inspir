import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertProductionReleaseOperationAllowed,
  assertRuntimeMigration0017LiveBaselineBeforeProductionLock,
  assertRuntimeMigration0017ReleaseBeforeProductionLock,
  assertTopicSequenceBeforeProductionLock,
  boundedReleaseChildCommand,
  parseRollbackArguments,
  productionReleaseOperationCommand,
  runBoundedReleaseChildSync,
  runProductionReleaseOperation,
} from "../scripts/cloudflare/run-production-release-operation";
import type { WorkerDeployArtifactEvidence } from "../scripts/cloudflare/worker-deploy-evidence";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateEvidenceSha256,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const targetVersion = "11111111-1111-4111-8111-111111111111";
const baselineVersion = "22222222-2222-4222-8222-222222222222";

test("rollover blocks standalone source sync and prevalidates topic readiness before locking", () => {
  assert.throws(
    () => assertProductionReleaseOperationAllowed("sync-site-translation-sources"),
    /blocked for the 2026-07-13 budget-rollover release/,
  );
  const cwd = path.resolve("/tmp/inspir-topic-prelock");
  const backupDir = path.resolve("/tmp/inspir-topic-prelock-evidence");
  let validated = false;
  const readiness = { createdAt: "2026-07-13T10:00:00.000Z" };
  const git = {
    head: "a".repeat(40),
    upstream: "a".repeat(40),
    upstreamRef: "origin/codex/release",
  };
  const artifacts: WorkerDeployArtifactEvidence = {
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
  };
  const upload = productionTopicUploadEvidence(backupDir, git, artifacts);
  const result = assertTopicSequenceBeforeProductionLock(
    {
      args: ["--confirm-production", "--candidate-version", targetVersion],
      activeVersionId: baselineVersion,
      backupDir,
      cwd,
    },
    {
      readGitIdentity: () => git,
      buildArtifactEvidence: () => artifacts,
      readUploadEvidence: () => upload,
      assertCurrentReleaseBinding: ({ currentRelease }) => {
        assert.equal(currentRelease.phase, "uploaded-inactive");
        assert.equal(currentRelease.targetCandidateVersionId, targetVersion);
        assert.equal(currentRelease.serviceBaselineVersionId, baselineVersion);
        assert.equal(currentRelease.soleServingVersionId, baselineVersion);
      },
      validateVectorizeReadiness: (input) => {
        validated = true;
        assert.equal(input.backupDir, backupDir);
        assert.equal(input.requiredPhase, "uploaded-inactive");
        assert.equal(input.currentRelease.targetCandidateVersionId, targetVersion);
        return readiness;
      },
    },
  );
  assert.equal(validated, true);
  assert.equal(result, readiness);
  assert.throws(
    () => assertTopicSequenceBeforeProductionLock({
      args: ["--confirm-production", "--candidate-version", targetVersion],
      activeVersionId: "33333333-3333-4333-8333-333333333333",
      backupDir,
      cwd,
    }, {
      readUploadEvidence: () => upload,
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

test("0017 validates immutable upload identity before remote access and reserves the inactive target", async () => {
  const cwd = path.resolve("/tmp/inspir-0017-prelock");
  const backupDir = path.resolve("/tmp/inspir-0017-prelock-evidence");
  const git = {
    head: "a".repeat(40),
    upstream: "a".repeat(40),
    upstreamRef: "origin/codex/release",
  };
  const artifacts: WorkerDeployArtifactEvidence = {
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
  };
  const upload = productionTopicUploadEvidence(backupDir, git, artifacts);
  let bound = false;
  const release = assertRuntimeMigration0017ReleaseBeforeProductionLock(
    {
      backupDir,
      cwd,
      sourceFingerprint: artifacts.sourceFingerprint,
    },
    {
      readGitIdentity: () => git,
      buildArtifactEvidence: () => artifacts,
      readUploadEvidence: () => upload,
      assertCurrentReleaseBinding: ({ currentRelease }) => {
        bound = true;
        assert.equal(currentRelease.phase, "uploaded-inactive");
        assert.equal(currentRelease.targetCandidateVersionId, targetVersion);
        assert.equal(currentRelease.serviceBaselineVersionId, baselineVersion);
        assert.equal(currentRelease.soleServingVersionId, baselineVersion);
      },
    },
  );
  assert.equal(bound, true);
  assert.deepEqual(release, {
    targetCandidateVersionId: targetVersion,
    serviceBaselineVersionId: baselineVersion,
    uploadEvidenceSha256: upload.sha256,
  });
  assert.equal(
    assertRuntimeMigration0017LiveBaselineBeforeProductionLock({
      activeVersionId: baselineVersion,
      release,
    }),
    release,
  );
  assert.throws(
    () =>
      assertRuntimeMigration0017LiveBaselineBeforeProductionLock({
        activeVersionId: targetVersion,
        release,
      }),
    /baseline .* alone at 100%.*candidate .* remains inactive/,
  );
  assert.throws(
    () =>
      assertRuntimeMigration0017ReleaseBeforeProductionLock(
        {
          backupDir,
          cwd,
          sourceFingerprint: {
            ...artifacts.sourceFingerprint,
            sha256: "9".repeat(64),
          },
        },
        {
          readGitIdentity: () => git,
          buildArtifactEvidence: () => artifacts,
          readUploadEvidence: () => upload,
          assertCurrentReleaseBinding: () => undefined,
        },
      ),
    /source changed.*before exclusion acquisition/,
  );

  let remoteReads = 0;
  await assert.rejects(
    runProductionReleaseOperation(
      "apply-d1-runtime-migration-0017",
      ["--confirm-production", "--unsupported"],
      {
        cwd,
        backupDir,
        readActiveVersion: () => {
          remoteReads += 1;
          return baselineVersion;
        },
      },
    ),
    /accept only --confirm-production/,
  );
  assert.equal(remoteReads, 0);

  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-production-release-operation.ts"),
    "utf8",
  );
  const runStart = source.indexOf("export async function runProductionReleaseOperation");
  const exactArguments = source.indexOf(
    "assertRuntimeMigration0017GuardedArguments(args)",
    runStart,
  );
  const uploadPrelock = source.indexOf(
    "assertRuntimeMigration0017ReleaseBeforeProductionLock({",
    exactArguments,
  );
  const remoteTopology = source.indexOf(
    "const activeVersionBefore = readActiveVersion()",
    uploadPrelock,
  );
  const acquire = source.indexOf(
    "exclusion = acquireProductionValidationExclusion({",
    remoteTopology,
  );
  const targetReservation = source.indexOf(
    "runtimeMigration0017Release?.targetCandidateVersionId",
    remoteTopology,
  );
  const sourceReservation = source.indexOf(
    "sourceFingerprintSha256: sourceFingerprintBefore.sha256",
    acquire,
  );
  assert.ok(runStart >= 0);
  assert.ok(exactArguments > runStart);
  assert.ok(uploadPrelock > exactArguments);
  assert.ok(remoteTopology > uploadPrelock);
  assert.ok(acquire > remoteTopology);
  assert.ok(targetReservation > acquire);
  assert.ok(sourceReservation > targetReservation);
});

function productionTopicUploadEvidence(
  backupDir: string,
  git: { head: string; upstream: string; upstreamRef: string },
  artifacts: WorkerDeployArtifactEvidence,
) {
  const value = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-13T09:59:00.000Z",
    targetCandidateVersionId: targetVersion,
    serviceBaselineVersionId: baselineVersion,
    expectedReleaseTag: "release-production-topic",
    expectedReleaseMessageSha256: "1".repeat(64),
    uploadCommandEvidenceSha256: "2".repeat(64),
    workerDeployPreparationSha256: "3".repeat(64),
    git,
    artifacts: {
      sourceFingerprintSha256: artifacts.sourceFingerprint.sha256,
      sourceFingerprintFileCount: artifacts.sourceFingerprint.fileCount,
      workerSourceSha256: artifacts.workerSourceSha256,
      wranglerConfigSha256: artifacts.wranglerConfigSha256,
      assetManifestSha256: artifacts.assetManifest.sha256,
      assetManifestFileCount: artifacts.assetManifest.fileCount,
      assetManifestBytes: artifacts.assetManifest.bytes,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "inspirlearning",
      versionId: targetVersion,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-13T09:58:00.000Z",
    },
    versionView: {
      versionId: targetVersion,
      createdAt: "2026-07-13T09:58:30.000Z",
      source: "wrangler",
      releaseTag: "release-production-topic",
      releaseMessageSha256: "1".repeat(64),
      resourceConfigSha256: "4".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      serviceBaselineVersionId: baselineVersion,
      percentage: 100,
      observedVersions: 1,
    },
  });
  return {
    path: path.resolve(backupDir, "cloudflare/worker-candidate-upload.json"),
    value,
    sha256: workerCandidateEvidenceSha256(value),
  };
}

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
  const migration0017 = productionReleaseOperationCommand(
    "apply-d1-runtime-migration-0017",
    ["--confirm-production"],
    cwd,
  );
  assert.equal(migration0017.command, process.execPath);
  assert.deepEqual(migration0017.args.slice(0, 3), [
    "--import",
    "tsx",
    path.join(cwd, "scripts/cloudflare/apply-d1-runtime-migration-0017.ts"),
  ]);
  assert.throws(
    () =>
      productionReleaseOperationCommand(
        "apply-d1-runtime-migration-0017",
        ["--confirm-production", "--budget-only"],
        cwd,
      ),
    /admission and apply are one guarded operation/,
  );

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
    const deadline = Date.now() + 15_000;
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

  const productionBoundary = sanitizedDeploy.indexOf(
    "const commandBoundary = requiresProductionDeployPreflight(mode)",
  );
  const sealedPreflight = sanitizedDeploy.indexOf(
    "runAfterFinalProductionDeployPreflight({",
    productionBoundary,
  );
  const boundedProductionMutation = sanitizedDeploy.indexOf(
    "runBoundedReleaseChildSync(actualCommand",
    sealedPreflight,
  );
  const nonProductionFallback = sanitizedDeploy.indexOf(
    "result: spawnSync(actualCommand.command",
    boundedProductionMutation,
  );
  const boundaryEnd = sanitizedDeploy.indexOf(
    'if (commandBoundary.kind === "blocked")',
    nonProductionFallback,
  );
  assert.ok(productionBoundary >= 0);
  assert.ok(sealedPreflight > productionBoundary);
  assert.ok(boundedProductionMutation > sealedPreflight);
  assert.ok(nonProductionFallback > boundedProductionMutation);
  assert.ok(boundaryEnd > nonProductionFallback);
  assert.equal(translationRepair.match(/runBoundedMutationWrangler\(/g)?.length, 4);
  assert.match(translationRepair, /runBoundedMutationWrangler\([\s\S]{0,250}"d1",[\s\S]{0,80}"execute"/);
  assert.doesNotMatch(translationRepair, /runWrangler\(buildPinnedWorkerVersionDeployArgs/);
  assert.match(authenticatedValidation, /prepareWranglerTemporarySecretBase\(sequence\)/);
  assert.match(authenticatedValidation, /createWranglerTemporarySecretBaseVersion/);
  assert.match(authenticatedValidation, /runBoundedWranglerMutation\(\[\s+"versions",\s+"upload"/);
  assert.match(authenticatedValidation, /runBoundedWranglerMutation\(\s+\[\s+"versions",\s+"secret"/);
  assert.match(authenticatedValidation, /runBoundedWranglerMutation\(\[\s+"versions",\s+"deploy"/);
  assert.match(authenticatedValidation, /runBoundedReleaseChildSync/);
  assert.match(authenticatedValidation, /timeoutMs: CLOUDFLARE_CLI_TIMEOUT_MS/);
  assert.doesNotMatch(authenticatedValidation, /createExactTemporarySecretVersion/);
  assert.doesNotMatch(authenticatedValidation, /baseVersionNonSecretBindings/);
  assert.doesNotMatch(authenticatedValidation, /inheritedNonSecretBindings/);
  assert.doesNotMatch(authenticatedValidation, /runBoundedWranglerMutation\(\["secret",/);
});

test("every production D1 release mutator self-requires the guarded child proof", () => {
  const expected = [
    ["scripts/cloudflare/apply-d1-runtime-migrations.ts", "apply-d1-runtime-migrations"],
    ["scripts/cloudflare/apply-d1-runtime-migration-0017.ts", "apply-d1-runtime-migration-0017"],
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
  const vectorize = runbook.indexOf(
    "## Uploaded-inactive and candidate-active Vectorize readiness gates",
  );
  const topics = runbook.indexOf("## Atomic managed-topic reconciliation");
  const translations = runbook.indexOf(
    "## Predecessor-day translation reconciliation for the inactive candidate",
  );
  const activation = runbook.indexOf("## Guarded candidate stage and atomic activation");
  const productionValidation = runbook.indexOf("## Production verification");

  assert.ok(vectorize >= 0);
  assert.ok(topics > vectorize);
  assert.ok(translations > topics);
  assert.ok(activation > translations);
  assert.ok(productionValidation > activation);
  assert.match(runbook, /--phase uploaded-inactive/);
  assert.match(runbook, /--phase candidate-active/);
  assert.match(
    runbook,
    /Phase 1 is exactly uploaded-inactive read-only derive\/hash\/verify\/seal with zero\ntranslation writes/,
  );
  assert.match(
    runbook,
    /Phase 2 occurs only after the candidate is sole-active: a\nsingle atomic transaction resets and UPSERTs all 668 desired rows and deletes\nall nonmembers/,
  );
  assert.match(runbook, /There\s+is no preactivation translation UPSERT/);
  assert.match(runbook, /2,500,000 reads and 50,000 writes/);
  assert.match(runbook, /standalone source synchronizer is\nexplicitly forbidden/);
  assert.doesNotMatch(runbook, /pnpm cf:sync:site-translation-sources/);
});

test("runbook scopes translation verification to uploaded-inactive before activation", () => {
  const runbook = fs.readFileSync(path.resolve("deploy.md"), "utf8");
  const start = runbook.indexOf(
    "## Predecessor-day translation reconciliation for the inactive candidate",
  );
  const end = runbook.indexOf(
    "## Guarded candidate stage and atomic activation",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const section = runbook.slice(start, end);
  const commands = [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map(
    (match) => match[1] ?? "",
  );
  const verify = commands.find(
    (command) =>
      command.includes("cf:d1:reconcile-staged-translations") &&
      command.includes("--verify-only"),
  );
  assert.ok(verify);
  assert.match(verify, /--phase uploaded-inactive/);
  assert.doesNotMatch(section, /--phase candidate-active/);
  assert.match(section, /zero\ntranslation writes/);
  assert.match(section, /There\s+is no preactivation translation UPSERT/);
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
    /assertFreshProductionVectorizeReadiness[\s\S]*assertFreshHistoricalFresh0016FinalPreservation[\s\S]*assertProductionTranslationReconciliationReleaseBinding/,
  );
  assert.doesNotMatch(
    authenticatedValidation,
    /assertFreshProductionTranslationReconciliation/,
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
