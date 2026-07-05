import fs from "node:fs";
import path from "node:path";
import {
  D1_DATABASE_NAME,
  POST_CUTOVER_MUTABLE_TABLES,
  POST_CUTOVER_TRANSIENT_TABLES,
  TABLE_ORDER,
  TIMESTAMP_PRECISION_TABLE,
  type TableName,
} from "./migration-config";
import {
  buildD1ArtifactFingerprint,
  buildVectorizeArtifactFingerprint,
  type MigrationArtifactFingerprint,
  type VectorizeArtifactFingerprint,
} from "./migration-artifact-fingerprint";
import { DNS_CUTOVER_VERIFY_REPORT, DNS_PUBLIC_CUTOVER_REPORT, validateDnsCutoverEvidence } from "./dns-cutover-evidence";
import type { SourceFingerprint } from "./source-fingerprint";
import { WORKER_DEPLOY_REPORT } from "./worker-deploy-evidence";

export const FINAL_PRODUCTION_BASE_URL = "https://inspirlearning.com/";
const SHA256_HEX = /^[a-f0-9]{64}$/;
export const REQUIRED_PRODUCTION_PLAYWRIGHT_TEST_TITLES = [
  "public, localized, SEO, and topic API routes work on Cloudflare preview",
  "guest-only activity modes show the Google gate instead of private tooling",
  "private and admin APIs fail closed for signed-out users",
  "guest chat returns streamed text with sane limit headers or an explicit provider failure",
  "Google sign-in and sign-out work with the dedicated test account",
  "authenticated profile, activity, memory, admin, and private chat APIs work",
] as const;
export const REQUIRED_PRODUCTION_SMOKE_CHECKS = [
  "home status",
  "home body: free ai learning",
  "home body: learn",
  "home Cloudflare edge signal",
  "home not served by Vercel",
  "localized Hindi route status",
  "localized Hindi route language cookie",
  "localized Hindi route not served by Vercel",
  "robots status",
  "robots body: User-Agent",
  "robots not served by Vercel",
  "sitemap index status",
  "sitemap index body: <sitemapindex",
  "sitemap index not served by Vercel",
  "English sitemap status",
  "English sitemap body: <urlset",
  "English sitemap not served by Vercel",
  "RSS status",
  "RSS body: <rss",
  "RSS not served by Vercel",
  "OG image status",
  "OG image content type",
  "OG image not served by Vercel",
  "topics API status",
  "topics API content type",
  "topics API not served by Vercel",
  "topics API payload",
  "live guest chat status",
  "live guest chat not served by Vercel",
  "live guest chat streamed body",
  "live guest chat limit headers",
] as const;

type JsonReport = {
  ok?: boolean;
  createdAt?: string;
  backupDir?: string;
  baseUrl?: string;
  database?: string;
  exactTableCount?: number;
  mutableTableCount?: number;
  failedChecks?: number;
  quickCheck?: Array<{ quick_check?: string }>;
  foreignKeyCheck?: unknown[];
  tables?: Array<{
    table?: string;
    expectedRows?: number;
    actualRows?: number;
    expectedSha256?: string;
    actualSha256?: string | null;
    mutableAfterCutover?: boolean;
    transientAfterCutover?: boolean;
    mutableImportedRows?: {
      checkedRows?: number;
      mismatchedRows?: number;
      missingRows?: number;
      expectedSha256?: string;
      actualSha256?: string;
      expectedPrimaryKeySha256?: string;
      actualImportedPrimaryKeySha256?: string;
      extraRows?: number;
      ok?: boolean;
    };
    ok?: boolean;
  }>;
  transformedSourceHashCheck?: Array<{
    table?: string;
    expectedSha256?: string;
    sourceSha256?: string;
  }>;
  mismatchedSourceHashes?: unknown[];
  timestampPrecision?: {
    table?: string;
    expectedRows?: number;
    actualRows?: number;
    expectedSha256?: string;
    actualSha256?: string;
    ok?: boolean;
  };
  artifactFingerprint?: {
    sha256?: string;
    files?: unknown[];
  };
  artifactSha256?: string;
  manifestSha256?: string;
  artifactSha256MatchesManifest?: boolean;
  expectedRows?: number;
  allowUnexpectedIds?: boolean;
  missingIds?: string[];
  unexpectedIds?: string[];
  remoteVectorChecks?: {
    ok?: boolean;
    fetchedRows?: number;
    expectedRows?: number;
    problems?: unknown[];
    skipped?: boolean;
  };
  checks?: Array<{
    name?: string;
    status?: string;
    detail?: unknown;
  }>;
  stats?: {
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
  } | null;
  playwright?: unknown;
  mode?: string;
  status?: number | null;
  commandExecuted?: boolean;
  deployPreflightOk?: boolean;
  deployPreflightStatus?: number | null;
  sourceFingerprintBefore?: SourceFingerprint;
  sourceFingerprintAfter?: SourceFingerprint;
  sourceFingerprintStable?: boolean;
};

