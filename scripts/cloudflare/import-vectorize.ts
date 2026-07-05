import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CLOUDFLARE_ACCOUNT_ID,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  hasFlag,
  resolveBackupDir,
  runWrangler,
  stableStringify,
  vectorizeManifestPath,
  vectorizeNdjsonPath,
} from "./migration-config";
import { assertImportPrerequisites } from "./import-prerequisites";
import { buildVectorizeArtifactFingerprint } from "./migration-artifact-fingerprint";
import { remoteVectorRowProblems } from "./vectorize-remote-validation";
import {
  writeVectorizePreImportBackup,
  type VectorizeBackupRow,
  type VectorizePreImportBackupReport,
} from "./vectorize-pre-import-backup";

const backupDir = resolveBackupDir();
const reset = hasFlag("--reset");
const vectorFile = vectorizeNdjsonPath(backupDir);
const manifest = JSON.parse(fs.readFileSync(vectorizeManifestPath(backupDir), "utf8")) as { rows: number; sha256?: string };
const artifactFingerprint = buildVectorizeArtifactFingerprint(backupDir);
const expectedVectors = readExpectedVectors();
const expectedIds = new Set(expectedVectors.keys());
let importStarted = false;
let startedAt = "";
let preImportBackup: VectorizePreImportBackupReport | undefined;

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (importStarted) {
	    writeReport({
	      createdAt: new Date().toISOString(),
	      startedAt,
	      completedAt: new Date().toISOString(),
	      backupDir,
	      index: VECTORIZE_INDEX_NAME,
	      importedFrom: path.relative(backupDir, vectorFile),
	      artifactFingerprint,
	      artifactSha256: artifactFingerprint.artifactSha256,
	      manifestSha256: manifest.sha256,
	      expectedRows: manifest.rows,
	      reset,
	      preImportBackup,
	      ok: false,
	      error: error instanceof Error ? error.message : String(error),
	    });
  }
  process.exitCode = 1;
});

async function main() {
  requireImportConfirmations();
  assertImportPrerequisites({ backupDir, kind: "vectorize" });
  importStarted = true;
  startedAt = new Date().toISOString();
  preImportBackup = exportRemoteVectorsBeforeImport();

  if (reset) resetVectorizeIndex();

  ensureMetadataIndex("userId");
  ensureMetadataIndex("chatId");
  const metadataIndexes = listMetadataIndexes();

  if (manifest.rows > 0) {
    runWrangler(["vectorize", "upsert", VECTORIZE_INDEX_NAME, "--file", vectorFile, "--batch-size", "500", "--json"]);
  }

  const vectorState = waitForVectorImport(expectedIds, reset);
  const remoteVectorChecks = vectorState.ok ? verifyRemoteVectors(expectedVectors) : { ok: false, skipped: true };
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    index: VECTORIZE_INDEX_NAME,
    importedFrom: path.relative(backupDir, vectorFile),
    artifactFingerprint,
    artifactSha256: artifactFingerprint.artifactSha256,
    manifestSha256: manifest.sha256,
    artifactSha256MatchesManifest: artifactFingerprint.artifactSha256 === manifest.sha256,
    expectedRows: manifest.rows,
    reset,
    preImportBackup,
    ok: reset && artifactFingerprint.artifactSha256 === manifest.sha256 && vectorState.ok && remoteVectorChecks.ok,
    startedAt,
    completedAt: new Date().toISOString(),
    missingIds: vectorState.missingIds,
    unexpectedIds: vectorState.unexpectedIds,
    remoteVectorChecks,
    metadataIndexes,
    list: vectorState.list,
    info: vectorState.info,
  };
  writeReport(report);
  if (!report.ok) process.exitCode = 1;
}

