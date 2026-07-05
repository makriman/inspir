import fs from "node:fs";
import path from "node:path";
import { D1_SIZE_SAFETY_REPORT, type D1SizeSafetyReport } from "./d1-size-safety";
import { D1_TRANSFORM_FIDELITY_REPORT, type D1TransformFidelityReport } from "./d1-transform-fidelity";
import { checkFreshVerifiedEvidenceManifest } from "./evidence-verification-gate";
import { freshBackupScopedReportBlockers } from "./fresh-report-gate";
import {
  TABLE_ORDER,
  TIMESTAMP_PRECISION_RELATIVE_PATH,
  cloudflareDir,
  transformedTablePath,
  vectorizeManifestPath,
  vectorizeNdjsonPath,
} from "./migration-config";
import {
  buildD1ArtifactFingerprint,
  buildVectorizeArtifactFingerprint,
  type MigrationArtifactFingerprint,
  type VectorizeArtifactFingerprint,
} from "./migration-artifact-fingerprint";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import { SOURCE_TABLE_COVERAGE_REPORT, type SourceTableCoverageReport } from "./source-table-coverage";
import type { RuntimeProviderScanReport } from "./scan-runtime-providers";
import {
  WRITE_FREEZE_REPORT,
  requiredWriteFreezeEvidenceFiles,
  validateFinalWriteFreezeEvidenceReport,
  type WriteFreezeEvidenceReport,
} from "./write-freeze-evidence";

export const IMPORT_PREREQUISITE_MAX_AGE_MS = 60 * 60 * 1000;

export type ImportPrerequisiteKind = "d1" | "vectorize";

export type ImportPrerequisiteCheck = {
  name: string;
  status: "pass" | "fail";
  blockers: string[];
  detail?: unknown;
};

export type ImportPrerequisiteReport = {
  createdAt: string;
  backupDir: string;
  kind: ImportPrerequisiteKind;
  ok: boolean;
  checks: ImportPrerequisiteCheck[];
  blockers: string[];
  requiredEvidenceFiles: string[];
  artifactFingerprint?: MigrationArtifactFingerprint | VectorizeArtifactFingerprint;
};

type LocalD1RehearsalReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  quickCheck?: Array<{ quick_check?: string }>;
  foreignKeyCheck?: unknown[];
  tables?: Array<{ ok?: boolean }>;
  timestampPrecision?: { ok?: boolean };
};

type LocalVectorizeRehearsalReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  failedChecks?: number;
  artifact?: {
    rows?: number;
    sha256?: string;
  };
  manifest?: {
    rows?: number;
    sha256?: string;
  };
};

export function assertImportPrerequisites(options: {
  backupDir: string;
  kind: ImportPrerequisiteKind;
  nowMs?: number;
}): ImportPrerequisiteReport {
  const report = buildImportPrerequisiteReport(options);
  writeImportPrerequisiteReport(report);
  if (!report.ok) {
    throw new Error(`Refusing remote ${options.kind} import because ${report.blockers.join("; ")}.`);
  }
  return report;
}

export function buildImportPrerequisiteReport(options: {
  backupDir: string;
  kind: ImportPrerequisiteKind;
  nowMs?: number;
}): ImportPrerequisiteReport {
  const checks: ImportPrerequisiteCheck[] = [];
  const requiredEvidenceFiles = requiredEvidenceFilesFor(options.kind, options.backupDir);
  const artifactFingerprint = buildArtifactFingerprintCheck(options.backupDir, options.kind, checks);

  checks.push(writeFreezeCheck(options.backupDir, options.nowMs));
  checks.push(evidenceManifestCheck(options.backupDir, requiredEvidenceFiles));
  checks.push(runtimeProviderScanCheck(options.backupDir, options.nowMs));

  if (options.kind === "d1") {
    checks.push(sourceTableCoverageCheck(options.backupDir, options.nowMs));
    checks.push(d1TransformFidelityCheck(options.backupDir, options.nowMs));
    checks.push(d1SizeSafetyCheck(options.backupDir, options.nowMs));
    checks.push(localD1RehearsalCheck(options.backupDir, options.nowMs));
  } else {
    checks.push(localVectorizeRehearsalCheck(options.backupDir, artifactFingerprint as VectorizeArtifactFingerprint | undefined, options.nowMs));
  }

  const blockers = checks.flatMap((check) => check.blockers);
  return {
    createdAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    backupDir: options.backupDir,
    kind: options.kind,
    ok: blockers.length === 0,
    checks,
    blockers,
    requiredEvidenceFiles,
    artifactFingerprint,
  };
}

function writeFreezeCheck(backupDir: string, nowMs?: number): ImportPrerequisiteCheck {
  const relativePath = WRITE_FREEZE_REPORT;
  const report = readJson<WriteFreezeEvidenceReport>(backupDir, relativePath);
  const validation = validateFinalWriteFreezeEvidenceReport(report, {
    backupDir,
    maxAgeMs: IMPORT_PREREQUISITE_MAX_AGE_MS,
    nowMs,
  });
  return check("final write-freeze evidence", validation.blockers, {
    report: relativePath,
    ...validation.detail,
  });
}

