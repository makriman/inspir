import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertGitReleaseIdentity } from "../scripts/cloudflare/git-release-identity";
import {
  buildGitCommitSourceFingerprint,
  buildRepoSourceFingerprint,
  buildRepoSourceFingerprintRaw,
} from "../scripts/cloudflare/source-fingerprint";
import {
  RELEASE_TOOLING_FORWARD_CORRECTION_ENV,
  RELEASE_TOOLING_FORWARD_CORRECTION_KIND,
  isAllowedReleaseToolingFile,
} from "../scripts/cloudflare/release-tooling-forward-correction";

test("release tooling correction allowlist includes reviewed Vectorize topology verifier patches", () => {
  assert.equal(
    isAllowedReleaseToolingFile("scripts/cloudflare/verify-vectorize-readiness.ts"),
    true,
  );
  assert.equal(
    isAllowedReleaseToolingFile("tests/vectorize-readiness.test.ts"),
    true,
  );
  assert.equal(
    isAllowedReleaseToolingFile("scripts/cloudflare/repair-seo-cta-translations.ts"),
    true,
  );
});

test("release tooling forward correction returns recorded release Git and source only for a clean tooling-only diff", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-tooling-forward-"));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(repo, { recursive: true });
  try {
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "test@example.invalid"]);
    git(repo, ["config", "user.name", "Release Test"]);
    fs.mkdirSync(path.join(repo, "scripts/cloudflare"), { recursive: true });
    fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "scripts/cloudflare/historical-data-fresh-0016-successor.ts"),
      "export const version = 'release';\n",
    );
    fs.writeFileSync(path.join(repo, "app.ts"), "export const app = true;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "release source"]);
    git(root, ["init", "--bare", remote]);
    git(repo, ["remote", "add", "origin", remote]);
    git(repo, ["push", "-u", "origin", "main"]);
    const releaseGitHead = git(repo, ["rev-parse", "HEAD"]).trim();
    const releaseSource = buildGitCommitSourceFingerprint(releaseGitHead, repo);

    fs.writeFileSync(
      path.join(repo, "scripts/cloudflare/historical-data-fresh-0016-successor.ts"),
      "export const version = 'tooling';\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "tooling correction"]);
    git(repo, ["push"]);
    const toolingGitHead = git(repo, ["rev-parse", "HEAD"]).trim();
    const toolingSource = buildRepoSourceFingerprintRaw(repo);
    assert.notEqual(toolingSource.sha256, releaseSource.sha256);

    const correctionPath = path.join(root, "correction.json");
    fs.writeFileSync(
      correctionPath,
      `${JSON.stringify(
        {
          allowedChangedFiles: [
            "scripts/cloudflare/historical-data-fresh-0016-successor.ts",
          ],
          createdAt: new Date(Date.now() - 1_000).toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          kind: RELEASE_TOOLING_FORWARD_CORRECTION_KIND,
          reason: "test",
          releaseGit: {
            head: releaseGitHead,
            upstream: releaseGitHead,
            upstreamRef: "origin/main",
          },
          releaseSourceFingerprint: {
            sha256: releaseSource.sha256,
            fileCount: releaseSource.fileCount,
          },
          schemaVersion: 1,
          toolingGit: {
            head: toolingGitHead,
            upstream: toolingGitHead,
            upstreamRef: "origin/main",
          },
          toolingSourceFingerprint: {
            sha256: toolingSource.sha256,
            fileCount: toolingSource.fileCount,
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    fs.chmodSync(correctionPath, 0o600);
    const previous = process.env[RELEASE_TOOLING_FORWARD_CORRECTION_ENV];
    process.env[RELEASE_TOOLING_FORWARD_CORRECTION_ENV] = correctionPath;
    try {
      assert.equal(assertGitReleaseIdentity({ cwd: repo }).head, releaseGitHead);
      assert.equal(buildRepoSourceFingerprint(repo).sha256, releaseSource.sha256);
      const fixtureRepo = path.join(root, "fixture-repo");
      fs.mkdirSync(fixtureRepo);
      git(fixtureRepo, ["init", "-b", "main"]);
      fs.writeFileSync(path.join(fixtureRepo, "fixture.txt"), "unrelated\n");
      assert.equal(
        buildRepoSourceFingerprint(fixtureRepo).sha256,
        buildRepoSourceFingerprintRaw(fixtureRepo).sha256,
        "the global correction env does not apply to unrelated Git fixtures",
      );
      fs.writeFileSync(path.join(repo, "app.ts"), "export const app = 'dirty';\n");
      assert.throws(
        () => buildRepoSourceFingerprint(repo),
        /clean current Git working tree/,
        "the correction still fails closed when the corrected tooling repo is dirty",
      );
      fs.writeFileSync(path.join(repo, "app.ts"), "export const app = true;\n");
    } finally {
      if (previous === undefined) {
        delete process.env[RELEASE_TOOLING_FORWARD_CORRECTION_ENV];
      } else {
        process.env[RELEASE_TOOLING_FORWARD_CORRECTION_ENV] = previous;
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd: string, args: readonly string[]) {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${result.stderr}${result.stdout}`);
  }
  return result.stdout;
}
