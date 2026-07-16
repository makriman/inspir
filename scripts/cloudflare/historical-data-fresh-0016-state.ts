import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "./historical-data-fresh-0016-cutover-policy";
import { HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME } from "./historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME,
  HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES,
} from "./historical-data-fresh-0016-predecessor";
import {
  HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME,
  HISTORICAL_FRESH_0016_SUCCESSOR_MAXIMUM_BYTES,
} from "./historical-data-fresh-0016-successor";

export const HISTORICAL_FRESH_0016_STATE_STAGE_KIND =
  "inspir-historical-data-fresh-0016-state-stage-v1" as const;
export const HISTORICAL_FRESH_0016_STATE_RESUME_LEASE_KIND =
  "inspir-historical-data-fresh-0016-state-resume-lease-v1" as const;
export const HISTORICAL_FRESH_0016_STATE_READBACK_RESOLUTION_KIND =
  "inspir-historical-data-fresh-0016-state-readback-resolution-v1" as const;
export const HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES = {
  predecessorReport:
    HISTORICAL_FRESH_0016_PREDECESSOR_AUXILIARY_FILE_NAME,
  day2BudgetEnvelope: "day2-budget-envelope.json",
  migrationBudgetPrepared: "migration-budget-prepared.json",
  renderedMigration: HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  successorReport: HISTORICAL_FRESH_0016_SUCCESSOR_AUXILIARY_FILE_NAME,
} as const;

export const HISTORICAL_FRESH_0016_STATE_STAGES = [
  "claim",
  "predecessor-authorized",
  "predecessor-prepared",
  "predecessor-complete",
  "manifest",
  "migration-authorized",
  "migration-complete",
  "runtime-verification",
  "successor-authorized",
  "successor-prepared",
  "successor-complete",
  "cutover-complete",
] as const;

export type HistoricalFresh0016StateStage =
  (typeof HISTORICAL_FRESH_0016_STATE_STAGES)[number];

const HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES = {
  claim: "01-claim.json",
  "predecessor-authorized": "02-predecessor-authorized.json",
  "predecessor-prepared": "03-predecessor-prepared.json",
  "predecessor-complete": "04-predecessor-complete.json",
  manifest: "05-manifest.json",
  "migration-authorized": "06-migration-authorized.json",
  "migration-complete": "07-migration-complete.json",
  "runtime-verification": "08-runtime-verification.json",
  "successor-authorized": "09-successor-authorized.json",
  "successor-prepared": "10-successor-prepared.json",
  "successor-complete": "11-successor-complete.json",
  "cutover-complete": "12-cutover-complete.json",
} as const satisfies Record<HistoricalFresh0016StateStage, string>;

const MAXIMUM_STATE_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_RESUME_LEASE_BYTES = 64 * 1024;
const MAXIMUM_READBACK_RESOLUTION_BYTES = 1024 * 1024;
const MAXIMUM_AUXILIARY_FILE_BYTES = 16 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type HistoricalFresh0016JsonPrimitive =
  | string
  | number
  | boolean
  | null;
export type HistoricalFresh0016JsonValue =
  | HistoricalFresh0016JsonPrimitive
  | HistoricalFresh0016JsonValue[]
  | HistoricalFresh0016JsonObject;
export type HistoricalFresh0016JsonObject = {
  [key: string]: HistoricalFresh0016JsonValue;
};

export type HistoricalFresh0016SourceFingerprint = Readonly<{
  sha256: string;
  fileCount: number;
}>;

export type HistoricalFresh0016Owner = Readonly<{
  hostname: string;
  pid: number;
}>;

const safePositiveIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const sha256Schema = z.string().regex(sha256Pattern);
const uuidSchema = z.string().regex(uuidPattern);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical ISO timestamp.");
const sourceFingerprintSchema = z.object({
  sha256: sha256Schema,
  fileCount: safePositiveIntegerSchema,
}).strict();
const ownerSchema = z.object({
  hostname: z.string().min(1).max(255).refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Owner hostnames cannot contain control characters.",
  ),
  pid: safePositiveIntegerSchema,
}).strict();
const databaseSchema = z.object({
  id: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.database.id),
  name: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY.database.name),
}).strict();
const stageSchema = z.enum(HISTORICAL_FRESH_0016_STATE_STAGES);
const jsonObjectSchema = z.custom<HistoricalFresh0016JsonObject>(
  isHistoricalFresh0016JsonObject,
  { message: "Expected a plain JSON object." },
);

const stageEnvelopeSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_STATE_STAGE_KIND),
  schemaVersion: z.literal(1),
  stage: stageSchema,
  runId: uuidSchema,
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  createdAt: canonicalTimestampSchema,
  sourceFingerprint: sourceFingerprintSchema,
  database: databaseSchema,
  owner: ownerSchema,
  priorStage: stageSchema.nullable(),
  priorSha256: sha256Schema.nullable(),
  resumeLeaseSha256: sha256Schema.nullable(),
  readbackResolutionSha256: sha256Schema.nullable(),
  payloadSha256: sha256Schema,
  payload: jsonObjectSchema,
}).strict().superRefine((value, context) => {
  if (historicalFresh0016JsonSha256(value.payload) !== value.payloadSha256) {
    context.addIssue({
      code: "custom",
      message: "The stage payload hash does not match its canonical payload.",
    });
  }
});

const resumeLeaseSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_STATE_RESUME_LEASE_KIND),
  schemaVersion: z.literal(1),
  runId: uuidSchema,
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  stage: stageSchema,
  stageSha256: sha256Schema,
  attempt: safePositiveIntegerSchema.refine(
    (value) =>
      value <=
        HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage
          .maximumResumeLeasesPerStage,
    "Resume attempt exceeds the policy bound.",
  ),
  createdAt: canonicalTimestampSchema,
  sourceFingerprint: sourceFingerprintSchema,
  database: databaseSchema,
  previousLeaseSha256: sha256Schema.nullable(),
  owner: ownerSchema,
  leaseNonce: uuidSchema,
}).strict();

const readbackResolutionSchema = z.object({
  kind: z.literal(HISTORICAL_FRESH_0016_STATE_READBACK_RESOLUTION_KIND),
  schemaVersion: z.literal(1),
  runId: uuidSchema,
  policySha256: z.literal(HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256),
  stage: stageSchema,
  stageSha256: sha256Schema,
  nextStage: stageSchema,
  attempt: safePositiveIntegerSchema.refine(
    (value) =>
      value <=
        HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage
          .maximumResumeLeasesPerStage,
    "Readback resolution attempt exceeds the policy bound.",
  ),
  createdAt: canonicalTimestampSchema,
  sourceFingerprint: sourceFingerprintSchema,
  database: databaseSchema,
  previousResolutionSha256: sha256Schema.nullable(),
  previousOwner: ownerSchema,
  owner: ownerSchema,
  readbackOnly: z.literal(true),
  d1RetryAuthorized: z.literal(false),
  evidenceSha256: sha256Schema,
  evidence: jsonObjectSchema,
  resolutionNonce: uuidSchema,
}).strict().superRefine((value, context) => {
  if (historicalFresh0016JsonSha256(value.evidence) !== value.evidenceSha256) {
    context.addIssue({
      code: "custom",
      message: "The readback resolution evidence hash does not match.",
    });
  }
});

export type HistoricalFresh0016StateStageEnvelope = z.infer<
  typeof stageEnvelopeSchema
>;
export type HistoricalFresh0016StateResumeLease = z.infer<
  typeof resumeLeaseSchema
