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
    ["ls-tree", "-r", "-z", "--long", commit],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (listed.status !== 0) {
    throw new Error(`Could not list Git commit source files: ${listed.stderr || listed.error}`);
  }
  const entries = listed.stdout
    .split("\0")
    .filter(Boolean)
    .map(parseGitTreeBlobEntry)
    .filter((entry): entry is GitTreeBlobEntry => entry !== null)
    .filter((entry) => !isVolatileSourceFile(entry.file))
    .sort((left, right) => compareSourceFileNames(left.file, right.file));
  const blobs = readGitBlobContents(cwd, entries);
  const files = entries.map((entry, index) => {
    const body = blobs[index];
    if (!body) throw new Error(`Could not read Git commit source file ${entry.file}.`);
    return {
      file: entry.file,
      bytes: body.byteLength,
      sha256: createHash().update(body).digest("hex"),
    };
  });
  const hash = createHash();
  for (const file of files) hash.update(`${file.file}\0${file.bytes}\0${file.sha256}\n`);
  return { sha256: hash.digest("hex"), fileCount: files.length, files };
}

type GitTreeBlobEntry = {
  file: string;
  objectId: string;
  objectSize: number;
};

function parseGitTreeBlobEntry(entry: string): GitTreeBlobEntry | null {
  const tabIndex = entry.indexOf("\t");
  if (tabIndex < 0) {
    throw new Error("Git tree source entry is malformed.");
  }
  const metadata = entry.slice(0, tabIndex);
  const file = entry.slice(tabIndex + 1);
  const match = metadata.match(/^[0-7]{6} blob ([a-f0-9]{40,64})\s+(\d+)$/i);
  if (!match) return null;
  const objectSize = Number(match[2]);
  if (!Number.isSafeInteger(objectSize) || objectSize < 0) {
    throw new Error(`Git tree source entry has an invalid object size for ${file}.`);
  }
  return {
    file,
    objectId: match[1].toLowerCase(),
    objectSize,
  };
}

function readGitBlobContents(
  cwd: string,
  entries: readonly GitTreeBlobEntry[],
): Buffer[] {
  if (entries.length === 0) return [];
  const requestedObjects = `${entries.map((entry) => entry.objectId).join("\n")}\n`;
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd,
    encoding: null,
    input: requestedObjects,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.error ?? "");
    throw new Error(`Could not read Git commit source blobs: ${detail}`);
  }
  const output = result.stdout;
  const blobs: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const newlineIndex = output.indexOf(0x0a, offset);
    if (newlineIndex < 0) {
      throw new Error(`Git cat-file output ended before ${entry.file}.`);
    }
    const header = output.subarray(offset, newlineIndex).toString("utf8");
    const headerMatch = header.match(/^([a-f0-9]{40,64}) blob (\d+)$/i);
    if (!headerMatch) {
      throw new Error(`Git cat-file returned malformed metadata for ${entry.file}.`);
    }
    const objectId = headerMatch[1].toLowerCase();
    const byteLength = Number(headerMatch[2]);
    if (objectId !== entry.objectId || byteLength !== entry.objectSize) {
      throw new Error(`Git cat-file source blob identity changed for ${entry.file}.`);
    }
    const bodyStart = newlineIndex + 1;
    const bodyEnd = bodyStart + byteLength;
    if (bodyEnd > output.byteLength || output[bodyEnd] !== 0x0a) {
      throw new Error(`Git cat-file source blob body is truncated for ${entry.file}.`);
    }
    blobs.push(output.subarray(bodyStart, bodyEnd));
    offset = bodyEnd + 1;
  }
  if (offset !== output.byteLength) {
    throw new Error("Git cat-file returned unexpected trailing source data.");
  }
  return blobs;
}

function compareSourceFileNames(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
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
