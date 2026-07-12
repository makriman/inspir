import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertGitReleaseIdentity } from "../scripts/cloudflare/git-release-identity";

test("Git release identity requires a clean checkout exactly equal to its upstream", () => {
  const fixture = makePushedRepository();
  try {
    const identity = assertGitReleaseIdentity({ cwd: fixture.repo });
    assert.equal(identity.head, identity.upstream);
    assert.match(identity.head, /^[a-f0-9]{40,64}$/);
    assert.match(identity.upstreamRef, /^origin\//);

    fs.writeFileSync(path.join(fixture.repo, "untracked.txt"), "untracked\n");
    assert.throws(
      () => assertGitReleaseIdentity({ cwd: fixture.repo }),
      /clean Git working tree/,
    );
    fs.rmSync(path.join(fixture.repo, "untracked.txt"));

    fs.writeFileSync(path.join(fixture.repo, "tracked.txt"), "changed\n");
    assert.throws(
      () => assertGitReleaseIdentity({ cwd: fixture.repo }),
      /clean Git working tree/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Git release identity rejects missing and behind upstream state", () => {
  const missing = makePushedRepository();
  try {
    runGit(missing.repo, ["branch", "--unset-upstream"]);
    assert.throws(
      () => assertGitReleaseIdentity({ cwd: missing.repo }),
      /@\{upstream\}|upstream/,
    );
  } finally {
    fs.rmSync(missing.root, { recursive: true, force: true });
  }

  const ahead = makePushedRepository();
  try {
    fs.writeFileSync(path.join(ahead.repo, "ahead.txt"), "ahead\n");
    runGit(ahead.repo, ["add", "."]);
    runGit(ahead.repo, ["commit", "-m", "ahead"]);
    assert.throws(
      () => assertGitReleaseIdentity({ cwd: ahead.repo }),
      /pushed upstream/,
    );
  } finally {
    fs.rmSync(ahead.root, { recursive: true, force: true });
  }
});

function makePushedRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-git-release-identity-"));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(repo);
  runGit(repo, ["init"]);
  runGit(repo, ["config", "user.email", "codex-tests@inspirlearning.invalid"]);
  runGit(repo, ["config", "user.name", "Codex Tests"]);
  fs.writeFileSync(path.join(repo, "tracked.txt"), "tracked\n");
  runGit(repo, ["add", "."]);
  runGit(repo, ["commit", "-m", "fixture"]);
  runGit(root, ["init", "--bare", remote]);
  runGit(repo, ["remote", "add", "origin", remote]);
  runGit(repo, ["push", "--set-upstream", "origin", "HEAD"]);
  return { root, repo };
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
}
