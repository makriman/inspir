import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readWorkerCandidateStagedEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateStagedEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
} from "./worker-candidate-release-evidence";
import {
  WORKER_CANDIDATE_VERSION_OVERRIDE_HEALTH_URL,
  WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS,
  WORKER_CANDIDATE_VERSION_OVERRIDE_PROPAGATION_DELAY_MS,
  WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_INITIAL_FRESHNESS_MS,
  WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_KIND,
  WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS,
  normalizedProbeRequestHeaders,
  parseWorkerCandidateVersionOverrideProbeAttempt,
  parseWorkerCandidateVersionOverrideSmokeEvidence,
  readWorkerCandidateVersionOverrideSmokeEvidence,
  workerCandidateVersionOverrideCanonicalValueSha256,
  workerCandidateVersionOverrideSmokeEvidencePath,
  workerVersionOverrideHeaderValue,
  writeWorkerCandidateVersionOverrideSmokeEvidence,
  type WorkerCandidateVersionOverrideProbeAttempt,
  type WorkerCandidateVersionOverrideSmokeEvidenceHandle,
} from "./worker-candidate-version-override-smoke-evidence";
import { resolveBackupDir } from "./migration-config";

export {
  WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_INITIAL_FRESHNESS_MS,
  WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS,
  readWorkerCandidateVersionOverrideSmokeEvidence,
  workerCandidateVersionOverrideSmokeEvidencePath,
  type WorkerCandidateVersionOverrideSmokeEvidence,
  type WorkerCandidateVersionOverrideSmokeEvidenceHandle,
} from "./worker-candidate-version-override-smoke-evidence";

const MAXIMUM_HEALTH_RESPONSE_BYTES = 64 * 1_024;
const REQUEST_TIMEOUT_MS = 15_000;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type WorkerCandidateVersionOverrideSmokeDependencies = Readonly<{
  fetch: FetchLike;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  nonce: () => string;
}>;

export type CreateWorkerCandidateVersionOverrideSmokeOptions = Readonly<{
  backupDirectory?: string;
  dependencies?: Partial<WorkerCandidateVersionOverrideSmokeDependencies>;
}>;

export type ValidateWorkerCandidateVersionOverrideSmokeOptions = Readonly<{
  backupDirectory?: string;
  now?: Date;
  maximumAgeMs?: number;
  uploadHandle?: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  stagedHandle?: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
}>;

const defaultDependencies: WorkerCandidateVersionOverrideSmokeDependencies = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
  nonce: () => randomBytes(16).toString("hex"),
};

