import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { cloudflareDir } from "./migration-config";

export const WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND =
  "inspir-worker-candidate-pre-activation-seal-v1" as const;
const WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_REPORT =
  "worker-candidate-pre-activation-seal.json" as const;
export const WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS =
  45 * 60 * 1_000;

const MAXIMUM_SEAL_BYTES = 512 * 1_024;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);
const workerVersionSchema = uuidSchema;
const gitObjectSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical ISO timestamp.");
const positiveIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const nonnegativeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a nonnegative safe integer.",
);

const gitIdentitySchema = z
  .object({
    head: gitObjectSchema,
    upstream: gitObjectSchema,
    upstreamRef: z.string().min(1).max(2_048),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.head !== value.upstream) {
      context.addIssue({
        code: "custom",
        message: "Pre-activation Git HEAD must equal its pushed upstream.",
      });
    }
  });

const artifactIdentitySchema = z
  .object({
    sourceFingerprintSha256: sha256Schema,
    sourceFingerprintFileCount: positiveIntegerSchema,
    workerSourceSha256: sha256Schema,
    wranglerConfigSha256: sha256Schema,
    assetManifestSha256: sha256Schema,
    assetManifestFileCount: positiveIntegerSchema,
    assetManifestBytes: positiveIntegerSchema,
  })
  .strict();

const evidenceFileBindingSchema = z
  .object({
    scope: z.enum(["backup", "workspace"]),
    absolutePath: z.string().min(1).max(8_192),
    bytes: positiveIntegerSchema,
    sha256: sha256Schema,
  })
  .strict();

export const workerCandidatePreActivationPrerequisitesSchema = z
  .object({
    vectorize: z
      .object({
        evidence: evidenceFileBindingSchema,
        createdAt: canonicalTimestampSchema,
        phase: z.literal("uploaded-inactive"),
        soleServingVersionId: workerVersionSchema,
        vectorCount: positiveIntegerSchema,
      })
      .strict(),
    topic: z
      .object({
        evidence: evidenceFileBindingSchema,
        createdAt: canonicalTimestampSchema,
        seedSha256: sha256Schema,
        verifiedTopics: positiveIntegerSchema,
        verifiedArchivedTopics: nonnegativeIntegerSchema,
      })
      .strict(),
    translation: z
      .object({
        evidence: evidenceFileBindingSchema,
        createdAt: canonicalTimestampSchema,
        method: z.enum(["read-only-drift", "atomic-repair"]),
        remoteQueries: positiveIntegerSchema,
        billedRowsRead: nonnegativeIntegerSchema,
        repairApplied: z.boolean(),
      })
      .strict(),
    runtimeMigrations0013To0016: z
      .object({
        evidence: evidenceFileBindingSchema,
        createdAt: canonicalTimestampSchema,
      })
      .strict(),
    runtimeMigration0017: z
      .object({
        evidence: evidenceFileBindingSchema,
        createdAt: canonicalTimestampSchema,
      })
      .strict(),
    fresh0016Cutover: z
      .object({
        evidence: evidenceFileBindingSchema,
        createdAt: canonicalTimestampSchema,
        cutoverRunId: uuidSchema,
        workerRelease: z
          .object({
            phase: z.literal("uploaded-inactive"),
            targetCandidateVersionId: workerVersionSchema,
            serviceBaselineVersionId: workerVersionSchema,
            uploadEvidenceSha256: sha256Schema,
          })
          .strict(),
        finalizationLiveTopologySha256: sha256Schema,
        serviceBaselineDeploymentId: uuidSchema,
        targetCandidateState: z.literal("absent"),
        predecessorPrerequisitesSha256: sha256Schema,
        continuityDecisionsSha256: sha256Schema,
        outboxRowsBeforeActivation: z.literal(0),
      })
      .strict(),
    semanticTranslations: z.union([
      z.object({
        releaseMode: z.literal("full-semantic"),
        evidence: evidenceFileBindingSchema,
        curatedTreeSha256: sha256Schema,
        semanticEvidenceSha256: sha256Schema,
      })
      .strict(),
      z.object({
        releaseMode: z.literal("staged-canonical-English-fallback"),
        sitePromotionMode: z.literal("none-current-availability"),
        attestationKind: z.literal(
          "inspir-current-translation-fallback-no-site-promotion-attestation-v1",
        ),
        evidence: evidenceFileBindingSchema,
        curatedTreeSha256: sha256Schema,
        inventoryEvidenceSha256: sha256Schema,
        availabilityManifestSha256: sha256Schema,
        localizedHtmlPathsSha256: sha256Schema,
        pendingLedgerSha256: sha256Schema,
      }).strict(),
      z.object({
        releaseMode: z.literal("staged-canonical-English-fallback"),
        sitePromotionMode: z.literal("afrikaans-finalized"),
        attestationKind: z.literal(
          "inspir-staged-translation-fallback-release-attestation-v1",
        ),
        evidence: evidenceFileBindingSchema,
        curatedTreeSha256: sha256Schema,
        semanticEvidenceSha256: sha256Schema,
        availabilityManifestSha256: sha256Schema,
        localizedHtmlPathsSha256: sha256Schema,
        pendingLedgerSha256: sha256Schema,
      }).strict(),
    ]),
  })
  .strict();