>;
export type HistoricalFresh0016StateReadbackResolution = z.infer<
  typeof readbackResolutionSchema
>;

export type HistoricalFresh0016StateFileHandle<T> = Readonly<{
  path: string;
  value: T;
  sha256: string;
  identity: Readonly<{
    device: number;
    inode: number;
  }>;
}>;

export type HistoricalFresh0016StateAuxiliaryFileHandle = Readonly<{
  name: string;
  path: string;
  bytes: number;
  sha256: string;
  identity: Readonly<{
    device: number;
    inode: number;
  }>;
}>;

export type HistoricalFresh0016StatePaths = Readonly<{
  backupDirectory: string;
  policyRoot: string;
  runDirectory: string;
  auxiliaryFiles: Readonly<{
    predecessorReport: string;
    day2BudgetEnvelope: string;
    migrationBudgetPrepared: string;
    renderedMigration: string;
    successorReport: string;
  }>;
  stageFiles: Readonly<
    Record<HistoricalFresh0016StateStage, string>
  >;
}>;

export type HistoricalFresh0016StateIssueCode =
  | "UNEXPECTED_ENTRY"
  | "STAGE_GAP"
  | "BROKEN_STAGE"
  | "BROKEN_CHAIN"
  | "BROKEN_AUXILIARY"
  | "BROKEN_RESUME_LEASE"
  | "BROKEN_READBACK_RESOLUTION";

export type HistoricalFresh0016StateIssue = Readonly<{
  code: HistoricalFresh0016StateIssueCode;
  detail: string;
}>;

export type HistoricalFresh0016StateClassification = Readonly<{
  status:
    | "empty"
    | "in-progress"
    | "d1-may-have-started"
    | "complete"
    | "conflict"
    | "broken";
  runId: string;
  currentStage: HistoricalFresh0016StateStage | null;
  currentStageSha256: string | null;
  nextStage: HistoricalFresh0016StateStage | null;
  d1ExecutionMayHaveStarted: boolean;
  automaticRetryAllowed: boolean;
  resumeLeaseAllowed: boolean;
  readbackResolutionAllowed: boolean;
  canAdvanceWithoutD1Retry: boolean;
  stages: readonly HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>[];
  resumeLeases: readonly HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease>[];
  readbackResolutions: readonly HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution>[];
  auxiliaryFiles: readonly HistoricalFresh0016StateAuxiliaryFileHandle[];
  issues: readonly HistoricalFresh0016StateIssue[];
}>;

export type HistoricalFresh0016StateErrorCode =
  | "STATE_DIRECTORY_UNSAFE"
  | "STATE_PATH_UNSAFE"
  | "STATE_CONFLICT"
  | "STATE_SCHEMA_INVALID"
  | "STATE_FILE_UNSAFE"
  | "STATE_CHAIN_BROKEN"
  | "STATE_OWNER_ACTIVE"
  | "STATE_RESUME_FORBIDDEN";

export class HistoricalFresh0016StateError extends Error {
  readonly code: HistoricalFresh0016StateErrorCode;

  constructor(code: HistoricalFresh0016StateErrorCode, message: string) {
    super(message);
    this.name = "HistoricalFresh0016StateError";
    this.code = code;
  }
}

export function historicalFresh0016StatePaths(
  backupDirectory: string,
  runId: string,
): HistoricalFresh0016StatePaths {
  const normalizedRunId = parseRunId(runId);
  const backup = path.resolve(backupDirectory);
  const relativeRoot =
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.runsRelativeDirectory;
  const segments = relativeRoot.split("/");
  if (
    path.isAbsolute(relativeRoot) ||
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    throw stateError(
      "STATE_PATH_UNSAFE",
      "The fresh 0016 policy root is not a safe relative path.",
    );
  }
  const policyRoot = path.resolve(backup, ...segments);
  assertContainedPath(backup, policyRoot, "policy root");
  const runDirectory = path.resolve(policyRoot, normalizedRunId);
  assertDirectDescendant(policyRoot, runDirectory, "run directory");
  return {
    backupDirectory: backup,
    policyRoot,
    runDirectory,
    auxiliaryFiles: {
      predecessorReport: path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.predecessorReport,
      ),
      day2BudgetEnvelope: path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.day2BudgetEnvelope,
      ),
      migrationBudgetPrepared: path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
          .migrationBudgetPrepared,
      ),
      renderedMigration: path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.renderedMigration,
      ),
      successorReport: path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.successorReport,
      ),
    },
    stageFiles: {
      claim: path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES.claim,
      ),
      "predecessor-authorized": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "predecessor-authorized"
        ],
      ),
      "predecessor-prepared": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "predecessor-prepared"
        ],
      ),
      "predecessor-complete": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "predecessor-complete"
        ],
      ),
      manifest: path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES.manifest,
      ),
      "migration-authorized": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "migration-authorized"
        ],
      ),
      "migration-complete": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "migration-complete"
        ],
      ),
      "runtime-verification": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "runtime-verification"
        ],
      ),
      "successor-authorized": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "successor-authorized"
        ],
      ),
      "successor-prepared": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "successor-prepared"
        ],
      ),
      "successor-complete": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "successor-complete"
        ],
      ),
      "cutover-complete": path.join(
        runDirectory,
        HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[
          "cutover-complete"
        ],
      ),
    },
  };
}

export function createHistoricalFresh0016RunDirectory(input: {
  backupDirectory: string;
  runId?: string;
}): HistoricalFresh0016StatePaths {
  const runId = input.runId ?? randomUUID();
  const canonicalBackupDirectory = canonicalPrivateDirectory(
    input.backupDirectory,
    "backup directory",
  );
  const paths = historicalFresh0016StatePaths(canonicalBackupDirectory, runId);
  const backupIdentity = assertPrivateDirectory(paths.backupDirectory);
  let parent = paths.backupDirectory;
  const relativeSegments = path
    .relative(paths.backupDirectory, paths.policyRoot)
    .split(path.sep);
  for (const segment of relativeSegments) {
    const child = path.join(parent, segment);
    ensurePrivateDirectoryComponent(parent, child);
    parent = child;
  }
  assertSameDirectoryIdentity(paths.backupDirectory, backupIdentity);
  const rootIdentity = assertPrivateDirectory(paths.policyRoot);
  try {
    fs.mkdirSync(paths.runDirectory, { mode: 0o700 });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw stateError(
        "STATE_CONFLICT",
        "The fresh 0016 run directory already exists.",
      );
    }
    throw stateError(
      "STATE_DIRECTORY_UNSAFE",
      "The fresh 0016 run directory could not be created safely.",
    );
  }
  fsyncDirectory(paths.policyRoot);
  assertSameDirectoryIdentity(paths.policyRoot, rootIdentity);
  assertPrivateDirectory(paths.runDirectory);
  return paths;
}

export function validateHistoricalFresh0016RunDirectory(input: {
  backupDirectory: string;
  runId: string;
}): HistoricalFresh0016StatePaths {
  const canonicalBackupDirectory = canonicalPrivateDirectory(
    input.backupDirectory,
    "backup directory",
  );
  const paths = historicalFresh0016StatePaths(
    canonicalBackupDirectory,
    input.runId,
  );
  assertPrivateDirectory(paths.backupDirectory);
  assertPrivateDirectory(paths.policyRoot);
  assertPrivateDirectory(paths.runDirectory);
  const canonicalRoot = safeRealpath(paths.policyRoot, "policy root");
  const canonicalRun = safeRealpath(paths.runDirectory, "run directory");
  if (
    canonicalRoot !== paths.policyRoot ||
    canonicalRun !== paths.runDirectory
  ) {
    throw stateError(
      "STATE_PATH_UNSAFE",
      "The fresh 0016 state path contains a symlink or noncanonical component.",
    );
  }
  assertDirectDescendant(canonicalRoot, canonicalRun, "run directory");
  return paths;
}

