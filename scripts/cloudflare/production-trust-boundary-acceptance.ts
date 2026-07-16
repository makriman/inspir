import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
import {
  assertGitReleaseIdentity,
  type GitReleaseIdentity,
} from "./git-release-identity";
import {
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  createHash,
  stableStringify,
} from "./migration-config";
import {
  buildRepoSourceFingerprint,
  type SourceFingerprint,
} from "./source-fingerprint";
import { buildReleaseArtifactSafetyChecks } from "./release-artifact-safety";

export const PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND =
  "inspir-fresh-0016-production-trust-boundary-acceptance-v1" as const;
export const PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_SCHEMA_VERSION = 1 as const;
export const PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG =
  "--confirm-lost-key-fresh-boundary" as const;
export const PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT =
  "I accept the fresh trust boundary and understand that the 13 July-to-cutover identity interval cannot be cryptographically re-proven." as const;
export const PRODUCTION_TRUST_BOUNDARY_DIRECTORY_RELATIVE_PATH =
  "cloudflare/production-trust-boundary-acceptances" as const;

const MAXIMUM_ACCEPTANCE_BYTES = 32 * 1024;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40,64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sha256Schema = z.string().regex(SHA256_PATTERN);
const gitObjectSchema = z.string().regex(GIT_OBJECT_PATTERN);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical ISO timestamp.");

export const PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE = Object.freeze({
  release: "inspirlearning-free-static-no-games-fresh-0016",
  oneReleaseOnly: true,
  accountId: CLOUDFLARE_ACCOUNT_ID,
  workerName: "inspirlearning",
  d1DatabaseName: D1_DATABASE_NAME,
  d1DatabaseId: D1_DATABASE_ID,
  identityIntervalStart: "2026-07-13",
  identityIntervalEnd: "fresh-0016-cutover",
  identityIntervalCryptographicallyReprovable: false,
  requiredMigrationChronology: ["0017-predecessor-day", "0016-cutover-day"] as const,
  productionReadsRequireAcceptance: true,
  productionWritesRequireAcceptance: true,
  workerReleaseOperationsRequireAcceptance: true,
  productionValidationRequiresAcceptance: true,
});

export const PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256 = sha256(
  PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT,
);
export const PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256 = sha256(
  stableStringify(PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE),
);

export const productionTrustBoundaryAcceptanceArtifactSchema = z
  .object({
    kind: z.literal(PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND),
    schemaVersion: z.literal(
      PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_SCHEMA_VERSION,
    ),
    acceptanceId: z.string().regex(UUID_PATTERN),
    acceptedAt: canonicalTimestampSchema,
    backupDirectory: z.string().min(1).max(8_192),
    exactStatement: z.literal(PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT),
    exactStatementSha256: z.literal(
      PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256,
    ),
    confirmationFlag: z.literal(
      PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG,
    ),
    releaseScope: z
      .object({
        release: z.literal(
          PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE.release,
        ),
        oneReleaseOnly: z.literal(true),
        accountId: z.literal(CLOUDFLARE_ACCOUNT_ID),
        workerName: z.literal(PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE.workerName),
        d1DatabaseName: z.literal(D1_DATABASE_NAME),
        d1DatabaseId: z.literal(D1_DATABASE_ID),
        identityIntervalStart: z.literal("2026-07-13"),
        identityIntervalEnd: z.literal("fresh-0016-cutover"),
        identityIntervalCryptographicallyReprovable: z.literal(false),
        requiredMigrationChronology: z.tuple([
          z.literal("0017-predecessor-day"),
          z.literal("0016-cutover-day"),
        ]),
        productionReadsRequireAcceptance: z.literal(true),
        productionWritesRequireAcceptance: z.literal(true),
        workerReleaseOperationsRequireAcceptance: z.literal(true),
        productionValidationRequiresAcceptance: z.literal(true),
      })
      .strict(),
    releaseScopeSha256: z.literal(
      PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256,
    ),
    git: z
      .object({
        head: gitObjectSchema,
        upstream: gitObjectSchema,
        upstreamRef: z.string().min(1).max(1_024),
      })
      .strict(),
    sourceFingerprint: z
      .object({
        sha256: sha256Schema,
        fileCount: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.git.head !== value.git.upstream) {
      context.addIssue({
        code: "custom",
        message: "Trust acceptance Git HEAD must equal its pushed upstream.",
      });
    }
    if (
      stableStringify(value.releaseScope) !==
      stableStringify(PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE)
    ) {
      context.addIssue({
        code: "custom",
        message: "Trust acceptance release scope is not canonical.",
      });
    }
  });

export type ProductionTrustBoundaryAcceptanceArtifact = z.infer<
  typeof productionTrustBoundaryAcceptanceArtifactSchema
>;

export type ProductionTrustBoundaryAcceptanceHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  artifact: ProductionTrustBoundaryAcceptanceArtifact;
}>;

