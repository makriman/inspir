import fs from "node:fs";
import path from "node:path";
import {
  TABLE_ORDER,
  canonicalDir,
  columnsForTable,
  createHash,
  d1ManifestPath,
  readNdjson,
  readValidationSnapshot,
  resolveBackupDir,
  stableStringify,
  transformD1Row,
  transformedTablePath,
  vectorizeManifestPath,
  vectorizeNdjsonPath,
  type D1Row,
  type TableName,
} from "./migration-config";
import { writeD1SizeSafetyReport } from "./d1-size-safety";
import { writeSourceTableCoverageReport } from "./source-table-coverage";
import { writeD1TransformFidelityReport } from "./d1-transform-fidelity";

type TableManifest = {
  table: TableName;
  rows: number;
  sha256: string;
  file: string;
};

type VectorManifest = {
  rows: number;
  sha256: string;
  file: string;
  namespaces: Record<string, number>;
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const backupDir = resolveBackupDir();
  const validation = readValidationSnapshot(backupDir);
  const sourceDir = canonicalDir(backupDir);
  const manifest: TableManifest[] = [];

  for (const table of TABLE_ORDER) {
    const columns = columnsForTable(validation, table);
    const input = path.join(sourceDir, `${table}.ndjson`);
    const output = transformedTablePath(backupDir, table);
    const stream = fs.createWriteStream(output, { encoding: "utf8" });
    const hash = createHash();
    let rows = 0;

    for await (const raw of readNdjson(input)) {
      const transformed = transformD1Row(raw, columns);
      const line = `${stableStringify(transformed)}\n`;
      stream.write(`${JSON.stringify(transformed)}\n`);
      hash.update(line);
      rows += 1;
    }

    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on("error", reject);
    });

    manifest.push({
      table,
      rows,
      sha256: hash.digest("hex"),
      file: path.relative(backupDir, output),
    });
  }

  fs.writeFileSync(d1ManifestPath(backupDir), `${JSON.stringify(manifest, null, 2)}\n`);

  const vectorManifest = await writeVectorizeArtifacts(backupDir);
  fs.writeFileSync(vectorizeManifestPath(backupDir), `${JSON.stringify(vectorManifest, null, 2)}\n`);
  const d1TransformFidelity = await writeD1TransformFidelityReport(backupDir);
  if (!d1TransformFidelity.ok) {
    throw new Error(
      `D1 transform fidelity failed: ${JSON.stringify(
        d1TransformFidelity.tables.filter((table) => !table.ok).map((table) => ({ table: table.table, problems: table.problems })),
      )}`,
    );
  }
  const d1SizeSafety = await writeD1SizeSafetyReport(backupDir);
  if (!d1SizeSafety.ok) {
    throw new Error(
      `D1 size safety failed: ${JSON.stringify(
        d1SizeSafety.tables.filter((table) => !table.ok).map((table) => ({ table: table.table, problems: table.problems })),
      )}`,
    );
  }
  const sourceTableCoverage = writeSourceTableCoverageReport(backupDir);
  if (!sourceTableCoverage.ok) {
    throw new Error(
      `Supabase source table coverage failed: ${JSON.stringify({
        unexpectedTables: sourceTableCoverage.unexpectedTables,
        missingExpectedTables: sourceTableCoverage.missingExpectedTables,
        duplicateSchemaTables: sourceTableCoverage.duplicateSchemaTables,
        missingCanonicalExports: sourceTableCoverage.missingCanonicalExports,
        missingTransformedExports: sourceTableCoverage.missingTransformedExports,
        validationMissingTables: sourceTableCoverage.validationMissingTables,
      })}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        backupDir,
        d1Manifest: d1ManifestPath(backupDir),
        vectorizeManifest: vectorizeManifestPath(backupDir),
        d1TransformFidelity: d1TransformFidelity.ok,
        d1SizeSafety: d1SizeSafety.ok,
        sourceTableCoverage: sourceTableCoverage.ok,
        totalRows: manifest.reduce((sum, table) => sum + table.rows, 0),
        vectors: vectorManifest.rows,
      },
      null,
      2,
    ),
  );
}

async function writeVectorizeArtifacts(currentBackupDir: string): Promise<VectorManifest> {
  const output = vectorizeNdjsonPath(currentBackupDir);
  const stream = fs.createWriteStream(output, { encoding: "utf8" });
  const hash = createHash();
  const namespaces: Record<string, number> = {};
  let rows = 0;

  for (const vector of await buildVectors(currentBackupDir, "user_memories")) {
    writeVector(vector);
  }
  for (const vector of await buildVectors(currentBackupDir, "chat_memory_summaries")) {
    writeVector(vector);
  }
  for (const vector of await buildVectors(currentBackupDir, "chat_memory_turns")) {
    writeVector(vector);
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on("error", reject);
  });

  return {
    rows,
    sha256: hash.digest("hex"),
    file: path.relative(currentBackupDir, output),
    namespaces,
  };

  function writeVector(vector: Record<string, unknown>) {
    const namespace = String(vector.namespace);
    namespaces[namespace] = (namespaces[namespace] ?? 0) + 1;
    const line = `${stableStringify(vector)}\n`;
    stream.write(`${JSON.stringify(vector)}\n`);
    hash.update(line);
    rows += 1;
  }
}

async function buildVectors(currentBackupDir: string, table: "user_memories" | "chat_memory_summaries" | "chat_memory_turns") {
  const vectors = [];
  for await (const row of readNdjson(transformedTablePath(currentBackupDir, table))) {
    const vector = vectorFromRow(table, row as D1Row);
    if (vector) vectors.push(vector);
  }
  return vectors;
}

function vectorFromRow(table: "user_memories" | "chat_memory_summaries" | "chat_memory_turns", row: D1Row) {
  const embedding = typeof row.embedding === "string" ? (JSON.parse(row.embedding) as number[]) : null;
  if (!embedding?.length) return null;

  if (table === "user_memories") {
    const rowId = String(row.id);
    return {
      id: `${table}:${rowId}`,
      namespace: table,
      values: embedding,
      metadata: {
        namespace: table,
        rowId,
        userId: String(row.user_id),
        ...(row.source_chat_id ? { chatId: String(row.source_chat_id) } : {}),
      },
    };
  }

  if (table === "chat_memory_summaries") {
    const rowId = String(row.chat_id);
    return {
      id: `${table}:${rowId}`,
      namespace: table,
      values: embedding,
      metadata: {
        namespace: table,
        rowId,
        userId: String(row.user_id),
        chatId: String(row.chat_id),
        ...(row.topic_id ? { topicId: String(row.topic_id) } : {}),
      },
    };
  }

  const rowId = String(row.id);
  return {
    id: `${table}:${rowId}`,
    namespace: table,
    values: embedding,
    metadata: {
      namespace: table,
      rowId,
      userId: String(row.user_id),
      chatId: String(row.chat_id),
      ...(row.topic_id ? { topicId: String(row.topic_id) } : {}),
    },
  };
}
