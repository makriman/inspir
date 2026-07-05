import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE,
  buildWriteFreezeEvidenceReport,
  buildWriteFreezeReadinessReport,
  requiredWriteFreezeEvidenceFiles,
  validateFinalWriteFreezeEvidenceReport,
} from "../scripts/cloudflare/write-freeze-evidence";

const backupDir = "/tmp/inspir-final-backup";

test("final backup write-freeze evidence requires confirmations and active probe", async () => {
  const report = await buildWriteFreezeEvidenceReport(backupDir, {
    finalBackup: true,
    env: {
      CONFIRM_WRITE_FREEZE: "1",
      CONFIRM_FINAL_BACKUP: "1",
      CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
      MIGRATION_WRITE_FREEZE_STATUS_URL: "https://example.test/api/migration/write-freeze",
    },
    fetchImpl: async () => Response.json({ writeFreezeActive: true, code: "write_freeze_active" }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.finalBackup, true);
  assert.equal(report.probe.ok, true);
  assert.equal(report.problems.length, 0);
});

test("final backup write-freeze evidence rejects missing confirmations", async () => {
  const report = await buildWriteFreezeEvidenceReport(backupDir, {
    finalBackup: true,
    env: { CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE: "1" },
    fetchImpl: async () => Response.json({ writeFreezeActive: true }),
  });

  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => problem.includes("CONFIRM_WRITE_FREEZE")));
  assert.ok(report.problems.some((problem) => problem.includes("CONFIRM_FINAL_BACKUP")));
  assert.ok(report.problems.some((problem) => problem.includes("CONFIRM_BACKUP_SOURCE_WRITES_FROZEN")));
  assert.ok(report.problems.some((problem) => problem.includes("WRITE_FREEZE_OPERATOR_EVIDENCE_FILE")));
});

