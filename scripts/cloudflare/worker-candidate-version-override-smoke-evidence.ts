import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_KIND =
  "inspir-worker-candidate-version-override-smoke-v1" as const;
const WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_REPORT =
  "worker-candidate-version-override-smoke.json" as const;
export const WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS =
  60 * 60 * 1_000;
export const WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_INITIAL_FRESHNESS_MS =
  5 * 60 * 1_000;
export const WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS = 4;
export const WORKER_CANDIDATE_VERSION_OVERRIDE_PROPAGATION_DELAY_MS = 2_000;
export const WORKER_CANDIDATE_VERSION_OVERRIDE_HEALTH_URL =
  "https://inspirlearning.com/api/health" as const;

const MAXIMUM_EVIDENCE_BYTES = 512 * 1_024;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
);
const canonicalTimestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected a canonical ISO timestamp.");
const positiveIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);

const healthArchitectureSchema = z
  .object({
    deploymentMode: z.literal("free-static-native-accounts"),
    publicDocuments: z.literal("workers-static-assets"),
    workerCpuPlan: z.literal("free-10ms"),
    openNext: z.literal(false),
    accounts: z.literal(true),
    savedState: z.literal(true),
    memory: z.literal(true),
    admin: z.literal(true),
    games: z.literal(false),
  })
  .strict();

const healthObservationSchema = z
  .object({
    ok: z.literal(true),
    runtime: z.literal("cloudflare-workers"),
    versionId: uuidSchema,
    architecture: healthArchitectureSchema,
  })
  .strict();

const probeAttemptSchema = z
  .object({
    attempt: positiveIntegerSchema,
    pinned: z.boolean(),
    startedAt: canonicalTimestampSchema,
    completedAt: canonicalTimestampSchema,
    url: z.url(),
    request: z
      .object({
        overrideHeader: z.string().min(1).max(256).nullable(),
        requestHeadersSha256: sha256Schema,
      })
      .strict(),
    response: z
      .object({
        status: z.literal(200),
        contentType: z.string().min(1).max(256),
        cacheControl: z.string().min(1).max(512),
        cdnCacheControl: z.string().min(1).max(512),
        cloudflareCdnCacheControl: z.string().min(1).max(512).nullable(),
        pragma: z.string().min(1).max(128),
        delivery: z.literal("lean-api-worker"),
        responseBytes: positiveIntegerSchema,
        responseHeadersSha256: sha256Schema,
        responseBodySha256: sha256Schema,
        responseSha256: sha256Schema,
        health: healthObservationSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const startedAt = Date.parse(value.startedAt);
    const completedAt = Date.parse(value.completedAt);
    const url = new URL(value.url);
    const expectedRequestHeadersSha256 = canonicalJsonSha256(
      normalizedProbeRequestHeaders(value.request.overrideHeader),
    );
    const expectedResponseSha256 = canonicalJsonSha256({
      status: value.response.status,
      responseHeadersSha256: value.response.responseHeadersSha256,
      responseBodySha256: value.response.responseBodySha256,
    });
    if (
      completedAt < startedAt ||
      url.origin !== new URL(WORKER_CANDIDATE_VERSION_OVERRIDE_HEALTH_URL).origin ||
      url.pathname !== "/api/health" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.searchParams.size !== 1 ||
      !url.searchParams.has("candidate_override_probe") ||
      value.request.requestHeadersSha256 !== expectedRequestHeadersSha256 ||
      value.response.responseSha256 !== expectedResponseSha256 ||
      !isJsonContentType(value.response.contentType) ||
      !isPrivateNoStore(value.response.cacheControl) ||
      !hasNoStore(value.response.cdnCacheControl) ||
      (value.response.cloudflareCdnCacheControl !== null &&
        !hasNoStore(value.response.cloudflareCdnCacheControl)) ||
      value.response.pragma.trim().toLowerCase() !== "no-cache"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Version-override health probe chronology, request identity, response hashes, JSON, or private no-store policy is invalid.",
      });
    }
  });

export type WorkerCandidateVersionOverrideProbeAttempt = z.infer<
  typeof probeAttemptSchema
