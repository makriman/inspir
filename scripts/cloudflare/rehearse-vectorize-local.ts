import fs from "node:fs";
import path from "node:path";
import {
  cloudflareDir,
  createHash,
  readNdjson,
  resolveBackupDir,
  stableStringify,
  transformedTablePath,
  vectorizeManifestPath,
  vectorizeNdjsonPath,
  type D1Row,
} from "./migration-config";

type VectorNamespace = (typeof VECTOR_TABLES)[number];

type VectorManifest = {
  rows?: number;
  sha256?: string;
  file?: string;
  namespaces?: Record<string, number>;
};

type VectorRow = {
  id?: string;
  namespace?: string;
  values?: unknown;
  metadata?: Record<string, unknown>;
};

type ExpectedVector = {
  id: string;
  namespace: VectorNamespace;
  rowId: string;
  embeddingSha256: string;
  metadata: {
    namespace: VectorNamespace;
    rowId: string;
    userId: string;
    chatId?: string;
    topicId?: string;
  };
};

type Check = {
  name: string;
  status: "pass" | "fail";
  detail?: unknown;
};

const VECTOR_TABLES = ["user_memories", "chat_memory_summaries", "chat_memory_turns"] as const;
const VECTOR_DIMENSIONS = 512;
const backupDir = resolveBackupDir();
const outputPath = path.join(cloudflareDir(backupDir), "vectorize-local-rehearsal-report.json");
const checks: Check[] = [];

void main().catch((error) => {
  fail("Vectorize local rehearsal runtime", error instanceof Error ? error.message : String(error));
  writeReport();
  process.exitCode = 1;
});

async function main() {
  const manifest = readManifest();
  const expected = await readExpectedVectors();
  const sourceExports = await readSourceVectorExports();
  const artifact = await readVectorizeArtifact();

  checkManifest(manifest, artifact);
  checkExpectedSourceExports(expected, sourceExports);
  checkArtifactRows(expected, artifact);

  const ok = writeReport({
    manifest: summarizeManifest(manifest),
    expected: summarizeExpected(expected),
    artifact: summarizeArtifact(artifact),
    sourceExports: summarizeSourceExports(sourceExports),
  });
  if (!ok) process.exitCode = 1;
}