export function publishHistoricalFresh0016StateStage(input: {
  backupDirectory: string;
  runId: string;
  stage: HistoricalFresh0016StateStage;
  sourceFingerprint: HistoricalFresh0016SourceFingerprint;
  payload: HistoricalFresh0016JsonObject;
  now?: Date;
  owner?: HistoricalFresh0016Owner;
}): HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope> {
  const paths = validateHistoricalFresh0016RunDirectory(input);
  const classification = classifyHistoricalFresh0016State(input);
  if (
    classification.status === "conflict" ||
    classification.status === "broken" ||
    classification.status === "complete"
  ) {
    throw stateError(
      "STATE_CONFLICT",
      "The fresh 0016 state cannot advance from its current classification.",
    );
  }
  if (classification.nextStage !== input.stage) {
    throw stateError(
      "STATE_CONFLICT",
      `The next registered fresh 0016 stage is ${classification.nextStage ?? "none"}, not ${input.stage}.`,
    );
  }
  if (
    input.stage === "manifest" &&
    !classification.auxiliaryFiles.some(
        (file) =>
          file.name ===
          HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
            .migrationBudgetPrepared,
      )
  ) {
    throw stateError(
      "STATE_CONFLICT",
      "The fresh 0016 manifest requires its immutable prepared migration-budget artifact before publication.",
    );
  }
  const sourceFingerprint = parseSchema(
    sourceFingerprintSchema,
    input.sourceFingerprint,
    "fresh 0016 source fingerprint",
  );
  const owner = parseSchema(
    ownerSchema,
    input.owner ?? currentOwner(),
    "fresh 0016 stage owner",
  );
  const previous = classification.stages.at(-1);
  if (
    previous &&
    !sameSourceFingerprint(
      previous.value.sourceFingerprint,
      sourceFingerprint,
    )
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The fresh 0016 source fingerprint changed between stages.",
    );
  }
  const currentStageLeases = previous
    ? classification.resumeLeases.filter(
        (lease) => lease.value.stage === previous.value.stage,
      )
    : [];
  const latestLease = currentStageLeases.at(-1);
  const currentStageResolutions = previous
    ? classification.readbackResolutions.filter(
        (resolution) => resolution.value.stage === previous.value.stage,
      )
    : [];
  const latestResolution = currentStageResolutions.at(-1);
  const controllingOwner =
    latestResolution?.value.owner ??
    latestLease?.value.owner ??
    previous?.value.owner;
  if (controllingOwner && !sameOwner(controllingOwner, owner)) {
    throw stateError(
      "STATE_OWNER_ACTIVE",
      "The fresh 0016 stage publisher does not own the current state.",
    );
  }
  const now = canonicalDate(input.now ?? new Date(), "stage clock");
  if (
    previous &&
    now.getTime() < Date.parse(previous.value.createdAt)
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "Fresh 0016 stage timestamps must be monotonic.",
    );
  }
  const payload = parseSchema(
    jsonObjectSchema,
    input.payload,
    "fresh 0016 stage payload",
  );
  const expectedPrior = priorStage(input.stage);
  if ((previous?.value.stage ?? null) !== expectedPrior) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The fresh 0016 stage does not follow its exact registered predecessor.",
    );
  }
  const envelope = parseSchema(stageEnvelopeSchema, {
    kind: HISTORICAL_FRESH_0016_STATE_STAGE_KIND,
    schemaVersion: 1,
    stage: input.stage,
    runId: input.runId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    createdAt: now.toISOString(),
    sourceFingerprint,
    database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
    owner,
    priorStage: expectedPrior,
    priorSha256: previous?.sha256 ?? null,
    resumeLeaseSha256: latestLease?.sha256 ?? null,
    readbackResolutionSha256: latestResolution?.sha256 ?? null,
    payloadSha256: historicalFresh0016JsonSha256(payload),
    payload,
  }, `fresh 0016 ${input.stage} stage`);
  const handle = writeExclusiveCanonicalFile(
    paths.stageFiles[input.stage],
    envelope,
    stageEnvelopeSchema,
    MAXIMUM_STATE_FILE_BYTES,
    `fresh 0016 ${input.stage} stage`,
  );
  const after = classifyHistoricalFresh0016State(input);
  if (
    after.currentStage !== input.stage ||
    after.currentStageSha256 !== handle.sha256 ||
    after.status === "conflict" ||
    after.status === "broken"
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The fresh 0016 stage lost exact durable publication.",
    );
  }
  return handle;
}

