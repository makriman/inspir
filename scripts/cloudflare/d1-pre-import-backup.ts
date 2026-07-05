import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const D1_PRE_IMPORT_BACKUP_SQL = "cloudflare/d1-pre-import-backup.sql";
const D1_PRE_IMPORT_BACKUP_REPORT = "cloudflare/d1-pre-import-backup-report.json";

export type D1PreImportBackupReport = {
  createdAt?: string;
  backupDir?: string;
  database?: string;
  databaseId?: string;
  file?: string;
  bytes?: number;
  sha256?: string;
  wranglerOutputExcerpt?: string;
};

export function d1PreImportBackupSqlPath(backupDir: string) {
  return path.join(backupDir, D1_PRE_IMPORT_BACKUP_SQL);
}

function d1PreImportBackupReportPath(backupDir: string) {
  return path.join(backupDir, D1_PRE_IMPORT_BACKUP_REPORT);
}

export function buildD1PreImportBackupReport(input: {
  backupDir: string;
  database: string;
  databaseId: string;
  wranglerOutputExcerpt: string;
}): Required<D1PreImportBackupReport> {
  const sqlPath = d1PreImportBackupSqlPath(input.backupDir);
  if (!fs.existsSync(sqlPath) || fs.statSync(sqlPath).size === 0) {
    throw new Error(`D1 pre-import backup was not created or is empty: ${sqlPath}`);
  }
  const content = fs.readFileSync(sqlPath);
  return {
    createdAt: new Date().toISOString(),
    backupDir: input.backupDir,
    database: input.database,
    databaseId: input.databaseId,
    file: D1_PRE_IMPORT_BACKUP_SQL,
    bytes: content.byteLength,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    wranglerOutputExcerpt: input.wranglerOutputExcerpt,
  };
}

export function writeD1PreImportBackupReport(report: D1PreImportBackupReport, backupDir: string) {
  fs.writeFileSync(d1PreImportBackupReportPath(backupDir), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

export function checkD1PreImportBackup(input: {
  backupDir: string;
  database: string;
  databaseId: string;
  report: D1PreImportBackupReport | null;
  importRunReport?: D1PreImportBackupReport;
  maxAgeMs?: number;
  nowMs?: number;
}) {
  const absoluteSqlPath = d1PreImportBackupSqlPath(input.backupDir);
  const sqlExists = fs.existsSync(absoluteSqlPath) && fs.statSync(absoluteSqlPath).size > 0;
  const sqlBytes = sqlExists ? fs.statSync(absoluteSqlPath).size : 0;
  const sqlSha256 = sqlExists ? crypto.createHash("sha256").update(fs.readFileSync(absoluteSqlPath)).digest("hex") : "";
  const reportBackupDirOk = path.resolve(input.report?.backupDir ?? "") === path.resolve(input.backupDir);
  const reportTimestamp = timestampCheck(input.report?.createdAt, input.nowMs, input.maxAgeMs);
  const importRunBackupMatchesReport =
    Boolean(input.importRunReport) &&
    Boolean(input.report) &&
    input.importRunReport?.createdAt === input.report?.createdAt &&
    path.resolve(input.importRunReport?.backupDir ?? "") === path.resolve(input.report?.backupDir ?? "") &&
    input.importRunReport?.database === input.report?.database &&
    input.importRunReport?.databaseId === input.report?.databaseId &&
    input.importRunReport?.file === input.report?.file &&
    input.importRunReport?.bytes === input.report?.bytes &&
    input.importRunReport?.sha256 === input.report?.sha256;
  const ok =
    Boolean(input.report) &&
    sqlExists &&
    reportTimestamp.ok &&
    input.report?.database === input.database &&
    input.report?.databaseId === input.databaseId &&
    reportBackupDirOk &&
    input.report?.file === D1_PRE_IMPORT_BACKUP_SQL &&
    input.report.bytes === sqlBytes &&
    input.report.sha256 === sqlSha256 &&
    importRunBackupMatchesReport;
  return {
    ok,
    detail: {
      report: D1_PRE_IMPORT_BACKUP_REPORT,
      file: D1_PRE_IMPORT_BACKUP_SQL,
      sqlExists,
      sqlBytes,
      sqlSha256,
      reportBytes: input.report?.bytes,
      reportSha256: input.report?.sha256,
      databaseOk: input.report?.database === input.database && input.report?.databaseId === input.databaseId,
      backupDirOk: reportBackupDirOk,
      reportCreatedAt: input.report?.createdAt,
      reportFresh: reportTimestamp.fresh,
      reportAgeMs: reportTimestamp.ageMs,
      maxAgeMs: input.maxAgeMs,
      importRunBackupMatchesReport,
    },
  };
}

function timestampCheck(createdAt: string | undefined, nowMs = Date.now(), maxAgeMs?: number) {
  if (!createdAt) return { ok: false, fresh: false, ageMs: null };
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return { ok: false, fresh: false, ageMs: null };
  const ageMs = nowMs - parsed;
  const fresh = ageMs >= 0 && (maxAgeMs === undefined || ageMs <= maxAgeMs);
  return { ok: fresh, fresh, ageMs };
}
