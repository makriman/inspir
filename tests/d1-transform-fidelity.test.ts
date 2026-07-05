import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  D1_TRANSFORM_FIDELITY_REPORT,
  buildD1TransformFidelityReport,
  timestampSubMillisecondPrecisionLoss,
  writeD1TransformFidelityReport,
} from "../scripts/cloudflare/d1-transform-fidelity";
import {
  TABLE_ORDER,
  timestampPrecisionPath,
  transformD1Row,
  type PgColumn,
  type TableName,
} from "../scripts/cloudflare/migration-config";

test("D1 transform fidelity passes when source timestamps are millisecond-exact", async () => {
  await withBackupFixture(async (backupDir) => {
    const report = await buildD1TransformFidelityReport(backupDir);

    assert.equal(report.ok, true);
    assert.equal(report.tables.length, TABLE_ORDER.length);
    assert.equal(report.totals.timestampValues, 1);
    assert.equal(report.totals.timestampPrecisionRows, 0);
    assert.equal(report.totals.problems, 0);
  });
});

test("D1 transform fidelity preserves sub-millisecond timestamp precision in a sidecar artifact", async () => {
  await withBackupFixture(
    async (backupDir) => {
      const report = await writeD1TransformFidelityReport(backupDir);
      const users = report.tables.find((table) => table.table === "users");
      const transformedUser = JSON.parse(
        fs.readFileSync(path.join(backupDir, "cloudflare", "d1-transformed", "users.ndjson"), "utf8").trim(),
      ) as Record<string, unknown>;
      const sidecarRows = fs
        .readFileSync(timestampPrecisionPath(backupDir), "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const persistedReport = JSON.parse(
        fs.readFileSync(path.join(backupDir, D1_TRANSFORM_FIDELITY_REPORT), "utf8"),
      ) as Record<string, unknown>;

      assert.equal(report.ok, true);
      assert.ok(users);
      assert.equal(users.ok, true);
      assert.equal(report.totals.timestampPrecisionRows, 1);
      assert.equal(report.timestampPrecisionArtifact.rows, 1);
      assert.equal(transformedUser.created_at, Date.parse("2026-06-01T00:00:00.123456+00:00"));
      assert.notEqual(transformedUser.created_at, "2026-06-01T00:00:00.123456+00:00");
      assert.equal(sidecarRows.length, 1);
      assert.deepEqual(sidecarRows[0], {
        source_table: "users",
        source_pk: "id=user-1",
        column_name: "created_at",
        original_timestamp: "2026-06-01T00:00:00.123456+00:00",
        d1_timestamp_ms: Date.parse("2026-06-01T00:00:00.123456+00:00"),
      });
      assert.equal("timestampPrecisionRows" in persistedReport, false);
    },
    { userCreatedAt: "2026-06-01T00:00:00.123456+00:00" },
  );
});

test("D1 transform fidelity fails when transformed artifacts drift from source transform", async () => {
  await withBackupFixture(
    async (backupDir) => {
      const report = await buildD1TransformFidelityReport(backupDir);
      const users = report.tables.find((table) => table.table === "users");

      assert.equal(report.ok, false);
      assert.ok(users);
      assert.equal(users.artifactRowsMatchTransform, false);
      assert.equal(users.problems[0]?.problem, "transformed artifact row does not match current transform");
    },
    { mutateTransformedUsers: true },
  );
});

test("timestamp precision helper allows zero-padded microseconds", () => {
  assert.equal(timestampSubMillisecondPrecisionLoss("2026-06-01T00:00:00.123000+00:00"), null);
  assert.deepEqual(timestampSubMillisecondPrecisionLoss("2026-06-01T00:00:00.123001+00:00"), {
    value: "2026-06-01T00:00:00.123001+00:00",
    millisecondFraction: "123",
    subMillisecondFraction: "001",
  });
});

async function withBackupFixture(
  callback: (backupDir: string) => Promise<void>,
  options: { userCreatedAt?: string; mutateTransformedUsers?: boolean } = {},
) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-fidelity-"));
  try {
    writeFixture(backupDir, options);
    await callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function writeFixture(backupDir: string, options: { userCreatedAt?: string; mutateTransformedUsers?: boolean }) {
  const canonicalDir = path.join(backupDir, "supabase", "canonical");
  const transformedDir = path.join(backupDir, "cloudflare", "d1-transformed");
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.mkdirSync(transformedDir, { recursive: true });

  const validationTables: Record<string, number> = {};
  const validationColumns: Record<string, PgColumn[]> = {};

  for (const table of TABLE_ORDER) {
    const columns = columnsForTable(table);
    const raw = rawRowForTable(table, options.userCreatedAt ?? "2026-06-01T00:00:00.123000+00:00");
    validationTables[table] = 1;
    validationColumns[table] = columns;
    fs.writeFileSync(path.join(canonicalDir, `${table}.ndjson`), `${JSON.stringify(raw)}\n`);

    const transformed = transformD1Row(raw, new Map(columns.map((column) => [column.column_name, column])));
    if (table === "users" && options.mutateTransformedUsers) transformed.id = "drifted";
    fs.writeFileSync(path.join(transformedDir, `${table}.ndjson`), `${JSON.stringify(transformed)}\n`);
  }

  fs.writeFileSync(
    path.join(backupDir, "supabase", "validation.json"),
    `${JSON.stringify({ createdAt: new Date().toISOString(), tables: validationTables, columns: validationColumns }, null, 2)}\n`,
  );
}

function columnsForTable(table: TableName): PgColumn[] {
  if (table === "users") {
    return [
      { column_name: "id", data_type: "text", udt_name: "text" },
      { column_name: "created_at", data_type: "timestamp with time zone", udt_name: "timestamptz" },
      { column_name: "score", data_type: "integer", udt_name: "int4" },
    ];
  }

  return [{ column_name: "id", data_type: "text", udt_name: "text" }];
}

function rawRowForTable(table: TableName, userCreatedAt: string) {
  if (table === "users") return { id: "user-1", created_at: userCreatedAt, score: 1 };
  return { id: `${table}-1` };
}