export type ProductionTrustBoundaryAcceptanceBinding = Readonly<{
  kind: typeof PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND;
  schemaVersion: typeof PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_SCHEMA_VERSION;
  acceptanceId: string;
  acceptedAt: string;
  artifactSha256: string;
  backupDirectorySha256: string;
  exactStatementSha256: typeof PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256;
  releaseScopeSha256: typeof PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256;
  gitHead: string;
  sourceFingerprintSha256: string;
  sourceFingerprintFileCount: number;
}>;

type AcceptanceDependencies = Readonly<{
  readGitIdentity: (cwd: string) => GitReleaseIdentity;
  buildSourceFingerprint: (cwd: string) => SourceFingerprint;
  buildSafetyChecks: (input: Readonly<{
    backupDir: string;
    cwd: string;
    nowMs: number;
  }>) => ReadonlyArray<Readonly<{
    name: string;
    status: "pass" | "fail";
  }>>;
  randomUuid: () => string;
}>;

export type ProductionTrustBoundaryAcceptanceOptions = Readonly<{
  cwd?: string;
  backupDirectory?: string;
  now?: Date;
  dependencies?: Partial<AcceptanceDependencies>;
}>;

const defaultDependencies: AcceptanceDependencies = {
  readGitIdentity: (cwd) => assertGitReleaseIdentity({ cwd }),
  buildSourceFingerprint: (cwd) => buildRepoSourceFingerprint(cwd),
  buildSafetyChecks: (input) => buildReleaseArtifactSafetyChecks(input),
  randomUuid: () => randomUUID(),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const parsed = parseProductionTrustBoundaryAcceptanceCli(
      process.argv.slice(2),
    );
    const handle = createProductionTrustBoundaryAcceptance({
      cwd: process.cwd(),
      backupDirectory: parsed.backupDirectory,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: handle.path,
          sha256: handle.sha256,
          acceptanceId: handle.artifact.acceptanceId,
          acceptedAt: handle.artifact.acceptedAt,
          gitHead: handle.artifact.git.head,
          sourceFingerprint: handle.artifact.sourceFingerprint,
          releaseScopeSha256: handle.artifact.releaseScopeSha256,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function parseProductionTrustBoundaryAcceptanceCli(args: readonly string[]) {
  let confirmed = false;
  let backupDirectory: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG && !confirmed) {
      confirmed = true;
      continue;
    }
    if (argument === "--backup" && backupDirectory === undefined) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Trust acceptance --backup requires one directory path.");
      }
      backupDirectory = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(
      `Trust acceptance accepts only ${PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG} and optional --backup <directory>.`,
    );
  }
  if (!confirmed) {
    throw new Error(
      `Trust acceptance requires the exact ${PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG} acknowledgement.`,
    );
  }
  return { backupDirectory };
}

export function createProductionTrustBoundaryAcceptance(
  options: ProductionTrustBoundaryAcceptanceOptions = {},
): ProductionTrustBoundaryAcceptanceHandle {
  const context = acceptanceContext(options);
  const identity = currentReleaseIdentity(context);
  const file = acceptanceArtifactPath(
    context.backupDirectory,
    identity.git,
    identity.sourceFingerprint,
  );
  const directoryIdentities = ensureAcceptanceDirectories(
    context.backupDirectory,
  );
  if (pathEntryExistsNoFollow(file)) {
    return readAndValidateProductionTrustBoundaryAcceptance(options);
  }
  const acceptedAt = canonicalNow(context.now);
  const failedSafetyChecks = context.dependencies
    .buildSafetyChecks({
      backupDir: context.backupDirectory,
      cwd: context.cwd,
      nowMs: Date.parse(acceptedAt),
    })
    .filter((check) => check.status !== "pass")
    .map((check) => check.name);
  if (failedSafetyChecks.length > 0) {
    throw new Error(
      `Production trust acceptance requires fresh passing local release evidence: ${failedSafetyChecks.join(", ")}.`,
    );
  }
  const artifact = productionTrustBoundaryAcceptanceArtifactSchema.parse({
    kind: PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND,
    schemaVersion: PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_SCHEMA_VERSION,
    acceptanceId: context.dependencies.randomUuid(),
    acceptedAt,
    backupDirectory: context.backupDirectory,
    exactStatement: PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT,
    exactStatementSha256:
      PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256,
    confirmationFlag: PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG,
    releaseScope: PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE,
    releaseScopeSha256: PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256,
    git: identity.git,
    sourceFingerprint: {
      sha256: identity.sourceFingerprint.sha256,
      fileCount: identity.sourceFingerprint.fileCount,
    },
  });
  writePrivateJsonDurably(file, artifact, { replace: false });
  assertAcceptanceDirectoryIdentities(directoryIdentities);
  const handle = readAndValidateProductionTrustBoundaryAcceptance(options);
  assertAcceptanceDirectoryIdentities(directoryIdentities);
  return handle;
}

