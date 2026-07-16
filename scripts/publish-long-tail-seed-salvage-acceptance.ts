import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildLongTailMasterWorklist,
  createLongTailPipelineProvenance,
  createLongTailSeedMemory,
  createProductionLongTailInventory,
  loadProductionLongTailHistoricalTranslationSqlSeedConsensus,
  longTailSeedSalvageCurrentValidation,
  PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  type LongTailGenerationConfig,
} from "./generate-long-tail-translations";
import {
  createLegacyLongTailSeedSalvageAcceptance,
  LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT,
  parseLegacyLongTailSeedSalvageAcceptance,
  parseLegacyLongTailSeedSalvageEvidence,
  publishLegacyLongTailSeedSalvageAcceptance,
  salvageLegacyLongTailSeedMemory,
  verifyAcceptedLegacyLongTailSeedSalvage,
} from "./legacy-long-tail-seed-salvage";
import { parseStrictTranslationSemanticJsonBytes } from "./verify-translation-semantic-audit";

const ACCEPTANCE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const MAXIMUM_PUBLISHED_ARTIFACT_BYTES = 256 * 1_024;
const MAXIMUM_REPORT_BYTES = 16 * 1_024;
const LOCAL_MODEL_LABEL = "nllb-200-distilled-1.3B-local";
const LOCAL_MODEL_DIRECTORY_PARTS = Object.freeze([
  ".cache",
  "inspirlearning",
  "nllb-200-distilled-1.3B",
]);
const LOCAL_WORKER_RELATIVE_PATH =
  "scripts/generate-long-tail-translations-worker.py";

export const LEGACY_R5_SALVAGE_GENERATION_CONFIG: LongTailGenerationConfig =
  Object.freeze({
    batchSize: 16,
    numBeams: 1,
    noRepeatNgramSize: 4,
    dtype: "float16",
    device: "mps",
    maxSourceTokens: 512,
    maxNewTokens: 512,
    maxRetryAttempts: 3,
    deterministicAlgorithms: true,
    manualSeed: 0,
  });

export type PublishLongTailSeedSalvageAcceptanceOptions = Readonly<{
  historicalSeedSqlPath: string;
  legacySeedSalvagePath: string;
  outputDirectoryPath: string;
  confirmedCandidateInputOnly: boolean;
}>;

export function parsePublishLongTailSeedSalvageAcceptanceOptions(
  argv: readonly string[],
): PublishLongTailSeedSalvageAcceptanceOptions {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const pathOptionNames = new Set([
    "--historical-seed-sql",
    "--legacy-seed-salvage",
    "--output-dir",
  ]);
  const values = new Map<string, string>();
  let confirmedCandidateInputOnly = false;
  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const argument = normalizedArgv[index];
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    if (name === "--confirm-candidate-input-only") {
      if (separator !== -1 || confirmedCandidateInputOnly) {
        throw new Error(
          "--confirm-candidate-input-only must appear exactly once without a value.",
        );
      }
      confirmedCandidateInputOnly = true;
      continue;
    }
    if (!pathOptionNames.has(name)) {
      throw new Error(`Unknown legacy seed salvage publisher option: ${argument}.`);
    }
    if (values.has(name)) {
      throw new Error(`${name} may only appear once.`);
    }
    const value = separator === -1
      ? normalizedArgv[index + 1]
      : argument.slice(separator + 1);
    if (
      value === undefined ||
      !value.trim() ||
      value.includes("\u0000") ||
      (separator === -1 && value.startsWith("--"))
    ) {
      throw new Error(`${name} requires one non-empty local path.`);
    }
    values.set(name, value);
    if (separator === -1) index += 1;
  }
  const requiredPath = (name: string): string => {
    const value = values.get(name);
    if (value === undefined) {
      throw new Error(`${name} is required.`);
    }
    return value;
  };
  if (!confirmedCandidateInputOnly) {
    throw new Error(
      "--confirm-candidate-input-only is required; acceptance grants candidate-generation input authority only.",
    );
  }
  return Object.freeze({
    historicalSeedSqlPath: requiredPath("--historical-seed-sql"),
    legacySeedSalvagePath: requiredPath("--legacy-seed-salvage"),
    outputDirectoryPath: requiredPath("--output-dir"),
    confirmedCandidateInputOnly,
  });
}

function currentUserId(): bigint {
  if (typeof process.getuid !== "function") {
    throw new Error(
      "Private salvage acceptance read-back requires a local numeric user ID.",
    );
  }
  return BigInt(process.getuid());
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile() &&
    left.nlink === BigInt(1) && right.nlink === BigInt(1) &&
    left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs && left.mode === right.mode &&
    left.uid === right.uid;
}