>;

export function parseWorkerCandidateVersionOverrideProbeAttempt(
  value: unknown,
): WorkerCandidateVersionOverrideProbeAttempt {
  const parsed = probeAttemptSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Worker candidate version-override probe has an invalid schema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

const workerCandidateVersionOverrideSmokeEvidenceSchema = z
  .object({
    kind: z.literal(WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_KIND),
    schemaVersion: z.literal(1),
    phase: z.literal("candidate-staged"),
    createdAt: canonicalTimestampSchema,
    validUntil: canonicalTimestampSchema,
    maximumAgeMs: z.literal(
      WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS,
    ),
    backupDirectory: z.string().min(1).max(8_192),
    workerName: z.literal("inspirlearning"),
    release: z
      .object({
        targetCandidateVersionId: uuidSchema,
        serviceBaselineVersionId: uuidSchema,
        uploadEvidenceSha256: sha256Schema,
        stagedEvidenceSha256: sha256Schema,
        stagedDeploymentId: uuidSchema,
        stagedTopologySha256: sha256Schema,
      })
      .strict(),
    endpoint: z.literal(WORKER_CANDIDATE_VERSION_OVERRIDE_HEALTH_URL),
    maximumPinnedAttempts: z.literal(
      WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS,
    ),
    propagationRetryDelayMs: z.literal(
      WORKER_CANDIDATE_VERSION_OVERRIDE_PROPAGATION_DELAY_MS,
    ),
    unpinned: probeAttemptSchema,
    pinnedAttempts: z
      .array(probeAttemptSchema)
      .min(1)
      .max(WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS),
    unpinnedResponseSha256: sha256Schema,
    candidateResponseSha256: sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const createdAt = Date.parse(value.createdAt);
    const validUntil = Date.parse(value.validUntil);
    const expectedOverride = workerVersionOverrideHeaderValue(
      value.release.targetCandidateVersionId,
    );
    const allAttempts = [value.unpinned, ...value.pinnedAttempts];
    const urls = allAttempts.map((attempt) => attempt.url);
    const finalPinned = value.pinnedAttempts.at(-1);
    const precedingPinned = value.pinnedAttempts.slice(0, -1);
    if (
      value.release.targetCandidateVersionId ===
        value.release.serviceBaselineVersionId ||
      validUntil !==
        createdAt + WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS ||
      value.unpinned.pinned ||
      value.unpinned.attempt !== 1 ||
      value.unpinned.request.overrideHeader !== null ||
      value.unpinned.response.health.versionId !==
        value.release.serviceBaselineVersionId ||
      value.unpinnedResponseSha256 !== value.unpinned.response.responseSha256 ||
      finalPinned === undefined ||
      finalPinned.response.health.versionId !==
        value.release.targetCandidateVersionId ||
      value.candidateResponseSha256 !== finalPinned?.response.responseSha256 ||
      precedingPinned.some(
        (attempt) =>
          attempt.response.health.versionId !==
          value.release.serviceBaselineVersionId,
      ) ||
      value.pinnedAttempts.some(
        (attempt, index) =>
          !attempt.pinned ||
          attempt.attempt !== index + 1 ||
          attempt.request.overrideHeader !== expectedOverride,
      ) ||
      new Set(urls).size !== urls.length ||
      allAttempts.some(
        (attempt) => Date.parse(attempt.completedAt) > createdAt,
      ) ||
      allAttempts.some(
        (attempt, index) =>
          index > 0 &&
          Date.parse(attempt.startedAt) <
            Date.parse(allAttempts[index - 1]?.completedAt ?? value.createdAt),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Version-override smoke evidence did not prove one unpinned baseline and a bounded exact pinned candidate sequence.",
      });
    }
  });

export type WorkerCandidateVersionOverrideSmokeEvidence = z.infer<
  typeof workerCandidateVersionOverrideSmokeEvidenceSchema
>;

export type WorkerCandidateVersionOverrideSmokeEvidenceHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  value: WorkerCandidateVersionOverrideSmokeEvidence;
}>;

