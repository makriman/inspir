import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  D1_FREE_MAX_DATABASE_BYTES,
  D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
  D1_FREE_STORAGE_SAFETY_MARGIN_BYTES,
  D1_MAX_ROW_BYTES,
  assertD1FreeStorageAdmission,
  d1DatabaseInfoArgs,
  measureD1SourceSnapshotStorage,
  measureD1TranslationStorageRow,
  parseD1DatabaseStorageInfo,
  projectD1FreeStorageAdmission,
  readD1DatabaseStorageInfo,
  type D1DatabaseStorageInfo,
  type D1SourceStorageEntry,
  type D1TranslationStorageRow,
} from "@/scripts/cloudflare/d1-free-storage-admission";
import {
  D1_DATABASE_ID,
  type WranglerRunner,
} from "@/scripts/cloudflare/migration-config";

const databaseUuid = D1_DATABASE_ID;

const database: D1DatabaseStorageInfo = {
  databaseName: "inspirlearning-prod",
  databaseUuid,
  databaseSizeBytes: 170_000_000,
  tableCount: 20,
};

const translationRows: readonly D1TranslationStorageRow[] = [
  {
    namespace: "route:home",
    language: "Spanish",
    sourceHash: "a".repeat(64),
    payloadJson: '{"site.key":"Aprender"}',
    model: "codex-curated-free-static-no-games-v7",
  },
  {
    namespace: "marketing-site",
    language: "Hindi",
    sourceHash: "b".repeat(64),
    payloadJson: '{"site.key":"सीखें"}',
    model: `legacy-marketing-site-composed-v1:${"c".repeat(64)}`,
  },
];

const sourceEntries: readonly D1SourceStorageEntry[] = [
  {
    namespace: "route:home",
    sourceHash: "a".repeat(64),
    sourceStrings: {
      "site.key": "Learn",
      "site.other": "Start learning",
    },
  },
];

test("D1 info parser and runner accept only deterministic storage metadata", () => {
  const output = JSON.stringify({
    uuid: databaseUuid.toUpperCase(),
    name: "inspirlearning-prod",
    created_at: "2026-07-14T00:00:00.000Z",
    num_tables: 20,
    database_size: 170_000_000,
    rows_read_24h: 100,
  });
  assert.deepEqual(parseD1DatabaseStorageInfo(output), database);
  assert.deepEqual(d1DatabaseInfoArgs(), [
    "d1",
    "info",
    "inspirlearning-prod",
    "--json",
  ]);

  const calls: Array<{
    args: string[];
    maxBuffer: number | undefined;
  }> = [];
  const runner: WranglerRunner = (args, options = {}) => {
    calls.push({ args: [...args], maxBuffer: options.maxBuffer });
    return output;
  };
  assert.deepEqual(readD1DatabaseStorageInfo(runner), database);
  assert.deepEqual(calls, [
    {
      args: ["d1", "info", "inspirlearning-prod", "--json"],
      maxBuffer: 1 * 1024 * 1024,
    },
  ]);

  for (const malformed of [
    "not-json",
    "[]",
    JSON.stringify({ ...JSON.parse(output), name: "another-database" }),
    JSON.stringify({ ...JSON.parse(output), uuid: "not-a-uuid" }),
    JSON.stringify({
      ...JSON.parse(output),
      uuid: "11111111-2222-4333-8444-555555555555",
    }),
    JSON.stringify({ ...JSON.parse(output), database_size: -1 }),
    JSON.stringify({ ...JSON.parse(output), database_size: 1.5 }),
    JSON.stringify({ ...JSON.parse(output), num_tables: "20" }),
  ]) {
    assert.throws(
      () => parseD1DatabaseStorageInfo(malformed),
      /deterministic JSON|non-object|malformed storage metadata/,
    );
  }
});

