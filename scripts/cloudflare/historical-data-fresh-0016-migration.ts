import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "./historical-data-fresh-0016-cutover-policy";

export const HISTORICAL_FRESH_0016_DATABASE_MARKER_KIND =
  "inspir-historical-data-fresh-0016-database-marker-v1" as const;
const HISTORICAL_FRESH_0016_RENDERED_MIGRATION_KIND =
  "inspir-historical-data-fresh-0016-rendered-migration-v1" as const;
export const HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME =
  "06a-0016-rendered.sql" as const;

// This pin is deliberately independent of a caller-supplied manifest. A
// manifest created from a modified migration must not be able to authorize the
// modified bytes as the one reviewed fresh-0016 cutover.
export const HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256 =
  "bb82870924eda639b3f6274c1fbefdf0f088423b9bc5b8fd25e7fa08e4ed2062" as const;
export const HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES = 4_880 as const;

const RENDERED_MIGRATION_MAX_BYTES = 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sha256Schema = z.string().regex(sha256Pattern);
const positiveSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const sourceFingerprintSchema = z
  .object({
    sha256: sha256Schema,
    fileCount: positiveSafeIntegerSchema,
  })
  .strict();
const databaseSchema = z
  .object({
    id: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.database.id),
    name: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.database.name),
  })
  .strict();

export const historicalFresh0016MigrationBindingSchema = z
  .object({
    cutoverRunId: z.string().regex(uuidPattern),
    cutoverManifestSha256: sha256Schema,
    migrationBudgetPreparedArtifactFileSha256: sha256Schema,
    predecessorReportSha256: sha256Schema,
    predecessorCompleteSha256: sha256Schema,
    predecessorEvidenceChainSha256: sha256Schema,
    predecessorHmacKeyId: sha256Schema,
    successorSnapshotPlanSha256: z.literal(
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.snapshotPlanSha256,
    ),
    policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
    sourceFingerprint: sourceFingerprintSchema,
    database: databaseSchema,
  })
  .strict();

const historicalFresh0016DatabaseMarkerSchema = z
  .object({
    kind: z.literal(HISTORICAL_FRESH_0016_DATABASE_MARKER_KIND),
    schemaVersion: z.literal(1),
    cutoverRunId: z.string().regex(uuidPattern),
    cutoverManifestSha256: sha256Schema,
    migrationBudgetPreparedArtifactFileSha256: sha256Schema,
    predecessorReportSha256: sha256Schema,
    predecessorCompleteSha256: sha256Schema,
    predecessorEvidenceChainSha256: sha256Schema,
    predecessorHmacKeyId: sha256Schema,
    successorSnapshotPlanSha256: z.literal(
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.snapshotPlanSha256,
    ),
    policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
    sourceFingerprintSha256: sha256Schema,
    sourceFingerprintFileCount: positiveSafeIntegerSchema,
    migrationSourceSha256: z.literal(
      HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
    ),
  })
  .strict();

export const historicalFresh0016RenderedMigrationEvidenceSchema = z
  .object({
    kind: z.literal(HISTORICAL_FRESH_0016_RENDERED_MIGRATION_KIND),
    schemaVersion: z.literal(1),
    binding: historicalFresh0016MigrationBindingSchema,
    migrationSource: z
      .object({
        file: z.literal(
          HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
        ),
        bytes: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES),
        sha256: z.literal(HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256),
      })
      .strict(),
    freshMarker: z
      .object({
        key: z.literal(
          HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
            .freshCutoverMarkerKey,
        ),
        value: historicalFresh0016DatabaseMarkerSchema,
        canonicalValue: z.string().min(1).max(16 * 1024),
        valueSha256: sha256Schema,
      })
      .strict(),
    renderedMigration: z
      .object({
        fileName: z.literal(
          HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
        ),
        bytes: positiveSafeIntegerSchema.refine(
          (value) => value <= RENDERED_MIGRATION_MAX_BYTES,
          "Rendered migration exceeds its fixed byte bound.",
        ),
        sha256: sha256Schema,
        appendedStatementCount: z.literal(
          HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
            .renderedAppendedStatementCount,
        ),
      })
      .strict(),
  })
  .strict();

export type HistoricalFresh0016MigrationBinding = z.infer<
  typeof historicalFresh0016MigrationBindingSchema
>;
export type HistoricalFresh0016DatabaseMarker = z.infer<
  typeof historicalFresh0016DatabaseMarkerSchema
