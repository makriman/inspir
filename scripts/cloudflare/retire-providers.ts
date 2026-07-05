import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TIMESTAMP_PRECISION_RELATIVE_PATH, commandEnv, hasFlag, resolveBackupDir } from "./migration-config";
import { checkFreshVerifiedEvidenceManifest } from "./evidence-verification-gate";
import { freshBackupScopedReportBlockers, type BackupScopedGateReport } from "./fresh-report-gate";
import {
  PROVIDER_RETIREMENT_DRY_RUN_PLAN,
  PROVIDER_RETIREMENT_RUN_REPORT,
  providerRetirementDryRunEvidenceBlockers,
  providerRetirementPlanFingerprint,
  providerRetirementRunSucceeded,
  providersAbsent,
  redactProviderProcessOutput,
  type ProviderRetirementDryRunEvidence,
  type ProviderIdentity,
} from "./provider-retirement-safety";
import { buildD1ArtifactFingerprintSafely, checkFinalCutoverEvidenceChain } from "./final-cutover-evidence-chain";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import { backupDirConfirmationBlocker } from "./destructive-confirmations";
import { DNS_PUBLIC_CUTOVER_REPORT, validateDnsCutoverEvidence } from "./dns-cutover-evidence";
import {
  WRITE_FREEZE_REPORT,
  buildWriteFreezeReadinessReport,
  requiredWriteFreezeEvidenceFiles,
  validateFinalWriteFreezeEvidenceReport,
  type WriteFreezeEvidenceReport,
} from "./write-freeze-evidence";
import { D1_PRE_IMPORT_BACKUP_REPORT, D1_PRE_IMPORT_BACKUP_SQL } from "./d1-pre-import-backup";
import {
  VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
  VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
} from "./vectorize-pre-import-backup";
import { WORKER_DEPLOY_REPORT } from "./worker-deploy-evidence";

type CommandPlan = {
  provider: "vercel" | "supabase";
  command: string;
  args: string[];
};

type CommandResult = CommandPlan & {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes?: number;
  stderrBytes?: number;
  outputRedacted?: boolean;
};

const EXPECTED_SUPABASE_ORG_ID = "eovjqnvuqfmflaplfoue";
const EXPECTED_VERCEL_PROJECT = "inspirlearning";
const MAX_REPORT_AGE_MS = 60 * 60 * 1000;
const BASE_REQUIRED_EVIDENCE_FILES = [
  "supabase/schema-public.sql",
  "supabase/data-public.sql",
  "supabase/validation.json",
  "supabase/project.json",
  "checksums/local-backup-files.sha256",
  "checksums/supabase-table-checksums.json",
  "env/vercel-production-env-pull.local",
  "vercel/project.json",
  "cloudflare/source-table-coverage-report.json",
  "cloudflare/d1-transform-fidelity-report.json",
  TIMESTAMP_PRECISION_RELATIVE_PATH,
  "cloudflare/d1-size-safety-report.json",
  "cloudflare/local-gates-report.json",
  "cloudflare/backup-permissions-report.json",
  "cloudflare/source-secret-scan-report.json",
  "cloudflare/runtime-provider-scan-report.json",
  "cloudflare/env-migration-inventory.json",
  "cloudflare/d1-local-rehearsal-report.json",
  "cloudflare/vectorize-local-rehearsal-report.json",
  "cloudflare/playwright-preview-report.json",
  D1_PRE_IMPORT_BACKUP_SQL,
  D1_PRE_IMPORT_BACKUP_REPORT,
  "cloudflare/d1-import-run.json",
  "cloudflare/d1-validation-report.json",
  VECTORIZE_PRE_IMPORT_BACKUP_NDJSON,
  VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
  "cloudflare/vectorize-import-run.json",
  "cloudflare/production-preflight-report.json",
  WORKER_DEPLOY_REPORT,
  "cloudflare/production-smoke-report.json",
  "cloudflare/playwright-production-report.json",
  "cloudflare/d1-post-cutover-validation-report.json",
  "cloudflare/vectorize-post-cutover-validation-report.json",
  "cloudflare/provider-retirement-preflight-report.json",
  PROVIDER_RETIREMENT_DRY_RUN_PLAN,
];
const apply = hasFlag("--apply");
const backupDir = resolveBackupDir();
const outputPath = path.join(backupDir, PROVIDER_RETIREMENT_RUN_REPORT);
const dryRunOutputPath = path.join(backupDir, PROVIDER_RETIREMENT_DRY_RUN_PLAN);