test("translation row measurement reserves metadata and index bytes inside D1 limits", () => {
  const measured = measureD1TranslationStorageRow(translationRows[1]);
  const row = translationRows[1];
  const expectedRowBytes =
    Buffer.byteLength(row.namespace) +
    Buffer.byteLength(row.language) +
    Buffer.byteLength(row.sourceHash) +
    Buffer.byteLength(row.payloadJson) +
    Buffer.byteLength(row.model) +
    16 +
    128;
  const expectedIndexBytes =
    Buffer.byteLength(row.namespace) +
    Buffer.byteLength(row.language) +
    64 +
    Buffer.byteLength(row.language) +
    64;
  assert.equal(measured.rowBytes, expectedRowBytes);
  assert.equal(measured.indexBytes, expectedIndexBytes);
  assert.equal(measured.persistentBytes, measured.rowBytes + measured.indexBytes);

  assert.throws(
    () =>
      measureD1TranslationStorageRow({
        ...translationRows[0],
        payloadJson: "x".repeat(D1_MAX_ROW_BYTES - 1),
      }),
    /translation row exceeds the 2000000-byte row limit/,
  );
  assert.throws(
    () =>
      measureD1TranslationStorageRow({
        ...translationRows[0],
        model: "",
      }),
    /translation model must be non-empty/,
  );
});

test("source snapshot measurement includes both table rows and their primary indexes", () => {
  const measured = measureD1SourceSnapshotStorage(sourceEntries);
  const entry = sourceEntries[0];
  assert.ok(entry);
  const sourceRowBytes =
    Buffer.byteLength(entry.namespace) +
    Buffer.byteLength(entry.sourceHash) +
    8 +
    128;
  const sourceRowIndexBytes = Buffer.byteLength(entry.namespace) + 64;
  const sourceStringBytes = Object.entries(entry.sourceStrings).reduce(
    (total, [key, value]) =>
      total +
      Buffer.byteLength(entry.namespace) +
      Buffer.byteLength(key) +
      Buffer.byteLength(value) +
      128 +
      Buffer.byteLength(entry.namespace) +
      Buffer.byteLength(key) +
      64,
    0,
  );
  assert.equal(measured.rows, 3);
  assert.equal(
    measured.persistentBytes,
    sourceRowBytes + sourceRowIndexBytes + sourceStringBytes,
  );
  assert.ok(measured.maximumRowBytes > 0);
  assert.throws(
    () => measureD1SourceSnapshotStorage([...sourceEntries, sourceEntries[0]]),
    /Duplicate D1 source namespace/,
  );
  assert.throws(
    () =>
      measureD1SourceSnapshotStorage([
        {
          namespace: "oversized-source",
          sourceHash: "a".repeat(64),
          sourceStrings: { huge: "x".repeat(D1_MAX_ROW_BYTES) },
        },
      ]),
    /source row exceeds the 2000000-byte row limit/,
  );
});

test("Free storage projection retains a fixed 50 MB margin and fails closed", () => {
  const baseline = projectD1FreeStorageAdmission({
    database: { ...database, databaseSizeBytes: 0 },
    translationRows,
    sourceEntries,
  });
  assert.equal(baseline.freeDatabaseLimitBytes, D1_FREE_MAX_DATABASE_BYTES);
  assert.equal(baseline.safetyMarginBytes, D1_FREE_STORAGE_SAFETY_MARGIN_BYTES);
  assert.equal(
    baseline.admissionCeilingBytes,
    D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
  );
  assert.ok(baseline.plannedTranslationRowBytes > 0);
  assert.ok(baseline.plannedTranslationIndexBytes > 0);
  assert.equal(baseline.plannedSourceRows, 3);
  assert.ok(baseline.plannedSourceRowAndIndexBytes > 0);
  assert.equal(
    baseline.projectedGrowthBytes,
    Math.ceil((baseline.plannedPersistentBytes * 3) / 2) + 16 * 1024 * 1024,
  );

  const exactBoundary = projectD1FreeStorageAdmission({
    database: {
      ...database,
      databaseSizeBytes:
        D1_FREE_STORAGE_ADMISSION_CEILING_BYTES - baseline.projectedGrowthBytes,
    },
    translationRows,
    sourceEntries,
  });
  assert.equal(
    exactBoundary.projectedFinalDatabaseBytes,
    D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
  );
  assert.equal(exactBoundary.admissible, true);
  assert.equal(assertD1FreeStorageAdmission(exactBoundary), exactBoundary);

  const overBoundary = projectD1FreeStorageAdmission({
    database: {
      ...database,
      databaseSizeBytes: exactBoundary.currentDatabaseBytes + 1,
    },
    translationRows,
    sourceEntries,
  });
  assert.equal(overBoundary.admissible, false);
  assert.throws(
    () => assertD1FreeStorageAdmission(overBoundary),
    /exceeds the Workers Free storage safety ceiling/,
  );
});