function exportRemoteVectorsBeforeImport() {
  const listed = listAllVectorIds();
  const ids = [...listed.ids].sort();
  const rows: VectorizeBackupRow[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batchIds = ids.slice(index, index + 100);
    if (!batchIds.length) continue;
    const output = runWrangler(["vectorize", "get-vectors", VECTORIZE_INDEX_NAME, "--ids", ...batchIds], {
      maxBuffer: 128 * 1024 * 1024,
    });
    const batchRows = parseJsonFromOutput<VectorizeBackupRow[]>(output);
    rows.push(...batchRows);
  }
  const report = writeVectorizePreImportBackup({
    backupDir,
    index: VECTORIZE_INDEX_NAME,
    listedIds: ids.length,
    rows,
  });
  if (report.rows !== ids.length) {
    throw new Error(`Vectorize pre-import backup row count mismatch: listed ${ids.length}, fetched ${report.rows}`);
  }
  console.log(JSON.stringify({ event: "vectorize_pre_import_backup", file: report.file, rows: report.rows, sha256: report.sha256 }));
  return report;
}

function writeReport(report: Record<string, unknown>) {
  fs.writeFileSync(path.join(cloudflareDir(backupDir), "vectorize-import-run.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

function resetVectorizeIndex() {
  for (;;) {
    const output = runWrangler(["vectorize", "list-vectors", VECTORIZE_INDEX_NAME, "--count", "1000", "--json"]);
    const parsed = JSON.parse(output) as { vectors?: Array<{ id?: string } | string>; isTruncated?: boolean; cursor?: string };
    const ids = (parsed.vectors ?? [])
      .map((vector) => (typeof vector === "string" ? vector : vector.id))
      .filter((id): id is string => Boolean(id));
    if (!ids.length) return;
    for (let index = 0; index < ids.length; index += 100) {
      runWrangler(["vectorize", "delete-vectors", VECTORIZE_INDEX_NAME, "--ids", ...ids.slice(index, index + 100)]);
    }
    if (!parsed.isTruncated) return;
  }
}

function requireImportConfirmations() {
  const required: Record<string, string> = {
    CONFIRM_WRITE_FREEZE: "1",
    CONFIRM_CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT_ID,
    CONFIRM_VECTORIZE_IMPORT: "1",
    CONFIRM_VECTORIZE_INDEX: VECTORIZE_INDEX_NAME,
    CONFIRM_BACKUP_DIR: backupDir,
  };
  if (reset) required.CONFIRM_VECTORIZE_RESET = "1";
  const missing = Object.entries(required)
    .filter(([key, expected]) => process.env[key] !== expected)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      [
        "Refusing remote Vectorize import without explicit write-freeze confirmations.",
        `Missing or incorrect: ${missing.join(", ")}`,
        reset ? "This command deletes vectors before reimporting because --reset is set." : "This command upserts vectors into the production index.",
      ].join(" "),
    );
  }
}

function ensureMetadataIndex(propertyName: string) {
  const output = runWrangler(["vectorize", "create-metadata-index", VECTORIZE_INDEX_NAME, "--propertyName", propertyName, "--type", "string"], {
    allowFailure: true,
  });
  if (output.includes("ERROR") && !output.toLowerCase().includes("already")) {
    throw new Error(output);
  }
}

function listMetadataIndexes() {
  const output = runWrangler(["vectorize", "list-metadata-index", VECTORIZE_INDEX_NAME, "--json"], { allowFailure: true });
  try {
    return parseJsonFromOutput<unknown>(output);
  } catch {
    return output;
  }
}

function waitForVectorImport(expectedVectorIds: Set<string>, requireExactIds: boolean) {
  let latestList: unknown = null;
  let latestInfo: unknown = null;
  let latestIds = new Set<string>();
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const listed = listAllVectorIds();
    latestList = listed.raw;
    latestIds = listed.ids;
    latestInfo = JSON.parse(runWrangler(["vectorize", "info", VECTORIZE_INDEX_NAME, "--json"])) as unknown;
    const info = latestInfo as { vectorCount?: number };
    const missingIds = [...expectedVectorIds].filter((id) => !latestIds.has(id));
    const unexpectedIds = requireExactIds ? [...latestIds].filter((id) => !expectedVectorIds.has(id)) : [];
    const vectorCountOk = requireExactIds ? info.vectorCount === expectedVectorIds.size : (info.vectorCount ?? 0) >= expectedVectorIds.size;
    if (vectorCountOk && !missingIds.length && !unexpectedIds.length) {
      return { ok: true, missingIds, unexpectedIds, list: latestList, info: latestInfo };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 500);
  }
  const missingIds = [...expectedVectorIds].filter((id) => !latestIds.has(id));
  const unexpectedIds = requireExactIds ? [...latestIds].filter((id) => !expectedVectorIds.has(id)) : [];
  const info = latestInfo as { vectorCount?: number } | null;
  const vectorCountOk = requireExactIds ? info?.vectorCount === expectedVectorIds.size : (info?.vectorCount ?? 0) >= expectedVectorIds.size;
  return {
    ok: vectorCountOk && !missingIds.length && !unexpectedIds.length,
    missingIds,
    unexpectedIds,
    list: latestList,
    info: latestInfo,
  };
}

