import assert from "node:assert/strict";
import test from "node:test";
import {
  validateFinalCutoverCommandSequence,
  type CutoverCommandStepForValidation,
} from "../scripts/cloudflare/final-cutover-runbook-validation";

test("final cutover runbook validation accepts the guarded command order", () => {
  const report = validateFinalCutoverCommandSequence(baseSteps());

  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.actualOrder, report.expectedOrder);
});

test("final cutover runbook validation accepts duplicate secret cleanup only before DNS dry run", () => {
  const steps = baseSteps();
  steps.splice(
    4,
    0,
    guardedStep("cleanup-duplicate-secrets", true, "pnpm cf:cleanup:duplicate-secrets\npnpm cf:preflight:production", {
      CONFIRM_ENV_SECRET_CLEANUP: "1",
      CONFIRM_BACKUP_DIR: "/backup",
      CONFIRM_DUPLICATE_SECRET_KEYS: "NEXTAUTH_URL",
      CONFIRM_RETIRED_SUPABASE_SECRET_KEYS: "DATABASE_URL",
      CONFIRM_SECRET_CLEANUP_KEYS: "DATABASE_URL,NEXTAUTH_URL",
    }),
  );

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, true);
});

test("final cutover runbook validation rejects provider deletion before production proof", () => {
  const steps = baseSteps();
  const retire = steps.splice(steps.findIndex((item) => item.id === "retire-providers-apply"), 1)[0];
  assert.ok(retire);
  steps.splice(steps.findIndex((item) => item.id === "post-cutover-validation"), 0, retire);

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /step order mismatch/);
});

test("final cutover runbook validation rejects DNS dry run with apply flag", () => {
  const steps = baseSteps();
  const dnsDryRun = steps.find((item) => item.id === "dns-dry-run");
  assert.ok(dnsDryRun);
  dnsDryRun.command = "pnpm cf:dns:prepare-cutover -- --apply";

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /dns-dry-run command must not include --apply/);
});

test("final cutover runbook validation requires DNS write probe confirmation on token verifier", () => {
  const steps = baseSteps();
  const dnsDryRun = steps.find((item) => item.id === "dns-dry-run");
  assert.ok(dnsDryRun);
  dnsDryRun.command = [
    "pnpm cf:verify:cloudflare-token",
    "CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 pnpm cf:dns:prepare-cutover",
  ].join("\n");

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(
    report.problems.join("\n"),
    /dns-dry-run command is missing CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 and pnpm cf:verify:cloudflare-token on the same line/,
  );
});

test("final cutover runbook validation requires documented write-freeze waiver evidence path", () => {
  const steps = baseSteps();
  const refresh = steps.find((item) => item.id === "refresh-final-backup");
  assert.ok(refresh);
  refresh.command = refresh.command
    .split("\n")
    .filter(
      (line) =>
        !line.includes("Waiver path") &&
        !line.includes("Write freeze externally enforced for inspirlearning.com") &&
        !line.includes("CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE") &&
        !line.includes("CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED") &&
        !line.includes("WRITE_FREEZE_OPERATOR_EVIDENCE_FILE="),
    )
    .join("\n");

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /refresh-final-backup command text is missing Waiver path/);
  assert.match(
    report.problems.join("\n"),
    /refresh-final-backup command text is missing WRITE_FREEZE_OPERATOR_EVIDENCE_FILE=/,
  );
});

test("final cutover runbook validation rejects D1 skip-reset imports", () => {
  const steps = baseSteps();
  const importD1 = steps.find((item) => item.id === "import-d1");
  assert.ok(importD1);
  importD1.command = `${importD1.command} --skip-reset`;

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /import-d1 command must not include --skip-reset/);
});

test("final cutover runbook validation requires live deploy gates", () => {
  const steps = baseSteps();
  const deployWorker = steps.find((item) => item.id === "deploy-worker");
  assert.ok(deployWorker);
  deployWorker.requiredEnv = { CONFIRM_WRITE_FREEZE: "1" };
  deployWorker.command = "CONFIRM_WRITE_FREEZE=1 pnpm cf:deploy";

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /deploy-worker is missing required env gate REQUIRE_LIVE_AI/);
  assert.match(report.problems.join("\n"), /deploy-worker is missing required env gate E2E_GOOGLE_IS_ADMIN/);
});

