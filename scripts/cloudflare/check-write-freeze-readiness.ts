import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, resolveBackupDir } from "./migration-config";
import {
  WRITE_FREEZE_READINESS_REPORT,
  buildWriteFreezeReadinessReport,
} from "./write-freeze-evidence";

const backupDir = resolveBackupDir();
const outputPath = path.join(backupDir, WRITE_FREEZE_READINESS_REPORT);

void main().catch((error) => {
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});

async function main() {
  const report = await buildWriteFreezeReadinessReport(backupDir, { env: process.env });
  fs.mkdirSync(cloudflareDir(backupDir), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
