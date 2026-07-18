import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const RELEASE_TOOLING_FORWARD_CORRECTION_ENV =
  "INSPIR_RELEASE_TOOLING_FORWARD_CORRECTION" as const;
export const RELEASE_TOOLING_FORWARD_CORRECTION_KIND =
  "inspir-release-tooling-forward-correction-v1" as const;
const MAX_CORRECTION_BYTES = 64 * 1024;
const GIT_OBJECT_PATTERN = /^[a-f0-9]{40,64}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ReleaseToolingForwardCorrectionGitIdentity = Readonly<{
  head: string;
  upstream: string;
  upstreamRef: string;
}>;

export type ReleaseToolingForwardCorrectionSourceIdentity = Readonly<{
  sha256: string;
  fileCount: number;
}>;

export type ReleaseToolingForwardCorrection = Readonly<{
  kind: typeof RELEASE_TOOLING_FORWARD_CORRECTION_KIND;
  schemaVersion: 1;
  createdAt: string;
  expiresAt: string;
  reason: string;
  releaseGit: ReleaseToolingForwardCorrectionGitIdentity;
  toolingGit: ReleaseToolingForwardCorrectionGitIdentity;
  releaseSourceFingerprint: ReleaseToolingForwardCorrectionSourceIdentity;
  toolingSourceFingerprint: ReleaseToolingForwardCorrectionSourceIdentity;
  allowedChangedFiles: readonly string[];
}>;

export function readReleaseToolingForwardCorrection(
  cwd = process.cwd(),
): ReleaseToolingForwardCorrection | null {
  const configuredPath = process.env[RELEASE_TOOLING_FORWARD_CORRECTION_ENV];
  if (!configuredPath) return null;
  const resolvedCwd = path.resolve(cwd);
  const correction = parseCorrection(readPrivateCorrectionJson(configuredPath));
  assertCorrectionTimestamps(correction);
  const currentGit = readCurrentGitIdentityIfAvailable(resolvedCwd);
  if (!currentGit || !sameGitIdentity(currentGit, correction.toolingGit)) {
    return null;
  }
  assertCurrentGitMatchesCorrection(resolvedCwd, correction, currentGit);
  return correction;
}

function readPrivateCorrectionJson(file: string): unknown {
  const absolute = path.resolve(file);
  if (absolute !== file || !path.isAbsolute(file)) {
    throw new Error(
      "Release tooling forward correction path must be absolute.",
    );
  }
  const stats = fs.lstatSync(absolute);
  if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o600) {
    throw new Error(
      "Release tooling forward correction must be an owner-only mode-0600 regular file with one link.",
    );
  }
  if (stats.size <= 0 || stats.size > MAX_CORRECTION_BYTES) {
    throw new Error("Release tooling forward correction size is invalid.");
  }
  return JSON.parse(fs.readFileSync(absolute, "utf8")) as unknown;
}

function parseCorrection(value: unknown): ReleaseToolingForwardCorrection {
  const record = objectRecord(value, "release tooling forward correction");
  requireExactKeys(record, [
    "allowedChangedFiles",
    "createdAt",
    "expiresAt",
    "kind",
    "reason",
    "releaseGit",
    "releaseSourceFingerprint",
    "schemaVersion",
    "toolingGit",
    "toolingSourceFingerprint",
  ]);
  if (
    record.kind !== RELEASE_TOOLING_FORWARD_CORRECTION_KIND ||
    record.schemaVersion !== 1
  ) {
    throw new Error("Release tooling forward correction kind is invalid.");
  }
  const allowedChangedFiles = stringArray(
    record.allowedChangedFiles,
    "allowed changed files",
  );
  if (allowedChangedFiles.length === 0) {
    throw new Error("Release tooling correction requires changed files.");
  }
  const sortedAllowed = [...allowedChangedFiles].sort();
  if (
    sortedAllowed.some((file, index) => file !== allowedChangedFiles[index]) ||
    new Set(allowedChangedFiles).size !== allowedChangedFiles.length
  ) {
    throw new Error(
      "Release tooling correction changed files must be sorted and unique.",
    );
  }
  return Object.freeze({
    kind: RELEASE_TOOLING_FORWARD_CORRECTION_KIND,
    schemaVersion: 1 as const,
    createdAt: canonicalTimestamp(record.createdAt, "createdAt"),
    expiresAt: canonicalTimestamp(record.expiresAt, "expiresAt"),
    reason: boundedString(record.reason, "reason", 256),
    releaseGit: gitIdentity(record.releaseGit, "releaseGit"),
    toolingGit: gitIdentity(record.toolingGit, "toolingGit"),
    releaseSourceFingerprint: sourceIdentity(
      record.releaseSourceFingerprint,
      "releaseSourceFingerprint",
    ),
    toolingSourceFingerprint: sourceIdentity(
      record.toolingSourceFingerprint,
      "toolingSourceFingerprint",
    ),
    allowedChangedFiles,
  });
}