function evidenceManifestCheck(backupDir: string, requiredFiles: string[]): ImportPrerequisiteCheck {
  const verification = checkFreshVerifiedEvidenceManifest(backupDir, IMPORT_PREREQUISITE_MAX_AGE_MS, {
    requiredFiles,
  });
  return check("fresh verified evidence manifest", verification.blockers, verification.detail);
}

function runtimeProviderScanCheck(backupDir: string, nowMs?: number): ImportPrerequisiteCheck {
  const relativePath = "cloudflare/runtime-provider-scan-report.json";
  const report = readJson<RuntimeProviderScanReport>(backupDir, relativePath);
  const blockers = freshBackupScopedReportBlockers({
    relativePath,
    report,
    backupDir,
    maxAgeMs: IMPORT_PREREQUISITE_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report?.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const findings = report?.findings?.length ?? 0;
  const scannedFiles = report?.scannedFiles?.length ?? 0;
  if (report) {
    if (!sourceFingerprintOk) blockers.push(`${relativePath} was generated from a different source fingerprint`);
    if (findings > 0) blockers.push(`${relativePath} has runtime retired-provider findings`);
    if (scannedFiles === 0) blockers.push(`${relativePath} scanned no runtime files`);
  }
  return check("runtime provider dependency scan", blockers, {
    report: relativePath,
    sourceFingerprintOk,
    scannedFiles,
    findings,
  });
}

function sourceTableCoverageCheck(backupDir: string, nowMs?: number): ImportPrerequisiteCheck {
  const report = readJson<SourceTableCoverageReport>(backupDir, SOURCE_TABLE_COVERAGE_REPORT);
  const blockers = freshBackupScopedReportBlockers({
    relativePath: SOURCE_TABLE_COVERAGE_REPORT,
    report,
    backupDir,
    maxAgeMs: IMPORT_PREREQUISITE_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  if (report) {
    if (report.expectedTables?.length !== TABLE_ORDER.length) blockers.push(`${SOURCE_TABLE_COVERAGE_REPORT} has incomplete expected table coverage`);
    if ((report.unexpectedTables?.length ?? 0) > 0) blockers.push(`${SOURCE_TABLE_COVERAGE_REPORT} has unexpected public tables`);
    if ((report.missingCanonicalExports?.length ?? 0) > 0) blockers.push(`${SOURCE_TABLE_COVERAGE_REPORT} is missing canonical exports`);
    if ((report.missingTransformedExports?.length ?? 0) > 0) blockers.push(`${SOURCE_TABLE_COVERAGE_REPORT} is missing transformed exports`);
  }
  return check("source table coverage", blockers, { report: SOURCE_TABLE_COVERAGE_REPORT });
}

function d1TransformFidelityCheck(backupDir: string, nowMs?: number): ImportPrerequisiteCheck {
  const report = readJson<D1TransformFidelityReport>(backupDir, D1_TRANSFORM_FIDELITY_REPORT);
  const blockers = freshBackupScopedReportBlockers({
    relativePath: D1_TRANSFORM_FIDELITY_REPORT,
    report,
    backupDir,
    maxAgeMs: IMPORT_PREREQUISITE_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  if (report) {
    const badTables = (report.tables ?? []).filter((table) => table.ok !== true);
    if (report.tables?.length !== TABLE_ORDER.length) blockers.push(`${D1_TRANSFORM_FIDELITY_REPORT} has incomplete table coverage`);
    if (badTables.length) blockers.push(`${D1_TRANSFORM_FIDELITY_REPORT} has lossy transformed rows`);
    if (report.timestampPrecisionArtifact?.file !== TIMESTAMP_PRECISION_RELATIVE_PATH) {
      blockers.push(`${D1_TRANSFORM_FIDELITY_REPORT} points at an unexpected timestamp precision artifact`);
    }
  }
  return check("D1 transform fidelity", blockers, { report: D1_TRANSFORM_FIDELITY_REPORT });
}

function d1SizeSafetyCheck(backupDir: string, nowMs?: number): ImportPrerequisiteCheck {
  const report = readJson<D1SizeSafetyReport>(backupDir, D1_SIZE_SAFETY_REPORT);
  const blockers = freshBackupScopedReportBlockers({
    relativePath: D1_SIZE_SAFETY_REPORT,
    report,
    backupDir,
    maxAgeMs: IMPORT_PREREQUISITE_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  if (report) {
    if (report.tables?.length !== TABLE_ORDER.length) blockers.push(`${D1_SIZE_SAFETY_REPORT} has incomplete table coverage`);
    if ((report.tables ?? []).some((table) => table.ok !== true)) blockers.push(`${D1_SIZE_SAFETY_REPORT} has tables outside D1 limits`);
  }
  return check("D1 size safety", blockers, { report: D1_SIZE_SAFETY_REPORT });
}

function localD1RehearsalCheck(backupDir: string, nowMs?: number): ImportPrerequisiteCheck {
  const relativePath = "cloudflare/d1-local-rehearsal-report.json";
  const report = readJson<LocalD1RehearsalReport>(backupDir, relativePath);
  const blockers = freshBackupScopedReportBlockers({
    relativePath,
    report,
    backupDir,
    maxAgeMs: IMPORT_PREREQUISITE_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  if (report) {
    if (report.quickCheck?.[0]?.quick_check !== "ok") blockers.push(`${relativePath} did not pass PRAGMA quick_check`);
    if ((report.foreignKeyCheck?.length ?? 0) > 0) blockers.push(`${relativePath} has foreign-key problems`);
    if (report.tables?.length !== TABLE_ORDER.length) blockers.push(`${relativePath} has incomplete table coverage`);
    if ((report.tables ?? []).some((table) => table.ok !== true)) blockers.push(`${relativePath} has table checksum mismatches`);
    if (report.timestampPrecision?.ok !== true) blockers.push(`${relativePath} did not validate timestamp precision rows`);
  }
  return check("local D1 rehearsal", blockers, { report: relativePath });
}

function localVectorizeRehearsalCheck(
  backupDir: string,
  artifactFingerprint: VectorizeArtifactFingerprint | undefined,
  nowMs?: number,
): ImportPrerequisiteCheck {
  const relativePath = "cloudflare/vectorize-local-rehearsal-report.json";
  const report = readJson<LocalVectorizeRehearsalReport>(backupDir, relativePath);
  const manifest = readJson<{ rows?: number; sha256?: string }>(backupDir, "cloudflare/vectorize-manifest.json");
  const blockers = freshBackupScopedReportBlockers({
    relativePath,
    report,
    backupDir,
    maxAgeMs: IMPORT_PREREQUISITE_MAX_AGE_MS,
    nowMs,
    requireOk: true,
  });
  if (report) {
    if ((report.failedChecks ?? 0) !== 0) blockers.push(`${relativePath} has failed Vectorize rehearsal checks`);
    if (report.artifact?.rows !== manifest?.rows) blockers.push(`${relativePath} artifact row count differs from manifest`);
    if (report.artifact?.sha256 !== manifest?.sha256) blockers.push(`${relativePath} artifact checksum differs from manifest`);
    if (artifactFingerprint && artifactFingerprint.artifactSha256 !== manifest?.sha256) {
      blockers.push("current Vectorize artifact checksum differs from vectorize-manifest.json");
    }
  }
  return check("local Vectorize rehearsal", blockers, { report: relativePath });
}

function buildArtifactFingerprintCheck(
  backupDir: string,
  kind: ImportPrerequisiteKind,
  checks: ImportPrerequisiteCheck[],
): MigrationArtifactFingerprint | VectorizeArtifactFingerprint | undefined {
  try {
    const artifactFingerprint = kind === "d1" ? buildD1ArtifactFingerprint(backupDir) : buildVectorizeArtifactFingerprint(backupDir);
    checks.push(
      check("current import artifact fingerprint", [], {
        sha256: artifactFingerprint.sha256,
        files: artifactFingerprint.files.length,
      }),
    );
    return artifactFingerprint;
  } catch (error) {
    checks.push(
      check("current import artifact fingerprint", [error instanceof Error ? error.message : String(error)], {
        kind,
      }),
    );
    return undefined;
  }
}

function requiredEvidenceFilesFor(kind: ImportPrerequisiteKind, backupDir: string) {
  const common = [...requiredWriteFreezeEvidenceFiles(backupDir), "cloudflare/runtime-provider-scan-report.json"];
  if (kind === "d1") {
    return [
      ...common,
      SOURCE_TABLE_COVERAGE_REPORT,
      D1_TRANSFORM_FIDELITY_REPORT,
      D1_SIZE_SAFETY_REPORT,
      "cloudflare/d1-local-rehearsal-report.json",
      "cloudflare/d1-import-manifest.json",
      TIMESTAMP_PRECISION_RELATIVE_PATH,
      ...TABLE_ORDER.map((table) => path.relative(backupDir, transformedTablePath(backupDir, table))),
    ];
  }
  return [
    ...common,
    "cloudflare/vectorize-local-rehearsal-report.json",
    path.relative(backupDir, vectorizeManifestPath(backupDir)),
    path.relative(backupDir, vectorizeNdjsonPath(backupDir)),
    "supabase/user_memories-vectors.ndjson",
    "supabase/chat_memory_summaries-vectors.ndjson",
    "supabase/chat_memory_turns-vectors.ndjson",
  ];
}

function writeImportPrerequisiteReport(report: ImportPrerequisiteReport) {
  fs.writeFileSync(reportPath(report.backupDir, report.kind), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function reportPath(backupDir: string, kind: ImportPrerequisiteKind) {
  return path.join(cloudflareDir(backupDir), `import-prerequisites-${kind}-report.json`);
}

function check(name: string, blockers: string[], detail?: unknown): ImportPrerequisiteCheck {
  return {
    name,
    status: blockers.length ? "fail" : "pass",
    blockers,
    detail,
  };
}

function readJson<T>(backupDir: string, relativePath: string): T | null {
  const filePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}
