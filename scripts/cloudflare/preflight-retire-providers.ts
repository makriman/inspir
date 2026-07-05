import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TIMESTAMP_PRECISION_RELATIVE_PATH, cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";
import { checkFreshVerifiedEvidenceManifest } from "./evidence-verification-gate";
import {
  FINAL_PRODUCTION_BASE_URL,
  buildD1ArtifactFingerprintSafely,
  checkFinalCutoverEvidenceChain,
  normalizeBaseUrl,
  validatePostCutoverD1Report,
  validateProductionPlaywrightReport,
  validateProductionSmokeReport,
} from "./final-cutover-evidence-chain";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import { backupDirConfirmationBlocker } from "./destructive-confirmations";
import { validateDnsCutoverEvidence } from "./dns-cutover-evidence";
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
import { redactProviderProcessOutput } from "./provider-retirement-safety";
import { WORKER_DEPLOY_REPORT } from "./worker-deploy-evidence";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail?: unknown;
};

type JsonReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  baseUrl?: string;
  exactTableCount?: number;
  mutableTableCount?: number;
  artifactFingerprint?: {
    sha256?: string;
  };
  stats?: {
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
  } | null;
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
];

const backupDir = resolveBackupDir();
const outputPath = path.join(cloudflareDir(backupDir), "provider-retirement-preflight-report.json");
const checks: Check[] = [];

void main();

async function main() {
  const targets = resolveRetirementTargets();
  checkConfirmation("CONFIRM_PROVIDER_RETIREMENT", "1");
  checkBackupDirConfirmation();
  checkConfirmation("CONFIRM_SUPABASE_ORG_ID", targets.supabaseOrgId);
  checkConfirmation("CONFIRM_SUPABASE_PROJECT_REF", targets.supabaseProjectRef);
  checkConfirmation("CONFIRM_VERCEL_PROJECT", targets.vercelProjectName);
  checkConfirmation("CONFIRM_VERCEL_PROJECT_ID", targets.vercelProjectId);
  checkConfirmation("CONFIRM_VERCEL_ORG_ID", targets.vercelOrgId);
  checkConfirmation("CONFIRM_VERCEL_DELETE_TARGET", targets.vercelDeleteTarget);
  checkConfirmation("CONFIRM_SUPABASE_DELETE_TARGET", targets.supabaseDeleteTarget);

  checkEvidenceManifestVerification();
  checkFinalWriteFreezeReport();
  await checkLiveWriteFreezeActive();
  checkLiveProviderIdentity(targets);
  checkOkReport("Cloudflare production preflight", "cloudflare/production-preflight-report.json");
  checkPostCutoverD1Report();
  checkDnsCutoverEvidence();
  checkProductionSmokeReport();
  checkPlaywrightReport();
  checkFinalEvidenceChain();

  requireNonEmptyFile("supabase/schema-public.sql");
  requireNonEmptyFile("supabase/data-public.sql");
  requireNonEmptyFile("checksums/local-backup-files.sha256");
  requireNonEmptyFile("env/vercel-production-env-pull.local");
  requireAnyNonEmptyFile("Vercel inspect backup", [
    "vercel/inspect-inspirlearning.com.txt",
    "vercel/inspect-inspirlearning.com.err",
  ]);

  const ok = writeReport();
  if (!ok) process.exitCode = 1;
}

function checkFinalWriteFreezeReport() {
  const report = readBackupJson<WriteFreezeEvidenceReport>(WRITE_FREEZE_REPORT);
  const validation = validateFinalWriteFreezeEvidenceReport(report, {
    backupDir,
    maxAgeMs: MAX_REPORT_AGE_MS,
  });
  if (validation.ok) {
    pass("final write-freeze report", validation.detail);
  } else {
    fail("final write-freeze report", {
      report: WRITE_FREEZE_REPORT,
      blockers: validation.blockers,
      ...validation.detail,
    });
  }
}

async function checkLiveWriteFreezeActive() {
  const readiness = await buildWriteFreezeReadinessReport(backupDir);
  if (readiness.ok && readiness.writeFreezeActive === true) {
    pass("live write-freeze active", {
      url: readiness.url,
      status: readiness.probe.status,
      code: readiness.probe.code,
    });
    return;
  }

  fail("live write-freeze active", {
    url: readiness.url,
    endpointContractOk: readiness.endpointContractOk,
    writeFreezeActive: readiness.writeFreezeActive,
    probe: readiness.probe,
    problems: readiness.problems,
  });
}

