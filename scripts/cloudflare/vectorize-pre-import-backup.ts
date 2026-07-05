import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stableStringify } from "./migration-config";

export const VECTORIZE_PRE_IMPORT_BACKUP_NDJSON = "cloudflare/vectorize-pre-import-backup.ndjson";
export const VECTORIZE_PRE_IMPORT_BACKUP_REPORT = "cloudflare/vectorize-pre-import-backup-report.json";
const VECTORIZE_DIMENSIONS = 512;

export type VectorizePreImportBackupReport = {
  createdAt?: string;
  backupDir?: string;
  index?: string;
  file?: string;
  rows?: number;
  bytes?: number;
  sha256?: string;
  listedIds?: number;
};

export type VectorizeBackupRow = {
  id?: string;
  namespace?: string;
  values?: unknown;
  metadata?: Record<string, unknown>;
};

export function vectorizePreImportBackupNdjsonPath(backupDir: string) {
  return path.join(backupDir, VECTORIZE_PRE_IMPORT_BACKUP_NDJSON);
}

export function vectorizePreImportBackupReportPath(backupDir: string) {
  return path.join(backupDir, VECTORIZE_PRE_IMPORT_BACKUP_REPORT);
}

export function writeVectorizePreImportBackup(input: {
  backupDir: string;
  index: string;
  listedIds: number;
  rows: VectorizeBackupRow[];
}): Required<VectorizePreImportBackupReport> {
  const rowProblems = vectorizeBackupRowProblems(input.rows);
  if (rowProblems.length) {
    throw new Error(`Refusing to write invalid Vectorize pre-import backup: ${rowProblems.join("; ")}`);
  }
  const sortedRows = [...input.rows].sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? "")));
  const filePath = vectorizePreImportBackupNdjsonPath(input.backupDir);
  fs.writeFileSync(filePath, sortedRows.map((row) => stableStringify(row)).join("\n") + (sortedRows.length ? "\n" : ""), {
    mode: 0o600,
  });
  const report = buildVectorizePreImportBackupReport({
    backupDir: input.backupDir,
    index: input.index,
    listedIds: input.listedIds,
  });
  writeVectorizePreImportBackupReport(report, input.backupDir);
  return report;
}

export function buildVectorizePreImportBackupReport(input: {
  backupDir: string;
  index: string;
  listedIds: number;
}): Required<VectorizePreImportBackupReport> {
  const filePath = vectorizePreImportBackupNdjsonPath(input.backupDir);
  if (!fs.existsSync(filePath)) throw new Error(`Missing Vectorize pre-import backup: ${filePath}`);
  const content = fs.readFileSync(filePath);
  const rows = countNdjsonRows(content.toString("utf8"));
  return {
    createdAt: new Date().toISOString(),
    backupDir: input.backupDir,
    index: input.index,
    file: VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
    rows,
    bytes: content.byteLength,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    listedIds: input.listedIds,
  };
}

