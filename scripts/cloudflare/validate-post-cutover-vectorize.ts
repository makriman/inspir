import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  resolveBackupDir,
  runWrangler,
  stableStringify,
  vectorizeManifestPath,
  vectorizeNdjsonPath,
} from "./migration-config";
import { buildVectorizeArtifactFingerprint } from "./migration-artifact-fingerprint";
import { remoteVectorRowProblems } from "./vectorize-remote-validation";

const POST_CUTOVER_VECTORIZE_REPORT = "vectorize-post-cutover-validation-report.json";

const backupDir = resolveBackupDir();
const vectorFile = vectorizeNdjsonPath(backupDir);
const manifest = JSON.parse(fs.readFileSync(vectorizeManifestPath(backupDir), "utf8")) as { rows: number; sha256?: string };
const artifactFingerprint = buildVectorizeArtifactFingerprint(backupDir);
const expectedVectors = readExpectedVectors();
const expectedIds = new Set(expectedVectors.keys());
const startedAt = new Date().toISOString();

void main().catch((error) => {
  const report = {
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
    allowUnexpectedIds: true,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  writeReport(report);
  process.exitCode = 1;
});

async function main() {
  const vectorState = waitForImportedVectors(expectedIds);
  const remoteVectorChecks = vectorState.ok ? verifyRemoteVectors(expectedVectors) : { ok: false, skipped: true };
  const ok =
    artifactFingerprint.artifactSha256 === manifest.sha256 &&
    expectedVectors.size === manifest.rows &&
    vectorState.ok &&
    remoteVectorChecks.ok === true;
  const report = {
    createdAt: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    backupDir,
    index: VECTORIZE_INDEX_NAME,
    importedFrom: path.relative(backupDir, vectorFile),
    artifactFingerprint,
    artifactSha256: artifactFingerprint.artifactSha256,
    manifestSha256: manifest.sha256,
    artifactSha256MatchesManifest: artifactFingerprint.artifactSha256 === manifest.sha256,
    expectedRows: manifest.rows,
    allowUnexpectedIds: true,
    ok,
    missingIds: vectorState.missingIds,
    unexpectedIds: vectorState.unexpectedIds,
    remoteVectorChecks,
    list: vectorState.list,
    info: vectorState.info,
  };
  writeReport(report);
  if (!ok) process.exitCode = 1;
}

function waitForImportedVectors(expectedVectorIds: Set<string>) {
  let latestList: unknown = null;
  let latestInfo: unknown = null;
  let latestIds = new Set<string>();
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const listed = listAllVectorIds();
    latestList = listed.raw;
    latestIds = listed.ids;
    latestInfo = JSON.parse(runWrangler(["vectorize", "info", VECTORIZE_INDEX_NAME, "--json"])) as unknown;
    const info = latestInfo as { vectorCount?: number };
    const missingIds = [...expectedVectorIds].filter((id) => !latestIds.has(id));
    const unexpectedIds = [...latestIds].filter((id) => !expectedVectorIds.has(id));
    const vectorCountOk = (info.vectorCount ?? 0) >= expectedVectorIds.size;
    if (vectorCountOk && !missingIds.length) {
      return { ok: true, missingIds, unexpectedIds, list: latestList, info: latestInfo };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 500);
  }
  const missingIds = [...expectedVectorIds].filter((id) => !latestIds.has(id));
  const unexpectedIds = [...latestIds].filter((id) => !expectedVectorIds.has(id));
  const info = latestInfo as { vectorCount?: number } | null;
  return {
    ok: (info?.vectorCount ?? 0) >= expectedVectorIds.size && !missingIds.length,
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
      if (!row) rowProblems.push("missing from get-vectors response");
      else rowProblems.push(...remoteVectorRowProblems(row, expectedRow));
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
  return JSON.parse(trimmed.slice(firstJson)) as T;
}

function hashStable(value: unknown) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function writeReport(report: Record<string, unknown>) {
  const outputPath = path.join(cloudflareDir(backupDir), POST_CUTOVER_VECTORIZE_REPORT);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
