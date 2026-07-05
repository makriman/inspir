import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_MANIFEST_RELATIVE_PATH, EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH } from "./evidence-manifest";

type EvidenceManifest = {
  createdAt?: string;
  backupDir?: string;
  files?: Array<{
    file?: string;
  }>;
};

type EvidenceVerifyReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  manifest?: string;
  manifestCreatedAt?: string | null;
  manifestBackupDirOk?: boolean;
  checkedFiles?: number;
  duplicateFiles?: unknown[];
  problems?: unknown[];
};

type EvidenceVerificationResult = {
  ok: boolean;
  blockers: string[];
  detail: {
    manifest: string;
    report: string;
    manifestCreatedAt?: string | null;
    reportCreatedAt?: string;
    checkedFiles?: number;
  };
};

type EvidenceVerificationOptions = {
  requiredFiles?: string[];
};

export function checkFreshVerifiedEvidenceManifest(
  backupDir: string,
  maxAgeMs: number,
  options: EvidenceVerificationOptions = {},
): EvidenceVerificationResult {
  const blockers: string[] = [];
  const manifest = readJson<EvidenceManifest>(backupDir, EVIDENCE_MANIFEST_RELATIVE_PATH);
  const report = readJson<EvidenceVerifyReport>(backupDir, EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH);

  if (!manifest) blockers.push(`${EVIDENCE_MANIFEST_RELATIVE_PATH} is missing or unreadable`);
  if (!report) blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} is missing or unreadable`);

  if (manifest) {
    if (path.resolve(manifest.backupDir ?? "") !== path.resolve(backupDir)) {
      blockers.push(`${EVIDENCE_MANIFEST_RELATIVE_PATH} was generated for a different backup directory`);
    }
    if (!manifest.createdAt) blockers.push(`${EVIDENCE_MANIFEST_RELATIVE_PATH} has no createdAt timestamp`);
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      blockers.push(`${EVIDENCE_MANIFEST_RELATIVE_PATH} has no file entries`);
    }
    const manifestFiles = new Set((manifest.files ?? []).map((entry) => entry.file).filter(isString));
    for (const requiredFile of options.requiredFiles ?? []) {
      if (!manifestFiles.has(requiredFile)) {
        blockers.push(`${EVIDENCE_MANIFEST_RELATIVE_PATH} does not include ${requiredFile}`);
      }
    }
  }

  if (report) {
    if (report.ok !== true) blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} is not clean`);
    if (report.manifest !== EVIDENCE_MANIFEST_RELATIVE_PATH) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} verified an unexpected manifest path`);
    }
    if (path.resolve(report.backupDir ?? "") !== path.resolve(backupDir)) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} was generated for a different backup directory`);
    }
    if (report.manifestBackupDirOk !== true) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} did not verify the manifest backup directory`);
    }
    if (!Array.isArray(report.problems) || report.problems.length > 0) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} has manifest verification problems`);
    }
    if (!Array.isArray(report.duplicateFiles) || report.duplicateFiles.length > 0) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} has duplicate file entries`);
    }
    if (typeof report.checkedFiles !== "number" || report.checkedFiles <= 0) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} checked no files`);
    }
    checkReportFreshness(report, maxAgeMs, blockers);
    checkNoManifestEntriesChangedAfterVerification(backupDir, manifest, report, blockers);
  }

  if (manifest && report) {
    if (manifest.createdAt !== report.manifestCreatedAt) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} does not match the current evidence manifest timestamp`);
    }
    if (Array.isArray(manifest.files) && report.checkedFiles !== manifest.files.length) {
      blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} checked file count does not match the current evidence manifest`);
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    detail: {
      manifest: EVIDENCE_MANIFEST_RELATIVE_PATH,
      report: EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH,
      manifestCreatedAt: report?.manifestCreatedAt ?? null,
      reportCreatedAt: report?.createdAt,
      checkedFiles: report?.checkedFiles,
    },
  };
}

function checkNoManifestEntriesChangedAfterVerification(
  backupDir: string,
  manifest: EvidenceManifest | null,
  report: EvidenceVerifyReport,
  blockers: string[],
) {
  if (!manifest?.files?.length || !report.createdAt) return;
  const verifiedAt = Date.parse(report.createdAt);
  if (!Number.isFinite(verifiedAt)) return;

  for (const entry of manifest.files) {
    if (!isString(entry.file)) continue;
    const absolutePath = path.join(backupDir, entry.file);
    if (!fs.existsSync(absolutePath)) {
      blockers.push(`${entry.file} was deleted after evidence verification`);
      continue;
    }
    if (fs.statSync(absolutePath).mtimeMs > verifiedAt + 1000) {
      blockers.push(`${entry.file} changed after evidence verification`);
    }
  }
}

function checkReportFreshness(report: EvidenceVerifyReport, maxAgeMs: number, blockers: string[]) {
  if (!report.createdAt) {
    blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} has no createdAt timestamp`);
    return;
  }
  const createdAt = Date.parse(report.createdAt);
  if (!Number.isFinite(createdAt)) {
    blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} has an invalid createdAt timestamp`);
    return;
  }
  if (Date.now() - createdAt > maxAgeMs) {
    blockers.push(`${EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH} is older than one hour`);
  }
}

function readJson<T>(backupDir: string, relativePath: string): T | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
