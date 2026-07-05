import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOperatorUnblockReport } from "../scripts/cloudflare/operator-unblock-report";

test("operator unblock report summarizes external cutover blockers without secret values", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-operator-unblock-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    writeJson(backupDir, "cloudflare/migration-status-report.json", {
      createdAt: "2026-06-26T12:00:00.000Z",
      backupDir,
      readyForDeploy: false,
      readyForDnsCutover: false,
      readyForProviderRetirement: false,
      providersRetired: false,
      blockedStages: 6,
      stages: [
        { id: "write-freeze-readiness", name: "Live write-freeze endpoint readiness", status: "blocked", detail: {} },
        { id: "final-write-freeze-backup", name: "Final write-freeze backup evidence", status: "missing", detail: {} },
        { id: "cloudflare-token-capability", name: "Cloudflare API token capability", status: "blocked", detail: {} },
        { id: "dns-dry-run", name: "DNS cutover dry-run plan", status: "blocked", detail: {} },
        {
          id: "operator-env",
          name: "Operator environment for live cutover gates",
          status: "blocked",
          detail: { missing: ["requireLiveAi", "googleE2EEmail"] },
        },
        { id: "d1-import", name: "D1 exact import validation", status: "blocked", detail: {} },
      ],
    });
    writeJson(backupDir, "cloudflare/write-freeze-readiness-report.json", {
      url: "https://inspirlearning.com/api/migration/write-freeze",
      endpointContractOk: false,
      writeFreezeActive: false,
      problems: ["endpoint returned 404"],
    });
    writeJson(backupDir, "cloudflare/cloudflare-api-token-capability-report.json", {
      credentialSource: "file:CLOUDFLARE_API_TOKEN_FILE",
      failedChecks: 2,
      checks: [
        {
          name: "Cloudflare DNS records read",
          status: "fail",
          detail: { response: { status: 403 }, token: "plain-fixture-value" },
        },
      ],
      requiredPermissions: {
        accountId: "a1e5e542dc1d5fe5a5c6b2a10d755a81",
        zone: "inspirlearning.com",
        zonePermissions: ["Zone:Read"],
        dnsPermissions: ["DNS:Read", "DNS:Edit"],
        temporaryProbeRecord: "_codex-migration-token-check.inspirlearning.com",
      },
    });

    const report = buildOperatorUnblockReport(backupDir, { now: new Date("2026-06-26T12:05:00.000Z") });
    const itemIds = report.items.map((item) => item.id);

    assert.equal(report.ok, false);
    assert.deepEqual(itemIds, [
      "prove-write-freeze",
      "fix-cloudflare-dns-token",
      "provide-live-test-env",
      "run-final-cutover-sequence",
    ]);
    assert.match(JSON.stringify(report), /DNS:Edit/);
    assert.match(JSON.stringify(report), /CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1/);
    assert.match(JSON.stringify(report), /CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE=1/);
    assert.doesNotMatch(JSON.stringify(report), /plain-fixture-value/);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("operator unblock markdown includes sanitized current evidence", async () => {
  const reportModule = await import("../scripts/cloudflare/operator-unblock-report");
  const renderMarkdown = (reportModule as { renderMarkdown?: (report: unknown) => string }).renderMarkdown;
  assert.equal(typeof renderMarkdown, "function");

  const markdown = renderMarkdown!({
    createdAt: "2026-06-26T12:05:00.000Z",
    backupDir: "/tmp/backup",
    ok: false,
    readyForDeploy: false,
    readyForDnsCutover: false,
    readyForProviderRetirement: false,
    providersRetired: false,
    blockedStages: 1,
    safetyNote: "advisory",
    items: [
      {
        id: "fix-cloudflare-dns-token",
        title: "Use a Cloudflare token that can read and edit DNS records",
        blockedStages: ["cloudflare-token-capability"],
        currentEvidence: {
          failingChecks: [{ name: "Cloudflare DNS records read", detail: { response: { status: 403 }, token: "[REDACTED]" } }],
        },
        requiredAction: ["Create a DNS-capable token."],
        rerunCommands: ["CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 pnpm cf:verify:cloudflare-token"],
      },
    ],
  });

  assert.match(markdown, /Current evidence:/);
  assert.match(markdown, /Cloudflare DNS records read/);
  assert.match(markdown, /403/);
  assert.doesNotMatch(markdown, /cfat_/);
});

test("operator unblock report is clean only when migration status has no open items", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-operator-unblock-clean-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    writeJson(backupDir, "cloudflare/migration-status-report.json", {
      createdAt: "2026-06-26T12:00:00.000Z",
      backupDir,
      readyForDeploy: true,
      readyForDnsCutover: true,
      readyForProviderRetirement: true,
      providersRetired: true,
      blockedStages: 0,
      stages: [
        { id: "write-freeze-readiness", status: "pass" },
        { id: "final-write-freeze-backup", status: "pass" },
        { id: "cloudflare-token-capability", status: "pass" },
        { id: "dns-dry-run", status: "pass" },
        { id: "operator-env", status: "pass" },
        { id: "d1-import", status: "pass" },
      ],
    });

    const report = buildOperatorUnblockReport(backupDir, { now: new Date("2026-06-26T12:05:00.000Z") });

    assert.equal(report.ok, true);
    assert.deepEqual(report.items, []);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

function writeJson(backupDir: string, relativePath: string, value: unknown) {
  const absolutePath = path.join(backupDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}