export function classifyHistoricalFresh0016State(input: {
  backupDirectory: string;
  runId: string;
}): HistoricalFresh0016StateClassification {
  const paths = validateHistoricalFresh0016RunDirectory(input);
  const entries = fs.readdirSync(paths.runDirectory, { withFileTypes: true });
  const entryNames = new Set(entries.map((entry) => entry.name));
  const stageFileNames = new Set<string>(
    Object.values(HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES),
  );
  const auxiliaryFileNames = new Set<string>(
    Object.values(HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES),
  );
  const auxiliaryEntryNames = new Set<string>();
  const issues: HistoricalFresh0016StateIssue[] = [];
  const leaseEntries: Array<{
    fileName: string;
    stage: HistoricalFresh0016StateStage;
    attempt: number;
  }> = [];
  const resolutionEntries: Array<{
    fileName: string;
    stage: HistoricalFresh0016StateStage;
    attempt: number;
  }> = [];
  for (const entry of entries) {
    if (stageFileNames.has(entry.name)) continue;
    if (auxiliaryFileNames.has(entry.name)) {
      auxiliaryEntryNames.add(entry.name);
      continue;
    }
    const leaseIdentity = parseResumeLeaseFileName(entry.name);
    if (leaseIdentity) {
      leaseEntries.push({ fileName: entry.name, ...leaseIdentity });
      continue;
    }
    const resolutionIdentity = parseReadbackResolutionFileName(entry.name);
    if (resolutionIdentity) {
      resolutionEntries.push({
        fileName: entry.name,
        ...resolutionIdentity,
      });
      continue;
    }
    issues.push({
      code: "UNEXPECTED_ENTRY",
      detail: `Unexpected fresh 0016 run entry ${entry.name}.`,
    });
  }

  const stages: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>[] = [];
  let missingTailStarted = false;
  for (const stage of HISTORICAL_FRESH_0016_STATE_STAGES) {
    const fileName = HISTORICAL_FRESH_0016_STATE_STAGE_FILE_NAMES[stage];
    if (!entryNames.has(fileName)) {
      missingTailStarted = true;
      continue;
    }
    if (missingTailStarted) {
      issues.push({
        code: "STAGE_GAP",
        detail: `Fresh 0016 stage ${stage} exists after a missing registered predecessor.`,
      });
      continue;
    }
    try {
      const handle = readCanonicalFile(
        paths.stageFiles[stage],
        stageEnvelopeSchema,
        MAXIMUM_STATE_FILE_BYTES,
        `fresh 0016 ${stage} stage`,
      );
      validateStageChainEntry(handle, stage, stages.at(-1), input.runId);
      stages.push(handle);
    } catch (error) {
      issues.push({
        code:
          error instanceof HistoricalFresh0016StateError &&
            error.code === "STATE_CHAIN_BROKEN"
            ? "BROKEN_CHAIN"
            : "BROKEN_STAGE",
        detail: boundedError(error),
      });
      missingTailStarted = true;
    }
  }

  const auxiliaryFiles: HistoricalFresh0016StateAuxiliaryFileHandle[] = [];
  const auxiliaryRequirements = [
    {
      name: HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
        .day2BudgetEnvelope,
      file: paths.auxiliaryFiles.day2BudgetEnvelope,
      allowedFromStage: "predecessor-complete",
      requiredFromStage: null,
      maximumBytes: 1024 * 1024,
      label: "fresh 0016 Day-2 aggregate budget envelope",
    },
    {
      name: HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
        .predecessorReport,
      file: paths.auxiliaryFiles.predecessorReport,
      allowedFromStage: "predecessor-prepared",
      requiredFromStage: null,
      maximumBytes: HISTORICAL_FRESH_0016_PREDECESSOR_MAXIMUM_BYTES,
      label: "fresh 0016 predecessor report",
    },
    {
      name: HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
        .migrationBudgetPrepared,
      file: paths.auxiliaryFiles.migrationBudgetPrepared,
      allowedFromStage: "predecessor-complete",
      requiredFromStage: "manifest",
      maximumBytes: 1024 * 1024,
      label: "fresh 0016 prepared migration budget",
    },
    {
      name: HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
        .renderedMigration,
      file: paths.auxiliaryFiles.renderedMigration,
      allowedFromStage: "manifest",
      requiredFromStage: null,
      maximumBytes: MAXIMUM_AUXILIARY_FILE_BYTES,
      label: "rendered fresh 0016 migration",
    },
    {
      name: HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.successorReport,
      file: paths.auxiliaryFiles.successorReport,
      allowedFromStage: "successor-prepared",
      requiredFromStage: null,
      maximumBytes: HISTORICAL_FRESH_0016_SUCCESSOR_MAXIMUM_BYTES,
      label: "fresh 0016 successor report",
    },
  ] as const satisfies readonly Readonly<{
    name: string;
    file: string;
    allowedFromStage: HistoricalFresh0016StateStage;
    requiredFromStage: HistoricalFresh0016StateStage | null;
    maximumBytes: number;
    label: string;
  }>[];
  for (const requirement of auxiliaryRequirements) {
    const exists = auxiliaryEntryNames.has(requirement.name);
    const allowed = stages.some(
      (handle) => handle.value.stage === requirement.allowedFromStage,
    );
    const required = requirement.requiredFromStage !== null && stages.some(
      (handle) => handle.value.stage === requirement.requiredFromStage,
    );
    if (!exists && required) {
      issues.push({
        code: "BROKEN_AUXILIARY",
        detail: `The required ${requirement.label} is missing from its ${requirement.requiredFromStage} chain position.`,
      });
      continue;
    }
    if (!exists) continue;
    if (!allowed) {
      issues.push({
        code: "UNEXPECTED_ENTRY",
        detail: `The ${requirement.label} exists before its ${requirement.allowedFromStage} chain position.`,
      });
    } else {
      try {
        auxiliaryFiles.push(
          readImmutableAuxiliaryFile(
            requirement.file,
            requirement.name,
            requirement.maximumBytes,
            requirement.label,
          ),
        );
      } catch (error) {
        issues.push({
          code: "BROKEN_AUXILIARY",
          detail: boundedError(error),
        });
      }
    }
  }

  const resumeLeases: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease>[] = [];
  const leasesByStage = new Map<
    HistoricalFresh0016StateStage,
    typeof leaseEntries
  >();
  for (const entry of leaseEntries) {
    const existing = leasesByStage.get(entry.stage) ?? [];
    existing.push(entry);
    leasesByStage.set(entry.stage, existing);
  }
  for (const stage of HISTORICAL_FRESH_0016_STATE_STAGES) {
    const stageLeaseEntries = [...(leasesByStage.get(stage) ?? [])].sort(
      (left, right) => left.attempt - right.attempt,
    );
    const stageHandle = stages.find((handle) => handle.value.stage === stage);
    let previousLease:
      | HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease>
      | undefined;
    for (const [index, entry] of stageLeaseEntries.entries()) {
      const expectedAttempt = index + 1;
      if (!stageHandle || entry.attempt !== expectedAttempt) {
        issues.push({
          code: "BROKEN_RESUME_LEASE",
          detail: `Fresh 0016 ${stage} resume leases are detached or noncontiguous.`,
        });
        continue;
      }
      try {
        const lease = readCanonicalFile(
          path.join(paths.runDirectory, entry.fileName),
          resumeLeaseSchema,
          MAXIMUM_RESUME_LEASE_BYTES,
          `fresh 0016 ${stage} resume lease ${expectedAttempt}`,
        );
        validateResumeLeaseChainEntry({
          lease,
          stage: stageHandle,
          previous: previousLease,
          expectedAttempt,
          runId: input.runId,
        });
        resumeLeases.push(lease);
        previousLease = lease;
      } catch (error) {
        issues.push({
          code: "BROKEN_RESUME_LEASE",
          detail: boundedError(error),
        });
      }
    }
  }

  const readbackResolutions: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution>[] = [];
  const resolutionsByStage = new Map<
    HistoricalFresh0016StateStage,
    typeof resolutionEntries
  >();
  for (const entry of resolutionEntries) {
    const existing = resolutionsByStage.get(entry.stage) ?? [];
    existing.push(entry);
    resolutionsByStage.set(entry.stage, existing);
  }
  for (const stage of HISTORICAL_FRESH_0016_STATE_STAGES) {
    const stageResolutionEntries = [
      ...(resolutionsByStage.get(stage) ?? []),
    ].sort((left, right) => left.attempt - right.attempt);
    const stageHandle = stages.find((handle) => handle.value.stage === stage);
    let previousResolution:
      | HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution>
      | undefined;
    for (const [index, entry] of stageResolutionEntries.entries()) {
      const expectedAttempt = index + 1;
      if (
        !stageHandle ||
        !isUnresolvedAuthorizationStage(stage) ||
        entry.attempt !== expectedAttempt
      ) {
        issues.push({
          code: "BROKEN_READBACK_RESOLUTION",
          detail: `Fresh 0016 ${stage} readback resolutions are detached, unauthorized, or noncontiguous.`,
        });
        continue;
      }
      try {
        const resolution = readCanonicalFile(
          path.join(paths.runDirectory, entry.fileName),
          readbackResolutionSchema,
          MAXIMUM_READBACK_RESOLUTION_BYTES,
          `fresh 0016 ${stage} readback resolution ${expectedAttempt}`,
        );
        validateReadbackResolutionChainEntry({
          resolution,
          stage: stageHandle,
          previous: previousResolution,
          expectedAttempt,
          runId: input.runId,
        });
        readbackResolutions.push(resolution);
        previousResolution = resolution;
      } catch (error) {
        issues.push({
          code: "BROKEN_READBACK_RESOLUTION",
          detail: boundedError(error),
        });
      }
    }
  }

  validateStageOwnershipBindings(
    stages,
    resumeLeases,
    readbackResolutions,
    issues,
  );

  if (issues.length > 0) {
    const broken = issues.some((issue) =>
      issue.code === "BROKEN_STAGE" ||
      issue.code === "BROKEN_CHAIN" ||
      issue.code === "BROKEN_AUXILIARY" ||
      issue.code === "BROKEN_RESUME_LEASE" ||
      issue.code === "BROKEN_READBACK_RESOLUTION"
    );
    return Object.freeze({
      status: broken ? "broken" : "conflict",
      runId: input.runId,
      currentStage: stages.at(-1)?.value.stage ?? null,
      currentStageSha256: stages.at(-1)?.sha256 ?? null,
      nextStage: null,
      d1ExecutionMayHaveStarted: true,
      automaticRetryAllowed: false,
      resumeLeaseAllowed: false,
      readbackResolutionAllowed: false,
      canAdvanceWithoutD1Retry: false,
      stages: Object.freeze(stages),
      resumeLeases: Object.freeze(resumeLeases),
      readbackResolutions: Object.freeze(readbackResolutions),
      auxiliaryFiles: Object.freeze(auxiliaryFiles),
      issues: Object.freeze(issues),
    });
  }

  const current = stages.at(-1);
  if (!current) {
    return Object.freeze({
      status: "empty",
      runId: input.runId,
      currentStage: null,
      currentStageSha256: null,
      nextStage: "claim",
      d1ExecutionMayHaveStarted: false,
      automaticRetryAllowed: true,
      resumeLeaseAllowed: false,
      readbackResolutionAllowed: false,
      canAdvanceWithoutD1Retry: true,
      stages: Object.freeze(stages),
      resumeLeases: Object.freeze(resumeLeases),
      readbackResolutions: Object.freeze(readbackResolutions),
      auxiliaryFiles: Object.freeze(auxiliaryFiles),
      issues: Object.freeze(issues),
    });
  }
  if (current.value.stage === "cutover-complete") {
    return Object.freeze({
      status: "complete",
      runId: input.runId,
      currentStage: current.value.stage,
      currentStageSha256: current.sha256,
      nextStage: null,
      d1ExecutionMayHaveStarted: false,
      automaticRetryAllowed: false,
      resumeLeaseAllowed: false,
      readbackResolutionAllowed: false,
      canAdvanceWithoutD1Retry: false,
      stages: Object.freeze(stages),
      resumeLeases: Object.freeze(resumeLeases),
      readbackResolutions: Object.freeze(readbackResolutions),
      auxiliaryFiles: Object.freeze(auxiliaryFiles),
      issues: Object.freeze(issues),
    });
  }
  const unresolvedAuthorization = isUnresolvedAuthorizationStage(
    current.value.stage,
  );
  return Object.freeze({
    status: unresolvedAuthorization
      ? "d1-may-have-started"
      : "in-progress",
    runId: input.runId,
    currentStage: current.value.stage,
    currentStageSha256: current.sha256,
    nextStage: nextStage(current.value.stage),
    d1ExecutionMayHaveStarted: unresolvedAuthorization,
    automaticRetryAllowed: !unresolvedAuthorization,
    resumeLeaseAllowed: !unresolvedAuthorization,
    readbackResolutionAllowed: unresolvedAuthorization,
    canAdvanceWithoutD1Retry: true,
    stages: Object.freeze(stages),
    resumeLeases: Object.freeze(resumeLeases),
    readbackResolutions: Object.freeze(readbackResolutions),
    auxiliaryFiles: Object.freeze(auxiliaryFiles),
    issues: Object.freeze(issues),
  });
}

