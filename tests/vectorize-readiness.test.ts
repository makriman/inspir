import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { WorkerDeployRepairEvidence } from "../scripts/cloudflare/repair-seo-cta-translations";
import type { WorkerDeployArtifactEvidence } from "../scripts/cloudflare/worker-deploy-evidence";
import {
  assertFreshProductionVectorizeReadiness,
  assertProductionVectorizeReadinessReleaseBinding,
  createVectorizeReadinessReport,
  parseVectorizeIndexConfigurationOutput,
  parseVectorizeInfoOutput,
  parseVectorizeMetadataIndexesOutput,
  vectorizeReadinessReportPath,
  writeVectorizeReadinessReport,
  type VectorizeReadinessCurrentRelease,
  type VectorizeReadinessReport,
} from "../scripts/cloudflare/vectorize-readiness-evidence";
import {
  parseVectorizeReadinessCli,
  verifyProductionVectorizeReadiness,
} from "../scripts/cloudflare/verify-vectorize-readiness";

const candidateVersionId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-07-13T10:00:00.000Z";
const metadataIndexes = [
  { propertyName: "chatId", indexType: "string" },
  { propertyName: "userId", indexType: "string" },
];

test("Vectorize readiness parses the exact production shape and fails closed", () => {
  assert.deepEqual(
    parseVectorizeIndexConfigurationOutput(JSON.stringify({
      name: "inspirlearning-memory-prod",
      config: { dimensions: 512, metric: "cosine" },
    })),
    { name: "inspirlearning-memory-prod", dimensions: 512, metric: "cosine" },
  );
  assert.deepEqual(
    parseVectorizeInfoOutput(JSON.stringify({
      dimensions: 512,
      vectorCount: 174,
      processedUpToDatetime: "2026-07-08T03:01:42.401Z",
      processedUpToMutation: "cc369a53-a464-4c51-9b26-136d3479b11a",
    })),
    { dimensions: 512, vectorCount: 174 },
  );
  assert.deepEqual(
    parseVectorizeMetadataIndexesOutput(JSON.stringify([...metadataIndexes].reverse())),
    metadataIndexes,
  );

  assert.throws(
    () => parseVectorizeIndexConfigurationOutput(JSON.stringify({
      name: "inspirlearning-memory-prod",
      config: { dimensions: 512, metric: "euclidean" },
    })),
    /cosine metric/,
  );
  assert.throws(
    () => parseVectorizeIndexConfigurationOutput(JSON.stringify({
      name: "wrong-index",
      config: { dimensions: 512, metric: "cosine" },
    })),
    /exact index/,
  );
  assert.throws(
    () => parseVectorizeInfoOutput('{"dimensions":768,"vectorCount":174}'),
    /dimensions differ/,
  );
  assert.throws(
    () => parseVectorizeInfoOutput('{"dimensions":512,"vectorCount":0}'),
    /positive safe integer/,
  );
  assert.throws(
    () => parseVectorizeInfoOutput('{"dimensions":512}'),
    /vector count/,
  );
  assert.throws(
    () => parseVectorizeInfoOutput("not-json"),
    /not exact JSON/,
  );
  assert.throws(
    () => parseVectorizeInfoOutput(" ".repeat(65 * 1_024)),
    /bounded JSON limit/,
  );
  assert.throws(
    () => parseVectorizeMetadataIndexesOutput(JSON.stringify(metadataIndexes.slice(0, 1))),
    /must be exactly/,
  );
  assert.throws(
    () => parseVectorizeMetadataIndexesOutput(JSON.stringify([
      ...metadataIndexes,
      { propertyName: "tenantId", indexType: "string" },
    ])),
    /must be exactly/,
  );
  assert.throws(
    () => parseVectorizeMetadataIndexesOutput(JSON.stringify([
      { propertyName: "chatId", indexType: "number" },
      metadataIndexes[1],
    ])),
    /must be exactly/,
  );
  assert.throws(
    () => parseVectorizeMetadataIndexesOutput(JSON.stringify([
      { propertyName: "chatId", indexType: "String" },
      metadataIndexes[1],
    ])),
    /must be exactly/,
  );
});

