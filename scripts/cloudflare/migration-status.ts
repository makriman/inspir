import fs from "node:fs";
import path from "node:path";
import {
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  LOCAL_GATE_IDS,
  RUNTIME_MUTABLE_TABLES,
  TABLE_ORDER,
  TIMESTAMP_PRECISION_RELATIVE_PATH,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  hasFlag,
  resolveBackupDir,
  type TableName,
} from "./migration-config";
import { writeEvidenceManifest } from "./evidence-manifest";
import { D1_SIZE_SAFETY_REPORT, type D1SizeSafetyReport } from "./d1-size-safety";
import { D1_TRANSFORM_FIDELITY_REPORT, type D1TransformFidelityReport } from "./d1-transform-fidelity";
import { SOURCE_TABLE_COVERAGE_REPORT, type SourceTableCoverageReport } from "./source-table-coverage";
import {
  buildD1ArtifactFingerprint,
  buildVectorizeArtifactFingerprint,
  type MigrationArtifactFingerprint,
  type VectorizeArtifactFingerprint,
} from "./migration-artifact-fingerprint";
import { buildRepoSourceFingerprint, fingerprintFile, type SourceFileFingerprint, type SourceFingerprint } from "./source-fingerprint";
import type { SourceSecretScanReport } from "./scan-source-secrets";
import type { RuntimeProviderScanReport } from "./scan-runtime-providers";
import type { BuildArtifactScanReport } from "./scan-build-artifacts";
import { hardenBackupPermissions, type BackupPermissionsReport } from "./harden-backup-permissions";
import {
  WRITE_FREEZE_READINESS_REPORT,
  WRITE_FREEZE_REPORT,
  validateFinalWriteFreezeEvidenceReport,
  type WriteFreezeEvidenceReport,
  type WriteFreezeReadinessReport,
} from "./write-freeze-evidence";
import { checkD1PreImportBackup, type D1PreImportBackupReport } from "./d1-pre-import-backup";
import {
  VECTORIZE_PRE_IMPORT_BACKUP_REPORT,
  checkVectorizePreImportBackup,
  type VectorizePreImportBackupReport,
} from "./vectorize-pre-import-backup";
import {
  validatePostCutoverD1Report,
  validatePostCutoverVectorizeReport,
  validateProductionPlaywrightReport,
  validateProductionSmokeReport,
  validateWorkerDeployReport,
} from "./final-cutover-evidence-chain";
import {
  providerRetirementRunEvidenceBlockers,
  type ProviderRetirementRunEvidence,
} from "./provider-retirement-safety";
import {
  credentialRotationEvidenceBlockers,
  type CredentialRotationReport,
} from "./verify-credential-rotation";
import {
  cloudflareApiTokenInstructions,
  cloudflareApiTokenSourceLabel,
  readCloudflareApiToken,
} from "./cloudflare-api-token";
import { WORKER_DEPLOY_REPORT } from "./worker-deploy-evidence";
import {
  DNS_PUBLIC_CUTOVER_REPORT,
  validateDnsCutoverEvidence,
} from "./dns-cutover-evidence";
import { FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT } from "./backup-frozen-cloudflare-production";

type StageStatus = "pass" | "blocked" | "missing";

type Stage = {
  id: string;
  name: string;
  status: StageStatus;
  detail?: unknown;
};

type FingerprintResult<T> = {
  fingerprint: T | null;
  error: string | null;
};

type JsonReport = {
  createdAt?: string;
  backupDir?: string;
  ok?: boolean;
  exactTableCount?: number;
  mutableTableCount?: number;
  checks?: Array<{ name?: string; status?: string; detail?: unknown }>;
  failedChecks?: number;
  stats?: {
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
  } | null;
  error?: string;
  missingEnv?: string[];
  sourceFingerprintBefore?: SourceFingerprint;
  sourceFingerprintAfter?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  mode?: string;
  status?: number | null;
  commandExecuted?: boolean;
};

type FrozenCloudflareProductionBackupReport = {
  createdAt?: string;
  backupDir?: string;
  ok?: boolean;
  confirmations?: {
    confirmWriteFreeze?: boolean;
    confirmFinalBackup?: boolean;
    confirmFrozenSource?: boolean;
    confirmBackupDir?: boolean;
  };
  writeFreeze?: {
    createdAt?: string;
    ok?: boolean;
    finalBackup?: boolean;
  };
  d1?: {
    file?: string;
    bytes?: number;
    sha256?: string;
  } | null;
  vectorize?: {
    file?: string;
    rows?: number;
    sha256?: string;
  } | null;
};

type D1ValidationReport = {
  createdAt?: string;
  completedAt?: string;
  backupDir?: string;
  ok?: boolean;
  artifactFingerprint?: MigrationArtifactFingerprint;
  quickCheck?: Array<{ quick_check?: string }>;
  foreignKeyCheck?: unknown[];
  tables?: Array<{
    table: TableName;
    expectedRows: number;
    actualRows: number;
    expectedSha256?: string;
    actualSha256?: string;
    ok: boolean;
  }>;
  timestampPrecision?: {
    table?: string;
    expectedRows?: number;
    actualRows?: number;
    expectedSha256?: string;
    actualSha256?: string;
    ok?: boolean;
  };
  mismatchedSourceHashes?: unknown[];
};

type D1ImportRunReport = {
  createdAt?: string;
  completedAt?: string;
  backupDir?: string;
  ok?: boolean;
  resetSkipped?: boolean;
  artifactFingerprint?: MigrationArtifactFingerprint;
  imported?: Partial<Record<TableName, number>>;
  preImportBackup?: D1PreImportBackupReport;
  timestampPrecision?: {
    table?: string;
    rows?: number;
    sha256?: string;
    file?: string;
  };
  cleanup?: {
    attempted?: boolean;
    ok?: boolean | null;
    kept?: boolean;
  };
};

type LocalGatesReport = {
  createdAt?: string;
  backupDir?: string;
  ok?: boolean;
  sourceFingerprintBefore?: SourceFingerprint;
  sourceFingerprintAfter?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
  startupProfile?: SourceFileFingerprint | null;
  results?: Array<{
    id?: string;
    ok?: boolean;
    status?: number | null;
    durationMs?: number;
  }>;
};

type VectorizeImportReport = {
  createdAt?: string;
  completedAt?: string;
  backupDir?: string;
  ok?: boolean;
  reset?: boolean;
  artifactSha256?: string;
  manifestSha256?: string;
  artifactSha256MatchesManifest?: boolean;
  artifactFingerprint?: VectorizeArtifactFingerprint;
  expectedRows?: number;
  preImportBackup?: VectorizePreImportBackupReport;
  missingIds?: string[];
  unexpectedIds?: string[];
  remoteVectorChecks?: {
    ok?: boolean;
    fetchedRows?: number;
    expectedRows?: number;
    problems?: unknown[];
  };
  info?: {
    vectorCount?: number;
  };
};

type DnsDryRunPlanReport = {
  createdAt?: string;
  backupDir?: string;
  domain?: string;
  apply?: boolean;
  ok?: boolean;
  gateVersion?: number;
  planFingerprint?: string;
  zone?: {
    name?: string;
    status?: string;
    accountId?: string;
  };
  plannedActions?: Array<{
    action?: string;
    reason?: string;
    fingerprint?: string;
    record?: { id?: string; name?: string; type?: string; content?: string };
  }>;
  error?: string;
};

type CloudflareTokenCapabilityReport = JsonReport & {
  domain?: string;
  accountId?: string;
  credentialSource?: string | null;
  requiredPermissions?: unknown;
};

type ProviderRetirementRunReport = JsonReport & ProviderRetirementRunEvidence;