export async function createWorkerCandidateVersionOverrideSmokeEvidence(
  options: CreateWorkerCandidateVersionOverrideSmokeOptions = {},
): Promise<WorkerCandidateVersionOverrideSmokeEvidenceHandle> {
  const backupDirectory = path.resolve(
    options.backupDirectory ?? resolveBackupDir(),
  );
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const evidencePath = workerCandidateVersionOverrideSmokeEvidencePath(
    backupDirectory,
  );
  assertCanonicalPathAbsent(
    evidencePath,
    "Version-override smoke evidence already exists and cannot be replaced.",
  );
  const release = readExactStagedRelease(backupDirectory);
  assertWorkerCandidateActivationEvidenceAbsent(backupDirectory);

  const unpinned = await captureHealthProbe({
    attempt: 1,
    expectedOverride: null,
    dependencies,
  });
  if (
    unpinned.response.health.versionId !==
    release.upload.value.serviceBaselineVersionId
  ) {
    throw new Error(
      "Unpinned Worker health did not report the exact staged service baseline.",
    );
  }

  const overrideHeader = workerVersionOverrideHeaderValue(
    release.upload.value.targetCandidateVersionId,
  );
  const pinnedAttempts: WorkerCandidateVersionOverrideProbeAttempt[] = [];
  for (
    let attempt = 1;
    attempt <= WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS;
    attempt += 1
  ) {
    const probe = await captureHealthProbe({
      attempt,
      expectedOverride: overrideHeader,
      dependencies,
    });
    pinnedAttempts.push(probe);
    const observed = probe.response.health.versionId;
    if (observed === release.upload.value.targetCandidateVersionId) break;
    if (observed !== release.upload.value.serviceBaselineVersionId) {
      throw new Error(
        "Pinned Worker health returned a wrong Worker UUID instead of the exact candidate or baseline.",
      );
    }
    if (attempt === WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS) {
      throw new Error(
        "Cloudflare ignored the Worker version override or the staged candidate did not propagate within the bounded retry window.",
      );
    }
    await dependencies.sleep(
      WORKER_CANDIDATE_VERSION_OVERRIDE_PROPAGATION_DELAY_MS,
    );
  }

  const candidate = pinnedAttempts.at(-1);
  if (
    candidate === undefined ||
    candidate.response.health.versionId !==
      release.upload.value.targetCandidateVersionId
  ) {
    throw new Error(
      "Pinned Worker health did not prove the exact target candidate UUID.",
    );
  }

  const completedAt = readClock(dependencies.now, "smoke completion");
  if (
    Date.parse(completedAt) < Date.parse(unpinned.completedAt) ||
    Date.parse(completedAt) < Date.parse(candidate.completedAt)
  ) {
    throw new Error(
      "Worker candidate version-override smoke clock moved backwards.",
    );
  }

  // Fence the entire HTTP interval with exact immutable local release evidence.
  const finalRelease = readExactStagedRelease(backupDirectory);
  if (
    finalRelease.upload.sha256 !== release.upload.sha256 ||
    finalRelease.staged.sha256 !== release.staged.sha256
  ) {
    throw new Error(
      "Worker candidate upload or staged topology evidence changed during the version-override smoke.",
    );
  }
  assertWorkerCandidateActivationEvidenceAbsent(backupDirectory);

  const validUntil = new Date(
    Date.parse(completedAt) +
      WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS,
  ).toISOString();
  const value = parseWorkerCandidateVersionOverrideSmokeEvidence({
    kind: WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_KIND,
    schemaVersion: 1,
    phase: "candidate-staged",
    createdAt: completedAt,
    validUntil,
    maximumAgeMs: WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS,
    backupDirectory,
    workerName: "inspirlearning",
    release: {
      targetCandidateVersionId:
        release.upload.value.targetCandidateVersionId,
      serviceBaselineVersionId:
        release.upload.value.serviceBaselineVersionId,
      uploadEvidenceSha256: release.upload.sha256,
      stagedEvidenceSha256: release.staged.sha256,
      stagedDeploymentId: release.staged.value.topology.deploymentId,
      stagedTopologySha256:
        workerCandidateVersionOverrideCanonicalValueSha256(
          release.staged.value.topology,
        ),
    },
    endpoint: WORKER_CANDIDATE_VERSION_OVERRIDE_HEALTH_URL,
    maximumPinnedAttempts:
      WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS,
    propagationRetryDelayMs:
      WORKER_CANDIDATE_VERSION_OVERRIDE_PROPAGATION_DELAY_MS,
    unpinned,
    pinnedAttempts,
    unpinnedResponseSha256: unpinned.response.responseSha256,
    candidateResponseSha256: candidate.response.responseSha256,
  });
  return writeWorkerCandidateVersionOverrideSmokeEvidence(evidencePath, value);
}