>;
export type HistoricalFresh0016RenderedMigrationEvidence = z.infer<
  typeof historicalFresh0016RenderedMigrationEvidenceSchema
>;

export type HistoricalFresh0016RenderedMigrationBuild = {
  evidence: HistoricalFresh0016RenderedMigrationEvidence;
  bytes: Buffer;
};

export type HistoricalFresh0016RenderedMigrationHandle = {
  path: string;
  publication: "created" | "exact-replay";
  evidence: HistoricalFresh0016RenderedMigrationEvidence;
  identity: {
    device: number;
    inode: number;
  };
};

export type HistoricalFresh0016MigrationErrorCode =
  | "CONTRACT_INVALID"
  | "SOURCE_UNSAFE"
  | "SOURCE_MISMATCH"
  | "PATH_UNSAFE"
  | "DIRECTORY_UNSAFE"
  | "FILE_UNSAFE"
  | "PUBLICATION_CONFLICT";

export class HistoricalFresh0016MigrationError extends Error {
  readonly code: HistoricalFresh0016MigrationErrorCode;

  constructor(code: HistoricalFresh0016MigrationErrorCode, message: string) {
    super(message);
    this.name = "HistoricalFresh0016MigrationError";
    this.code = code;
  }
}

export function parseHistoricalFresh0016MigrationBinding(
  value: unknown,
): HistoricalFresh0016MigrationBinding {
  return parseSchema(
    historicalFresh0016MigrationBindingSchema,
    value,
    "fresh-0016 migration binding",
  );
}

export function createHistoricalFresh0016DatabaseMarker(
  bindingInput: unknown,
): HistoricalFresh0016DatabaseMarker {
  const binding = parseHistoricalFresh0016MigrationBinding(bindingInput);
  return parseSchema(
    historicalFresh0016DatabaseMarkerSchema,
    {
      kind: HISTORICAL_FRESH_0016_DATABASE_MARKER_KIND,
      schemaVersion: 1,
      cutoverRunId: binding.cutoverRunId,
      cutoverManifestSha256: binding.cutoverManifestSha256,
      migrationBudgetPreparedArtifactFileSha256:
        binding.migrationBudgetPreparedArtifactFileSha256,
      predecessorReportSha256: binding.predecessorReportSha256,
      predecessorCompleteSha256: binding.predecessorCompleteSha256,
      predecessorEvidenceChainSha256:
        binding.predecessorEvidenceChainSha256,
      predecessorHmacKeyId: binding.predecessorHmacKeyId,
      successorSnapshotPlanSha256: binding.successorSnapshotPlanSha256,
      policySha256: binding.policySha256,
      sourceFingerprintSha256: binding.sourceFingerprint.sha256,
      sourceFingerprintFileCount: binding.sourceFingerprint.fileCount,
      migrationSourceSha256:
        HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
    },
    "fresh-0016 database marker",
  );
}

export function canonicalHistoricalFresh0016DatabaseMarkerValue(
  markerInput: unknown,
) {
  const marker = parseSchema(
    historicalFresh0016DatabaseMarkerSchema,
    markerInput,
    "fresh-0016 database marker",
  );
  return canonicalJson(marker);
}

export function parseCanonicalHistoricalFresh0016DatabaseMarkerValue(
  value: unknown,
): HistoricalFresh0016DatabaseMarker {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 16 * 1024
  ) {
    throw migrationError(
      "CONTRACT_INVALID",
      "The fresh-0016 database marker must be bounded canonical JSON.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw migrationError(
      "CONTRACT_INVALID",
      "The fresh-0016 database marker is not valid JSON.",
    );
  }
  const marker = parseSchema(
    historicalFresh0016DatabaseMarkerSchema,
    parsed,
    "fresh-0016 database marker",
  );
  if (canonicalJson(marker) !== value) {
    throw migrationError(
      "CONTRACT_INVALID",
      "The fresh-0016 database marker is not exact canonical JSON.",
    );
  }
  return marker;
}