export function acquireHistoricalFresh0016ResumeLease(input: {
  backupDirectory: string;
  runId: string;
  now?: Date;
  owner?: HistoricalFresh0016Owner;
  ownerExitProbe?: (owner: HistoricalFresh0016Owner) => boolean;
}): HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease> {
  const paths = validateHistoricalFresh0016RunDirectory(input);
  const classification = classifyHistoricalFresh0016State(input);
  if (
    classification.status !== "in-progress" ||
    !classification.resumeLeaseAllowed ||
    !classification.currentStage ||
    !classification.currentStageSha256
  ) {
    throw stateError(
      "STATE_RESUME_FORBIDDEN",
      "A resume lease is allowed only for an exact definitely-pre-D1 current stage.",
    );
  }
  const currentStage = classification.stages.at(-1);
  if (!currentStage) {
    throw stateError(
      "STATE_RESUME_FORBIDDEN",
      "An empty fresh 0016 run has no stage ownership to resume.",
    );
  }
  const existing = classification.resumeLeases.filter(
    (lease) => lease.value.stage === currentStage.value.stage,
  );
  const previous = existing.at(-1);
  const priorOwner = previous?.value.owner ?? currentStage.value.owner;
  const ownerExitProbe = input.ownerExitProbe ?? defaultOwnerExitProbe;
  if (!proveOwnerExit(priorOwner, ownerExitProbe)) {
    throw stateError(
      "STATE_OWNER_ACTIVE",
      "The current fresh 0016 owner has not been proven to have exited on this host.",
    );
  }
  const attempt = existing.length + 1;
  if (
    attempt >
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.maximumResumeLeasesPerStage
  ) {
    throw stateError(
      "STATE_RESUME_FORBIDDEN",
      "Fresh 0016 resume attempts exhausted their fixed per-stage bound.",
    );
  }
  const owner = parseSchema(
    ownerSchema,
    input.owner ?? currentOwner(),
    "fresh 0016 resume owner",
  );
  if (sameOwner(priorOwner, owner)) {
    throw stateError(
      "STATE_OWNER_ACTIVE",
      "A fresh 0016 resume lease must transfer ownership to a distinct process.",
    );
  }
  const now = canonicalDate(input.now ?? new Date(), "resume lease clock");
  const minimumCreatedAt = previous?.value.createdAt ?? currentStage.value.createdAt;
  if (now.getTime() < Date.parse(minimumCreatedAt)) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "Fresh 0016 resume lease timestamps must be monotonic.",
    );
  }
  const lease = parseSchema(resumeLeaseSchema, {
    kind: HISTORICAL_FRESH_0016_STATE_RESUME_LEASE_KIND,
    schemaVersion: 1,
    runId: input.runId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    stage: currentStage.value.stage,
    stageSha256: currentStage.sha256,
    attempt,
    createdAt: now.toISOString(),
    sourceFingerprint: currentStage.value.sourceFingerprint,
    database: currentStage.value.database,
    previousLeaseSha256: previous?.sha256 ?? null,
    owner,
    leaseNonce: randomUUID(),
  }, `fresh 0016 ${currentStage.value.stage} resume lease ${attempt}`);
  const file = path.join(
    paths.runDirectory,
    resumeLeaseFileName(currentStage.value.stage, attempt),
  );
  const handle = writeExclusiveCanonicalFile(
    file,
    lease,
    resumeLeaseSchema,
    MAXIMUM_RESUME_LEASE_BYTES,
    `fresh 0016 ${currentStage.value.stage} resume lease ${attempt}`,
  );
  const after = classifyHistoricalFresh0016State(input);
  const latest = after.resumeLeases
    .filter((candidate) => candidate.value.stage === currentStage.value.stage)
    .at(-1);
  if (
    after.status !== "in-progress" ||
    !latest ||
    latest.sha256 !== handle.sha256
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The fresh 0016 resume lease lost exact append-only acquisition.",
    );
  }
  return handle;
}