export function workerCandidateVersionOverrideSmokeEvidencePath(
  backupDirectory: string,
) {
  return path.join(
    path.resolve(backupDirectory),
    "cloudflare",
    WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_REPORT,
  );
}

export function parseWorkerCandidateVersionOverrideSmokeEvidence(
  value: unknown,
): WorkerCandidateVersionOverrideSmokeEvidence {
  const parsed = workerCandidateVersionOverrideSmokeEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Worker candidate version-override smoke evidence has an invalid schema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function workerCandidateVersionOverrideSmokeEvidenceSha256(
  value: unknown,
) {
  return sha256(canonicalEvidenceBytes(value));
}

export function workerCandidateVersionOverrideCanonicalValueSha256(
  value: unknown,
) {
  return canonicalJsonSha256(value);
}

export function workerVersionOverrideHeaderValue(candidateVersionId: string) {
  const candidate = uuidSchema.parse(candidateVersionId);
  return `inspirlearning="${candidate}"`;
}

export function normalizedProbeRequestHeaders(
  overrideHeader: string | null,
) {
  return {
    accept: "application/json",
    cacheControl: "no-cache, no-store",
    pragma: "no-cache",
    userAgent: "inspir-candidate-override-smoke/1",
    workerVersionOverride: overrideHeader,
  } as const;
}

export function writeWorkerCandidateVersionOverrideSmokeEvidence(
  file: string,
  value: WorkerCandidateVersionOverrideSmokeEvidence,
): WorkerCandidateVersionOverrideSmokeEvidenceHandle {
  const absolute = path.resolve(file);
  const parsed = parseWorkerCandidateVersionOverrideSmokeEvidence(value);
  const expected = workerCandidateVersionOverrideSmokeEvidencePath(
    parsed.backupDirectory,
  );
  if (absolute !== expected) {
    throw new Error(
      "Worker candidate version-override smoke evidence must use its canonical backup path.",
    );
  }
  const directory = path.dirname(absolute);
  assertPrivateDirectory(directory);
  const bytes = canonicalEvidenceBytes(parsed);
  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${process.pid}.${randomBytes(16).toString("hex")}.tmp`,
  );
  let descriptor: number | null = null;
  let published = false;
  let publicationIdentity: Readonly<{ dev: number; ino: number }> | null = null;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const temporaryStat = fs.fstatSync(descriptor);
    assertPrivateFile(temporaryStat, temporary, bytes.byteLength);
    publicationIdentity = {
      dev: temporaryStat.dev,
      ino: temporaryStat.ino,
    };
    fs.closeSync(descriptor);
    descriptor = null;
    fs.linkSync(temporary, absolute);
    published = true;
    fs.unlinkSync(temporary);
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the publication failure.
      }
    }
    fs.rmSync(temporary, { force: true });
    if (
      published &&
      publicationIdentity !== null &&
      removePublishedFileIfExact(absolute, publicationIdentity)
    ) {
      fsyncDirectory(directory);
    }
    throw new Error(
      "Worker candidate version-override smoke evidence could not be published exclusively.",
      { cause: error },
    );
  }
  return readWorkerCandidateVersionOverrideSmokeEvidence(absolute);
}

function removePublishedFileIfExact(
  file: string,
  identity: Readonly<{ dev: number; ino: number }>,
) {
  let named: fs.Stats;
  try {
    named = fs.lstatSync(file);
  } catch {
    return false;
  }
  if (
    !named.isFile() ||
    named.isSymbolicLink() ||
    named.dev !== identity.dev ||
    named.ino !== identity.ino
  ) {
    return false;
  }
  fs.unlinkSync(file);
  return true;
}

export function readWorkerCandidateVersionOverrideSmokeEvidence(
  file: string,
): WorkerCandidateVersionOverrideSmokeEvidenceHandle {
  const absolute = path.resolve(file);
  const bytes = readPrivateStableFile(absolute);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(
      "Worker candidate version-override smoke evidence is not valid JSON.",
      { cause: error },
    );
  }
  const value = parseWorkerCandidateVersionOverrideSmokeEvidence(raw);
  if (
    absolute !== workerCandidateVersionOverrideSmokeEvidencePath(
      value.backupDirectory,
    ) ||
    !bytes.equals(canonicalEvidenceBytes(value))
  ) {
    throw new Error(
      "Worker candidate version-override smoke evidence is noncanonical or stored under the wrong path.",
    );
  }
  return Object.freeze({
    path: absolute,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    value,
  });
}

export function assertFileBackedWorkerCandidateVersionOverrideSmokeEvidence(
  handle: WorkerCandidateVersionOverrideSmokeEvidenceHandle,
  expectedPath: string,
) {
  const expected = path.resolve(expectedPath);
  if (path.resolve(handle.path) !== expected) {
    throw new Error(
      "Worker candidate version-override smoke evidence handle does not use its canonical path.",
    );
  }
  const persisted = readWorkerCandidateVersionOverrideSmokeEvidence(expected);
  if (
    persisted.sha256 !== handle.sha256 ||
    persisted.bytes !== handle.bytes ||
    workerCandidateVersionOverrideSmokeEvidenceSha256(handle.value) !==
      handle.sha256
  ) {
    throw new Error(
      "Worker candidate version-override smoke evidence handle is not the exact nofollow file-backed report.",
    );
  }
  return persisted;
}

function canonicalEvidenceBytes(value: unknown) {
  const parsed = parseWorkerCandidateVersionOverrideSmokeEvidence(value);
  const bytes = Buffer.from(`${canonicalJson(parsed)}\n`, "utf8");
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_EVIDENCE_BYTES) {
    throw new Error(
      "Worker candidate version-override smoke evidence exceeds its bounded size.",
    );
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
      `Worker candidate version-override smoke evidence must be a readable nofollow owner-only file: ${file}.`,
      { cause: error },
    );
  }
  try {
    const before = fs.fstatSync(descriptor);
    assertPrivateFile(before, file);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateFile(after, file, bytes.byteLength);
    if (!sameStableFile(before, after) || bytes.byteLength !== before.size) {
      throw new Error(
        "Worker candidate version-override smoke evidence changed during its stable read.",
      );
    }
    let named: fs.Stats;
    try {
      named = fs.lstatSync(file);
    } catch (error) {
      throw new Error(
        "Worker candidate version-override smoke evidence path changed during its stable read.",
        { cause: error },
      );
    }
    assertPrivateFile(named, file, bytes.byteLength);
    if (!sameStableFile(after, named)) {
      throw new Error(
        "Worker candidate version-override smoke evidence path changed during its stable read.",
      );
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertPrivateFile(
  stat: fs.Stats,
  file: string,
  expectedBytes?: number,
) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    !Number.isSafeInteger(stat.size) ||
    stat.size <= 0 ||
    stat.size > MAXIMUM_EVIDENCE_BYTES ||
    (expectedBytes !== undefined && stat.size !== expectedBytes)
  ) {
    throw new Error(
      `Worker candidate version-override smoke evidence must be a bounded one-link owner-only mode-0600 file: ${file}.`,
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
      "Worker candidate version-override smoke evidence directory must be real, owned, and not group/world writable.",
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
    left.nlink === right.nlink
  );
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function isJsonContentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isPrivateNoStore(value: string) {
  const directives = cacheDirectiveNames(value);
  return (
    directives.has("private") &&
    directives.has("no-store") &&
    !directives.has("public")
  );
}

function hasNoStore(value: string) {
  return cacheDirectiveNames(value).has("no-store");
}

function cacheDirectiveNames(value: string) {
  return new Set(
    value
    .split(",")
      .map((item) => item.split("=", 1)[0]?.trim().toLowerCase() ?? "")
      .filter(Boolean),
  );
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJsonSha256(value: unknown) {
  return sha256(canonicalJson(value));
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

function canonicalJson(value: unknown): string {
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
      throw new Error(
        "Canonical version-override smoke evidence contains a non-finite number.",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item);
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(
      "Canonical version-override smoke evidence contains a non-JSON value.",
    );
  }
  for (const item of Object.values(value)) assertJsonValue(item);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeJsonValue(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error(
        "Canonical version-override smoke evidence could not be serialized.",
      );
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