function checkDnsCutoverEvidence() {
  const validation = validateDnsCutoverEvidence(backupDir, { maxAgeMs: MAX_REPORT_AGE_MS });
  if (!validation.ok) {
    fail("DNS cutover verification", {
      blockers: validation.blockers,
      planFingerprint: validation.planApply.planFingerprint,
    });
    return;
  }
  pass("DNS cutover verification", {
    report: validation.mode === "manual-public-dns" ? "cloudflare/dns-public-cutover-report.json" : "cloudflare/dns-cutover-report.json",
    mode: validation.mode,
    planFingerprint: validation.planApply.planFingerprint,
  });
}

function checkConfirmation(key: string, expected: string) {
  if (process.env[key] === expected) pass(`confirmation: ${key}`);
  else fail(`confirmation: ${key}`, { expected });
}

function checkBackupDirConfirmation() {
  const blocker = backupDirConfirmationBlocker(backupDir);
  if (blocker) fail("confirmation: CONFIRM_BACKUP_DIR", { expected: backupDir, blocker });
  else pass("confirmation: CONFIRM_BACKUP_DIR");
}

function checkOkReport(name: string, relativePath: string, expectations: { baseUrl?: string } = {}) {
  const report = readReport(relativePath);
  if (!report) return;

  if (report.ok !== true) {
    fail(name, { report: relativePath, ok: report.ok });
    return;
  }

  if (expectations.baseUrl && report.baseUrl !== expectations.baseUrl) {
    fail(name, { report: relativePath, expectedBaseUrl: expectations.baseUrl, actualBaseUrl: report.baseUrl });
    return;
  }

  const reportOk = checkReportFreshness(name, relativePath, report);
  if (!reportOk) return;
  if (!report.backupDir) {
    fail(name, { report: relativePath, missing: "backupDir" });
    return;
  }
  if (path.resolve(report.backupDir) !== path.resolve(backupDir)) {
    fail(name, { report: relativePath, expectedBackupDir: backupDir, actualBackupDir: report.backupDir });
    return;
  }

  pass(name, { report: relativePath });
}

function checkProductionSmokeReport() {
  const relativePath = "cloudflare/production-smoke-report.json";
  const report = readReport(relativePath);
  if (!report) return;

  const validation = validateProductionSmokeReport(report);
  if (!validation.ok) {
    fail("Cloudflare production smoke", {
      report: relativePath,
      ok: report.ok,
      baseUrl: validation.baseUrl,
      baseUrlOk: validation.baseUrlOk,
      failedChecks: validation.failedChecks,
      checksOk: validation.checksOk,
      missingChecks: validation.missingChecks,
      failingRequiredChecks: validation.failingRequiredChecks,
    });
    return;
  }

  const reportOk = checkReportFreshness("Cloudflare production smoke", relativePath, report);
  if (!reportOk) return;
  if (!report.backupDir) {
    fail("Cloudflare production smoke", { report: relativePath, missing: "backupDir" });
    return;
  }
  if (path.resolve(report.backupDir) !== path.resolve(backupDir)) {
    fail("Cloudflare production smoke", { report: relativePath, expectedBackupDir: backupDir, actualBackupDir: report.backupDir });
    return;
  }

  pass("Cloudflare production smoke", {
    report: relativePath,
    baseUrl: validation.baseUrl,
    checks: validation.presentChecks.length,
  });
}

