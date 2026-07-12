import fs from "node:fs";
import path from "node:path";
import { freshBackupScopedReportBlockers } from "./fresh-report-gate";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

const SAFETY_REPORT_MAX_AGE_MS = 60 * 60 * 1000;

type SourceScopedReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  sourceFingerprint?: {
    sha256?: string;
    fileCount?: number;
  };
  sourceFingerprintAfter?: SourceFingerprint;
  findings?: unknown[];
  scannedFiles?: unknown;
  results?: unknown[];
  artifactRoot?: string;
  nextEnvFile?: string | null;
};

export type ReleaseArtifactSafetyCheck = {
  name: string;
  status: "pass" | "fail";
  detail?: unknown;
};

export function buildReleaseArtifactSafetyChecks(input: {
  backupDir: string;
  cwd: string;
  nowMs?: number;
}): ReleaseArtifactSafetyCheck[] {
  const currentSourceFingerprint = buildRepoSourceFingerprint(input.cwd);
  return [
    sourceScopedCheck({
      name: "local build and test gates",
      relativePath: "cloudflare/local-gates-report.json",
      report: readBackupJson<SourceScopedReport>(input.backupDir, "cloudflare/local-gates-report.json"),
      backupDir: input.backupDir,
      currentSourceFingerprint,
      nowMs: input.nowMs,
      fingerprintField: "sourceFingerprintAfter",
      extraOk: (report) => Array.isArray(report?.results),
    }),
    sourceScopedCheck({
      name: "source secret scan",
      relativePath: "cloudflare/source-secret-scan-report.json",
      report: readBackupJson<SourceScopedReport>(input.backupDir, "cloudflare/source-secret-scan-report.json"),
      backupDir: input.backupDir,
      currentSourceFingerprint,
      nowMs: input.nowMs,
      fingerprintField: "sourceFingerprint",
      extraOk: (report) => (report?.findings?.length ?? 0) === 0,
    }),
    sourceScopedCheck({
      name: "OpenNext build artifact secret scan",
      relativePath: "cloudflare/build-artifact-scan-report.json",
      report: readBackupJson<SourceScopedReport>(input.backupDir, "cloudflare/build-artifact-scan-report.json"),
      backupDir: input.backupDir,
      currentSourceFingerprint,
      nowMs: input.nowMs,
      fingerprintField: "sourceFingerprint",
      extraOk: (report) =>
        (report?.findings?.length ?? 0) === 0 &&
        report?.artifactRoot === ".open-next" &&
        report?.nextEnvFile === ".open-next/cloudflare/next-env.mjs" &&
        typeof report?.scannedFiles === "number" &&
        report.scannedFiles > 0,
    }),
  ];
}

function sourceScopedCheck(input: {
  name: string;
  relativePath: string;
  report: SourceScopedReport | null;
  backupDir: string;
  currentSourceFingerprint: SourceFingerprint;
  nowMs?: number;
  fingerprintField: "sourceFingerprint" | "sourceFingerprintAfter";
  extraOk?: (report: SourceScopedReport | null) => boolean;
}): ReleaseArtifactSafetyCheck {
  const freshnessBlockers = freshBackupScopedReportBlockers({
    relativePath: input.relativePath,
    report: input.report,
    backupDir: input.backupDir,
    maxAgeMs: SAFETY_REPORT_MAX_AGE_MS,
    nowMs: input.nowMs,
    requireOk: true,
  });
  const fingerprint = input.report?.[input.fingerprintField];
  const sourceFingerprintOk =
    fingerprint?.sha256 === input.currentSourceFingerprint.sha256 &&
    fingerprint.fileCount === input.currentSourceFingerprint.fileCount;
  const extraOk = input.extraOk ? input.extraOk(input.report) : true;
  const ok = freshnessBlockers.length === 0 && sourceFingerprintOk && extraOk;
  return {
    name: input.name,
    status: ok ? "pass" : "fail",
    detail: ok
      ? { report: input.relativePath, sourceFingerprint: input.currentSourceFingerprint.sha256 }
      : {
          report: input.relativePath,
          freshnessBlockers,
          sourceFingerprintOk,
          expectedSourceFingerprint: fingerprint?.sha256,
          actualSourceFingerprint: input.currentSourceFingerprint.sha256,
          extraOk,
        },
  };
}

function readBackupJson<T>(backupDir: string, relativePath: string): T | null {
  const filePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}
