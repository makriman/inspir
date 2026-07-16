import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

export const PREVIEW_E2E_EVIDENCE_KIND = "inspir-live-preview-e2e-v1" as const;
export const PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const PREVIEW_E2E_EVIDENCE_RELATIVE_PATH =
  "cloudflare/playwright-preview-report.json" as const;
export const PREVIEW_E2E_LOCAL_GATE_ID = "cloudflare-preview-live-e2e" as const;
export const PREVIEW_E2E_CHECK_NAME =
  "source-bound live Cloudflare preview E2E" as const;
export const PREVIEW_E2E_EVIDENCE_MAX_AGE_MS = 60 * 60 * 1_000;

export const PREVIEW_E2E_REQUIRED_TEST_TITLES = [
  "configured native session preserves account, saved chat, memory, topics, and admin contracts",
  "authenticated tutor uses saved memory and recalls an earlier chat without changing consent",
  "configured native quiz reaches a complete, answer-revealing result",
  "configured native flashcards reveal every card and reach the complete result",
  "guest chat passes through a valid OpenAI stream with server quota headers",
] as const;

export const PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES = [
  "production traffic reaches the exact lean Worker version",
  "production validation reads preserved account data without mutating the learner",
] as const;

type SourceIdentity = Readonly<Pick<SourceFingerprint, "sha256" | "fileCount">>;

type PreviewTestOutcome = Readonly<{
  title: string;
  specOk: boolean;
  projectName: string;
  expectedStatus: string;
  status: string;
  resultStatuses: readonly string[];
}>;

export type PreviewE2EPlaywrightAnalysis = Readonly<{
  ok: boolean;
  blockers: readonly string[];
  totalTests: number;
  requiredPassedTitles: readonly string[];
  skippedTitles: readonly string[];
}>;

export type PreviewE2EEvidenceValidation = Readonly<{
  createdAt: string;
  sourceFingerprint: SourceIdentity;
  totalTests: number;
  requiredPassedTitles: readonly string[];
  skippedTitles: readonly string[];
}>;

export type PreviewE2EEvidenceHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  validation: PreviewE2EEvidenceValidation;
}>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REPORT_BYTES = 64 * 1_024 * 1_024;