export function acquireHistoricalFresh0016ReadbackResolution(input: {
  backupDirectory: string;
  runId: string;
  evidence: HistoricalFresh0016JsonObject;
  now?: Date;
  owner?: HistoricalFresh0016Owner;
  ownerExitProbe?: (owner: HistoricalFresh0016Owner) => boolean;
}): HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution> {
  const paths = validateHistoricalFresh0016RunDirectory(input);
  const classification = classifyHistoricalFresh0016State(input);
  if (
    classification.status !== "d1-may-have-started" ||
    !classification.readbackResolutionAllowed ||
    !classification.currentStage ||
    !classification.currentStageSha256 ||
    !isUnresolvedAuthorizationStage(classification.currentStage)
  ) {
    throw stateError(
      "STATE_RESUME_FORBIDDEN",
      "Readback resolution ownership is allowed only at an exact unresolved authorization tail.",
    );
  }
  const currentStage = classification.stages.at(-1);
  if (!currentStage) {
    throw stateError(
      "STATE_RESUME_FORBIDDEN",
      "An empty fresh 0016 run has no authorization to resolve.",
    );
  }
  const existing = classification.readbackResolutions.filter(
    (resolution) => resolution.value.stage === currentStage.value.stage,
  );
  const previous = existing.at(-1);
  const priorOwner = previous?.value.owner ?? currentStage.value.owner;
  const ownerExitProbe = input.ownerExitProbe ?? defaultOwnerExitProbe;
  if (!proveOwnerExit(priorOwner, ownerExitProbe)) {
    throw stateError(
      "STATE_OWNER_ACTIVE",
      "The unresolved authorization owner has not been proven to have exited on this host.",
    );
  }
  const attempt = existing.length + 1;
  if (
    attempt >
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage.maximumResumeLeasesPerStage
  ) {
    throw stateError(
      "STATE_RESUME_FORBIDDEN",
      "Fresh 0016 readback resolution attempts exhausted their fixed bound.",
    );
  }
  const owner = parseSchema(
    ownerSchema,
    input.owner ?? currentOwner(),
    "fresh 0016 readback resolution owner",
  );
  if (sameOwner(priorOwner, owner)) {
    throw stateError(
      "STATE_OWNER_ACTIVE",
      "A fresh 0016 readback resolution must transfer ownership to a distinct process.",
    );
  }
  const evidence = parseSchema(
    jsonObjectSchema,
    input.evidence,
    "fresh 0016 readback resolution evidence",
  );
  const now = canonicalDate(
    input.now ?? new Date(),
    "readback resolution clock",
  );
  const minimumCreatedAt =
    previous?.value.createdAt ?? currentStage.value.createdAt;
  if (now.getTime() < Date.parse(minimumCreatedAt)) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "Fresh 0016 readback resolution timestamps must be monotonic.",
    );
  }
  const resolvedStage = nextStage(currentStage.value.stage);
  if (!resolvedStage) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "An unresolved authorization lost its exact registered resolution successor.",
    );
  }
  const resolution = parseSchema(readbackResolutionSchema, {
    kind: HISTORICAL_FRESH_0016_STATE_READBACK_RESOLUTION_KIND,
    schemaVersion: 1,
    runId: input.runId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    stage: currentStage.value.stage,
    stageSha256: currentStage.sha256,
    nextStage: resolvedStage,
    attempt,
    createdAt: now.toISOString(),
    sourceFingerprint: currentStage.value.sourceFingerprint,
    database: currentStage.value.database,
    previousResolutionSha256: previous?.sha256 ?? null,
    previousOwner: priorOwner,
    owner,
    readbackOnly: true,
    d1RetryAuthorized: false,
    evidenceSha256: historicalFresh0016JsonSha256(evidence),
    evidence,
    resolutionNonce: randomUUID(),
  }, `fresh 0016 ${currentStage.value.stage} readback resolution ${attempt}`);
  const file = path.join(
    paths.runDirectory,
    readbackResolutionFileName(currentStage.value.stage, attempt),
  );
  const handle = writeExclusiveCanonicalFile(
    file,
    resolution,
    readbackResolutionSchema,
    MAXIMUM_READBACK_RESOLUTION_BYTES,
    `fresh 0016 ${currentStage.value.stage} readback resolution ${attempt}`,
  );
  const after = classifyHistoricalFresh0016State(input);
  const latest = after.readbackResolutions
    .filter(
      (candidate) => candidate.value.stage === currentStage.value.stage,
    )
    .at(-1);
  if (
    after.status !== "d1-may-have-started" ||
    after.automaticRetryAllowed ||
    !latest ||
    latest.sha256 !== handle.sha256
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The fresh 0016 readback resolution lost exact append-only acquisition.",
    );
  }
  return handle;
}

export function canonicalHistoricalFresh0016Json(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw stateError(
        "STATE_SCHEMA_INVALID",
        "Fresh 0016 evidence cannot contain a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalHistoricalFresh0016Json).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    const entries = Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalHistoricalFresh0016Json(value[key])}`,
      );
    return `{${entries.join(",")}}`;
  }
  throw stateError(
    "STATE_SCHEMA_INVALID",
    `Fresh 0016 evidence cannot encode a value of type ${typeof value}.`,
  );
}

export function historicalFresh0016JsonSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalHistoricalFresh0016Json(value), "utf8")
    .digest("hex");
}

function validateStageChainEntry(
  handle: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>,
  expectedStage: HistoricalFresh0016StateStage,
  previous:
    | HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>
    | undefined,
  runId: string,
) {
  const expectedPrior = priorStage(expectedStage);
  if (
    handle.value.stage !== expectedStage ||
    handle.value.runId !== runId ||
    handle.value.priorStage !== expectedPrior ||
    handle.value.priorSha256 !== (previous?.sha256 ?? null) ||
    (previous &&
      !sameSourceFingerprint(
        handle.value.sourceFingerprint,
        previous.value.sourceFingerprint,
      )) ||
    (previous &&
      Date.parse(handle.value.createdAt) < Date.parse(previous.value.createdAt))
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      `Fresh 0016 stage ${expectedStage} does not bind its exact predecessor, source fingerprint, run, or timestamp.`,
    );
  }
}

function validateResumeLeaseChainEntry(input: {
  lease: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease>;
  stage: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  previous:
    | HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease>
    | undefined;
  expectedAttempt: number;
  runId: string;
}) {
  if (
    input.lease.value.runId !== input.runId ||
    input.lease.value.stage !== input.stage.value.stage ||
    input.lease.value.stageSha256 !== input.stage.sha256 ||
    input.lease.value.attempt !== input.expectedAttempt ||
    input.lease.value.previousLeaseSha256 !==
      (input.previous?.sha256 ?? null) ||
    !sameSourceFingerprint(
      input.lease.value.sourceFingerprint,
      input.stage.value.sourceFingerprint,
    ) ||
    Date.parse(input.lease.value.createdAt) <
      Date.parse(input.previous?.value.createdAt ?? input.stage.value.createdAt)
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The fresh 0016 resume lease chain is not exact and contiguous.",
    );
  }
}

function validateReadbackResolutionChainEntry(input: {
  resolution: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution>;
  stage: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  previous:
    | HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution>
    | undefined;
  expectedAttempt: number;
  runId: string;
}) {
  const expectedPreviousOwner =
    input.previous?.value.owner ?? input.stage.value.owner;
  if (
    input.resolution.value.runId !== input.runId ||
    input.resolution.value.stage !== input.stage.value.stage ||
    !isUnresolvedAuthorizationStage(input.stage.value.stage) ||
    input.resolution.value.stageSha256 !== input.stage.sha256 ||
    input.resolution.value.nextStage !== nextStage(input.stage.value.stage) ||
    input.resolution.value.attempt !== input.expectedAttempt ||
    input.resolution.value.previousResolutionSha256 !==
      (input.previous?.sha256 ?? null) ||
    !sameOwner(input.resolution.value.previousOwner, expectedPreviousOwner) ||
    sameOwner(input.resolution.value.owner, expectedPreviousOwner) ||
    !sameSourceFingerprint(
      input.resolution.value.sourceFingerprint,
      input.stage.value.sourceFingerprint,
    ) ||
    Date.parse(input.resolution.value.createdAt) <
      Date.parse(
        input.previous?.value.createdAt ?? input.stage.value.createdAt,
      )
  ) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      "The fresh 0016 readback resolution chain is not exact, readback-only, and contiguous.",
    );
  }
}

