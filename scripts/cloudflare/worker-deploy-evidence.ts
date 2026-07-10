import fs from "node:fs";
import path from "node:path";
import { cloudflareDir } from "./migration-config";
import type { SourceFingerprint } from "./source-fingerprint";

export const WORKER_DEPLOY_REPORT = "cloudflare/worker-deploy-report.json";

export type WorkerDeployEvidenceReport = {
  createdAt: string;
  startedAt: string;
  completedAt: string;
  backupDir: string;
  mode: "opennext-deploy" | "opennext-upload";
  command: string[];
  passthroughArgs: string[];
  ok: boolean;
  status: number | null;
  commandExecuted: boolean;
  deployPreflightOk?: boolean;
  deployPreflightStatus?: number | null;
  resourceBudgetOk?: boolean | null;
  scanBeforeOk: boolean | null;
  scanAfterOk: boolean | null;
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprintAfter: SourceFingerprint;
  sourceFingerprintStable: boolean;
  blockedArgs?: string[];
  error?: string;
};

export function writeWorkerDeployEvidenceReport(report: WorkerDeployEvidenceReport) {
  const outputPath = path.join(cloudflareDir(report.backupDir), path.basename(WORKER_DEPLOY_REPORT));
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
