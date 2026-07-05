import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCredentialRotationReport, credentialRotationEvidenceBlockers } from "../scripts/cloudflare/verify-credential-rotation";

const nowMs = Date.parse("2026-06-26T12:00:00.000Z");
const confirmations = {
  CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED: "1",
  CONFIRM_R2_MIGRATION_S3_KEY_REVOKED: "1",
  CONFIRM_VERCEL_ACCESS_REVOKED: "1",
  CONFIRM_SUPABASE_ACCESS_REVOKED: "1",
  CONFIRM_RETIRED_PROVIDER_ENV_UNSET: "1",
};

test("credential rotation report passes after clean provider retirement and explicit confirmations", async () => {
  await withFixture((backupDir) => {
    writeProviderRun(backupDir, providerRun({ createdAt: "2026-06-26T11:45:00.000Z", backupDir, ok: true }));

    const report = buildCredentialRotationReport(backupDir, { env: envWithRotationEvidence(backupDir), nowMs });

    assert.equal(report.ok, true);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.forbiddenEnvPresent, []);
    assert.equal(report.rotationEvidence.ok, true);
    assert.equal(report.confirmations.every((confirmation) => confirmation.confirmed), true);
  });
});

test("credential rotation report fails when provider retirement is stale or credentials remain in env", async () => {
  await withFixture((backupDir) => {
    writeProviderRun(backupDir, providerRun({ createdAt: "2026-06-26T10:30:00.000Z", backupDir, ok: true }));

    const report = buildCredentialRotationReport(backupDir, {
      env: {
        ...envWithRotationEvidence(backupDir),
        CLOUDFLARE_API_TOKEN: "present-but-redacted",
        CLOUDFLARE_API_TOKEN_FILE: "/tmp/present-but-redacted",
      },
      nowMs,
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("cloudflare/provider-retirement-run.json is older than one hour"));
    assert.ok(report.blockers.includes("CLOUDFLARE_API_TOKEN is still present in the operator environment"));
    assert.ok(report.blockers.includes("CLOUDFLARE_API_TOKEN_FILE is still present in the operator environment"));
    assert.deepEqual(report.forbiddenEnvPresent, ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN_FILE"]);
  });
});

test("credential rotation report fails when confirmations are missing", async () => {
  await withFixture((backupDir) => {
    writeProviderRun(backupDir, providerRun({ createdAt: "2026-06-26T11:45:00.000Z", backupDir, ok: true }));

    const report = buildCredentialRotationReport(backupDir, { env: {}, nowMs });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.includes("Missing CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED=1"));
    assert.equal(report.confirmations.every((confirmation) => !confirmation.confirmed), true);
  });
});

test("credential rotation report rejects Supabase and Postgres connection aliases", async () => {
  await withFixture((backupDir) => {
    writeProviderRun(backupDir, providerRun({ createdAt: "2026-06-26T11:45:00.000Z", backupDir, ok: true }));

    const report = buildCredentialRotationReport(backupDir, {
      env: {
        ...envWithRotationEvidence(backupDir),
        SUPABASE_DB_URL: "present-but-redacted",
        SUPABASE_DATABASE_URL: "present-but-redacted",
        POSTGRES_URL: "present-but-redacted",
        POSTGRES_PRISMA_URL: "present-but-redacted",
      },
      nowMs,
    });

    assert.equal(report.ok, false);
    assert.deepEqual(report.forbiddenEnvPresent, [
      "SUPABASE_DB_URL",
      "SUPABASE_DATABASE_URL",
      "POSTGRES_URL",
      "POSTGRES_PRISMA_URL",
    ]);
    assert.ok(report.blockers.includes("SUPABASE_DB_URL is still present in the operator environment"));
    assert.ok(report.blockers.includes("POSTGRES_PRISMA_URL is still present in the operator environment"));
  });
});

test("credential rotation report requires structured provider retirement proof", async () => {
  await withFixture((backupDir) => {
    writeProviderRun(backupDir, {
      createdAt: "2026-06-26T11:45:00.000Z",
      backupDir,
      ok: true,
      results: [{ provider: "vercel", ok: true, status: 204 }],
      postDeleteIdentity: { vercel: { found: false }, supabase: { found: false } },
      retirementSafety: { ok: true, blockers: [] },
    });

    const report = buildCredentialRotationReport(backupDir, { env: envWithRotationEvidence(backupDir), nowMs });

    assert.equal(report.ok, false);
    assert.ok(
      report.blockers.includes("cloudflare/provider-retirement-run.json: supabase deletion command was not recorded"),
    );
  });
});

test("credential rotation persisted evidence rejects shallow clean reports", () => {
  const blockers = credentialRotationEvidenceBlockers({
    createdAt: "2026-06-26T11:45:00.000Z",
    backupDir: "/tmp/inspir-backup-a",
    ok: true,
    confirmations: [
      {
        id: "cloudflare-api-token",
        env: "CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED",
        description: "The temporary Cloudflare API token used for DNS/migration work has been revoked or rotated.",
        confirmed: true,
      },
    ],
    rotationEvidence: { required: true, ok: false, problems: ["missing evidence"] },
    forbiddenEnvPresent: ["DATABASE_URL"],
    blockers: ["provider retirement was stale"],
  });

  assert.ok(blockers.includes("cloudflare/credential-rotation-report.json: provider retirement was stale"));
  assert.ok(blockers.includes("cloudflare/credential-rotation-report.json: DATABASE_URL was still present during rotation"));
  assert.ok(blockers.includes("cloudflare/credential-rotation-report.json has incomplete rotation confirmations"));
  assert.ok(blockers.includes("cloudflare/credential-rotation-report.json has no clean credential rotation evidence file"));
  assert.ok(blockers.includes("cloudflare/credential-rotation-report.json is missing CONFIRM_RETIRED_PROVIDER_ENV_UNSET confirmation"));
});

async function withFixture(callback: (backupDir: string) => void | Promise<void>) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-credential-rotation-"));
  try {
    fs.mkdirSync(path.join(backupDir, "cloudflare"), { recursive: true });
    await callback(backupDir);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

function writeProviderRun(backupDir: string, report: Record<string, unknown>) {
  fs.writeFileSync(path.join(backupDir, "cloudflare", "provider-retirement-run.json"), `${JSON.stringify(report, null, 2)}\n`);
}

function envWithRotationEvidence(backupDir: string) {
  const evidenceFile = path.join(backupDir, "rotation-receipt.txt");
  fs.writeFileSync(evidenceFile, "Cloudflare token, R2 key, Vercel access, and Supabase access were revoked.\n");
  return {
    ...confirmations,
    CREDENTIAL_ROTATION_EVIDENCE_FILE: evidenceFile,
  };
}

function providerRun(report: Record<string, unknown>) {
  return {
    ...report,
    results: [
      { provider: "vercel", ok: true, status: 204 },
      { provider: "supabase", ok: true, status: 0 },
    ],
    postDeleteIdentity: { vercel: { found: false }, supabase: { found: false } },
    retirementSafety: { ok: true, blockers: [] },
  };
}
