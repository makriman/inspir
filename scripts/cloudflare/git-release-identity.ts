import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  readReleaseToolingForwardCorrection,
} from "./release-tooling-forward-correction";

export type GitReleaseIdentity = {
  head: string;
  upstream: string;
  upstreamRef: string;
};

export type GitCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type GitCommandRunner = (cwd: string, args: readonly string[]) => GitCommandResult;

const gitObjectIdPattern = /^[a-f0-9]{40,64}$/i;

export function assertGitReleaseIdentity(options: {
  cwd?: string;
  runner?: GitCommandRunner;
} = {}): GitReleaseIdentity {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (!options.runner) {
    const correction = readReleaseToolingForwardCorrection(cwd);
    if (correction) return { ...correction.releaseGit };
  }
  const runner = options.runner ?? runGitCommand;
  const workTree = runRequiredGit(runner, cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (workTree.trim() !== "true") {
    throw new Error("Production release requires a Git working tree.");
  }

  const dirty = runRequiredGit(runner, cwd, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (dirty.trim()) {
    throw new Error("Production release requires a clean Git working tree, including untracked files.");
  }

  const head = requireGitObjectId(
    runRequiredGit(runner, cwd, ["rev-parse", "--verify", "HEAD"]).trim(),
    "HEAD",
  );
  const upstream = requireGitObjectId(
    runRequiredGit(runner, cwd, ["rev-parse", "--verify", "@{upstream}"]).trim(),
    "upstream",
  );
  const upstreamRef = runRequiredGit(runner, cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]).trim();
  if (!upstreamRef || upstreamRef === "@{upstream}" || /[\u0000-\u001f\u007f]/.test(upstreamRef)) {
    throw new Error("Production release requires a valid configured Git upstream.");
  }
  if (head !== upstream) {
    throw new Error("Production release requires HEAD to equal its pushed upstream commit.");
  }
  return { head, upstream, upstreamRef };
}

function runGitCommand(cwd: string, args: readonly string[]): GitCommandResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
}

function runRequiredGit(
  runner: GitCommandRunner,
  cwd: string,
  args: readonly string[],
) {
  const result = runner(cwd, args);
  if (result.status !== 0) {
    const detail = `${result.stderr}${result.stdout}`
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .trim()
      .slice(-1_000);
    throw new Error(
      `Production release Git check failed: git ${args.join(" ")}${detail ? ` (${detail})` : ""}.`,
    );
  }
  return result.stdout;
}

function requireGitObjectId(value: string, label: string) {
  if (!gitObjectIdPattern.test(value)) {
    throw new Error(`Production release Git ${label} is missing or malformed.`);
  }
  return value.toLowerCase();
}
