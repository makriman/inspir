import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  resolveBackupDir,
  runWrangler,
} from "./migration-config";
import {
  buildD1PreImportBackupReport,
  d1PreImportBackupSqlPath,
  writeD1PreImportBackupReport,
  type D1PreImportBackupReport,
} from "./d1-pre-import-backup";
import {
  writeVectorizePreImportBackup,
  type VectorizeBackupRow,
  type VectorizePreImportBackupReport,
} from "./vectorize-pre-import-backup";
import { writeWriteFreezeEvidenceReport, type WriteFreezeEvidenceReport } from "./write-freeze-evidence";

export const FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT = "cloudflare/frozen-cloudflare-production-backup-report.json";

type FrozenCloudflareProductionBackupReport = {
  createdAt: string;
  startedAt: string;
  completedAt: string;
  backupDir: string;
  ok: boolean;
  confirmations: Record<string, boolean>;
  writeFreeze: WriteFreezeEvidenceReport;
  d1: D1PreImportBackupReport | null;
  vectorize: VectorizePreImportBackupReport | null;
  error?: string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void backupFrozenCloudflareProduction().then((report) => {
    if (!report.ok) process.exitCode = 1;
  });
}

export async function backupFrozenCloudflareProduction(options: { backupDir?: string; env?: NodeJS.ProcessEnv } = {}) {
  const backupDir = options.backupDir ?? resolveBackupDir();
  const env = options.env ?? process.env;
  const startedAt = new Date().toISOString();
  let writeFreeze: WriteFreezeEvidenceReport | null = null;
  let d1: D1PreImportBackupReport | null = null;
  let vectorize: VectorizePreImportBackupReport | null = null;
  let error: string | undefined;

  try {
    const confirmationProblems = frozenBackupConfirmationProblems(backupDir, env);
    if (confirmationProblems.length) throw new Error(`Missing frozen Cloudflare backup confirmations: ${confirmationProblems.join(", ")}`);

    writeFreeze = await writeWriteFreezeEvidenceReport(backupDir, {
      finalBackup: true,
      env,
    });
    if (!writeFreeze.ok) throw new Error(`Write-freeze evidence is not clean: ${writeFreeze.problems.join("; ")}`);

    d1 = exportRemoteD1(backupDir);
    vectorize = exportRemoteVectorize(backupDir);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const report: FrozenCloudflareProductionBackupReport = {
    createdAt: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    backupDir,
    ok: !error && writeFreeze?.ok === true && Boolean(d1) && Boolean(vectorize),
    confirmations: frozenBackupConfirmations(backupDir, env),
    writeFreeze: writeFreeze ?? {
      createdAt: new Date().toISOString(),
      backupDir,
      ok: false,
      finalBackup: true,
      confirmations: {
        writeFreezeConfirmed: env.CONFIRM_WRITE_FREEZE === "1",
        finalBackupConfirmed: env.CONFIRM_FINAL_BACKUP === "1",
        frozenSourceConfirmed: env.CONFIRM_BACKUP_SOURCE_WRITES_FROZEN === "1",
      },
      probe: { required: true, attempted: false, ok: false },
      externalFreeze: { required: false, confirmed: false, ok: null, problems: [] },
      problems: ["write-freeze evidence was not created"],
    },
    d1,
    vectorize,
    error,
  };
  writeReport(backupDir, report);
  console.log(JSON.stringify(compactReport(report), null, 2));
  return report;
}

function exportRemoteD1(backupDir: string) {
  const outputPath = d1PreImportBackupSqlPath(backupDir);
  fs.rmSync(outputPath, { force: true });
  const output = runWrangler(["d1", "export", D1_DATABASE_NAME, "--remote", "--output", outputPath], {
    maxBuffer: 128 * 1024 * 1024,
  });
  const report = buildD1PreImportBackupReport({
    backupDir,
    database: D1_DATABASE_NAME,
    databaseId: D1_DATABASE_ID,
    wranglerOutputExcerpt: output.slice(0, 2000),
  });
  writeD1PreImportBackupReport(report, backupDir);
  return report;
}

function exportRemoteVectorize(backupDir: string) {
  const listed = listAllVectorIds();
  const ids = [...listed.ids].sort();
  const rows: VectorizeBackupRow[] = [];
  for (let index = 0; index < ids.length; index += 20) {
    const batchIds = ids.slice(index, index + 20);
    if (!batchIds.length) continue;
    const output = runWrangler(["vectorize", "get-vectors", VECTORIZE_INDEX_NAME, "--ids", ...batchIds], {
      maxBuffer: 128 * 1024 * 1024,
    });
    rows.push(...parseJsonFromOutput<VectorizeBackupRow[]>(output));
  }
  const report = writeVectorizePreImportBackup({
    backupDir,
    index: VECTORIZE_INDEX_NAME,
    listedIds: ids.length,
    rows,
  });
  if (report.rows !== ids.length) {
    throw new Error(`Vectorize backup row count mismatch: listed ${ids.length}, fetched ${report.rows}`);
  }
  return report;
}

function listAllVectorIds() {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const args = ["vectorize", "list-vectors", VECTORIZE_INDEX_NAME, "--count", "1000", "--json"];
    if (cursor) args.push("--cursor", cursor);
    const page = JSON.parse(runWrangler(args)) as {
      vectors?: Array<{ id?: string } | string>;
      isTruncated?: boolean;
      cursor?: string;
    };
    for (const vector of page.vectors ?? []) {
      const id = typeof vector === "string" ? vector : vector.id;
      if (id) ids.add(id);
    }
    if (!page.isTruncated || !page.cursor) return { ids };
    cursor = page.cursor;
  }
}