void main().catch((error) => {
  writeReport({
    ok: false,
    dryRun: !apply,
    backupDir,
    error: error instanceof Error ? error.message : String(error),
  }, apply ? outputPath : dryRunOutputPath);
  process.exitCode = 1;
});

async function main() {
  const targets = resolveRetirementTargets();
  const commands = deletionPlans(targets);
  const planFingerprint = providerRetirementPlanFingerprint({ backupDir, targets, commands });

  if (!apply) {
    const currentIdentity = checkLiveProviderIdentity(targets);
    const identityBlockers = providerIdentityBlockers(currentIdentity);
    writeReport({
      ok: identityBlockers.length === 0,
      dryRun: true,
      backupDir,
      message:
        "Dry run only. Review this deletion plan, then re-run with --apply after every provider retirement preflight gate passes.",
      targets,
      currentIdentity,
      blockers: identityBlockers,
      planFingerprint,
      confirmationsRequiredForApply: requiredConfirmations(targets, planFingerprint),
      commands: commands.map(redactCommand),
    }, dryRunOutputPath);
    if (identityBlockers.length) process.exitCode = 1;
    return;
  }

  const blocked = await applyBlockers(targets, commands, planFingerprint);
  if (blocked.length) {
    writeReport({
      ok: false,
      dryRun: false,
      backupDir,
      blocked,
      targets,
      expectedPlanFingerprint: planFingerprint,
      commands: commands.map(redactCommand),
    });
    process.exitCode = 1;
    return;
  }

  const results: CommandResult[] = [];
  for (const command of commands) {
    const result = await runDeletionCommand(command);
    results.push(result);
    if (!result.ok) break;
  }
  const postDeleteIdentity = await waitForProviderAbsence(targets);
  const retirementSafety = providerRetirementRunSucceeded(results, postDeleteIdentity);
  const ok = retirementSafety.ok;
  writeReport({
    ok,
    dryRun: false,
    backupDir,
    targets,
    results,
    postDeleteIdentity,
    retirementSafety,
  });
  if (!ok) process.exitCode = 1;
}

function deletionPlans(targets: RetirementTargets): CommandPlan[] {
  const vercelToken = process.env.VERCEL_TOKEN?.trim();
  return [
    vercelToken
      ? {
          provider: "vercel",
          command: "vercel-api",
          args: ["DELETE", `/v9/projects/${targets.vercelProjectId}?teamId=${targets.vercelOrgId}`],
        }
      : {
          provider: "vercel",
          command: process.env.VERCEL_CLI || "vercel",
          args: ["project", "remove", targets.vercelProjectId, "--scope", targets.vercelOrgId, "--non-interactive"],
        },
    {
      provider: "supabase",
      command: process.env.SUPABASE_CLI || "/Users/makriman/.supabase/bin/supabase",
      args: ["projects", "delete", targets.supabaseProjectRef, "--yes"],
    },
  ];
}

