import fs from "node:fs";
import path from "node:path";
import {
  TABLE_ORDER,
  columnsForTable,
  d1ManifestPath,
  quoteIdent,
  readNdjson,
  readValidationSnapshot,
  stableStringify,
  transformedTablePath,
  type D1Row,
  type TableName,
} from "./migration-config";

export const D1_SIZE_SAFETY_REPORT = "cloudflare/d1-size-safety-report.json";
export const D1_MAX_ROW_OR_VALUE_BYTES = 2_000_000;
export const D1_MAX_SQL_STATEMENT_BYTES = 100_000;
export const D1_MAX_BOUND_PARAMETERS = 100;

type TableManifest = {
  table: TableName;
  rows: number;
};

type TableSizeSafety = {
  table: TableName;
  ok: boolean;
  expectedRows: number;
  sourceRows: number;
  columns: number;
  maxBoundParameters: number;
  insertStatementBytes: number;
  maxRowBytes: number;
  maxValueBytes: number;
  problems: string[];
};

export type D1SizeSafetyReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  limits: {
    maxRowOrValueBytes: number;
    maxSqlStatementBytes: number;
    maxBoundParameters: number;
  };
  tables: TableSizeSafety[];
};

export async function writeD1SizeSafetyReport(backupDir: string) {
  const report = await buildD1SizeSafetyReport(backupDir);
  const outputPath = path.join(backupDir, D1_SIZE_SAFETY_REPORT);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

export async function buildD1SizeSafetyReport(backupDir: string): Promise<D1SizeSafetyReport> {
  const validation = readValidationSnapshot(backupDir);
  const manifest = new Map(
    (JSON.parse(fs.readFileSync(d1ManifestPath(backupDir), "utf8")) as TableManifest[]).map((table) => [table.table, table]),
  );
  const tables: TableSizeSafety[] = [];

  for (const table of TABLE_ORDER) {
    const columns = [...columnsForTable(validation, table).keys()];
    const insertStatementBytes = Buffer.byteLength(insertSqlForTable(table, columns), "utf8");
    let sourceRows = 0;
    let maxRowBytes = 0;
    let maxValueBytes = 0;

    for await (const row of readNdjson(transformedTablePath(backupDir, table))) {
      const d1Row = row as D1Row;
      sourceRows += 1;
      maxRowBytes = Math.max(maxRowBytes, Buffer.byteLength(stableStringify(d1Row), "utf8"));
      for (const value of Object.values(d1Row)) {
        if (value === null || value === undefined) continue;
        maxValueBytes = Math.max(maxValueBytes, Buffer.byteLength(String(value), "utf8"));
      }
    }

    const expectedRows = manifest.get(table)?.rows ?? -1;
    const problems = [];
    if (sourceRows !== expectedRows) problems.push("source row count does not match D1 manifest");
    if (columns.length > D1_MAX_BOUND_PARAMETERS) problems.push("column count exceeds D1 bound parameter limit");
    if (insertStatementBytes > D1_MAX_SQL_STATEMENT_BYTES) problems.push("insert statement exceeds D1 SQL statement length limit");
    if (maxRowBytes > D1_MAX_ROW_OR_VALUE_BYTES) problems.push("row payload exceeds D1 row size limit");
    if (maxValueBytes > D1_MAX_ROW_OR_VALUE_BYTES) problems.push("cell payload exceeds D1 string/BLOB size limit");

    tables.push({
      table,
      ok: problems.length === 0,
      expectedRows,
      sourceRows,
      columns: columns.length,
      maxBoundParameters: columns.length,
      insertStatementBytes,
      maxRowBytes,
      maxValueBytes,
      problems,
    });
  }

  return {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: tables.every((table) => table.ok),
    limits: {
      maxRowOrValueBytes: D1_MAX_ROW_OR_VALUE_BYTES,
      maxSqlStatementBytes: D1_MAX_SQL_STATEMENT_BYTES,
      maxBoundParameters: D1_MAX_BOUND_PARAMETERS,
    },
    tables,
  };
}

function insertSqlForTable(table: TableName, columns: string[]) {
  const columnSql = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return `insert into ${quoteIdent(table)} (${columnSql}) values (${placeholders})`;
}