function checkPostCutoverD1Report() {
  const relativePath = "cloudflare/d1-post-cutover-validation-report.json";
  const report = readReport(relativePath);
  if (!report) return;

  const currentArtifactFingerprint = buildD1ArtifactFingerprintSafely(backupDir);
  const validation = validatePostCutoverD1Report(report, {
    expectedArtifactFingerprint: currentArtifactFingerprint.fingerprint,
    artifactFingerprintError: currentArtifactFingerprint.error,
  });
  if (!validation.ok) {
    fail("D1 post-cutover validation", {
      report: relativePath,
      ok: report.ok,
      database: validation.database,
      databaseOk: validation.databaseOk,
      integrityOk: validation.integrityOk,
      tableCoverageOk: validation.tableCoverageOk,
      exactTablesOk: validation.exactTablesOk,
      mutableTablesOk: validation.mutableTablesOk,
      sourceHashesOk: validation.sourceHashesOk,
      timestampPrecisionOk: validation.timestampPrecisionOk,
      artifactFingerprintOk: validation.artifactFingerprintOk,
      artifactFingerprintError: validation.artifactFingerprintError,
      artifactFingerprint: validation.artifactFingerprint,
      expectedArtifactFingerprint: validation.expectedArtifactFingerprint,
      missingTables: validation.missingTables,
      unexpectedTables: validation.unexpectedTables,
      badExactTables: validation.badExactTables,
      badMutableTables: validation.badMutableTables,
      mismatchedSourceHashes: validation.mismatchedSourceHashes,
    });
    return;
  }

  const reportOk = checkReportFreshness("D1 post-cutover validation", relativePath, report);
  if (!reportOk) return;
  if (!report.backupDir) {
    fail("D1 post-cutover validation", { report: relativePath, missing: "backupDir" });
    return;
  }
  if (path.resolve(report.backupDir) !== path.resolve(backupDir)) {
    fail("D1 post-cutover validation", { report: relativePath, expectedBackupDir: backupDir, actualBackupDir: report.backupDir });
    return;
  }

  pass("D1 post-cutover validation", {
    report: relativePath,
    exactTables: report.exactTableCount,
    mutableTables: report.mutableTableCount,
    timestampPrecision: validation.timestampPrecision,
    artifactFingerprint: validation.artifactFingerprint,
  });
}

function checkPlaywrightReport() {
  const relativePath = "cloudflare/playwright-production-report.json";
  const report = readReport(relativePath);
  if (!report) return;

  const validation = validateProductionPlaywrightReport(report);
  if (validation.ok) {
    const reportOk = checkReportFreshness("production Playwright report", relativePath, report);
    if (!reportOk) return;
    if (!report.backupDir) {
      fail("production Playwright report", { report: relativePath, missing: "backupDir" });
      return;
    }
    if (path.resolve(report.backupDir) !== path.resolve(backupDir)) {
      fail("production Playwright report", { report: relativePath, expectedBackupDir: backupDir, actualBackupDir: report.backupDir });
      return;
    }
    const normalizedBaseUrl = normalizeBaseUrl(report.baseUrl ?? "");
    if (normalizedBaseUrl !== FINAL_PRODUCTION_BASE_URL) {
      fail("production Playwright report", {
        expectedBaseUrl: FINAL_PRODUCTION_BASE_URL,
        actualBaseUrl: report.baseUrl,
      });
      return;
    }
    pass("production Playwright report", {
      expected: validation.expected,
      skipped: validation.skipped,
      unexpected: validation.unexpected,
      flaky: validation.flaky,
      baseUrl: normalizedBaseUrl,
      requiredTitles: validation.presentTitles,
    });
  } else {
    fail("production Playwright report", {
      ok: report.ok,
      baseUrl: validation.baseUrl,
      baseUrlOk: validation.baseUrlOk,
      expected: validation.expected,
      skipped: validation.skipped,
      unexpected: validation.unexpected,
      flaky: validation.flaky,
      requiredTitlesOk: validation.requiredTitlesOk,
      missingTitles: validation.missingTitles,
    });
  }
}

function checkFinalEvidenceChain() {
  const currentArtifactFingerprint = buildD1ArtifactFingerprintSafely(backupDir);
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const result = checkFinalCutoverEvidenceChain(backupDir, {
    maxAgeMs: MAX_REPORT_AGE_MS,
    expectedSourceFingerprint: currentSourceFingerprint,
    expectedD1ArtifactFingerprint: currentArtifactFingerprint.fingerprint,
    d1ArtifactFingerprintError: currentArtifactFingerprint.error,
  });
  if (result.ok) pass("final cutover evidence chain", result.reports);
  else fail("final cutover evidence chain", { reports: result.reports, blockers: result.blockers });
}

