import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hardenBackupPermissions } from "../scripts/cloudflare/harden-backup-permissions";

test("backup permission hardener restricts files and directories to owner access", async () => {
  await withFixture((backupDir) => {
    const nestedDir = path.join(backupDir, "supabase");
    const filePath = path.join(nestedDir, "data-public.sql");
    fs.mkdirSync(nestedDir, { recursive: true, mode: 0o755 });
    fs.writeFileSync(filePath, "select 1;\n", { mode: 0o644 });
    fs.chmodSync(backupDir, 0o755);
    fs.chmodSync(nestedDir, 0o755);
    fs.chmodSync(filePath, 0o644);

    const report = hardenBackupPermissions(backupDir);

    assert.equal(report.ok, true);
    assert.equal(mode(backupDir), 0o700);
    assert.equal(mode(nestedDir), 0o700);
    assert.equal(mode(filePath), 0o600);
    assert.equal(report.changedDirectories, 2);
    assert.equal(report.changedFiles, 1);
  });
});

test("backup permission hardener reports symlinks without following them", async () => {
  await withFixture((backupDir) => {
    const target = path.join(backupDir, "target.txt");
    const symlink = path.join(backupDir, "link.txt");
    fs.writeFileSync(target, "secret-ish backup data\n");
    fs.symlinkSync(target, symlink);

    const report = hardenBackupPermissions(backupDir, { dryRun: true });

    assert.equal(report.ok, false);
    assert.deepEqual(report.symlinks, ["link.txt"]);
  });
});

async function withFixture(callback: (backupDir: string) => void | Promise<void>) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-backup-perms-"));
  try {
    await callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function mode(targetPath: string) {
  return fs.statSync(targetPath).mode & 0o777;
}

