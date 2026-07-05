import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { profileImageObjectKey } from "@/lib/profile/photo-key";
import {
  D1_DATABASE_NAME,
  PROFILE_IMAGES_R2_BUCKET_NAME,
  cloudflareDir,
  resolveBackupDir,
  runWrangler,
} from "./migration-config";

type BackfillMode = "local" | "remote";

type LegacyProfileImageRow = {
  userId: string;
  profileImageData: string;
  profileImageMime: string;
  profileImageHash: string;
};

type ProfileImageBackfillReport = {
  createdAt: string;
  backupDir: string;
  mode: BackfillMode;
  bucket: string;
  database: string;
  dryRun: boolean;
  candidates: number;
  uploaded: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
};

if (isMainModule()) {
  void backfillProfileImagesToR2().then((report) => {
    if (report.failed > 0) process.exitCode = 1;
  });
}

export async function backfillProfileImagesToR2(options: {
  backupDir?: string;
  dryRun?: boolean;
  limit?: number;
  mode?: BackfillMode;
} = {}) {
  const backupDir = options.backupDir ?? resolveBackupDir();
  const mode = options.mode ?? (process.argv.includes("--remote") ? "remote" : "local");
  const dryRun = options.dryRun ?? process.argv.includes("--dry-run");
  const limit = normalizeLimit(options.limit ?? argNumber("--limit", 100));
  const rows = listLegacyProfileImages(mode, limit);
  const report: ProfileImageBackfillReport = {
    createdAt: new Date().toISOString(),
    backupDir,
    mode,
    bucket: PROFILE_IMAGES_R2_BUCKET_NAME,
    database: D1_DATABASE_NAME,
    dryRun,
    candidates: rows.length,
    uploaded: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-profile-images-r2-"));
  try {
    for (const row of rows) {
      try {
        const bytes = Buffer.from(row.profileImageData, "base64");
        const hash = crypto.createHash("sha256").update(bytes).digest("hex");
        if (hash !== row.profileImageHash) {
          throw new Error(`hash mismatch: row=${row.profileImageHash} bytes=${hash}`);
        }
        const key = profileImageObjectKey(row.userId, row.profileImageHash);
        if (!dryRun) {
          const file = path.join(tmpDir, `${row.userId}.image`);
          fs.writeFileSync(file, bytes, { mode: 0o600 });
          runWrangler([
            "r2",
            "object",
            "put",
            `${PROFILE_IMAGES_R2_BUCKET_NAME}/${key}`,
            modeFlag(mode),
            "--file",
            file,
            "--content-type",
            row.profileImageMime,
            "--cache-control",
            "private, max-age=3600",
          ]);
          report.uploaded += 1;
          const updated = markBackfilled(mode, row, key, bytes.byteLength);
          if (updated) report.updated += 1;
          else report.skipped += 1;
          fs.rmSync(file, { force: true });
        }
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          userId: row.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function listLegacyProfileImages(mode: BackfillMode, limit: number) {
  const output = runWrangler(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      modeFlag(mode),
      "--json",
      "--command",
      `select id as "userId",
              profile_image_data as "profileImageData",
              profile_image_mime as "profileImageMime",
              profile_image_hash as "profileImageHash"
         from users
        where profile_image_data is not null
          and profile_image_mime is not null
          and profile_image_hash is not null
          and profile_image_r2_key is null
        limit ${limit};`,
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  const result = parseWranglerD1Json<LegacyProfileImageRow>(output);
  return result.filter((row) => row.userId && row.profileImageData && row.profileImageMime && row.profileImageHash);
}

function markBackfilled(mode: BackfillMode, row: LegacyProfileImageRow, key: string, size: number) {
  const output = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    modeFlag(mode),
    "--json",
    "--command",
    `update users
        set profile_image_data = null,
            profile_image_r2_key = ${sqlString(key)},
            profile_image_r2_etag = null,
            profile_image_size = ${size},
            profile_picture_downloaded_at = ${Date.now()},
            updated_at = ${Date.now()}
      where id = ${sqlString(row.userId)}
        and profile_image_hash = ${sqlString(row.profileImageHash)}
        and profile_image_data is not null
        and profile_image_r2_key is null
      returning id;`,
  ]);
  return parseWranglerD1Json<{ id: string }>(output).length > 0;
}

function parseWranglerD1Json<Row>(output: string) {
  const parsed = parseJsonFromOutput<Array<{ results?: Row[] }>>(output, []);
  return parsed.flatMap((entry) => entry.results ?? []);
}

function parseJsonFromOutput<T>(output: string, fallback: T): T {
  const trimmed = output.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const first =
      firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
    const last = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (first === -1 || last === -1 || last <= first) return fallback;
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  }
}

function modeFlag(mode: BackfillMode) {
  return mode === "remote" ? "--remote" : "--local";
}

function normalizeLimit(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 100;
  return Math.min(1000, Math.floor(value));
}

function argNumber(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function writeReport(report: ProfileImageBackfillReport) {
  const file = path.join(cloudflareDir(report.backupDir), `profile-images-r2-backfill-${report.mode}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