export function readAndValidateWorkerCandidateVersionOverrideSmokeEvidence(
  options: ValidateWorkerCandidateVersionOverrideSmokeOptions = {},
): WorkerCandidateVersionOverrideSmokeEvidenceHandle {
  const backupDirectory = path.resolve(
    options.backupDirectory ?? resolveBackupDir(),
  );
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Worker candidate version-override validation clock is invalid.");
  }
  const maximumAgeMs =
    options.maximumAgeMs ??
    WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS;
  if (
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs <= 0 ||
    maximumAgeMs > WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_MAX_AGE_MS
  ) {
    throw new Error(
      "Worker candidate version-override freshness bound is invalid.",
    );
  }
  const release = readExactStagedRelease(backupDirectory);
  assertOptionalReleaseHandle(
    options.uploadHandle,
    release.upload,
    "upload",
  );
  assertOptionalReleaseHandle(
    options.stagedHandle,
    release.staged,
    "staged",
  );
  assertWorkerCandidateActivationEvidenceAbsent(backupDirectory);
  const handle = readWorkerCandidateVersionOverrideSmokeEvidence(
    workerCandidateVersionOverrideSmokeEvidencePath(backupDirectory),
  );
  const value = handle.value;
  const createdAtMs = Date.parse(value.createdAt);
  const validUntilMs = Date.parse(value.validUntil);
  const ageMs = now.getTime() - createdAtMs;
  if (
    value.backupDirectory !== backupDirectory ||
    value.release.targetCandidateVersionId !==
      release.upload.value.targetCandidateVersionId ||
    value.release.serviceBaselineVersionId !==
      release.upload.value.serviceBaselineVersionId ||
    value.release.uploadEvidenceSha256 !== release.upload.sha256 ||
    value.release.stagedEvidenceSha256 !== release.staged.sha256 ||
    value.release.stagedDeploymentId !==
      release.staged.value.topology.deploymentId ||
    value.release.stagedTopologySha256 !==
      workerCandidateVersionOverrideCanonicalValueSha256(
        release.staged.value.topology,
      ) ||
    createdAtMs < Date.parse(release.staged.value.createdAt) ||
    ageMs < 0 ||
    ageMs > maximumAgeMs ||
    now.getTime() > validUntilMs
  ) {
    throw new Error(
      "Worker candidate version-override smoke evidence is stale or drifted from the exact staged release topology.",
    );
  }
  const finalRelease = readExactStagedRelease(backupDirectory);
  if (
    finalRelease.upload.sha256 !== release.upload.sha256 ||
    finalRelease.staged.sha256 !== release.staged.sha256
  ) {
    throw new Error(
      "Worker candidate staged release evidence changed while the override smoke was read.",
    );
  }
  assertWorkerCandidateActivationEvidenceAbsent(backupDirectory);
  return handle;
}

export function assertWorkerCandidateVersionOverrideSmokeInitiallyFresh(
  handle: WorkerCandidateVersionOverrideSmokeEvidenceHandle,
  now: Date,
) {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Worker candidate version-override freshness clock is invalid.");
  }
  const ageMs = now.getTime() - Date.parse(handle.value.createdAt);
  if (
    ageMs < 0 ||
    ageMs > WORKER_CANDIDATE_VERSION_OVERRIDE_SMOKE_INITIAL_FRESHNESS_MS
  ) {
    throw new Error(
      "Pre-activation seal requires a newly completed Worker version-override smoke.",
    );
  }
  return handle;
}