function parseJsonFromOutput<T>(output: string): T {
  const trimmed = output.trim();
  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0);
  const firstJson = Math.min(...starts);
  if (!Number.isFinite(firstJson)) throw new Error(`Could not find JSON in Wrangler output: ${output.slice(0, 400)}`);
  return JSON.parse(trimmed.slice(firstJson)) as T;
}

function frozenBackupConfirmations(backupDir: string, env: NodeJS.ProcessEnv) {
  return {
    confirmWriteFreeze: env.CONFIRM_WRITE_FREEZE === "1",
    confirmFinalBackup: env.CONFIRM_FINAL_BACKUP === "1",
    confirmFrozenSource: env.CONFIRM_BACKUP_SOURCE_WRITES_FROZEN === "1",
    confirmBackupDir: env.CONFIRM_BACKUP_DIR === backupDir,
  };
}

function frozenBackupConfirmationProblems(backupDir: string, env: NodeJS.ProcessEnv) {
  const confirmations = frozenBackupConfirmations(backupDir, env);
  const problems: string[] = [];
  if (!confirmations.confirmWriteFreeze) problems.push("CONFIRM_WRITE_FREEZE=1");
  if (!confirmations.confirmFinalBackup) problems.push("CONFIRM_FINAL_BACKUP=1");
  if (!confirmations.confirmFrozenSource) problems.push("CONFIRM_BACKUP_SOURCE_WRITES_FROZEN=1");
  if (!confirmations.confirmBackupDir) problems.push(`CONFIRM_BACKUP_DIR=${backupDir}`);
  return problems;
}

function writeReport(backupDir: string, report: FrozenCloudflareProductionBackupReport) {
  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), path.basename(FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT)),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function compactReport(report: FrozenCloudflareProductionBackupReport) {
  return {
    createdAt: report.createdAt,
    backupDir: report.backupDir,
    ok: report.ok,
    writeFreezeActive: report.writeFreeze.probe.writeFreezeActive ?? null,
    d1: report.d1 ? { file: report.d1.file, bytes: report.d1.bytes, sha256: report.d1.sha256 } : null,
    vectorize: report.vectorize ? { file: report.vectorize.file, rows: report.vectorize.rows, sha256: report.vectorize.sha256 } : null,
    error: report.error,
  };
}