function listAllVectorIds() {
  const ids = new Set<string>();
  const pages = [];
  let cursor: string | undefined;
  for (;;) {
    const args = ["vectorize", "list-vectors", VECTORIZE_INDEX_NAME, "--count", "1000", "--json"];
    if (cursor) args.push("--cursor", cursor);
    const page = JSON.parse(runWrangler(args)) as {
      vectors?: Array<{ id?: string } | string>;
      isTruncated?: boolean;
      cursor?: string;
    };
    pages.push(page);
    for (const vector of page.vectors ?? []) {
      const id = typeof vector === "string" ? vector : vector.id;
      if (id) ids.add(id);
    }
    if (!page.isTruncated || !page.cursor) return { ids, raw: pages };
    cursor = page.cursor;
  }
}

function readExpectedVectors() {
  const vectors = new Map<
    string,
    {
      namespace?: string;
      valuesSha256?: string;
      metadata?: Record<string, unknown>;
    }
  >();
  const duplicateIds: string[] = [];
  for (const line of fs.readFileSync(vectorFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { id?: string; namespace?: string; values?: unknown; metadata?: Record<string, unknown> };
    if (!row.id) throw new Error(`Vector row is missing id in ${vectorFile}`);
    if (vectors.has(row.id)) duplicateIds.push(row.id);
    vectors.set(row.id, {
      namespace: row.namespace,
      valuesSha256: Array.isArray(row.values) ? hashStable(row.values) : undefined,
      metadata: row.metadata,
    });
  }
  if (duplicateIds.length) {
    throw new Error(`Vector artifact has duplicate IDs: ${duplicateIds.slice(0, 20).join(", ")}`);
  }
  if (vectors.size !== manifest.rows) {
    throw new Error(`Vector manifest expected ${manifest.rows} rows but ${vectors.size} unique ids were found`);
  }
  return vectors;
}

function verifyRemoteVectors(
  expected: Map<string, { namespace?: string; valuesSha256?: string; metadata?: Record<string, unknown> }>,
) {
  const ids = [...expected.keys()];
  const problems: Array<{ id: string; problems: string[] }> = [];
  let fetchedRows = 0;
  for (let index = 0; index < ids.length; index += 100) {
    const batchIds = ids.slice(index, index + 100);
    const output = runWrangler(["vectorize", "get-vectors", VECTORIZE_INDEX_NAME, "--ids", ...batchIds], {
      maxBuffer: 128 * 1024 * 1024,
    });
    const rows = parseJsonFromOutput<
      Array<{
        id?: string;
        namespace?: string;
        values?: unknown;
        metadata?: Record<string, unknown>;
      }>
    >(output);
    fetchedRows += rows.length;
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const id of batchIds) {
      const row = rowsById.get(id);
      const expectedRow = expected.get(id);
      const rowProblems: string[] = [];
      if (!row) {
        rowProblems.push("missing from get-vectors response");
      } else {
        rowProblems.push(...remoteVectorRowProblems(row, expectedRow));
      }
      if (rowProblems.length) problems.push({ id, problems: rowProblems });
    }
  }

  return {
    ok: fetchedRows === ids.length && problems.length === 0,
    fetchedRows,
    expectedRows: ids.length,
    problems: problems.slice(0, 20),
  };
}

function parseJsonFromOutput<T>(output: string): T {
  const trimmed = output.trim();
  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0);
  const firstJson = Math.min(...starts);
  if (!Number.isFinite(firstJson)) throw new Error(`Could not find JSON in Wrangler output: ${output.slice(0, 400)}`);
  const jsonText = trimmed.slice(firstJson);
  return JSON.parse(jsonText) as T;
}

function hashStable(value: unknown) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}