test("production Vectorize verification is read-only and bound to stable release evidence", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-source-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-backup-"));
  const artifactEvidence = workerArtifactEvidence(cwd);
  const git = {
    head: "a".repeat(40),
    upstream: "a".repeat(40),
    upstreamRef: "origin/codex/release",
  };
  const deployEvidence = workerDeployEvidence(backupDir, artifactEvidence);
  let activeReads = 0;
  let gitReads = 0;
  let artifactReads = 0;
  let deployValidations = 0;
  const commands: string[][] = [];
  let written: VectorizeReadinessReport | undefined;
  try {
    writeWranglerConfig(cwd, "inspirlearning-memory-prod");
    const report = verifyProductionVectorizeReadiness(
      {
        confirmed: true,
        remote: true,
        candidateVersionId,
        backupDir,
        cwd,
      },
      {
        readGitIdentity: () => {
          gitReads += 1;
          return git;
        },
        buildArtifactEvidence: () => {
          artifactReads += 1;
          return artifactEvidence;
        },
        readDeployReport: () => ({ kind: "fixture" }),
        validateDeployEvidence: () => {
          deployValidations += 1;
          return deployEvidence;
        },
        readActiveVersion: (runner) => {
          activeReads += 1;
          runner(
            ["deployments", "status", "--name", "inspirlearning", "--json"],
            { maxBuffer: 64 * 1_024, timeoutMs: 60_000 },
          );
          return candidateVersionId;
        },
        runner: (args, options) => {
          commands.push([...args]);
          assert.equal(options?.maxBuffer, 64 * 1_024);
          assert.equal(options?.timeoutMs, 60_000);
          if (args[0] === "deployments") return '{"deployments":[]}';
          if (args[1] === "get") {
            return JSON.stringify({
              name: "inspirlearning-memory-prod",
              config: { dimensions: 512, metric: "cosine" },
            });
          }
          return args[1] === "info"
            ? JSON.stringify({ dimensions: 512, vectorCount: 174 })
            : JSON.stringify(metadataIndexes);
        },
        clock: () => new Date(createdAt),
        writeReport: (value) => {
          written = value;
          return path.join(backupDir, "captured.json");
        },
      },
    );

    assert.equal(report, written);
    assert.equal(gitReads, 2);
    assert.equal(artifactReads, 2);
    assert.equal(deployValidations, 2);
    assert.equal(activeReads, 2);
    assert.deepEqual(commands, [
      ["deployments", "status", "--name", "inspirlearning", "--json"],
      ["vectorize", "get", "inspirlearning-memory-prod", "--json"],
      ["vectorize", "info", "inspirlearning-memory-prod", "--json"],
      ["vectorize", "list-metadata-index", "inspirlearning-memory-prod", "--json"],
      ["deployments", "status", "--name", "inspirlearning", "--json"],
    ]);
    assert.equal(report.readOnly.remoteQueries, 5);
    assert.equal(report.readOnly.mutationCommands, 0);
    assert.equal(report.vectorize.dimensions, 512);
    assert.equal(report.vectorize.metric, "cosine");
    assert.deepEqual(report.vectorize.metadataIndexes, metadataIndexes);
    assert.equal(report.git.head, report.git.upstream);
    assert.equal(report.artifactEvidence.sourceFingerprintSha256, "b".repeat(64));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("production Vectorize verification refuses configuration or release drift before evidence write", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-drift-source-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-drift-backup-"));
  const artifactEvidence = workerArtifactEvidence(cwd);
  const deployEvidence = workerDeployEvidence(backupDir, artifactEvidence);
  const stableGit = {
    head: "a".repeat(40),
    upstream: "a".repeat(40),
    upstreamRef: "origin/codex/release",
  };
  let writes = 0;
  try {
    writeWranglerConfig(cwd, "wrong-index");
    assert.throws(
      () => verifyProductionVectorizeReadiness(
        {
          confirmed: true,
          remote: true,
          candidateVersionId,
          backupDir,
          cwd,
        },
        {
          readGitIdentity: () => stableGit,
          buildArtifactEvidence: () => artifactEvidence,
          readDeployReport: () => ({}),
          validateDeployEvidence: () => deployEvidence,
          readActiveVersion: () => candidateVersionId,
          runner: () => "unexpected",
          writeReport: () => {
            writes += 1;
            return "unexpected";
          },
        },
      ),
      /exact index/,
    );

    writeWranglerConfig(cwd, "inspirlearning-memory-prod");
    let gitReads = 0;
    assert.throws(
      () => verifyProductionVectorizeReadiness(
        {
          confirmed: true,
          remote: true,
          candidateVersionId,
          backupDir,
          cwd,
        },
        {
          readGitIdentity: () => {
            gitReads += 1;
            return gitReads === 1 ? stableGit : { ...stableGit, upstreamRef: "origin/changed" };
          },
          buildArtifactEvidence: () => artifactEvidence,
          readDeployReport: () => ({}),
          validateDeployEvidence: () => deployEvidence,
          readActiveVersion: () => candidateVersionId,
          runner: (args) => {
            if (args[1] === "get") {
              return '{"name":"inspirlearning-memory-prod","config":{"dimensions":512,"metric":"cosine"}}';
            }
            return args[1] === "info"
              ? '{"dimensions":512,"vectorCount":174}'
              : JSON.stringify(metadataIndexes);
          },
          writeReport: () => {
            writes += 1;
            return "unexpected";
          },
        },
      ),
      /changed during Vectorize readiness/,
    );
    assert.equal(writes, 0);

    assert.throws(
      () => verifyProductionVectorizeReadiness(
        {
          confirmed: true,
          remote: true,
          candidateVersionId,
          backupDir,
          cwd,
        },
        {
          readGitIdentity: () => stableGit,
          buildArtifactEvidence: () => artifactEvidence,
          readDeployReport: () => ({}),
          validateDeployEvidence: () => deployEvidence,
          readActiveVersion: () => "33333333-3333-4333-8333-333333333333",
          runner: () => "unexpected",
        },
      ),
      /alone at 100%/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("Vectorize readiness evidence is private, fresh, and exact-release bound", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-evidence-source-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-evidence-backup-"));
  const artifactEvidence = workerArtifactEvidence(cwd);
  const currentRelease = releaseIdentity(artifactEvidence);
  try {
    assert.throws(
      () => createVectorizeReadinessReport({
        createdAt,
        backupDir,
        currentRelease,
        deployEvidence: {
          createdAt: "2026-07-13T09:58:00.000Z",
          activeDeploymentReadAt: "2026-07-13T09:57:00.000Z",
        },
        vectorizeIndex: {
          name: "inspirlearning-memory-prod",
          dimensions: 768,
          metric: "cosine",
        },
        vectorizeInfo: { dimensions: 768, vectorCount: 174 },
        metadataIndexes,
      }),
      /mismatched, non-cosine, or empty/,
    );
    assert.throws(
      () => createVectorizeReadinessReport({
        createdAt,
        backupDir,
        currentRelease,
        deployEvidence: {
          createdAt: "2026-07-13T09:58:00.000Z",
          activeDeploymentReadAt: "2026-07-13T09:57:00.000Z",
        },
        vectorizeIndex: {
          name: "inspirlearning-memory-prod",
          dimensions: 512,
          metric: "cosine",
        },
        vectorizeInfo: { dimensions: 512, vectorCount: 0 },
        metadataIndexes,
      }),
      /mismatched, non-cosine, or empty/,
    );
    const report = createVectorizeReadinessReport({
      createdAt,
      backupDir,
      currentRelease,
      deployEvidence: {
        createdAt: "2026-07-13T09:58:00.000Z",
        activeDeploymentReadAt: "2026-07-13T09:57:00.000Z",
      },
      vectorizeIndex: {
        name: "inspirlearning-memory-prod",
        dimensions: 512,
        metric: "cosine",
      },
      vectorizeInfo: { dimensions: 512, vectorCount: 174 },
      metadataIndexes,
    });
    const reportPath = writeVectorizeReadinessReport(report, backupDir);
    assert.equal(reportPath, vectorizeReadinessReportPath(backupDir));
    assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
    assert.equal(
      assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease,
        now: new Date("2026-07-13T10:29:59.999Z"),
      }).createdAt,
      createdAt,
    );
    assert.throws(
      () => assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease,
        now: new Date("2026-07-13T10:30:00.001Z"),
      }),
      /stale/,
    );
    assert.equal(
      assertProductionVectorizeReadinessReleaseBinding({
        backupDir,
        currentRelease,
      }).createdAt,
      createdAt,
    );
    assert.throws(
      () => assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease: {
          ...currentRelease,
          artifactEvidence: {
            ...artifactEvidence,
            workerSourceSha256: "f".repeat(64),
          },
        },
        now: new Date("2026-07-13T10:10:00.000Z"),
      }),
      /does not authorize this release/,
    );
    fs.chmodSync(reportPath, 0o640);
    assert.throws(
      () => assertFreshProductionVectorizeReadiness({
        backupDir,
        currentRelease,
        now: new Date("2026-07-13T10:10:00.000Z"),
      }),
      /owner-only|0600/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("Vectorize readiness CLI accepts only the read-only production contract", () => {
  assert.deepEqual(
    parseVectorizeReadinessCli([
      "--remote",
      "--confirm-production",
      "--candidate-version",
      candidateVersionId,
    ]),
    {
      remote: true,
      confirmed: true,
      candidateVersionId,
    },
  );
  assert.throws(
    () => parseVectorizeReadinessCli([
      "--remote",
      "--confirm-production",
      "--candidate-version",
      candidateVersionId,
      "create-metadata-index",
    ]),
    /Unsupported/,
  );
  assert.throws(
    () => parseVectorizeReadinessCli([
      "--remote",
      "--confirm-production",
      "--candidate-version",
      candidateVersionId,
      "--backup",
    ]),
    /requires a directory/,
  );
  assert.throws(
    () => verifyProductionVectorizeReadiness({
      confirmed: false,
      remote: true,
      candidateVersionId,
    }),
    /requires --remote and --confirm-production/,
  );
});

function writeWranglerConfig(cwd: string, indexName: string) {
  fs.writeFileSync(
    path.join(cwd, "wrangler.jsonc"),
    `${JSON.stringify({
      vectorize: [{ binding: "MEMORY_VECTORIZE", index_name: indexName }],
    }, null, 2)}\n`,
  );
}

function workerArtifactEvidence(cwd: string): WorkerDeployArtifactEvidence {
  return {
    sourceFingerprint: {
      sha256: "b".repeat(64),
      fileCount: 0,
      files: [],
    },
    workerSourceSha256: "c".repeat(64),
    wranglerConfigSha256: "d".repeat(64),
    assetManifest: {
      root: path.join(cwd, ".open-next/assets"),
      sha256: "e".repeat(64),
      fileCount: 12,
      bytes: 4_096,
    },
  };
}

function workerDeployEvidence(
  backupDir: string,
  artifactEvidence: WorkerDeployArtifactEvidence,
): WorkerDeployRepairEvidence {
  return {
    createdAt: "2026-07-13T09:58:00.000Z",
    backupDir: path.resolve(backupDir),
    candidateVersionId,
    sourceFingerprintSha256: artifactEvidence.sourceFingerprint.sha256,
    sourceFingerprintFileCount: artifactEvidence.sourceFingerprint.fileCount,
    workerSourceSha256: artifactEvidence.workerSourceSha256,
    wranglerConfigSha256: artifactEvidence.wranglerConfigSha256,
    assetManifest: artifactEvidence.assetManifest,
    activeDeploymentReadAt: "2026-07-13T09:57:00.000Z",
  };
}

function releaseIdentity(
  artifactEvidence: WorkerDeployArtifactEvidence,
): VectorizeReadinessCurrentRelease {
  return {
    candidateVersionId,
    activeVersionId: candidateVersionId,
    git: {
      head: "a".repeat(40),
      upstream: "a".repeat(40),
      upstreamRef: "origin/codex/release",
    },
    artifactEvidence,
  };
}
