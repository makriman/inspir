import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "./migration-config";

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
  const files = listRepoSourceFiles(cwd).map((file) => fingerprintFile(cwd, path.join(cwd, file)));
  const hash = createHash();
  for (const file of files) hash.update(`${file.file}\0${file.bytes}\0${file.sha256}\n`);
  return {
    sha256: hash.digest("hex"),
    fileCount: files.length,
    files,
  };
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
