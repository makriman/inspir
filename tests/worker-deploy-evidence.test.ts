import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { blockedImmutableWorkerDeployArgs } from "../scripts/cloudflare/run-sanitized-build";
import {
  WORKER_CANDIDATE_ACTIVATION_COMMAND_REPORT,
  WORKER_CANDIDATE_STAGING_COMMAND_REPORT,
  WORKER_CANDIDATE_UPLOAD_COMMAND_REPORT,
  buildWorkerDeployArtifactEvidence,
  buildWorkerDeployArtifactManifest,
  createPrivateWranglerOutputFile,
  createWorkerDeployEvidenceSession,
  parseSoleActiveWorkerVersion,
  readPrivateWranglerOutputFile,
  readSoleActiveWorkerVersion,
  type WorkerDeployEvidenceFinishInput,
  type WorkerDeployEvidenceReport,
} from "../scripts/cloudflare/worker-deploy-evidence";
import {
  parseWorkerVersionDeployOutput,
  parseWorkerVersionUploadOutput,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const activeVersionId = "22222222-2222-4222-8222-222222222222";
const successfulCommand: WorkerDeployEvidenceFinishInput = {
  commandExecuted: true,
  deployPreflightOk: true,
  deployPreflightStatus: 0,
  resourceBudgetOk: true,
  scanBeforeOk: true,
  scanAfterOk: null,
};
const deployPreparation = {
  sha256: sha256("sealed-worker-deploy-preparation"),
  git: {
    head: "a".repeat(40),
    upstream: "a".repeat(40),
    upstreamRef: "origin/codex/release",
  },
} as const;
const preActivationSealSha256 = sha256("pre-activation-seal");

test("immutable deploy/upload wrappers reject every passthrough override", () => {
  assert.deepEqual(blockedImmutableWorkerDeployArgs("worker-activate-candidate", ["--dry-run"]), ["--dry-run"]);
  assert.deepEqual(blockedImmutableWorkerDeployArgs("worker-stage-candidate", ["--yes"]), ["--yes"]);
  assert.deepEqual(blockedImmutableWorkerDeployArgs("worker-upload-candidate", ["other-worker.ts"]), ["other-worker.ts"]);
  assert.deepEqual(blockedImmutableWorkerDeployArgs("opennext-build", ["--log-level", "debug"]), []);
  assert.deepEqual(blockedImmutableWorkerDeployArgs("wrangler-preview", ["--remote"]), []);
});

test("Static Assets manifest is deterministic, content-bound, and symlink-free", () => {
  const repo = makeWorkerRepo();
  const assetRoot = path.join(repo, ".open-next/assets");
  try {
    const first = buildWorkerDeployArtifactManifest(assetRoot);
    const second = buildWorkerDeployArtifactManifest(assetRoot);

    assert.deepEqual(second, first);
    assert.equal(first.root, assetRoot);
    assert.equal(first.fileCount, 2);
    assert.equal(first.bytes, Buffer.byteLength("homeasset", "utf8"));
    assert.match(first.sha256, /^[a-f0-9]{64}$/);

    fs.writeFileSync(path.join(assetRoot, "nested/asset.js"), "changed");
    assert.notEqual(buildWorkerDeployArtifactManifest(assetRoot).sha256, first.sha256);

    fs.symlinkSync(path.join(assetRoot, "index.html"), path.join(assetRoot, "linked.html"));
    assert.throws(
      () => buildWorkerDeployArtifactManifest(assetRoot),
      /must not contain symlinks/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("deploy artifact evidence binds exact source, Worker, config, and Static Assets hashes", () => {
  const repo = makeWorkerRepo();
  try {
    const evidence = buildWorkerDeployArtifactEvidence(repo);
    assert.equal(evidence.workerSourceSha256, sha256("export default {};\n"));
    assert.equal(evidence.wranglerConfigSha256, sha256('{"main":"./cloudflare-worker.ts"}\n'));
    assert.equal(evidence.assetManifest.root, path.join(repo, ".open-next/assets"));
    assert.equal(evidence.assetManifest.fileCount, 2);
    assert.ok(evidence.sourceFingerprint.files.some((entry) => entry.file === "cloudflare-worker.ts"));
    assert.ok(evidence.sourceFingerprint.files.some((entry) => entry.file === "wrangler.jsonc"));
    assert.equal(evidence.sourceFingerprint.files.some((entry) => entry.file.startsWith(".open-next/")), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("active deployment readback accepts only one exact UUID at 100 percent", () => {
  const valid = JSON.stringify({
    versions: [{ version_id: activeVersionId, percentage: 100 }],
  });
  assert.equal(parseSoleActiveWorkerVersion(valid), activeVersionId);
  assert.equal(parseSoleActiveWorkerVersion(`wrangler notice\n${valid}`), activeVersionId);

  assert.throws(
    () =>
      parseSoleActiveWorkerVersion(
        JSON.stringify({
          versions: [
            { version_id: activeVersionId, percentage: 90 },
            { version_id: "33333333-3333-4333-8333-333333333333", percentage: 10 },
          ],
        }),
      ),
    /exactly one active version/,
  );
  assert.throws(
    () => parseSoleActiveWorkerVersion(JSON.stringify({ versions: [{ version_id: "not-a-uuid", percentage: 100 }] })),
    /valid version UUID/,
  );
  assert.throws(() => parseSoleActiveWorkerVersion("not json"), /not valid JSON/);

  let observedArgs: string[] = [];
  const readback = readSoleActiveWorkerVersion((args) => {
    observedArgs = args;
    return valid;
  });
  assert.equal(readback, activeVersionId);
  assert.deepEqual(observedArgs, ["deployments", "status", "--name", "inspirlearning", "--json"]);
});

test("successful deploy report is private and includes immutable artifacts plus the read-back active UUID", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-report-"));
  try {
    const wranglerOutputPath = writeWranglerOutput(
      backupDir,
      "worker-candidate-activation",
    );
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-activation",
      command: ["wrangler", "versions", "deploy", `${activeVersionId}@100%`, "--config", "wrangler.jsonc", "--yes"],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => activeVersionId,
      getWranglerOutputPath: () => wranglerOutputPath,
      parseWranglerOutput: parseWorkerVersionDeployOutput,
      getTargetCandidateVersionId: () => activeVersionId,
      getWorkerDeployPreparation: () => deployPreparation,
      getPreActivationSealSha256: () => preActivationSealSha256,
    });
    const commandArtifacts = session.captureCommandArtifacts();
    const result = session.finish(0, successfulCommand);
    const reportPath = path.join(
      backupDir,
      WORKER_CANDIDATE_ACTIVATION_COMMAND_REPORT,
    );
    const written = JSON.parse(fs.readFileSync(reportPath, "utf8")) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 0);
    assert.equal(result.report.ok, true);
    assert.equal(written.ok, true);
    assert.equal(written.sourceFingerprint?.sha256, commandArtifacts.sourceFingerprint.sha256);
    assert.equal(written.workerSourceSha256, commandArtifacts.workerSourceSha256);
    assert.equal(written.wranglerConfigSha256, commandArtifacts.wranglerConfigSha256);
    assert.deepEqual(written.assetManifest, commandArtifacts.assetManifest);
    assert.equal(written.artifactEvidenceStable, true);
    assert.equal(
      written.preActivationSealSha256,
      preActivationSealSha256,
    );
    assert.deepEqual(written.activeDeployment, {
      workerName: "inspirlearning",
      versionId: activeVersionId,
      percentage: 100,
      observedVersions: 1,
      readAt: written.activeDeployment?.readAt,
    });
    assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("lost or invalid deploy readback fails closed even when Wrangler exited successfully", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-readback-"));
  try {
    const wranglerOutputPath = writeWranglerOutput(
      backupDir,
      "worker-candidate-activation",
    );
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-activation",
      command: ["wrangler", "versions", "deploy", `${activeVersionId}@100%`],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => {
        throw new Error("deployment status response was lost");
      },
      getWranglerOutputPath: () => wranglerOutputPath,
      parseWranglerOutput: parseWorkerVersionDeployOutput,
      getTargetCandidateVersionId: () => activeVersionId,
      getWorkerDeployPreparation: () => deployPreparation,
      getPreActivationSealSha256: () => preActivationSealSha256,
    });
    session.captureCommandArtifacts();
    const result = session.finish(0, successfulCommand);

    assert.equal(result.status, 1);
    assert.equal(result.report.status, 0);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.activeDeployment, undefined);
    assert.match(result.report.activeDeploymentReadbackError ?? "", /response was lost/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("deploy evidence promotion rejects an active version changed after pending certification", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-deploy-promotion-"));
  try {
    const wranglerOutputPath = writeWranglerOutput(
      backupDir,
      "worker-candidate-activation",
    );
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-activation",
      command: ["wrangler", "versions", "deploy", `${activeVersionId}@100%`],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => "33333333-3333-4333-8333-333333333333",
      getWranglerOutputPath: () => wranglerOutputPath,
      parseWranglerOutput: parseWorkerVersionDeployOutput,
      getTargetCandidateVersionId: () => activeVersionId,
      getWorkerDeployPreparation: () => deployPreparation,
      getPreActivationSealSha256: () => preActivationSealSha256,
    });
    session.captureCommandArtifacts();
    const result = session.finish(0, {
      ...successfulCommand,
      expectedActiveVersionId: activeVersionId,
    });
    assert.equal(result.status, 1);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.activeDeployment, undefined);
    assert.match(
      result.report.activeDeploymentReadbackError ?? "",
      /does not match the attested activation candidate/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("upload evidence includes artifact hashes but never claims an active deployment", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-upload-report-"));
  const reportPath = path.join(backupDir, WORKER_CANDIDATE_UPLOAD_COMMAND_REPORT);
  let activeReadbackCalls = 0;
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, "stale permissive report\n", { mode: 0o644 });
    fs.chmodSync(reportPath, 0o644);
    const wranglerOutputPath = writeWranglerOutput(
      backupDir,
      "worker-candidate-upload",
    );
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-upload",
      command: ["wrangler", "versions", "upload", "--config", "wrangler.jsonc", "--strict"],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => {
        activeReadbackCalls += 1;
        return activeVersionId;
      },
      getWranglerOutputPath: () => wranglerOutputPath,
      parseWranglerOutput: parseWorkerVersionUploadOutput,
      getWorkerDeployPreparation: () => deployPreparation,
    });
    session.captureCommandArtifacts();
    const result = session.finish(0, successfulCommand);
    const serialized = fs.readFileSync(reportPath, "utf8");

    assert.equal(result.status, 0);
    assert.equal(result.report.ok, true);
    assert.equal(activeReadbackCalls, 0);
    assert.match(result.report.workerSourceSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(result.report.wranglerConfigSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(result.report.assetManifest?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(result.report.activeDeployment, undefined);
    assert.equal(result.report.activeDeploymentReadbackError, undefined);
    assert.equal(serialized.includes("activeDeployment"), false);
    assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("staging writes a distinct private command report without activation evidence or readback", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-worker-staging-report-"),
  );
  const reportPath = path.join(
    backupDir,
    WORKER_CANDIDATE_STAGING_COMMAND_REPORT,
  );
  let activeReadbackCalls = 0;
  try {
    const wranglerOutputPath = writeWranglerOutput(
      backupDir,
      "worker-candidate-staging",
    );
    const baselineVersionId = "11111111-1111-4111-8111-111111111111";
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-staging",
      command: [
        "wrangler",
        "versions",
        "deploy",
        `${baselineVersionId}@100%`,
        `${activeVersionId}@0%`,
        "--config",
        "wrangler.jsonc",
        "--yes",
      ],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => {
        activeReadbackCalls += 1;
        return activeVersionId;
      },
      getWranglerOutputPath: () => wranglerOutputPath,
      parseWranglerOutput: parseWorkerVersionDeployOutput,
      getTargetCandidateVersionId: () => activeVersionId,
      getWorkerDeployPreparation: () => deployPreparation,
    });
    session.captureCommandArtifacts();
    const result = session.finish(0, {
      commandExecuted: true,
      resourceBudgetOk: true,
      scanBeforeOk: true,
      scanAfterOk: null,
    });
    const written = JSON.parse(
      fs.readFileSync(reportPath, "utf8"),
    ) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 0);
    assert.equal(written.ok, true);
    assert.equal(written.mode, "worker-candidate-staging");
    assert.equal(written.deployPreflightOk, undefined);
    assert.equal(written.targetCandidateVersionId, activeVersionId);
    assert.equal(written.wranglerOutput?.event.type, "version-deploy");
    assert.equal(written.activeDeployment, undefined);
    assert.equal(written.preActivationSealSha256, undefined);
    assert.equal(activeReadbackCalls, 0);
    assert.equal(
      fs.existsSync(
        path.join(backupDir, WORKER_CANDIDATE_UPLOAD_COMMAND_REPORT),
      ),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(backupDir, WORKER_CANDIDATE_ACTIVATION_COMMAND_REPORT),
      ),
      false,
    );
    assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("staging fails closed on the wrong structured operation or an unbound candidate", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-worker-staging-hostile-"),
  );
  const successfulStagingCommand: WorkerDeployEvidenceFinishInput = {
    commandExecuted: true,
    resourceBudgetOk: true,
    scanBeforeOk: true,
    scanAfterOk: null,
  };
  try {
    const wrongOperationPath = createPrivateWranglerOutputFile(
      backupDir,
      "worker-candidate-staging",
    );
    fs.appendFileSync(
      wrongOperationPath,
      `${JSON.stringify(uploadOutputEvent())}\n`,
    );
    const wrongOperation = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-staging",
      command: ["wrangler", "versions", "deploy"],
      passthroughArgs: [],
      cwd: repo,
      getWranglerOutputPath: () => wrongOperationPath,
      parseWranglerOutput: parseWorkerVersionUploadOutput,
      getTargetCandidateVersionId: () => activeVersionId,
      getWorkerDeployPreparation: () => deployPreparation,
    });
    wrongOperation.captureCommandArtifacts();
    const wrongOperationResult = wrongOperation.finish(
      0,
      successfulStagingCommand,
    );
    assert.equal(wrongOperationResult.status, 1);
    assert.equal(wrongOperationResult.report.ok, false);
    assert.match(
      wrongOperationResult.report.wranglerOutputReadbackError ?? "",
      /wrong Worker operation/,
    );

    const unboundCandidatePath = writeWranglerOutput(
      backupDir,
      "worker-candidate-staging",
    );
    const unboundCandidate = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-staging",
      command: ["wrangler", "versions", "deploy"],
      passthroughArgs: [],
      cwd: repo,
      getWranglerOutputPath: () => unboundCandidatePath,
      parseWranglerOutput: parseWorkerVersionDeployOutput,
      getWorkerDeployPreparation: () => deployPreparation,
    });
    unboundCandidate.captureCommandArtifacts();
    const unboundCandidateResult = unboundCandidate.finish(
      0,
      successfulStagingCommand,
    );
    assert.equal(unboundCandidateResult.status, 1);
    assert.equal(unboundCandidateResult.report.ok, false);
    assert.equal(
      unboundCandidateResult.report.targetCandidateVersionId,
      undefined,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("successful Wrangler exit without one exact structured event fails closed", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-worker-output-missing-"),
  );
  try {
    const emptyOutputPath = createPrivateWranglerOutputFile(
      backupDir,
      "worker-candidate-upload",
    );
    const missing = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-upload",
      command: ["wrangler", "versions", "upload"],
      passthroughArgs: [],
      cwd: repo,
      getWranglerOutputPath: () => emptyOutputPath,
      parseWranglerOutput: parseWorkerVersionUploadOutput,
      getWorkerDeployPreparation: () => deployPreparation,
    });
    missing.captureCommandArtifacts();
    const missingResult = missing.finish(0, successfulCommand);
    assert.equal(missingResult.status, 1);
    assert.equal(missingResult.report.ok, false);
    assert.match(
      missingResult.report.wranglerOutputReadbackError ?? "",
      /invalid byte size/,
    );

    const ambiguousOutputPath = createPrivateWranglerOutputFile(
      backupDir,
      "worker-candidate-upload",
    );
    fs.appendFileSync(
      ambiguousOutputPath,
      `${JSON.stringify(uploadOutputEvent())}\n${JSON.stringify(uploadOutputEvent())}\n`,
    );
    const ambiguous = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-upload",
      command: ["wrangler", "versions", "upload"],
      passthroughArgs: [],
      cwd: repo,
      getWranglerOutputPath: () => ambiguousOutputPath,
      parseWranglerOutput: parseWorkerVersionUploadOutput,
      getWorkerDeployPreparation: () => deployPreparation,
    });
    ambiguous.captureCommandArtifacts();
    const ambiguousResult = ambiguous.finish(0, successfulCommand);
    assert.equal(ambiguousResult.status, 1);
    assert.equal(ambiguousResult.report.ok, false);
    assert.match(
      ambiguousResult.report.wranglerOutputReadbackError ?? "",
      /exactly one unambiguous JSON event/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("artifact mutation after capture makes otherwise successful evidence non-ok", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-artifact-race-"));
  try {
    const wranglerOutputPath = writeWranglerOutput(
      backupDir,
      "worker-candidate-activation",
    );
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "worker-candidate-activation",
      command: ["wrangler", "versions", "deploy", `${activeVersionId}@100%`],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => activeVersionId,
      getWranglerOutputPath: () => wranglerOutputPath,
      parseWranglerOutput: parseWorkerVersionDeployOutput,
      getTargetCandidateVersionId: () => activeVersionId,
      getWorkerDeployPreparation: () => deployPreparation,
      getPreActivationSealSha256: () => preActivationSealSha256,
    });
    session.captureCommandArtifacts();
    fs.writeFileSync(path.join(repo, ".open-next/assets/index.html"), "mutated after command capture");
    const result = session.finish(0, successfulCommand);

    assert.equal(result.status, 1);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.artifactEvidenceStable, false);
    assert.notEqual(result.report.assetManifest?.sha256, result.report.artifactEvidenceAfter?.assetManifest.sha256);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("Wrangler structured output is fresh, private, bounded, and symlink-safe", () => {
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-worker-private-output-"),
  );
  try {
    const outputPath = createPrivateWranglerOutputFile(
      backupDir,
      "worker-candidate-upload",
    );
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.throws(
      () => readPrivateWranglerOutputFile(outputPath),
      /invalid byte size/,
    );

    fs.appendFileSync(outputPath, `${JSON.stringify(uploadOutputEvent())}\n`);
    const evidence = readPrivateWranglerOutputFile(outputPath);
    assert.equal(evidence.path, outputPath);
    assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
    assert.equal(parseWorkerVersionUploadOutput(evidence.output).versionId, activeVersionId);

    const sessionOutputPath = createPrivateWranglerOutputFile(
      backupDir,
      "worker-candidate-upload",
    );
    fs.appendFileSync(
      sessionOutputPath,
      `${JSON.stringify(wranglerSessionEvent())}\n${JSON.stringify(uploadOutputEvent())}\n`,
    );
    const sessionEvidence = readPrivateWranglerOutputFile(sessionOutputPath);
    assert.equal(
      parseWorkerVersionUploadOutput(sessionEvidence.output).versionId,
      activeVersionId,
    );

    fs.chmodSync(outputPath, 0o644);
    assert.throws(
      () => readPrivateWranglerOutputFile(outputPath),
      /owner-only regular non-symlink/,
    );
    fs.chmodSync(outputPath, 0o600);
    const linkedPath = path.join(path.dirname(outputPath), "linked-output.jsonl");
    fs.symlinkSync(outputPath, linkedPath);
    assert.throws(
      () => readPrivateWranglerOutputFile(linkedPath),
      /owner-only regular non-symlink/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

function writeWranglerOutput(
  backupDir: string,
  mode:
    | "worker-candidate-upload"
    | "worker-candidate-staging"
    | "worker-candidate-activation",
) {
  const outputPath = createPrivateWranglerOutputFile(backupDir, mode);
  const event =
    mode === "worker-candidate-upload"
      ? uploadOutputEvent()
      : deployOutputEvent();
  fs.appendFileSync(outputPath, `${JSON.stringify(event)}\n`);
  return outputPath;
}

function uploadOutputEvent() {
  return {
    type: "version-upload",
    version: 1,
    worker_name: "inspirlearning",
    worker_tag: "worker-service-tag",
    version_id: activeVersionId,
    worker_name_overridden: false,
    timestamp: "2026-07-15T12:00:00.000Z",
  } as const;
}

function wranglerSessionEvent() {
  return {
    type: "wrangler-session",
    version: 1,
    wrangler_version: "4.107.0",
    command_line_args: ["versions", "upload", "--config", "wrangler.jsonc"],
    log_file_path: "/tmp/wrangler.log",
    timestamp: "2026-07-15T11:59:59.000Z",
  } as const;
}

function deployOutputEvent() {
  return {
    type: "version-deploy",
    version: 1,
    worker_name: "inspirlearning",
    deployment_id: "44444444-4444-4444-8444-444444444444",
    version_traffic: {},
    timestamp: "2026-07-15T12:01:00.000Z",
  } as const;
}

function makeWorkerRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-evidence-repo-"));
  fs.mkdirSync(path.join(repo, ".open-next/assets/nested"), { recursive: true });
  fs.writeFileSync(path.join(repo, "cloudflare-worker.ts"), "export default {};\n");
  fs.writeFileSync(path.join(repo, "wrangler.jsonc"), '{"main":"./cloudflare-worker.ts"}\n');
  fs.writeFileSync(path.join(repo, ".open-next/assets/index.html"), "home");
  fs.writeFileSync(path.join(repo, ".open-next/assets/nested/asset.js"), "asset");
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd: repo, encoding: "utf8" });
  if (initialized.status !== 0) {
    throw new Error(`Could not initialize fixture git repository: ${initialized.stderr ?? initialized.stdout}`);
  }
  return repo;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
