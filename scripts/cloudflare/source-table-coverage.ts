import fs from "node:fs";
import path from "node:path";
import { TABLE_ORDER, cloudflareDir, type TableName } from "./migration-config";

export const SOURCE_TABLE_COVERAGE_REPORT = "cloudflare/source-table-coverage-report.json";
export const EXPLICITLY_IGNORED_PUBLIC_TABLES: string[] = [];

export type SourceTableCoverageReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  expectedTables: TableName[];
  schemaTables: string[];
  explicitlyIgnoredTables: string[];
  unexpectedTables: string[];
  missingExpectedTables: TableName[];
  duplicateSchemaTables: string[];
  missingCanonicalExports: string[];
  missingTransformedExports: string[];
  validationMissingTables: TableName[];
};

export function writeSourceTableCoverageReport(backupDir: string) {
  const report = buildSourceTableCoverageReport(backupDir);
  const outputPath = path.join(backupDir, SOURCE_TABLE_COVERAGE_REPORT);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

export function buildSourceTableCoverageReport(backupDir: string): SourceTableCoverageReport {
  const expectedTables = [...TABLE_ORDER];
  const expected = new Set<string>(expectedTables);
  const ignored = new Set(EXPLICITLY_IGNORED_PUBLIC_TABLES);
  const schemaTables = parsePublicTablesFromSchema(backupDir);
  const schemaTableSet = new Set(schemaTables);
  const duplicateSchemaTables = [...new Set(schemaTables.filter((table, index) => schemaTables.indexOf(table) !== index))].sort();
  const unexpectedTables = [...schemaTableSet].filter((table) => !expected.has(table) && !ignored.has(table)).sort();
  const missingExpectedTables = expectedTables.filter((table) => !schemaTableSet.has(table));
  const missingCanonicalExports = expectedTables
    .map((table) => `supabase/canonical/${table}.ndjson`)
    .filter((relativePath) => !fs.existsSync(path.join(backupDir, relativePath)));
  const missingTransformedExports = expectedTables
    .map((table) => `cloudflare/d1-transformed/${table}.ndjson`)
    .filter((relativePath) => !fs.existsSync(path.join(backupDir, relativePath)));
  const validationMissingTables = validationMissingTablesForBackup(backupDir, expectedTables);

  return {
    createdAt: new Date().toISOString(),
    backupDir,
    ok:
      unexpectedTables.length === 0 &&
      missingExpectedTables.length === 0 &&
      duplicateSchemaTables.length === 0 &&
      missingCanonicalExports.length === 0 &&
      missingTransformedExports.length === 0 &&
      validationMissingTables.length === 0,
    expectedTables,
    schemaTables: [...schemaTableSet].sort(),
    explicitlyIgnoredTables: [...ignored].sort(),
    unexpectedTables,
    missingExpectedTables,
    duplicateSchemaTables,
    missingCanonicalExports,
    missingTransformedExports,
    validationMissingTables,
  };
}

export function sourceTableCoverageReportPath(backupDir: string) {
  return path.join(cloudflareDir(backupDir), path.basename(SOURCE_TABLE_COVERAGE_REPORT));
}

function parsePublicTablesFromSchema(backupDir: string) {
  const schemaPath = path.join(backupDir, "supabase", "schema-public.sql");
  if (!fs.existsSync(schemaPath)) return [];
  const schema = fs.readFileSync(schemaPath, "utf8");
  const tables: string[] = [];
  const patterns = [
    /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"public"\."([^"]+)"/giu,
    /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+public\.([A-Za-z_][A-Za-z0-9_]*)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of schema.matchAll(pattern)) {
      if (match[1]) tables.push(match[1]);
    }
  }
  return tables.sort();
}

function validationMissingTablesForBackup(backupDir: string, expectedTables: TableName[]) {
  const validationPath = path.join(backupDir, "supabase", "validation.json");
  if (!fs.existsSync(validationPath)) return [];
  try {
    const validation = JSON.parse(fs.readFileSync(validationPath, "utf8")) as {
      tables?: Record<string, unknown>;
      columns?: Record<string, unknown>;
    };
    return expectedTables.filter((table) => validation.tables?.[table] === undefined || validation.columns?.[table] === undefined);
  } catch {
    return expectedTables;
  }
}