async function applyBlockers(targets: RetirementTargets, commands: CommandPlan[], planFingerprint: string) {
  const blockers: string[] = [];
  const backupDirBlocker = backupDirConfirmationBlocker(backupDir);
  if (backupDirBlocker) blockers.push(backupDirBlocker);
  for (const [key, expected] of Object.entries(requiredConfirmations(targets, planFingerprint))) {
    if (key === "CONFIRM_BACKUP_DIR") continue;
    if (process.env[key] !== expected) blockers.push(`Missing or incorrect ${key}`);
  }

  blockers.push(
    ...freshBackupScopedReportBlockers({
      relativePath: PROVIDER_RETIREMENT_DRY_RUN_PLAN,
      report: readJson<ProviderRetirementDryRunEvidence>(PROVIDER_RETIREMENT_DRY_RUN_PLAN),
      backupDir,
      maxAgeMs: MAX_REPORT_AGE_MS,
      requireOk: true,
    }),
    ...providerRetirementDryRunEvidenceBlockers(readJson<ProviderRetirementDryRunEvidence>(PROVIDER_RETIREMENT_DRY_RUN_PLAN), {
      backupDir,
      targets,
      commands,
      planFingerprint,
    }, PROVIDER_RETIREMENT_DRY_RUN_PLAN),
  );
  const writeFreezeValidation = validateFinalWriteFreezeEvidenceReport(readJson<WriteFreezeEvidenceReport>(WRITE_FREEZE_REPORT), {
    backupDir,
    maxAgeMs: MAX_REPORT_AGE_MS,
  });
  blockers.push(...writeFreezeValidation.blockers);
  blockers.push(...(await liveWriteFreezeBlockers()));
  checkFreshEvidenceManifest(blockers);
  checkFreshOkReport("cloudflare/provider-retirement-preflight-report.json", blockers);
  const currentArtifactFingerprint = buildD1ArtifactFingerprintSafely(backupDir);
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const finalEvidence = checkFinalCutoverEvidenceChain(backupDir, {
    maxAgeMs: MAX_REPORT_AGE_MS,
    requireProviderPreflight: true,
    expectedSourceFingerprint: currentSourceFingerprint,
    expectedD1ArtifactFingerprint: currentArtifactFingerprint.fingerprint,
    d1ArtifactFingerprintError: currentArtifactFingerprint.error,
  });
  blockers.push(...finalEvidence.blockers);
  const dnsEvidence = validateDnsCutoverEvidence(backupDir, { maxAgeMs: MAX_REPORT_AGE_MS });
  blockers.push(...dnsEvidence.blockers);

  for (const relativePath of [
    "cloudflare/production-preflight-report.json",
    dnsEvidence.mode === "manual-public-dns" ? DNS_PUBLIC_CUTOVER_REPORT : "cloudflare/dns-cutover-report.json",
    "cloudflare/production-smoke-report.json",
    "cloudflare/playwright-production-report.json",
    "cloudflare/d1-post-cutover-validation-report.json",
  ]) {
    checkFreshOkReport(relativePath, blockers);
  }

  const liveIdentity = checkLiveProviderIdentity(targets);
  if (!liveIdentity.vercel.ok) blockers.push(`Live Vercel project identity does not match backup: ${JSON.stringify(liveIdentity.vercel.detail)}`);
  if (!liveIdentity.supabase.ok) blockers.push(`Live Supabase project identity does not match backup: ${JSON.stringify(liveIdentity.supabase.detail)}`);

  return blockers;
}

async function liveWriteFreezeBlockers() {
  const readiness = await buildWriteFreezeReadinessReport(backupDir);
  if (readiness.ok && readiness.writeFreezeActive === true) return [];
  return [
    `Live write-freeze probe is not active: ${JSON.stringify({
      url: readiness.url,
      endpointContractOk: readiness.endpointContractOk,
      writeFreezeActive: readiness.writeFreezeActive,
      status: readiness.probe.status,
      code: readiness.probe.code,
      problems: readiness.problems,
    })}`,
  ];
}

function checkFreshEvidenceManifest(blockers: string[]) {
  const result = checkFreshVerifiedEvidenceManifest(backupDir, MAX_REPORT_AGE_MS, {
    requiredFiles: requiredEvidenceFiles(),
  });
  blockers.push(...result.blockers);
}

function requiredEvidenceFiles() {
  return [...BASE_REQUIRED_EVIDENCE_FILES, ...requiredWriteFreezeEvidenceFiles(backupDir)];
}

type RetirementTargets = {
  vercelProjectName: string;
  vercelProjectId: string;
  vercelOrgId: string;
  vercelDeleteTarget: string;
  supabaseOrgId: string;
  supabaseProjectRef: string;
  supabaseProjectName: string;
  supabaseDeleteTarget: string;
};

function requiredConfirmations(targets: RetirementTargets, planFingerprint: string) {
  return {
    CONFIRM_PROVIDER_RETIREMENT: "1",
    CONFIRM_PROVIDER_HARD_DELETE: "1",
    CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT: planFingerprint,
    CONFIRM_BACKUP_DIR: backupDir,
    CONFIRM_VERCEL_PROJECT: targets.vercelProjectName,
    CONFIRM_VERCEL_PROJECT_ID: targets.vercelProjectId,
    CONFIRM_VERCEL_ORG_ID: targets.vercelOrgId,
    CONFIRM_VERCEL_DELETE_TARGET: targets.vercelDeleteTarget,
    CONFIRM_SUPABASE_ORG_ID: targets.supabaseOrgId,
    CONFIRM_SUPABASE_PROJECT_REF: targets.supabaseProjectRef,
    CONFIRM_SUPABASE_DELETE_TARGET: targets.supabaseDeleteTarget,
  };
}

