import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { blockedImmutableWorkerDeployArgs } from "../scripts/cloudflare/run-sanitized-build";
import {
  WORKER_DEPLOY_REPORT,
  buildWorkerDeployArtifactEvidence,
  buildWorkerDeployArtifactManifest,
  createWorkerDeployEvidenceSession,
  parseSoleActiveWorkerVersion,
  readSoleActiveWorkerVersion,
  type WorkerDeployEvidenceFinishInput,
  type WorkerDeployEvidenceReport,
} from "../scripts/cloudflare/worker-deploy-evidence";

const activeVersionId = "22222222-2222-4222-8222-222222222222";
const successfulCommand: WorkerDeployEvidenceFinishInput = {
  commandExecuted: true,
  deployPreflightOk: true,
  deployPreflightStatus: 0,
  resourceBudgetOk: true,
  scanBeforeOk: true,
  scanAfterOk: null,
};

test("immutable deploy/upload wrappers reject every passthrough override", () => {
  assert.deepEqual(blockedImmutableWorkerDeployArgs("opennext-deploy", ["--dry-run"]), ["--dry-run"]);
  assert.deepEqual(blockedImmutableWorkerDeployArgs("opennext-upload", ["other-worker.ts"]), ["other-worker.ts"]);
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
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "opennext-deploy",
      command: ["wrangler", "deploy", "--config", "wrangler.jsonc"],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => activeVersionId,
    });
    const commandArtifacts = session.captureCommandArtifacts();
    const result = session.finish(0, successfulCommand);
    const reportPath = path.join(backupDir, WORKER_DEPLOY_REPORT);
    const written = JSON.parse(fs.readFileSync(reportPath, "utf8")) as WorkerDeployEvidenceReport;

    assert.equal(result.status, 0);
    assert.equal(result.report.ok, true);
    assert.equal(written.ok, true);
    assert.equal(written.sourceFingerprint?.sha256, commandArtifacts.sourceFingerprint.sha256);
    assert.equal(written.workerSourceSha256, commandArtifacts.workerSourceSha256);
    assert.equal(written.wranglerConfigSha256, commandArtifacts.wranglerConfigSha256);
    assert.deepEqual(written.assetManifest, commandArtifacts.assetManifest);
    assert.equal(written.artifactEvidenceStable, true);
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
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "opennext-deploy",
      command: ["wrangler", "deploy"],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => {
        throw new Error("deployment status response was lost");
      },
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
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "opennext-deploy",
      command: ["wrangler", "deploy"],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => "33333333-3333-4333-8333-333333333333",
    });
    session.captureCommandArtifacts();
    const result = session.finish(0, {
      ...successfulCommand,
      expectedActiveVersionId: activeVersionId,
    });
    assert.equal(result.status, 1);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.activeDeployment, undefined);
    assert.match(result.report.activeDeploymentReadbackError ?? "", /changed before deploy evidence promotion/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("upload evidence includes artifact hashes but never claims an active deployment", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-upload-report-"));
  const reportPath = path.join(backupDir, WORKER_DEPLOY_REPORT);
  let activeReadbackCalls = 0;
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, "stale permissive report\n", { mode: 0o644 });
    fs.chmodSync(reportPath, 0o644);
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "opennext-upload",
      command: ["wrangler", "versions", "upload"],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => {
        activeReadbackCalls += 1;
        return activeVersionId;
      },
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

test("artifact mutation after capture makes otherwise successful evidence non-ok", () => {
  const repo = makeWorkerRepo();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-worker-artifact-race-"));
  try {
    const session = createWorkerDeployEvidenceSession({
      backupDir,
      mode: "opennext-deploy",
      command: ["wrangler", "deploy"],
      passthroughArgs: [],
      cwd: repo,
      readActiveWorkerVersion: () => activeVersionId,
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