export function readAndValidateProductionTrustBoundaryAcceptance(
  options: ProductionTrustBoundaryAcceptanceOptions = {},
): ProductionTrustBoundaryAcceptanceHandle {
  const context = acceptanceContext(options);
  const identity = currentReleaseIdentity(context);
  const directoryIdentities = ensureAcceptanceDirectories(
    context.backupDirectory,
    false,
  );
  const file = acceptanceArtifactPath(
    context.backupDirectory,
    identity.git,
    identity.sourceFingerprint,
  );
  const stable = readStablePrivateAcceptance(file);
  let value: unknown;
  try {
    value = JSON.parse(stable.payload.toString("utf8")) as unknown;
  } catch {
    throw new Error("Production trust acceptance is not valid JSON.");
  }
  const parsed = productionTrustBoundaryAcceptanceArtifactSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Production trust acceptance has an invalid schema: ${parsed.error.message}`,
    );
  }
  assertAcceptanceMatchesCurrentRelease(
    parsed.data,
    identity.git,
    identity.sourceFingerprint,
    context.now,
    context.backupDirectory,
  );
  assertAcceptanceDirectoryIdentities(directoryIdentities);
  return {
    path: file,
    bytes: stable.payload.byteLength,
    sha256: createHash().update(stable.payload).digest("hex"),
    artifact: parsed.data,
  };
}

export function productionTrustBoundaryAcceptanceBinding(
  handle: ProductionTrustBoundaryAcceptanceHandle,
): ProductionTrustBoundaryAcceptanceBinding {
  const artifact = handle.artifact;
  return {
    kind: artifact.kind,
    schemaVersion: artifact.schemaVersion,
    acceptanceId: artifact.acceptanceId,
    acceptedAt: artifact.acceptedAt,
    artifactSha256: handle.sha256,
    backupDirectorySha256: sha256(artifact.backupDirectory),
    exactStatementSha256: artifact.exactStatementSha256,
    releaseScopeSha256: artifact.releaseScopeSha256,
    gitHead: artifact.git.head,
    sourceFingerprintSha256: artifact.sourceFingerprint.sha256,
    sourceFingerprintFileCount: artifact.sourceFingerprint.fileCount,
  };
}

export function assertProductionTrustBoundaryAcceptanceBinding(
  expected: ProductionTrustBoundaryAcceptanceBinding,
  actual: ProductionTrustBoundaryAcceptanceHandle,
) {
  const current = productionTrustBoundaryAcceptanceBinding(actual);
  if (stableStringify(expected) !== stableStringify(current)) {
    throw new Error(
      "Production trust acceptance no longer matches the exact release-bound acceptance artifact.",
    );
  }
  return actual;
}

export function acceptanceArtifactPath(
  backupDirectory: string,
  git: Pick<GitReleaseIdentity, "head">,
  sourceFingerprint: Pick<SourceFingerprint, "sha256">,
) {
  if (
    !GIT_OBJECT_PATTERN.test(git.head) ||
    !SHA256_PATTERN.test(sourceFingerprint.sha256)
  ) {
    throw new Error(
      "Production trust acceptance path requires exact Git and source identities.",
    );
  }
  return path.join(
    path.resolve(backupDirectory),
    PRODUCTION_TRUST_BOUNDARY_DIRECTORY_RELATIVE_PATH,
    `fresh-0016-${git.head}-${sourceFingerprint.sha256}.json`,
  );
}

function acceptanceContext(options: ProductionTrustBoundaryAcceptanceOptions) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDirectory = path.resolve(
    options.backupDirectory ?? path.join(cwd, "tmp", "cloudflare-reports"),
  );
  return {
    cwd,
    backupDirectory,
    now: options.now ?? new Date(),
    dependencies: {
      ...defaultDependencies,
      ...options.dependencies,
    },
  };
}

function currentReleaseIdentity(
  context: ReturnType<typeof acceptanceContext>,
) {
  const git = context.dependencies.readGitIdentity(context.cwd);
  const sourceFingerprint = context.dependencies.buildSourceFingerprint(
    context.cwd,
  );
  if (
    git.head !== git.upstream ||
    !GIT_OBJECT_PATTERN.test(git.head) ||
    !GIT_OBJECT_PATTERN.test(git.upstream) ||
    !SHA256_PATTERN.test(sourceFingerprint.sha256) ||
    !Number.isSafeInteger(sourceFingerprint.fileCount) ||
    sourceFingerprint.fileCount <= 0
  ) {
    throw new Error(
      "Production trust acceptance requires one clean, pushed Git release and exact source fingerprint.",
    );
  }
  return { git, sourceFingerprint };
}

function assertAcceptanceMatchesCurrentRelease(
  artifact: ProductionTrustBoundaryAcceptanceArtifact,
  git: GitReleaseIdentity,
  sourceFingerprint: SourceFingerprint,
  now: Date,
  backupDirectory: string,
) {
  if (Date.parse(artifact.acceptedAt) > now.getTime()) {
    throw new Error(
      "Production trust acceptance is future-dated for the current release clock.",
    );
  }
  if (
    artifact.backupDirectory !== backupDirectory ||
    artifact.git.head !== git.head ||
    artifact.git.upstream !== git.upstream ||
    artifact.git.upstreamRef !== git.upstreamRef ||
    artifact.sourceFingerprint.sha256 !== sourceFingerprint.sha256 ||
    artifact.sourceFingerprint.fileCount !== sourceFingerprint.fileCount
  ) {
    throw new Error(
      "Production trust acceptance is not bound to the exact current pushed source.",
    );
  }
}

function ensureAcceptanceDirectories(
  backupDirectory: string,
  create = true,
) {
  const backup = path.resolve(backupDirectory);
  const cloudflare = path.join(backup, "cloudflare");
  const acceptance = path.join(
    backup,
    PRODUCTION_TRUST_BOUNDARY_DIRECTORY_RELATIVE_PATH,
  );
  if (create) {
    ensurePrivateDirectory(backup);
    ensurePrivateDirectory(cloudflare);
    ensurePrivateDirectory(acceptance);
  } else {
    assertPrivateDirectory(backup, "backup directory");
    assertPrivateDirectory(cloudflare, "backup Cloudflare directory");
    assertPrivateDirectory(acceptance, "trust acceptance directory");
  }
  return [
    directoryIdentity(backup, "backup directory"),
    directoryIdentity(cloudflare, "backup Cloudflare directory"),
    directoryIdentity(acceptance, "trust acceptance directory"),
  ] as const;
}

function ensurePrivateDirectory(directory: string) {
  try {
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
  assertPrivateDirectory(directory, "trust acceptance evidence directory");
}

function assertPrivateDirectory(directory: string, label: string) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directory);
  } catch {
    throw new Error(
      `Production ${label} must be a real owner-only mode-0700 directory.`,
    );
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(
      `Production ${label} must be a real owner-only mode-0700 directory.`,
    );
  }
  let canonical: string;
  try {
    canonical = fs.realpathSync.native(directory);
  } catch {
    throw new Error(
      `Production ${label} must have one stable canonical directory identity.`,
    );
  }
  if (canonical !== path.resolve(directory)) {
    throw new Error(
      `Production ${label} must not use a symlinked directory or ancestor.`,
    );
  }
  return stat;
}

type AcceptanceDirectoryIdentity = Readonly<{
  directory: string;
  label: string;
  dev: number;
  ino: number;
}>;

function directoryIdentity(
  directory: string,
  label: string,
): AcceptanceDirectoryIdentity {
  const stat = assertPrivateDirectory(directory, label);
  return {
    directory: path.resolve(directory),
    label,
    dev: stat.dev,
    ino: stat.ino,
  };
}

function assertAcceptanceDirectoryIdentities(
  identities: readonly AcceptanceDirectoryIdentity[],
) {
  for (const identity of identities) {
    const current = assertPrivateDirectory(identity.directory, identity.label);
    if (current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new Error(
        `Production ${identity.label} changed during trust acceptance publication or validation.`,
      );
    }
  }
}

function readStablePrivateAcceptance(file: string) {
  const absolute = path.resolve(file);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error(
      "Production trust acceptance is missing or is not an owner-only mode-0600 regular file.",
    );
  }
  try {
    const before = fs.fstatSync(descriptor);
    assertPrivateAcceptanceStat(before);
    const payload = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateAcceptanceStat(after);
    let named: fs.Stats;
    try {
      named = fs.lstatSync(absolute);
    } catch {
      throw new Error("Production trust acceptance changed while being read.");
    }
    if (
      !sameStableFile(before, after) ||
      !sameStableFile(after, named) ||
      payload.byteLength !== before.size
    ) {
      throw new Error("Production trust acceptance changed while being read.");
    }
    return { payload };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertPrivateAcceptanceStat(stat: fs.Stats) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size <= 0 ||
    stat.size > MAXIMUM_ACCEPTANCE_BYTES ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(
      "Production trust acceptance must be one non-empty owner-only mode-0600 single-link regular file.",
    );
  }
}

function sameStableFile(left: fs.Stats, right: fs.Stats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink &&
    left.mode === right.mode
  );
}

function canonicalNow(now: Date) {
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Production trust acceptance requires a valid clock.");
  }
  return timestamp.toISOString();
}

function pathEntryExistsNoFollow(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function sha256(value: string) {
  return createHash().update(value, "utf8").digest("hex");
}
