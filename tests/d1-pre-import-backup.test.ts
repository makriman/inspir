import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildD1PreImportBackupReport,
  checkD1PreImportBackup,
  d1PreImportBackupSqlPath,
  writeD1PreImportBackupReport,
} from "../scripts/cloudflare/d1-pre-import-backup";

test("D1 pre-import backup integrity accepts a matching SQL export and reports", () => {
  withBackupFixture((backupDir) => {
    const report = writeSqlAndReport(backupDir);
    const check = checkD1PreImportBackup({
      backupDir,
      database: "inspirlearning-prod",
      databaseId: "d1-id",
      report,
      importRunReport: report,
    });

    assert.equal(check.ok, true);
    assert.equal(check.detail.sqlExists, true);
    assert.equal(check.detail.reportSha256, check.detail.sqlSha256);
  });
});

test("D1 pre-import backup integrity rejects a tampered SQL export", () => {
  withBackupFixture((backupDir) => {
    const report = writeSqlAndReport(backupDir);
    fs.appendFileSync(d1PreImportBackupSqlPath(backupDir), "\n-- changed after export\n");

    const check = checkD1PreImportBackup({
      backupDir,
      database: "inspirlearning-prod",
      databaseId: "d1-id",
      report,
      importRunReport: report,
    });

    assert.equal(check.ok, false);
    assert.notEqual(check.detail.reportSha256, check.detail.sqlSha256);
  });
});

test("D1 pre-import backup integrity rejects import-run/report drift", () => {
  withBackupFixture((backupDir) => {
    const report = writeSqlAndReport(backupDir);
    const check = checkD1PreImportBackup({
      backupDir,
      database: "inspirlearning-prod",
      databaseId: "d1-id",
      report,
      importRunReport: { ...report, sha256: "0".repeat(64) },
    });

    assert.equal(check.ok, false);
    assert.equal(check.detail.importRunBackupMatchesReport, false);
  });
});

test("D1 pre-import backup integrity rejects import-run metadata drift", () => {
  withBackupFixture((backupDir) => {
    const report = writeSqlAndReport(backupDir);
    const check = checkD1PreImportBackup({
      backupDir,
      database: "inspirlearning-prod",
      databaseId: "d1-id",
      report,
      importRunReport: { ...report, databaseId: "other-d1-id" },
    });

    assert.equal(check.ok, false);
    assert.equal(check.detail.importRunBackupMatchesReport, false);
  });
});

test("D1 pre-import backup integrity rejects stale backup reports", () => {
  withBackupFixture((backupDir) => {
    const report = {
      ...writeSqlAndReport(backupDir),
      createdAt: "2026-06-26T00:00:00.000Z",
    };
    writeD1PreImportBackupReport(report, backupDir);
    const check = checkD1PreImportBackup({
      backupDir,
      database: "inspirlearning-prod",
      databaseId: "d1-id",
      report,
      importRunReport: report,
      nowMs: Date.parse("2026-06-26T02:00:01.000Z"),
      maxAgeMs: 60 * 60 * 1000,
    });

    assert.equal(check.ok, false);
    assert.equal(check.detail.reportFresh, false);
  });
});

function withBackupFixture(callback: (backupDir: string) => void) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-pre-import-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function writeSqlAndReport(backupDir: string) {
  fs.writeFileSync(d1PreImportBackupSqlPath(backupDir), "create table users(id text);\ninsert into users values('u1');\n");
  const report = buildD1PreImportBackupReport({
    backupDir,
    database: "inspirlearning-prod",
    databaseId: "d1-id",
    wranglerOutputExcerpt: "Exported D1 backup",
  });
  writeD1PreImportBackupReport(report, backupDir);
  return report;
}