const strict = hasFlag("--strict");
const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const outputPath = path.join(cfDir, "migration-status-report.json");
const MAX_FINAL_DATA_REPORT_AGE_MS = 60 * 60 * 1000;
const DOMAIN = "inspirlearning.com";
const DNS_GATE_VERSION = 2;
const DNS_HOSTNAMES = new Set([DOMAIN, `www.${DOMAIN}`]);
const HTTP_DNS_TYPES = new Set(["A", "AAAA", "CNAME"]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

const stages: Stage[] = [];

void main();

function main() {
  addRequiredFilesStage();
  addWriteFreezeReadinessStage();
  addFinalWriteFreezeBackupStage();
  addBackupPermissionsStage();
  addSourceTableCoverageStage();
  addCanonicalExportsStage();
  addD1TransformFidelityStage();
  addD1SizeSafetyStage();
  addLocalGatesStage();
  addSourceSecretScanStage();
  addRuntimeProviderScanStage();
  addBuildArtifactScanStage();
  addPreviewPlaywrightStage();
  addFreshOkReportStage("local-d1-rehearsal", "Local D1 full import rehearsal", "cloudflare/d1-local-rehearsal-report.json");
  addFreshOkReportStage(
    "local-vectorize-rehearsal",
    "Local Vectorize artifact rehearsal",
    "cloudflare/vectorize-local-rehearsal-report.json",
  );
  addD1ImportStage();
  addVectorizeImportStage();
  addFreshOkReportStage("production-preflight", "Production preflight", "cloudflare/production-preflight-report.json");
  addPreflightCheckStage("live-cloudflare-inventory", "Live Cloudflare inventory", "live Cloudflare inventory");
  addCloudflareTokenCapabilityStage();
  addDnsDryRunStage();
  addDnsCutoverStage();
  addWorkerDeployStage();
  addProductionSmokeStage();
  addPlaywrightStage();
  addPostCutoverD1Stage();
  addPostCutoverVectorizeStage();
  addOkReportStage("provider-retirement", "Provider retirement preflight", "cloudflare/provider-retirement-preflight-report.json");
  addProviderRetirementRunStage();
  addCredentialRotationStage();
  addEnvironmentStage();

  const report = buildReport();
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const evidenceManifest = writeEvidenceManifest(backupDir);
  printSummary(report);
  console.log(`Evidence manifest: ${evidenceManifest.manifestPath} (${evidenceManifest.files} files)`);

  if (strict && !report.providersRetired) process.exitCode = 1;
}

function addD1TransformFidelityStage() {
  const report = readReport<D1TransformFidelityReport>(D1_TRANSFORM_FIDELITY_REPORT);
  if (!report) {
    stages.push({
      id: "d1-transform-fidelity",
      name: "D1 transform fidelity",
      status: "missing",
      detail: { report: D1_TRANSFORM_FIDELITY_REPORT },
    });
    return;
  }

  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const badTables = (report.tables ?? []).filter((table) => !table.ok);
  const ok = report.ok === true && backupDirOk && report.tables.length === TABLE_ORDER.length && badTables.length === 0;
  stages.push({
    id: "d1-transform-fidelity",
    name: "D1 transform fidelity",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: D1_TRANSFORM_FIDELITY_REPORT,
          rows: report.totals.rows,
          timestampValues: report.totals.timestampValues,
          timestampPrecisionRows: report.totals.timestampPrecisionRows,
          vectorValues: report.totals.vectorValues,
        }
      : {
          report: D1_TRANSFORM_FIDELITY_REPORT,
          ok: report.ok,
          backupDirOk,
          tableCount: report.tables?.length ?? 0,
          badTables: badTables.map((table) => ({
            table: table.table,
            problems: table.problems,
            artifactRowsMatchTransform: table.artifactRowsMatchTransform,
          })),
        },
  });
}

function addWriteFreezeReadinessStage() {
  const report = readReport<WriteFreezeReadinessReport>(WRITE_FREEZE_READINESS_REPORT);
  if (!report) {
    stages.push({
      id: "write-freeze-readiness",
      name: "Live write-freeze endpoint readiness",
      status: "missing",
      detail: { report: WRITE_FREEZE_READINESS_REPORT },
    });
    return;
  }

  const freshness = reportFreshness(report, WRITE_FREEZE_READINESS_REPORT);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const ok = report.ok === true && report.endpointContractOk === true && backupDirOk && freshness.ok;

  stages.push({
    id: "write-freeze-readiness",
    name: "Live write-freeze endpoint readiness",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: WRITE_FREEZE_READINESS_REPORT,
          url: report.url,
          writeFreezeActive: report.writeFreezeActive,
          freshness: freshness.detail,
        }
      : {
          report: WRITE_FREEZE_READINESS_REPORT,
          ok: report.ok,
          endpointContractOk: report.endpointContractOk,
          writeFreezeActive: report.writeFreezeActive,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          probe: report.probe,
          problems: report.problems,
        },
  });
}

function addFinalWriteFreezeBackupStage() {
  const report = readReport<WriteFreezeEvidenceReport>(WRITE_FREEZE_REPORT);
  if (!report) {
    stages.push({
      id: "final-write-freeze-backup",
      name: "Final write-freeze backup evidence",
      status: "missing",
      detail: { report: WRITE_FREEZE_REPORT },
    });
    return;
  }

  const validation = readReport<{ createdAt?: string }>("supabase/validation.json");
  const frozenCloudflareBackup = readReport<FrozenCloudflareProductionBackupReport>(FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT);
  const freezeValidation = validateFinalWriteFreezeEvidenceReport(report, {
    backupDir,
    maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
  });
  const evidenceBeforeValidation =
    reportTimestamp(report.createdAt) > 0 &&
    reportTimestamp(validation?.createdAt) > 0 &&
    reportTimestamp(report.createdAt) <= reportTimestamp(validation?.createdAt);
  const frozenCloudflareBackupValidation = validateFrozenCloudflareProductionBackup(frozenCloudflareBackup, report);
  const backupEvidenceOk = evidenceBeforeValidation || frozenCloudflareBackupValidation.ok;
  const ok = freezeValidation.ok && backupEvidenceOk;

  stages.push({
    id: "final-write-freeze-backup",
    name: "Final write-freeze backup evidence",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: WRITE_FREEZE_REPORT,
          probe: report.probe.required ? { url: report.probe.url, status: report.probe.status } : { waiverConfirmed: true },
        }
      : {
          report: WRITE_FREEZE_REPORT,
          blockers: freezeValidation.blockers,
          ...freezeValidation.detail,
          evidenceBeforeValidation,
          frozenCloudflareBackup: frozenCloudflareBackupValidation.detail,
          probe: report.probe,
          externalFreeze: report.externalFreeze,
          problems: report.problems,
        },
  });
}

function validateFrozenCloudflareProductionBackup(
  report: FrozenCloudflareProductionBackupReport | null,
  writeFreeze: WriteFreezeEvidenceReport,
) {
  const freshness = report ? reportFreshness(report, FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT) : null;
  const backupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const confirmationsOk =
    report?.confirmations?.confirmWriteFreeze === true &&
    report.confirmations.confirmFinalBackup === true &&
    report.confirmations.confirmFrozenSource === true &&
    report.confirmations.confirmBackupDir === true;
  const writeFreezeOk =
    report?.writeFreeze?.ok === true &&
    report.writeFreeze.finalBackup === true &&
    report.writeFreeze.createdAt === writeFreeze.createdAt;
  const d1Ok =
    report?.d1?.file === "cloudflare/d1-pre-import-backup.sql" &&
    typeof report.d1.bytes === "number" &&
    report.d1.bytes > 0 &&
    typeof report.d1.sha256 === "string" &&
    report.d1.sha256.length === 64 &&
    hasNonEmptyFile(report.d1.file);
  const vectorizeOk =
    report?.vectorize?.file === "cloudflare/vectorize-pre-import-backup.ndjson" &&
    typeof report.vectorize.rows === "number" &&
    report.vectorize.rows >= 0 &&
    typeof report.vectorize.sha256 === "string" &&
    report.vectorize.sha256.length === 64 &&
    hasNonEmptyFile(report.vectorize.file);
  const ok =
    report?.ok === true &&
    backupDirOk &&
    freshness?.ok === true &&
    confirmationsOk &&
    writeFreezeOk &&
    d1Ok &&
    vectorizeOk;
  return {
    ok,
    detail: {
      report: FROZEN_CLOUDFLARE_PRODUCTION_BACKUP_REPORT,
      present: Boolean(report),
      reportOk: report?.ok === true,
      backupDirOk,
      fresh: freshness?.ok ?? false,
      freshness: freshness?.detail ?? null,
      confirmationsOk,
      writeFreezeOk,
      d1Ok,
      vectorizeOk,
    },
  };
}

function addCloudflareTokenCapabilityStage() {
  const relativePath = "cloudflare/cloudflare-api-token-capability-report.json";
  const dnsCutover = validateDnsCutoverEvidence(backupDir, { maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS });
  if (dnsCutover.ok) {
    stages.push({
      id: "cloudflare-token-capability",
      name: "Cloudflare API token capability",
      status: "pass",
      detail: {
        waivedAfterDnsCutover: true,
        dnsCutoverMode: dnsCutover.mode,
        remediation:
          "Cloudflare DNS edit-token proof is no longer required for cutover because fresh DNS/HTTP evidence proves apex and www are already serving through Cloudflare.",
      },
    });
    return;
  }

  const report = readReport<CloudflareTokenCapabilityReport>(relativePath);
  if (!report) {
    stages.push({
      id: "cloudflare-token-capability",
      name: "Cloudflare API token capability",
      status: "missing",
      detail: { report: relativePath },
    });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const ok =
    report.ok === true &&
    backupDirOk &&
    freshness.ok &&
    report.domain === DOMAIN &&
    report.accountId === CLOUDFLARE_ACCOUNT_ID &&
    Boolean(report.credentialSource) &&
    (report.failedChecks ?? 0) === 0 &&
    (report.checks ?? []).every((check) => check.status === "pass");

  stages.push({
    id: "cloudflare-token-capability",
    name: "Cloudflare API token capability",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          credentialSource: report.credentialSource,
          freshness: freshness.detail,
        }
      : {
          report: relativePath,
          ok: report.ok,
          domain: report.domain,
          accountId: report.accountId,
          credentialSource: report.credentialSource,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          failedChecks: report.failedChecks,
          requiredPermissions: report.requiredPermissions ?? cloudflareApiTokenInstructions().requiredPermissions,
          failingChecks: failingChecks(report).slice(0, 12),
        },
  });
}