function assertWorkerCandidateActivationEvidenceAbsent(
  backupDirectory: string,
) {
  const activationPath = workerCandidateActivationEvidencePath(
    path.resolve(backupDirectory),
  );
  try {
    fs.lstatSync(activationPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw new Error(
      "Worker candidate activation evidence absence could not be established.",
      { cause: error },
    );
  }
  throw new Error(
    "Worker candidate version-override smoke requires activation evidence to be absent.",
  );
}

async function captureHealthProbe(input: {
  attempt: number;
  expectedOverride: string | null;
  dependencies: WorkerCandidateVersionOverrideSmokeDependencies;
}): Promise<WorkerCandidateVersionOverrideProbeAttempt> {
  const nonce = input.dependencies.nonce();
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("Version-override smoke nonce must be 128 bits of lowercase hex.");
  }
  const url = new URL(WORKER_CANDIDATE_VERSION_OVERRIDE_HEALTH_URL);
  url.searchParams.set(
    "candidate_override_probe",
    `${input.expectedOverride === null ? "baseline" : `candidate-${input.attempt}`}-${nonce}`,
  );
  const normalizedRequestHeaders = normalizedProbeRequestHeaders(
    input.expectedOverride,
  );
  const headers = new Headers({
    accept: normalizedRequestHeaders.accept,
    "cache-control": normalizedRequestHeaders.cacheControl,
    pragma: normalizedRequestHeaders.pragma,
    "user-agent": normalizedRequestHeaders.userAgent,
  });
  if (input.expectedOverride !== null) {
    headers.set(
      "Cloudflare-Workers-Version-Overrides",
      input.expectedOverride,
    );
  }
  const startedAt = readClock(input.dependencies.now, "probe start");
  let response: Response;
  try {
    response = await input.dependencies.fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      "Worker candidate version-override health request failed; transport failures are not propagation retries.",
      { cause: error },
    );
  }
  if (response.redirected || response.status !== 200) {
    throw new Error(
      "Worker candidate version-override health request did not return one direct HTTP 200 response.",
    );
  }
  const responseHeaders = [...response.headers.entries()].sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  );
  const contentType = response.headers.get("content-type") ?? "";
  const cacheControl = response.headers.get("cache-control") ?? "";
  const cdnCacheControl = response.headers.get("cdn-cache-control") ?? "";
  const cloudflareCdnCacheControl = response.headers.get(
    "cloudflare-cdn-cache-control",
  );
  const pragma = response.headers.get("pragma") ?? "";
  const delivery = response.headers.get("x-inspir-delivery");
  const body = await readBoundedResponseBody(response);
  const completedAt = readClock(input.dependencies.now, "probe completion");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("Worker candidate version-override probe clock moved backwards.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (error) {
    throw new Error(
      "Worker candidate version-override health response is not bounded valid UTF-8 JSON.",
      { cause: error },
    );
  }
  const health = parseLeanNativeHealth(raw);
  const responseHeadersSha256 =
    workerCandidateVersionOverrideCanonicalValueSha256(responseHeaders);
  const responseBodySha256 = sha256(body);
  const responseSha256 =
    workerCandidateVersionOverrideCanonicalValueSha256({
      status: response.status,
      responseHeadersSha256,
      responseBodySha256,
    });
  return parseWorkerCandidateVersionOverrideProbeAttempt({
    attempt: input.attempt,
    pinned: input.expectedOverride !== null,
    startedAt,
    completedAt,
    url: url.toString(),
    request: {
      overrideHeader: input.expectedOverride,
      requestHeadersSha256:
        workerCandidateVersionOverrideCanonicalValueSha256(
          normalizedRequestHeaders,
        ),
    },
    response: {
      status: 200,
      contentType,
      cacheControl,
      cdnCacheControl,
      cloudflareCdnCacheControl,
      pragma,
      delivery: requireExactDelivery(delivery),
      responseBytes: body.byteLength,
      responseHeadersSha256,
      responseBodySha256,
      responseSha256,
      health,
    },
  });
}