export function buildHistoricalFresh0016RenderedMigration(input: {
  cwd: string;
  binding: unknown;
}): HistoricalFresh0016RenderedMigrationBuild {
  const binding = parseHistoricalFresh0016MigrationBinding(input.binding);
  const migrationSource = readExactTrackedMigration0016(input.cwd);
  const marker = createHistoricalFresh0016DatabaseMarker(binding);
  const canonicalMarkerValue =
    canonicalHistoricalFresh0016DatabaseMarkerValue(marker);
  const appendedStatement = buildInsertOnlyMarkerStatement(
    canonicalMarkerValue,
  );
  const renderedBytes = Buffer.concat([
    migrationSource.bytes,
    Buffer.from(`\n${appendedStatement}`, "utf8"),
  ]);
  if (
    renderedBytes.byteLength <= migrationSource.bytes.byteLength ||
    renderedBytes.byteLength > RENDERED_MIGRATION_MAX_BYTES
  ) {
    throw migrationError(
      "SOURCE_MISMATCH",
      "The rendered fresh-0016 migration exceeds its exact bounded shape.",
    );
  }
  assertNoExplicitTransactionControl(
    renderedBytes.toString("utf8"),
    "rendered fresh-0016 migration",
  );
  const evidence = parseSchema(
    historicalFresh0016RenderedMigrationEvidenceSchema,
    {
      kind: HISTORICAL_FRESH_0016_RENDERED_MIGRATION_KIND,
      schemaVersion: 1,
      binding,
      migrationSource: {
        file:
          HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
        bytes: migrationSource.bytes.byteLength,
        sha256: migrationSource.sha256,
      },
      freshMarker: {
        key:
          HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
            .freshCutoverMarkerKey,
        value: marker,
        canonicalValue: canonicalMarkerValue,
        valueSha256: sha256(Buffer.from(canonicalMarkerValue, "utf8")),
      },
      renderedMigration: {
        fileName: HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
        bytes: renderedBytes.byteLength,
        sha256: sha256(renderedBytes),
        appendedStatementCount:
          HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
            .renderedAppendedStatementCount,
      },
    },
    "fresh-0016 rendered migration evidence",
  );
  assertEvidenceBindsMarker(evidence);
  return { evidence, bytes: Buffer.from(renderedBytes) };
}

export function historicalFresh0016RunDirectory(input: {
  backupDir: string;
  cutoverRunId: string;
}) {
  const cutoverRunId = parseSchema(
    z.string().regex(uuidPattern),
    input.cutoverRunId,
    "fresh-0016 cutover run ID",
  );
  const backupDirectory = realExistingDirectory(
    input.backupDir,
    "fresh-0016 backup directory",
  );
  const runsDirectory = path.resolve(
    backupDirectory,
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.runsRelativeDirectory,
  );
  assertContainedPath(backupDirectory, runsDirectory, "cutover runs directory");
  const runDirectory = path.resolve(runsDirectory, cutoverRunId);
  assertContainedPath(runsDirectory, runDirectory, "cutover run directory");
  if (path.basename(runDirectory) !== cutoverRunId) {
    throw migrationError(
      "PATH_UNSAFE",
      "The fresh-0016 run directory is not bound to its exact run ID.",
    );
  }
  return runDirectory;
}

export function historicalFresh0016RenderedMigrationPath(input: {
  backupDir: string;
  cutoverRunId: string;
}) {
  const runDirectory = historicalFresh0016RunDirectory(input);
  const file = path.resolve(
    runDirectory,
    HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  );
  assertContainedPath(runDirectory, file, "rendered migration path");
  return file;
}