function addDnsDryRunStage() {
  const dnsCutover = validateDnsCutoverEvidence(backupDir, { maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS });
  if (dnsCutover.ok) {
    stages.push({
      id: "dns-dry-run",
      name: "DNS cutover dry-run plan",
      status: "pass",
      detail: {
        waivedAfterDnsCutover: true,
        dnsCutoverMode: dnsCutover.mode,
        planFingerprint: dnsCutover.planApply.planFingerprint,
      },
    });
    return;
  }

  const preferredPath = "cloudflare/dns-cutover-dry-run-plan.json";
  const legacyPath = "cloudflare/dns-cutover-plan.json";
  const relativePath = hasNonEmptyFile(preferredPath) ? preferredPath : legacyPath;
  const report = readReport<DnsDryRunPlanReport>(relativePath);
  if (!report) {
    stages.push({
      id: "dns-dry-run",
      name: "DNS cutover dry-run plan",
      status: "missing",
      detail: { report: preferredPath, fallbackReport: legacyPath },
    });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const actionProblems = dnsDryRunActionProblems(report);
  const reportProblems = dnsDryRunReportProblems(report);
  const consistencyProblems = dnsDryRunConsistencyProblems(preferredPath, legacyPath);
  const ok =
    report.ok === true &&
    report.apply === false &&
    SHA256_HEX.test(report.planFingerprint ?? "") &&
    backupDirOk &&
    freshness.ok &&
    reportProblems.length === 0 &&
    actionProblems.length === 0 &&
    consistencyProblems.length === 0;

  stages.push({
    id: "dns-dry-run",
    name: "DNS cutover dry-run plan",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          planFingerprint: report.planFingerprint,
          plannedActions: report.plannedActions?.length ?? 0,
          freshness: freshness.detail,
          gateVersion: report.gateVersion,
        }
      : {
          report: relativePath,
          ok: report.ok,
          apply: report.apply,
          domain: report.domain,
          gateVersion: report.gateVersion,
          zone: report.zone,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          planFingerprintOk: SHA256_HEX.test(report.planFingerprint ?? ""),
          plannedActions: report.plannedActions?.length ?? 0,
          reportProblems,
          actionProblems,
          consistencyProblems,
          error: report.error,
        },
  });
}

function addDnsCutoverStage() {
  const validation = validateDnsCutoverEvidence(backupDir, { maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS });
  const apiReport = readReport("cloudflare/dns-cutover-report.json");
  const publicReport = readReport(DNS_PUBLIC_CUTOVER_REPORT);

  if (!apiReport && !publicReport) {
    stages.push({
      id: "dns-cutover",
      name: "DNS cutover verification",
      status: "missing",
      detail: {
        report: "cloudflare/dns-cutover-report.json",
        fallbackReport: DNS_PUBLIC_CUTOVER_REPORT,
      },
    });
    return;
  }

  stages.push({
    id: "dns-cutover",
    name: "DNS cutover verification",
    status: validation.ok ? "pass" : "blocked",
    detail: validation.ok
      ? {
          mode: validation.mode,
          report: validation.mode === "manual-public-dns" ? DNS_PUBLIC_CUTOVER_REPORT : "cloudflare/dns-cutover-report.json",
          publicDnsReport: publicReport ? DNS_PUBLIC_CUTOVER_REPORT : null,
          apiDnsReport: apiReport ? "cloudflare/dns-cutover-report.json" : null,
          planFingerprint: validation.planApply.planFingerprint,
        }
      : {
          report: "cloudflare/dns-cutover-report.json",
          fallbackReport: DNS_PUBLIC_CUTOVER_REPORT,
          mode: validation.mode,
          blockers: validation.blockers,
          planFingerprint: validation.planApply.planFingerprint,
        },
  });
}

function dnsDryRunReportProblems(report: DnsDryRunPlanReport) {
  const problems: string[] = [];
  if (report.domain !== DOMAIN) problems.push("domain does not match inspirlearning.com");
  if (report.gateVersion !== DNS_GATE_VERSION) problems.push("unexpected DNS gate version");
  if (report.ok === false && report.error) {
    if (!Array.isArray(report.plannedActions)) problems.push("plannedActions is not an array");
    return problems;
  }
  if (report.zone?.name !== DOMAIN) problems.push("zone name does not match inspirlearning.com");
  if (report.zone?.status !== "active") problems.push("zone is not active");
  if (report.zone?.accountId !== CLOUDFLARE_ACCOUNT_ID) problems.push("zone account does not match configured Cloudflare account");
  if (!SHA256_HEX.test(report.planFingerprint ?? "")) problems.push("missing or malformed plan fingerprint");
  if (!Array.isArray(report.plannedActions)) problems.push("plannedActions is not an array");
  return problems;
}

function dnsDryRunActionProblems(report: DnsDryRunPlanReport) {
  if (!Array.isArray(report.plannedActions)) return [];
  return report.plannedActions.flatMap((action, index) => {
    const problems: string[] = [];
    if (action.action !== "delete") problems.push("unsupported action");
    if (!action.reason) problems.push("missing reason");
    if (!SHA256_HEX.test(action.fingerprint ?? "")) problems.push("missing or malformed fingerprint");
    if (!action.record?.id) problems.push("missing record id");
    if (!action.record?.name || !DNS_HOSTNAMES.has(action.record.name)) problems.push("record name is not apex or www");
    if (!action.record?.type || !HTTP_DNS_TYPES.has(action.record.type)) problems.push("record type is not HTTP-affecting");
    if (!action.record?.content) problems.push("missing record content");
    return problems.map((problem) => ({
      index,
      record: action.record,
      problem,
    }));
  });
}

function dnsDryRunConsistencyProblems(preferredPath: string, legacyPath: string) {
  if (!hasNonEmptyFile(preferredPath) || !hasNonEmptyFile(legacyPath)) return [];
  const preferred = readReport<DnsDryRunPlanReport>(preferredPath);
  const legacy = readReport<DnsDryRunPlanReport>(legacyPath);
  if (!preferred || !legacy) return ["could not compare DNS dry-run compatibility files"];
  const comparedFields = ["apply", "ok", "backupDir", "domain", "gateVersion", "planFingerprint"] as const;
  const problems = comparedFields.flatMap((field) =>
    preferred[field] === legacy[field] ? [] : [`${preferredPath} and ${legacyPath} disagree on ${field}`],
  );
  if ((preferred.plannedActions?.length ?? -1) !== (legacy.plannedActions?.length ?? -1)) {
    problems.push(`${preferredPath} and ${legacyPath} disagree on planned action count`);
  }
  return problems;
}

function addBackupPermissionsStage() {
  const relativePath = "cloudflare/backup-permissions-report.json";
  const report = readReport<BackupPermissionsReport>(relativePath);
  if (!report) {
    stages.push({ id: "backup-permissions", name: "Local backup permissions", status: "missing", detail: { report: relativePath } });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const current = hardenBackupPermissions(backupDir, { dryRun: true });
  const ok = report.ok === true && freshness.ok && backupDirOk && current.ok === true;
  stages.push({
    id: "backup-permissions",
    name: "Local backup permissions",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          checkedFiles: current.checkedFiles,
          checkedDirectories: current.checkedDirectories,
          desiredFileMode: current.desiredFileMode,
          desiredDirectoryMode: current.desiredDirectoryMode,
        }
      : {
          report: relativePath,
          ok: report.ok,
          fresh: freshness.ok,
          freshness: freshness.detail,
          backupDirOk,
          currentOk: current.ok,
          currentProblems: current.problems.slice(0, 12),
          currentSymlinks: current.symlinks.slice(0, 12),
          reportProblems: report.problems?.slice(0, 12),
          reportSymlinks: report.symlinks?.slice(0, 12),
        },
  });
}

function addSourceSecretScanStage() {
  const relativePath = "cloudflare/source-secret-scan-report.json";
  const report = readReport<SourceSecretScanReport>(relativePath);
  if (!report) {
    stages.push({ id: "source-secret-scan", name: "Source secret scan", status: "missing", detail: { report: relativePath } });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const findings = report.findings?.length ?? 0;
  const ok = report.ok === true && freshness.ok && backupDirOk && sourceFingerprintOk && findings === 0;
  stages.push({
    id: "source-secret-scan",
    name: "Source secret scan",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          sourceFingerprint: currentSourceFingerprint.sha256,
          scannedFiles: report.scannedFiles,
        }
      : {
          report: relativePath,
          ok: report.ok,
          fresh: freshness.ok,
          freshness: freshness.detail,
          backupDirOk,
          sourceFingerprintOk,
          expectedSourceFingerprint: report.sourceFingerprint?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
          findings: report.findings?.slice(0, 12),
        },
  });
}

