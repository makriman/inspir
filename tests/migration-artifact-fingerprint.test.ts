import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildD1ArtifactFingerprint,
  buildVectorizeArtifactFingerprint,
} from "../scripts/cloudflare/migration-artifact-fingerprint";
import { TABLE_ORDER } from "../scripts/cloudflare/migration-config";

test("D1 artifact fingerprint changes when any transformed table file changes", async () => {
  await withArtifactFixture((backupDir) => {
    const before = buildD1ArtifactFingerprint(backupDir);
    fs.appendFileSync(path.join(backupDir, "cloudflare", "d1-transformed", `${TABLE_ORDER[0]}.ndjson`), "{}\n");
    const after = buildD1ArtifactFingerprint(backupDir);

    assert.notEqual(after.sha256, before.sha256);
  });
});

test("D1 artifact fingerprint changes when timestamp precision sidecar changes", async () => {
  await withArtifactFixture((backupDir) => {
    const before = buildD1ArtifactFingerprint(backupDir);
    fs.appendFileSync(path.join(backupDir, "cloudflare", "d1-timestamp-precision.ndjson"), '{"source_table":"users"}\n');
    const after = buildD1ArtifactFingerprint(backupDir);

    assert.notEqual(after.sha256, before.sha256);
  });
});

test("Vectorize artifact fingerprint exposes actual NDJSON hash separately from manifest hash", async () => {
  await withArtifactFixture((backupDir) => {
    const before = buildVectorizeArtifactFingerprint(backupDir);
    fs.writeFileSync(path.join(backupDir, "cloudflare", "vectorize-memory.ndjson"), '{"id":"changed"}\n');
    const after = buildVectorizeArtifactFingerprint(backupDir);

    assert.notEqual(after.sha256, before.sha256);
    assert.equal(after.manifestSha256, before.manifestSha256);
    assert.notEqual(after.artifactSha256, before.artifactSha256);
  });
});

async function withArtifactFixture(callback: (backupDir: string) => void | Promise<void>) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-artifact-fingerprint-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare", "d1-transformed"), { recursive: true });
    const d1Manifest = TABLE_ORDER.map((table) => ({
      table,
      rows: 1,
      sha256: "fixture",
      file: `cloudflare/d1-transformed/${table}.ndjson`,
    }));
    fs.writeFileSync(path.join(backupDir, "cloudflare", "d1-import-manifest.json"), `${JSON.stringify(d1Manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(backupDir, "cloudflare", "d1-timestamp-precision.ndjson"), "");
    for (const table of TABLE_ORDER) {
      fs.writeFileSync(path.join(backupDir, "cloudflare", "d1-transformed", `${table}.ndjson`), `{"id":"${table}"}\n`);
    }
    fs.writeFileSync(
      path.join(backupDir, "cloudflare", "vectorize-manifest.json"),
      `${JSON.stringify({ rows: 1, sha256: "fixture", file: "cloudflare/vectorize-memory.ndjson" }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(backupDir, "cloudflare", "vectorize-memory.ndjson"), '{"id":"one","values":[0]}\n');
    await callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}
