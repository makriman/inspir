import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, hasFlag, resolveBackupDir } from "./migration-config";

export type BackupPermissionsReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  dryRun: boolean;
  desiredFileMode: string;
  desiredDirectoryMode: string;
  checkedFiles: number;
  checkedDirectories: number;
  changedFiles: number;
  changedDirectories: number;
  symlinks: string[];
  problems: Array<{ path: string; problem: string; mode?: string }>;
};

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const dryRun = hasFlag("--check");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backupDir = resolveBackupDir();
  const report = hardenBackupPermissions(backupDir, { dryRun });
  const reportPath = path.join(cloudflareDir(backupDir), "backup-permissions-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: FILE_MODE });
  fs.chmodSync(reportPath, FILE_MODE);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function hardenBackupPermissions(backupDir: string, options: { dryRun?: boolean } = {}): BackupPermissionsReport {
  const absoluteBackupDir = path.resolve(backupDir);
  const report: BackupPermissionsReport = {
    createdAt: new Date().toISOString(),
    backupDir: absoluteBackupDir,
    ok: true,
    dryRun: options.dryRun === true,
    desiredFileMode: modeString(FILE_MODE),
    desiredDirectoryMode: modeString(DIRECTORY_MODE),
    checkedFiles: 0,
    checkedDirectories: 0,
    changedFiles: 0,
    changedDirectories: 0,
    symlinks: [],
    problems: [],
  };

  visit(absoluteBackupDir, absoluteBackupDir, report);
  report.ok = report.problems.length === 0 && report.symlinks.length === 0;
  return report;
}

function visit(root: string, currentPath: string, report: BackupPermissionsReport) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(currentPath);
  } catch (error) {
    report.problems.push({ path: relative(root, currentPath), problem: error instanceof Error ? error.message : String(error) });
    return;
  }

  if (stat.isSymbolicLink()) {
    report.symlinks.push(relative(root, currentPath));
    return;
  }

  if (stat.isDirectory()) {
    report.checkedDirectories += 1;
    hardenPath(root, currentPath, DIRECTORY_MODE, "directory", report);
    for (const entry of fs.readdirSync(currentPath)) visit(root, path.join(currentPath, entry), report);
    return;
  }

  if (stat.isFile()) {
    report.checkedFiles += 1;
    hardenPath(root, currentPath, FILE_MODE, "file", report);
  }
}

function hardenPath(
  root: string,
  targetPath: string,
  desiredMode: number,
  kind: "file" | "directory",
  report: BackupPermissionsReport,
) {
  const before = safeMode(targetPath);
  if (before === null) {
    report.problems.push({ path: relative(root, targetPath), problem: "could not read mode" });
    return;
  }

  if (before !== desiredMode) {
    if (!report.dryRun) {
      try {
        fs.chmodSync(targetPath, desiredMode);
      } catch (error) {
        report.problems.push({
          path: relative(root, targetPath),
          problem: error instanceof Error ? error.message : String(error),
          mode: modeString(before),
        });
        return;
      }
    }
    if (kind === "file") report.changedFiles += 1;
    else report.changedDirectories += 1;
  }

  const after = report.dryRun ? before : safeMode(targetPath);
  if (after !== desiredMode) {
    report.problems.push({
      path: relative(root, targetPath),
      problem: `mode is ${modeString(after ?? 0)} instead of ${modeString(desiredMode)}`,
      mode: modeString(after ?? 0),
    });
  }
}

function safeMode(targetPath: string) {
  try {
    return fs.lstatSync(targetPath).mode & 0o777;
  } catch {
    return null;
  }
}

function relative(root: string, targetPath: string) {
  const rel = path.relative(root, targetPath).split(path.sep).join("/");
  return rel || ".";
}

function modeString(mode: number) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}