function addRuntimeProviderScanStage() {
  const relativePath = "cloudflare/runtime-provider-scan-report.json";
  const report = readReport<RuntimeProviderScanReport>(relativePath);
  if (!report) {
    stages.push({
      id: "runtime-provider-scan",
      name: "Runtime provider dependency scan",
      status: "missing",
      detail: { report: relativePath },
    });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const findings = report.findings?.length ?? 0;
  const scannedFiles = report.scannedFiles?.length ?? 0;
  const scannedFilesOk = scannedFiles > 0;
  const ok = report.ok === true && freshness.ok && backupDirOk && sourceFingerprintOk && findings === 0 && scannedFilesOk;
  stages.push({
    id: "runtime-provider-scan",
    name: "Runtime provider dependency scan",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          sourceFingerprint: currentSourceFingerprint.sha256,
          scannedFiles,
        }
      : {
          report: relativePath,
          ok: report.ok,
          fresh: freshness.ok,
          freshness: freshness.detail,
          backupDirOk,
          sourceFingerprintOk,
          expectedSourceFingerprint: report.sourceFingerprint?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
          scannedFiles,
          findings: report.findings?.slice(0, 12),
        },
  });
}

function addBuildArtifactScanStage() {
  const relativePath = "cloudflare/build-artifact-scan-report.json";
  const report = readReport<BuildArtifactScanReport>(relativePath);
  if (!report) {
    stages.push({
      id: "build-artifact-secret-scan",
      name: "OpenNext build artifact secret scan",
      status: "missing",
      detail: { report: relativePath },
    });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const findings = report.findings?.length ?? 0;
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprint?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprint?.fileCount === currentSourceFingerprint.fileCount;
  const ok =
    report.ok === true &&
    freshness.ok &&
    backupDirOk &&
    sourceFingerprintOk &&
    report.artifactRoot === ".open-next" &&
    report.nextEnvFile === ".open-next/cloudflare/next-env.mjs" &&
    findings === 0;

  stages.push({
    id: "build-artifact-secret-scan",
    name: "OpenNext build artifact secret scan",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          sourceFingerprint: currentSourceFingerprint.sha256,
          scannedFiles: report.scannedFiles,
          nextEnvFile: report.nextEnvFile,
        }
      : {
          report: relativePath,
          ok: report.ok,
          fresh: freshness.ok,
          freshness: freshness.detail,
          sourceFingerprintOk,
          expectedSourceFingerprint: report.sourceFingerprint?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
          backupDirOk,
          artifactRoot: report.artifactRoot,
          nextEnvFile: report.nextEnvFile,
          findings: report.findings?.slice(0, 12),
        },
  });
}

function addD1SizeSafetyStage() {
  const report = readReport<D1SizeSafetyReport>(D1_SIZE_SAFETY_REPORT);
  if (!report) {
    stages.push({
      id: "d1-size-safety",
      name: "D1 size safety",
      status: "missing",
      detail: { report: D1_SIZE_SAFETY_REPORT },
    });
    return;
  }

  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const badTables = (report.tables ?? []).filter((table) => !table.ok);
  const ok = report.ok === true && backupDirOk && badTables.length === 0 && report.tables?.length === TABLE_ORDER.length;
  stages.push({
    id: "d1-size-safety",
    name: "D1 size safety",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? { report: D1_SIZE_SAFETY_REPORT, tables: TABLE_ORDER.length }
      : {
          report: D1_SIZE_SAFETY_REPORT,
          ok: report.ok,
          backupDirOk,
          tableCount: report.tables?.length ?? 0,
          badTables: badTables.map((table) => ({
            table: table.table,
            problems: table.problems,
            columns: table.columns,
            insertStatementBytes: table.insertStatementBytes,
            maxRowBytes: table.maxRowBytes,
            maxValueBytes: table.maxValueBytes,
          })),
        },
  });
}

function addSourceTableCoverageStage() {
  const report = readReport<SourceTableCoverageReport>(SOURCE_TABLE_COVERAGE_REPORT);
  if (!report) {
    stages.push({
      id: "source-table-coverage",
      name: "Supabase public table coverage",
      status: "missing",
      detail: { report: SOURCE_TABLE_COVERAGE_REPORT },
    });
    return;
  }

  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const expectedTables = report.expectedTables?.length ?? 0;
  const schemaTables = report.schemaTables?.length ?? 0;
  const ok =
    report.ok === true &&
    backupDirOk &&
    expectedTables === TABLE_ORDER.length &&
    schemaTables === TABLE_ORDER.length &&
    (report.unexpectedTables?.length ?? 0) === 0 &&
    (report.missingExpectedTables?.length ?? 0) === 0 &&
    (report.duplicateSchemaTables?.length ?? 0) === 0 &&
    (report.missingCanonicalExports?.length ?? 0) === 0 &&
    (report.missingTransformedExports?.length ?? 0) === 0 &&
    (report.validationMissingTables?.length ?? 0) === 0;

  stages.push({
    id: "source-table-coverage",
    name: "Supabase public table coverage",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? { report: SOURCE_TABLE_COVERAGE_REPORT, tables: TABLE_ORDER.length }
      : {
          report: SOURCE_TABLE_COVERAGE_REPORT,
          ok: report.ok,
          backupDirOk,
          expectedTables,
          schemaTables,
          unexpectedTables: report.unexpectedTables,
          missingExpectedTables: report.missingExpectedTables,
          duplicateSchemaTables: report.duplicateSchemaTables,
          missingCanonicalExports: report.missingCanonicalExports,
          missingTransformedExports: report.missingTransformedExports,
          validationMissingTables: report.validationMissingTables,
        },
  });
}

