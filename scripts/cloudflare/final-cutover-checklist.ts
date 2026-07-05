import fs from "node:fs";
import path from "node:path";
import {
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  MEMORY_POST_TURN_DLQ_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  R2_BUCKET_NAME,
  TIMESTAMP_PRECISION_RELATIVE_PATH,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  resolveBackupDir,
} from "./migration-config";
import {
  EVIDENCE_MANIFEST_RELATIVE_PATH,
  EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH,
  writeEvidenceManifest,
} from "./evidence-manifest";
import {
  validateFinalCutoverCommandSequence,
  type CutoverRunbookValidationReport,
} from "./final-cutover-runbook-validation";
import { D1_PRE_IMPORT_BACKUP_REPORT, D1_PRE_IMPORT_BACKUP_SQL } from "./d1-pre-import-backup";
import {
  VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
  VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
} from "./vectorize-pre-import-backup";
import { FORBIDDEN_ENV_AFTER_ROTATION } from "./retired-provider-env";
import {
  WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE,
  WRITE_FREEZE_READINESS_REPORT,
} from "./write-freeze-evidence";
import { WORKER_DEPLOY_REPORT } from "./worker-deploy-evidence";
import {
  PROVIDER_RETIREMENT_DRY_RUN_PLAN,
  PROVIDER_RETIREMENT_RUN_REPORT,
} from "./provider-retirement-safety";

type MigrationStage = {
  id: string;
  name: string;
  status: "pass" | "blocked" | "missing" | string;
  detail?: unknown;
};

type MigrationStatusReport = {
  createdAt?: string;
  ok?: boolean;
  readyForDeploy?: boolean;
  readyForDnsCutover?: boolean;
  readyForProviderRetirement?: boolean;
  providersRetired?: boolean;
  stages?: MigrationStage[];
};

type DnsPlanReport = {
  apply?: boolean;
  ok?: boolean;
  planFingerprint?: string;
};

type ProviderRetirementDryRunReport = {
  apply?: boolean;
  dryRun?: boolean;
  planFingerprint?: string;
};

type VercelProjectBackup = {
  projectName?: string;
  projectId?: string;
  orgId?: string;
};

type SupabaseProjectBackup = {
  projectRef?: string;
  ref?: string;
  id?: string;
  organizationId?: string;
  organization_id?: string;
  name?: string;
};

type EnvMigrationInventory = {
  duplicateSecretAndVarKeys?: string[];
  retiredSupabaseSecrets?: string[];
};

type CommandStep = {
  id: string;
  title: string;
  mutates: boolean;
  requiredEnv?: Record<string, string>;
  requiredSecretEnv?: string[];
  command: string;
  gate: string;
};

const EXPECTED_SUPABASE_ORG_ID = "eovjqnvuqfmflaplfoue";
const WORKER_NAME = "inspirlearning";
const DOMAIN = "inspirlearning.com";
const WWW_DOMAIN = "www.inspirlearning.com";

const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const jsonOutputPath = path.join(cfDir, "final-cutover-checklist.json");
const markdownOutputPath = path.join(cfDir, "final-cutover-checklist.md");

void main();