export function publishHistoricalFresh0016RenderedMigration(input: {
  cwd: string;
  backupDir: string;
  runDirectory: string;
  binding: unknown;
}): HistoricalFresh0016RenderedMigrationHandle {
  const built = buildHistoricalFresh0016RenderedMigration({
    cwd: input.cwd,
    binding: input.binding,
  });
  const expectedRunDirectory = historicalFresh0016RunDirectory({
    backupDir: input.backupDir,
    cutoverRunId: built.evidence.binding.cutoverRunId,
  });
  const directoryIdentity = assertExactPrivateRunDirectory(
    input.runDirectory,
    expectedRunDirectory,
  );
  const file = path.resolve(
    expectedRunDirectory,
    HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  );
  assertContainedPath(expectedRunDirectory, file, "rendered migration path");

  const temporaryFile = path.join(
    expectedRunDirectory,
    `.${HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );
  const stagedIdentity = writeExclusivePrivateSql(
    temporaryFile,
    built.bytes,
  );
  try {
    fs.linkSync(temporaryFile, file);
  } catch (error) {
    removeExactFileIfPresent(temporaryFile, stagedIdentity);
    fsyncDirectory(expectedRunDirectory);
    if (isNodeError(error) && error.code === "EEXIST") {
      assertDirectoryIdentity(
        expectedRunDirectory,
        directoryIdentity,
      );
      return readHistoricalFresh0016RenderedMigration({
        cwd: input.cwd,
        backupDir: input.backupDir,
        runDirectory: input.runDirectory,
        binding: built.evidence.binding,
      });
    }
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 migration could not be published atomically without replacement.",
    );
  }

  try {
    fsyncDirectory(expectedRunDirectory);
    removeExactPublishedAlias({
      temporaryFile,
      publicFile: file,
      expectedIdentity: stagedIdentity,
    });
    fsyncDirectory(expectedRunDirectory);
  } catch {
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 migration publication was interrupted and requires reviewed recovery.",
    );
  }
  assertDirectoryIdentity(expectedRunDirectory, directoryIdentity);
  const handle = readHistoricalFresh0016RenderedMigration({
    cwd: input.cwd,
    backupDir: input.backupDir,
    runDirectory: input.runDirectory,
    binding: built.evidence.binding,
  });
  return { ...handle, publication: "created" };
}

export function readHistoricalFresh0016RenderedMigration(input: {
  cwd: string;
  backupDir: string;
  runDirectory: string;
  binding: unknown;
}): HistoricalFresh0016RenderedMigrationHandle {
  const built = buildHistoricalFresh0016RenderedMigration({
    cwd: input.cwd,
    binding: input.binding,
  });
  const expectedRunDirectory = historicalFresh0016RunDirectory({
    backupDir: input.backupDir,
    cutoverRunId: built.evidence.binding.cutoverRunId,
  });
  const directoryIdentity = assertExactPrivateRunDirectory(
    input.runDirectory,
    expectedRunDirectory,
  );
  const file = path.resolve(
    expectedRunDirectory,
    HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  );
  assertContainedPath(expectedRunDirectory, file, "rendered migration path");
  const document = readExactPrivateSql(file, built.bytes);
  assertDirectoryIdentity(expectedRunDirectory, directoryIdentity);
  return {
    path: file,
    publication: "exact-replay",
    evidence: built.evidence,
    identity: document.identity,
  };
}

function readExactTrackedMigration0016(cwd: string) {
  const repoDirectory = realExistingDirectory(cwd, "repository directory");
  const trackedRelativePath =
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile;
  if (
    path.isAbsolute(trackedRelativePath) ||
    trackedRelativePath !== path.normalize(trackedRelativePath) ||
    trackedRelativePath.split(path.sep).includes("..")
  ) {
    throw migrationError(
      "PATH_UNSAFE",
      "The tracked fresh-0016 migration path is not a safe repository-relative path.",
    );
  }
  const file = path.resolve(repoDirectory, trackedRelativePath);
  assertContainedPath(repoDirectory, file, "tracked fresh-0016 migration");
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw migrationError(
      "SOURCE_UNSAFE",
      "The tracked fresh-0016 migration must be a regular non-symlink file.",
    );
  }
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.size !== HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES
    ) {
      throw migrationError(
        "SOURCE_MISMATCH",
        "The tracked fresh-0016 migration has the wrong exact byte length.",
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      bytes.byteLength !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw migrationError(
        "SOURCE_UNSAFE",
        "The tracked fresh-0016 migration changed while it was being read.",
      );
    }
    const sourceSha256 = sha256(bytes);
    if (sourceSha256 !== HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256) {
      throw migrationError(
        "SOURCE_MISMATCH",
        "The tracked fresh-0016 migration no longer matches its reviewed exact hash.",
      );
    }
    assertNoExplicitTransactionControl(
      bytes.toString("utf8"),
      "tracked fresh-0016 migration",
    );
    return {
      file,
      bytes: Buffer.from(bytes),
      sha256: sourceSha256,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function buildInsertOnlyMarkerStatement(canonicalMarkerValue: string) {
  const markerKey =
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.freshCutoverMarkerKey;
  const statement = `INSERT INTO \`app_metadata\` (\`key\`, \`value\`, \`updated_at\`)\nVALUES (\n  '${sqlString(markerKey)}',\n  '${sqlString(canonicalMarkerValue)}',\n  unixepoch('now') * 1000\n);\n`;
  if (
    !statement.startsWith("INSERT INTO `app_metadata`") ||
    (statement.match(/;/g) ?? []).length !== 1 ||
    /\b(?:REPLACE|ON\s+CONFLICT|INSERT\s+OR|OR\s+(?:IGNORE|REPLACE))\b/i.test(
      statement,
    )
  ) {
    throw migrationError(
      "CONTRACT_INVALID",
      "The fresh-0016 database marker statement lost its insert-only semantics.",
    );
  }
  assertNoExplicitTransactionControl(
    statement,
    "fresh-0016 database marker statement",
  );
  return statement;
}

function assertNoExplicitTransactionControl(sql: string, label: string) {
  if (/\b(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
    throw migrationError(
      "SOURCE_MISMATCH",
      `The ${label} contains explicit transaction control; Wrangler must own the file transaction.`,
    );
  }
}

function assertEvidenceBindsMarker(
  evidence: HistoricalFresh0016RenderedMigrationEvidence,
) {
  const expectedMarker = createHistoricalFresh0016DatabaseMarker(
    evidence.binding,
  );
  const expectedCanonicalValue =
    canonicalHistoricalFresh0016DatabaseMarkerValue(expectedMarker);
  if (
    canonicalJson(evidence.freshMarker.value) !==
      canonicalJson(expectedMarker) ||
    evidence.freshMarker.canonicalValue !== expectedCanonicalValue ||
    evidence.freshMarker.valueSha256 !==
      sha256(Buffer.from(expectedCanonicalValue, "utf8"))
  ) {
    throw migrationError(
      "CONTRACT_INVALID",
      "The rendered migration evidence does not bind its exact canonical database marker.",
    );
  }
}

function writeExclusivePrivateSql(file: string, bytes: Buffer) {
  if (bytes.byteLength <= 0 || bytes.byteLength > RENDERED_MIGRATION_MAX_BYTES) {
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 migration has an invalid bounded size.",
    );
  }
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 staging file could not be created exclusively and safely.",
    );
  }
  try {
    fs.fchmodSync(descriptor, 0o600);
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      before.nlink !== 1 ||
      before.size !== 0 ||
      !ownedByCurrentUser(before)
    ) {
      throw migrationError(
        "FILE_UNSAFE",
        "The rendered fresh-0016 staging file has unsafe initial metadata.",
      );
    }
    const identity = statIdentity(before);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      !after.isFile() ||
      (after.mode & 0o777) !== 0o600 ||
      after.nlink !== 1 ||
      after.size !== bytes.byteLength ||
      !ownedByCurrentUser(after) ||
      !sameIdentity(identity, statIdentity(after))
    ) {
      throw migrationError(
        "FILE_UNSAFE",
        "The rendered fresh-0016 staging file changed during its durable write.",
      );
    }
    return identity;
  } finally {
    fs.closeSync(descriptor);
  }
}