function addD1ImportStage() {
  const relativePath = "cloudflare/d1-validation-report.json";
  const report = readReport<D1ValidationReport>(relativePath);
  const importRunPath = "cloudflare/d1-import-run.json";
  const importRun = readReport<D1ImportRunReport>(importRunPath);
  const preImportBackup = readReport<D1PreImportBackupReport>("cloudflare/d1-pre-import-backup-report.json");
  const postCutover = currentPostCutoverD1Evidence();
  const preImportBackupCheck = checkD1PreImportBackup({
    backupDir,
    database: D1_DATABASE_NAME,
    databaseId: D1_DATABASE_ID,
    report: preImportBackup,
    importRunReport: importRun?.preImportBackup,
    maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
  });
  if (!report) {
    stages.push({ id: "d1-import", name: "D1 exact import validation", status: "missing", detail: { report: relativePath } });
    return;
  }

  const manifest = readReport<Array<{ table: TableName; rows: number }>>("cloudflare/d1-import-manifest.json") ?? [];
  const transformFidelity = readReport<D1TransformFidelityReport>(D1_TRANSFORM_FIDELITY_REPORT);
  const expectedTimestampPrecision = transformFidelity?.timestampPrecisionArtifact;
  const currentArtifactFingerprint = buildFingerprintSafely(() => buildD1ArtifactFingerprint(backupDir));
  const importRunFreshness = importRun ? reportFreshness(importRun, importRunPath) : null;
  const validationFreshness = report ? reportFreshness(report, relativePath) : null;
  const importRunBackupDirOk = path.resolve(importRun?.backupDir ?? "") === path.resolve(backupDir);
  const validationBackupDirOk = path.resolve(report?.backupDir ?? "") === path.resolve(backupDir);
  const importedCountMismatches = manifest.filter((entry) => importRun?.imported?.[entry.table] !== entry.rows);
  const timestampPrecisionImportOk =
    importRun?.timestampPrecision?.rows === expectedTimestampPrecision?.rows &&
    importRun?.timestampPrecision?.sha256 === expectedTimestampPrecision?.sha256;
  const importArtifactFingerprintOk = importRun?.artifactFingerprint?.sha256 === currentArtifactFingerprint.fingerprint?.sha256;
  const validationMatchesCurrentArtifact = report?.artifactFingerprint?.sha256 === currentArtifactFingerprint.fingerprint?.sha256;
  const validationMatchesImportRun =
    Boolean(importRun?.artifactFingerprint?.sha256) && report?.artifactFingerprint?.sha256 === importRun?.artifactFingerprint?.sha256;
  const validationArtifactFingerprintOk = validationMatchesCurrentArtifact && validationMatchesImportRun;
  const timestampPrecisionValidationOk =
    report?.timestampPrecision?.ok === true &&
    report.timestampPrecision.expectedRows === expectedTimestampPrecision?.rows &&
    report.timestampPrecision.expectedSha256 === expectedTimestampPrecision?.sha256;
  const validationAfterImport = reportTimestamp(report?.completedAt ?? report?.createdAt) >= reportTimestamp(importRun?.completedAt ?? importRun?.createdAt);
  const importRunOk =
    importRun?.ok === true &&
    importRunBackupDirOk &&
    importRunFreshness?.ok === true &&
    importArtifactFingerprintOk &&
    importRun.resetSkipped === false &&
    timestampPrecisionImportOk &&
    preImportBackupCheck.ok &&
    importedCountMismatches.length === 0 &&
    importRun.cleanup?.attempted === true &&
    importRun.cleanup.ok === true &&
    importRun.cleanup.kept === false;
  if (
    report.ok === true &&
    importRunOk &&
    validationBackupDirOk &&
    validationFreshness?.ok === true &&
    validationArtifactFingerprintOk &&
    timestampPrecisionValidationOk &&
    validationAfterImport
  ) {
    stages.push({
      id: "d1-import",
      name: "D1 exact import validation",
      status: "pass",
      detail: {
        report: relativePath,
        importRun: importRunPath,
        importRunFreshness: importRunFreshness.detail,
        validationFreshness: validationFreshness.detail,
        timestampPrecisionRows: expectedTimestampPrecision?.rows ?? 0,
        artifactFingerprint: currentArtifactFingerprint.fingerprint?.sha256,
        preImportBackup: preImportBackupCheck.detail,
      },
    });
    return;
  }

  if (postCutover.ok) {
    stages.push({
      id: "d1-import",
      name: "D1 exact import validation",
      status: "pass",
      detail: {
        report: relativePath,
        mode: "post-cutover-production-validation",
        postCutover: postCutover.detail,
      },
    });
    return;
  }

  const badTables = report.tables?.filter((table) => !table.ok) ?? [];
  const runtimeMutableBadTables = badTables.filter((table) => isRuntimeMutableTable(table.table));
  const durableBadTables = badTables.filter((table) => !isRuntimeMutableTable(table.table));
  const runtimeMutableDriftOnly = badTables.length > 0 && runtimeMutableBadTables.length === badTables.length;
  stages.push({
    id: "d1-import",
    name: "D1 exact import validation",
    status: "blocked",
    detail: {
      report: relativePath,
      importRun: {
        report: importRunPath,
        ok: importRun?.ok,
        backupDirOk: importRunBackupDirOk,
        fresh: importRunFreshness?.ok,
        freshness: importRunFreshness?.detail,
        cleanup: importRun?.cleanup,
        resetSkipped: importRun?.resetSkipped,
        staleOrMissingEvidence: !importRunOk,
        artifactFingerprintOk: importArtifactFingerprintOk,
        artifactFingerprintError: currentArtifactFingerprint.error,
        timestampPrecisionImportOk,
        timestampPrecision: importRun?.timestampPrecision,
        preImportBackupOk: preImportBackupCheck.ok,
        preImportBackup: preImportBackupCheck.detail,
        importedCountMismatches,
      },
      validation: {
        backupDirOk: validationBackupDirOk,
        fresh: validationFreshness?.ok,
        freshness: validationFreshness?.detail,
        artifactFingerprintOk: validationArtifactFingerprintOk,
        artifactFingerprintError: currentArtifactFingerprint.error,
        validationMatchesCurrentArtifact,
        validationMatchesImportRun,
        validationAfterImport,
        artifactFingerprint: report.artifactFingerprint?.sha256,
        importRunArtifactFingerprint: importRun?.artifactFingerprint?.sha256,
        currentArtifactFingerprint: currentArtifactFingerprint.fingerprint?.sha256,
        timestampPrecisionValidationOk,
        timestampPrecision: report.timestampPrecision,
      },
      quickCheckOk: report.quickCheck?.[0]?.quick_check === "ok",
      foreignKeyOk: (report.foreignKeyCheck?.length ?? 0) === 0,
      durableBadTables: durableBadTables.map((table) => ({
        table: table.table,
        expectedRows: table.expectedRows,
        actualRows: table.actualRows,
      })),
      runtimeMutableBadTables: runtimeMutableBadTables.map((table) => ({
        table: table.table,
        expectedRows: table.expectedRows,
        actualRows: table.actualRows,
      })),
      runtimeMutableDriftOnly,
      postCutover: postCutover.detail,
      remediation: runtimeMutableDriftOnly
        ? "Rerun final D1 import and exact validation during write-freeze before deploy. Current validation has only runtime quota table drift; current import-run evidence is stale if staleOrMissingEvidence is true."
        : "Durable D1 tables are not in exact parity. Rebuild/re-import before deploy.",
      mismatchedSourceHashes: report.mismatchedSourceHashes?.length ?? 0,
    },
  });
}

function currentPostCutoverD1Evidence() {
  const relativePath = "cloudflare/d1-post-cutover-validation-report.json";
  const report = readReport<NonNullable<Parameters<typeof validatePostCutoverD1Report>[0]>>(relativePath);
  if (!report) return { ok: false, detail: { report: relativePath, missing: true } };

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentArtifactFingerprint = buildFingerprintSafely(() => buildD1ArtifactFingerprint(backupDir));
  const validation = validatePostCutoverD1Report(report, {
    expectedArtifactFingerprint: currentArtifactFingerprint.fingerprint,
    artifactFingerprintError: currentArtifactFingerprint.error,
  });

  return {
    ok: validation.ok && freshness.ok && backupDirOk,
    detail: {
      report: relativePath,
      reportOk: report.ok === true,
      backupDirOk,
      fresh: freshness.ok,
      freshness: freshness.detail,
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
      badExactTables: validation.badExactTables,
      badMutableTables: validation.badMutableTables,
    },
  };
}

function addRequiredFilesStage() {
  const required = [
    "supabase/schema-public.sql",
    "supabase/data-public.sql",
    "supabase/validation.json",
    "supabase/project.json",
    "checksums/supabase-table-checksums.json",
    "checksums/local-backup-files.sha256",
    "vercel/project.json",
    "vercel/vercel.json",
    "vercel/output-config.json",
    "vercel/output-builds.json",
    "vercel/alias-ls.txt",
    "env/vercel-production-env-pull.local",
    "cloudflare/env-migration-inventory.json",
    "cloudflare/backup-permissions-report.json",
    "cloudflare/source-secret-scan-report.json",
    "cloudflare/runtime-provider-scan-report.json",
    "cloudflare/build-artifact-scan-report.json",
    "cloudflare/secret-key-inventory.json",
    "cloudflare/wrangler-secret-list.json",
    D1_TRANSFORM_FIDELITY_REPORT,
  ];
  const missing = required.filter((file) => !hasNonEmptyFile(file));
  if (!hasFile(TIMESTAMP_PRECISION_RELATIVE_PATH)) missing.push(TIMESTAMP_PRECISION_RELATIVE_PATH);
  const hasVercelInspect = ["vercel/inspect-inspirlearning.com.txt", "vercel/inspect-inspirlearning.com.err"].some(hasNonEmptyFile);

  if (!hasVercelInspect) missing.push("vercel/inspect-inspirlearning.com.txt or .err");

  stages.push({
    id: "local-backups",
    name: "Local Supabase, Vercel, and Cloudflare inventories",
    status: missing.length ? "missing" : "pass",
    detail: missing.length ? { missing } : { backupDir },
  });
}

function addCanonicalExportsStage() {
  const missing: string[] = [];
  for (const table of TABLE_ORDER) {
    for (const prefix of ["supabase/canonical", "cloudflare/d1-transformed"]) {
      const file = `${prefix}/${table}.ndjson`;
      if (!hasFile(file)) missing.push(file);
    }
  }

  for (const file of [
    "supabase/user_memories-vectors.ndjson",
    "supabase/chat_memory_summaries-vectors.ndjson",
    "supabase/chat_memory_turns-vectors.ndjson",
  ]) {
    if (!hasFile(file)) missing.push(file);
  }

  for (const file of [
    "cloudflare/vectorize-memory.ndjson",
    "cloudflare/vectorize-manifest.json",
  ]) {
    if (!hasNonEmptyFile(file)) missing.push(file);
  }

  stages.push({
    id: "canonical-data",
    name: "Canonical table and vector exports",
    status: missing.length ? "missing" : "pass",
    detail: missing.length ? { missing } : { tables: TABLE_ORDER.length },
  });
}

