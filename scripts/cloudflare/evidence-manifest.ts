import fs from "node:fs";
import path from "node:path";
import { createHash } from "./migration-config";

export const EVIDENCE_MANIFEST_RELATIVE_PATH = "cloudflare/evidence-manifest.json";
export const EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH = "cloudflare/evidence-manifest-verify-report.json";

type EvidenceFile = {
  file: string;
  bytes: number;
  sha256: string;
};

export function writeEvidenceManifest(backupDir: string) {
  const manifestPath = path.join(backupDir, EVIDENCE_MANIFEST_RELATIVE_PATH);
  const verifyReportPath = path.join(backupDir, EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH);
  const files = listFiles(backupDir)
    .filter((file) => {
      const resolved = path.resolve(file);
      return resolved !== path.resolve(manifestPath) && resolved !== path.resolve(verifyReportPath);
    })
    .map((file): EvidenceFile => {
      const content = fs.readFileSync(file);
      const hash = createHash().update(content).digest("hex");
      return {
        file: path.relative(backupDir, file),
        bytes: content.byteLength,
        sha256: hash,
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));

  const manifest = {
    createdAt: new Date().toISOString(),
    backupDir,
    note: "SHA-256 manifest for local migration backup and generated Cloudflare migration evidence. Secret values are not printed, but hashes cover secret-containing backup files.",
    files,
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { manifestPath, files: files.length };
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}