export type ProductionPlaywrightValidation = {
  ok: boolean;
  baseUrlOk: boolean;
  statsOk: boolean;
  requiredTitlesOk: boolean;
  baseUrl: string;
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
  presentTitles: string[];
  missingTitles: string[];
};

export type ProductionSmokeValidation = {
  ok: boolean;
  baseUrlOk: boolean;
  checksOk: boolean;
  baseUrl: string;
  failedChecks: number;
  presentChecks: string[];
  missingChecks: string[];
  failingRequiredChecks: string[];
};

export type WorkerDeployValidation = {
  ok: boolean;
  modeOk: boolean;
  statusOk: boolean;
  commandExecutedOk: boolean;
  deployPreflightOk: boolean;
  sourceFingerprintStable: boolean;
  sourceFingerprintOk: boolean;
  mode: string;
  status: number | null;
  expectedSourceFingerprint: string | null;
  actualSourceFingerprint: string;
};

export type PostCutoverD1Validation = {
  ok: boolean;
  databaseOk: boolean;
  integrityOk: boolean;
  tableCoverageOk: boolean;
  exactTablesOk: boolean;
  mutableTablesOk: boolean;
  sourceHashesOk: boolean;
  timestampPrecisionOk: boolean;
  artifactFingerprintOk: boolean;
  database: string;
  artifactFingerprint: string;
  expectedArtifactFingerprint: string | null;
  artifactFingerprintError: string | null;
  expectedTables: number;
  actualTables: number;
  missingTables: string[];
  unexpectedTables: string[];
  badExactTables: string[];
  badMutableTables: string[];
  mismatchedSourceHashes: number;
  timestampPrecision?: JsonReport["timestampPrecision"];
};

export type PostCutoverD1ValidationOptions = {
  expectedArtifactFingerprint?: Pick<MigrationArtifactFingerprint, "sha256"> | null;
  artifactFingerprintError?: string | null;
};

export type PostCutoverVectorizeValidation = {
  ok: boolean;
  artifactFingerprintOk: boolean;
  artifactSha256Ok: boolean;
  manifestSha256Ok: boolean;
  rowCountOk: boolean;
  migratedIdsOk: boolean;
  remoteChecksOk: boolean;
  extrasAllowed: boolean;
  expectedRows: number | null;
  fetchedRows: number | null;
  missingIds: number;
  unexpectedIds: number;
  artifactFingerprint: string;
  expectedArtifactFingerprint: string | null;
  artifactFingerprintError: string | null;
};

export type PostCutoverVectorizeValidationOptions = {
  expectedArtifactFingerprint?: VectorizeArtifactFingerprint | null;
  artifactFingerprintError?: string | null;
};

type EvidenceReport = {
  id: string;
  relativePath: string;
  report: JsonReport | null;
  createdAtMs: number | null;
};

export type FinalCutoverEvidenceChainOptions = {
  maxAgeMs: number;
  nowMs?: number;
  requireProviderPreflight?: boolean;
  expectedSourceFingerprint?: Pick<SourceFingerprint, "sha256" | "fileCount"> | null;
  expectedD1ArtifactFingerprint?: Pick<MigrationArtifactFingerprint, "sha256"> | null;
  d1ArtifactFingerprintError?: string | null;
};

export type ArtifactFingerprintResult = {
  fingerprint: MigrationArtifactFingerprint | null;
  error: string | null;
};