function assertCorrectionTimestamps(
  correction: ReleaseToolingForwardCorrection,
) {
  const created = Date.parse(correction.createdAt);
  const expires = Date.parse(correction.expiresAt);
  const now = Date.now();
  if (created > now + 60_000 || expires <= now || expires <= created) {
    throw new Error("Release tooling forward correction is not currently valid.");
  }
}

function assertCurrentGitMatchesCorrection(
  cwd: string,
  correction: ReleaseToolingForwardCorrection,
  precheckedGit?: ReleaseToolingForwardCorrectionGitIdentity,
) {
  const status = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.trim()) {
    throw new Error(
      "Release tooling forward correction requires a clean current Git working tree.",
    );
  }
  const currentGit = precheckedGit ?? readCurrentGitIdentity(cwd);
  if (
    currentGit.head !== correction.toolingGit.head ||
    currentGit.upstream !== correction.toolingGit.upstream ||
    currentGit.upstreamRef !== correction.toolingGit.upstreamRef ||
    currentGit.head !== currentGit.upstream
  ) {
    throw new Error(
      "Release tooling forward correction current Git identity is not the recorded clean pushed tooling commit.",
    );
  }
  if (
    correction.releaseGit.head !== correction.releaseGit.upstream ||
    correction.toolingGit.head === correction.releaseGit.head
  ) {
    throw new Error(
      "Release tooling forward correction release/tooling Git identities are invalid.",
    );
  }
  runGit(cwd, ["merge-base", "--is-ancestor", correction.releaseGit.head, currentGit.head]);
  const changedFiles = git(cwd, [
    "diff",
    "--name-only",
    "-z",
    `${correction.releaseGit.head}..${currentGit.head}`,
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  if (
    changedFiles.length !== correction.allowedChangedFiles.length ||
    changedFiles.some(
      (file, index) => file !== correction.allowedChangedFiles[index],
    ) ||
    changedFiles.some((file) => !isAllowedReleaseToolingFile(file))
  ) {
    throw new Error(
      "Release tooling forward correction Git diff is not the exact allowed tooling-only file set.",
    );
  }
}

function readCurrentGitIdentityIfAvailable(
  cwd: string,
): ReleaseToolingForwardCorrectionGitIdentity | null {
  try {
    return readCurrentGitIdentity(cwd);
  } catch {
    return null;
  }
}

function readCurrentGitIdentity(
  cwd: string,
): ReleaseToolingForwardCorrectionGitIdentity {
  return {
    head: git(cwd, ["rev-parse", "--verify", "HEAD"]).trim().toLowerCase(),
    upstream: git(cwd, ["rev-parse", "--verify", "@{upstream}"])
      .trim()
      .toLowerCase(),
    upstreamRef: git(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]).trim(),
  };
}

function sameGitIdentity(
  left: ReleaseToolingForwardCorrectionGitIdentity,
  right: ReleaseToolingForwardCorrectionGitIdentity,
) {
  return (
    left.head === right.head &&
    left.upstream === right.upstream &&
    left.upstreamRef === right.upstreamRef
  );
}