function main() {
  const migrationStatus = readJson<MigrationStatusReport>("cloudflare/migration-status-report.json");
  const dnsPlan = readJson<DnsPlanReport>("cloudflare/dns-cutover-plan.json");
  const providerRetirementDryRun = readJson<ProviderRetirementDryRunReport>(PROVIDER_RETIREMENT_DRY_RUN_PLAN);
  const envInventory = readJson<EnvMigrationInventory>("cloudflare/env-migration-inventory.json");
  const vercelProject = readJson<VercelProjectBackup>("vercel/project.json");
  const supabaseProject = readJson<SupabaseProjectBackup>("supabase/project.json");
  const supabaseProjectRef = supabaseProject?.projectRef ?? supabaseProject?.ref ?? supabaseProject?.id ?? resolveSupabaseProjectRefFromBackup();
  const supabaseOrgId = supabaseProject?.organizationId ?? supabaseProject?.organization_id ?? EXPECTED_SUPABASE_ORG_ID;
  const supabaseProjectName = supabaseProject?.name ?? "unknown";
  const stages = migrationStatus?.stages ?? [];
  const blockers = stages.filter((stage) => stage.status !== "pass");
  const dnsPlanFingerprint = dnsPlan?.apply === false && dnsPlan.ok === true ? dnsPlan.planFingerprint : undefined;
  const providerRetirementPlanFingerprint =
    providerRetirementDryRun?.apply === false && providerRetirementDryRun.dryRun === true
      ? providerRetirementDryRun.planFingerprint
      : undefined;
  const commands = commandSequence({
    backupDir,
    dnsPlanFingerprint,
    providerRetirementPlanFingerprint,
    duplicateSecretAndVarKeys: envInventory?.duplicateSecretAndVarKeys ?? [],
    retiredSupabaseSecrets: envInventory?.retiredSupabaseSecrets ?? [],
    vercelProject,
    supabaseProjectRef,
    supabaseOrgId,
    supabaseProjectName,
  });
  const commandSequenceValidation = validateFinalCutoverCommandSequence(commands);

  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    status: blockers.length === 0 && migrationStatus?.providersRetired === true ? "complete" : "not-ready",
    warning:
      "This checklist is non-mutating and contains no secret values. Recreate it after taking the final write-freeze backup; CONFIRM_BACKUP_DIR must match the backup used for import.",
    targets: {
      worker: WORKER_NAME,
      domains: [DOMAIN, WWW_DOMAIN],
      d1: { database: D1_DATABASE_NAME, databaseId: D1_DATABASE_ID },
      vectorize: { index: VECTORIZE_INDEX_NAME, dimensions: 512, metric: "cosine" },
      r2: { bucket: R2_BUCKET_NAME },
      queue: { name: MEMORY_POST_TURN_QUEUE_NAME, deadLetterQueue: MEMORY_POST_TURN_DLQ_NAME },
      vercel: {
        projectName: vercelProject?.projectName ?? "unknown",
        projectId: vercelProject?.projectId ?? "unknown",
        orgId: vercelProject?.orgId ?? "unknown",
      },
      supabase: {
        orgId: supabaseOrgId,
        projectRef: supabaseProjectRef || "unknown",
        projectName: supabaseProjectName,
      },
    },
    currentReadiness: {
      migrationStatusCreatedAt: migrationStatus?.createdAt ?? null,
      readyForDeploy: migrationStatus?.readyForDeploy === true,
      readyForDnsCutover: migrationStatus?.readyForDnsCutover === true,
      readyForProviderRetirement: migrationStatus?.readyForProviderRetirement === true,
      providersRetired: migrationStatus?.providersRetired === true,
      dnsPlanFingerprint: dnsPlanFingerprint ?? null,
      providerRetirementPlanFingerprint: providerRetirementPlanFingerprint ?? null,
      blockedStages: blockers.map((stage) => ({
        id: stage.id,
        name: stage.name,
        status: stage.status,
        detail: stage.detail,
      })),
    },
    requiredOperatorSecrets: [
      "CLOUDFLARE_API_TOKEN_FILE or CF_API_TOKEN_FILE pointing at a 0600 token file, or CLOUDFLARE_API_TOKEN/CF_API_TOKEN",
      "E2E_GOOGLE_EMAIL",
      "E2E_GOOGLE_PASSWORD, or E2E_TEST_AUTH_SECRET with MIGRATION_E2E_AUTH_SECRET/MIGRATION_E2E_AUTH_EMAIL set on the Worker for migration-session validation",
      "Provider CLI auth for Vercel and Supabase before hard deletion",
    ],
    evidenceFiles: evidenceFiles(),
    commandSequenceValidation,
    commandSequence: commands,
  };

  fs.writeFileSync(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(markdownOutputPath, renderMarkdown(report), { mode: 0o600 });
  const evidenceManifest = writeEvidenceManifest(backupDir);
  if (!commandSequenceValidation.ok) {
    throw new Error(`Final cutover command sequence is unsafe: ${commandSequenceValidation.problems.join("; ")}`);
  }

  console.log(`Final cutover checklist written:`);
  console.log(jsonOutputPath);
  console.log(markdownOutputPath);
  console.log(`Evidence manifest: ${evidenceManifest.manifestPath} (${evidenceManifest.files} files)`);
  console.log(`Status: ${report.status}`);
  if (blockers.length) {
    console.log(`Blocked stages: ${blockers.length}`);
    for (const stage of blockers.slice(0, 12)) console.log(`- ${stage.name}: ${stage.status}`);
  }
}

