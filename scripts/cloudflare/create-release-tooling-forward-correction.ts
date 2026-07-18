import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildGitCommitSourceFingerprint,
  buildRepoSourceFingerprintRaw,
} from "./source-fingerprint";
import {
  RELEASE_TOOLING_FORWARD_CORRECTION_KIND,
  RELEASE_TOOLING_FORWARD_CORRECTION_ENV,
  isAllowedReleaseToolingFile,
} from "./release-tooling-forward-correction";

type Args = Readonly<{
  backupDir: string;
  releaseGitHead: string;
  expiresHours: number;
}>;

const GIT_OBJECT_PATTERN = /^[a-f0-9]{40,64}$/i;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const backupDir = path.resolve(args.backupDir);
  const cloudflareDir = path.join(backupDir, "cloudflare");
  const releaseGitHead = args.releaseGitHead.toLowerCase();
  const releaseGit = gitIdentity(cwd, releaseGitHead);
  const toolingGit = currentGitIdentity(cwd);
  if (releaseGit.head === toolingGit.head) {
    throw new Error("Tooling correction requires a distinct tooling commit.");
  }
  if (releaseGit.head !== releaseGit.upstream || toolingGit.head !== toolingGit.upstream) {
    throw new Error("Release and tooling commits must both be clean pushed identities.");
  }
  runGit(cwd, ["merge-base", "--is-ancestor", releaseGit.head, toolingGit.head]);
  const changedFiles = git(cwd, [
    "diff",
    "--name-only",
    "-z",
    `${releaseGit.head}..${toolingGit.head}`,
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  if (
    changedFiles.length === 0 ||
    changedFiles.some((file) => !isAllowedReleaseToolingFile(file))
  ) {
    throw new Error(
      "Tooling correction diff must contain only explicit release-tooling files.",
    );
  }
  const status = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.trim()) {
    throw new Error("Tooling correction requires a clean working tree.");
  }
  const releaseSource = compactSource(
    buildGitCommitSourceFingerprint(releaseGit.head, cwd),
  );
  const toolingSource = compactSource(buildRepoSourceFingerprintRaw(cwd));
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + args.expiresHours * 60 * 60 * 1_000,
  );
  fs.mkdirSync(cloudflareDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(cloudflareDir, 0o700);
  const outputPath = path.join(
    cloudflareDir,
    `release-tooling-forward-correction-${releaseGit.head}-${toolingGit.head}.json`,
  );
  const payload = {
    allowedChangedFiles: changedFiles,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    kind: RELEASE_TOOLING_FORWARD_CORRECTION_KIND,
    reason:
      "Allow paid-expedited fresh-0016 successor verifier correction while preserving the uploaded release runtime/source identity.",
    releaseGit,
    releaseSourceFingerprint: releaseSource,
    schemaVersion: 1,
    toolingGit,
    toolingSourceFingerprint: toolingSource,
  } as const;
  const bytes = `${JSON.stringify(payload, null, 2)}\n`;
  const descriptor = fs.openSync(outputPath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(outputPath, 0o600);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        path: outputPath,
        env: `${RELEASE_TOOLING_FORWARD_CORRECTION_ENV}=${outputPath}`,
        releaseGitHead: releaseGit.head,
        toolingGitHead: toolingGit.head,
        releaseSourceFingerprint: releaseSource,
        toolingSourceFingerprint: toolingSource,
        allowedChangedFiles: changedFiles,
      },
      null,
      2,
    )}\n`,
  );
}

function parseArgs(argv: readonly string[]): Args {
  let backupDir = "";
  let releaseGitHead = "";
  let expiresHours = 12;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--backup" && next) {
      backupDir = next;
      index += 1;
    } else if (arg === "--release-git-head" && next) {
      releaseGitHead = next;
      index += 1;
    } else if (arg === "--expires-hours" && next) {
      expiresHours = Number.parseInt(next, 10);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!backupDir || !path.isAbsolute(path.resolve(backupDir))) {
    throw new Error("Expected --backup <path>.");
  }
  if (!GIT_OBJECT_PATTERN.test(releaseGitHead)) {
    throw new Error("Expected --release-git-head <git-object>.");
  }
  if (!Number.isSafeInteger(expiresHours) || expiresHours < 1 || expiresHours > 24) {
    throw new Error("--expires-hours must be between 1 and 24.");
  }
  return { backupDir, releaseGitHead, expiresHours };
}

function gitIdentity(cwd: string, commit: string) {
  const head = git(cwd, ["rev-parse", "--verify", commit]).trim().toLowerCase();
  const upstream = git(cwd, ["rev-parse", "--verify", commit]).trim().toLowerCase();
  const upstreamRef = git(cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]).trim();
  return { head, upstream, upstreamRef } as const;
}

function currentGitIdentity(cwd: string) {
  return {
    head: git(cwd, ["rev-parse", "--verify", "HEAD"]).trim().toLowerCase(),
    upstream: git(cwd, ["rev-parse", "--verify", "@{upstream}"])
      .trim()
      .toLowerCase(),
    upstreamRef: git(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]).trim(),
  } as const;
}

function compactSource(source: Readonly<{ sha256: string; fileCount: number }>) {
  return { sha256: source.sha256, fileCount: source.fileCount } as const;
}

function git(cwd: string, args: readonly string[]) {
  const result = runGit(cwd, args);
  return result.stdout;
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .trim()
      .slice(-1_000);
    throw new Error(
      `Git command failed: git ${args.join(" ")}${detail ? ` (${detail})` : ""}`,
    );
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

main();