export function isAllowedReleaseToolingFile(file: string) {
  return (
    file === "scripts/cloudflare/create-release-tooling-forward-correction.ts" ||
    file === "scripts/cloudflare/d1-release-budget-ledger.ts" ||
    file === "scripts/cloudflare/deploy-preflight.ts" ||
    file === "scripts/cloudflare/git-release-identity.ts" ||
    file === "scripts/cloudflare/historical-data-fresh-0016-day2-budget.ts" ||
    file === "scripts/cloudflare/historical-data-fresh-0016-preservation-cli-adapter.ts" ||
    file === "scripts/cloudflare/historical-data-fresh-0016-prerequisites.ts" ||
    file === "scripts/cloudflare/historical-data-fresh-0016-successor.ts" ||
    file === "scripts/cloudflare/release-tooling-forward-correction.ts" ||
    file === "scripts/cloudflare/reconcile-staged-translation-fallback.ts" ||
    file === "scripts/cloudflare/repair-seo-cta-translations.ts" ||
    file === "scripts/cloudflare/run-authenticated-production-validation.ts" ||
    file === "scripts/cloudflare/run-sanitized-build.ts" ||
    file === "scripts/cloudflare/source-fingerprint.ts" ||
    file === "scripts/cloudflare/verify-historical-data-fresh-0016-cutover-chain.ts" ||
    file === "scripts/cloudflare/verify-historical-data-preservation.ts" ||
    file === "scripts/cloudflare/verify-production.ts" ||
    file === "scripts/cloudflare/verify-production-background-outcomes.ts" ||
    file === "scripts/cloudflare/verify-production-worker-outcomes.ts" ||
    file === "scripts/cloudflare/verify-vectorize-readiness.ts" ||
    file === "scripts/cloudflare/vectorize-readiness-evidence.ts" ||
    file === "scripts/cloudflare/worker-candidate-pre-activation-seal.ts" ||
    file === "scripts/cloudflare/worker-candidate-pre-activation-seal-file.ts" ||
    file === "scripts/cloudflare/worker-candidate-version-override-smoke-evidence.ts" ||
    file === "tests/build-artifact-safety.test.ts" ||
    file === "tests/d1-release-budget-ledger.test.ts" ||
    file === "tests/historical-data-fresh-0016-day2-budget.test.ts" ||
    file === "tests/historical-data-fresh-0016-final-preservation-evidence.test.ts" ||
    file === "tests/historical-data-fresh-0016-successor.test.ts" ||
    file === "tests/production-background-outcomes.test.ts" ||
    file === "tests/production-verification.test.ts" ||
    file === "tests/staged-translation-d1-reconciliation.test.ts" ||
    file === "tests/worker-candidate-pre-activation-seal-file.test.ts" ||
    file === "tests/worker-candidate-release-evidence.test.ts" ||
    file === "tests/vectorize-readiness.test.ts" ||
    file === "tests/release-tooling-forward-correction.test.ts"
  );
}

function git(cwd: string, args: readonly string[]) {
  const result = runGit(cwd, args);
  return result.stdout;
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .trim()
      .slice(-1_000);
    throw new Error(
      `Release tooling forward correction Git check failed: git ${args.join(" ")}${detail ? ` (${detail})` : ""}.`,
    );
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitIdentity(
  value: unknown,
  label: string,
): ReleaseToolingForwardCorrectionGitIdentity {
  const record = objectRecord(value, label);
  requireExactKeys(record, ["head", "upstream", "upstreamRef"]);
  const head = gitObject(record.head, `${label}.head`);
  const upstream = gitObject(record.upstream, `${label}.upstream`);
  const upstreamRef = boundedString(record.upstreamRef, `${label}.upstreamRef`, 256);
  if (/[\u0000-\u001f\u007f]/.test(upstreamRef)) {
    throw new Error(`${label}.upstreamRef contains control characters.`);
  }
  return Object.freeze({ head, upstream, upstreamRef });
}

function sourceIdentity(
  value: unknown,
  label: string,
): ReleaseToolingForwardCorrectionSourceIdentity {
  const record = objectRecord(value, label);
  requireExactKeys(record, ["fileCount", "sha256"]);
  const fileCount = positiveSafeInteger(record.fileCount, `${label}.fileCount`);
  const sha256 = boundedString(record.sha256, `${label}.sha256`, 64);
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${label}.sha256 is malformed.`);
  }
  return Object.freeze({ sha256, fileCount });
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("Release tooling forward correction has unexpected fields.");
  }
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return Object.freeze(
    value.map((entry) => normalizedRelativeFile(entry, label)),
  );
}

function normalizedRelativeFile(value: string, label: string) {
  const file = boundedString(value, label, 512);
  if (
    file.startsWith("/") ||
    file.includes("\\") ||
    file.split("/").includes("..") ||
    /[\u0000-\u001f\u007f]/.test(file)
  ) {
    throw new Error(`${label} contains an unsafe file path.`);
  }
  return file;
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`${label} must be a bounded string.`);
  }
  return value;
}

function canonicalTimestamp(value: unknown, label: string) {
  const text = boundedString(value, label, 64);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return text;
}

function gitObject(value: unknown, label: string) {
  const text = boundedString(value, label, 64).toLowerCase();
  if (!GIT_OBJECT_PATTERN.test(text)) {
    throw new Error(`${label} is not a Git object ID.`);
  }
  return text;
}

function positiveSafeInteger(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}