export function analyzePreviewE2EPlaywrightReport(
  value: unknown,
): PreviewE2EPlaywrightAnalysis {
  const blockers: string[] = [];
  const root = optionalRecord(value);
  if (!root) {
    return failedPlaywrightAnalysis("Playwright JSON report must be an object.");
  }

  const config = optionalRecord(root.config);
  const projects = Array.isArray(config?.projects) ? config.projects : [];
  const projectRecords = projects.flatMap((project) => {
    const record = optionalRecord(project);
    return record ? [record] : [];
  });
  if (
    projects.length !== 1 ||
    projectRecords.length !== 1 ||
    projectRecords[0]?.name !== "chromium" ||
    projectRecords[0]?.retries !== 0 ||
    projectRecords[0]?.repeatEach !== 1
  ) {
    blockers.push("Playwright evidence must use exactly one non-retrying chromium project.");
  }

  if (!Array.isArray(root.errors) || root.errors.length !== 0) {
    blockers.push("Playwright evidence contains top-level errors.");
  }

  const suites = Array.isArray(root.suites) ? root.suites : [];
  if (suites.length === 0) {
    blockers.push("Playwright evidence contains no suites.");
  }
  const outcomes: PreviewTestOutcome[] = [];
  for (const suite of suites) collectSuiteOutcomes(suite, outcomes, blockers);

  const titleCounts = new Map<string, number>();
  for (const outcome of outcomes) {
    titleCounts.set(outcome.title, (titleCounts.get(outcome.title) ?? 0) + 1);
  }
  const duplicateTitles = [...titleCounts.entries()]
    .filter(([, count]) => count !== 1)
    .map(([title]) => title)
    .sort();
  if (duplicateTitles.length > 0) {
    blockers.push(`Playwright evidence contains duplicate test titles: ${duplicateTitles.join(", ")}.`);
  }

  const skippedTitles = outcomes
    .filter((outcome) => isSkippedOutcome(outcome))
    .map((outcome) => outcome.title)
    .sort();
  if (!sameStringSequence(skippedTitles, PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES)) {
    blockers.push(
      `Playwright evidence has the wrong exact skipped-test set: ${skippedTitles.join(", ") || "none"}.`,
    );
  }

  const allowedSkippedTitles = new Set<string>(
    PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES,
  );
  for (const outcome of outcomes) {
    if (allowedSkippedTitles.has(outcome.title)) {
      if (
        outcome.status !== "skipped" ||
        outcome.expectedStatus !== "skipped" ||
        outcome.resultStatuses.length !== 1 ||
        outcome.resultStatuses[0] !== "skipped"
      ) {
        blockers.push(`Production-only test did not have canonical skipped evidence: ${outcome.title}.`);
      }
      continue;
    }
    if (
      !outcome.specOk ||
      outcome.projectName !== "chromium" ||
      outcome.expectedStatus !== "passed" ||
      outcome.status !== "expected" ||
      outcome.resultStatuses.length !== 1 ||
      outcome.resultStatuses[0] !== "passed"
    ) {
      blockers.push(`Preview test did not pass exactly once without retry: ${outcome.title}.`);
    }
  }

  const requiredPassedTitles: string[] = [];
  for (const title of PREVIEW_E2E_REQUIRED_TEST_TITLES) {
    const matches = outcomes.filter((outcome) => outcome.title === title);
    if (matches.length !== 1 || isSkippedOutcome(matches[0])) {
      blockers.push(`Required live preview test is missing, duplicated, or skipped: ${title}.`);
      continue;
    }
    if (isCanonicalPassingOutcome(matches[0])) requiredPassedTitles.push(title);
  }

  const stats = optionalRecord(root.stats);
  const expectedCount = outcomes.filter((outcome) => outcome.status === "expected").length;
  if (
    !stats ||
    stats.expected !== expectedCount ||
    stats.unexpected !== 0 ||
    stats.flaky !== 0 ||
    stats.skipped !== PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES.length ||
    expectedCount + PREVIEW_E2E_ALLOWED_SKIPPED_TEST_TITLES.length !== outcomes.length
  ) {
    blockers.push("Playwright aggregate stats do not match the exact per-test outcomes.");
  }

  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(blockers),
    totalTests: outcomes.length,
    requiredPassedTitles: Object.freeze(requiredPassedTitles),
    skippedTitles: Object.freeze(skippedTitles),
  });
}

