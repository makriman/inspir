import fs from "node:fs";
import path from "node:path";
import {
  PRIMARY_KEY_ORDER,
  TABLE_ORDER,
  canonicalDir,
  cloudflareDir,
  columnsForTable,
  createHash,
  parseVector,
  readNdjson,
  readValidationSnapshot,
  stableStringify,
  transformD1Row,
  timestampPrecisionPath,
  type PgColumn,
  type TableName,
  type TimestampPrecisionRow,
} from "./migration-config";

export const D1_TRANSFORM_FIDELITY_REPORT = "cloudflare/d1-transform-fidelity-report.json";

type FidelityProblem = {
  table: TableName;
  column?: string;
  rowKey?: string;
  problem: string;
  detail?: unknown;
};

type TableFidelityReport = {
  table: TableName;
  rows: number;
  timestampValues: number;
  jsonValues: number;
  vectorValues: number;
  numericValues: number;
  booleanValues: number;
  timestampPrecisionRows: number;
  timestampPrecisionSamples: TimestampPrecisionRow[];
  artifactRowsMatchTransform: boolean;
  problems: FidelityProblem[];
  ok: boolean;
};

type TimestampPrecisionArtifact = {
  file: string;
  rows: number;
  sha256: string;
};

export type D1TransformFidelityReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  timestampPrecisionArtifact: TimestampPrecisionArtifact;
  tables: TableFidelityReport[];
  totals: {
    rows: number;
    timestampValues: number;
    jsonValues: number;
    vectorValues: number;
    numericValues: number;
    booleanValues: number;
    timestampPrecisionRows: number;
    problems: number;
  };
};