function checkEvidenceManifestVerification() {
  const result = checkFreshVerifiedEvidenceManifest(backupDir, MAX_REPORT_AGE_MS, {
    requiredFiles: requiredEvidenceFiles(),
  });
  if (result.ok) pass("evidence manifest verification", result.detail);
  else fail("evidence manifest verification", { ...result.detail, blockers: result.blockers });
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

function resolveRetirementTargets(): RetirementTargets {
  const vercelProject = readBackupJson<{ projectId?: string; orgId?: string; projectName?: string }>("vercel/project.json");
  if (!vercelProject?.projectId || !vercelProject.orgId || vercelProject.projectName !== EXPECTED_VERCEL_PROJECT) {
    fail("retirement target: Vercel project backup", {
      expectedProject: EXPECTED_VERCEL_PROJECT,
      projectName: vercelProject?.projectName,
      projectId: vercelProject?.projectId,
      orgId: vercelProject?.orgId,
    });
  }

  const supabaseProject = readBackupJson<{
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
    fail("retirement target: Supabase project metadata backup", {
      expectedOrgId: EXPECTED_SUPABASE_ORG_ID,
      projectRef: supabaseProjectRef,
      organizationId: supabaseOrgId,
      name: supabaseProjectName,
    });
  }
  const suppliedSupabaseRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (suppliedSupabaseRef && suppliedSupabaseRef !== supabaseProjectRef) {
    fail("retirement target: Supabase project ref override", {
      expectedFromBackup: supabaseProjectRef,
      supplied: suppliedSupabaseRef,
    });
  }

  return {
    vercelProjectName: vercelProject?.projectName ?? EXPECTED_VERCEL_PROJECT,
    vercelProjectId: vercelProject?.projectId ?? "",
    vercelOrgId: vercelProject?.orgId ?? "",
    vercelDeleteTarget: `${vercelProject?.orgId ?? ""}/${vercelProject?.projectId ?? ""}/${vercelProject?.projectName ?? EXPECTED_VERCEL_PROJECT}`,
    supabaseOrgId: supabaseOrgId || EXPECTED_SUPABASE_ORG_ID,
    supabaseProjectRef,
    supabaseProjectName,
    supabaseDeleteTarget: `${supabaseOrgId || EXPECTED_SUPABASE_ORG_ID}/${supabaseProjectRef}/${supabaseProjectName}`,
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

  fail("retirement target: Supabase project ref", "Could not derive project ref from local backup env files.");
  return "";
}

function checkLiveProviderIdentity(targets: RetirementTargets) {
  const vercel = lookupLiveVercelProject(targets);
  if (vercel.ok) pass("live Vercel project identity", vercel.detail);
  else fail("live Vercel project identity", vercel.detail);

  const supabase = lookupLiveSupabaseProject(targets);
  if (supabase.ok) pass("live Supabase project identity", supabase.detail);
  else fail("live Supabase project identity", supabase.detail);
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
      detail: { status: result.status, stderr: redactProviderProcessOutput(result.stderr ?? String(result.error ?? "")) },
    };
  }
  const projects = parseProjectArray(result.stdout ?? "");
  const project = projects.find((candidate) => candidate.id === targets.vercelProjectId);
  return {
    ok: project?.name === targets.vercelProjectName,
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

function checkReportFreshness(name: string, relativePath: string, report: JsonReport) {
  if (!report.createdAt) {
    fail(name, { report: relativePath, missing: "createdAt" });
    return false;
  }
  const createdAt = Date.parse(report.createdAt);
  if (!Number.isFinite(createdAt)) {
    fail(name, { report: relativePath, invalidCreatedAt: report.createdAt });
    return false;
  }
  if (Date.now() - createdAt > MAX_REPORT_AGE_MS) {
    fail(name, { report: relativePath, stale: true, createdAt: report.createdAt });
    return false;
  }
  return true;
}

function readBackupJson<T>(relativePath: string): T | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function readReport(relativePath: string): JsonReport | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`required report: ${relativePath}`, "missing");
    return null;
  }
  if (fs.statSync(absolutePath).size === 0) {
    fail(`required report: ${relativePath}`, "empty");
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as JsonReport;
  } catch (error) {
    fail(`required report: ${relativePath}`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function requireNonEmptyFile(relativePath: string) {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`required file: ${relativePath}`, "missing");
    return;
  }
  if (fs.statSync(absolutePath).size === 0) {
    fail(`required file: ${relativePath}`, "empty");
    return;
  }
  pass(`required file: ${relativePath}`);
}

function requireAnyNonEmptyFile(name: string, relativePaths: string[]) {
  const found = relativePaths.find((relativePath) => {
    const absolutePath = path.join(backupDir, relativePath);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0;
  });
  if (found) pass(`required file group: ${name}`, { file: found });
  else fail(`required file group: ${name}`, { missingOrEmpty: relativePaths });
}

function writeReport() {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: failed.length === 0,
    failedChecks: failed.length,
    checks,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}
