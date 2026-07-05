import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  D1_MAX_BOUND_PARAMETERS,
  buildD1SizeSafetyReport,
} from "../scripts/cloudflare/d1-size-safety";
import { buildSourceTableCoverageReport } from "../scripts/cloudflare/source-table-coverage";
import { TABLE_ORDER, type TableName } from "../scripts/cloudflare/migration-config";

test("source table coverage accepts a complete explicit public schema", async () => {
  await withBackupFixture((backupDir) => {
    const report = buildSourceTableCoverageReport(backupDir);

    assert.equal(report.ok, true);
    assert.equal(report.expectedTables.length, TABLE_ORDER.length);
    assert.equal(report.schemaTables.length, TABLE_ORDER.length);
    assert.deepEqual(report.unexpectedTables, []);
    assert.deepEqual(report.missingExpectedTables, []);
  });
});

test("source table coverage fails on an unmigrated public table", async () => {
  await withBackupFixture(
    (backupDir) => {
      const report = buildSourceTableCoverageReport(backupDir);

      assert.equal(report.ok, false);
      assert.deepEqual(report.unexpectedTables, ["surprise_public_table"]);
    },
    { extraSchemaTable: "surprise_public_table" },
  );
});

test("D1 size safety accepts compact transformed rows", async () => {
  await withBackupFixture(async (backupDir) => {
    const report = await buildD1SizeSafetyReport(backupDir);

    assert.equal(report.ok, true);
    assert.equal(report.tables.length, TABLE_ORDER.length);
    assert.equal(report.tables.some((table) => table.maxBoundParameters > D1_MAX_BOUND_PARAMETERS), false);
  });
});

test("D1 size safety fails when a table exceeds bound parameter limits", async () => {
  const oversizedTable = TABLE_ORDER[0];
  await withBackupFixture(
    async (backupDir) => {
      const report = await buildD1SizeSafetyReport(backupDir);
      const table = report.tables.find((entry) => entry.table === oversizedTable);

      assert.equal(report.ok, false);
      assert.ok(table);
      assert.equal(table.ok, false);
      assert.ok(table.maxBoundParameters > D1_MAX_BOUND_PARAMETERS);
      assert.ok(table.problems.includes("column count exceeds D1 bound parameter limit"));
    },
    { columnCountByTable: { [oversizedTable]: D1_MAX_BOUND_PARAMETERS + 1 } },
  );
});

async function withBackupFixture<T>(
  callback: (backupDir: string) => T | Promise<T>,
  options: { extraSchemaTable?: string; columnCountByTable?: Partial<Record<TableName, number>> } = {},
) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-migration-safety-"));
  try {
    writeBackupFixture(backupDir, options);
    return await callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function writeBackupFixture(
  backupDir: string,
  options: { extraSchemaTable?: string; columnCountByTable?: Partial<Record<TableName, number>> },
) {
  fs.mkdirSync(path.join(backupDir, "supabase", "canonical"), { recursive: true });
  fs.mkdirSync(path.join(backupDir, "cloudflare", "d1-transformed"), { recursive: true });

  const tables = options.extraSchemaTable ? [...TABLE_ORDER, options.extraSchemaTable] : [...TABLE_ORDER];
  fs.writeFileSync(
    path.join(backupDir, "supabase", "schema-public.sql"),
    `${tables.map((table) => `CREATE TABLE IF NOT EXISTS "public"."${table}" ("id" text);`).join("\n")}\n`,
  );

  const validationTables: Record<string, number> = {};
  const validationColumns: Record<string, Array<{ column_name: string; data_type: string; udt_name: string }>> = {};
  const manifest = [];

  for (const table of TABLE_ORDER) {
    const columns = columnsForFixture(options.columnCountByTable?.[table] ?? 1);
    const row = Object.fromEntries(columns.map((column) => [column.column_name, `${table}-${column.column_name}`]));
    validationTables[table] = 1;
    validationColumns[table] = columns;
    manifest.push({ table, rows: 1, sha256: "fixture", file: `cloudflare/d1-transformed/${table}.ndjson` });
    fs.writeFileSync(path.join(backupDir, "supabase", "canonical", `${table}.ndjson`), `${JSON.stringify(row)}\n`);
    fs.writeFileSync(path.join(backupDir, "cloudflare", "d1-transformed", `${table}.ndjson`), `${JSON.stringify(row)}\n`);
  }

  fs.writeFileSync(
    path.join(backupDir, "supabase", "validation.json"),
    `${JSON.stringify({ createdAt: new Date().toISOString(), tables: validationTables, columns: validationColumns }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(backupDir, "cloudflare", "d1-import-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function columnsForFixture(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    column_name: index === 0 ? "id" : `column_${index}`,
    data_type: "text",
    udt_name: "text",
  }));
}
