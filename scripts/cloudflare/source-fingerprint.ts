import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "./migration-config";
import {
  readReleaseToolingForwardCorrection,
} from "./release-tooling-forward-correction";

export type SourceFileFingerprint = {
  file: string;
  bytes: number;
  sha256: string;
};

export type SourceFingerprint = {
  sha256: string;
  fileCount: number;
  files: SourceFileFingerprint[];
};

export function buildRepoSourceFingerprint(cwd = process.cwd()): SourceFingerprint {
  const correction = readReleaseToolingForwardCorrection(cwd);
  if (correction) {
    const releaseSource = buildGitCommitSourceFingerprint(
      correction.releaseGit.head,
      cwd,
    );
    if (
      releaseSource.sha256 !== correction.releaseSourceFingerprint.sha256 ||
      releaseSource.fileCount !== correction.releaseSourceFingerprint.fileCount
    ) {
      throw new Error(
        "Release tooling forward correction release source fingerprint no longer matches its recorded Git object.",
      );
    }
    const toolingSource = buildRepoSourceFingerprintRaw(cwd);
    if (
      toolingSource.sha256 !== correction.toolingSourceFingerprint.sha256 ||
      toolingSource.fileCount !== correction.toolingSourceFingerprint.fileCount
    ) {
      throw new Error(
        "Release tooling forward correction tooling source fingerprint no longer matches the clean working tree.",
      );
    }
    return releaseSource;
  }
  return buildRepoSourceFingerprintRaw(cwd);
}

export function buildRepoSourceFingerprintRaw(cwd = process.cwd()): SourceFingerprint {
  const files = listRepoSourceFiles(cwd).map((file) => fingerprintFile(cwd, path.join(cwd, file)));
  const hash = createHash();
  for (const file of files) hash.update(`${file.file}\0${file.bytes}\0${file.sha256}\n`);
  return {
    sha256: hash.digest("hex"),
    fileCount: files.length,
    files,
  };
}

export function buildGitCommitSourceFingerprint(
  commit: string,
  cwd = process.cwd(),
): SourceFingerprint {
  if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
    throw new Error("Source fingerprint requires an exact Git commit object ID.");
  }
  const listed = spawnSync(
    "git",
    ["ls-tree", "-r", "--name-only", "-z", commit],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (listed.status !== 0) {
    throw new Error(`Could not list Git commit source files: ${listed.stderr || listed.error}`);
  }
  const files = listed.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => !isVolatileSourceFile(file))
    .sort()
    .map((file) => {
      const shown = spawnSync(
        "git",
        ["show", `${commit}:${file}`],
        { cwd, encoding: null, maxBuffer: 64 * 1024 * 1024 },
      );
      if (shown.status !== 0 || !Buffer.isBuffer(shown.stdout)) {
        throw new Error(`Could not read Git commit source file ${file}.`);
      }
      return {
        file,
        bytes: shown.stdout.byteLength,
        sha256: createHash().update(shown.stdout).digest("hex"),
      };
    });
  const hash = createHash();
  for (const file of files) hash.update(`${file.file}\0${file.bytes}\0${file.sha256}\n`);
  return { sha256: hash.digest("hex"), fileCount: files.length, files };
}

export function fingerprintFile(baseDir: string, filePath: string): SourceFileFingerprint {
  const content = fs.readFileSync(filePath);
  return {
    file: path.relative(baseDir, filePath).split(path.sep).join("/"),
    bytes: content.byteLength,
    sha256: createHash().update(content).digest("hex"),
  };
}

export function listRepoSourceFiles(cwd: string) {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Could not list git source files: ${result.stderr || result.stdout || result.error}`);
  }

  return result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => {
      const absolutePath = path.join(cwd, file);
      return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() && !isVolatileSourceFile(file);
    })
    .sort();
}

function isVolatileSourceFile(file: string) {
  return (
    file === "cloudflare-env.generated.d.ts" ||
    file === "next-env.d.ts" ||
    file.endsWith(".tsbuildinfo") ||
    file.startsWith(".next/") ||
    file.startsWith(".open-next/") ||
    file.startsWith(".wrangler/")
  );
}