test("final cutover runbook validation requires post-deploy status and checklist refresh", () => {
  const steps = baseSteps();
  const postCutover = steps.find((item) => item.id === "post-cutover-validation");
  assert.ok(postCutover);
  postCutover.command = [
    "pnpm cf:verify:dns-cutover",
    "pnpm cf:verify:production",
    "pnpm cf:test:e2e:production",
    "pnpm cf:migration:validate:d1:post-cutover",
    "pnpm cf:migration:validate:vectorize:post-cutover",
    "pnpm cf:evidence:verify",
  ].join("\n");

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /post-cutover-validation command is missing pnpm cf:status:migration/);
  assert.match(report.problems.join("\n"), /post-cutover-validation command is missing pnpm cf:cutover:checklist/);
});

test("final cutover runbook validation requires reviewed provider deletion plan fingerprint", () => {
  const steps = baseSteps();
  const retire = steps.find((item) => item.id === "retire-providers-apply");
  assert.ok(retire);
  delete retire.requiredEnv?.CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT;
  retire.command = retire.command.replace(/CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT='fingerprint'\s*/, "");

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(
    report.problems.join("\n"),
    /retire-providers-apply is missing required env gate CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT/,
  );
});

test("final cutover runbook validation rejects mutating steps without explicit confirmations", () => {
  const steps = baseSteps();
  const importD1 = steps.find((item) => item.id === "import-d1");
  assert.ok(importD1);
  importD1.requiredEnv = {};

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /import-d1 mutates production but has no explicit CONFIRM_\* env gate/);
  assert.match(report.problems.join("\n"), /import-d1 is missing required env gate CONFIRM_D1_IMPORT/);
});

test("final cutover runbook validation ignores comments when matching commands", () => {
  const steps = baseSteps();
  const refresh = steps.find((item) => item.id === "refresh-final-backup");
  assert.ok(refresh);
  refresh.command = refresh.command
    .split("\n")
    .map((line) => (line.includes("pnpm cf:migration:backup -- --final") ? `# ${line}` : line))
    .join("\n");

  const report = validateFinalCutoverCommandSequence(steps);

  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /refresh-final-backup command is missing pnpm cf:migration:backup -- --final/);
});