export function validatePreviewE2EEvidence(input: {
  value: unknown;
  backupDirectory: string;
  sourceFingerprint: SourceIdentity;
  nowMs?: number;
  maxAgeMs?: number;
}): PreviewE2EEvidenceValidation {
  const blockers: string[] = [];
  const report = optionalRecord(input.value);
  if (!report) throw new Error("Live preview E2E evidence must be a JSON object.");

  if (report.kind !== PREVIEW_E2E_EVIDENCE_KIND) {
    blockers.push("evidence kind is invalid");
  }
  if (report.schemaVersion !== PREVIEW_E2E_EVIDENCE_SCHEMA_VERSION) {
    blockers.push("evidence schema version is invalid");
  }
  if (report.ok !== true || report.exitCode !== 0) {
    blockers.push("runner did not finish successfully");
  }
  if (
    !Array.isArray(report.requirementBlockers) ||
    report.requirementBlockers.length !== 0
  ) {
    blockers.push("runner retained unmet release requirements");
  }

  const createdAt = typeof report.createdAt === "string" ? report.createdAt : "";
  const createdAtMs = Date.parse(createdAt);
  const nowMs = input.nowMs ?? Date.now();
  const maximumAgeMs = input.maxAgeMs ?? PREVIEW_E2E_EVIDENCE_MAX_AGE_MS;
  const ageMs = nowMs - createdAtMs;
  if (
    !createdAt ||
    !Number.isFinite(createdAtMs) ||
    new Date(createdAtMs).toISOString() !== createdAt ||
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs <= 0 ||
    ageMs < 0 ||
    ageMs > maximumAgeMs
  ) {
    blockers.push("evidence is stale, future-dated, or has an invalid timestamp");
  }

  const backupDirectory = path.resolve(input.backupDirectory);
  if (
    typeof report.backupDir !== "string" ||
    path.resolve(report.backupDir) !== backupDirectory
  ) {
    blockers.push("evidence belongs to a different backup directory");
  }
  if (!isLoopbackPreviewUrl(report.baseUrl)) {
    blockers.push("evidence did not target a loopback Cloudflare preview");
  }

  const expectedSource = validSourceIdentity(input.sourceFingerprint);
  const sourceBefore = sourceIdentity(report.sourceFingerprintBefore);
  const sourceAfter = sourceIdentity(report.sourceFingerprintAfter);
  if (
    !expectedSource ||
    !sourceBefore ||
    !sourceAfter ||
    report.sourceFingerprintStable !== true ||
    !sameSourceIdentity(sourceBefore, sourceAfter) ||
    !sameSourceIdentity(sourceAfter, expectedSource)
  ) {
    blockers.push("evidence is not stable and bound to the exact current source");
  }

  const liveEnvironment = optionalRecord(report.liveEnvironment);
  if (
    !liveEnvironment ||
    liveEnvironment.requireLiveAi !== true ||
    liveEnvironment.providerRuntimeCredentialConfigured !== true ||
    liveEnvironment.authenticatedE2eRequired !== true ||
    liveEnvironment.migrationE2eAuth !== true ||
    liveEnvironment.productionE2eReadOnly !== false ||
    liveEnvironment.productScope !==
      "multilingual-static-native-accounts-memory-admin-and-activities"
  ) {
    blockers.push("live AI and authenticated preview requirements were not enforced");
  }

  const playwright = report.playwright;
  const analysis = analyzePreviewE2EPlaywrightReport(playwright);
  blockers.push(...analysis.blockers);
  const coverage = optionalRecord(report.coverage);
  if (
    !coverage ||
    coverage.ok !== true ||
    coverage.totalTests !== analysis.totalTests ||
    !sameUnknownStringSequence(
      coverage.requiredPassedTitles,
      analysis.requiredPassedTitles,
    ) ||
    !sameUnknownStringSequence(coverage.skippedTitles, analysis.skippedTitles) ||
    !Array.isArray(coverage.blockers) ||
    coverage.blockers.length !== 0
  ) {
    blockers.push("recorded coverage summary does not match the Playwright report");
  }

  const topStats = optionalRecord(report.stats);
  const playwrightStats = optionalRecord(optionalRecord(playwright)?.stats);
  if (!samePlaywrightStats(topStats, playwrightStats)) {
    blockers.push("recorded Playwright stats do not match the embedded report");
  }

  if (blockers.length > 0) {
    throw new Error(`Live preview E2E evidence is invalid: ${[...new Set(blockers)].join("; ")}.`);
  }
  if (!sourceAfter) {
    throw new Error("Live preview E2E evidence omitted its source fingerprint.");
  }
  return Object.freeze({
    createdAt,
    sourceFingerprint: Object.freeze(sourceAfter),
    totalTests: analysis.totalTests,
    requiredPassedTitles: analysis.requiredPassedTitles,
    skippedTitles: analysis.skippedTitles,
  });
}

export function readAndValidatePreviewE2EEvidence(input: {
  cwd?: string;
  backupDirectory: string;
  sourceFingerprint?: SourceIdentity;
  nowMs?: number;
  maxAgeMs?: number;
}): PreviewE2EEvidenceHandle {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const backupDirectory = path.resolve(input.backupDirectory);
  const reportPath = path.join(backupDirectory, PREVIEW_E2E_EVIDENCE_RELATIVE_PATH);
  const body = readPrivateStableReport(reportPath, backupDirectory);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error("Live preview E2E evidence is not valid JSON.", { cause: error });
  }
  const sourceFingerprint =
    input.sourceFingerprint ?? buildRepoSourceFingerprint(cwd);
  return Object.freeze({
    path: reportPath,
    bytes: body.byteLength,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    validation: validatePreviewE2EEvidence({
      value: parsed,
      backupDirectory,
      sourceFingerprint,
      nowMs: input.nowMs,
      maxAgeMs: input.maxAgeMs,
    }),
  });
}