function readExactPrivateSql(file: string, expectedBytes: Buffer) {
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 migration must be a regular owner-only non-symlink file.",
    );
  }
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      before.nlink !== 1 ||
      before.size !== expectedBytes.byteLength ||
      before.size <= 0 ||
      before.size > RENDERED_MIGRATION_MAX_BYTES ||
      !ownedByCurrentUser(before)
    ) {
      throw migrationError(
        "FILE_UNSAFE",
        "The rendered fresh-0016 migration has unsafe ownership, mode, type, link count, or size.",
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      bytes.byteLength !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      after.nlink !== before.nlink
    ) {
      throw migrationError(
        "FILE_UNSAFE",
        "The rendered fresh-0016 migration changed while it was being read.",
      );
    }
    if (
      !bytes.equals(expectedBytes) ||
      sha256(bytes) !== sha256(expectedBytes)
    ) {
      throw migrationError(
        "PUBLICATION_CONFLICT",
        "The rendered fresh-0016 migration does not match the exact same-run replay bytes.",
      );
    }
    return { bytes, identity: statIdentity(before) };
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeExactPublishedAlias(input: {
  temporaryFile: string;
  publicFile: string;
  expectedIdentity: { device: number; inode: number };
}) {
  const temporary = fs.lstatSync(input.temporaryFile);
  const published = fs.lstatSync(input.publicFile);
  if (
    !temporary.isFile() ||
    !published.isFile() ||
    temporary.isSymbolicLink() ||
    published.isSymbolicLink() ||
    temporary.nlink !== 2 ||
    published.nlink !== 2 ||
    !sameIdentity(statIdentity(temporary), input.expectedIdentity) ||
    !sameIdentity(statIdentity(published), input.expectedIdentity)
  ) {
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 publication aliases do not identify one exact inode.",
    );
  }
  fs.unlinkSync(input.temporaryFile);
}