async function readBoundedResponseBody(response: Response) {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAXIMUM_HEALTH_RESPONSE_BYTES
    ) {
      throw new Error(
        "Worker candidate health response Content-Length is invalid or unbounded.",
      );
    }
  }
  if (response.body === null) {
    throw new Error("Worker candidate health response has no JSON body.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAXIMUM_HEALTH_RESPONSE_BYTES) {
        await reader.cancel(
          "Worker candidate health response exceeded its bounded size.",
        );
        throw new Error(
          "Worker candidate health response exceeded its bounded size.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes <= 0) {
    throw new Error("Worker candidate health response body is empty.");
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function parseLeanNativeHealth(value: unknown) {
  const root = requireRecord(value, "Worker candidate health response");
  const version = requireRecord(root.version, "Worker candidate health version");
  const architecture = requireRecord(
    root.architecture,
    "Worker candidate health architecture",
  );
  const versionId = requireUuid(version.id, "Worker candidate health version ID");
  if (
    root.ok !== true ||
    root.runtime !== "cloudflare-workers" ||
    architecture.deploymentMode !== "free-static-native-accounts" ||
    architecture.publicDocuments !== "workers-static-assets" ||
    architecture.workerCpuPlan !== "free-10ms" ||
    architecture.openNext !== false ||
    architecture.accounts !== true ||
    architecture.savedState !== true ||
    architecture.memory !== true ||
    architecture.admin !== true ||
    architecture.games !== false
  ) {
    throw new Error(
      "Worker candidate health response does not prove the lean native accounts, saved-state, memory, admin, and games-free architecture.",
    );
  }
  return {
    ok: true,
    runtime: "cloudflare-workers",
    versionId,
    architecture: {
      deploymentMode: "free-static-native-accounts",
      publicDocuments: "workers-static-assets",
      workerCpuPlan: "free-10ms",
      openNext: false,
      accounts: true,
      savedState: true,
      memory: true,
      admin: true,
      games: false,
    },
  } as const;
}

function readExactStagedRelease(backupDirectory: string) {
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
  );
  const staged = readWorkerCandidateStagedEvidence(
    workerCandidateStagedEvidencePath(backupDirectory),
  );
  verifyWorkerCandidateStagedEvidence({
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
  });
  return Object.freeze({ upload, staged });
}

function assertOptionalReleaseHandle<
  T extends WorkerCandidateUploadEvidence | WorkerCandidateStagedEvidence,
>(
  provided: WorkerCandidateEvidenceHandle<T> | undefined,
  persisted: WorkerCandidateEvidenceHandle<T>,
  label: string,
) {
  if (
    provided !== undefined &&
    (path.resolve(provided.path) !== path.resolve(persisted.path) ||
      provided.sha256 !== persisted.sha256)
  ) {
    throw new Error(
      `Worker candidate version-override smoke ${label} handle is not the exact canonical release evidence.`,
    );
  }
}

function assertCanonicalPathAbsent(file: string, message: string) {
  try {
    fs.lstatSync(file);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw new Error("Canonical evidence path absence could not be established.", {
      cause: error,
    });
  }
  throw new Error(message);
}

function readClock(clock: () => Date, label: string) {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`Worker candidate version-override ${label} clock is invalid.`);
  }
  return value.toISOString();
}

function requireRecord(value: unknown, label: string) {
  if (!isPlainRecord(value)) {
    throw new Error(`${label} must be a plain JSON object.`);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireUuid(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new Error(`${label} must be a canonical Worker UUID.`);
  }
  return value;
}

function requireExactDelivery(value: string | null) {
  if (value !== "lean-api-worker") {
    throw new Error(
      "Worker candidate health response did not identify lean-api-worker delivery.",
    );
  }
  return "lean-api-worker" as const;
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hasErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function assertConfirmedProductionArguments(args: readonly string[]) {
  if (args.length !== 1 || args[0] !== "--confirm-production") {
    throw new Error(
      "Candidate version-override smoke requires exact --confirm-production acknowledgement.",
    );
  }
}

async function runCli() {
  try {
    assertConfirmedProductionArguments(process.argv.slice(2));
    const handle = await createWorkerCandidateVersionOverrideSmokeEvidence();
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: handle.path,
          sha256: handle.sha256,
          createdAt: handle.value.createdAt,
          validUntil: handle.value.validUntil,
          serviceBaselineVersionId:
            handle.value.release.serviceBaselineVersionId,
          targetCandidateVersionId:
            handle.value.release.targetCandidateVersionId,
          stagedDeploymentId: handle.value.release.stagedDeploymentId,
          pinnedAttempts: handle.value.pinnedAttempts.length,
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  void runCli();
}
