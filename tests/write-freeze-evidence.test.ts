import assert from "node:assert/strict";
import test from "node:test";
import { buildWriteFreezeReadinessReport } from "../scripts/cloudflare/write-freeze-evidence";

const backupDir = "/tmp/inspir-write-freeze-readiness";
const versionId = "11111111-1111-4111-8111-111111111111";
const statusUrl = "https://example.test/api/migration/write-freeze";

test("write-freeze readiness accepts an inactive endpoint with the expected contract", async () => {
  const report = await buildWriteFreezeReadinessReport(backupDir, {
    env: { MIGRATION_WRITE_FREEZE_STATUS_URL: statusUrl },
    fetchImpl: async () => Response.json(
      { writeFreezeActive: false, code: "write_freeze_inactive", versionId },
      { status: 409 },
    ),
  });

  assert.equal(report.ok, true);
  assert.equal(report.endpointContractOk, true);
  assert.equal(report.writeFreezeActive, false);
  assert.equal(report.versionId, versionId);
});

test("write-freeze readiness accepts an active endpoint with the expected contract", async () => {
  const report = await buildWriteFreezeReadinessReport(backupDir, {
    env: { MIGRATION_WRITE_FREEZE_STATUS_URL: statusUrl },
    fetchImpl: async () => Response.json(
      { writeFreezeActive: true, code: "write_freeze_active", versionId },
    ),
  });

  assert.equal(report.ok, true);
  assert.equal(report.endpointContractOk, true);
  assert.equal(report.writeFreezeActive, true);
  assert.equal(report.versionId, versionId);
});

test("write-freeze readiness rejects a missing or non-JSON endpoint", async () => {
  const report = await buildWriteFreezeReadinessReport(backupDir, {
    env: { MIGRATION_WRITE_FREEZE_STATUS_URL: statusUrl },
    fetchImpl: async () => new Response("<html>missing</html>", { status: 404 }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.endpointContractOk, false);
  assert.equal(report.writeFreezeActive, false);
  assert.equal(report.probe.status, 404);
  assert.match(report.problems.join("\n"), /write-freeze status endpoint is not reachable/);
});
