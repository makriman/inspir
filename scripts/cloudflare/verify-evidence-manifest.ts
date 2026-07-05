import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, createHash, resolveBackupDir } from "./migration-config";
import { EVIDENCE_MANIFEST_RELATIVE_PATH, EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH } from "./evidence-manifest";

type EvidenceManifest = {
  createdAt?: string;
  backupDir?: string;
  files?: Array<{
    file?: string;
    bytes?: number;
    sha256?: string;
  }>;
};

type Problem = {
  file: string;
  reason: string;
  expectedBytes?: number;
  actualBytes?: number;
  expectedSha256?: string;
  actualSha256?: string;
};

const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const manifestPath = path.join(backupDir, EVIDENCE_MANIFEST_RELATIVE_PATH);
const outputPath = path.join(backupDir, EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH);

void main();

function main() {
  const manifest = readManifest();
  const problems: Problem[] = [];
  const manifestBackupDirOk = path.resolve(manifest.backupDir ?? "") === path.resolve(backupDir);
  if (!manifestBackupDirOk) {
    problems.push({
      file: EVIDENCE_MANIFEST_RELATIVE_PATH,
      reason: "manifest backupDir does not match selected backup directory",
    });
  }

  const files = manifest.files ?? [];
  for (const entry of files) {
    if (!entry.file || typeof entry.bytes !== "number" || !entry.sha256) {
      problems.push({ file: entry.file ?? "<missing>", reason: "invalid manifest entry" });
      continue;
    }
    if (entry.file === EVIDENCE_MANIFEST_RELATIVE_PATH || entry.file === EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH) {
      problems.push({ file: entry.file, reason: "manifest must not include volatile evidence manifest files" });
      continue;
    }

    const absolutePath = path.join(backupDir, entry.file);
    if (!isInsideBackup(absolutePath)) {
      problems.push({ file: entry.file, reason: "manifest entry escapes backup directory" });
      continue;
    }
    if (!fs.existsSync(absolutePath)) {
      problems.push({
        file: entry.file,
        reason: "missing",
        expectedBytes: entry.bytes,
        expectedSha256: entry.sha256,
      });
      continue;
    }

    const content = fs.readFileSync(absolutePath);
    const actualSha256 = createHash().update(content).digest("hex");
    if (content.byteLength !== entry.bytes || actualSha256 !== entry.sha256) {
      problems.push({
        file: entry.file,
        reason: "changed",
        expectedBytes: entry.bytes,
        actualBytes: content.byteLength,
        expectedSha256: entry.sha256,
        actualSha256,
      });
    }
  }

  const duplicateFiles = findDuplicates(files.map((entry) => entry.file).filter(isString));
  for (const file of duplicateFiles) problems.push({ file, reason: "duplicate manifest entry" });

  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    manifest: EVIDENCE_MANIFEST_RELATIVE_PATH,
    manifestCreatedAt: manifest.createdAt ?? null,
    manifestBackupDirOk,
    checkedFiles: files.length,
    duplicateFiles,
    ok: problems.length === 0,
    problems,
  };

  fs.mkdirSync(cfDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing ${EVIDENCE_MANIFEST_RELATIVE_PATH}. Run pnpm cf:status:migration first.`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as EvidenceManifest;
}

function isInsideBackup(filePath: string) {
  const relative = path.relative(backupDir, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function findDuplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