async function runDeletionCommand(plan: CommandPlan): Promise<CommandResult> {
  if (plan.provider === "vercel" && plan.command === "vercel-api") {
    return deleteVercelProjectViaApi(plan);
  }
  return runCommand(plan);
}

async function deleteVercelProjectViaApi(plan: CommandPlan): Promise<CommandResult> {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    return {
      ...redactCommand(plan),
      ok: false,
      status: null,
      stdout: "",
      stderr: "VERCEL_TOKEN is required for Vercel API deletion.",
    };
  }
  const url = new URL(`https://api.vercel.com${plan.args[1]}`);
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  return {
    ...redactCommand(plan),
    ok: response.status === 204,
    status: response.status,
    stdout: redactProviderProcessOutput(text),
    stderr: response.ok ? "" : redactProviderProcessOutput(text),
    stdoutBytes: Buffer.byteLength(text),
    stderrBytes: response.ok ? 0 : Buffer.byteLength(text),
    outputRedacted: true,
  };
}

function runCommand(plan: CommandPlan): CommandResult {
  const result = spawnSync(plan.command, plan.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...commandEnv(),
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ...redactCommand(plan),
    ok: result.status === 0,
    status: result.status,
    stdout: redactProviderProcessOutput(result.stdout ?? ""),
    stderr: redactProviderProcessOutput(result.stderr ?? (result.error ? String(result.error) : "")),
    stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
    stderrBytes: Buffer.byteLength(result.stderr ?? (result.error ? String(result.error) : "")),
    outputRedacted: true,
  };
}

function resolveRetirementTargets(): RetirementTargets {
  const vercelProject = readJson<{ projectId?: string; orgId?: string; projectName?: string }>("vercel/project.json");
  if (!vercelProject?.projectId || !vercelProject.orgId || vercelProject.projectName !== EXPECTED_VERCEL_PROJECT) {
    throw new Error("Could not resolve expected Vercel project identifiers from vercel/project.json backup.");
  }

  const supabaseProject = readJson<{
    projectRef?: string;
    ref?: string;
    id?: string;
    organizationId?: string;
    organization_id?: string;
    name?: string;
  }>("supabase/project.json");
  const supabaseProjectRef = supabaseProject?.projectRef ?? supabaseProject?.ref ?? supabaseProject?.id ?? resolveSupabaseProjectRefFromBackup();
  const supabaseOrgId = supabaseProject?.organizationId ?? supabaseProject?.organization_id ?? "";
  const supabaseProjectName = supabaseProject?.name ?? "";
  if (!supabaseProjectRef || supabaseOrgId !== EXPECTED_SUPABASE_ORG_ID || !supabaseProjectName) {
    throw new Error("Could not resolve expected Supabase project metadata from supabase/project.json backup.");
  }
  const suppliedSupabaseRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (suppliedSupabaseRef && suppliedSupabaseRef !== supabaseProjectRef) {
    throw new Error("SUPABASE_PROJECT_REF does not match the Supabase project ref derived from local backup env files.");
  }

  return {
    vercelProjectName: vercelProject.projectName,
    vercelProjectId: vercelProject.projectId,
    vercelOrgId: vercelProject.orgId,
    vercelDeleteTarget: `${vercelProject.orgId}/${vercelProject.projectId}/${vercelProject.projectName}`,
    supabaseOrgId,
    supabaseProjectRef,
    supabaseProjectName,
    supabaseDeleteTarget: `${supabaseOrgId}/${supabaseProjectRef}/${supabaseProjectName}`,
  };
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

  throw new Error("Could not resolve Supabase project ref from local backup env files.");
}

function checkLiveProviderIdentity(targets: RetirementTargets): ProviderIdentity {
  const vercel = lookupLiveVercelProject(targets);
  const supabase = lookupLiveSupabaseProject(targets);
  return { vercel, supabase };
}

function providerIdentityBlockers(identity: ProviderIdentity) {
  const blockers: string[] = [];
  if (!identity.vercel.ok) blockers.push(`Live Vercel project identity does not match backup: ${JSON.stringify(identity.vercel.detail)}`);
  if (!identity.supabase.ok) blockers.push(`Live Supabase project identity does not match backup: ${JSON.stringify(identity.supabase.detail)}`);
  return blockers;
}