function commandSequence(input: {
  backupDir: string;
  dnsPlanFingerprint?: string;
  providerRetirementPlanFingerprint?: string;
  duplicateSecretAndVarKeys: string[];
	  retiredSupabaseSecrets: string[];
	  vercelProject: VercelProjectBackup | null;
	  supabaseProjectRef: string;
	  supabaseOrgId: string;
	  supabaseProjectName: string;
	}): CommandStep[] {
  const d1Confirm = {
    CONFIRM_WRITE_FREEZE: "1",
    CONFIRM_D1_IMPORT: "1",
    CONFIRM_D1_DATABASE_NAME: D1_DATABASE_NAME,
    CONFIRM_D1_DATABASE_ID: D1_DATABASE_ID,
    CONFIRM_BACKUP_DIR: input.backupDir,
  };
  const vectorizeConfirm = {
    CONFIRM_WRITE_FREEZE: "1",
    CONFIRM_CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT_ID,
    CONFIRM_VECTORIZE_IMPORT: "1",
    CONFIRM_VECTORIZE_RESET: "1",
    CONFIRM_VECTORIZE_INDEX: VECTORIZE_INDEX_NAME,
    CONFIRM_BACKUP_DIR: input.backupDir,
  };
  const liveGateConfirm = {
    CONFIRM_WRITE_FREEZE: "1",
    REQUIRE_LIVE_AI: "1",
    E2E_GOOGLE_IS_ADMIN: "1",
  };
  const dnsConfirm = {
    CONFIRM_DNS_PLAN_FINGERPRINT: input.dnsPlanFingerprint ?? "<missing-dry-run-plan-fingerprint>",
    CONFIRM_DNS_CUTOVER: "1",
    CONFIRM_WRITE_FREEZE: "1",
    CONFIRM_WORKER_CUSTOM_DOMAIN_DEPLOY: "1",
    REQUIRE_LIVE_AI: "1",
    E2E_GOOGLE_IS_ADMIN: "1",
    CONFIRM_BACKUP_DIR: input.backupDir,
  };
  const providerConfirm = {
    CONFIRM_PROVIDER_RETIREMENT: "1",
    CONFIRM_PROVIDER_HARD_DELETE: "1",
    CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT:
      input.providerRetirementPlanFingerprint ?? "<missing-provider-retirement-plan-fingerprint>",
    CONFIRM_BACKUP_DIR: input.backupDir,
	    CONFIRM_VERCEL_PROJECT: input.vercelProject?.projectName ?? "inspirlearning",
	    CONFIRM_VERCEL_PROJECT_ID: input.vercelProject?.projectId ?? "<missing-vercel-project-id>",
	    CONFIRM_VERCEL_ORG_ID: input.vercelProject?.orgId ?? "<missing-vercel-org-id>",
	    CONFIRM_VERCEL_DELETE_TARGET: `${input.vercelProject?.orgId ?? "<missing-vercel-org-id>"}/${input.vercelProject?.projectId ?? "<missing-vercel-project-id>"}/${input.vercelProject?.projectName ?? "inspirlearning"}`,
	    CONFIRM_SUPABASE_ORG_ID: input.supabaseOrgId,
	    CONFIRM_SUPABASE_PROJECT_REF: input.supabaseProjectRef || "<missing-supabase-project-ref>",
	    CONFIRM_SUPABASE_DELETE_TARGET: `${input.supabaseOrgId}/${input.supabaseProjectRef || "<missing-supabase-project-ref>"}/${input.supabaseProjectName || "<missing-supabase-project-name>"}`,
	  };
  const credentialRotationConfirm = {
    CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED: "1",
    CONFIRM_R2_MIGRATION_S3_KEY_REVOKED: "1",
    CONFIRM_VERCEL_ACCESS_REVOKED: "1",
    CONFIRM_SUPABASE_ACCESS_REVOKED: "1",
    CONFIRM_RETIRED_PROVIDER_ENV_UNSET: "1",
    CREDENTIAL_ROTATION_EVIDENCE_FILE: "<local-rotation-receipt-file>",
  };
  const duplicateSecretKeys = [...input.duplicateSecretAndVarKeys].sort();
  const retiredSupabaseKeys = [...input.retiredSupabaseSecrets].sort();
  const cleanupKeys = [...new Set([...duplicateSecretKeys, ...retiredSupabaseKeys])].sort();
  const writeFreezeOperatorEvidenceDir = path.join(input.backupDir, "operator");
  const writeFreezeOperatorEvidenceFile = path.join(writeFreezeOperatorEvidenceDir, "write-freeze-evidence.txt");
  const duplicateSecretConfirm = {
    CONFIRM_ENV_SECRET_CLEANUP: "1",
    CONFIRM_BACKUP_DIR: input.backupDir,
    CONFIRM_DUPLICATE_SECRET_KEYS: duplicateSecretKeys.join(","),
    CONFIRM_RETIRED_SUPABASE_SECRET_KEYS: retiredSupabaseKeys.join(","),
    CONFIRM_SECRET_CLEANUP_KEYS: cleanupKeys.join(","),
  };

  const duplicateSecretCleanupStep: CommandStep[] = cleanupKeys.length
    ? [
        {
          id: "cleanup-duplicate-secrets",
          title: "Delete shadowing or retired Cloudflare secrets",
          mutates: true,
          requiredEnv: duplicateSecretConfirm,
          command: [
            "pnpm cf:cleanup:duplicate-secrets",
            `${envPrefix(duplicateSecretConfirm)} pnpm cf:cleanup:duplicate-secrets -- --apply`,
            "pnpm cf:preflight:production",
          ].join("\n"),
          gate:
            "Run only after reviewing cloudflare/env-secret-cleanup-plan.json. This removes duplicate non-secret config keys and retired Supabase/Postgres keys from Cloudflare secrets so production config cannot be shadowed.",
        },
      ]
    : [];

  return [
    {
      id: "refresh-final-backup",
      title: "Take the final write-freeze backup and regenerate this checklist",
      mutates: false,
      requiredEnv: {
        CONFIRM_WRITE_FREEZE: "1",
        CONFIRM_FINAL_BACKUP: "1",
        CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
        MIGRATION_WRITE_FREEZE_STATUS_URL: `https://${DOMAIN}/api/migration/write-freeze`,
      },
      command: [
        "# Set APP_WRITE_FREEZE=1 on the currently serving production app first.",
        "# Default path: prove the currently serving app exposes the write-freeze status URL and is frozen.",
        `MIGRATION_WRITE_FREEZE_STATUS_URL=https://${DOMAIN}/api/migration/write-freeze pnpm cf:check:write-freeze`,
        `${envPrefix({
          CONFIRM_WRITE_FREEZE: "1",
          CONFIRM_FINAL_BACKUP: "1",
          CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
          MIGRATION_WRITE_FREEZE_STATUS_URL: `https://${DOMAIN}/api/migration/write-freeze`,
        })} pnpm cf:migration:backup -- --final`,
        "# Waiver path: use this instead of the final backup command above only if the currently serving app cannot expose the status URL.",
        "# The evidence file must contain no secrets; include operator name, timestamp, exact freeze method, and verification links/commands/screenshots.",
        `# mkdir -p ${JSON.stringify(writeFreezeOperatorEvidenceDir)}`,
        `# cat > ${JSON.stringify(writeFreezeOperatorEvidenceFile)} <<'EOF'`,
        "# Write freeze externally enforced for inspirlearning.com",
        "# Date: <ISO timestamp>",
        "# Operator: <name>",
        "# Method: <how writes were frozen on the currently serving production app>",
        "# Verification: <screenshots/logs/tickets/commands proving writes are blocked>",
        "# EOF",
        `# chmod 600 ${JSON.stringify(writeFreezeOperatorEvidenceFile)}`,
        `# ${envPrefix({
          CONFIRM_WRITE_FREEZE: "1",
          CONFIRM_FINAL_BACKUP: "1",
          CONFIRM_BACKUP_SOURCE_WRITES_FROZEN: "1",
          CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE: "1",
          CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED: "1",
          WRITE_FREEZE_OPERATOR_EVIDENCE_FILE: writeFreezeOperatorEvidenceFile,
        })} pnpm cf:migration:backup -- --final`,
        "pnpm cf:migration:prepare",
        "pnpm cf:migration:rehearse:d1:local",
        "pnpm cf:migration:rehearse:vectorize:local",
        "pnpm cf:verify:local",
        "pnpm cf:test:e2e:preview",
        "pnpm cf:harden:backup-permissions",
        "pnpm cf:status:migration",
        "pnpm cf:cutover:checklist",
        "pnpm cf:evidence:verify",
      ].join("\n"),
      gate:
        "Run after writes are frozen. If a new backup directory is created, every later CONFIRM_BACKUP_DIR must use that new directory.",
    },
    {
      id: "import-d1",
      title: "Replace production D1 from the frozen backup",
      mutates: true,
      requiredEnv: d1Confirm,
      command: `${envPrefix(d1Confirm)} pnpm cf:migration:import:d1`,
      gate: "Requires active write-freeze and exact D1 target confirmation.",
    },
    {
      id: "import-vectorize",
      title: "Reset and repopulate production Vectorize",
      mutates: true,
      requiredEnv: vectorizeConfirm,
      command: `${envPrefix(vectorizeConfirm)} pnpm cf:migration:import:vectorize -- --reset`,
      gate: "Requires active write-freeze and exact Vectorize target confirmation.",
    },
    {
      id: "validate-data",
      title: "Validate D1 and refresh production preflight",
      mutates: false,
      requiredEnv: liveGateConfirm,
      requiredSecretEnv: ["E2E_GOOGLE_EMAIL", "E2E_GOOGLE_PASSWORD or E2E_TEST_AUTH_SECRET"],
      command: [
        "pnpm cf:migration:validate:d1",
        `${envPrefix(liveGateConfirm)} pnpm cf:preflight:production`,
        "pnpm cf:status:migration",
        "pnpm cf:cutover:checklist",
        "pnpm cf:evidence:verify",
      ].join("\n"),
      gate: "D1 quick_check, foreign_key_check, row counts, checksums, translation checksum, Vectorize, and live Cloudflare inventory must pass.",
    },
    ...duplicateSecretCleanupStep,
    {
      id: "dns-dry-run",
      title: "Verify DNS token edit access and prepare DNS cutover dry run",
      mutates: true,
      requiredEnv: { CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE: "1" },
      requiredSecretEnv: ["CLOUDFLARE_API_TOKEN_FILE or CF_API_TOKEN_FILE, or CLOUDFLARE_API_TOKEN/CF_API_TOKEN"],
      command: [
        "CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 CLOUDFLARE_API_TOKEN_FILE=<path-to-0600-token-file> pnpm cf:verify:cloudflare-token",
        "CLOUDFLARE_API_TOKEN_FILE=<path-to-0600-token-file> pnpm cf:dns:prepare-cutover",
      ].join("\n"),
      gate:
        "The token capability report must prove read plus temporary TXT create/delete access, then review dns-cutover-plan.json and copy only the planFingerprint into CONFIRM_DNS_PLAN_FINGERPRINT.",
    },
    {
      id: "dns-apply",
      title: "Remove DNS records that block Worker custom domains",
      mutates: true,
      requiredEnv: dnsConfirm,
      requiredSecretEnv: [
        "CLOUDFLARE_API_TOKEN_FILE or CF_API_TOKEN_FILE, or CLOUDFLARE_API_TOKEN/CF_API_TOKEN",
        "E2E_GOOGLE_EMAIL",
        "E2E_GOOGLE_PASSWORD or E2E_TEST_AUTH_SECRET",
      ],
      command: `${envPrefix(dnsConfirm)} CLOUDFLARE_API_TOKEN_FILE=<path-to-0600-token-file> pnpm cf:dns:prepare-cutover -- --apply`,
      gate: "Only run when ready to immediately deploy the Worker custom domains. The reviewed DNS plan fingerprint must match live DNS.",
    },
    {
      id: "deploy-worker",
      title: "Deploy OpenNext Worker to production",
      mutates: true,
      requiredEnv: liveGateConfirm,
      requiredSecretEnv: ["E2E_GOOGLE_EMAIL", "E2E_GOOGLE_PASSWORD or E2E_TEST_AUTH_SECRET"],
      command: `${envPrefix(liveGateConfirm)} pnpm cf:deploy`,
      gate: "Production preflight runs first and must be clean.",
    },
    {
      id: "post-cutover-validation",
      title: "Record production DNS, smoke, Playwright, and post-cutover D1 evidence",
      mutates: false,
      requiredEnv: {
        REQUIRE_LIVE_AI: "1",
        E2E_GOOGLE_IS_ADMIN: "1",
      },
      requiredSecretEnv: [
        "CLOUDFLARE_API_TOKEN_FILE or CF_API_TOKEN_FILE, or CLOUDFLARE_API_TOKEN/CF_API_TOKEN",
        "E2E_GOOGLE_EMAIL",
        "E2E_GOOGLE_PASSWORD or E2E_TEST_AUTH_SECRET",
      ],
      command: [
        "CLOUDFLARE_API_TOKEN_FILE=<path-to-0600-token-file> pnpm cf:verify:dns-cutover",
        "REQUIRE_LIVE_AI=1 pnpm cf:verify:production",
        "REQUIRE_LIVE_AI=1 E2E_GOOGLE_IS_ADMIN=1 PLAYWRIGHT_BASE_URL=https://inspirlearning.com pnpm cf:test:e2e:production",
        "pnpm cf:migration:validate:d1:post-cutover",
        "pnpm cf:migration:validate:vectorize:post-cutover",
        "pnpm cf:status:migration",
        "pnpm cf:cutover:checklist",
        "pnpm cf:evidence:verify",
      ].join("\n"),
      gate: "All production reports must be clean and generated from the same backup directory.",
    },
    {
      id: "retire-providers-preflight",
      title: "Verify Vercel and Supabase hard-delete preflight",
      mutates: false,
      requiredEnv: removeHardDeleteConfirmation(providerConfirm),
      command: [
        "pnpm cf:evidence:verify",
        `${envPrefix(removeHardDeleteConfirmation(providerConfirm))} pnpm cf:preflight:retire-providers`,
        "pnpm cf:retire-providers",
        "pnpm cf:status:migration",
        "pnpm cf:cutover:checklist",
        "pnpm cf:evidence:verify",
      ].join("\n"),
      gate:
        "Preflight must be clean and the dry-run deletion plan must name the backed-up Vercel/Supabase targets. Review provider-retirement-dry-run-plan.json and copy only planFingerprint into CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT. The final status/checklist/verify refresh includes the provider-retirement preflight report before hard-delete apply.",
    },
    {
      id: "retire-providers-apply",
      title: "Hard-delete Vercel and Supabase",
      mutates: true,
      requiredEnv: providerConfirm,
      command: ["pnpm cf:evidence:verify", `${envPrefix(providerConfirm)} pnpm cf:retire-providers -- --apply`].join("\n"),
      gate:
        "Every production report and the verified evidence manifest must be clean, fresh, and tied to this backup directory. Do not run cf:status:migration or cf:cutover:checklist between this verification and apply. Run the credential rotation step immediately afterward.",
    },
    {
      id: "verify-credential-rotation",
      title: "Rotate/revoke migration credentials and record evidence",
      mutates: true,
      requiredEnv: credentialRotationConfirm,
      command: [
        "# Revoke/rotate the temporary Cloudflare API token used for DNS/migration work.",
        "# Revoke/rotate the temporary R2 S3 access key and secret.",
        "# Remove Vercel and Supabase CLI/API/database credentials from the operator shell.",
        "# Write a local receipt/notes file for these actions, then set CREDENTIAL_ROTATION_EVIDENCE_FILE to it.",
        `unset ${FORBIDDEN_ENV_AFTER_ROTATION.join(" ")}`,
        `${envPrefix(credentialRotationConfirm)} pnpm cf:verify:credential-rotation`,
        "pnpm cf:status:migration",
        "pnpm cf:cutover:checklist",
        "pnpm cf:evidence:verify",
      ].join("\n"),
      gate:
        "This is the final completion gate. It requires clean provider hard-delete evidence, explicit revocation confirmations, a stored credential-rotation evidence file, and no retired migration credential env vars left in the shell.",
    },
  ];
}