export function checkFinalCutoverEvidenceChain(backupDir: string, options: FinalCutoverEvidenceChainOptions) {
  const blockers: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  const dnsEvidence = validateDnsCutoverEvidence(backupDir, { maxAgeMs: options.maxAgeMs, nowMs });
  const dnsCutoverReport = dnsEvidence.mode === "manual-public-dns" ? DNS_PUBLIC_CUTOVER_REPORT : DNS_CUTOVER_VERIFY_REPORT;
  const reports = [
    reportSpec("production-preflight", "cloudflare/production-preflight-report.json"),
    reportSpec("dns-cutover", dnsCutoverReport),
    reportSpec("worker-deploy", WORKER_DEPLOY_REPORT),
    reportSpec("production-smoke", "cloudflare/production-smoke-report.json"),
    reportSpec("production-playwright", "cloudflare/playwright-production-report.json"),
    reportSpec("post-cutover-d1", "cloudflare/d1-post-cutover-validation-report.json"),
    reportSpec("post-cutover-vectorize", "cloudflare/vectorize-post-cutover-validation-report.json"),
    ...(options.requireProviderPreflight
      ? [reportSpec("provider-retirement-preflight", "cloudflare/provider-retirement-preflight-report.json")]
      : []),
  ].map((spec) => readEvidenceReport(backupDir, spec.id, spec.relativePath));

  for (const evidence of reports) {
    validateReport(backupDir, evidence, nowMs, options.maxAgeMs, blockers);
  }

  blockers.push(...dnsEvidence.blockers);

  const workerDeploy = reports.find((report) => report.id === "worker-deploy")?.report;
  const workerDeployValidation = validateWorkerDeployReport(workerDeploy, {
    expectedSourceFingerprint: options.expectedSourceFingerprint,
  });
  if (!workerDeployValidation.ok) {
    blockers.push(
      [
        `${WORKER_DEPLOY_REPORT} must prove the OpenNext Worker was deployed from the verified source`,
        `modeOk=${workerDeployValidation.modeOk}`,
        `statusOk=${workerDeployValidation.statusOk}`,
        `commandExecutedOk=${workerDeployValidation.commandExecutedOk}`,
        `deployPreflightOk=${workerDeployValidation.deployPreflightOk}`,
        `sourceFingerprintStable=${workerDeployValidation.sourceFingerprintStable}`,
        `sourceFingerprintOk=${workerDeployValidation.sourceFingerprintOk}`,
        workerDeployValidation.expectedSourceFingerprint
          ? `expectedSourceFingerprint=${workerDeployValidation.expectedSourceFingerprint}`
          : null,
        workerDeployValidation.actualSourceFingerprint
          ? `actualSourceFingerprint=${workerDeployValidation.actualSourceFingerprint}`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  const smoke = reports.find((report) => report.id === "production-smoke")?.report;
  const smokeValidation = validateProductionSmokeReport(smoke);
  if (!smokeValidation.baseUrlOk) {
    blockers.push(
      `cloudflare/production-smoke-report.json must target ${FINAL_PRODUCTION_BASE_URL}; got ${smoke?.baseUrl ?? "missing"}`,
    );
  }
  if (!smokeValidation.checksOk) {
    blockers.push(
      [
        "cloudflare/production-smoke-report.json is missing or failing required smoke checks",
        `missing=${smokeValidation.missingChecks.join(", ") || "none"}`,
        `failing=${smokeValidation.failingRequiredChecks.join(", ") || "none"}`,
      ].join("; "),
    );
  }

  const playwright = reports.find((report) => report.id === "production-playwright")?.report;
  const playwrightValidation = validateProductionPlaywrightReport(playwright);
  if (!playwrightValidation.baseUrlOk) {
    blockers.push(
      `cloudflare/playwright-production-report.json must target ${FINAL_PRODUCTION_BASE_URL}; got ${playwright?.baseUrl ?? "missing"}`,
    );
  }
  if (!playwrightValidation.statsOk) {
    blockers.push(
      `cloudflare/playwright-production-report.json must have expected>0 and skipped/unexpected/flaky all 0; got expected=${playwrightValidation.expected}, skipped=${playwrightValidation.skipped}, unexpected=${playwrightValidation.unexpected}, flaky=${playwrightValidation.flaky}`,
    );
  }
  if (!playwrightValidation.requiredTitlesOk) {
    blockers.push(
      `cloudflare/playwright-production-report.json is missing required E2E tests: ${playwrightValidation.missingTitles.join(", ")}`,
    );
  }

  const postCutoverD1 = reports.find((report) => report.id === "post-cutover-d1")?.report;
  const postCutoverD1Validation = validatePostCutoverD1Report(postCutoverD1, {
    expectedArtifactFingerprint: options.expectedD1ArtifactFingerprint,
    artifactFingerprintError: options.d1ArtifactFingerprintError,
  });
  if (!postCutoverD1Validation.ok) {
    blockers.push(
      [
        "cloudflare/d1-post-cutover-validation-report.json must prove D1 integrity, table parity, source hash parity, timestamp precision parity, and artifact fingerprint parity",
        `databaseOk=${postCutoverD1Validation.databaseOk}`,
        `integrityOk=${postCutoverD1Validation.integrityOk}`,
        `tableCoverageOk=${postCutoverD1Validation.tableCoverageOk}`,
        `exactTablesOk=${postCutoverD1Validation.exactTablesOk}`,
        `mutableTablesOk=${postCutoverD1Validation.mutableTablesOk}`,
        `sourceHashesOk=${postCutoverD1Validation.sourceHashesOk}`,
        `timestampPrecisionOk=${postCutoverD1Validation.timestampPrecisionOk}`,
        `artifactFingerprintOk=${postCutoverD1Validation.artifactFingerprintOk}`,
        postCutoverD1Validation.artifactFingerprintError
          ? `artifactFingerprintError=${postCutoverD1Validation.artifactFingerprintError}`
          : null,
        postCutoverD1Validation.expectedArtifactFingerprint
          ? `expectedArtifactFingerprint=${postCutoverD1Validation.expectedArtifactFingerprint}`
          : null,
      ].join("; "),
    );
  }

  const currentVectorizeArtifactFingerprint = buildVectorizeArtifactFingerprintSafely(backupDir);
  const postCutoverVectorize = reports.find((report) => report.id === "post-cutover-vectorize")?.report;
  const postCutoverVectorizeValidation = validatePostCutoverVectorizeReport(postCutoverVectorize, {
    expectedArtifactFingerprint: currentVectorizeArtifactFingerprint.fingerprint,
    artifactFingerprintError: currentVectorizeArtifactFingerprint.error,
  });
  if (!postCutoverVectorizeValidation.ok) {
    blockers.push(
      [
        "cloudflare/vectorize-post-cutover-validation-report.json must prove migrated Vectorize rows are still present and exact after cutover",
        `artifactFingerprintOk=${postCutoverVectorizeValidation.artifactFingerprintOk}`,
        `artifactSha256Ok=${postCutoverVectorizeValidation.artifactSha256Ok}`,
        `manifestSha256Ok=${postCutoverVectorizeValidation.manifestSha256Ok}`,
        `rowCountOk=${postCutoverVectorizeValidation.rowCountOk}`,
        `migratedIdsOk=${postCutoverVectorizeValidation.migratedIdsOk}`,
        `remoteChecksOk=${postCutoverVectorizeValidation.remoteChecksOk}`,
        postCutoverVectorizeValidation.artifactFingerprintError
          ? `artifactFingerprintError=${postCutoverVectorizeValidation.artifactFingerprintError}`
          : null,
      ].join("; "),
    );
  }

  const evidenceOrder =
    dnsEvidence.mode === "manual-public-dns"
      ? [
          "production-preflight",
          "worker-deploy",
          "dns-cutover",
          "production-smoke",
          "production-playwright",
          "post-cutover-d1",
          "post-cutover-vectorize",
          ...(options.requireProviderPreflight ? ["provider-retirement-preflight"] : []),
        ]
      : [
          "production-preflight",
          "dns-cutover",
          "worker-deploy",
          "production-smoke",
          "production-playwright",
          "post-cutover-d1",
          "post-cutover-vectorize",
          ...(options.requireProviderPreflight ? ["provider-retirement-preflight"] : []),
        ];

  requireOrdering(reports, evidenceOrder, blockers);

  return {
    ok: blockers.length === 0,
    blockers,
    reports: reports.map((report) => ({
      id: report.id,
      relativePath: report.relativePath,
      createdAt: report.report?.createdAt ?? null,
      ok: report.report?.ok ?? null,
      backupDir: report.report?.backupDir ?? null,
      baseUrl: report.report?.baseUrl ?? null,
    })),
  };
}

export function buildD1ArtifactFingerprintSafely(backupDir: string): ArtifactFingerprintResult {
  try {
    return { fingerprint: buildD1ArtifactFingerprint(backupDir), error: null };
  } catch (error) {
    return {
      fingerprint: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildVectorizeArtifactFingerprintSafely(backupDir: string) {
  try {
    return { fingerprint: buildVectorizeArtifactFingerprint(backupDir), error: null };
  } catch (error) {
    return {
      fingerprint: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizeBaseUrl(url: string) {
  if (!url) return "";
  return url.endsWith("/") ? url : `${url}/`;
}

export function validateProductionPlaywrightReport(
  report: JsonReport | null | undefined,
): ProductionPlaywrightValidation {
  const stats = report?.stats;
  const expected = Number(stats?.expected ?? 0);
  const skipped = Number(stats?.skipped ?? 0);
  const unexpected = Number(stats?.unexpected ?? 0);
  const flaky = Number(stats?.flaky ?? 0);
  const presentTitles = collectPlaywrightSpecTitles(report?.playwright);
  const presentTitleSet = new Set(presentTitles);
  const missingTitles = REQUIRED_PRODUCTION_PLAYWRIGHT_TEST_TITLES.filter((title) => !presentTitleSet.has(title));
  const baseUrl = normalizeBaseUrl(report?.baseUrl ?? "");
  const baseUrlOk = baseUrl === FINAL_PRODUCTION_BASE_URL;
  const statsOk = expected > 0 && skipped === 0 && unexpected === 0 && flaky === 0;
  const requiredTitlesOk = missingTitles.length === 0;
  return {
    ok: report?.ok === true && baseUrlOk && statsOk && requiredTitlesOk,
    baseUrlOk,
    statsOk,
    requiredTitlesOk,
    baseUrl,
    expected,
    skipped,
    unexpected,
    flaky,
    presentTitles,
    missingTitles,
  };
}

export function validateProductionSmokeReport(report: JsonReport | null | undefined): ProductionSmokeValidation {
  const baseUrl = normalizeBaseUrl(report?.baseUrl ?? "");
  const baseUrlOk = baseUrl === FINAL_PRODUCTION_BASE_URL;
  const passedChecks = new Set(
    (report?.checks ?? [])
      .filter((check) => check.status === "pass" && typeof check.name === "string")
      .map((check) => check.name as string),
  );
  const failingChecks = new Set(
    (report?.checks ?? [])
      .filter((check) => check.status === "fail" && typeof check.name === "string")
      .map((check) => check.name as string),
  );
  const missingChecks = REQUIRED_PRODUCTION_SMOKE_CHECKS.filter((name) => !passedChecks.has(name));
  const failingRequiredChecks = REQUIRED_PRODUCTION_SMOKE_CHECKS.filter((name) => failingChecks.has(name));
  const failedChecks = Number(report?.failedChecks ?? failingChecks.size);
  const checksOk = missingChecks.length === 0 && failingRequiredChecks.length === 0 && failedChecks === 0;
  return {
    ok: report?.ok === true && baseUrlOk && checksOk,
    baseUrlOk,
    checksOk,
    baseUrl,
    failedChecks,
    presentChecks: [...passedChecks].sort(),
    missingChecks,
    failingRequiredChecks,
  };
}

export function validateWorkerDeployReport(
  report: JsonReport | null | undefined,
  options: { expectedSourceFingerprint?: Pick<SourceFingerprint, "sha256" | "fileCount"> | null } = {},
): WorkerDeployValidation {
  const mode = report?.mode ?? "";
  const status = typeof report?.status === "number" || report?.status === null ? report.status : null;
  const modeOk = mode === "opennext-deploy";
  const statusOk = status === 0;
  const commandExecutedOk = report?.commandExecuted === true;
  const deployPreflightOk = report?.deployPreflightOk === true && report.deployPreflightStatus === 0;
  const sourceFingerprintStable =
    report?.sourceFingerprintStable === true &&
    Boolean(report.sourceFingerprintBefore?.sha256) &&
    report.sourceFingerprintBefore?.sha256 === report.sourceFingerprintAfter?.sha256 &&
    report.sourceFingerprintBefore?.fileCount === report.sourceFingerprintAfter?.fileCount;
  const actualSourceFingerprint = report?.sourceFingerprintAfter?.sha256 ?? "";
  const expectedSourceFingerprint = options.expectedSourceFingerprint?.sha256 ?? null;
  const sourceFingerprintOk =
    sourceFingerprintStable &&
    SHA256_HEX.test(actualSourceFingerprint) &&
    (!options.expectedSourceFingerprint ||
      (actualSourceFingerprint === options.expectedSourceFingerprint.sha256 &&
        report?.sourceFingerprintAfter?.fileCount === options.expectedSourceFingerprint.fileCount));

  return {
    ok:
      report?.ok === true &&
      modeOk &&
      statusOk &&
      commandExecutedOk &&
      deployPreflightOk &&
      sourceFingerprintStable &&
      sourceFingerprintOk,
    modeOk,
    statusOk,
    commandExecutedOk,
    deployPreflightOk,
    sourceFingerprintStable,
    sourceFingerprintOk,
    mode,
    status,
    expectedSourceFingerprint,
    actualSourceFingerprint,
  };
}

export function validatePostCutoverD1Report(
  report: JsonReport | null | undefined,
  options: PostCutoverD1ValidationOptions = {},
): PostCutoverD1Validation {
  const expectedMutableTables = new Set<TableName>(POST_CUTOVER_MUTABLE_TABLES);
  const expectedTransientTables = new Set<TableName>(POST_CUTOVER_TRANSIENT_TABLES);
  const tableReports = report?.tables ?? [];
  const byTable = new Map(tableReports.map((table) => [table.table, table]));
  const missingTables = TABLE_ORDER.filter((table) => !byTable.has(table));
  const unexpectedTables = tableReports
    .map((table) => table.table)
    .filter((table): table is string => typeof table === "string" && !(TABLE_ORDER as readonly string[]).includes(table));
  const badExactTables = TABLE_ORDER.filter((table) => {
    if (expectedMutableTables.has(table)) return false;
    const tableReport = byTable.get(table);
    return (
      tableReport?.ok !== true ||
      tableReport.mutableAfterCutover !== false ||
      tableReport.expectedRows !== tableReport.actualRows ||
      !tableReport.expectedSha256 ||
      tableReport.expectedSha256 !== tableReport.actualSha256
    );
  });
  const badMutableTables = [...expectedMutableTables].filter((table) => {
    const tableReport = byTable.get(table);
    if (expectedTransientTables.has(table)) {
      return (
        tableReport?.ok !== true ||
        tableReport.mutableAfterCutover !== true ||
        tableReport.transientAfterCutover !== true ||
        typeof tableReport.expectedRows !== "number" ||
        typeof tableReport.actualRows !== "number"
      );
    }

    return (
      tableReport?.ok !== true ||
      tableReport.mutableAfterCutover !== true ||
      typeof tableReport.expectedRows !== "number" ||
      typeof tableReport.actualRows !== "number" ||
      tableReport.actualRows < tableReport.expectedRows ||
      tableReport.mutableImportedRows?.ok !== true ||
      tableReport.mutableImportedRows.checkedRows !== tableReport.expectedRows ||
      tableReport.mutableImportedRows.missingRows !== 0 ||
      !tableReport.mutableImportedRows.expectedSha256 ||
      !tableReport.mutableImportedRows.actualSha256 ||
      !tableReport.mutableImportedRows.expectedPrimaryKeySha256 ||
      tableReport.mutableImportedRows.expectedPrimaryKeySha256 !== tableReport.mutableImportedRows.expectedSha256 ||
      tableReport.mutableImportedRows.actualImportedPrimaryKeySha256 !== tableReport.mutableImportedRows.actualSha256 ||
      tableReport.mutableImportedRows.expectedPrimaryKeySha256 !== tableReport.mutableImportedRows.actualImportedPrimaryKeySha256
    );
  });
  const database = report?.database ?? "";
  const databaseOk = database === D1_DATABASE_NAME;
  const integrityOk = report?.quickCheck?.[0]?.quick_check === "ok" && (report?.foreignKeyCheck?.length ?? -1) === 0;
  const tableCoverageOk =
    tableReports.length === TABLE_ORDER.length &&
    missingTables.length === 0 &&
    unexpectedTables.length === 0 &&
    report?.exactTableCount === TABLE_ORDER.length - expectedMutableTables.size &&
    report?.mutableTableCount === expectedMutableTables.size;
  const exactTablesOk = badExactTables.length === 0;
  const mutableTablesOk = badMutableTables.length === 0;
  const sourceHashes = report?.transformedSourceHashCheck ?? [];
  const sourceHashesOk =
    sourceHashes.length === TABLE_ORDER.length &&
    (report?.mismatchedSourceHashes?.length ?? -1) === 0 &&
    sourceHashes.every(
      (entry) =>
        typeof entry.table === "string" &&
        (TABLE_ORDER as readonly string[]).includes(entry.table) &&
        Boolean(entry.expectedSha256) &&
        entry.expectedSha256 === entry.sourceSha256,
    );
  const timestampPrecision = report?.timestampPrecision;
  const timestampPrecisionOk =
    timestampPrecision?.table === TIMESTAMP_PRECISION_TABLE &&
    timestampPrecision.ok === true &&
    timestampPrecision.expectedRows === timestampPrecision.actualRows &&
    Boolean(timestampPrecision.expectedSha256) &&
    timestampPrecision.expectedSha256 === timestampPrecision.actualSha256;
  const artifactFingerprint = report?.artifactFingerprint?.sha256 ?? "";
  const expectedArtifactFingerprint = options.expectedArtifactFingerprint?.sha256 ?? null;
  const artifactFingerprintOk =
    SHA256_HEX.test(artifactFingerprint) &&
    !options.artifactFingerprintError &&
    (expectedArtifactFingerprint ? artifactFingerprint === expectedArtifactFingerprint : true);

  return {
    ok:
      report?.ok === true &&
      databaseOk &&
      integrityOk &&
      tableCoverageOk &&
      exactTablesOk &&
      mutableTablesOk &&
      sourceHashesOk &&
      timestampPrecisionOk &&
      artifactFingerprintOk,
    databaseOk,
    integrityOk,
    tableCoverageOk,
    exactTablesOk,
    mutableTablesOk,
    sourceHashesOk,
    timestampPrecisionOk,
    artifactFingerprintOk,
    database,
    artifactFingerprint,
    expectedArtifactFingerprint,
    artifactFingerprintError: options.artifactFingerprintError ?? null,
    expectedTables: TABLE_ORDER.length,
    actualTables: tableReports.length,
    missingTables,
    unexpectedTables,
    badExactTables,
    badMutableTables,
    mismatchedSourceHashes: report?.mismatchedSourceHashes?.length ?? 0,
    timestampPrecision,
  };
}

export function validatePostCutoverVectorizeReport(
  report: JsonReport | null | undefined,
  options: PostCutoverVectorizeValidationOptions = {},
): PostCutoverVectorizeValidation {
  const artifactFingerprint = report?.artifactFingerprint?.sha256 ?? "";
  const expectedArtifactFingerprint = options.expectedArtifactFingerprint?.sha256 ?? null;
  const expectedRows = typeof report?.expectedRows === "number" ? report.expectedRows : null;
  const remoteExpectedRows =
    typeof report?.remoteVectorChecks?.expectedRows === "number" ? report.remoteVectorChecks.expectedRows : null;
  const fetchedRows = typeof report?.remoteVectorChecks?.fetchedRows === "number" ? report.remoteVectorChecks.fetchedRows : null;
  const missingIds = report?.missingIds?.length ?? 0;
  const unexpectedIds = report?.unexpectedIds?.length ?? 0;
  const artifactFingerprintOk =
    SHA256_HEX.test(artifactFingerprint) &&
    !options.artifactFingerprintError &&
    (expectedArtifactFingerprint ? artifactFingerprint === expectedArtifactFingerprint : true);
  const artifactSha256Ok =
    Boolean(report?.artifactSha256) &&
    report?.artifactSha256 === report?.manifestSha256 &&
    report?.artifactSha256 === options.expectedArtifactFingerprint?.artifactSha256;
  const manifestSha256Ok = report?.artifactSha256MatchesManifest === true;
  const rowCountOk =
    expectedRows !== null &&
    remoteExpectedRows === expectedRows &&
    fetchedRows === expectedRows;
  const migratedIdsOk = missingIds === 0;
  const remoteChecksOk =
    report?.remoteVectorChecks?.ok === true &&
    (report.remoteVectorChecks.problems?.length ?? 0) === 0 &&
    report.remoteVectorChecks.skipped !== true;
  const extrasAllowed = report?.allowUnexpectedIds === true;

  return {
    ok:
      report?.ok === true &&
      artifactFingerprintOk &&
      artifactSha256Ok &&
      manifestSha256Ok &&
      rowCountOk &&
      migratedIdsOk &&
      remoteChecksOk &&
      extrasAllowed,
    artifactFingerprintOk,
    artifactSha256Ok,
    manifestSha256Ok,
    rowCountOk,
    migratedIdsOk,
    remoteChecksOk,
    extrasAllowed,
    expectedRows,
    fetchedRows,
    missingIds,
    unexpectedIds,
    artifactFingerprint,
    expectedArtifactFingerprint,
    artifactFingerprintError: options.artifactFingerprintError ?? null,
  };
}

function reportSpec(id: string, relativePath: string) {
  return { id, relativePath };
}

function readEvidenceReport(backupDir: string, id: string, relativePath: string): EvidenceReport {
  const absolutePath = path.join(backupDir, relativePath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) {
    return { id, relativePath, report: null, createdAtMs: null };
  }
  try {
    const report = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as JsonReport;
    const createdAtMs = report.createdAt ? Date.parse(report.createdAt) : null;
    return { id, relativePath, report, createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null };
  } catch {
    return { id, relativePath, report: null, createdAtMs: null };
  }
}

function validateReport(
  backupDir: string,
  evidence: EvidenceReport,
  nowMs: number,
  maxAgeMs: number,
  blockers: string[],
) {
  if (!evidence.report) {
    blockers.push(`${evidence.relativePath} is missing or unreadable`);
    return;
  }
  if (evidence.report.ok !== true) blockers.push(`${evidence.relativePath} is not clean`);
  if (!evidence.report.backupDir || path.resolve(evidence.report.backupDir) !== path.resolve(backupDir)) {
    blockers.push(`${evidence.relativePath} was generated for a different backup directory`);
  }
  if (!evidence.report.createdAt || evidence.createdAtMs === null) {
    blockers.push(`${evidence.relativePath} has an invalid createdAt timestamp`);
    return;
  }
  if (nowMs - evidence.createdAtMs > maxAgeMs) blockers.push(`${evidence.relativePath} is older than one hour`);
}

function requireOrdering(reports: EvidenceReport[], order: string[], blockers: string[]) {
  const byId = new Map(reports.map((report) => [report.id, report]));
  for (let index = 1; index < order.length; index += 1) {
    const previous = byId.get(order[index - 1]);
    const current = byId.get(order[index]);
    if (!previous?.createdAtMs || !current?.createdAtMs) continue;
    if (current.createdAtMs < previous.createdAtMs) {
      blockers.push(`${current.relativePath} must be generated after ${previous.relativePath}`);
    }
  }
}

function collectPlaywrightSpecTitles(playwright: unknown) {
  const titles = new Set<string>();
  collectTitles(playwright, titles);
  return [...titles].sort();
}

function collectTitles(value: unknown, titles: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectTitles(item, titles);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if (typeof record.title === "string" && Array.isArray(record.tests)) titles.add(record.title);
  collectTitles(record.suites, titles);
  collectTitles(record.specs, titles);
}