function validateStageOwnershipBindings(
  stages: readonly HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>[],
  leases: readonly HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease>[],
  resolutions: readonly HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution>[],
  issues: HistoricalFresh0016StateIssue[],
) {
  const latestLeaseByStage = new Map<
    HistoricalFresh0016StateStage,
    HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateResumeLease>
  >();
  for (const lease of leases) {
    latestLeaseByStage.set(lease.value.stage, lease);
  }
  const latestResolutionByStage = new Map<
    HistoricalFresh0016StateStage,
    HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateReadbackResolution>
  >();
  for (const resolution of resolutions) {
    latestResolutionByStage.set(resolution.value.stage, resolution);
  }
  for (const [index, stage] of stages.entries()) {
    const previous = index > 0 ? stages[index - 1] : undefined;
    const latestLease = previous
      ? latestLeaseByStage.get(previous.value.stage)
      : undefined;
    const latestResolution = previous
      ? latestResolutionByStage.get(previous.value.stage)
      : undefined;
    const expectedLeaseSha256 = latestLease?.sha256 ?? null;
    const expectedResolutionSha256 = latestResolution?.sha256 ?? null;
    const expectedOwner =
      latestResolution?.value.owner ??
      latestLease?.value.owner ??
      previous?.value.owner;
    if (
      stage.value.resumeLeaseSha256 !== expectedLeaseSha256 ||
      stage.value.readbackResolutionSha256 !==
        expectedResolutionSha256 ||
      (expectedOwner && !sameOwner(stage.value.owner, expectedOwner))
    ) {
      issues.push({
        code: "BROKEN_CHAIN",
        detail: `Fresh 0016 stage ${stage.value.stage} does not bind the exact predecessor ownership records and controlling owner.`,
      });
    }
  }
}

function writeExclusiveCanonicalFile<T>(
  file: string,
  value: T,
  schema: z.ZodType<T>,
  maximumBytes: number,
  label: string,
): HistoricalFresh0016StateFileHandle<T> {
  const parsed = parseSchema(schema, value, label);
  const bytes = Buffer.from(
    `${canonicalHistoricalFresh0016Json(parsed)}\n`,
    "utf8",
  );
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The ${label} exceeds its bounded evidence size.`,
    );
  }
  const directory = path.dirname(file);
  const directoryIdentity = assertPrivateDirectory(directory);
  assertDirectDescendant(directory, path.resolve(file), label);
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
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw stateError(
        "STATE_CONFLICT",
        `The ${label} already exists and cannot be replaced.`,
      );
    }
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} could not be created exclusively.`,
    );
  }
  let failure: unknown;
  try {
    fs.fchmodSync(descriptor, 0o600);
    const before = fs.fstatSync(descriptor);
    assertPrivateRegularFileStat(before, 0, label);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateRegularFileStat(after, bytes.byteLength, label);
    if (!sameFileIdentity(statIdentity(before), statIdentity(after))) {
      throw stateError(
        "STATE_FILE_UNSAFE",
        `The ${label} inode changed while it was written.`,
      );
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} write was interrupted and remains fail-closed.`,
    );
  }
  fsyncDirectory(directory);
  assertSameDirectoryIdentity(directory, directoryIdentity);
  const readback = readCanonicalFile(
    file,
    schema,
    maximumBytes,
    label,
  );
  const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
  if (readback.sha256 !== expectedSha256) {
    throw stateError(
      "STATE_CHAIN_BROKEN",
      `The ${label} failed exact durable readback.`,
    );
  }
  return readback;
}

function readCanonicalFile<T>(
  file: string,
  schema: z.ZodType<T>,
  maximumBytes: number,
  label: string,
): HistoricalFresh0016StateFileHandle<T> {
  const absolute = path.resolve(file);
  assertDirectDescendant(path.dirname(absolute), absolute, label);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} is missing, linked, or unreadable.`,
    );
  }
  let before: fs.Stats;
  let after: fs.Stats;
  let bytes: Buffer;
  try {
    before = fs.fstatSync(descriptor);
    assertPrivateRegularFileStat(before, undefined, label, maximumBytes);
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (
    !sameFileIdentity(statIdentity(before), statIdentity(after)) ||
    before.size !== after.size ||
    bytes.byteLength !== before.size
  ) {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} changed while it was read.`,
    );
  }
  const pathStat = safeLstat(absolute, label);
  assertPrivateRegularFileStat(pathStat, bytes.byteLength, label, maximumBytes);
  if (!sameFileIdentity(statIdentity(after), statIdentity(pathStat))) {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} path changed while it was read.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The ${label} is not valid JSON.`,
    );
  }
  const parsed = parseSchema(schema, raw, label);
  const canonicalBytes = Buffer.from(
    `${canonicalHistoricalFresh0016Json(parsed)}\n`,
    "utf8",
  );
  if (!bytes.equals(canonicalBytes)) {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The ${label} bytes are not canonical.`,
    );
  }
  const immutableValue = deepFreeze(parsed);
  return Object.freeze({
    path: absolute,
    value: immutableValue,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    identity: Object.freeze(statIdentity(after)),
  });
}

function readImmutableAuxiliaryFile(
  file: string,
  name: string,
  maximumBytes: number,
  label: string,
): HistoricalFresh0016StateAuxiliaryFileHandle {
  const absolute = path.resolve(file);
  assertDirectDescendant(path.dirname(absolute), absolute, label);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} is missing, linked, or unreadable.`,
    );
  }
  let before: fs.Stats;
  let after: fs.Stats;
  let bytes: Buffer;
  try {
    before = fs.fstatSync(descriptor);
    assertPrivateRegularFileStat(before, undefined, label, maximumBytes);
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (
    !sameFileIdentity(statIdentity(before), statIdentity(after)) ||
    before.size !== after.size ||
    bytes.byteLength !== before.size
  ) {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} changed while it was read.`,
    );
  }
  const pathStat = safeLstat(absolute, label);
  assertPrivateRegularFileStat(pathStat, bytes.byteLength, label, maximumBytes);
  if (!sameFileIdentity(statIdentity(after), statIdentity(pathStat))) {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} path changed while it was read.`,
    );
  }
  return Object.freeze({
    name,
    path: absolute,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    identity: Object.freeze(statIdentity(after)),
  });
}

function ensurePrivateDirectoryComponent(parent: string, child: string) {
  assertDirectDescendant(parent, child, "policy directory component");
  const parentIdentity = assertPrivateDirectory(parent);
  try {
    fs.mkdirSync(child, { mode: 0o700 });
    fsyncDirectory(parent);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      throw stateError(
        "STATE_DIRECTORY_UNSAFE",
        "A fresh 0016 policy directory component could not be created safely.",
      );
    }
  }
  assertSameDirectoryIdentity(parent, parentIdentity);
  assertPrivateDirectory(child);
  const canonical = safeRealpath(child, "policy directory component");
  if (canonical !== path.resolve(child)) {
    throw stateError(
      "STATE_PATH_UNSAFE",
      "A fresh 0016 policy directory component is linked or noncanonical.",
    );
  }
}

