import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  PROFILE_IMAGES_R2_BUCKET_NAME,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  createHash,
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
  profileImagesR2: ProfileImagesR2BackupReport | null;
  vectorize: VectorizePreImportBackupReport | null;
  error?: string;
};

type ProfileImagesR2BackupReport = {
  createdAt: string;
  backupDir: string;
  bucket: string;
  rows: number;
  backedUp: number;
  failed: number;
  manifestFile: string;
  objectRoot: string;
  objects: Array<{
    key: string;
    file: string;
    bytes: number;
    sha256: string;
    expectedHash: string | null;
    ok: boolean;
    error?: string;
  }>;
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
  let profileImagesR2: ProfileImagesR2BackupReport | null = null;
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
    profileImagesR2 = exportRemoteProfileImagesR2(backupDir);
    if (profileImagesR2.failed > 0) {
      throw new Error(`Profile-image R2 backup failed for ${profileImagesR2.failed} object(s)`);
    }
    vectorize = exportRemoteVectorize(backupDir);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const report: FrozenCloudflareProductionBackupReport = {
    createdAt: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    backupDir,
    ok: !error && writeFreeze?.ok === true && Boolean(d1) && Boolean(profileImagesR2) && Boolean(vectorize),
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
    profileImagesR2,
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

function exportRemoteProfileImagesR2(backupDir: string): ProfileImagesR2BackupReport {
  const rows = listProfileImageR2Objects();
  const objectRoot = path.join(cloudflareDir(backupDir), "profile-images-r2", "objects");
  fs.mkdirSync(objectRoot, { recursive: true, mode: 0o700 });
  const objects: ProfileImagesR2BackupReport["objects"] = [];

  for (const row of rows) {
    const relativeFile = path.join("profile-images-r2", "objects", row.key);
    const file = path.join(cloudflareDir(backupDir), relativeFile);
    try {
      if (!isSafeProfileImageKey(row.key)) throw new Error(`unsafe R2 key: ${row.key}`);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      runWrangler([
        "r2",
        "object",
        "get",
        `${PROFILE_IMAGES_R2_BUCKET_NAME}/${row.key}`,
        "--remote",
        "--file",
        file,
      ]);
      const bytes = fs.statSync(file).size;
      const sha256 = createHash().update(fs.readFileSync(file)).digest("hex");
      const ok = row.profileImageHash ? sha256 === row.profileImageHash : true;
      objects.push({
        key: row.key,
        file: relativeFile,
        bytes,
        sha256,
        expectedHash: row.profileImageHash ?? null,
        ok,
        ...(ok ? {} : { error: "sha256 mismatch" }),
      });
    } catch (error) {
      objects.push({
        key: row.key,
        file: relativeFile,
        bytes: 0,
        sha256: "",
        expectedHash: row.profileImageHash ?? null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report: ProfileImagesR2BackupReport = {
    createdAt: new Date().toISOString(),
    backupDir,
    bucket: PROFILE_IMAGES_R2_BUCKET_NAME,
    rows: rows.length,
    backedUp: objects.filter((object) => object.ok).length,
    failed: objects.filter((object) => !object.ok).length,
    manifestFile: "cloudflare/profile-images-r2-backup-report.json",
    objectRoot: "cloudflare/profile-images-r2/objects",
    objects,
  };
  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), "profile-images-r2-backup-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  return report;
}

function listProfileImageR2Objects() {
  const output = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    `select profile_image_r2_key as "key",
            profile_image_hash as "profileImageHash"
       from users
      where profile_image_r2_key is not null
      order by id;`,
  ], { maxBuffer: 128 * 1024 * 1024 });
  return parseJsonFromOutput<Array<{ results?: Array<{ key?: string; profileImageHash?: string }> }>>(output)
    .flatMap((entry) => entry.results ?? [])
    .filter((row): row is { key: string; profileImageHash?: string } => Boolean(row.key));
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

function isSafeProfileImageKey(key: string) {
  return key.startsWith("profile-images/users/") && !key.includes("..") && !key.startsWith("/");
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
    profileImagesR2: report.profileImagesR2
      ? { rows: report.profileImagesR2.rows, backedUp: report.profileImagesR2.backedUp, failed: report.profileImagesR2.failed }
      : null,
    vectorize: report.vectorize ? { file: report.vectorize.file, rows: report.vectorize.rows, sha256: report.vectorize.sha256 } : null,
    error: report.error,
  };
}