async function waitForProviderAbsence(targets: RetirementTargets) {
  let lastIdentity = checkLiveProviderIdentity(targets);
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const absence = providersAbsent(lastIdentity);
    if (absence.ok) {
      return { ok: true, attempts: attempt, ...lastIdentity };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    lastIdentity = checkLiveProviderIdentity(targets);
  }
  const absence = providersAbsent(lastIdentity);
  return { ok: false, attempts: 12, absenceBlockers: absence.blockers, ...lastIdentity };
}

function lookupLiveVercelProject(targets: RetirementTargets) {
  const command = process.env.VERCEL_CLI || "vercel";
  const result = spawnSync(
    command,
    ["project", "ls", "--scope", targets.vercelOrgId, "--format=json", "--non-interactive"],
    { cwd: process.cwd(), encoding: "utf8", env: commandEnv(), maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    return {
      ok: false,
      found: null,
      detail: { status: result.status, stderr: redactProviderProcessOutput(result.stderr ?? String(result.error ?? "")) },
    };
  }
  const projects = parseProjectArray(result.stdout ?? "");
  const project = projects.find((candidate) => candidate.id === targets.vercelProjectId);
  return {
    ok: project?.name === targets.vercelProjectName,
    found: Boolean(project),
    detail: {
      projectId: project?.id,
      projectName: project?.name,
      expectedProjectId: targets.vercelProjectId,
      expectedProjectName: targets.vercelProjectName,
      scope: targets.vercelOrgId,
    },
  };
}

function lookupLiveSupabaseProject(targets: RetirementTargets) {
  const command = process.env.SUPABASE_CLI || "/Users/makriman/.supabase/bin/supabase";
  const result = spawnSync(
    command,
    ["projects", "list", "--output-format", "json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...commandEnv(), SUPABASE_TELEMETRY_DISABLED: "1" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    return {
      ok: false,
      found: null,
      detail: { status: result.status, stderr: redactProviderProcessOutput(result.stderr ?? String(result.error ?? "")) },
    };
  }
  const projects = parseProjectArray(result.stdout ?? "");
  const project = projects.find((candidate) => candidate.ref === targets.supabaseProjectRef || candidate.id === targets.supabaseProjectRef);
  return {
    ok:
      (project?.ref === targets.supabaseProjectRef || project?.id === targets.supabaseProjectRef) &&
      project?.organization_id === targets.supabaseOrgId &&
      project?.name === targets.supabaseProjectName,
    found: Boolean(project),
    detail: {
      projectRef: project?.ref ?? project?.id,
      organizationId: project?.organization_id,
      projectName: project?.name,
      status: project?.status,
      expectedProjectRef: targets.supabaseProjectRef,
      expectedOrganizationId: targets.supabaseOrgId,
      expectedProjectName: targets.supabaseProjectName,
    },
  };
}

function parseProjectArray(output: string): Array<Record<string, string | undefined>> {
  const trimmed = output.trim();
  const firstJson = [trimmed.indexOf("{"), trimmed.indexOf("[")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstJson === undefined) return [];
  const parsed = JSON.parse(trimmed.slice(firstJson)) as unknown;
  if (Array.isArray(parsed)) return parsed as Array<Record<string, string | undefined>>;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.projects)) return record.projects as Array<Record<string, string | undefined>>;
  if (Array.isArray(record.result)) return record.result as Array<Record<string, string | undefined>>;
  return [];
}

function checkFreshOkReport(relativePath: string, blockers: string[]) {
  const report = readJson<BackupScopedGateReport>(relativePath);
  blockers.push(
    ...freshBackupScopedReportBlockers({
      relativePath,
      report,
      backupDir,
      maxAgeMs: MAX_REPORT_AGE_MS,
      requireOk: true,
    }),
  );
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

function redactCommand(plan: CommandPlan): CommandPlan {
  return {
    provider: plan.provider,
    command: plan.command,
    args: plan.args,
  };
}

function writeReport(report: Record<string, unknown>, filePath = outputPath) {
  const payload = {
    createdAt: new Date().toISOString(),
    apply,
    ...report,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(payload, null, 2));
}
