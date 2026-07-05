import path from "node:path";

export type BackupScopedGateReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
};

export type FreshBackupScopedReportOptions = {
  relativePath: string;
  report: BackupScopedGateReport | null;
  backupDir: string;
  maxAgeMs: number;
  nowMs?: number;
  requireOk?: boolean;
};

export function freshBackupScopedReportBlockers(options: FreshBackupScopedReportOptions): string[] {
  const blockers: string[] = [];
  const report = options.report;
  if (!report) return [`${options.relativePath} is missing or unreadable`];

  if (options.requireOk === true && report.ok !== true) blockers.push(`${options.relativePath} is not clean`);

  if (!report.backupDir) {
    blockers.push(`${options.relativePath} has no backupDir`);
  } else if (path.resolve(report.backupDir) !== path.resolve(options.backupDir)) {
    blockers.push(`${options.relativePath} was generated for a different backup directory`);
  }

  if (!report.createdAt) {
    blockers.push(`${options.relativePath} has no createdAt timestamp`);
    return blockers;
  }

  const createdAt = Date.parse(report.createdAt);
  if (!Number.isFinite(createdAt)) {
    blockers.push(`${options.relativePath} has an invalid createdAt timestamp`);
    return blockers;
  }

  if ((options.nowMs ?? Date.now()) - createdAt > options.maxAgeMs) {
    blockers.push(`${options.relativePath} is older than one hour`);
  }

  return blockers;
}