function addLocalGatesStage() {
  const relativePath = "cloudflare/local-gates-report.json";
  const report = readReport<LocalGatesReport>(relativePath);
  if (!report) {
    stages.push({ id: "local-gates", name: "Local build and test gates", status: "missing", detail: { report: relativePath } });
    return;
  }

  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const freshness = reportFreshness(report, relativePath);
  const failed = (report.results ?? []).filter((result) => result.ok !== true);
  const resultsById = new Map((report.results ?? []).map((result) => [result.id, result]));
  const missingGateIds = LOCAL_GATE_IDS.filter((id) => !resultsById.has(id));
  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const sourceFingerprintOk =
    report.sourceFingerprintStable === true &&
    report.sourceFingerprintBefore?.sha256 === report.sourceFingerprintAfter?.sha256 &&
    report.sourceFingerprintAfter?.sha256 === currentSourceFingerprint.sha256;
  const startupProfilePath = path.join(backupDir, "cloudflare/worker-startup.cpuprofile");
  const actualStartupProfile = fs.existsSync(startupProfilePath) ? fingerprintFile(backupDir, startupProfilePath) : null;
  const startupProfileOk =
    actualStartupProfile !== null &&
    report.startupProfile?.file === "cloudflare/worker-startup.cpuprofile" &&
    report.startupProfile.bytes === actualStartupProfile.bytes &&
    report.startupProfile.sha256 === actualStartupProfile.sha256;
  const ok =
    report.ok === true &&
    backupDirOk &&
    freshness.ok &&
    failed.length === 0 &&
    missingGateIds.length === 0 &&
    sourceFingerprintOk &&
    startupProfileOk;
  stages.push({
    id: "local-gates",
    name: "Local build and test gates",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          gates: LOCAL_GATE_IDS,
          freshness: freshness.detail,
          sourceFingerprint: currentSourceFingerprint.sha256,
        }
      : {
          report: relativePath,
          ok: report.ok,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          failed,
          missingGateIds,
          sourceFingerprintOk,
          startupProfileOk,
          expectedSourceFingerprint: report.sourceFingerprintAfter?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
          resultCount: report.results?.length ?? 0,
        },
  });
}

function addOkReportStage(id: string, name: string, relativePath: string) {
  const report = readReport(relativePath);
  if (!report) {
    stages.push({ id, name, status: "missing", detail: { report: relativePath } });
    return;
  }

  stages.push({
    id,
    name,
    status: report.ok === true ? "pass" : "blocked",
    detail:
      report.ok === true
        ? { report: relativePath }
        : {
            report: relativePath,
            failedChecks: report.failedChecks,
            error: report.error,
            failingChecks: failingChecks(report).slice(0, 12),
          },
  });
}

function addPreflightCheckStage(id: string, name: string, checkName: string) {
  const relativePath = "cloudflare/production-preflight-report.json";
  const report = readReport(relativePath);
  if (!report) {
    stages.push({ id, name, status: "missing", detail: { report: relativePath, check: checkName } });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const check = (report.checks ?? []).find((candidate) => candidate.name === checkName);
  const ok = check?.status === "pass" && freshness.ok && backupDirOk;

  stages.push({
    id,
    name,
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          check: checkName,
          freshness: freshness.detail,
          detail: check.detail,
        }
      : {
          report: relativePath,
          check: checkName,
          checkStatus: check?.status,
          checkDetail: check?.detail,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
        },
  });
}

function addProviderRetirementRunStage() {
  const relativePath = "cloudflare/provider-retirement-run.json";
  const report = readReport<ProviderRetirementRunReport>(relativePath);
  if (!report) {
    stages.push({ id: "provider-retirement-run", name: "Provider hard-delete run", status: "missing", detail: { report: relativePath } });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const evidenceBlockers = providerRetirementRunEvidenceBlockers(report, relativePath);
  const ok = report.ok === true && freshness.ok && backupDirOk && evidenceBlockers.length === 0;

  stages.push({
    id: "provider-retirement-run",
    name: "Provider hard-delete run",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          recordedCommands: report.results?.length ?? 0,
          postDeleteIdentity: report.postDeleteIdentity,
        }
      : {
          report: relativePath,
          ok: report.ok,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          recordedCommands: report.results?.length ?? 0,
          retirementSafety: report.retirementSafety,
          postDeleteIdentity: report.postDeleteIdentity,
          evidenceBlockers,
          failedChecks: report.failedChecks,
          error: report.error,
        },
  });
}

function addCredentialRotationStage() {
  const relativePath = "cloudflare/credential-rotation-report.json";
  const providerRunPath = "cloudflare/provider-retirement-run.json";
  const report = readReport<CredentialRotationReport>(relativePath);
  const providerRun = readReport<ProviderRetirementRunReport>(providerRunPath);
  if (!report) {
    stages.push({ id: "credential-rotation", name: "Credential rotation/revocation", status: "missing", detail: { report: relativePath } });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const evidenceBlockers = credentialRotationEvidenceBlockers(report, relativePath);
  const providerFreshness = providerRun ? reportFreshness(providerRun, providerRunPath) : null;
  const providerBackupDirOk = path.resolve(providerRun?.backupDir ?? "") === path.resolve(backupDir);
  const providerEvidenceBlockers = providerRetirementRunEvidenceBlockers(providerRun, providerRunPath);
  const providerRunOk =
    providerRun?.ok === true &&
    providerFreshness?.ok === true &&
    providerBackupDirOk &&
    providerEvidenceBlockers.length === 0;
  const ok = report.ok === true && freshness.ok && backupDirOk && evidenceBlockers.length === 0 && providerRunOk;

  stages.push({
    id: "credential-rotation",
    name: "Credential rotation/revocation",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          confirmations: report.confirmations.length,
          providerRetirementRun: providerRunPath,
        }
      : {
          report: relativePath,
          ok: report.ok,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          confirmations: report.confirmations?.map((confirmation) => ({
            id: confirmation.id,
            env: confirmation.env,
            confirmed: confirmation.confirmed,
          })),
          forbiddenEnvPresent: report.forbiddenEnvPresent,
          evidenceBlockers,
          providerRetirementRun: {
            report: providerRunPath,
            ok: providerRun?.ok,
            backupDirOk: providerBackupDirOk,
            fresh: providerFreshness?.ok ?? false,
            freshness: providerFreshness?.detail,
            evidenceBlockers: providerEvidenceBlockers,
          },
        },
  });
}

function addFreshOkReportStage(id: string, name: string, relativePath: string) {
  const report = readReport(relativePath);
  if (!report) {
    stages.push({ id, name, status: "missing", detail: { report: relativePath } });
    return;
  }

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  stages.push({
    id,
    name,
    status: report.ok === true && freshness.ok && backupDirOk ? "pass" : "blocked",
    detail:
      report.ok === true && freshness.ok && backupDirOk
        ? { report: relativePath, freshness: freshness.detail }
        : {
            report: relativePath,
            ok: report.ok,
            backupDirOk,
            fresh: freshness.ok,
            freshness: freshness.detail,
            failedChecks: report.failedChecks,
            error: report.error,
            failingChecks: failingChecks(report).slice(0, 12),
          },
  });
}

function addVectorizeImportStage() {
  const relativePath = "cloudflare/vectorize-import-run.json";
  const manifest = readReport<{ rows?: number; sha256?: string }>("cloudflare/vectorize-manifest.json");
  const report = readReport<VectorizeImportReport>(relativePath);
  const preImportBackup = readReport<VectorizePreImportBackupReport>(VECTORIZE_PRE_IMPORT_BACKUP_REPORT);
  const postCutover = currentPostCutoverVectorizeEvidence();
  if (!report) {
    stages.push({ id: "vectorize-import", name: "Vectorize import validation", status: "missing", detail: { report: relativePath } });
    return;
  }

  const currentArtifactFingerprint = buildFingerprintSafely(() => buildVectorizeArtifactFingerprint(backupDir));
  const freshness = reportFreshness(report, relativePath);
  const preImportBackupCheck = checkVectorizePreImportBackup({
    backupDir,
    index: VECTORIZE_INDEX_NAME,
    report: preImportBackup,
    importRunReport: report.preImportBackup,
    maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
  });
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const missingIds = report.missingIds?.length ?? 0;
  const unexpectedIds = report.unexpectedIds?.length ?? 0;
  const manifestRows = manifest?.rows;
  const manifestSha256 = manifest?.sha256;
  const vectorCountExact = report.info?.vectorCount === manifestRows;
  const remoteChecksOk =
    report.remoteVectorChecks?.ok === true &&
    report.remoteVectorChecks.fetchedRows === manifestRows &&
    report.remoteVectorChecks.expectedRows === manifestRows &&
    (report.remoteVectorChecks.problems?.length ?? 0) === 0;
  const ok =
    report.ok === true &&
    report.reset === true &&
    report.artifactSha256 === manifestSha256 &&
    report.artifactSha256 === currentArtifactFingerprint.fingerprint?.artifactSha256 &&
    report.manifestSha256 === manifestSha256 &&
    report.artifactSha256MatchesManifest === true &&
    report.artifactFingerprint?.sha256 === currentArtifactFingerprint.fingerprint?.sha256 &&
    preImportBackupCheck.ok &&
    report.expectedRows === manifestRows &&
    vectorCountExact &&
    remoteChecksOk &&
    missingIds === 0 &&
    unexpectedIds === 0 &&
    backupDirOk &&
    freshness.ok;

  if (!ok && postCutover.ok) {
    stages.push({
      id: "vectorize-import",
      name: "Vectorize import validation",
      status: "pass",
      detail: {
        report: relativePath,
        mode: "post-cutover-production-validation",
        postCutover: postCutover.detail,
      },
    });
    return;
  }

  stages.push({
    id: "vectorize-import",
    name: "Vectorize import validation",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          rows: manifestRows,
          vectorCount: report.info?.vectorCount,
          artifactFingerprint: currentArtifactFingerprint.fingerprint?.sha256,
          preImportBackup: preImportBackupCheck.detail,
          freshness: freshness.detail,
        }
      : {
          report: relativePath,
          ok: report.ok,
          reset: report.reset,
          artifactSha256Ok: report.artifactSha256 === manifestSha256,
          actualArtifactSha256Ok: report.artifactSha256 === currentArtifactFingerprint.fingerprint?.artifactSha256,
          manifestSha256Ok: report.manifestSha256 === manifestSha256,
          artifactSha256MatchesManifest: report.artifactSha256MatchesManifest,
          artifactFingerprintOk: report.artifactFingerprint?.sha256 === currentArtifactFingerprint.fingerprint?.sha256,
          artifactFingerprintError: currentArtifactFingerprint.error,
          preImportBackupOk: preImportBackupCheck.ok,
          preImportBackup: preImportBackupCheck.detail,
          expectedRows: report.expectedRows,
          manifestRows,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          vectorCountExact,
          remoteChecksOk,
          missingIds,
          unexpectedIds,
          vectorCount: report.info?.vectorCount,
          remoteVectorProblems: report.remoteVectorChecks?.problems?.slice(0, 12),
          postCutover: postCutover.detail,
        },
  });
}