export type WorkerCandidatePreActivationPrerequisites = z.infer<
  typeof workerCandidatePreActivationPrerequisitesSchema
>;

const workerCandidatePreActivationSealSchema = z
  .object({
    kind: z.literal(WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND),
    schemaVersion: z.literal(1),
    phase: z.literal("candidate-staged"),
    createdAt: canonicalTimestampSchema,
    validUntil: canonicalTimestampSchema,
    maximumAgeMs: z.literal(
      WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS,
    ),
    backupDirectory: z.string().min(1).max(8_192),
    release: z
      .object({
        targetCandidateVersionId: workerVersionSchema,
        serviceBaselineVersionId: workerVersionSchema,
        uploadEvidenceSha256: sha256Schema,
        stagedEvidenceSha256: sha256Schema,
      })
      .strict(),
    git: gitIdentitySchema,
    artifacts: artifactIdentitySchema,
    preparation: z
      .object({
        sha256: sha256Schema,
        createdAt: canonicalTimestampSchema,
        validUntil: canonicalTimestampSchema,
      })
      .strict(),
    preflight: z
      .object({
        workerTopologyPhase: z.literal("candidate-staged"),
        createdAt: canonicalTimestampSchema,
        reportCanonicalSha256: sha256Schema,
        checksCanonicalSha256: sha256Schema,
        passedChecks: positiveIntegerSchema,
      })
      .strict(),
    versionOverrideSmoke: z
      .object({
        evidence: evidenceFileBindingSchema.extend({
          scope: z.literal("backup"),
        }),
        createdAt: canonicalTimestampSchema,
        validUntil: canonicalTimestampSchema,
        targetCandidateVersionId: workerVersionSchema,
        serviceBaselineVersionId: workerVersionSchema,
        uploadEvidenceSha256: sha256Schema,
        stagedEvidenceSha256: sha256Schema,
        stagedDeploymentId: uuidSchema,
        stagedTopologySha256: sha256Schema,
        unpinnedResponseSha256: sha256Schema,
        candidateResponseSha256: sha256Schema,
      })
      .strict(),
    prerequisites: workerCandidatePreActivationPrerequisitesSchema,
    prerequisitesSha256: sha256Schema,
    authorizationMaterialSha256: sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const createdAt = Date.parse(value.createdAt);
    const validUntil = Date.parse(value.validUntil);
    const expectedPrerequisitesSha256 = sha256(
      serializeJson(value.prerequisites),
    );
    const expectedAuthorizationMaterialSha256 = sha256(
      serializeJson({
        release: value.release,
        git: value.git,
        artifacts: value.artifacts,
        preparation: value.preparation,
        preflight: value.preflight,
        versionOverrideSmoke: value.versionOverrideSmoke,
        prerequisites: value.prerequisites,
        prerequisitesSha256: value.prerequisitesSha256,
      }),
    );
    const prerequisiteCreatedAt = [
      value.prerequisites.vectorize.createdAt,
      value.prerequisites.topic.createdAt,
      value.prerequisites.translation.createdAt,
      value.prerequisites.runtimeMigrations0013To0016.createdAt,
      value.prerequisites.runtimeMigration0017.createdAt,
      value.prerequisites.fresh0016Cutover.createdAt,
    ].map((timestamp) => Date.parse(timestamp));
    if (
      value.release.targetCandidateVersionId ===
        value.release.serviceBaselineVersionId ||
      validUntil !==
        createdAt + WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS ||
      Date.parse(value.preparation.createdAt) > createdAt ||
      Date.parse(value.preflight.createdAt) > createdAt ||
      Date.parse(value.versionOverrideSmoke.createdAt) > createdAt ||
      Date.parse(value.versionOverrideSmoke.validUntil) < validUntil ||
      Date.parse(value.preparation.validUntil) < validUntil ||
      value.versionOverrideSmoke.targetCandidateVersionId !==
        value.release.targetCandidateVersionId ||
      value.versionOverrideSmoke.serviceBaselineVersionId !==
        value.release.serviceBaselineVersionId ||
      value.versionOverrideSmoke.uploadEvidenceSha256 !==
        value.release.uploadEvidenceSha256 ||
      value.versionOverrideSmoke.stagedEvidenceSha256 !==
        value.release.stagedEvidenceSha256 ||
      value.prerequisites.fresh0016Cutover.workerRelease
        .targetCandidateVersionId !== value.release.targetCandidateVersionId ||
      value.prerequisites.fresh0016Cutover.workerRelease
        .serviceBaselineVersionId !== value.release.serviceBaselineVersionId ||
      value.prerequisites.fresh0016Cutover.workerRelease
        .uploadEvidenceSha256 !== value.release.uploadEvidenceSha256 ||
      value.prerequisitesSha256 !== expectedPrerequisitesSha256 ||
      value.authorizationMaterialSha256 !==
        expectedAuthorizationMaterialSha256 ||
      prerequisiteCreatedAt.some((timestamp) => timestamp > createdAt)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Pre-activation seal chronology, candidate identity, or preparation validity is inconsistent.",
      });
    }
  });