function removeExactFileIfPresent(
  file: string,
  expectedIdentity: { device: number; inode: number },
) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 staging file could not be inspected for exact cleanup.",
    );
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !sameIdentity(statIdentity(stat), expectedIdentity)
  ) {
    throw migrationError(
      "FILE_UNSAFE",
      "The rendered fresh-0016 staging file changed before exact cleanup.",
    );
  }
  fs.unlinkSync(file);
}

function assertExactPrivateRunDirectory(
  suppliedDirectory: string,
  expectedDirectory: string,
) {
  const supplied = path.resolve(suppliedDirectory);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      supplied,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw migrationError(
      "DIRECTORY_UNSAFE",
      "The fresh-0016 run directory must be a real owner-only mode-0700 directory.",
    );
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o777) !==
        HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.runDirectoryMode ||
      !ownedByCurrentUser(stat)
    ) {
      throw migrationError(
        "DIRECTORY_UNSAFE",
        "The fresh-0016 run directory must be a real owner-only mode-0700 directory.",
      );
    }
    let realDirectory: string;
    try {
      realDirectory = fs.realpathSync.native(supplied);
    } catch {
      throw migrationError(
        "DIRECTORY_UNSAFE",
        "The fresh-0016 run directory could not be resolved safely.",
      );
    }
    if (realDirectory !== expectedDirectory) {
      throw migrationError(
        "PATH_UNSAFE",
        "The fresh-0016 run directory is outside its exact backup/run binding.",
      );
    }
    return statIdentity(stat);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertDirectoryIdentity(
  directory: string,
  expected: { device: number; inode: number },
) {
  const current = assertExactPrivateRunDirectory(directory, directory);
  if (!sameIdentity(current, expected)) {
    throw migrationError(
      "DIRECTORY_UNSAFE",
      "The fresh-0016 run directory changed during rendered migration publication.",
    );
  }
}

function realExistingDirectory(directory: string, label: string) {
  const absolute = path.resolve(directory);
  let realDirectory: string;
  try {
    realDirectory = fs.realpathSync.native(absolute);
  } catch {
    throw migrationError("PATH_UNSAFE", `The ${label} does not exist.`);
  }
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      realDirectory,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw migrationError(
      "PATH_UNSAFE",
      `The ${label} must resolve to a real directory.`,
    );
  }
  try {
    if (!fs.fstatSync(descriptor).isDirectory()) {
      throw migrationError(
        "PATH_UNSAFE",
        `The ${label} must resolve to a real directory.`,
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return realDirectory;
}

function assertContainedPath(root: string, candidate: string, label: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw migrationError(
      "PATH_UNSAFE",
      `The ${label} is not strictly contained by its expected directory.`,
    );
  }
}

function fsyncDirectory(directory: string) {
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw migrationError(
      "DIRECTORY_UNSAFE",
      "The fresh-0016 run directory could not be opened for durable synchronization.",
    );
  }
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw migrationError(
        "CONTRACT_INVALID",
        "Fresh-0016 evidence cannot contain a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw migrationError(
    "CONTRACT_INVALID",
    `Fresh-0016 evidence cannot encode a value of type ${typeof value}.`,
  );
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw migrationError(
      "CONTRACT_INVALID",
      `The ${label} has an invalid or non-exact schema.`,
    );
  }
  return result.data;
}

function sqlString(value: string) {
  if (value.includes("\u0000")) {
    throw migrationError(
      "CONTRACT_INVALID",
      "The fresh-0016 marker cannot contain a NUL byte.",
    );
  }
  return value.replaceAll("'", "''");
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function statIdentity(stat: fs.Stats) {
  return { device: stat.dev, inode: stat.ino };
}

function sameIdentity(
  left: { device: number; inode: number },
  right: { device: number; inode: number },
) {
  return left.device === right.device && left.inode === right.inode;
}

function ownedByCurrentUser(stat: fs.Stats) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function compareUnicodeCodePoints(left: string, right: string) {
  if (left === right) return 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex);
    const rightCodePoint = right.codePointAt(rightIndex);
    if (leftCodePoint === undefined || rightCodePoint === undefined) break;
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1;
    rightIndex += rightCodePoint > 0xffff ? 2 : 1;
  }
  return left.length < right.length ? -1 : 1;
}

function migrationError(
  code: HistoricalFresh0016MigrationErrorCode,
  message: string,
) {
  return new HistoricalFresh0016MigrationError(code, message);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
