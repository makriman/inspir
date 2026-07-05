import fs from "node:fs";
import path from "node:path";
import {
  TABLE_ORDER,
  createHash,
  d1ManifestPath,
  stableStringify,
  timestampPrecisionPath,
  transformedTablePath,
  vectorizeManifestPath,
  vectorizeNdjsonPath,
} from "./migration-config";

type FileFingerprint = {
  file: string;
  bytes: number;
  sha256: string;
};

export type MigrationArtifactFingerprint = {
  sha256: string;
  files: FileFingerprint[];
};

export type VectorizeArtifactFingerprint = MigrationArtifactFingerprint & {
  manifestSha256: string;
  artifactSha256: string;
};

export function buildD1ArtifactFingerprint(backupDir: string): MigrationArtifactFingerprint {
  return buildFingerprint(backupDir, [
    d1ManifestPath(backupDir),
    timestampPrecisionPath(backupDir),
    ...TABLE_ORDER.map((table) => transformedTablePath(backupDir, table)),
  ]);
}

export function buildVectorizeArtifactFingerprint(backupDir: string): VectorizeArtifactFingerprint {
  const manifestPath = vectorizeManifestPath(backupDir);
  const artifactPath = vectorizeNdjsonPath(backupDir);
  const fingerprint = buildFingerprint(backupDir, [manifestPath, artifactPath]);
  const manifestFile = fingerprint.files.find((file) => file.file === path.relative(backupDir, manifestPath));
  const artifactFile = fingerprint.files.find((file) => file.file === path.relative(backupDir, artifactPath));
  return {
    ...fingerprint,
    manifestSha256: manifestFile?.sha256 ?? "",
    artifactSha256: artifactFile ? hashCanonicalNdjson(artifactPath) : "",
  };
}

function buildFingerprint(backupDir: string, files: string[]): MigrationArtifactFingerprint {
  const fileFingerprints = files.map((file) => fingerprintFile(backupDir, file));
  const hash = createHash();
  for (const file of fileFingerprints) {
    hash.update(`${file.file}\0${file.bytes}\0${file.sha256}\n`);
  }
  return {
    sha256: hash.digest("hex"),
    files: fileFingerprints,
  };
}

function fingerprintFile(backupDir: string, file: string): FileFingerprint {
  const content = fs.readFileSync(file);
  return {
    file: path.relative(backupDir, file),
    bytes: content.byteLength,
    sha256: createHash().update(content).digest("hex"),
  };
}

function hashCanonicalNdjson(file: string) {
  const hash = createHash();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    hash.update(`${stableStringify(JSON.parse(line))}\n`);
  }
  return hash.digest("hex");
}