function renderMarkdown(report: {
  createdAt: string;
  backupDir: string;
  status: string;
  warning: string;
  targets: {
    worker: string;
    domains: string[];
    d1: { database: string; databaseId: string };
    vectorize: { index: string; dimensions: number; metric: string };
    r2: { bucket: string };
    queue: { name: string; deadLetterQueue: string };
    vercel: { projectName: string; projectId: string; orgId: string };
    supabase: { orgId: string; projectRef: string; projectName: string };
  };
  currentReadiness: {
    migrationStatusCreatedAt: string | null;
    readyForDeploy: boolean;
    readyForDnsCutover: boolean;
    readyForProviderRetirement: boolean;
    providersRetired: boolean;
    dnsPlanFingerprint: string | null;
    providerRetirementPlanFingerprint: string | null;
    blockedStages: Array<{ id: string; name: string; status: string; detail?: unknown }>;
  };
  requiredOperatorSecrets: string[];
  evidenceFiles: string[];
  commandSequenceValidation: CutoverRunbookValidationReport;
  commandSequence: CommandStep[];
}) {
  const lines = [
    "# Final Cloudflare Cutover Checklist",
    "",
    `Generated: ${report.createdAt}`,
    `Backup: ${report.backupDir}`,
    `Status: ${report.status}`,
    "",
    `Warning: ${report.warning}`,
    "",
    "## Targets",
    "",
    `- Worker: ${report.targets.worker}`,
    `- Domains: ${report.targets.domains.join(", ")}`,
    `- D1: ${report.targets.d1.database} (${report.targets.d1.databaseId})`,
    `- Vectorize: ${report.targets.vectorize.index} (${report.targets.vectorize.dimensions} dimensions, ${report.targets.vectorize.metric})`,
    `- R2: ${report.targets.r2.bucket}`,
    `- Queue: ${report.targets.queue.name} (DLQ: ${report.targets.queue.deadLetterQueue})`,
    `- Vercel: ${report.targets.vercel.projectName} (${report.targets.vercel.projectId}, ${report.targets.vercel.orgId})`,
    `- Supabase: ${report.targets.supabase.orgId} / ${report.targets.supabase.projectRef} / ${report.targets.supabase.projectName}`,
    "",
    "## Current Readiness",
    "",
    `- Migration status created at: ${report.currentReadiness.migrationStatusCreatedAt ?? "missing"}`,
    `- Ready for deploy: ${yesNo(report.currentReadiness.readyForDeploy)}`,
    `- Ready for DNS cutover: ${yesNo(report.currentReadiness.readyForDnsCutover)}`,
    `- Ready for provider retirement: ${yesNo(report.currentReadiness.readyForProviderRetirement)}`,
    `- Providers retired: ${yesNo(report.currentReadiness.providersRetired)}`,
    `- DNS plan fingerprint: ${report.currentReadiness.dnsPlanFingerprint ?? "missing"}`,
    `- Provider retirement plan fingerprint: ${report.currentReadiness.providerRetirementPlanFingerprint ?? "missing"}`,
    "",
    "## Blocked Stages",
    "",
    ...(report.currentReadiness.blockedStages.length
      ? report.currentReadiness.blockedStages.map((stage) => `- [ ] ${stage.name}: ${stage.status}`)
      : ["- [x] None"]),
    "",
    "## Required Secret Inputs",
    "",
    ...report.requiredOperatorSecrets.map((key) => `- ${key}`),
    "",
    "## Runbook Validation",
    "",
    `- Valid: ${yesNo(report.commandSequenceValidation.ok)}`,
    `- Mutating steps: ${report.commandSequenceValidation.mutatingSteps.join(", ") || "none"}`,
    ...(report.commandSequenceValidation.problems.length
      ? report.commandSequenceValidation.problems.map((problem) => `- Problem: ${problem}`)
      : ["- Problems: none"]),
    "",
    "## Command Sequence",
    "",
  ];

  for (const step of report.commandSequence) {
    lines.push(`### ${step.title}`);
    lines.push("");
    lines.push(`- Mutates production: ${yesNo(step.mutates)}`);
    lines.push(`- Gate: ${step.gate}`);
    if (step.requiredSecretEnv?.length) {
      lines.push(`- Required secret env: ${step.requiredSecretEnv.join(", ")}`);
    }
    lines.push("");
    lines.push("```bash");
    lines.push(step.command);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Evidence Files");
  lines.push("");
  lines.push(...report.evidenceFiles.map((file) => `- ${file}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function evidenceFiles() {
  return [
    "supabase/schema-public.sql",
    "supabase/data-public.sql",
    "supabase/validation.json",
    "supabase/project.json",
    "checksums/local-backup-files.sha256",
    "checksums/supabase-table-checksums.json",
    "vercel/project.json",
    "vercel/vercel.json",
    "vercel/output-config.json",
    "vercel/output-builds.json",
    "vercel/alias-ls.txt",
    "env/vercel-production-env-pull.local",
    EVIDENCE_MANIFEST_RELATIVE_PATH,
    EVIDENCE_MANIFEST_VERIFY_REPORT_RELATIVE_PATH,
    "cloudflare/source-table-coverage-report.json",
    "cloudflare/d1-transform-fidelity-report.json",
    TIMESTAMP_PRECISION_RELATIVE_PATH,
    "cloudflare/d1-size-safety-report.json",
    WRITE_FREEZE_READINESS_REPORT,
    "cloudflare/write-freeze-report.json",
    WRITE_FREEZE_EXTERNAL_EVIDENCE_FILE,
    "cloudflare/local-gates-report.json",
    "cloudflare/backup-permissions-report.json",
    "cloudflare/source-secret-scan-report.json",
    "cloudflare/runtime-provider-scan-report.json",
    "cloudflare/build-artifact-scan-report.json",
    "cloudflare/worker-startup.cpuprofile",
    "cloudflare/env-migration-inventory.json",
    "cloudflare/env-secret-cleanup-plan.json",
    "cloudflare/env-secret-cleanup-run.json",
    "cloudflare/playwright-preview-report.json",
    "cloudflare/d1-local-rehearsal-report.json",
    "cloudflare/vectorize-local-rehearsal-report.json",
    D1_PRE_IMPORT_BACKUP_SQL,
    D1_PRE_IMPORT_BACKUP_REPORT,
    "cloudflare/d1-import-run.json",
    "cloudflare/d1-validation-report.json",
    VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
    VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
    "cloudflare/vectorize-import-run.json",
    "cloudflare/queues-list.txt",
    "cloudflare/production-preflight-report.json",
    "cloudflare/cloudflare-api-token-capability-report.json",
    "cloudflare/dns-cutover-dry-run-plan.json",
    "cloudflare/dns-cutover-plan.json",
    "cloudflare/dns-cutover-apply-report.json",
    "cloudflare/dns-cutover-report.json",
    WORKER_DEPLOY_REPORT,
    "cloudflare/production-smoke-report.json",
    "cloudflare/playwright-production-report.json",
    "cloudflare/d1-post-cutover-validation-report.json",
    "cloudflare/vectorize-post-cutover-validation-report.json",
    "cloudflare/provider-retirement-preflight-report.json",
    PROVIDER_RETIREMENT_DRY_RUN_PLAN,
    PROVIDER_RETIREMENT_RUN_REPORT,
    "cloudflare/credential-rotation-evidence.txt",
    "cloudflare/credential-rotation-report.json",
    "cloudflare/migration-status-report.json",
  ];
}

function resolveSupabaseProjectRefFromBackup() {
  const candidates = [
    "env/env.vercel.production.local",
    "env/vercel-production-env-pull.local",
    "env/vercel-dot-env.production.local",
  ];
  for (const candidate of candidates) {
    const absolutePath = path.join(backupDir, candidate);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, "utf8");
    const urlMatch = content.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/i);
    if (urlMatch?.[1]) return urlMatch[1];
    const dbHostMatch = content.match(/(?:db|postgres)\.([a-z0-9]{20})\.supabase\.co/i);
    if (dbHostMatch?.[1]) return dbHostMatch[1];
  }
  return "";
}

function readJson<T>(relativePath: string): T | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function removeHardDeleteConfirmation(confirmations: Record<string, string>) {
  const clone = { ...confirmations };
  delete clone.CONFIRM_PROVIDER_HARD_DELETE;
  return clone;
}

function envPrefix(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${quoteShell(value)}`)
    .join(" ");
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}
