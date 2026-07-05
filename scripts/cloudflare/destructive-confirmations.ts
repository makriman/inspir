import path from "node:path";

export function backupDirConfirmationBlocker(backupDir: string) {
  const confirmed = process.env.CONFIRM_BACKUP_DIR;
  if (!confirmed) return "Missing CONFIRM_BACKUP_DIR";
  if (path.resolve(confirmed) !== path.resolve(backupDir)) return "CONFIRM_BACKUP_DIR does not match the active backup directory";
  return null;
}

