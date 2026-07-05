import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, hasFlag, resolveBackupDir, runWrangler } from "./migration-config";
import { freshBackupScopedReportBlockers } from "./fresh-report-gate";

type EnvMigrationInventory = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  duplicateSecretAndVarKeys?: string[];
  retiredSupabaseSecrets?: string[];
  unclassified?: string[];
  missingRequiredSecretBackups?: string[];
  missingRequiredVars?: string[];
};

const REQUIRED_SECRET_KEYS = [
  "OPENAI_API_KEY",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "ADMIN_EMAILS",
  "CRON_SECRET",
];

const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const apply = hasFlag("--apply");

void main();

function main() {
  const inventory = readJson<EnvMigrationInventory>("cloudflare/env-migration-inventory.json");
  const duplicateKeys = [...new Set(inventory.duplicateSecretAndVarKeys ?? [])].sort();
  const retiredSupabaseKeys = [...new Set(inventory.retiredSupabaseSecrets ?? [])].sort();
  const cleanupKeys = [...new Set([...duplicateKeys, ...retiredSupabaseKeys])].sort();
  const blockers = cleanupBlockers(inventory, cleanupKeys);
  const commands = cleanupKeys.map((key) => ({
    key,
    reasons: cleanupReasons(key, duplicateKeys, retiredSupabaseKeys),
    command: "wrangler",
    args: ["secret", "delete", key],
  }));

  if (!apply) {
    writeReport("env-secret-cleanup-plan.json", {
      ok: blockers.length === 0,
      dryRun: true,
      backupDir,
      duplicateKeys,
      retiredSupabaseKeys,
      cleanupKeys,
      blockers,
      confirmationsRequiredForApply: cleanupKeys.length
        ? {
            CONFIRM_ENV_SECRET_CLEANUP: "1",
            CONFIRM_BACKUP_DIR: backupDir,
            CONFIRM_DUPLICATE_SECRET_KEYS: duplicateKeys.join(","),
            CONFIRM_RETIRED_SUPABASE_SECRET_KEYS: retiredSupabaseKeys.join(","),
            CONFIRM_SECRET_CLEANUP_KEYS: cleanupKeys.join(","),
          }
        : {},
      commands,
    });
    if (blockers.length) process.exitCode = 1;
    return;
  }

  const confirmationBlockers = confirmationBlockersForApply(duplicateKeys, retiredSupabaseKeys, cleanupKeys);
  if (blockers.length || confirmationBlockers.length) {
    writeReport("env-secret-cleanup-run.json", {
      ok: false,
      dryRun: false,
      backupDir,
      duplicateKeys,
      retiredSupabaseKeys,
      cleanupKeys,
      blockers: [...blockers, ...confirmationBlockers],
      commands,
    });
    process.exitCode = 1;
    return;
  }

  const results = cleanupKeys.map((key) => {
    try {
      const output = runWrangler(["secret", "delete", key], { allowFailure: true, input: "y\n" });
      return { key, reasons: cleanupReasons(key, duplicateKeys, retiredSupabaseKeys), ok: !/error|failed|abort|cancel/i.test(output), output: output.slice(0, 2000) };
    } catch (error) {
      return { key, reasons: cleanupReasons(key, duplicateKeys, retiredSupabaseKeys), ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  });
  const ok = results.every((result) => result.ok);
  writeReport("env-secret-cleanup-run.json", {
    ok,
    dryRun: false,
    backupDir,
    duplicateKeys,
    retiredSupabaseKeys,
    cleanupKeys,
    results,
    nextStep: ok ? "Rerun pnpm cf:preflight:production to refresh env-migration-inventory.json." : undefined,
  });
  if (!ok) process.exitCode = 1;
}

function cleanupBlockers(inventory: EnvMigrationInventory, cleanupKeys: string[]) {
  const blockers: string[] = [];
  if ((inventory.unclassified?.length ?? 0) > 0) blockers.push("env migration inventory still has unclassified Vercel keys");
  if ((inventory.missingRequiredSecretBackups?.length ?? 0) > 0) {
    blockers.push("env migration inventory is missing required Cloudflare secret evidence");
  }
  if ((inventory.missingRequiredVars?.length ?? 0) > 0) blockers.push("env migration inventory is missing required wrangler vars");
  blockers.push(
    ...freshBackupScopedReportBlockers({
      relativePath: "cloudflare/env-migration-inventory.json",
      report: inventory,
      backupDir,
      maxAgeMs: 60 * 60 * 1000,
    }),
  );
  const requiredSecretCollisions = cleanupKeys.filter((key) => REQUIRED_SECRET_KEYS.includes(key));
  if (requiredSecretCollisions.length) {
    blockers.push(`refusing to delete required secret keys: ${requiredSecretCollisions.join(", ")}`);
  }
  return blockers;
}

function confirmationBlockersForApply(duplicateKeys: string[], retiredSupabaseKeys: string[], cleanupKeys: string[]) {
  const expected = {
    CONFIRM_ENV_SECRET_CLEANUP: "1",
    CONFIRM_BACKUP_DIR: backupDir,
    CONFIRM_DUPLICATE_SECRET_KEYS: duplicateKeys.join(","),
    CONFIRM_RETIRED_SUPABASE_SECRET_KEYS: retiredSupabaseKeys.join(","),
    CONFIRM_SECRET_CLEANUP_KEYS: cleanupKeys.join(","),
  };
  return Object.entries(expected)
    .filter(([key, value]) => process.env[key] !== value)
    .map(([key]) => `Missing or incorrect ${key}`);
}

function cleanupReasons(key: string, duplicateKeys: string[], retiredSupabaseKeys: string[]) {
  const reasons: string[] = [];
  if (duplicateKeys.includes(key)) reasons.push("duplicates-wrangler-var");
  if (retiredSupabaseKeys.includes(key)) reasons.push("retired-supabase-postgres");
  return reasons;
}

function readJson<T>(relativePath: string): T {
  const filePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${relativePath}. Run pnpm cf:preflight:production first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeReport(fileName: string, report: Record<string, unknown>) {
  const payload = {
    createdAt: new Date().toISOString(),
    apply,
    ...report,
  };
  const outputPath = path.join(cfDir, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(payload, null, 2));
}