function assertPrivateArtifactMetadata(
  metadata: BigIntStats,
  label: string,
): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== BigInt(1) ||
    metadata.uid !== currentUserId() ||
    (metadata.mode & BigInt(0o777)) !== BigInt(0o600) ||
    metadata.size <= BigInt(0) ||
    metadata.size > BigInt(MAXIMUM_PUBLISHED_ARTIFACT_BYTES)
  ) {
    throw new Error(
      `${label} must be a bounded, single-link, current-owner mode-0600 regular file.`,
    );
  }
}

function assertPrivateParentDirectory(file: string, label: string): void {
  const directory = path.dirname(file);
  const metadata = lstatSync(directory, { bigint: true });
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== currentUserId() ||
    (metadata.mode & BigInt(0o777)) !== BigInt(0o700) ||
    realpathSync(directory) !== directory
  ) {
    throw new Error(
      `${label} parent must be a current-owner mode-0700 real directory.`,
    );
  }
}

function readStablePrivateArtifact(
  file: string,
  label: string,
): Readonly<{ bytes: Buffer; sha256: string }> {
  if (path.resolve(file) !== file || realpathSync(file) !== file) {
    throw new Error(`${label} must be an exact real path.`);
  }
  assertPrivateParentDirectory(file, label);
  const pathBefore = lstatSync(file, { bigint: true });
  assertPrivateArtifactMetadata(pathBefore, label);
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(pathBefore, before)) {
      throw new Error(`${label} changed while it was opened.`);
    }
    const expectedBytes = Number(before.size);
    const bytes = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        expectedBytes - offset,
        null,
      );
      if (count === 0) {
        throw new Error(`${label} was truncated during immediate read-back.`);
      }
      offset += count;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw new Error(`${label} grew during immediate read-back.`);
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    if (
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(after, pathAfter) ||
      realpathSync(file) !== file ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error(`${label} changed during immediate read-back.`);
    }
    assertPrivateArtifactMetadata(after, label);
    return Object.freeze({
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } finally {
    closeSync(descriptor);
  }
}

function requireExactIdentity(
  label: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    throw new Error(`${label} changed before acceptance publication completed.`);
  }
}

