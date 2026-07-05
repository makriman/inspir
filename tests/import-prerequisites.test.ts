import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { D1_SIZE_SAFETY_REPORT } from "../scripts/cloudflare/d1-size-safety";
import { D1_TRANSFORM_FIDELITY_REPORT } from "../scripts/cloudflare/d1-transform-fidelity";
import {
  buildImportPrerequisiteReport,
  IMPORT_PREREQUISITE_MAX_AGE_MS,
} from "../scripts/cloudflare/import-prerequisites";
import {
  createHash,
  TABLE_ORDER,
  TIMESTAMP_PRECISION_RELATIVE_PATH,
  stableStringify,
  transformedTablePath,
  vectorizeManifestPath,
  vectorizeNdjsonPath,
} from "../scripts/cloudflare/migration-config";
import { buildRepoSourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import { SOURCE_TABLE_COVERAGE_REPORT } from "../scripts/cloudflare/source-table-coverage";
import {
  WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE,
  WRITE_FREEZE_REPORT,
  requiredWriteFreezeEvidenceFiles,
  type WriteFreezeEvidenceReport,
} from "../scripts/cloudflare/write-freeze-evidence";

const nowMs = Date.now();
const freshCreatedAt = new Date(nowMs - 15 * 60 * 1000).toISOString();
const staleCreatedAt = new Date(nowMs - IMPORT_PREREQUISITE_MAX_AGE_MS - 60 * 1000).toISOString();

test("D1 import prerequisites accept only fresh final write-freeze and local rehearsal evidence", () => {
  const backupDir = makeD1Fixture();
  writeEvidenceManifestAndVerifyReport(backupDir, requiredD1EvidenceFiles(backupDir));

  const report = buildImportPrerequisiteReport({ backupDir, kind: "d1", nowMs });

  assert.equal(report.ok, true);
  assert.equal(report.kind, "d1");
  assert.ok(report.requiredEvidenceFiles.includes("cloudflare/write-freeze-report.json"));
  assert.ok(report.artifactFingerprint?.sha256);
});

test("D1 import prerequisites reject empty runtime provider scan evidence", () => {
  const backupDir = makeD1Fixture();
  writeRuntimeProviderScanReport(backupDir, { ok: true, scannedFiles: [] });
  writeEvidenceManifestAndVerifyReport(backupDir, requiredD1EvidenceFiles(backupDir));

  const report = buildImportPrerequisiteReport({ backupDir, kind: "d1", nowMs });

  assert.equal(report.ok, false);
  assert.ok(report.requiredEvidenceFiles.includes("cloudflare/runtime-provider-scan-report.json"));
  assert.ok(report.blockers.some((blocker) => blocker.includes("runtime-provider-scan-report.json scanned no runtime files")));
});

test("D1 import prerequisites reject stale final write-freeze evidence", () => {
  const backupDir = makeD1Fixture();
  writeJson(backupDir, WRITE_FREEZE_REPORT, finalWriteFreezeReport(backupDir, staleCreatedAt));
  writeEvidenceManifestAndVerifyReport(backupDir, requiredD1EvidenceFiles(backupDir));

  const report = buildImportPrerequisiteReport({ backupDir, kind: "d1", nowMs });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.includes("write-freeze-report.json is older than one hour")));
});

test("D1 import prerequisites reject legacy probe waiver without external freeze evidence", () => {
  const backupDir = makeD1Fixture();
  const legacyWaiver = finalWriteFreezeReport(backupDir, freshCreatedAt);
  (legacyWaiver as {
    probe: { required: boolean; attempted: boolean; ok: boolean | null; waiverConfirmed?: boolean; writeFreezeActive?: boolean };
  }).probe = {
    required: false,
    attempted: false,
    ok: null,
    waiverConfirmed: true,
  };
  delete (legacyWaiver as { externalFreeze?: unknown }).externalFreeze;
  writeJson(backupDir, WRITE_FREEZE_REPORT, legacyWaiver);
  writeEvidenceManifestAndVerifyReport(backupDir, requiredD1EvidenceFiles(backupDir));

  const report = buildImportPrerequisiteReport({ backupDir, kind: "d1", nowMs });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.includes("did not prove the application write-freeze state")));
  assert.ok(report.blockers.some((blocker) => blocker.includes("waived the probe without a valid stored external freeze evidence file")));
});