export function writeVectorizePreImportBackupReport(report: VectorizePreImportBackupReport, backupDir: string) {
  fs.writeFileSync(vectorizePreImportBackupReportPath(backupDir), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

export function checkVectorizePreImportBackup(input: {
  backupDir: string;
  index: string;
  report: VectorizePreImportBackupReport | null;
  importRunReport?: VectorizePreImportBackupReport;
  maxAgeMs?: number;
  nowMs?: number;
}) {
  const absolutePath = vectorizePreImportBackupNdjsonPath(input.backupDir);
  const fileExists = fs.existsSync(absolutePath);
  const content = fileExists ? fs.readFileSync(absolutePath) : Buffer.alloc(0);
  const fileRows = fileExists ? countNdjsonRows(content.toString("utf8")) : 0;
  const fileBytes = fileExists ? content.byteLength : 0;
  const fileSha256 = fileExists ? crypto.createHash("sha256").update(content).digest("hex") : "";
  const rowProblems = fileExists ? vectorizeBackupRowProblems(parseBackupRows(content.toString("utf8"))) : [];
  const reportBackupDirOk = path.resolve(input.report?.backupDir ?? "") === path.resolve(input.backupDir);
  const reportTimestamp = timestampCheck(input.report?.createdAt, input.nowMs, input.maxAgeMs);
  const importRunBackupMatchesReport =
    Boolean(input.importRunReport) &&
    Boolean(input.report) &&
    input.importRunReport?.createdAt === input.report?.createdAt &&
    path.resolve(input.importRunReport?.backupDir ?? "") === path.resolve(input.report?.backupDir ?? "") &&
    input.importRunReport?.index === input.report?.index &&
    input.importRunReport?.file === input.report?.file &&
    input.importRunReport?.rows === input.report?.rows &&
    input.importRunReport?.bytes === input.report?.bytes &&
    input.importRunReport?.sha256 === input.report?.sha256 &&
    input.importRunReport?.listedIds === input.report?.listedIds;
  const ok =
    Boolean(input.report) &&
    fileExists &&
    reportTimestamp.ok &&
    input.report?.index === input.index &&
    input.report.file === VECTORIZE_PRE_IMPORT_BACKUP_NDJSON &&
    reportBackupDirOk &&
    input.report.rows === fileRows &&
    input.report.bytes === fileBytes &&
    input.report.sha256 === fileSha256 &&
    input.report.listedIds === fileRows &&
    rowProblems.length === 0 &&
    importRunBackupMatchesReport;

  return {
    ok,
    detail: {
      report: VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
      file: VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
      fileExists,
      fileRows,
      fileBytes,
      fileSha256,
      reportRows: input.report?.rows,
      reportBytes: input.report?.bytes,
      reportSha256: input.report?.sha256,
      indexOk: input.report?.index === input.index,
      backupDirOk: reportBackupDirOk,
      reportCreatedAt: input.report?.createdAt,
      reportFresh: reportTimestamp.fresh,
      reportAgeMs: reportTimestamp.ageMs,
      maxAgeMs: input.maxAgeMs,
      listedIdsMatchRows: input.report?.listedIds === fileRows,
      rowProblems,
      importRunBackupMatchesReport,
    },
  };
}

function countNdjsonRows(content: string) {
  return content.split(/\r?\n/).filter((line) => line.trim()).length;
}

function parseBackupRows(content: string) {
  const rows: VectorizeBackupRow[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as VectorizeBackupRow);
    } catch {
      rows.push({ id: `__invalid_json_line_${index + 1}` });
    }
  }
  return rows;
}

export function vectorizeBackupRowProblems(rows: VectorizeBackupRow[], dimensions = VECTORIZE_DIMENSIONS) {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  rows.forEach((row, index) => {
    const label = `row ${index + 1}`;
    if (!row.id || typeof row.id !== "string" || !row.id.trim()) {
      problems.push(`${label}: missing id`);
    } else if (seenIds.has(row.id)) {
      problems.push(`${label}: duplicate id ${row.id}`);
    } else {
      seenIds.add(row.id);
    }

    if (!Array.isArray(row.values)) {
      problems.push(`${label}: missing values`);
    } else if (row.values.length !== dimensions) {
      problems.push(`${label}: values length is ${row.values.length}`);
    } else if (row.values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      problems.push(`${label}: values include non-finite numbers`);
    }

    if (row.metadata === undefined) {
      problems.push(`${label}: missing metadata`);
    } else if (row.metadata === null || typeof row.metadata !== "object" || Array.isArray(row.metadata)) {
      problems.push(`${label}: metadata must be an object`);
    }
  });
  return problems;
}

function timestampCheck(createdAt: string | undefined, nowMs = Date.now(), maxAgeMs?: number) {
  if (!createdAt) return { ok: false, fresh: false, ageMs: null };
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return { ok: false, fresh: false, ageMs: null };
  const ageMs = nowMs - parsed;
  const fresh = ageMs >= 0 && (maxAgeMs === undefined || ageMs <= maxAgeMs);
  return { ok: fresh, fresh, ageMs };
}