function baseSteps(): CutoverCommandStepForValidation[] {
  return [
    guardedStep(
      "refresh-final-backup",
      false,
      [
        "pnpm cf:check:write-freeze",
        "pnpm cf:migration:backup -- --final",
        "# Waiver path: use this instead of the final backup command above only if the currently serving app cannot expose the status URL.",
        "# The evidence file must contain no secrets; include operator name, timestamp, exact freeze method, and verification links/commands/screenshots.",
        '# mkdir -p "/backup/operator"',
        '# cat > "/backup/operator/write-freeze-evidence.txt" <<\'EOF\'',
        "# Write freeze externally enforced for inspirlearning.com",
        "# Date: <ISO timestamp>",
        "# Operator: <name>",
        "# Method: <how writes were frozen on the currently serving production app>",
        "# Verification: <screenshots/logs/tickets/commands proving writes are blocked>",
        "# EOF",
        '# chmod 600 "/backup/operator/write-freeze-evidence.txt"',
        '# CONFIRM_WRITE_FREEZE="1" CONFIRM_FINAL_BACKUP="1" CONFIRM_BACKUP_SOURCE_WRITES_FROZEN="1" CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE="1" CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED="1" WRITE_FREEZE_OPERATOR_EVIDENCE_FILE="/backup/operator/write-freeze-evidence.txt" pnpm cf:migration:backup -- --final',
        "pnpm cf:migration:prepare",
        "pnpm cf:migration:rehearse:d1:local",
        "pnpm cf:migration:rehearse:vectorize:local",
        "pnpm cf:verify:local",
        "pnpm cf:test:e2e:preview",
        "pnpm cf:evidence:verify",
      ].join("\n"),
      {
        CONFIRM_WRITE_FREEZE: "1",
        CONFIRM_FINAL_BACKUP: "1",
        CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
      },
    ),
    guardedStep("import-d1", true, "pnpm cf:migration:import:d1", {
      CONFIRM_WRITE_FREEZE: "1",
      CONFIRM_D1_IMPORT: "1",
      CONFIRM_D1_DATABASE_NAME: "inspirlearning-prod",
      CONFIRM_D1_DATABASE_ID: "d1",
      CONFIRM_BACKUP_DIR: "/backup",
    }),
    guardedStep("import-vectorize", true, "pnpm cf:migration:import:vectorize -- --reset", {
      CONFIRM_WRITE_FREEZE: "1",
      CONFIRM_CLOUDFLARE_ACCOUNT_ID: "account",
      CONFIRM_VECTORIZE_IMPORT: "1",
      CONFIRM_VECTORIZE_RESET: "1",
      CONFIRM_VECTORIZE_INDEX: "index",
      CONFIRM_BACKUP_DIR: "/backup",
    }),
    step(
      "validate-data",
      false,
      "pnpm cf:migration:validate:d1\npnpm cf:preflight:production\npnpm cf:status:migration\npnpm cf:cutover:checklist\npnpm cf:evidence:verify",
    ),
    guardedStep(
      "dns-dry-run",
      true,
      "CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 pnpm cf:verify:cloudflare-token\npnpm cf:dns:prepare-cutover",
      {
        CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE: "1",
      },
    ),
    guardedStep("dns-apply", true, "pnpm cf:dns:prepare-cutover -- --apply", {
      CONFIRM_DNS_PLAN_FINGERPRINT: "fingerprint",
      CONFIRM_DNS_CUTOVER: "1",
      CONFIRM_WRITE_FREEZE: "1",
      CONFIRM_WORKER_CUSTOM_DOMAIN_DEPLOY: "1",
      CONFIRM_BACKUP_DIR: "/backup",
    }),
    guardedStep("deploy-worker", true, "pnpm cf:deploy", {
      CONFIRM_WRITE_FREEZE: "1",
      REQUIRE_LIVE_AI: "1",
      E2E_GOOGLE_IS_ADMIN: "1",
    }),
    guardedStep(
      "post-cutover-validation",
      false,
      [
        "pnpm cf:verify:dns-cutover",
        "pnpm cf:verify:production",
        "pnpm cf:test:e2e:production",
        "pnpm cf:migration:validate:d1:post-cutover",
        "pnpm cf:migration:validate:vectorize:post-cutover",
        "pnpm cf:status:migration",
        "pnpm cf:cutover:checklist",
        "pnpm cf:evidence:verify",
      ].join("\n"),
      {
        REQUIRE_LIVE_AI: "1",
        E2E_GOOGLE_IS_ADMIN: "1",
      },
    ),
    step(
      "retire-providers-preflight",
      false,
      "pnpm cf:evidence:verify\npnpm cf:preflight:retire-providers\npnpm cf:retire-providers\npnpm cf:status:migration\npnpm cf:cutover:checklist",
    ),
    guardedStep("retire-providers-apply", true, "pnpm cf:evidence:verify\npnpm cf:retire-providers -- --apply", {
      CONFIRM_PROVIDER_RETIREMENT: "1",
      CONFIRM_PROVIDER_HARD_DELETE: "1",
      CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT: "fingerprint",
      CONFIRM_BACKUP_DIR: "/backup",
      CONFIRM_VERCEL_PROJECT_ID: "vercel",
      CONFIRM_SUPABASE_PROJECT_REF: "supabase",
    }),
    guardedStep(
      "verify-credential-rotation",
      true,
      "unset CLOUDFLARE_API_TOKEN CF_API_TOKEN CLOUDFLARE_API_TOKEN_FILE CF_API_TOKEN_FILE\npnpm cf:verify:credential-rotation\npnpm cf:evidence:verify",
      {
        CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED: "1",
        CONFIRM_R2_MIGRATION_S3_KEY_REVOKED: "1",
        CONFIRM_VERCEL_ACCESS_REVOKED: "1",
        CONFIRM_SUPABASE_ACCESS_REVOKED: "1",
        CONFIRM_RETIRED_PROVIDER_ENV_UNSET: "1",
        CREDENTIAL_ROTATION_EVIDENCE_FILE: "/backup/rotation-receipt.txt",
      },
    ),
  ];
}

function step(
  id: string,
  mutates: boolean,
  command: string,
  requiredEnv?: Record<string, string>,
): CutoverCommandStepForValidation {
  return { id, mutates, command, requiredEnv };
}

function guardedStep(
  id: string,
  mutates: boolean,
  command: string,
  requiredEnv: Record<string, string>,
): CutoverCommandStepForValidation {
  return step(id, mutates, `${envPrefix(requiredEnv)} ${command}`, requiredEnv);
}

function envPrefix(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
}