test("D1 import prerequisites reject tampered external write-freeze evidence files", () => {
  const backupDir = makeD1Fixture();
  const report = finalWriteFreezeReport(backupDir, freshCreatedAt);
  report.probe = {
    required: false,
    attempted: false,
    ok: null,
    waiverConfirmed: true,
  };
  const storedEvidence = path.join(backupDir, WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE);
  fs.mkdirSync(path.dirname(storedEvidence), { recursive: true });
  fs.writeFileSync(storedEvidence, "writes frozen by maintenance mode\n");
  const evidenceSha256 = createHash().update(fs.readFileSync(storedEvidence)).digest("hex");
  report.externalFreeze = {
    required: true,
    confirmed: true,
    ok: true,
    storedFile: WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE,
    bytes: fs.statSync(storedEvidence).size,
    sha256: evidenceSha256,
    problems: [],
  };
  writeJson(backupDir, WRITE_FREEZE_REPORT, report);
  fs.appendFileSync(storedEvidence, "tampered\n");
  writeEvidenceManifestAndVerifyReport(backupDir, requiredD1EvidenceFiles(backupDir));

  const importReport = buildImportPrerequisiteReport({ backupDir, kind: "d1", nowMs });

  assert.equal(importReport.ok, false);
  assert.ok(importReport.requiredEvidenceFiles.includes(WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE));
  assert.ok(importReport.blockers.some((blocker) => blocker.includes("waived the probe without a valid stored external freeze evidence file")));
});

test("Vectorize import prerequisites reject artifact checksum drift", () => {
  const backupDir = makeVectorizeFixture();
  writeEvidenceManifestAndVerifyReport(backupDir, requiredVectorizeEvidenceFiles(backupDir));
  fs.writeFileSync(vectorizeNdjsonPath(backupDir), `${JSON.stringify({ id: "user_memories:1", values: [2], metadata: {} })}\n`);

  const report = buildImportPrerequisiteReport({ backupDir, kind: "vectorize", nowMs });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.includes("current Vectorize artifact checksum differs from vectorize-manifest.json"));
});

test("D1 import prerequisites require manifest verification to include transformed source files", () => {
  const backupDir = makeD1Fixture();
  writeEvidenceManifestAndVerifyReport(backupDir, [WRITE_FREEZE_REPORT]);

  const report = buildImportPrerequisiteReport({ backupDir, kind: "d1", nowMs });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.includes("does not include cloudflare/d1-transformed")));
});

function makeD1Fixture() {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-import-prereq-d1-"));
  fs.mkdirSync(path.join(backupDir, "cloudflare", "d1-transformed"), { recursive: true });
  writeJson(backupDir, WRITE_FREEZE_REPORT, finalWriteFreezeReport(backupDir, freshCreatedAt));
  writeJson(backupDir, SOURCE_TABLE_COVERAGE_REPORT, {
    ok: true,
    createdAt: freshCreatedAt,
    backupDir,
    expectedTables: TABLE_ORDER,
    schemaTables: TABLE_ORDER,
    unexpectedTables: [],
    missingCanonicalExports: [],
    missingTransformedExports: [],
  });
  writeJson(backupDir, D1_TRANSFORM_FIDELITY_REPORT, {
    ok: true,
    createdAt: freshCreatedAt,
    backupDir,
    timestampPrecisionArtifact: { file: TIMESTAMP_PRECISION_RELATIVE_PATH, rows: 1, sha256: "timestamp" },
    tables: TABLE_ORDER.map((table) => ({ table, ok: true })),
    totals: { rows: TABLE_ORDER.length },
  });
  writeJson(backupDir, D1_SIZE_SAFETY_REPORT, {
    ok: true,
    createdAt: freshCreatedAt,
    backupDir,
    tables: TABLE_ORDER.map((table) => ({ table, ok: true })),
  });
  writeJson(backupDir, "cloudflare/d1-local-rehearsal-report.json", {
    ok: true,
    createdAt: freshCreatedAt,
    backupDir,
    quickCheck: [{ quick_check: "ok" }],
    foreignKeyCheck: [],
    tables: TABLE_ORDER.map((table) => ({ table, ok: true })),
    timestampPrecision: { ok: true },
  });
  writeRuntimeProviderScanReport(backupDir);
  writeJson(
    backupDir,
    "cloudflare/d1-import-manifest.json",
    TABLE_ORDER.map((table) => ({ table, rows: 1, sha256: "fixture" })),
  );
  fs.writeFileSync(path.join(backupDir, TIMESTAMP_PRECISION_RELATIVE_PATH), `${JSON.stringify({ source_table: "users" })}\n`);
  for (const table of TABLE_ORDER) {
    fs.writeFileSync(transformedTablePath(backupDir, table), `${JSON.stringify({ id: `${table}-1` })}\n`);
  }
  return backupDir;
}