export type WorkerCandidatePreActivationSeal = z.infer<
  typeof workerCandidatePreActivationSealSchema
>;

export type WorkerCandidatePreActivationSealHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  value: WorkerCandidatePreActivationSeal;
}>;

export function workerCandidatePreActivationSealPath(backupDirectory: string) {
  return path.join(
    cloudflareDir(path.resolve(backupDirectory)),
    WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_REPORT,
  );
}

export function parseWorkerCandidatePreActivationSeal(
  value: unknown,
): WorkerCandidatePreActivationSeal {
  const parsed = workerCandidatePreActivationSealSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Worker candidate pre-activation seal has an invalid schema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function workerCandidatePreActivationSealSha256(value: unknown) {
  return sha256(canonicalSealBytes(value));
}

export function workerCandidatePreActivationCanonicalValueSha256(
  value: unknown,
) {
  return sha256(serializeJson(value));
}

export function writeWorkerCandidatePreActivationSeal(
  file: string,
  value: WorkerCandidatePreActivationSeal,
): WorkerCandidatePreActivationSealHandle {
  const absolute = path.resolve(file);
  const parsed = parseWorkerCandidatePreActivationSeal(value);
  const expected = workerCandidatePreActivationSealPath(
    parsed.backupDirectory,
  );
  if (absolute !== expected) {
    throw new Error(
      "Worker candidate pre-activation seal must use its canonical backup path.",
    );
  }
  assertPrivateDirectory(path.dirname(absolute));
  const bytes = canonicalSealBytes(parsed);
  const temporary = `${absolute}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.linkSync(temporary, absolute);
    fs.unlinkSync(temporary);
    const directoryDescriptor = fs.openSync(
      path.dirname(absolute),
      fs.constants.O_RDONLY,
    );
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    throw new Error(
      "Worker candidate pre-activation seal could not be published exclusively.",
      { cause: error },
    );
  }
  return readWorkerCandidatePreActivationSeal(absolute);
}

export function readWorkerCandidatePreActivationSeal(
  file: string,
): WorkerCandidatePreActivationSealHandle {
  const absolute = path.resolve(file);
  const bytes = readPrivateStableFile(absolute);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error("Worker candidate pre-activation seal is not valid JSON.", {
      cause: error,
    });
  }
  const parsed = parseWorkerCandidatePreActivationSeal(value);
  if (
    absolute !== workerCandidatePreActivationSealPath(parsed.backupDirectory) ||
    !bytes.equals(canonicalSealBytes(parsed))
  ) {
    throw new Error(
      "Worker candidate pre-activation seal is noncanonical or stored under the wrong path.",
    );
  }
  return Object.freeze({
    path: absolute,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    value: parsed,
  });
}

export function assertFileBackedWorkerCandidatePreActivationSealHandle(
  handle: WorkerCandidatePreActivationSealHandle,
  expectedPath: string,
) {
  const expected = path.resolve(expectedPath);
  if (path.resolve(handle.path) !== expected) {
    throw new Error(
      "Worker candidate pre-activation seal handle does not use its canonical path.",
    );
  }
  const persisted = readWorkerCandidatePreActivationSeal(expected);
  if (
    persisted.sha256 !== handle.sha256 ||
    persisted.bytes !== handle.bytes ||
    workerCandidatePreActivationSealSha256(handle.value) !== handle.sha256
  ) {
    throw new Error(
      "Worker candidate pre-activation seal handle is not the exact nofollow file-backed seal.",
    );
  }
  return persisted;
}

function canonicalSealBytes(value: unknown) {
  const parsed = parseWorkerCandidatePreActivationSeal(value);
  const bytes = Buffer.from(`${serializeJson(parsed)}\n`, "utf8");
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SEAL_BYTES) {
    throw new Error("Worker candidate pre-activation seal exceeds its size bound.");
  }
  return bytes;
}

function readPrivateStableFile(file: string) {
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new Error(
      `Worker candidate pre-activation seal must be a readable nofollow owner-only file: ${file}.`,
      { cause: error },
    );
  }
  try {
    const before = fs.fstatSync(descriptor);
    assertPrivateFile(before, file);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateFile(after, file);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      bytes.byteLength !== before.size ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAXIMUM_SEAL_BYTES
    ) {
      throw new Error(
        "Worker candidate pre-activation seal changed during its stable read.",
      );
    }
    let named: fs.Stats;
    try {
      named = fs.lstatSync(file);
    } catch (error) {
      throw new Error(
        "Worker candidate pre-activation seal path changed during its stable read.",
        { cause: error },
      );
    }
    assertPrivateFile(named, file);
    if (
      before.dev !== named.dev ||
      before.ino !== named.ino ||
      after.size !== named.size ||
      after.mtimeMs !== named.mtimeMs ||
      after.ctimeMs !== named.ctimeMs
    ) {
      throw new Error(
        "Worker candidate pre-activation seal path changed during its stable read.",
      );
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertPrivateFile(stat: fs.Stats, file: string) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(
      `Worker candidate pre-activation seal must be a one-link owner-only mode-0600 file: ${file}.`,
    );
  }
}

function assertPrivateDirectory(directory: string) {
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync.native(directory) !== path.resolve(directory) ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    (stat.mode & 0o022) !== 0
  ) {
    throw new Error(
      "Worker candidate pre-activation seal directory must be real, owned, and not group/world writable.",
    );
  }
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

function serializeJson(value: unknown): string {
  assertJsonValue(value);
  return serializeJsonValue(value);
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical pre-activation seal contains a non-finite number.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item);
    return;
  }
  if (typeof value !== "object") {
    throw new Error("Canonical pre-activation seal contains a non-JSON value.");
  }
  for (const item of Object.values(value)) assertJsonValue(item);
}

function serializeJsonValue(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("Canonical pre-activation seal value could not be serialized.");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJsonValue(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort(compareUnicodeCodePoints)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${serializeJsonValue(value[key] ?? null)}`,
    )
    .join(",")}}`;
}

function compareUnicodeCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
