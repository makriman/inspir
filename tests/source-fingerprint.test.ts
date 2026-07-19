import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildGitCommitSourceFingerprint,
  buildRepoSourceFingerprint,
} from "../scripts/cloudflare/source-fingerprint";

test("repo source fingerprint covers tracked and untracked non-ignored files", () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-fingerprint-"));
  try {
    runGit(repoDir, ["init"]);
    fs.writeFileSync(path.join(repoDir, ".gitignore"), "ignored.txt\n*.generated\n");
    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "tracked v1\n");
    fs.writeFileSync(path.join(repoDir, "untracked.txt"), "untracked v1\n");
    fs.writeFileSync(path.join(repoDir, "ignored.txt"), "ignored v1\n");
    fs.writeFileSync(path.join(repoDir, "cloudflare-env.generated.d.ts"), "generated v1\n");
    runGit(repoDir, ["add", ".gitignore", "tracked.txt"]);

    const first = buildRepoSourceFingerprint(repoDir);
    const files = first.files.map((file) => file.file);
    assert.deepEqual(files, [".gitignore", "tracked.txt", "untracked.txt"]);

    fs.writeFileSync(path.join(repoDir, "ignored.txt"), "ignored v2\n");
    fs.writeFileSync(path.join(repoDir, "cloudflare-env.generated.d.ts"), "generated v2\n");
    const ignoredChange = buildRepoSourceFingerprint(repoDir);
    assert.equal(ignoredChange.sha256, first.sha256);

    fs.writeFileSync(path.join(repoDir, "untracked.txt"), "untracked v2\n");
    const sourceChange = buildRepoSourceFingerprint(repoDir);
    assert.notEqual(sourceChange.sha256, first.sha256);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("git commit source fingerprint matches exact committed blob bytes in one pass", () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-fingerprint-commit-"));
  try {
    runGit(repoDir, ["init"]);
    runGit(repoDir, ["config", "user.email", "test@example.invalid"]);
    runGit(repoDir, ["config", "user.name", "Source Fingerprint Test"]);
    fs.mkdirSync(path.join(repoDir, "nested"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, ".open-next/assets"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "tracked v1\n");
    fs.writeFileSync(path.join(repoDir, "nested/binary.bin"), Buffer.from([0, 1, 10, 255]));
    fs.writeFileSync(path.join(repoDir, "cloudflare-env.generated.d.ts"), "generated v1\n");
    fs.writeFileSync(path.join(repoDir, ".open-next/assets/ignored.js"), "asset v1\n");
    runGit(repoDir, ["add", "."]);
    runGit(repoDir, ["commit", "-m", "source fingerprint"]);
    const commit = runGit(repoDir, ["rev-parse", "HEAD"]).trim();

    const fromCommit = buildGitCommitSourceFingerprint(commit, repoDir);
    const fromWorktree = buildRepoSourceFingerprint(repoDir);
    assert.deepEqual(
      fromCommit.files.map((file) => file.file),
      ["nested/binary.bin", "tracked.txt"],
    );
    assert.equal(fromCommit.sha256, fromWorktree.sha256);
    assert.equal(fromCommit.fileCount, fromWorktree.fileCount);

    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "tracked v2\n");
    assert.notEqual(buildRepoSourceFingerprint(repoDir).sha256, fromCommit.sha256);
    assert.equal(buildGitCommitSourceFingerprint(commit, repoDir).sha256, fromCommit.sha256);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