function currentPostCutoverVectorizeEvidence() {
  const relativePath = "cloudflare/vectorize-post-cutover-validation-report.json";
  const report = readReport<NonNullable<Parameters<typeof validatePostCutoverVectorizeReport>[0]>>(relativePath);
  if (!report) return { ok: false, detail: { report: relativePath, missing: true } };

  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentArtifactFingerprint = buildFingerprintSafely(() => buildVectorizeArtifactFingerprint(backupDir));
  const validation = validatePostCutoverVectorizeReport(report, {
    expectedArtifactFingerprint: currentArtifactFingerprint.fingerprint,
    artifactFingerprintError: currentArtifactFingerprint.error,
  });

  return {
    ok: validation.ok && freshness.ok && backupDirOk,
    detail: {
      report: relativePath,
      reportOk: report.ok === true,
      backupDirOk,
      fresh: freshness.ok,
      freshness: freshness.detail,
      artifactFingerprintOk: validation.artifactFingerprintOk,
      artifactSha256Ok: validation.artifactSha256Ok,
      manifestSha256Ok: validation.manifestSha256Ok,
      rowCountOk: validation.rowCountOk,
      migratedIdsOk: validation.migratedIdsOk,
      remoteChecksOk: validation.remoteChecksOk,
      extrasAllowed: validation.extrasAllowed,
      expectedRows: validation.expectedRows,
      fetchedRows: validation.fetchedRows,
      missingIds: validation.missingIds,
      unexpectedIds: validation.unexpectedIds,
      artifactFingerprintError: validation.artifactFingerprintError,
      artifactFingerprint: validation.artifactFingerprint,
      expectedArtifactFingerprint: validation.expectedArtifactFingerprint,
    },
  };
}

function addProductionSmokeStage() {
  const relativePath = "cloudflare/production-smoke-report.json";
  const report = readReport(relativePath);
  if (!report) {
    stages.push({ id: "production-smoke", name: "Production smoke", status: "missing", detail: { report: relativePath } });
    return;
  }

  const validation = validateProductionSmokeReport(report);
  stages.push({
    id: "production-smoke",
    name: "Production smoke",
    status: validation.ok ? "pass" : "blocked",
    detail: validation.ok
      ? {
          report: relativePath,
          baseUrl: validation.baseUrl,
          checks: validation.presentChecks.length,
        }
      : {
          report: relativePath,
          ok: report.ok,
          baseUrl: validation.baseUrl,
          baseUrlOk: validation.baseUrlOk,
          failedChecks: validation.failedChecks,
          checksOk: validation.checksOk,
          missingChecks: validation.missingChecks,
          failingRequiredChecks: validation.failingRequiredChecks,
          failingChecks: failingChecks(report).slice(0, 12),
        },
  });
}

function addWorkerDeployStage() {
  const report = readReport(WORKER_DEPLOY_REPORT);
  if (!report) {
    stages.push({ id: "worker-deploy", name: "Worker production deploy evidence", status: "missing", detail: { report: WORKER_DEPLOY_REPORT } });
    return;
  }

  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const freshness = reportFreshness(report, WORKER_DEPLOY_REPORT);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const validation = validateWorkerDeployReport(report, {
    expectedSourceFingerprint: currentSourceFingerprint,
  });
  const ok = validation.ok && freshness.ok && backupDirOk;

  stages.push({
    id: "worker-deploy",
    name: "Worker production deploy evidence",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: WORKER_DEPLOY_REPORT,
          freshness: freshness.detail,
          sourceFingerprint: validation.actualSourceFingerprint,
        }
      : {
          report: WORKER_DEPLOY_REPORT,
          ok: report.ok,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          mode: validation.mode,
          modeOk: validation.modeOk,
          status: validation.status,
          statusOk: validation.statusOk,
          commandExecutedOk: validation.commandExecutedOk,
          deployPreflightOk: validation.deployPreflightOk,
          sourceFingerprintStable: validation.sourceFingerprintStable,
          sourceFingerprintOk: validation.sourceFingerprintOk,
          expectedSourceFingerprint: validation.expectedSourceFingerprint,
          actualSourceFingerprint: validation.actualSourceFingerprint,
          error: report.error,
        },
  });
}

function addPlaywrightStage() {
  const relativePath = "cloudflare/playwright-production-report.json";
  const report = readReport(relativePath);
  if (!report) {
    stages.push({ id: "production-playwright", name: "Production Playwright", status: "missing", detail: { report: relativePath } });
    return;
  }

  const validation = validateProductionPlaywrightReport(report);
  const ok = validation.ok;

  stages.push({
    id: "production-playwright",
    name: "Production Playwright",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          expected: validation.expected,
          requiredTitles: validation.presentTitles,
        }
      : {
          report: relativePath,
          ok: report.ok,
          baseUrl: validation.baseUrl,
          baseUrlOk: validation.baseUrlOk,
          expected: validation.expected,
          skipped: validation.skipped,
          unexpected: validation.unexpected,
          flaky: validation.flaky,
          requiredTitlesOk: validation.requiredTitlesOk,
          missingTitles: validation.missingTitles,
          error: report.error,
          missingEnv: report.missingEnv,
        },
  });
}

function addPreviewPlaywrightStage() {
  const relativePath = "cloudflare/playwright-preview-report.json";
  const report = readReport(relativePath);
  if (!report) {
    stages.push({ id: "preview-playwright", name: "Cloudflare preview Playwright", status: "missing", detail: { report: relativePath } });
    return;
  }

  const currentSourceFingerprint = buildRepoSourceFingerprint();
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const sourceFingerprintOk =
    report.sourceFingerprintStable === true &&
    report.sourceFingerprintBefore?.sha256 === report.sourceFingerprintAfter?.sha256 &&
    report.sourceFingerprintAfter?.sha256 === currentSourceFingerprint.sha256 &&
    report.sourceFingerprintAfter?.fileCount === currentSourceFingerprint.fileCount;
  const stats = report.stats ?? {};
  const expected = Number(stats.expected ?? 0);
  const skipped = Number(stats.skipped ?? 0);
  const unexpected = Number(stats.unexpected ?? 0);
  const flaky = Number(stats.flaky ?? 0);
  const ok =
    report.ok === true &&
    freshness.ok &&
    backupDirOk &&
    sourceFingerprintOk &&
    expected > 0 &&
    unexpected === 0 &&
    flaky === 0;

  stages.push({
    id: "preview-playwright",
    name: "Cloudflare preview Playwright",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          expected,
          skipped,
          freshness: freshness.detail,
          sourceFingerprint: currentSourceFingerprint.sha256,
        }
      : {
          report: relativePath,
          ok: report.ok,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          sourceFingerprintOk,
          expectedSourceFingerprint: report.sourceFingerprintAfter?.sha256,
          actualSourceFingerprint: currentSourceFingerprint.sha256,
          expected,
          skipped,
          unexpected,
          flaky,
          error: report.error,
          missingEnv: report.missingEnv,
        },
  });
}