function collectSuiteOutcomes(
  value: unknown,
  outcomes: PreviewTestOutcome[],
  blockers: string[],
) {
  const suite = optionalRecord(value);
  if (!suite) {
    blockers.push("Playwright suite entry must be an object.");
    return;
  }
  const specs = Array.isArray(suite.specs) ? suite.specs : [];
  for (const specValue of specs) {
    const spec = optionalRecord(specValue);
    const title = typeof spec?.title === "string" ? spec.title : "";
    const tests = Array.isArray(spec?.tests) ? spec.tests : [];
    if (!spec || !title || tests.length !== 1) {
      blockers.push(`Playwright spec has invalid identity or project cardinality: ${title || "<untitled>"}.`);
      continue;
    }
    const test = optionalRecord(tests[0]);
    const results = Array.isArray(test?.results) ? test.results : [];
    const resultStatuses = results.map((result) => {
      const status = optionalRecord(result)?.status;
      return typeof status === "string" ? status : "<invalid>";
    });
    outcomes.push(Object.freeze({
      title,
      specOk: spec.ok === true,
      projectName: typeof test?.projectName === "string" ? test.projectName : "",
      expectedStatus: typeof test?.expectedStatus === "string" ? test.expectedStatus : "",
      status: typeof test?.status === "string" ? test.status : "",
      resultStatuses: Object.freeze(resultStatuses),
    }));
  }
  const childSuites = Array.isArray(suite.suites) ? suite.suites : [];
  for (const child of childSuites) collectSuiteOutcomes(child, outcomes, blockers);
}

function isSkippedOutcome(outcome: PreviewTestOutcome | undefined) {
  return outcome?.status === "skipped" || outcome?.resultStatuses.includes("skipped") === true;
}

function isCanonicalPassingOutcome(outcome: PreviewTestOutcome | undefined) {
  return Boolean(
    outcome?.specOk &&
      outcome.projectName === "chromium" &&
      outcome.expectedStatus === "passed" &&
      outcome.status === "expected" &&
      outcome.resultStatuses.length === 1 &&
      outcome.resultStatuses[0] === "passed",
  );
}

function failedPlaywrightAnalysis(blocker: string): PreviewE2EPlaywrightAnalysis {
  return Object.freeze({
    ok: false,
    blockers: Object.freeze([blocker]),
    totalTests: 0,
    requiredPassedTitles: Object.freeze([]),
    skippedTitles: Object.freeze([]),
  });
}

function readPrivateStableReport(filePath: string, backupDirectory: string) {
  const relative = path.relative(backupDirectory, filePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Live preview E2E evidence escaped its backup directory.");
  }
  const named = fs.lstatSync(filePath);
  assertPrivateReportMetadata(named);
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const before = fs.fstatSync(descriptor);
    assertPrivateReportMetadata(before);
    if (named.dev !== before.dev || named.ino !== before.ino) {
      throw new Error("Live preview E2E evidence changed during nofollow open.");
    }
    const body = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      body.byteLength !== before.size
    ) {
      throw new Error("Live preview E2E evidence changed during read.");
    }
    return body;
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertPrivateReportMetadata(stat: fs.Stats) {
  const ownerOk =
    typeof process.getuid !== "function" || stat.uid === process.getuid();
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    !ownerOk ||
    (stat.mode & 0o777) !== 0o600 ||
    !Number.isSafeInteger(stat.size) ||
    stat.size <= 0 ||
    stat.size > MAX_REPORT_BYTES
  ) {
    throw new Error(
      "Live preview E2E evidence must be a bounded owner-only regular file with one link.",
    );
  }
}

function sourceIdentity(value: unknown): SourceIdentity | null {
  const record = optionalRecord(value);
  if (!record) return null;
  return validSourceIdentity({
    sha256: record.sha256,
    fileCount: record.fileCount,
  });
}

function validSourceIdentity(value: {
  sha256: unknown;
  fileCount: unknown;
}): SourceIdentity | null {
  if (
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    typeof value.fileCount !== "number" ||
    !Number.isSafeInteger(value.fileCount) ||
    value.fileCount <= 0
  ) {
    return null;
  }
  return Object.freeze({ sha256: value.sha256, fileCount: value.fileCount });
}

function sameSourceIdentity(left: SourceIdentity, right: SourceIdentity) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function isLoopbackPreviewUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function samePlaywrightStats(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
) {
  if (!left || !right) return false;
  return ["startTime", "duration", "expected", "unexpected", "flaky", "skipped"].every(
    (key) => left[key] === right[key],
  );
}

function sameUnknownStringSequence(value: unknown, expected: readonly string[]) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function sameStringSequence(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
