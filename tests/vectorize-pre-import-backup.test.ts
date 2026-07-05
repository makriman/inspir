import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkVectorizePreImportBackup,
  vectorizePreImportBackupNdjsonPath,
  writeVectorizePreImportBackup,
} from "../scripts/cloudflare/vectorize-pre-import-backup";

test("Vectorize pre-import backup integrity accepts matching exported vectors", () => {
  withBackupFixture((backupDir) => {
    const report = writeVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      listedIds: 2,
      rows: [
        { id: "b", values: vector(0.2), metadata: { userId: "u2" } },
        { id: "a", values: vector(0.1), metadata: { userId: "u1" } },
      ],
    });

    const check = checkVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      report,
      importRunReport: report,
    });

    assert.equal(check.ok, true);
    assert.equal(check.detail.fileRows, 2);
    assert.equal(fs.readFileSync(vectorizePreImportBackupNdjsonPath(backupDir), "utf8").split("\n")[0].includes('"id":"a"'), true);
  });
});

test("Vectorize pre-import backup integrity accepts an empty index backup", () => {
  withBackupFixture((backupDir) => {
    const report = writeVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      listedIds: 0,
      rows: [],
    });

    const check = checkVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      report,
      importRunReport: report,
    });

    assert.equal(check.ok, true);
    assert.equal(check.detail.fileRows, 0);
    assert.equal(check.detail.fileBytes, 0);
  });
});

test("Vectorize pre-import backup integrity rejects tampered backup files", () => {
  withBackupFixture((backupDir) => {
    const report = writeVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      listedIds: 1,
      rows: [{ id: "a", values: vector(0.1), metadata: {} }],
    });
    fs.appendFileSync(vectorizePreImportBackupNdjsonPath(backupDir), '{"id":"extra"}\n');

    const check = checkVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      report,
      importRunReport: report,
    });

    assert.equal(check.ok, false);
    assert.notEqual(check.detail.reportSha256, check.detail.fileSha256);
  });
});

test("Vectorize pre-import backup integrity rejects import-run/report drift", () => {
  withBackupFixture((backupDir) => {
    const report = writeVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      listedIds: 1,
      rows: [{ id: "a", values: vector(0.1), metadata: {} }],
    });

    const check = checkVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      report,
      importRunReport: { ...report, sha256: "0".repeat(64) },
    });

    assert.equal(check.ok, false);
    assert.equal(check.detail.importRunBackupMatchesReport, false);
  });
});

test("Vectorize pre-import backup integrity rejects import-run metadata drift", () => {
  withBackupFixture((backupDir) => {
    const report = writeVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      listedIds: 1,
      rows: [{ id: "a", values: vector(0.1), metadata: {} }],
    });

    const check = checkVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      report,
      importRunReport: { ...report, index: "other-index" },
    });

    assert.equal(check.ok, false);
    assert.equal(check.detail.importRunBackupMatchesReport, false);
  });
});

test("Vectorize pre-import backup integrity rejects stale backup reports", () => {
  withBackupFixture((backupDir) => {
    const generatedReport = writeVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      listedIds: 1,
      rows: [{ id: "a", values: vector(0.1), metadata: {} }],
    });
    const report = {
      ...generatedReport,
      createdAt: "2026-06-26T00:00:00.000Z",
    };

    const check = checkVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      report,
      importRunReport: report,
      nowMs: Date.parse("2026-06-26T02:00:01.000Z"),
      maxAgeMs: 60 * 60 * 1000,
    });

    assert.equal(check.ok, false);
    assert.equal(check.detail.reportFresh, false);
  });
});

test("Vectorize pre-import backup integrity rejects malformed backup rows", () => {
  withBackupFixture((backupDir) => {
    assert.throws(
      () =>
        writeVectorizePreImportBackup({
          backupDir,
          index: "inspirlearning-memory-prod",
          listedIds: 1,
          rows: [{ id: "a", values: [0.1], metadata: {} }],
        }),
      /values length is 1/,
    );

    fs.writeFileSync(
      vectorizePreImportBackupNdjsonPath(backupDir),
      `${JSON.stringify({ id: "a", values: vector(0.1), metadata: {} })}\n${JSON.stringify({
        id: "a",
        values: vector(0.2),
        metadata: {},
      })}\n`,
    );
    const report = {
      createdAt: new Date().toISOString(),
      backupDir,
      index: "inspirlearning-memory-prod",
      file: "cloudflare/vectorize-pre-import-backup.ndjson",
      rows: 2,
      bytes: fs.statSync(vectorizePreImportBackupNdjsonPath(backupDir)).size,
      sha256: "not-used",
      listedIds: 2,
    };

    const check = checkVectorizePreImportBackup({
      backupDir,
      index: "inspirlearning-memory-prod",
      report,
      importRunReport: report,
    });

    assert.equal(check.ok, false);
    assert.ok(check.detail.rowProblems.some((problem) => problem.includes("duplicate id a")));
  });
});

function withBackupFixture(callback: (backupDir: string) => void) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-vectorize-pre-import-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function vector(value: number) {
  return Array.from({ length: 512 }, () => value);
}