function canonicalPrivateDirectory(directory: string, label: string) {
  const requestedIdentity = assertPrivateDirectory(directory);
  const canonical = safeRealpath(path.resolve(directory), label);
  const canonicalIdentity = assertPrivateDirectory(canonical);
  if (!sameFileIdentity(requestedIdentity, canonicalIdentity)) {
    throw stateError(
      "STATE_PATH_UNSAFE",
      `The fresh 0016 ${label} changed while it was canonicalized.`,
    );
  }
  return canonical;
}

function assertPrivateDirectory(directory: string) {
  const absolute = path.resolve(directory);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw stateError(
      "STATE_DIRECTORY_UNSAFE",
      "Fresh 0016 state directories must be real owner-only mode-0700 directories.",
    );
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw stateError(
        "STATE_DIRECTORY_UNSAFE",
        "Fresh 0016 state directories must be real owner-only mode-0700 directories.",
      );
    }
    return statIdentity(stat);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSameDirectoryIdentity(
  directory: string,
  expected: Readonly<{ device: number; inode: number }>,
) {
  const current = assertPrivateDirectory(directory);
  if (!sameFileIdentity(current, expected)) {
    throw stateError(
      "STATE_DIRECTORY_UNSAFE",
      "A fresh 0016 state directory changed during an operation.",
    );
  }
}

function assertPrivateRegularFileStat(
  stat: fs.Stats,
  expectedBytes: number | undefined,
  label: string,
  maximumBytes = MAXIMUM_STATE_FILE_BYTES,
) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    stat.size < 0 ||
    stat.size > maximumBytes ||
    (expectedBytes !== undefined && stat.size !== expectedBytes)
  ) {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The ${label} has unsafe ownership, mode, type, link count, or size.`,
    );
  }
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(
    path.resolve(directory),
    fs.constants.O_RDONLY |
      fs.constants.O_DIRECTORY |
      fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function safeRealpath(file: string, label: string) {
  try {
    return fs.realpathSync.native(file);
  } catch {
    throw stateError(
      "STATE_PATH_UNSAFE",
      `The fresh 0016 ${label} cannot be resolved safely.`,
    );
  }
}

function safeLstat(file: string, label: string) {
  try {
    return fs.lstatSync(file);
  } catch {
    throw stateError(
      "STATE_FILE_UNSAFE",
      `The fresh 0016 ${label} cannot be inspected safely.`,
    );
  }
}

function assertDirectDescendant(parent: string, child: string, label: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep)
  ) {
    throw stateError(
      "STATE_PATH_UNSAFE",
      `The fresh 0016 ${label} must be one exact path component below its parent.`,
    );
  }
}

function assertContainedPath(parent: string, child: string, label: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw stateError(
      "STATE_PATH_UNSAFE",
      `The fresh 0016 ${label} must remain below its exact parent.`,
    );
  }
}

function priorStage(
  stage: HistoricalFresh0016StateStage,
): HistoricalFresh0016StateStage | null {
  const index = HISTORICAL_FRESH_0016_STATE_STAGES.indexOf(stage);
  return index > 0 ? HISTORICAL_FRESH_0016_STATE_STAGES[index - 1] ?? null : null;
}

function nextStage(
  stage: HistoricalFresh0016StateStage,
): HistoricalFresh0016StateStage | null {
  const index = HISTORICAL_FRESH_0016_STATE_STAGES.indexOf(stage);
  return HISTORICAL_FRESH_0016_STATE_STAGES[index + 1] ?? null;
}

function isUnresolvedAuthorizationStage(
  stage: HistoricalFresh0016StateStage,
) {
  return stage === "predecessor-authorized" ||
    stage === "migration-authorized" ||
    stage === "successor-authorized";
}

function resumeLeaseFileName(
  stage: HistoricalFresh0016StateStage,
  attempt: number,
) {
  return `resume-${stage}-${String(attempt).padStart(2, "0")}.json`;
}

function parseResumeLeaseFileName(fileName: string): {
  stage: HistoricalFresh0016StateStage;
  attempt: number;
} | null {
  for (const stage of HISTORICAL_FRESH_0016_STATE_STAGES) {
    const prefix = `resume-${stage}-`;
    if (!fileName.startsWith(prefix) || !fileName.endsWith(".json")) {
      continue;
    }
    const attemptText = fileName.slice(prefix.length, -".json".length);
    if (!/^\d{2}$/.test(attemptText)) return null;
    return { stage, attempt: Number.parseInt(attemptText, 10) };
  }
  return null;
}

function readbackResolutionFileName(
  stage: HistoricalFresh0016StateStage,
  attempt: number,
) {
  return `readback-resolution-${stage}-${String(attempt).padStart(2, "0")}.json`;
}

function parseReadbackResolutionFileName(fileName: string): {
  stage: HistoricalFresh0016StateStage;
  attempt: number;
} | null {
  for (const stage of HISTORICAL_FRESH_0016_STATE_STAGES) {
    const prefix = `readback-resolution-${stage}-`;
    if (!fileName.startsWith(prefix) || !fileName.endsWith(".json")) {
      continue;
    }
    const attemptText = fileName.slice(prefix.length, -".json".length);
    if (!/^\d{2}$/.test(attemptText)) return null;
    return { stage, attempt: Number.parseInt(attemptText, 10) };
  }
  return null;
}

function defaultOwnerExitProbe(owner: HistoricalFresh0016Owner) {
  if (owner.hostname !== os.hostname()) return false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return isNodeError(error) && error.code === "ESRCH";
  }
  return false;
}

function proveOwnerExit(
  owner: HistoricalFresh0016Owner,
  probe: (owner: HistoricalFresh0016Owner) => boolean,
) {
  if (owner.hostname !== os.hostname()) return false;
  try {
    return probe(owner) === true;
  } catch {
    return false;
  }
}

function currentOwner(): HistoricalFresh0016Owner {
  return Object.freeze({ hostname: os.hostname(), pid: process.pid });
}

function sameOwner(
  left: HistoricalFresh0016Owner,
  right: HistoricalFresh0016Owner,
) {
  return left.hostname === right.hostname && left.pid === right.pid;
}

function sameSourceFingerprint(
  left: HistoricalFresh0016SourceFingerprint,
  right: HistoricalFresh0016SourceFingerprint,
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function canonicalDate(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The fresh 0016 ${label} is invalid.`,
    );
  }
  return new Date(value.getTime());
}

function parseRunId(runId: string) {
  if (!uuidPattern.test(runId)) {
    throw stateError(
      "STATE_PATH_UNSAFE",
      "Fresh 0016 run IDs must be canonical UUIDs.",
    );
  }
  return runId;
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw stateError(
      "STATE_SCHEMA_INVALID",
      `The ${label} has invalid or non-exact schema.`,
    );
  }
  return parsed.data;
}

function isHistoricalFresh0016JsonObject(
  value: unknown,
): value is HistoricalFresh0016JsonObject {
  return isPlainRecord(value) &&
    Object.values(value).every(isHistoricalFresh0016JsonValue);
}

function isHistoricalFresh0016JsonValue(
  value: unknown,
): value is HistoricalFresh0016JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every(isHistoricalFresh0016JsonValue);
  }
  return isHistoricalFresh0016JsonObject(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function compareUnicodeCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function statIdentity(stat: fs.Stats) {
  return { device: stat.dev, inode: stat.ino };
}

function sameFileIdentity(
  left: Readonly<{ device: number; inode: number }>,
  right: Readonly<{ device: number; inode: number }>,
) {
  return left.device === right.device && left.inode === right.inode;
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown state error.";
  return message.slice(0, 1_000);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function stateError(
  code: HistoricalFresh0016StateErrorCode,
  message: string,
) {
  return new HistoricalFresh0016StateError(code, message);
}