function readManifest() {
  const manifestPath = vectorizeManifestPath(backupDir);
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing Vectorize manifest: ${manifestPath}`);
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as VectorManifest;
}

async function readExpectedVectors() {
  const byId = new Map<string, ExpectedVector>();
  const namespaces: Record<VectorNamespace, number> = {
    user_memories: 0,
    chat_memory_summaries: 0,
    chat_memory_turns: 0,
  };

  for (const namespace of VECTOR_TABLES) {
    for await (const row of readNdjson(transformedTablePath(backupDir, namespace))) {
      const expected = expectedVectorFromRow(namespace, row as D1Row);
      if (!expected) continue;
      namespaces[namespace] += 1;
      if (byId.has(expected.id)) {
        fail("expected vector IDs are unique", { duplicateId: expected.id });
      }
      byId.set(expected.id, expected);
    }
  }

  if (![...byId.values()].some(Boolean)) {
    pass("expected vector source rows parsed", { rows: 0, namespaces });
  } else {
    pass("expected vector source rows parsed", { rows: byId.size, namespaces });
  }

  return { byId, namespaces };
}

async function readSourceVectorExports() {
  const byId = new Map<string, { namespace: VectorNamespace; embeddingSha256: string }>();
  const namespaces: Record<VectorNamespace, number> = {
    user_memories: 0,
    chat_memory_summaries: 0,
    chat_memory_turns: 0,
  };

  for (const namespace of VECTOR_TABLES) {
    const filePath = path.join(backupDir, "supabase", `${namespace}-vectors.ndjson`);
    if (!fs.existsSync(filePath)) {
      fail("Supabase vector export files exist", { missing: path.relative(backupDir, filePath) });
      continue;
    }
    for await (const row of readNdjson(filePath)) {
      const rowId = typeof row.id === "string" ? row.id : "";
      const embedding = parseEmbedding(row.embedding);
      if (!rowId || !embedding) {
        fail("Supabase vector export rows are parseable", { namespace, row });
        continue;
      }
      const id = `${namespace}:${rowId}`;
      namespaces[namespace] += 1;
      byId.set(id, { namespace, embeddingSha256: sha256Stable(embedding) });
    }
  }

  pass("Supabase vector exports parsed", { rows: byId.size, namespaces });
  return { byId, namespaces };
}

async function readVectorizeArtifact() {
  const filePath = vectorizeNdjsonPath(backupDir);
  if (!fs.existsSync(filePath)) throw new Error(`Missing Vectorize NDJSON artifact: ${filePath}`);

  const byId = new Map<string, VectorRow & { embeddingSha256?: string }>();
  const namespaces: Record<string, number> = {};
  const hash = createHash();
  let rows = 0;

  for await (const raw of readNdjson(filePath)) {
    const vector = raw as VectorRow;
    const line = `${stableStringify(vector)}\n`;
    hash.update(line);
    rows += 1;

    const namespace = typeof vector.namespace === "string" ? vector.namespace : "";
    namespaces[namespace] = (namespaces[namespace] ?? 0) + 1;
    const id = typeof vector.id === "string" ? vector.id : "";
    if (!id) {
      fail("Vectorize artifact rows include IDs", { rowNumber: rows });
      continue;
    }
    if (byId.has(id)) fail("Vectorize artifact IDs are unique", { duplicateId: id });
    byId.set(id, {
      ...vector,
      embeddingSha256: Array.isArray(vector.values) ? sha256Stable(vector.values) : undefined,
    });
  }

  return { rows, sha256: hash.digest("hex"), byId, namespaces };
}

function checkManifest(
  manifest: VectorManifest,
  artifact: Awaited<ReturnType<typeof readVectorizeArtifact>>,
) {
  const expectedFile = path.relative(backupDir, vectorizeNdjsonPath(backupDir));
  const problems: Record<string, unknown> = {};
  if (manifest.file !== expectedFile) problems.file = { expected: expectedFile, actual: manifest.file };
  if (manifest.rows !== artifact.rows) problems.rows = { expected: artifact.rows, actual: manifest.rows };
  if (manifest.sha256 !== artifact.sha256) problems.sha256 = { expected: artifact.sha256, actual: manifest.sha256 };

  for (const namespace of VECTOR_TABLES) {
    const manifestCount = manifest.namespaces?.[namespace] ?? 0;
    const artifactCount = artifact.namespaces[namespace] ?? 0;
    if (manifestCount !== artifactCount) {
      problems[`namespace:${namespace}`] = { expected: artifactCount, actual: manifestCount };
    }
  }

  const unexpectedNamespaces = Object.keys(manifest.namespaces ?? {}).filter(
    (namespace) => !VECTOR_TABLES.includes(namespace as VectorNamespace),
  );
  if (unexpectedNamespaces.length) problems.unexpectedNamespaces = unexpectedNamespaces;

  if (Object.keys(problems).length) fail("Vectorize manifest matches artifact", problems);
  else pass("Vectorize manifest matches artifact", { rows: artifact.rows, sha256: artifact.sha256 });
}

function checkExpectedSourceExports(
  expected: Awaited<ReturnType<typeof readExpectedVectors>>,
  sourceExports: Awaited<ReturnType<typeof readSourceVectorExports>>,
) {
  const missing = [...expected.byId.keys()].filter((id) => !sourceExports.byId.has(id));
  const unexpected = [...sourceExports.byId.keys()].filter((id) => !expected.byId.has(id));
  const hashMismatches = [...expected.byId.entries()]
    .filter(([id, vector]) => sourceExports.byId.get(id)?.embeddingSha256 !== vector.embeddingSha256)
    .map(([id]) => id);

  if (missing.length || unexpected.length || hashMismatches.length) {
    fail("Supabase vector exports match transformed rows", {
      missing: missing.slice(0, 20),
      unexpected: unexpected.slice(0, 20),
      hashMismatches: hashMismatches.slice(0, 20),
      counts: {
        expected: expected.byId.size,
        sourceExports: sourceExports.byId.size,
      },
    });
  } else {
    pass("Supabase vector exports match transformed rows", {
      rows: expected.byId.size,
      namespaces: expected.namespaces,
    });
  }
}

function checkArtifactRows(
  expected: Awaited<ReturnType<typeof readExpectedVectors>>,
  artifact: Awaited<ReturnType<typeof readVectorizeArtifact>>,
) {
  const missing = [...expected.byId.keys()].filter((id) => !artifact.byId.has(id));
  const unexpected = [...artifact.byId.keys()].filter((id) => !expected.byId.has(id));
  const rowProblems: Array<{ id: string; problems: string[] }> = [];

  for (const [id, vector] of artifact.byId.entries()) {
    const problems: string[] = [];
    const expectedVector = expected.byId.get(id);
    const values = vector.values;
    const metadata = vector.metadata ?? {};
    const namespace = vector.namespace;

    if (!expectedVector) {
      problems.push("unexpected vector id");
    } else {
      if (namespace !== expectedVector.namespace) problems.push("namespace mismatch");
      if (vector.embeddingSha256 !== expectedVector.embeddingSha256) problems.push("embedding hash mismatch");
      for (const [key, expectedValue] of Object.entries(expectedVector.metadata)) {
        if (metadata[key] !== expectedValue) problems.push(`metadata.${key} mismatch`);
      }
    }

    if (!VECTOR_TABLES.includes(namespace as VectorNamespace)) problems.push("invalid namespace");
    if (metadata.namespace !== namespace) problems.push("metadata.namespace mismatch");
    if (!Array.isArray(values)) {
      problems.push("values is not an array");
    } else {
      if (values.length !== VECTOR_DIMENSIONS) problems.push(`values length is ${values.length}`);
      if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        problems.push("values contain non-finite or non-numeric entries");
      }
    }

    if (problems.length) rowProblems.push({ id, problems });
  }

  if (missing.length || unexpected.length || rowProblems.length) {
    fail("Vectorize artifact rows are complete and import-safe", {
      missing: missing.slice(0, 20),
      unexpected: unexpected.slice(0, 20),
      rowProblems: rowProblems.slice(0, 20),
      counts: {
        expected: expected.byId.size,
        artifact: artifact.byId.size,
      },
    });
  } else {
    pass("Vectorize artifact rows are complete and import-safe", {
      rows: artifact.byId.size,
      dimensions: VECTOR_DIMENSIONS,
      namespaces: expected.namespaces,
    });
  }
}

function expectedVectorFromRow(namespace: VectorNamespace, row: D1Row): ExpectedVector | null {
  const embedding = parseEmbedding(row.embedding);
  if (!embedding?.length) return null;

  const rowId = namespace === "chat_memory_summaries" ? requireString(row.chat_id, namespace, "chat_id") : requireString(row.id, namespace, "id");
  const userId = requireString(row.user_id, namespace, "user_id");
  const chatId = namespace === "user_memories" ? optionalString(row.source_chat_id) : requireString(row.chat_id, namespace, "chat_id");
  const topicId = optionalString(row.topic_id);

  return {
    id: `${namespace}:${rowId}`,
    namespace,
    rowId,
    embeddingSha256: sha256Stable(embedding),
    metadata: {
      namespace,
      rowId,
      userId,
      ...(chatId ? { chatId } : {}),
      ...(topicId ? { topicId } : {}),
    },
  };
}

function parseEmbedding(value: unknown): number[] | null {
  if (value === null || value === undefined) return null;
  const parsed = Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : null;
  if (!Array.isArray(parsed)) return null;
  return parsed.map(Number);
}

function requireString(value: unknown, namespace: VectorNamespace, column: string) {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`Missing ${column} for ${namespace} vector row`);
  return parsed;
}

function optionalString(value: unknown) {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

function sha256Stable(value: unknown) {
  return createHash().update(stableStringify(value)).digest("hex");
}

function summarizeManifest(manifest: VectorManifest) {
  return {
    rows: manifest.rows,
    sha256: manifest.sha256,
    file: manifest.file,
    namespaces: manifest.namespaces,
  };
}

function summarizeExpected(expected: Awaited<ReturnType<typeof readExpectedVectors>>) {
  return {
    rows: expected.byId.size,
    namespaces: expected.namespaces,
  };
}

function summarizeArtifact(artifact: Awaited<ReturnType<typeof readVectorizeArtifact>>) {
  return {
    rows: artifact.rows,
    sha256: artifact.sha256,
    namespaces: artifact.namespaces,
  };
}

function summarizeSourceExports(sourceExports: Awaited<ReturnType<typeof readSourceVectorExports>>) {
  return {
    rows: sourceExports.byId.size,
    namespaces: sourceExports.namespaces,
  };
}

function writeReport(detail: Record<string, unknown> = {}) {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: failed.length === 0,
    failedChecks: failed.length,
    checks,
    ...detail,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}