export async function runLongTailSeedSalvageAcceptancePublisher(
  options: PublishLongTailSeedSalvageAcceptanceOptions,
  now: Date = new Date(),
) {
  if (!options.confirmedCandidateInputOnly) {
    throw new Error(
      "Candidate-generation-input-only confirmation was not supplied.",
    );
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error("The acceptance timestamp is invalid.");
  }
  const requestedRepoRoot = path.resolve(process.cwd());
  const repoRoot = realpathSync(requestedRepoRoot);
  if (requestedRepoRoot !== repoRoot) {
    throw new Error("The repository root must be its exact real path.");
  }
  const inventory = createProductionLongTailInventory(repoRoot);
  const historicalSeed =
    loadProductionLongTailHistoricalTranslationSqlSeedConsensus({
      repoRoot,
      primarySqlPath: options.historicalSeedSqlPath,
    });
  const baseSeedMemory = createLongTailSeedMemory(
    inventory,
    PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
    historicalSeed,
  );
  const provenance = await createLongTailPipelineProvenance({
    repoRoot,
    modelDirectory: path.join(os.homedir(), ...LOCAL_MODEL_DIRECTORY_PARTS),
    modelLabel: LOCAL_MODEL_LABEL,
    workerScript: path.join(repoRoot, LOCAL_WORKER_RELATIVE_PATH),
    seedMemory: baseSeedMemory,
    generationConfig: LEGACY_R5_SALVAGE_GENERATION_CONFIG,
  });
  const currentPlanning = buildLongTailMasterWorklist({
    inventory,
    provenance,
    seedMemory: baseSeedMemory,
    replaceSourceStale: true,
    replaceQualityStale: true,
    sourceStaleReplacementApprovals:
      PRODUCTION_SOURCE_STALE_REPLACEMENT_APPROVALS,
  });
  const diagnostic = salvageLegacyLongTailSeedMemory({
    repoRoot,
    obsoleteWorklistPath: options.legacySeedSalvagePath,
    currentPlanningMaster: currentPlanning.worklist,
    baseSeedMemory,
    currentValidation: longTailSeedSalvageCurrentValidation,
  });
  const acceptedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ACCEPTANCE_LIFETIME_MS).toISOString();
  const acceptance = createLegacyLongTailSeedSalvageAcceptance({
    evidence: diagnostic.evidence,
    acceptanceStatement: LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT,
    acceptedAt,
    expiresAt,
    now,
  });
  const published = publishLegacyLongTailSeedSalvageAcceptance({
    repoRoot,
    outputDirectoryPath: options.outputDirectoryPath,
    evidence: diagnostic.evidence,
    acceptance,
    now,
  });

  const evidenceReadBack = readStablePrivateArtifact(
    published.evidencePath,
    "Published legacy seed salvage evidence",
  );
  const parsedEvidenceReadBack = parseLegacyLongTailSeedSalvageEvidence(
    parseStrictTranslationSemanticJsonBytes(
      evidenceReadBack.bytes,
      "Published legacy seed salvage evidence",
    ),
  );
  const acceptanceReadBack = readStablePrivateArtifact(
    published.acceptancePath,
    "Published legacy seed salvage acceptance",
  );
  const parsedAcceptanceReadBack = parseLegacyLongTailSeedSalvageAcceptance(
    parseStrictTranslationSemanticJsonBytes(
      acceptanceReadBack.bytes,
      "Published legacy seed salvage acceptance",
    ),
    now,
  );
  requireExactIdentity(
    "Published evidence bytes",
    evidenceReadBack.sha256,
    published.evidenceFileSha256,
  );
  requireExactIdentity(
    "Published evidence identity",
    parsedEvidenceReadBack.evidenceSha256,
    diagnostic.evidence.evidenceSha256,
  );
  requireExactIdentity(
    "Published acceptance bytes",
    acceptanceReadBack.sha256,
    published.acceptanceFileSha256,
  );
  requireExactIdentity(
    "Published acceptance identity",
    parsedAcceptanceReadBack.acceptanceSha256,
    acceptance.acceptanceSha256,
  );

  const verified = verifyAcceptedLegacyLongTailSeedSalvage({
    repoRoot,
    obsoleteWorklistPath: options.legacySeedSalvagePath,
    acceptancePath: published.acceptancePath,
    currentPlanningMaster: currentPlanning.worklist,
    baseSeedMemory,
    currentValidation: longTailSeedSalvageCurrentValidation,
    now,
  });
  requireExactIdentity(
    "Verified evidence identity",
    verified.evidence.evidenceSha256,
    diagnostic.evidence.evidenceSha256,
  );
  requireExactIdentity(
    "Verified acceptance identity",
    verified.acceptance.acceptanceSha256,
    acceptance.acceptanceSha256,
  );
  requireExactIdentity(
    "Verified salvage seed identity",
    verified.seedMemory.seedMemorySha256,
    diagnostic.seedMemory.seedMemorySha256,
  );

  return Object.freeze({
    schemaVersion: 1,
    mode: "publish-legacy-seed-salvage-acceptance",
    authority: "candidate-generation-input-only",
    writes: 2,
    outputDirectory: published.relativeDirectory,
    evidencePath: path.relative(repoRoot, published.evidencePath)
      .split(path.sep).join("/"),
    acceptancePath: path.relative(repoRoot, published.acceptancePath)
      .split(path.sep).join("/"),
    acceptedAt,
    expiresAt,
    planningMasterWorklistSha256: currentPlanning.worklist.worklistSha256,
    baseSeedMemorySha256: baseSeedMemory.seedMemorySha256,
    resultSeedMemorySha256: verified.seedMemory.seedMemorySha256,
    evidenceSha256: verified.evidence.evidenceSha256,
    acceptanceSha256: verified.acceptance.acceptanceSha256,
    evidenceFileSha256: evidenceReadBack.sha256,
    acceptanceFileSha256: acceptanceReadBack.sha256,
    resultEntries: verified.seedMemory.entries.length,
    resultConflicts: verified.seedMemory.conflicts.length,
    grantsReleaseEvidence: false,
    canPromote: false,
    canDeploy: false,
    canWriteProduction: false,
  });
}

function boundedError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 2_000);
  if (typeof error === "string") return error.slice(0, 2_000);
  return "Unknown legacy seed salvage acceptance publisher error.";
}

function printHelp(): void {
  console.log(`Usage: pnpm translations:publish-legacy-seed-salvage-acceptance -- \\
  --historical-seed-sql PATH \\
  --legacy-seed-salvage PATH \\
  --output-dir tmp/FRESH-DIRECT-CHILD \\
  --confirm-candidate-input-only

Recomputes the current planning master and untrusted legacy seed
salvage, publishes a seven-day private acceptance, and immediately verifies the
exact bytes. It performs no inference, network access, promotion, or deploy.`);
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--help") {
    printHelp();
  } else {
    void runLongTailSeedSalvageAcceptancePublisher(
      parsePublishLongTailSeedSalvageAcceptanceOptions(argv),
    ).then((report) => {
      const encoded = JSON.stringify(report);
      if (Buffer.byteLength(encoded, "utf8") > MAXIMUM_REPORT_BYTES) {
        throw new Error("Legacy seed salvage acceptance report exceeded its bound.");
      }
      console.log(encoded);
    }).catch((error: unknown) => {
      console.error(`[translations:publish-legacy-seed-salvage-acceptance] ${boundedError(error)}`);
      process.exitCode = 1;
    });
  }
}