function addPostCutoverD1Stage() {
  const relativePath = "cloudflare/d1-post-cutover-validation-report.json";
  const report = readReport(relativePath);
  if (!report) {
    stages.push({ id: "post-cutover-d1", name: "Post-cutover D1 validation", status: "missing", detail: { report: relativePath } });
    return;
  }

  const prerequisites = ["dns-cutover", "production-smoke"];
  const missingPrerequisites = prerequisites.filter((id) => stages.find((stage) => stage.id === id)?.status !== "pass");
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentArtifactFingerprint = buildFingerprintSafely(() => buildD1ArtifactFingerprint(backupDir));
  const validation = validatePostCutoverD1Report(report, {
    expectedArtifactFingerprint: currentArtifactFingerprint.fingerprint,
    artifactFingerprintError: currentArtifactFingerprint.error,
  });
  const ok = validation.ok && !missingPrerequisites.length && freshness.ok && backupDirOk;

  stages.push({
    id: "post-cutover-d1",
    name: "Post-cutover D1 validation",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          exactTables: report.exactTableCount,
          mutableTables: report.mutableTableCount,
          artifactFingerprint: validation.artifactFingerprint,
        }
      : {
          report: relativePath,
          ok: report.ok,
          missingPrerequisites,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
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
          failedChecks: report.failedChecks,
          error: report.error,
          failingChecks: failingChecks(report).slice(0, 12),
        },
  });
}

function addPostCutoverVectorizeStage() {
  const relativePath = "cloudflare/vectorize-post-cutover-validation-report.json";
  const report = readReport(relativePath);
  if (!report) {
    stages.push({
      id: "post-cutover-vectorize",
      name: "Post-cutover Vectorize validation",
      status: "missing",
      detail: { report: relativePath },
    });
    return;
  }

  const prerequisites = ["dns-cutover", "production-smoke", "post-cutover-d1"];
  const missingPrerequisites = prerequisites.filter((id) => stages.find((stage) => stage.id === id)?.status !== "pass");
  const freshness = reportFreshness(report, relativePath);
  const backupDirOk = path.resolve(report.backupDir ?? "") === path.resolve(backupDir);
  const currentArtifactFingerprint = buildFingerprintSafely(() => buildVectorizeArtifactFingerprint(backupDir));
  const validation = validatePostCutoverVectorizeReport(report, {
    expectedArtifactFingerprint: currentArtifactFingerprint.fingerprint,
    artifactFingerprintError: currentArtifactFingerprint.error,
  });
  const ok = validation.ok && !missingPrerequisites.length && freshness.ok && backupDirOk;

  stages.push({
    id: "post-cutover-vectorize",
    name: "Post-cutover Vectorize validation",
    status: ok ? "pass" : "blocked",
    detail: ok
      ? {
          report: relativePath,
          freshness: freshness.detail,
          expectedRows: validation.expectedRows,
          fetchedRows: validation.fetchedRows,
          unexpectedIds: validation.unexpectedIds,
          artifactFingerprint: validation.artifactFingerprint,
        }
      : {
          report: relativePath,
          ok: report.ok,
          missingPrerequisites,
          backupDirOk,
          fresh: freshness.ok,
          freshness: freshness.detail,
          artifactFingerprintOk: validation.artifactFingerprintOk,
          artifactSha256Ok: validation.artifactSha256Ok,
          manifestSha256Ok: validation.manifestSha256Ok,
          rowCountOk: validation.rowCountOk,
          migratedIdsOk: validation.migratedIdsOk,
          remoteChecksOk: validation.remoteChecksOk,
          extrasAllowed: validation.extrasAllowed,
          expectedRows: validation.expectedRows,
          fetchedRows: validation.fetchedRows,
          missingIds: validation.missingIds,
          unexpectedIds: validation.unexpectedIds,
          artifactFingerprintError: validation.artifactFingerprintError,
          artifactFingerprint: validation.artifactFingerprint,
          expectedArtifactFingerprint: validation.expectedArtifactFingerprint,
        },
  });
}

function addEnvironmentStage() {
  const apiTokenCredential = readCloudflareApiToken();
  const dnsCutoverVerified = stages.some((stage) => stage.id === "dns-cutover" && stage.status === "pass");
  const postCutoverProductionValidated =
    stages.some((stage) => stage.id === "production-smoke" && stage.status === "pass") &&
    stages.some((stage) => stage.id === "post-cutover-d1" && stage.status === "pass") &&
    stages.some((stage) => stage.id === "post-cutover-vectorize" && stage.status === "pass");
  const present = {
    cloudflareApiToken: Boolean(apiTokenCredential.token) || dnsCutoverVerified,
    requireLiveAi: process.env.REQUIRE_LIVE_AI === "1",
    writeFreeze: process.env.CONFIRM_WRITE_FREEZE === "1" || postCutoverProductionValidated,
    googleE2EEmail: Boolean(process.env.E2E_GOOGLE_EMAIL?.trim()),
    googleE2EPassword: Boolean(process.env.E2E_GOOGLE_PASSWORD?.trim()),
    googleE2EAdmin: process.env.E2E_GOOGLE_IS_ADMIN === "1",
  };
  const missing = Object.entries(present)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  stages.push({
    id: "operator-env",
    name: "Operator environment for live cutover gates",
    status: missing.length ? "blocked" : "pass",
    detail: missing.length
      ? {
          missing,
          cloudflareApiToken: {
            present: Boolean(apiTokenCredential.token),
            waivedByDnsCutover: dnsCutoverVerified,
            credentialSource: cloudflareApiTokenSourceLabel(apiTokenCredential.source),
            error: apiTokenCredential.error,
            instructions: cloudflareApiTokenInstructions(),
          },
        }
      : {
          ...present,
          cloudflareApiTokenWaivedByDnsCutover: dnsCutoverVerified && !apiTokenCredential.token,
          writeFreezeWaivedByPostCutoverValidation: postCutoverProductionValidated && process.env.CONFIRM_WRITE_FREEZE !== "1",
          cloudflareApiTokenSource: cloudflareApiTokenSourceLabel(apiTokenCredential.source),
        },
  });
}

function buildReport() {
  const stageById = Object.fromEntries(stages.map((stage) => [stage.id, stage]));
  const hasPassed = (id: string) => stageById[id]?.status === "pass";
  const readyForDeploy = hasPassed("production-preflight");
  const readyForDnsCutover =
    readyForDeploy &&
    hasPassed("operator-env") &&
    (hasPassed("dns-cutover") || (hasPassed("cloudflare-token-capability") && hasPassed("dns-dry-run")));
  const readyForProviderRetirement = hasPassed("provider-retirement");
  const providersRetired = hasPassed("provider-retirement-run") && hasPassed("credential-rotation");
  const blocked = stages.filter((stage) => stage.status !== "pass");

  return {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: providersRetired,
    readyForDeploy,
    readyForDnsCutover,
    readyForProviderRetirement,
    providersRetired,
    blockedStages: blocked.length,
    stages,
  };
}

function printSummary(report: ReturnType<typeof buildReport>) {
  console.log(`Migration status: ${report.providersRetired ? "complete" : "not ready"}`);
  console.log(`Backup: ${backupDir}`);
  for (const stage of stages) {
    const marker = stage.status === "pass" ? "PASS" : stage.status === "missing" ? "MISSING" : "BLOCKED";
    console.log(`${marker} ${stage.name}`);
  }
  console.log(`Report: ${outputPath}`);
  if (strict && !report.providersRetired) {
    console.error("Strict mode failed because provider retirement has not completed safely.");
  }
}

function readReport<T = JsonReport>(relativePath: string): T | null {
  const absolutePath = path.join(backupDir, relativePath);
  if (!hasNonEmptyFile(relativePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function failingChecks(report: JsonReport) {
  return (report.checks ?? [])
    .filter((check) => check.status === "fail")
    .map((check) => ({ name: check.name, detail: check.detail }));
}

function hasNonEmptyFile(relativePath: string) {
  const absolutePath = path.join(backupDir, relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0;
}

function hasFile(relativePath: string) {
  return fs.existsSync(path.join(backupDir, relativePath));
}

function isRuntimeMutableTable(table: TableName) {
  return (RUNTIME_MUTABLE_TABLES as readonly TableName[]).includes(table);
}

function reportFreshness(report: { createdAt?: string }, relativePath: string) {
  if (!report.createdAt) {
    return { ok: false, detail: { report: relativePath, missing: "createdAt" } };
  }
  const createdAt = Date.parse(report.createdAt);
  if (!Number.isFinite(createdAt)) {
    return { ok: false, detail: { report: relativePath, invalidCreatedAt: report.createdAt } };
  }
  const ageMs = Date.now() - createdAt;
  return {
    ok: ageMs >= 0 && ageMs <= MAX_FINAL_DATA_REPORT_AGE_MS,
    detail: {
      report: relativePath,
      createdAt: report.createdAt,
      maxAgeMs: MAX_FINAL_DATA_REPORT_AGE_MS,
      ageMs,
    },
  };
}

function reportTimestamp(value: string | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildFingerprintSafely<T>(build: () => T): FingerprintResult<T> {
  try {
    return { fingerprint: build(), error: null };
  } catch (error) {
    return {
      fingerprint: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