test("final backup write-freeze evidence accepts probe waiver only with external freeze evidence", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-write-freeze-waiver-"));
  try {
    const backupDir = path.join(tempDir, "backup");
    const evidenceFile = path.join(tempDir, "freeze-evidence.md");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(evidenceFile, "Writes blocked by provider maintenance mode at 2026-06-26T14:00:00Z.\n");

    const report = await buildWriteFreezeEvidenceReport(backupDir, {
      finalBackup: true,
      env: {
        CONFIRM_WRITE_FREEZE: "1",
        CONFIRM_FINAL_BACKUP: "1",
        CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
        CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE: "1",
        CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED: "1",
        WRITE_FREEZE_OPERATOR_EVIDENCE_FILE: evidenceFile,
      },
      fetchImpl: async () => {
        throw new Error("should not fetch when probe is waived");
      },
    });

    assert.equal(report.ok, true);
    assert.equal(report.probe.waiverConfirmed, true);
    assert.equal(report.externalFreeze.required, true);
    assert.equal(report.externalFreeze.ok, true);
    assert.equal(report.externalFreeze.storedFile, WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE);
    assert.ok(report.externalFreeze.sha256);
    assert.equal(fs.existsSync(path.join(backupDir, WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE)), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("final backup write-freeze evidence rejects inactive probe", async () => {
  const report = await buildWriteFreezeEvidenceReport(backupDir, {
    finalBackup: true,
    env: {
      CONFIRM_WRITE_FREEZE: "1",
      CONFIRM_FINAL_BACKUP: "1",
      CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
      MIGRATION_WRITE_FREEZE_STATUS_URL: "https://example.test/api/migration/write-freeze",
    },
    fetchImpl: async () => Response.json({ writeFreezeActive: false, code: "write_freeze_inactive" }, { status: 409 }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.probe.ok, false);
  assert.ok(report.problems.includes("write-freeze status probe did not prove the serving app is frozen"));
});

test("final write-freeze validator accepts only fresh scoped clean evidence", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-write-freeze-validate-"));
  try {
    const backupDir = path.join(tempDir, "backup");
    fs.mkdirSync(backupDir, { recursive: true });
    const report = await buildWriteFreezeEvidenceReport(backupDir, {
      finalBackup: true,
      env: {
        CONFIRM_WRITE_FREEZE: "1",
        CONFIRM_FINAL_BACKUP: "1",
        CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
      },
      fetchImpl: async () => Response.json({ writeFreezeActive: true, code: "write_freeze_active" }),
    });

    const validation = validateFinalWriteFreezeEvidenceReport(report, {
      backupDir,
      maxAgeMs: 60 * 60 * 1000,
      nowMs: Date.parse(report.createdAt) + 60_000,
    });

    assert.equal(validation.ok, true);
    assert.deepEqual(validation.blockers, []);
    assert.equal(validation.detail.probeOk, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("final write-freeze validator rejects legacy probe waiver without stored external evidence", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-write-freeze-legacy-waiver-"));
  try {
    const backupDir = path.join(tempDir, "backup");
    fs.mkdirSync(backupDir, { recursive: true });
    const report = await buildWriteFreezeEvidenceReport(backupDir, {
      finalBackup: true,
      env: {
        CONFIRM_WRITE_FREEZE: "1",
        CONFIRM_FINAL_BACKUP: "1",
        CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
        CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE: "1",
      },
      fetchImpl: async () => {
        throw new Error("should not fetch when probe is waived");
      },
    });
    report.ok = true;
    report.problems = [];
    delete (report as { externalFreeze?: unknown }).externalFreeze;

    const validation = validateFinalWriteFreezeEvidenceReport(report, {
      backupDir,
      maxAgeMs: 60 * 60 * 1000,
      nowMs: Date.parse(report.createdAt) + 60_000,
    });

    assert.equal(validation.ok, false);
    assert.ok(validation.blockers.some((blocker) => blocker.includes("did not prove the application write-freeze state")));
    assert.ok(validation.blockers.some((blocker) => blocker.includes("waived the probe without a valid stored external freeze evidence file")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("final write-freeze validator rejects external evidence paths outside the backup", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-write-freeze-traversal-"));
  try {
    const backupDir = path.join(tempDir, "backup");
    const evidenceFile = path.join(tempDir, "freeze-evidence.md");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(evidenceFile, "Writes blocked by provider maintenance mode at 2026-06-26T14:00:00Z.\n");

    const report = await buildWriteFreezeEvidenceReport(backupDir, {
      finalBackup: true,
      env: {
        CONFIRM_WRITE_FREEZE: "1",
        CONFIRM_FINAL_BACKUP: "1",
        CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
        CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE: "1",
        CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED: "1",
        WRITE_FREEZE_OPERATOR_EVIDENCE_FILE: evidenceFile,
      },
      fetchImpl: async () => {
        throw new Error("should not fetch when probe is waived");
      },
    });
    report.externalFreeze.storedFile = "../freeze-evidence.md";

    const validation = validateFinalWriteFreezeEvidenceReport(report, {
      backupDir,
      maxAgeMs: 60 * 60 * 1000,
      nowMs: Date.parse(report.createdAt) + 60_000,
    });

    assert.equal(validation.ok, false);
    assert.equal(validation.detail.externalEvidenceFileOk, false);
    assert.deepEqual(requiredWriteFreezeEvidenceFiles(backupDir, report), ["cloudflare/write-freeze-report.json"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rehearsal backup write-freeze evidence is marked non-final", async () => {
  const report = await buildWriteFreezeEvidenceReport(backupDir, {
    finalBackup: false,
    env: {},
    fetchImpl: async () => {
      throw new Error("should not fetch for rehearsal backups");
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.finalBackup, false);
  assert.equal(report.probe.attempted, false);
});

test("write-freeze readiness accepts an inactive endpoint with the expected contract", async () => {
  const report = await buildWriteFreezeReadinessReport(backupDir, {
    env: { MIGRATION_WRITE_FREEZE_STATUS_URL: "https://example.test/api/migration/write-freeze" },
    fetchImpl: async () => Response.json({ writeFreezeActive: false, code: "write_freeze_inactive" }, { status: 409 }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.endpointContractOk, true);
  assert.equal(report.writeFreezeActive, false);
});

test("write-freeze readiness accepts an active endpoint with the expected contract", async () => {
  const report = await buildWriteFreezeReadinessReport(backupDir, {
    env: { MIGRATION_WRITE_FREEZE_STATUS_URL: "https://example.test/api/migration/write-freeze" },
    fetchImpl: async () => Response.json({ writeFreezeActive: true, code: "write_freeze_active" }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.endpointContractOk, true);
  assert.equal(report.writeFreezeActive, true);
});

test("write-freeze readiness rejects a missing or non-JSON endpoint", async () => {
  const report = await buildWriteFreezeReadinessReport(backupDir, {
    env: { MIGRATION_WRITE_FREEZE_STATUS_URL: "https://example.test/api/migration/write-freeze" },
    fetchImpl: async () =>
      new Response("<html>missing</html>", { status: 404, headers: { "content-type": "text/html" } }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.endpointContractOk, false);
  assert.equal(report.writeFreezeActive, false);
  assert.equal(report.probe.status, 404);
  assert.match(report.problems.join("\n"), /write-freeze status endpoint is not reachable/);
});