function makeVectorizeFixture() {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-import-prereq-vectorize-"));
  fs.mkdirSync(path.join(backupDir, "supabase"), { recursive: true });
  writeJson(backupDir, WRITE_FREEZE_REPORT, finalWriteFreezeReport(backupDir, freshCreatedAt));
  const row = { id: "user_memories:1", values: [1], metadata: {} };
  const artifactSha256 = createHash().update(`${stableStringify(row)}\n`).digest("hex");
  fs.writeFileSync(vectorizeNdjsonPath(backupDir), `${JSON.stringify(row)}\n`);
  writeJson(backupDir, "cloudflare/vectorize-manifest.json", {
    rows: 1,
    sha256: artifactSha256,
  });
  writeJson(backupDir, "cloudflare/vectorize-local-rehearsal-report.json", {
    ok: true,
    createdAt: freshCreatedAt,
    backupDir,
    failedChecks: 0,
    artifact: { rows: 1, sha256: artifactSha256 },
    manifest: { rows: 1, sha256: artifactSha256 },
  });
  writeRuntimeProviderScanReport(backupDir);
  for (const table of ["user_memories", "chat_memory_summaries", "chat_memory_turns"]) {
    fs.writeFileSync(path.join(backupDir, "supabase", `${table}-vectors.ndjson`), "");
  }
  return backupDir;
}

function finalWriteFreezeReport(backupDir: string, createdAt: string): WriteFreezeEvidenceReport {
  return {
    ok: true,
    createdAt,
    backupDir,
    finalBackup: true,
    confirmations: {
      writeFreezeConfirmed: true,
      finalBackupConfirmed: true,
      frozenSourceConfirmed: true,
    },
    probe: {
      required: true,
      attempted: true,
      ok: true,
      writeFreezeActive: true,
    },
    externalFreeze: {
      required: false,
      confirmed: false,
      ok: null,
      problems: [],
    },
    problems: [],
  };
}

function requiredD1EvidenceFiles(backupDir: string) {
  return [
    ...requiredWriteFreezeEvidenceFiles(backupDir),
    "cloudflare/runtime-provider-scan-report.json",
    SOURCE_TABLE_COVERAGE_REPORT,
    D1_TRANSFORM_FIDELITY_REPORT,
    D1_SIZE_SAFETY_REPORT,
    "cloudflare/d1-local-rehearsal-report.json",
    "cloudflare/d1-import-manifest.json",
    TIMESTAMP_PRECISION_RELATIVE_PATH,
    ...TABLE_ORDER.map((table) => path.relative(backupDir, transformedTablePath(backupDir, table))),
  ];
}

function requiredVectorizeEvidenceFiles(backupDir: string) {
  return [
    ...requiredWriteFreezeEvidenceFiles(backupDir),
    "cloudflare/runtime-provider-scan-report.json",
    "cloudflare/vectorize-local-rehearsal-report.json",
    path.relative(backupDir, vectorizeManifestPath(backupDir)),
    path.relative(backupDir, vectorizeNdjsonPath(backupDir)),
    "supabase/user_memories-vectors.ndjson",
    "supabase/chat_memory_summaries-vectors.ndjson",
    "supabase/chat_memory_turns-vectors.ndjson",
  ];
}

function writeRuntimeProviderScanReport(backupDir: string, overrides: Record<string, unknown> = {}) {
  const sourceFingerprint = buildRepoSourceFingerprint();
  writeJson(backupDir, "cloudflare/runtime-provider-scan-report.json", {
    ok: true,
    createdAt: freshCreatedAt,
    backupDir,
    sourceFingerprint: {
      sha256: sourceFingerprint.sha256,
      fileCount: sourceFingerprint.fileCount,
    },
    scannedFiles: ["app/api/chat/route.ts"],
    findings: [],
    ...overrides,
  });
}

function writeEvidenceManifestAndVerifyReport(backupDir: string, files: string[]) {
  const manifestCreatedAt = freshCreatedAt;
  const entries = files.map((file) => {
    const content = fs.readFileSync(path.join(backupDir, file));
    return {
      file,
      bytes: content.byteLength,
      sha256: "fixture-sha",
    };
  });
  writeJson(backupDir, "cloudflare/evidence-manifest.json", {
    createdAt: manifestCreatedAt,
    backupDir,
    files: entries,
  });
  writeJson(backupDir, "cloudflare/evidence-manifest-verify-report.json", {
    ok: true,
    createdAt: freshCreatedAt,
    backupDir,
    manifest: "cloudflare/evidence-manifest.json",
    manifestCreatedAt,
    manifestBackupDirOk: true,
    checkedFiles: entries.length,
    duplicateFiles: [],
    problems: [],
  });
  for (const file of files) {
    const verifiedBefore = new Date(nowMs - 30 * 60 * 1000);
    fs.utimesSync(path.join(backupDir, file), verifiedBefore, verifiedBefore);
  }
}

function writeJson(backupDir: string, relativePath: string, value: unknown) {
  const filePath = path.join(backupDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