export async function writeD1TransformFidelityReport(backupDir: string) {
  const { timestampPrecisionRows, ...report } = await buildD1TransformFidelityReport(backupDir);
  writeTimestampPrecisionArtifact(backupDir, timestampPrecisionRows);
  const outputPath = path.join(backupDir, D1_TRANSFORM_FIDELITY_REPORT);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

export type BuildD1TransformFidelityReport = D1TransformFidelityReport & {
  timestampPrecisionRows: TimestampPrecisionRow[];
};

export async function buildD1TransformFidelityReport(backupDir: string): Promise<BuildD1TransformFidelityReport> {
  const validation = readValidationSnapshot(backupDir);
  const tables: TableFidelityReport[] = [];
  const timestampPrecisionRows: TimestampPrecisionRow[] = [];

  for (const table of TABLE_ORDER) {
    const columns = columnsForTable(validation, table);
    tables.push(await checkTable(backupDir, table, columns, timestampPrecisionRows));
  }
  timestampPrecisionRows.sort(compareTimestampPrecisionRows);

  const totals = {
    rows: sum(tables, "rows"),
    timestampValues: sum(tables, "timestampValues"),
    jsonValues: sum(tables, "jsonValues"),
    vectorValues: sum(tables, "vectorValues"),
    numericValues: sum(tables, "numericValues"),
    booleanValues: sum(tables, "booleanValues"),
    timestampPrecisionRows: timestampPrecisionRows.length,
    problems: tables.reduce((total, table) => total + table.problems.length, 0),
  };

  return {
    createdAt: new Date().toISOString(),
    backupDir: path.resolve(backupDir),
    ok: tables.every((table) => table.ok),
    timestampPrecisionArtifact: {
      file: path.relative(backupDir, timestampPrecisionPath(backupDir)),
      rows: timestampPrecisionRows.length,
      sha256: hashTimestampPrecisionRows(timestampPrecisionRows),
    },
    timestampPrecisionRows,
    tables,
    totals,
  };
}

async function checkTable(
  backupDir: string,
  table: TableName,
  columns: Map<string, PgColumn>,
  timestampPrecisionRows: TimestampPrecisionRow[],
): Promise<TableFidelityReport> {
  const sourcePath = path.join(canonicalDir(backupDir), `${table}.ndjson`);
  const transformedPath = path.join(cloudflareDir(backupDir), "d1-transformed", `${table}.ndjson`);
  const transformedRows = readNdjson(transformedPath)[Symbol.asyncIterator]();
  const problems: FidelityProblem[] = [];
  const counts = {
    rows: 0,
    timestampValues: 0,
    jsonValues: 0,
    vectorValues: 0,
    numericValues: 0,
    booleanValues: 0,
  };
  const timestampPrecisionStart = timestampPrecisionRows.length;
  let artifactRowsMatchTransform = true;

  for await (const raw of readNdjson(sourcePath)) {
    counts.rows += 1;
    const rowKey = rowKeyFor(table, raw);
    const expected = safeTransformRow(table, rowKey, raw, columns, problems);
    analyzeRawRow(table, rowKey, raw, expected, columns, problems, counts, timestampPrecisionRows);

    const actual = await transformedRows.next();
    if (actual.done) {
      artifactRowsMatchTransform = false;
      problems.push({ table, rowKey, problem: "transformed artifact is missing this source row" });
      continue;
    }
    if (expected && stableStringify(actual.value) !== stableStringify(expected)) {
      artifactRowsMatchTransform = false;
      problems.push({
        table,
        rowKey,
        problem: "transformed artifact row does not match current transform",
      });
    }
  }

  const extra = await transformedRows.next();
  if (!extra.done) {
    artifactRowsMatchTransform = false;
    problems.push({ table, problem: "transformed artifact has extra rows after source export ended" });
  }

  return {
    table,
    ...counts,
    timestampPrecisionRows: timestampPrecisionRows.length - timestampPrecisionStart,
    timestampPrecisionSamples: timestampPrecisionRows.slice(timestampPrecisionStart, timestampPrecisionStart + 10),
    artifactRowsMatchTransform,
    problems: problems.slice(0, 50),
    ok: artifactRowsMatchTransform && problems.length === 0,
  };
}

function safeTransformRow(
  table: TableName,
  rowKey: string,
  raw: Record<string, unknown>,
  columns: Map<string, PgColumn>,
  problems: FidelityProblem[],
) {
  try {
    return transformD1Row(raw, columns);
  } catch (error) {
    problems.push({
      table,
      rowKey,
      problem: "row transform threw",
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function analyzeRawRow(
  table: TableName,
  rowKey: string,
  raw: Record<string, unknown>,
  transformed: ReturnType<typeof transformD1Row> | null,
  columns: Map<string, PgColumn>,
  problems: FidelityProblem[],
  counts: {
    timestampValues: number;
    jsonValues: number;
    vectorValues: number;
    numericValues: number;
    booleanValues: number;
  },
  timestampPrecisionRows: TimestampPrecisionRow[],
) {
  for (const [columnName, value] of Object.entries(raw)) {
    const column = columns.get(columnName);
    if (!column || value === null || value === undefined) continue;
    const dataType = column.data_type.toLowerCase();
    const udtName = column.udt_name.toLowerCase();

    if (dataType.includes("timestamp")) {
      counts.timestampValues += 1;
      const precisionLoss = timestampSubMillisecondPrecisionLoss(value);
      if (precisionLoss) {
        const d1TimestampMs = transformed?.[columnName];
        if (typeof value !== "string" || typeof d1TimestampMs !== "number" || !Number.isFinite(d1TimestampMs)) {
          problems.push({
            table,
            column: columnName,
            rowKey,
            problem: "timestamp precision artifact could not preserve a valid original/D1 pair",
            detail: { sourceValue: value, d1TimestampMs },
          });
        } else {
          timestampPrecisionRows.push({
            source_table: table,
            source_pk: rowKey,
            column_name: columnName,
            original_timestamp: value,
            d1_timestamp_ms: d1TimestampMs,
          });
        }
      }
      continue;
    }

    if (dataType === "boolean") {
      counts.booleanValues += 1;
      continue;
    }

    if (dataType === "json" || dataType === "jsonb" || dataType === "array" || udtName.startsWith("_")) {
      counts.jsonValues += 1;
      continue;
    }

    if (udtName === "vector") {
      counts.vectorValues += 1;
      const vector = parseVector(value);
      if (!vector || !vector.every((item) => Number.isFinite(item))) {
        problems.push({ table, column: columnName, rowKey, problem: "vector value is not finite numeric data" });
      }
      continue;
    }

    if (typeof value === "number") {
      counts.numericValues += 1;
      if (!Number.isFinite(value)) {
        problems.push({ table, column: columnName, rowKey, problem: "numeric value is not finite" });
      } else if (integerLikeColumn(dataType, udtName) && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        problems.push({ table, column: columnName, rowKey, problem: "integer value exceeds JavaScript safe integer range" });
      }
    }
  }
}

export function timestampSubMillisecondPrecisionLoss(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/[T\s]\d{2}:\d{2}:\d{2}\.(\d+)/);
  const fraction = match?.[1];
  if (!fraction || fraction.length <= 3) return null;
  const subMillisecondDigits = fraction.slice(3);
  if (!/[1-9]/.test(subMillisecondDigits)) return null;
  return {
    value,
    millisecondFraction: fraction.slice(0, 3),
    subMillisecondFraction: subMillisecondDigits,
  };
}

function integerLikeColumn(dataType: string, udtName: string) {
  return (
    dataType.includes("integer") ||
    dataType === "bigint" ||
    dataType === "smallint" ||
    ["int2", "int4", "int8"].includes(udtName)
  );
}

function rowKeyFor(table: TableName, row: Record<string, unknown>) {
  return PRIMARY_KEY_ORDER[table].map((column) => `${column}=${String(row[column])}`).join(",");
}

function sum(tables: TableFidelityReport[], key: keyof Pick<TableFidelityReport, "rows" | "timestampValues" | "jsonValues" | "vectorValues" | "numericValues" | "booleanValues">) {
  return tables.reduce((total, table) => total + table[key], 0);
}

function writeTimestampPrecisionArtifact(backupDir: string, rows: TimestampPrecisionRow[]) {
  const outputPath = timestampPrecisionPath(backupDir);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), {
    mode: 0o600,
  });
}

function hashTimestampPrecisionRows(rows: TimestampPrecisionRow[]) {
  const hash = createHash();
  for (const row of rows) hash.update(`${stableStringify(row)}\n`);
  return hash.digest("hex");
}

function compareTimestampPrecisionRows(left: TimestampPrecisionRow, right: TimestampPrecisionRow) {
  return (
    left.source_table.localeCompare(right.source_table) ||
    left.source_pk.localeCompare(right.source_pk) ||
    left.column_name.localeCompare(right.column_name)
  );
}