test("tracked D1 schema matches every table and index included by storage admission", () => {
  const migration = fs.readFileSync(
    path.resolve("drizzle-d1/0000_majestic_invisible_woman.sql"),
    "utf8",
  );
  assert.match(
    migration,
    /CREATE TABLE `app_translations`[\s\S]*PRIMARY KEY\(`namespace`, `language`\)/,
  );
  assert.match(
    migration,
    /CREATE INDEX `app_translations_language_idx` ON `app_translations` \(`language`\)/,
  );
  assert.match(
    migration,
    /CREATE TABLE `app_translation_sources`[\s\S]*`namespace` text PRIMARY KEY NOT NULL/,
  );
  assert.match(
    migration,
    /CREATE TABLE `app_translation_source_strings`[\s\S]*PRIMARY KEY\(`namespace`, `source_key`\)/,
  );
});

test("exact 8,694-row projection covers adversarial SQLite table and index page growth", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-storage-pages-"));
  const databasePath = path.join(root, "projection.sqlite");
  const sqlite = new DatabaseSync(databasePath);
  const rows = Array.from({ length: 126 * 69 }, (_, index) => {
    const namespace = `route:${Math.floor(index / 69)}`;
    const language = `language:${index % 69}`;
    return {
      namespace,
      language,
      sourceHash: "a".repeat(64),
      payloadJson: JSON.stringify({
        key: `${"界".repeat(index % 37)} translated value ${index}`,
      }),
      model: "codex-curated-free-static-no-games-v7",
    } satisfies D1TranslationStorageRow;
  });
  const sources = Array.from({ length: 126 }, (_, index) => ({
    namespace: `route:${index}`,
    sourceHash: "a".repeat(64),
    sourceStrings: {
      key: `${"source ".repeat((index % 11) + 1)}${index}`,
    },
  })) satisfies D1SourceStorageEntry[];

  try {
    sqlite.exec(`
      PRAGMA page_size = 4096;
      VACUUM;
      CREATE TABLE app_translations (
        namespace TEXT NOT NULL,
        language TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, language)
      );
      CREATE INDEX app_translations_language_idx ON app_translations(language);
      CREATE TABLE app_translation_sources (
        namespace TEXT PRIMARY KEY NOT NULL,
        source_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE app_translation_source_strings (
        namespace TEXT NOT NULL,
        source_key TEXT NOT NULL,
        source_text TEXT NOT NULL,
        PRIMARY KEY(namespace, source_key)
      );
    `);
    const baselinePages = pragmaInteger(sqlite, "page_count");
    const pageSize = pragmaInteger(sqlite, "page_size");
    const insertTranslation = sqlite.prepare(
      "INSERT INTO app_translations VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertSource = sqlite.prepare(
      "INSERT INTO app_translation_sources VALUES (?, ?, ?)",
    );
    const insertSourceString = sqlite.prepare(
      "INSERT INTO app_translation_source_strings VALUES (?, ?, ?)",
    );
    sqlite.exec("BEGIN");
    for (const row of rows) {
      insertTranslation.run(
        row.namespace,
        row.language,
        row.sourceHash,
        row.payloadJson,
        row.model,
        1_720_000_000_000,
        1_720_000_000_000,
      );
    }
    for (const entry of sources) {
      insertSource.run(entry.namespace, entry.sourceHash, 1_720_000_000_000);
      for (const [key, value] of Object.entries(entry.sourceStrings)) {
        insertSourceString.run(entry.namespace, key, value);
      }
    }
    sqlite.exec("COMMIT");
    const actualGrowthBytes =
      (pragmaInteger(sqlite, "page_count") - baselinePages) * pageSize;
    const projection = projectD1FreeStorageAdmission({
      database: { ...database, databaseSizeBytes: 0 },
      translationRows: rows,
      sourceEntries: sources,
    });

    assert.equal(projection.plannedTranslationRows, 8_694);
    assert.equal(projection.plannedSourceRows, 252);
    assert.equal(projection.plannedSourceMaximumRowBytes <= D1_MAX_ROW_BYTES, true);
    assert.equal(projection.projectedGrowthBytes >= actualGrowthBytes, true);
  } finally {
    sqlite.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function pragmaInteger(databaseHandle: DatabaseSync, pragma: string) {
  const row: unknown = databaseHandle.prepare(`PRAGMA ${pragma}`).get();
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error(`SQLite PRAGMA ${pragma} returned an invalid row.`);
  }
  const value = Reflect.get(row, pragma);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`SQLite PRAGMA ${pragma} returned an invalid integer.`);
  }
  return value;
}
