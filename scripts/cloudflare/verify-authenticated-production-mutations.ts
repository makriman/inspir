import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../../lib/i18n/main-app-static-asset";
import {
  NATIVE_MEMORY_VECTOR_REVISION_HEX_CHARS,
  nativeMemoryVectorId,
  parseNativeMemoryVectorId,
} from "../../lib/free-runtime/native-memory-vector";
import type { MemoryVectorCleanupQueueMessage } from "../../lib/free-runtime/memory-queue-contract";
import { buildNativeMemoryTurnSearchableText } from "../../lib/free-runtime/state-api";
import { disposableAdminTopicFixture } from "../../lib/free-runtime/disposable-admin-validation";
import { maxProfileImageBytes } from "../../lib/profile/photo";
import { readCloudflareApiToken } from "./cloudflare-api-token";
import { readPrivateJsonNoFollow, writePrivateJsonDurably } from "./d1-release-budget-ledger";
import {
  backgroundQueueSettlementQuietPeriodMs,
  captureTail as captureProductionTail,
  parseTailJsonStream,
} from "./verify-production-background-outcomes";
import {
  CLOUDFLARE_ACCOUNT_ID,
  MEMORY_POST_TURN_QUEUE_NAME,
  VECTORIZE_INDEX_NAME,
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
  stableStringify,
} from "./migration-config";

const workerName = "inspirlearning";
const defaultBaseUrl = "https://inspirlearning.com";
const tailSessionHeader = "x-inspir-tail-session";
const versionOverrideHeader = "Cloudflare-Workers-Version-Overrides";
const mutationProbeParameter = "authenticated_mutation_probe";
const tailReadinessProbeParameter = "authenticated_tail_ready";
const tailWaitTimeoutMs = 45_000;
const tailReadinessRequestTimeoutMs = 15_000;
const tailReadinessMaximumResponseBytes = 64 * 1024;
const requestTimeoutMs = 75_000;
const maximumResponseBytes = 768 * 1024;
const profilePhotoSeedMaximumBytes = 64 * 1024;
const profilePhotoSeedPath = "public/media/inspir-learning-film-poster.webp";
const cleanupAttemptLimit = 3;
const queueCaptureTimeoutMs = 5 * 60_000;
export const authenticatedCleanupQueueSettlementTimeoutMs = 10 * 60_000;
export const authenticatedQueueSettlementQuietPeriodMs =
  backgroundQueueSettlementQuietPeriodMs;
// Vectorize mutations are asynchronous. Production evidence must wait beyond
// the observed p99 visibility window and prove two genuinely spaced absence
// reads, matching the runtime outbox fence instead of accepting fast stale
// reads as authoritative deletion.
export const vectorStateTimeoutMs = 8 * 60_000;
export const vectorCleanupMinimumSettleMs = 3 * 60_000;
export const vectorAbsenceVerificationSpacingMs = 3 * 60_000;
export const authenticatedOutboxDrainRetryDelayMs = 30_000;
// A crashed writer can retain a 15-minute write fence before the runtime can
// begin its two delayed absence reads. Keep the operator wait bounded while
// covering that complete recovery window with margin.
export const authenticatedOutboxDrainMaximumAttempts = 60;
const cloudflareApiResponseLimit = 64 * 1024;
export const authenticatedMemoryRecoveryEvidenceName =
  "authenticated-production-memory-recovery.json";
export const authenticatedMutationCpuThresholdMs = 8;
export const captureAuthenticatedTail = captureProductionTail;
export const parseAuthenticatedTailJsonStream = parseTailJsonStream;
export const authenticatedMutationInventoryNames = [
  "users",
  "profile_photo_pointers",
  "accounts",
  "sessions",
  "verification_tokens",
  "rate_limit_windows",
  "admin_users",
  "topics",
  "product_events",
  "ops_events",
  "chats",
  "messages",
  "activity_runs",
  "ai_runs",
  "user_memory_settings",
  "user_memories",
  "chat_memory_summaries",
  "chat_memory_turns",
  "user_memory_profiles",
  "user_memory_summaries",
  "memory_synthesis_runs",
  "memory_source_feedback",
  "memory_events",
  "memory_vector_cleanup_outbox",
] as const;

export type AuthenticatedMutationTrace = {
  label: string;
  probe: string;
  origin: string;
  requestKey: string;
  routeTemplate: string;
  method: string;
  status: number;
};

export type AuthenticatedMutationTailSample = {
  label: string;
  probe: string;
  origin: string;
  requestKey: string;
  urlEnvelopeValid: boolean;
  eventShapeValid: boolean;
  path: string;
  routeTemplate: string;
  method: string | null;
  status: number | null;
  outcome: string | null;
  cpuTimeMs: number | null;
  wallTimeMs: number | null;
  eventTimestamp: number | null;
  scriptName: string | null;
  scriptVersionId: string | null;
  truncated: boolean | null;
  exceptionCount: number | null;
  logArrayValid: boolean;
  warningOrErrorLogCount: number;
};

export type AuthenticatedMutationTailEvaluation = {
  ok: boolean;
  samples: AuthenticatedMutationTailSample[];
  problems: string[];
};

export const authenticatedCriticalResourceTraceRequirements = [
  { label: "profile-photo-upload", routeTemplate: "/api/me/photo", method: "PATCH", status: 200 },
  { label: "profile-photo-read", routeTemplate: "/api/me/photo", method: "GET", status: 200 },
  { label: "profile-photo-delete", routeTemplate: "/api/me/photo", method: "DELETE", status: 200 },
  { label: "memory-source-feedback", routeTemplate: "/api/memory/source-feedback", method: "POST", status: 200 },
  { label: "analytics-event", routeTemplate: "/api/analytics/events", method: "POST", status: 200 },
] as const;

export type AuthenticatedCriticalResourceTailEvaluation = {
  ok: boolean;
  requiredRouteCount: number;
  problems: string[];
};

export type AuthenticatedProfilePhotoProbe = {
  bytes: Uint8Array<ArrayBuffer>;
  byteLength: number;
  mimeType: "image/webp";
  sha256: string;
};

export type AuthenticatedMemoryQueueTailEvaluation = {
  ok: boolean;
  fatal: boolean;
  settled: boolean;
  authenticatedValidationVersionId: string;
  captureOutputOffset: number;
  observationEndedAt: number | null;
  successObservedAt: number | null;
  settledLivenessProbe: string | null;
  matchedEvents: number;
  successfulEvents: number;
  cpuTimeMs: number | null;
  indexedVectorCount: number | null;
  problems: string[];
};

export type AuthenticatedMemoryVectorCleanupQueueTailEvaluation = {
  ok: boolean;
  fatal: boolean;
  settled: boolean;
  chainComplete: boolean;
  reason: string;
  captureOutputOffset: number;
  observationEndedAt: number | null;
  successObservedAt: number | null;
  settledLivenessProbe: string | null;
  authenticatedValidationVersionId: string;
  matchedEvents: number;
  processedEvents: number;
  deferredEvents: number;
  failedEvents: number;
  maximumCpuTimeMs: number | null;
  samples: AuthenticatedMemoryVectorCleanupQueueTailSample[];
  problems: string[];
};

export type AuthenticatedMemoryVectorCleanupQueueTailSample = {
  reason: string;
  messageId: string | null;
  attempts: number | null;
  eventTimestamp: number | null;
  outcome: string | null;
  cpuTimeMs: number | null;
  terminal: "processed" | "deferred" | "failed" | "missing" | "multiple";
  pending: number | null;
  nextDelaySeconds: number | null;
};

export type AuthenticatedMemoryQueueResourceWindowEvaluation = {
  ok: boolean;
  authenticatedValidationVersionId: string;
  captureOutputOffset: number;
  matchedEvents: number;
  maximumCpuTimeMs: number | null;
  tailCaptureLoss: boolean;
  problems: string[];
};

export type AuthenticatedSemanticRetrievalTailEvaluation = {
  ok: boolean;
  authenticatedValidationVersionId: string;
  matchedEvents: number;
  cpuTimeMs: number | null;
  hydratedTurnCount: number | null;
  problems: string[];
};

export type AuthenticatedMemoryPostTurnJob = {
  type: "memory.post_turn.v2";
  enqueuedAt: string;
  aiRunId: string;
  userId: string;
  chatId: string;
  topic: { id: string; name: string; slug: string };
  userMessageId: string;
  assistantMessageId: string;
  contextMessageIds: string[];
};

export type AuthenticatedMemoryHotPathHooks = {
  publishPostTurnAndRequireStored: (
    job: AuthenticatedMemoryPostTurnJob,
    turnVectorId: string,
  ) => Promise<void>;
  requireKnownVectorPresent: (vectorId: string) => Promise<void>;
  requireSemanticTurnHydrated: (trace: AuthenticatedMutationTrace) => Promise<void>;
  requestVectorCleanupDrain: () => Promise<void>;
  requireKnownVectorAbsent: (vectorId: string) => Promise<void>;
};

export type AuthenticatedMemoryRecoveryEvidence = {
  kind: "authenticated-production-memory-recovery-v2";
  createdAt: string;
  releaseCandidateVersionId: string;
  authenticatedValidationVersionId: string;
  runId: string;
  userId: string;
  sourceChatId: string;
  userMessageId: string;
  turnVectorId: string;
  sourceFingerprintSha256: string;
  immutableReleaseIdentitySha256: string;
  queuePushPreparedAt: string;
};

export function authenticatedTurnVectorId(
  userMessageId: string,
  userContent: string,
  assistantContent: string,
) {
  const searchableText = buildNativeMemoryTurnSearchableText(userContent, assistantContent);
  if (!searchableText) {
    throw new Error("Authenticated memory validation turn text is empty.");
  }
  const revision = createHash("sha256")
    .update(searchableText, "utf8")
    .digest("hex")
    .slice(0, NATIVE_MEMORY_VECTOR_REVISION_HEX_CHARS);
  const vectorId = nativeMemoryVectorId("chat_memory_turns", userMessageId, revision);
  if (!vectorId) {
    throw new Error("Authenticated memory validation turn vector ID is invalid.");
  }
  return vectorId;
}

type MutationFetcher = typeof fetch;

type MutationFlowOptions = {
  baseUrl: string;
  expectedVersion: string;
  authSecret: string;
  runId: string;
  tailSessionToken: string;
  memoryHotPath: AuthenticatedMemoryHotPathHooks;
  fetcher?: MutationFetcher;
  traceSink?: AuthenticatedMutationTrace[];
};

export type AuthenticatedMutationDisposableIdentity = {
  candidateVersionId: string;
  runId: string;
  userId: string;
  email: string;
};

type MutationRequestResult = {
  response: Response;
  bodyBytes: Uint8Array;
  text: string;
  value: unknown;
  trace: AuthenticatedMutationTrace;
};

export function buildAuthenticatedProfilePhotoProbe(): AuthenticatedProfilePhotoProbe {
  const seedFile = path.resolve(process.cwd(), profilePhotoSeedPath);
  const seedStat = fs.statSync(seedFile);
  if (
    !seedStat.isFile() ||
    seedStat.size < 20 ||
    seedStat.size > profilePhotoSeedMaximumBytes ||
    seedStat.size % 2 !== 0 ||
    maxProfileImageBytes - seedStat.size < 8
  ) {
    throw new Error("Authenticated profile-photo WebP seed is outside its bounded RIFF contract.");
  }
  const seed = fs.readFileSync(seedFile);
  if (
    seed.byteLength !== seedStat.size ||
    seed.subarray(0, 4).toString("ascii") !== "RIFF" ||
    seed.subarray(8, 12).toString("ascii") !== "WEBP" ||
    seed.readUInt32LE(4) !== seed.byteLength - 8
  ) {
    throw new Error("Authenticated profile-photo seed is not an exact WebP RIFF container.");
  }

  const bytes = new Uint8Array(maxProfileImageBytes);
  bytes.set(seed);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, maxProfileImageBytes - 8, true);
  bytes.set([0x4a, 0x55, 0x4e, 0x4b], seed.byteLength);
  view.setUint32(seed.byteLength + 4, maxProfileImageBytes - seed.byteLength - 8, true);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    byteLength: bytes.byteLength,
    mimeType: "image/webp",
    sha256,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Authenticated mutation validation failed.");
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Authenticated production mutation validation requires --confirm-production.");
  }
  if (process.env.REQUIRE_LIVE_AI !== "1") {
    throw new Error("Authenticated production mutation validation requires REQUIRE_LIVE_AI=1.");
  }
  const expectedVersion = requireUuid(
    getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION,
    "expected Worker version",
  );
  const candidateVersionId = requireUuid(
    getArg("--candidate-version") ?? process.env.E2E_VALIDATION_CANDIDATE_VERSION,
    "candidate Worker version",
  );
  const sourceFingerprintSha256 = requireSha256(
    getArg("--source-fingerprint-sha256") ??
      process.env.E2E_VALIDATION_SOURCE_FINGERPRINT_SHA256,
    "source fingerprint",
  );
  const immutableReleaseIdentitySha256 = requireSha256(
    getArg("--immutable-release-identity-sha256") ??
      process.env.E2E_VALIDATION_IMMUTABLE_RELEASE_IDENTITY_SHA256,
    "immutable release identity",
  );
  const memoryRecoveryEvidencePath = requireMemoryRecoveryEvidencePath(
    getArg("--memory-recovery-evidence-path") ??
      process.env.E2E_VALIDATION_MEMORY_RECOVERY_EVIDENCE_PATH,
  );
  assertPathAbsent(memoryRecoveryEvidencePath, "authenticated memory recovery evidence");
  const runId = requireUuid(process.env.E2E_TEST_MUTATION_RUN_ID, "mutation run ID");
  const authSecret = requireSecret(process.env.E2E_TEST_AUTH_SECRET);
  const baseUrl = normalizeBaseUrl(
    getArg("--base-url") ?? process.env.PRODUCTION_BASE_URL ?? defaultBaseUrl,
  );
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  requireActiveDeployment(wrangler, expectedVersion);

  const tailSessionToken = randomUUID();
  const httpTail = spawn(
    wrangler,
    [
      "tail",
      workerName,
      "--format",
      "json",
      "--version-id",
      expectedVersion,
      "--header",
      `${tailSessionHeader}:${tailSessionToken}`,
    ],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const versionTail = spawn(
    wrangler,
    ["tail", workerName, "--format", "json", "--version-id", expectedVersion],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const httpCapture = captureAuthenticatedTail(httpTail);
  const versionCapture = captureAuthenticatedTail(versionTail);
  const traces: AuthenticatedMutationTrace[] = [];
  const hotPathEvidence: {
    queue: AuthenticatedMemoryQueueTailEvaluation | null;
    semantic: AuthenticatedSemanticRetrievalTailEvaluation | null;
    cleanupWakes: AuthenticatedMemoryVectorCleanupQueueTailEvaluation[];
    cleanupAggregate: AuthenticatedMemoryQueueResourceWindowEvaluation | null;
  } = { queue: null, semantic: null, cleanupWakes: [], cleanupAggregate: null };
  let storedMemoryUserId: string | null = null;
  let semanticTrace: AuthenticatedMutationTrace | null = null;
  let memoryRecoveryEvidence: AuthenticatedMemoryRecoveryEvidence | null = null;
  try {
    const initialLivenessProbe = await waitForTailReadiness({
      tails: [
        {
          label: "HTTP-filtered",
          tail: httpTail,
          output: httpCapture.output,
          diagnostics: httpCapture.diagnostics,
        },
        {
          label: "version-only",
          tail: versionTail,
          output: versionCapture.output,
          diagnostics: versionCapture.diagnostics,
        },
      ],
      baseUrl,
      expectedVersion,
      tailSessionToken,
      markerLabel: "ready",
      retryMissedMarker: true,
    });
    const apiToken = requireCloudflareApiToken();
    const queueId = readQueueId(wrangler);
    const cleanupValidationStartedAt = Date.now();
    const cleanupValidationOutputOffset = await waitForCompleteTailOutputCheckpoint(
      versionTail,
      versionCapture.output,
    );
    const cleanupReasonPrefix = `e2e-cleanup-${runId.replaceAll("-", "")}`;
    let cleanupWakeIndex = 0;
    const memoryHotPath: AuthenticatedMemoryHotPathHooks = {
      publishPostTurnAndRequireStored: async (job, turnVectorId) => {
        requireActiveDeployment(wrangler, expectedVersion);
        if (memoryRecoveryEvidence) {
          throw new Error("Authenticated memory Queue publish was attempted more than once.");
        }
        const preparedAt = new Date().toISOString();
        const evidence = parseAuthenticatedMemoryRecoveryEvidence({
          kind: "authenticated-production-memory-recovery-v2",
          createdAt: preparedAt,
          releaseCandidateVersionId: candidateVersionId,
          authenticatedValidationVersionId: expectedVersion,
          runId,
          userId: job.userId,
          sourceChatId: job.chatId,
          userMessageId: job.userMessageId,
          turnVectorId,
          sourceFingerprintSha256,
          immutableReleaseIdentitySha256,
          queuePushPreparedAt: preparedAt,
        });
        writePrivateJsonDurably(memoryRecoveryEvidencePath, evidence, { replace: false });
        memoryRecoveryEvidence = evidence;
        const captureOutputOffset = await waitForCompleteTailOutputCheckpoint(
          versionTail,
          versionCapture.output,
        );
        await pushAuthenticatedMemoryPostTurn(apiToken, queueId, job);
        hotPathEvidence.queue = await waitForAuthenticatedMemoryQueueEvidence({
          tail: versionTail,
          output: versionCapture.output,
          diagnostics: versionCapture.diagnostics,
          baseUrl,
          authenticatedValidationVersionId: expectedVersion,
          userId: job.userId,
          captureOutputOffset,
        });
        storedMemoryUserId = job.userId;
        if (!hotPathEvidence.queue.ok) {
          throw new Error(
            `Authenticated stored-memory Queue evidence failed (${hotPathEvidence.queue.problems.join("; ")}).`,
          );
        }
        requireActiveDeployment(wrangler, expectedVersion);
      },
      requireKnownVectorPresent: async (vectorId) => {
        requireActiveDeployment(wrangler, expectedVersion);
        await waitForKnownVectorState({
          apiToken,
          vectorId,
          expectedPresent: true,
        });
        requireActiveDeployment(wrangler, expectedVersion);
      },
      requireSemanticTurnHydrated: async (trace) => {
        requireActiveDeployment(wrangler, expectedVersion);
        semanticTrace = trace;
        hotPathEvidence.semantic = await waitForAuthenticatedSemanticRetrievalEvidence({
          tail: httpTail,
          output: httpCapture.output,
          diagnostics: httpCapture.diagnostics,
          trace,
          authenticatedValidationVersionId: expectedVersion,
        });
        if (!hotPathEvidence.semantic.ok) {
          throw new Error(
            `Authenticated semantic retrieval evidence failed (${hotPathEvidence.semantic.problems.join("; ")}).`,
          );
        }
        requireActiveDeployment(wrangler, expectedVersion);
      },
      requestVectorCleanupDrain: async () => {
        requireActiveDeployment(wrangler, expectedVersion);
        cleanupWakeIndex += 1;
        const reason = `${cleanupReasonPrefix}-${cleanupWakeIndex}`;
        const captureOutputOffset = await waitForCompleteTailOutputCheckpoint(
          versionTail,
          versionCapture.output,
        );
        await pushAuthenticatedMemoryVectorCleanupWake(
          apiToken,
          queueId,
          reason,
        );
        const evidence = await waitForAuthenticatedMemoryVectorCleanupQueueEvidence({
          tail: versionTail,
          output: versionCapture.output,
          diagnostics: versionCapture.diagnostics,
          baseUrl,
          authenticatedValidationVersionId: expectedVersion,
          captureOutputOffset,
          reason,
        });
        hotPathEvidence.cleanupWakes.push(evidence);
        if (!evidence.ok) {
          throw new Error(
            `Authenticated Vectorize cleanup Queue evidence failed (${evidence.problems.join("; ")}).`,
          );
        }
        requireActiveDeployment(wrangler, expectedVersion);
      },
      requireKnownVectorAbsent: async (vectorId) => {
        requireActiveDeployment(wrangler, expectedVersion);
        await waitForKnownVectorState({
          apiToken,
          vectorId,
          expectedPresent: false,
          minimumSettleMs: vectorCleanupMinimumSettleMs,
        });
        requireActiveDeployment(wrangler, expectedVersion);
        if (!memoryRecoveryEvidence || memoryRecoveryEvidence.turnVectorId !== vectorId) {
          throw new Error("Authenticated memory recovery evidence does not match the cleaned vector.");
        }
        removeAuthenticatedMemoryRecoveryEvidence(
          memoryRecoveryEvidencePath,
          memoryRecoveryEvidence,
        );
        memoryRecoveryEvidence = null;
      },
    };
    const flow = await runAuthenticatedProductionMutationFlow({
      baseUrl,
      expectedVersion,
      authSecret,
      runId,
      tailSessionToken,
      memoryHotPath,
      traceSink: traces,
    });
    await waitForTailProbes(httpTail, httpCapture.output, traces.map((trace) => trace.probe));
    const settledLivenessProbe = await waitForTailReadiness({
      tails: [
        {
          label: "HTTP-filtered",
          tail: httpTail,
          output: httpCapture.output,
          diagnostics: httpCapture.diagnostics,
        },
        {
          label: "version-only",
          tail: versionTail,
          output: versionCapture.output,
          diagnostics: versionCapture.diagnostics,
        },
      ],
      baseUrl,
      expectedVersion,
      tailSessionToken,
      markerLabel: "settled",
      retryMissedMarker: false,
    });
    for (const entry of [
      { label: "HTTP-filtered", tail: httpTail },
      { label: "version-only", tail: versionTail },
    ]) {
      if (hasChildExited(entry.tail)) {
        throw new Error(`${entry.label} Wrangler JSON tail exited before intentional shutdown.`);
      }
    }
    httpCapture.beginIntentionalShutdown();
    versionCapture.beginIntentionalShutdown();
    if (!await stopTail(httpTail, httpCapture.closed)) {
      httpCapture.cancelIntentionalShutdown();
      throw new Error("HTTP-filtered Wrangler JSON tail exited unexpectedly.");
    }
    if (!await stopTail(versionTail, versionCapture.closed)) {
      versionCapture.cancelIntentionalShutdown();
      throw new Error("Version-only Wrangler JSON tail exited unexpectedly.");
    }
    const finalHttpTailOutput = httpCapture.output();
    const finalHttpTailDiagnostics = httpCapture.diagnosticsForEvaluation();
    const finalVersionTailOutput = versionCapture.output();
    const finalVersionTailDiagnostics = versionCapture.diagnosticsForEvaluation();
    if (!authenticatedTailReadinessIsCapturedByEveryTail(
      [finalHttpTailOutput, finalVersionTailOutput],
      settledLivenessProbe,
      expectedVersion,
      true,
    )) {
      throw new Error("The settled authenticated Tail liveness marker was missing after shutdown.");
    }
    if (
      !storedMemoryUserId ||
      !hotPathEvidence.queue ||
      !hotPathEvidence.queue.settledLivenessProbe
    ) {
      throw new Error("Authenticated stored-memory Queue evidence was not captured.");
    }
    if (
      hotPathEvidence.cleanupWakes.length === 0 ||
      hotPathEvidence.cleanupWakes.some((entry) => !entry.settledLivenessProbe)
    ) {
      throw new Error("Authenticated cleanup Queue liveness evidence was not captured.");
    }
    hotPathEvidence.queue = evaluateAuthenticatedMemoryQueueTail(finalVersionTailOutput, {
      authenticatedValidationVersionId: expectedVersion,
      userId: storedMemoryUserId,
      captureOutputOffset: hotPathEvidence.queue.captureOutputOffset,
      observationEndedAt: hotPathEvidence.queue.observationEndedAt ?? undefined,
      successObservedAt: hotPathEvidence.queue.successObservedAt ?? undefined,
      settledLivenessProbe: hotPathEvidence.queue.settledLivenessProbe ?? undefined,
      tailDiagnostics: finalVersionTailDiagnostics,
      tailOutputClosed: true,
    });
    hotPathEvidence.cleanupWakes = hotPathEvidence.cleanupWakes.map((entry) =>
      evaluateAuthenticatedMemoryVectorCleanupQueueTail(finalVersionTailOutput, {
        authenticatedValidationVersionId: expectedVersion,
        captureOutputOffset: entry.captureOutputOffset,
        reason: entry.reason,
        observationEndedAt: entry.observationEndedAt ?? undefined,
        successObservedAt: entry.successObservedAt ?? undefined,
        settledLivenessProbe: entry.settledLivenessProbe ?? undefined,
        tailDiagnostics: finalVersionTailDiagnostics,
        tailOutputClosed: true,
      })
    );
    const cleanupAggregate = evaluateAuthenticatedMemoryQueueResourceWindow(
      finalVersionTailOutput,
      {
        authenticatedValidationVersionId: expectedVersion,
        captureOutputOffset: cleanupValidationOutputOffset,
        tailDiagnostics: finalVersionTailDiagnostics,
        tailOutputClosed: true,
      },
    );
    hotPathEvidence.cleanupAggregate = cleanupAggregate;
    const evaluation = evaluateAuthenticatedMutationTail(
      finalHttpTailOutput,
      traces,
      expectedVersion,
      {
        tailDiagnostics: finalHttpTailDiagnostics,
        tailOutputClosed: true,
      },
    );
    const criticalResourceTail = evaluateAuthenticatedCriticalResourceTail(
      traces,
      evaluation.samples,
      expectedVersion,
    );
    if (!semanticTrace || !hotPathEvidence.semantic) {
      throw new Error("Authenticated semantic retrieval evidence was not captured.");
    }
    hotPathEvidence.semantic = evaluateAuthenticatedSemanticRetrievalTail(
      finalHttpTailOutput,
      {
        authenticatedValidationVersionId: expectedVersion,
        trace: semanticTrace,
        tailDiagnostics: finalHttpTailDiagnostics,
        tailOutputClosed: true,
      },
    );
    requireActiveDeployment(wrangler, expectedVersion);
    const report = {
      kind: "authenticated-production-mutation-validation-v2",
      createdAt: new Date().toISOString(),
      ok:
        evaluation.ok &&
        criticalResourceTail.ok &&
        flow.adminUsersMutationVerified &&
        flow.adminTopicsMutationVerified &&
        flow.profilePhotoVerified &&
        flow.profilePhotoDeleted &&
        flow.sourceFeedbackVerified &&
        flow.analyticsEventVerified &&
        flow.cleanupVerified &&
        flow.queueStored &&
        flow.knownVectorPresentBeforeRecall &&
        flow.semanticTurnHydrated &&
        flow.sourceChatDeleted &&
        flow.knownVectorAbsentAfterCleanup &&
        hotPathEvidence.queue?.ok === true &&
        hotPathEvidence.semantic?.ok === true &&
        hotPathEvidence.cleanupWakes.length > 0 &&
        hotPathEvidence.cleanupWakes.every((entry) => entry.ok) &&
        cleanupAggregate.ok,
      workerName,
      expectedVersion,
      runId,
      authenticatedValidationVersionId: expectedVersion,
      cleanupValidationStartedAt,
      cleanupValidationStartedAtIso: new Date(cleanupValidationStartedAt).toISOString(),
      cleanupValidationOutputOffset,
      initialLivenessProbe,
      settledLivenessProbe,
      evidenceVersionRole: "authenticated-validation-version",
      releaseBinding: {
        candidateVersionId,
        sourceFingerprintSha256,
        immutableReleaseIdentitySha256,
        immutableSourceAndArtifactIdentity: "parent-attested-shared-across-secret-configuration-versions",
      },
      cpuThresholdExclusiveMs: authenticatedMutationCpuThresholdMs,
      requestCount: traces.length,
      traces,
      tail: evaluation,
      criticalResourceTail,
      storedMemoryQueueTail: hotPathEvidence.queue,
      vectorCleanupQueueTail: cleanupAggregate,
      vectorCleanupWakeTail: hotPathEvidence.cleanupWakes,
      semanticRetrievalTail: hotPathEvidence.semantic,
      outcomes: {
        adminUsersMutationVerified: flow.adminUsersMutationVerified,
        adminTopicsMutationVerified: flow.adminTopicsMutationVerified,
        chatFinalized: flow.chatFinalized,
        profileMutationVerified: flow.profileMutationVerified,
        profilePhotoVerified: flow.profilePhotoVerified,
        profilePhotoDeleted: flow.profilePhotoDeleted,
        profilePhotoByteLength: maxProfileImageBytes,
        sourceFeedbackVerified: flow.sourceFeedbackVerified,
        analyticsEventVerified: flow.analyticsEventVerified,
        spanishActivityBundleVerified: flow.spanishActivityBundleVerified,
        legacyAnswerPersisted: flow.legacyAnswerPersisted,
        memoryCrudVerified: flow.memoryCrudVerified,
        quizCompleted: flow.quizCompleted,
        flashcardsCompleted: flow.flashcardsCompleted,
        savedQuizResultVerified: flow.savedQuizResultVerified,
        savedFlashcardResultVerified: flow.savedFlashcardResultVerified,
        queueStored: flow.queueStored,
        knownVectorPresentBeforeRecall: flow.knownVectorPresentBeforeRecall,
        semanticTurnHydrated: flow.semanticTurnHydrated,
        sourceChatDeleted: flow.sourceChatDeleted,
        knownVectorAbsentAfterCleanup: flow.knownVectorAbsentAfterCleanup,
        cleanupQueueInvocationsVerified: cleanupAggregate.matchedEvents,
        cleanupVerified: flow.cleanupVerified,
        sharedGlobalAiBudgetCalls: 7,
      },
    };
    const reportPath = path.join(
      cloudflareDir(resolveBackupDir()),
      "authenticated-production-mutations-report.json",
    );
    writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
    if (!report.ok) {
      throw new Error(
        `Authenticated mutation validation failed (${[
          ...evaluation.problems,
          ...criticalResourceTail.problems,
          ...(hotPathEvidence.queue?.problems ?? []),
          ...cleanupAggregate.problems,
          ...hotPathEvidence.cleanupWakes.flatMap((entry) => entry.problems),
          ...(hotPathEvidence.semantic?.problems ?? []),
        ].join("; ") || "cleanup residue"}).`,
      );
    }
    console.log(JSON.stringify({
      kind: report.kind,
      ok: report.ok,
      createdAt: report.createdAt,
      authenticatedValidationVersionId: expectedVersion,
      requestCount: report.requestCount,
      maximumCpuTimeMs: Math.max(
        0,
        ...evaluation.samples.map((sample) => sample.cpuTimeMs ?? 0),
        hotPathEvidence.queue?.cpuTimeMs ?? 0,
        cleanupAggregate.maximumCpuTimeMs ?? 0,
        hotPathEvidence.semantic?.cpuTimeMs ?? 0,
      ),
      reportPath,
    }, null, 2));
  } finally {
    const shutdownErrors: Error[] = [];
    for (const entry of [
      { tail: httpTail, capture: httpCapture },
      { tail: versionTail, capture: versionCapture },
    ]) {
      if (hasChildExited(entry.tail)) continue;
      try {
        entry.capture.beginIntentionalShutdown();
        if (!await stopTail(entry.tail, entry.capture.closed)) {
          entry.capture.cancelIntentionalShutdown();
          throw new Error("Wrangler JSON tail exited before intentional shutdown.");
        }
      } catch (error) {
        shutdownErrors.push(error instanceof Error ? error : new Error("Wrangler tail shutdown failed."));
      }
    }
    if (shutdownErrors.length) {
      throw new AggregateError(shutdownErrors, "Authenticated mutation tails did not stop safely.");
    }
  }
}

export async function runAuthenticatedProductionMutationFlow(options: MutationFlowOptions) {
  const fetcher = options.fetcher ?? fetch;
  const traceSink = options.traceSink ?? [];
  const expectedIdentity = expectedAuthenticatedMutationDisposableIdentity(
    options.expectedVersion,
    options.runId,
  );
  let cookie = "";
  let requestIndex = 0;
  let primaryError: unknown = null;
  const cleanupErrors: unknown[] = [];
  let disposableCreated = false;
  let sourceChatId: string | null = null;
  let knownTurnVectorId: string | null = null;
  let chatFinalized = false;
  let profileMutationVerified = false;
  let profilePhotoVerified = false;
  let profilePhotoDeleted = false;
  let sourceFeedbackVerified = false;
  let analyticsEventVerified = false;
  let spanishActivityBundleVerified = false;
  let legacyAnswerPersisted = false;
  let memoryCrudVerified = false;
  let quizCompleted = false;
  let flashcardsCompleted = false;
  let savedQuizResultVerified = false;
  let savedFlashcardResultVerified = false;
  let queueStored = false;
  let knownVectorPresentBeforeRecall = false;
  let semanticTurnHydrated = false;
  let sourceChatDeleted = false;
  let knownVectorAbsentAfterCleanup = false;
  let cleanupVerified = false;
  let adminUsersMutationVerified = false;
  let adminTopicsMutationVerified = false;

  const request = async (
    label: string,
    pathname: string,
    init: RequestInit,
    expectedStatus = 200,
    maximumBodyBytes = maximumResponseBytes,
  ): Promise<MutationRequestResult> => {
    const url = new URL(pathname, options.baseUrl);
    const probe = createAuthenticatedMutationProbe(label, requestIndex);
    requestIndex += 1;
    url.searchParams.set(mutationProbeParameter, probe);
    const headers = new Headers(init.headers);
    headers.set("cache-control", "no-cache");
    headers.set(versionOverrideHeader, `${workerName}="${options.expectedVersion}"`);
    headers.set(tailSessionHeader, options.tailSessionToken);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetcher(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs),
    });
    cookie = updatedSessionCookie(cookie, response.headers);
    const bodyBytes = await readBoundedResponseBytes(response, maximumBodyBytes);
    const text = new TextDecoder().decode(bodyBytes);
    const trace = {
      label,
      probe,
      origin: url.origin,
      requestKey: `${url.pathname}${url.search}`,
      routeTemplate: normalizeAuthenticatedMutationRoute(url.pathname),
      method: init.method ?? "GET",
      status: response.status,
    } satisfies AuthenticatedMutationTrace;
    traceSink.push(trace);
    if (response.status !== expectedStatus) {
      throw new Error(`${label} returned HTTP ${response.status}; expected ${expectedStatus}.`);
    }
    const value = parseJson(text);
    if (url.pathname === "/api/migration/e2e-auth") {
      assertAuthenticatedMutationRuntimeVersion(
        value,
        options.expectedVersion,
        `${label} response`,
      );
    }
    return { response, bodyBytes, text, value, trace };
  };

  const mutationBody = (action: string, userId?: string) => JSON.stringify({
    action,
    runId: options.runId,
    candidateVersionId: options.expectedVersion,
    ...(userId ? { userId } : {}),
  });

  try {
    spanishActivityBundleVerified = await verifySpanishActivityBundle(
      fetcher,
      options.baseUrl,
      options.expectedVersion,
    );
    const authenticated = await request(
      "create-disposable",
      "/api/migration/e2e-auth",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-migration-e2e-auth-secret": options.authSecret,
        },
        body: mutationBody("create-disposable"),
      },
    );
    const authenticationProof = assertAuthenticatedMutationResponseProof(
      authenticated.value,
      {
        candidateVersionId: options.expectedVersion,
        runId: options.runId,
        runtimeVersionId: options.expectedVersion,
      },
      "disposable authentication",
    );
    const auth = authenticationProof.payload;
    const user = requiredRecord(auth.user, "disposable user");
    if (
      user.id !== expectedIdentity.userId ||
      user.isAdmin !== false ||
      user.email !== expectedIdentity.email
    ) {
      throw new Error("Disposable authentication did not return a non-admin isolated user.");
    }
    disposableCreated = true;

    const grantResponse = await request(
      "grant-disposable-admin",
      "/api/migration/e2e-auth",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-migration-e2e-auth-secret": options.authSecret,
        },
        body: mutationBody("grant-disposable-admin", expectedIdentity.userId),
      },
    );
    const grant = assertAuthenticatedMutationResponseProof(
      grantResponse.value,
      {
        candidateVersionId: options.expectedVersion,
        runId: options.runId,
        runtimeVersionId: options.expectedVersion,
      },
      "disposable admin grant",
    ).payload;
    const grantBefore = exactDisposableInventory(grant.before);
    const grantAfter = exactDisposableInventory(grant.after);
    const grantedAdmin = requiredRecord(grant.admin, "disposable admin grant row");
    if (
      grant.ok !== true ||
      grantBefore.admin_users !== 0 ||
      grantBefore.topics !== 0 ||
      grantAfter.admin_users !== 1 ||
      grantAfter.topics !== 0 ||
      grantedAdmin.email !== expectedIdentity.email ||
      grantedAdmin.addedByUserId !== expectedIdentity.userId ||
      grantedAdmin.addedByEmail !== expectedIdentity.email ||
      grantedAdmin.source !== "database" ||
      !isIsoTimestamp(grantedAdmin.createdAt)
    ) {
      throw new Error("Disposable admin grant did not preserve its exact isolated contract.");
    }

    const adminUpsert = requiredRecord((await request(
      "admin-users-upsert",
      "/api/admin/users",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: expectedIdentity.email }),
      },
    )).value, "admin users upsert");
    const upsertedAdmin = requiredRecord(adminUpsert.admin, "admin users upsert row");
    if (
      upsertedAdmin.email !== expectedIdentity.email ||
      upsertedAdmin.addedByUserId !== expectedIdentity.userId ||
      upsertedAdmin.addedByEmail !== expectedIdentity.email ||
      upsertedAdmin.source !== "database" ||
      !isIsoTimestamp(upsertedAdmin.createdAt)
    ) {
      throw new Error("Admin users success path returned the wrong disposable grant.");
    }

    const topicFixture = disposableAdminTopicFixture(expectedIdentity);
    const adminTopicResponse = requiredRecord((await request(
      "admin-topics-create",
      "/api/admin/topics",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: topicFixture.name,
          subText: topicFixture.subText,
          description: topicFixture.description,
          inputboxText: topicFixture.inputboxText,
          systemPrompt: topicFixture.systemPrompt,
        }),
      },
    )).value, "admin topic creation");
    const adminTopic = requiredRecord(adminTopicResponse.topic, "admin topic row");
    const adminTopicId = requiredUuid(adminTopic.id, "admin topic ID");
    const adminTopicMetadata = requiredRecord(adminTopic.metadata, "admin topic metadata");
    if (
      adminTopic.slug !== topicFixture.slug ||
      adminTopic.name !== topicFixture.name ||
      adminTopic.subText !== topicFixture.subText ||
      adminTopic.description !== topicFixture.description ||
      adminTopic.inputboxText !== topicFixture.inputboxText ||
      adminTopic.systemPrompt !== topicFixture.systemPrompt ||
      adminTopic.iconUrl !== null ||
      adminTopic.sortOrder !== 100 ||
      adminTopic.status !== "active" ||
      Object.keys(adminTopicMetadata).length !== 0 ||
      !isIsoTimestamp(adminTopic.createdAt) ||
      adminTopic.updatedAt !== adminTopic.createdAt
    ) {
      throw new Error("Admin topics success path returned the wrong disposable topic.");
    }

    const accountTopics = requiredRecord((await request(
      "admin-topic-account-readback",
      "/api/account/topics",
      { method: "GET" },
    )).value, "admin topic account readback");
    const matchingTopics = requiredArray(accountTopics.topics, "admin topic account rows")
      .flatMap((value) => {
        const topic = optionalRecord(value);
        return topic?.id === adminTopicId && topic.slug === topicFixture.slug ? [topic] : [];
      });
    const readbackTopic = matchingTopics[0];
    const readbackMetadata = requiredRecord(
      readbackTopic?.metadata,
      "admin topic account readback metadata",
    );
    if (
      matchingTopics.length !== 1 ||
      readbackTopic?.name !== topicFixture.name ||
      readbackTopic.subText !== topicFixture.subText ||
      readbackTopic.description !== topicFixture.description ||
      readbackTopic.inputboxText !== topicFixture.inputboxText ||
      readbackTopic.iconUrl !== null ||
      readbackTopic.sortOrder !== 100 ||
      Object.keys(readbackMetadata).length !== 0
    ) {
      throw new Error("Disposable admin topic did not survive independent account-topic readback.");
    }

    const topicCleanupResponse = await request(
      "cleanup-disposable-topic",
      "/api/migration/e2e-auth",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-migration-e2e-auth-secret": options.authSecret,
        },
        body: mutationBody("cleanup-disposable-topic", expectedIdentity.userId),
      },
    );
    const topicCleanup = assertAuthenticatedMutationResponseProof(
      topicCleanupResponse.value,
      {
        candidateVersionId: options.expectedVersion,
        runId: options.runId,
        runtimeVersionId: options.expectedVersion,
      },
      "disposable topic cleanup",
    ).payload;
    const cleanedTopic = requiredRecord(topicCleanup.topic, "cleaned disposable topic");
    const topicCleanupBefore = exactDisposableInventory(topicCleanup.before);
    const topicCleanupAfter = exactDisposableInventory(topicCleanup.after);
    adminTopicsMutationVerified =
      topicCleanup.ok === true &&
      cleanedTopic.id === adminTopicId &&
      cleanedTopic.slug === topicFixture.slug &&
      topicCleanupBefore.topics === 1 &&
      topicCleanupAfter.topics === 0 &&
      topicCleanupAfter.admin_users === 1;
    if (!adminTopicsMutationVerified) {
      throw new Error("Disposable admin topic was not exact-read and immediately cleaned.");
    }

    const adminDelete = requiredRecord((await request(
      "admin-users-delete",
      `/api/admin/users?email=${encodeURIComponent(expectedIdentity.email)}`,
      { method: "DELETE" },
    )).value, "admin users delete");
    const adminInventoryResponse = await request(
      "verify-admin-cleanup-inventory",
      "/api/migration/e2e-auth",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-migration-e2e-auth-secret": options.authSecret,
        },
        body: mutationBody("verify-disposable-cleanup", expectedIdentity.userId),
      },
    );
    const adminInventoryProof = assertAuthenticatedMutationResponseProof(
      adminInventoryResponse.value,
      {
        candidateVersionId: options.expectedVersion,
        runId: options.runId,
        runtimeVersionId: options.expectedVersion,
      },
      "disposable admin cleanup inventory",
    ).payload;
    const adminInventory = exactDisposableInventory(adminInventoryProof.inventory);
    adminUsersMutationVerified =
      adminDelete.ok === true &&
      adminInventory.admin_users === 0 &&
      adminInventory.topics === 0;
    if (!adminUsersMutationVerified) {
      throw new Error("Admin users delete did not revoke the disposable grant.");
    }

    const me = requiredRecord((await request("profile", "/api/me", { method: "GET" })).value, "profile");
    const meUser = requiredRecord(me.user, "profile user");
    if (meUser.id !== expectedIdentity.userId || meUser.score !== 0) {
      throw new Error("Disposable profile is not isolated at score zero.");
    }

    const disposableProfileName = "Inspir Production Validation";
    const disposableProfileLanguage = "Spanish";
    const patchedProfile = requiredRecord((await request("profile-update", "/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: disposableProfileName,
        preferredLanguage: disposableProfileLanguage,
      }),
    })).value, "updated profile");
    const patchedProfileUser = requiredRecord(patchedProfile.user, "updated profile user");
    if (
      patchedProfileUser.id !== expectedIdentity.userId ||
      patchedProfileUser.name !== disposableProfileName ||
      patchedProfileUser.preferredLanguage !== disposableProfileLanguage
    ) {
      throw new Error("Disposable profile mutation did not persist in its response.");
    }
    const profileReadback = requiredRecord((await request(
      "profile-after-update",
      "/api/me",
      { method: "GET" },
    )).value, "updated profile readback");
    const profileReadbackUser = requiredRecord(profileReadback.user, "updated profile readback user");
    profileMutationVerified =
      profileReadbackUser.id === expectedIdentity.userId &&
      profileReadbackUser.name === disposableProfileName &&
      profileReadbackUser.preferredLanguage === disposableProfileLanguage &&
      profileReadbackUser.profileImageHash === null;
    if (!profileMutationVerified) {
      throw new Error("Disposable profile mutation was not verified by an independent readback.");
    }

    const profilePhotoProbe = buildAuthenticatedProfilePhotoProbe();
    if (profilePhotoProbe.byteLength !== maxProfileImageBytes) {
      throw new Error("Authenticated profile-photo probe is not exactly at the runtime byte cap.");
    }
    const profilePhotoForm = new FormData();
    profilePhotoForm.set(
      "photo",
      new File(
        [profilePhotoProbe.bytes],
        `inspir-resource-probe-${options.runId}.webp`,
        { type: profilePhotoProbe.mimeType },
      ),
    );
    const profilePhotoUpload = requiredRecord((await request(
      "profile-photo-upload",
      "/api/me/photo",
      { method: "PATCH", body: profilePhotoForm },
    )).value, "profile photo upload");
    if (profilePhotoUpload.profileImageHash !== profilePhotoProbe.sha256) {
      throw new Error("Disposable profile-photo upload returned the wrong content hash.");
    }
    const profilePhotoRead = await request(
      "profile-photo-read",
      "/api/me/photo",
      { method: "GET" },
      200,
      maxProfileImageBytes,
    );
    if (
      profilePhotoRead.bodyBytes.byteLength !== maxProfileImageBytes ||
      profilePhotoRead.response.headers.get("content-type") !== profilePhotoProbe.mimeType ||
      createHash("sha256").update(profilePhotoRead.bodyBytes).digest("hex") !==
        profilePhotoProbe.sha256
    ) {
      throw new Error("Disposable profile-photo readback did not preserve the exact bounded WebP.");
    }
    const profilePhotoDelete = requiredRecord((await request(
      "profile-photo-delete",
      "/api/me/photo",
      { method: "DELETE" },
    )).value, "profile photo delete");
    if (profilePhotoDelete.profileImageHash !== null) {
      throw new Error("Disposable profile-photo delete returned the wrong pointer contract.");
    }
    await request(
      "profile-photo-after-delete",
      "/api/me/photo",
      { method: "GET" },
      404,
    );
    profilePhotoDeleted = true;
    profilePhotoVerified = true;

    const analyticsEvent = requiredRecord((await request(
      "analytics-event",
      "/api/analytics/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "profile_opened",
          route: "/profile?resource_probe=redacted",
          sessionId: options.runId,
          properties: { surface: "authenticated-resource-validation" },
        }),
      },
    )).value, "analytics event");
    analyticsEventVerified = analyticsEvent.ok === true && analyticsEvent.recorded === true;
    if (!analyticsEventVerified) {
      throw new Error("Disposable analytics event was not admitted for durable recording.");
    }

    const chatId = await createChat(request, "learn-anything", "chat-create");
    sourceChatId = chatId;
    const recallMarker = `cobalt lantern orbit ${options.runId.replaceAll("-", "")}`;
    const streamedPrompt =
      `In this learning example, the unique phrase is "${recallMarker}". ` +
      "Explain why retrieval practice helps durable learning in two concise sentences.";
    const streamed = await request("chat-provider", "/api/chat", {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({
        chatId,
        content: streamedPrompt,
      }),
    });
    if (!streamed.response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Authenticated provider response did not stream SSE.");
    }
    const content = parseCompleteAuthenticatedOpenAiSse(streamed.text);
    const aiRunId = requireResponseUuid(streamed.response, "x-inspir-ai-run-id");
    const userMessageId = requireResponseUuid(streamed.response, "x-inspir-user-message-id");
    if (streamed.response.headers.get("x-inspir-chat-id") !== chatId || !content) {
      throw new Error("Authenticated provider stream metadata is incomplete.");
    }
    const finalized = requiredRecord((await request("chat-finalize", "/api/chat/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aiRunId, chatId, userMessageId, content }),
    })).value, "chat finalization");
    const assistantMessageId = requiredUuid(
      finalized.assistantMessageId,
      "finalized assistant message ID",
    );
    const streamDetail = requiredRecord((await request(
      "chat-stream-result",
      `/api/chats/${chatId}`,
      { method: "GET" },
    )).value, "streamed saved chat");
    const streamMessages = requiredArray(streamDetail.messages, "streamed saved messages");
    const exactUserReadback = streamMessages.some((value) => {
      const message = optionalRecord(value);
      return message?.id === userMessageId &&
        message.role === "user" &&
        message.content === streamedPrompt;
    });
    const exactAssistantReadback = streamMessages.some((value) => {
      const message = optionalRecord(value);
      return message?.id === assistantMessageId &&
        message.role === "assistant" &&
        message.content === content;
    });
    chatFinalized = finalized.ok === true && exactUserReadback && exactAssistantReadback;
    if (!chatFinalized) {
      throw new Error("Authenticated chat finalization did not survive exact message readback.");
    }

    const streamTopic = requiredRecord(streamDetail.topic, "streamed saved chat topic");
    const memoryPostTurnJob: AuthenticatedMemoryPostTurnJob = {
      type: "memory.post_turn.v2",
      enqueuedAt: new Date().toISOString(),
      aiRunId,
      userId: expectedIdentity.userId,
      chatId,
      topic: {
        id: requiredNonEmptyString(streamTopic.id, "streamed saved chat topic ID"),
        name: requiredNonEmptyString(streamTopic.name, "streamed saved chat topic name"),
        slug: requiredNonEmptyString(streamTopic.slug, "streamed saved chat topic slug"),
      },
      userMessageId,
      assistantMessageId,
      contextMessageIds: [],
    };
    knownTurnVectorId = authenticatedTurnVectorId(
      userMessageId,
      streamedPrompt,
      content,
    );
    await options.memoryHotPath.publishPostTurnAndRequireStored(
      memoryPostTurnJob,
      knownTurnVectorId,
    );
    queueStored = true;
    await options.memoryHotPath.requireKnownVectorPresent(knownTurnVectorId);
    knownVectorPresentBeforeRecall = true;

    const recallChatId = await createChat(request, "learn-anything", "semantic-recall-chat-create");
    const recallPrompt =
      `Use previous-chat context containing the exact phrase "${recallMarker}" ` +
      "and explain the learning method it described in one concise sentence.";
    const recalled = await request("chat-semantic-recall-provider", "/api/chat", {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({
        chatId: recallChatId,
        content: recallPrompt,
      }),
    });
    if (!recalled.response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Authenticated semantic recall response did not stream SSE.");
    }
    const recalledContent = parseCompleteAuthenticatedOpenAiSse(recalled.text);
    const recalledAiRunId = requireResponseUuid(recalled.response, "x-inspir-ai-run-id");
    const recalledUserMessageId = requireResponseUuid(
      recalled.response,
      "x-inspir-user-message-id",
    );
    if (
      recalled.response.headers.get("x-inspir-chat-id") !== recallChatId ||
      !recalledContent
    ) {
      throw new Error("Authenticated semantic recall stream metadata is incomplete.");
    }
    const recalledFinalized = requiredRecord((await request(
      "chat-semantic-recall-finalize",
      "/api/chat/finalize",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          aiRunId: recalledAiRunId,
          chatId: recallChatId,
          userMessageId: recalledUserMessageId,
          content: recalledContent,
        }),
      },
    )).value, "semantic recall finalization");
    const recalledAssistantMessageId = requiredUuid(
      recalledFinalized.assistantMessageId,
      "semantic recall assistant message ID",
    );
    const recalledDetail = requiredRecord((await request(
      "chat-semantic-recall-result",
      `/api/chats/${recallChatId}`,
      { method: "GET" },
    )).value, "semantic recall saved chat");
    const recalledMessages = requiredArray(
      recalledDetail.messages,
      "semantic recall saved messages",
    );
    const recalledUserIndex = recalledMessages.findIndex((value) => {
      const message = optionalRecord(value);
      return message?.id === recalledUserMessageId &&
        message.role === "user" &&
        message.content === recallPrompt;
    });
    const recalledAssistantIndex = recalledMessages.findIndex((value) => {
      const message = optionalRecord(value);
      return message?.id === recalledAssistantMessageId &&
        message.role === "assistant" &&
        message.content === recalledContent;
    });
    if (
      recalledFinalized.ok !== true ||
      recalledUserIndex < 0 ||
      recalledAssistantIndex !== recalledUserIndex + 1
    ) {
      throw new Error("Authenticated semantic recall did not survive exact message readback.");
    }
    await options.memoryHotPath.requireSemanticTurnHydrated(recalled.trace);
    semanticTurnHydrated = true;

    const legacyPrompt = "Give one concise example of retrieval practice in a history lesson.";
    const legacy = await request("chat-legacy-provider", "/api/chat", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        chatId,
        content: legacyPrompt,
      }),
    });
    if (!legacy.response.headers.get("content-type")?.includes("text/plain") || !legacy.text.trim()) {
      throw new Error("Legacy authenticated provider response was not a persisted text answer.");
    }
    const legacyAiRunId = requireResponseUuid(legacy.response, "x-inspir-ai-run-id");
    const legacyUserMessageId = requireResponseUuid(
      legacy.response,
      "x-inspir-user-message-id",
    );
    const legacyAssistantMessageId = requireResponseUuid(
      legacy.response,
      "x-inspir-assistant-message-id",
    );
    const legacyDetail = requiredRecord((await request(
      "chat-legacy-result",
      `/api/chats/${chatId}`,
      { method: "GET" },
    )).value, "legacy saved chat");
    const legacyMessages = requiredArray(
      legacyDetail.messages,
      "legacy saved messages",
    );
    const legacyUserIndex = legacyMessages.findIndex((value) => {
      const message = optionalRecord(value);
      return message?.id === legacyUserMessageId &&
        message.role === "user" &&
        message.content === legacyPrompt;
    });
    const legacyAssistantIndex = legacyMessages.findIndex((value) => {
      const message = optionalRecord(value);
      return message?.id === legacyAssistantMessageId &&
        message.role === "assistant" &&
        message.content === legacy.text;
    });
    legacyAnswerPersisted =
      Boolean(legacyAiRunId) &&
      legacyUserIndex >= 0 &&
      legacyAssistantIndex === legacyUserIndex + 1;
    if (!legacyAnswerPersisted) {
      throw new Error("Legacy authenticated answer was not persisted before response completion.");
    }

    const memoryCreated = requiredRecord((await request("memory-create", "/api/memory", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-inspir-state-contract": "incremental-v2",
      },
      body: JSON.stringify({
        category: "preferences",
        content: "Use concise worked examples when explaining difficult ideas.",
      }),
    }, 201)).value, "created memory");
    const memory = requiredRecord(memoryCreated.memory, "created memory item");
    const memoryId = requiredUuid(memory.id, "created memory ID");
    const updatedMemoryContent = "Use concise worked examples and one retrieval question.";
    const memoryUpdated = requiredRecord((await request(
      "memory-update",
      `/api/memory/${memoryId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "preferences",
          content: updatedMemoryContent,
          tags: ["validation"],
          pinned: true,
          doNotMention: false,
        }),
      },
    )).value, "updated memory");
    if (requiredRecord(memoryUpdated.memory, "updated memory item").content !== updatedMemoryContent) {
      throw new Error("Disposable memory update did not persist.");
    }
    const memoryDashboard = requiredRecord((await request(
      "memory-list",
      "/api/memory",
      { method: "GET" },
    )).value, "memory dashboard");
    if (!requiredArray(memoryDashboard.memories, "memory dashboard items").some((value) => {
      const item = optionalRecord(value);
      return item?.id === memoryId && item.content === updatedMemoryContent;
    })) {
      throw new Error("Disposable memory CRUD was not visible in the saved-memory result.");
    }
    const sourceFeedback = requiredRecord((await request(
      "memory-source-feedback",
      "/api/memory/source-feedback",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memoryId,
          action: "dont_mention",
          note: "Authenticated resource validation suppression.",
        }),
      },
    )).value, "memory source feedback");
    const memoryAfterFeedback = requiredRecord((await request(
      "memory-after-source-feedback",
      "/api/memory",
      { method: "GET" },
    )).value, "memory after source feedback");
    sourceFeedbackVerified = sourceFeedback.ok === true &&
      requiredArray(memoryAfterFeedback.memories, "memory items after source feedback")
        .some((value) => {
          const item = optionalRecord(value);
          return item?.id === memoryId && item.doNotMention === true;
        });
    if (!sourceFeedbackVerified) {
      throw new Error("Disposable source feedback did not suppress its owned memory.");
    }
    const memoryDeleted = requiredRecord((await request(
      "memory-delete",
      `/api/memory/${memoryId}`,
      { method: "DELETE" },
    )).value, "deleted memory");
    const memoryAfterDelete = requiredRecord((await request(
      "memory-after-delete",
      "/api/memory",
      { method: "GET" },
    )).value, "memory after delete");
    memoryCrudVerified = memoryDeleted.ok === true &&
      !requiredArray(memoryAfterDelete.memories, "memory items after delete")
        .some((value) => optionalRecord(value)?.id === memoryId);
    if (!memoryCrudVerified) throw new Error("Disposable memory CRUD did not complete cleanly.");

    const quizTopic = "El ciclo del agua";
    const quizChatId = await createChat(request, "quiz-me-on-trivia", "quiz-chat-create");
    let quizActivity = activityRun((await request("quiz-create", "/api/activities/quiz", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: quizChatId, topic: quizTopic }),
    })).value, "quiz");
    const quizId = requiredUuid(quizActivity.id, "quiz activity ID");
    for (let step = 0; step < 15; step += 1) {
      const state = requiredRecord(quizActivity.state, "quiz state");
      if (state.completed === true) break;
      quizActivity = activityRun((await request(
        `quiz-answer-${step}`,
        `/api/activities/quiz/${quizId}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answerIndex: 0 }),
        },
      )).value, "quiz");
    }
    const quizState = requiredRecord(quizActivity.state, "completed quiz state");
    quizCompleted = quizActivity.status === "completed" && quizState.completed === true;
    if (!quizCompleted) throw new Error("Quiz did not reach its complete result state.");
    savedQuizResultVerified = await verifySavedActivity(
      request,
      quizChatId,
      quizId,
      "quiz",
      "quiz-result",
      quizTopic,
    );

    const flashcardTopic = "La fotosíntesis";
    const flashcardSource = "Las plantas usan la energía de la luz para convertir dióxido de carbono y agua en glucosa y oxígeno.";
    const flashChatId = await createChat(request, "flashcard-builder", "flashcard-chat-create");
    let flashActivity = activityRun((await request("flashcard-create", "/api/activities/flashcards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: flashChatId,
        topic: flashcardTopic,
        source: flashcardSource,
      }),
    })).value, "flashcards");
    const flashId = requiredUuid(flashActivity.id, "flashcard activity ID");
    for (let step = 0; step < 20; step += 1) {
      const state = requiredRecord(flashActivity.state, "flashcard state");
      if (state.completed === true) break;
      flashActivity = activityRun((await request(
        `flashcard-reveal-${step}`,
        `/api/activities/flashcards/${flashId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reveal" }),
        },
      )).value, "flashcards");
      flashActivity = activityRun((await request(
        `flashcard-rate-${step}`,
        `/api/activities/flashcards/${flashId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "rate", rating: "known" }),
        },
      )).value, "flashcards");
    }
    const flashState = requiredRecord(flashActivity.state, "completed flashcard state");
    flashcardsCompleted = flashActivity.status === "completed" && flashState.completed === true;
    if (!flashcardsCompleted) throw new Error("Flashcards did not reach their complete result state.");
    savedFlashcardResultVerified = await verifySavedActivity(
      request,
      flashChatId,
      flashId,
      "flashcards",
      "flashcard-result",
      flashcardTopic,
      flashcardSource,
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (disposableCreated && !profilePhotoDeleted) {
      try {
        const cleanupPhoto = requiredRecord((await request(
          "cleanup-profile-photo",
          "/api/me/photo",
          { method: "DELETE" },
        )).value, "cleanup profile photo");
        if (cleanupPhoto.profileImageHash !== null) {
          throw new Error("Cleanup profile-photo delete returned the wrong pointer contract.");
        }
        await request(
          "verify-cleanup-profile-photo",
          "/api/me/photo",
          { method: "GET" },
          404,
        );
        profilePhotoDeleted = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (sourceChatId) {
      let deletionMutationError: unknown = null;
      try {
        const deleted = requiredRecord((await request(
          "delete-stored-memory-source-chat",
          `/api/chats/${sourceChatId}`,
          { method: "DELETE" },
        )).value, "stored-memory source chat deletion");
        if (deleted.ok !== true) {
          throw new Error("Owned source chat deletion did not return its success contract.");
        }
      } catch (error) {
        deletionMutationError = error;
      }
      try {
        await request(
          "verify-stored-memory-source-chat-deleted",
          `/api/chats/${sourceChatId}`,
          { method: "GET" },
          404,
        );
        sourceChatDeleted = true;
      } catch (error) {
        if (deletionMutationError) cleanupErrors.push(deletionMutationError);
        cleanupErrors.push(error);
      }
    }
    if (sourceChatId && !sourceChatDeleted) {
      cleanupErrors.push(new Error(
        "Refusing hidden disposable D1 cleanup before owned source-chat deletion is proven.",
      ));
    } else {
      try {
        await options.memoryHotPath.requestVectorCleanupDrain();
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (knownTurnVectorId) {
        try {
          await options.memoryHotPath.requireKnownVectorAbsent(knownTurnVectorId);
          knownVectorAbsentAfterCleanup = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        await cleanupDisposableMutationState({
          cleanup: async () => {
            const proof = cleanupProof(
              options.authSecret,
              options.expectedVersion,
              options.runId,
              expectedIdentity.userId,
            );
            const cleanup = await request("cleanup-disposable", "/api/migration/e2e-auth", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-migration-e2e-auth-secret": options.authSecret,
                "x-migration-e2e-cleanup-proof": proof,
              },
              body: mutationBody("cleanup-disposable", expectedIdentity.userId),
            });
            assertAuthenticatedMutationResponseProof(
              cleanup.value,
              {
                candidateVersionId: options.expectedVersion,
                runId: options.runId,
                runtimeVersionId: options.expectedVersion,
              },
              "disposable cleanup",
            );
          },
          inspect: async () => {
            const inspectedResponse = await request(
              "verify-disposable-cleanup",
              "/api/migration/e2e-auth",
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-migration-e2e-auth-secret": options.authSecret,
                },
                body: mutationBody("verify-disposable-cleanup", expectedIdentity.userId),
              },
            );
            const inspected = assertAuthenticatedMutationResponseProof(
              inspectedResponse.value,
              {
                candidateVersionId: options.expectedVersion,
                runId: options.runId,
                runtimeVersionId: options.expectedVersion,
              },
              "cleanup verification",
            ).payload;
            const inventory = exactDisposableInventory(inspected.inventory);
            return { ok: inspected.ok === true && inventoryIsZero(inventory), inventory };
          },
          outboxDrain: {
            wake: options.memoryHotPath.requestVectorCleanupDrain,
            maximumAttempts: authenticatedOutboxDrainMaximumAttempts,
            retryDelayMs: authenticatedOutboxDrainRetryDelayMs,
          },
        });
        cleanupVerified = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  const failures = [primaryError, ...cleanupErrors].filter(
    (value): value is NonNullable<typeof value> => value !== null,
  );
  if (failures.length) {
    throw new AggregateError(failures, "Authenticated mutation flow did not complete safely.");
  }
  return {
    adminUsersMutationVerified,
    adminTopicsMutationVerified,
    chatFinalized,
    profileMutationVerified,
    profilePhotoVerified,
    profilePhotoDeleted,
    sourceFeedbackVerified,
    analyticsEventVerified,
    spanishActivityBundleVerified,
    legacyAnswerPersisted,
    memoryCrudVerified,
    quizCompleted,
    flashcardsCompleted,
    savedQuizResultVerified,
    savedFlashcardResultVerified,
    queueStored,
    knownVectorPresentBeforeRecall,
    semanticTurnHydrated,
    sourceChatDeleted,
    knownVectorAbsentAfterCleanup,
    cleanupVerified,
  };
}

export async function cleanupDisposableMutationState(options: {
  cleanup: () => Promise<void>;
  inspect: () => Promise<{ ok: boolean; inventory: Record<string, unknown> }>;
  maximumAttempts?: number;
  outboxDrain?: {
    wake: () => Promise<void>;
    maximumAttempts: number;
    retryDelayMs: number;
    wait?: (milliseconds: number) => Promise<void>;
  };
}) {
  const maximumAttempts = options.maximumAttempts ?? cleanupAttemptLimit;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 5) {
    throw new Error("Disposable cleanup attempt limit is invalid.");
  }
  if (
    options.outboxDrain &&
    (
      !Number.isSafeInteger(options.outboxDrain.maximumAttempts) ||
      options.outboxDrain.maximumAttempts < 1 ||
      options.outboxDrain.maximumAttempts > 360 ||
      !Number.isSafeInteger(options.outboxDrain.retryDelayMs) ||
      options.outboxDrain.retryDelayMs < 1 ||
      options.outboxDrain.retryDelayMs > 60_000
    )
  ) {
    throw new Error("Disposable Vectorize outbox drain bounds are invalid.");
  }
  let cleanupAttempts = 0;
  let ordinaryResidueAttempts = 0;
  let outboxDrainAttempts = 0;
  for (;;) {
    cleanupAttempts += 1;
    try {
      await options.cleanup();
    } catch {
      // Never retry a mutation based only on a transport error. The readback
      // below decides whether another cleanup transaction is authorized.
    }
    let readback: Awaited<ReturnType<typeof options.inspect>>;
    try {
      readback = await options.inspect();
    } catch {
      throw new Error("Disposable cleanup is indeterminate because authoritative readback failed.");
    }
    const inventory = exactDisposableInventory(readback.inventory);
    if (readback.ok && inventoryIsZero(inventory)) {
      return { cleanupAttempts, inventory };
    }
    if (inventory.memory_vector_cleanup_outbox > 0 && options.outboxDrain) {
      outboxDrainAttempts += 1;
      if (outboxDrainAttempts >= options.outboxDrain.maximumAttempts) {
        throw new Error(
          "Disposable cleanup could not drain owner-scoped Vectorize cleanup residue.",
        );
      }
      const wakeEveryAttempts = Math.max(
        1,
        Math.ceil(vectorCleanupMinimumSettleMs / options.outboxDrain.retryDelayMs),
      );
      if (outboxDrainAttempts === 1 || outboxDrainAttempts % wakeEveryAttempts === 0) {
        await options.outboxDrain.wake();
      }
      await (options.outboxDrain.wait ?? delay)(options.outboxDrain.retryDelayMs);
      continue;
    }
    ordinaryResidueAttempts += 1;
    if (ordinaryResidueAttempts >= maximumAttempts) {
      throw new Error("Disposable cleanup left nonzero production residue.");
    }
  }
}

export async function runAuthenticatedMemoryRecoveryCleanup(input: {
  preD1VectorCleanup?: () => Promise<void>;
  authoritativeD1Cleanup: () => Promise<void>;
  postD1VectorCleanup?: () => Promise<void>;
}) {
  const hasPreCleanup = input.preD1VectorCleanup !== undefined;
  const hasPostCleanup = input.postD1VectorCleanup !== undefined;
  if (hasPreCleanup !== hasPostCleanup) {
    throw new Error("Authenticated memory recovery requires both pre- and post-D1 vector cleanup.");
  }
  if (input.preD1VectorCleanup) await input.preD1VectorCleanup();
  await input.authoritativeD1Cleanup();
  if (input.postD1VectorCleanup) await input.postD1VectorCleanup();
}

export function resolveAuthenticatedMemoryRecoveryVersion(input: {
  manifestAuthenticatedVersionId: string | null;
  currentVersionId: string;
  memoryRecoveryEvidenceExists: boolean;
}) {
  if (input.memoryRecoveryEvidenceExists && !input.manifestAuthenticatedVersionId) {
    throw new Error(
      "Recovery found memory Queue evidence without its bound authenticated validation version.",
    );
  }
  return input.manifestAuthenticatedVersionId ?? input.currentVersionId;
}

export function evaluateAuthenticatedMutationTail(
  source: string,
  expected: readonly AuthenticatedMutationTrace[],
  authenticatedValidationVersionId: string,
  input: {
    tailDiagnostics?: string;
    tailOutputClosed?: boolean;
  } = {},
): AuthenticatedMutationTailEvaluation {
  const parsed = parseTailJsonStream(source, input.tailOutputClosed !== false);
  const problems: string[] = [];
  if (parsed.problem) problems.push(parsed.problem);
  if (authenticatedTailCaptureHasLoss(parsed.records, input.tailDiagnostics ?? "")) {
    problems.push("tail-capture-loss");
  }
  const invocations = parsed.records.flatMap((value) => {
    const record = optionalRecord(value);
    const event = optionalRecord(record?.event);
    const fetchEvent = parseAuthenticatedTailFetchEvent(event);
    const request = optionalRecord(event?.request);
    const response = optionalRecord(event?.response);
    if (typeof request?.url !== "string") return [];
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return [];
    }
    const exceptions = Array.isArray(record?.exceptions) ? record.exceptions : null;
    const scriptVersion = optionalRecord(record?.scriptVersion);
    const logArrayValid = authenticatedTailLogsHaveValidShape(record?.logs);
    const logs = logArrayValid && Array.isArray(record?.logs) ? record.logs : [];
    const warningOrErrorLogCount = logs.filter((value) => {
      const level = authenticatedTailLogLevel(value);
      return level === "warn" || level === "error";
    }).length;
    return [{
      probe: url.searchParams.get(mutationProbeParameter),
      origin: url.origin,
      requestKey: `${url.pathname}${url.search}`,
      urlEnvelopeValid: url.username === "" &&
        url.password === "" &&
        url.hash === "",
      eventShapeValid: fetchEvent !== null,
      path: url.pathname,
      routeTemplate: normalizeAuthenticatedMutationRoute(url.pathname),
      method: typeof request.method === "string" ? request.method : null,
      status: finiteNumber(response?.status),
      outcome: typeof record?.outcome === "string" ? record.outcome : null,
      cpuTimeMs: finiteNumber(record?.cpuTime),
      wallTimeMs: finiteNumber(record?.wallTime),
      eventTimestamp: nonNegativeSafeInteger(record?.eventTimestamp),
      scriptName: typeof record?.scriptName === "string" ? record.scriptName : null,
      scriptVersionId: typeof scriptVersion?.id === "string" ? scriptVersion.id : null,
      truncated: typeof record?.truncated === "boolean" ? record.truncated : null,
      exceptionCount: exceptions?.length ?? null,
      logArrayValid,
      warningOrErrorLogCount,
    }];
  });
  const samples: AuthenticatedMutationTailSample[] = [];
  if (parsed.records.some((value) => {
    const outcome = optionalRecord(value)?.outcome;
    return typeof outcome === "string" && /^(?:exceededCpu|exceededMemory)$/i.test(outcome);
  })) {
    problems.push("forbidden-resource-event");
  }
  for (const trace of expected) {
    const matches = invocations.filter((invocation) => invocation.probe === trace.probe);
    if (matches.length !== 1) {
      problems.push(`${trace.label}:tail-count=${matches.length}`);
      continue;
    }
    const invocation = matches[0];
    const sample: AuthenticatedMutationTailSample = {
      label: trace.label,
      ...invocation,
      probe: trace.probe,
    };
    samples.push(sample);
    if (invocation.routeTemplate !== trace.routeTemplate) problems.push(`${trace.label}:tail-route`);
    if (!invocation.urlEnvelopeValid) problems.push(`${trace.label}:tail-url-envelope`);
    if (!invocation.eventShapeValid) problems.push(`${trace.label}:tail-event-shape`);
    if (invocation.origin !== trace.origin) problems.push(`${trace.label}:tail-origin`);
    const redactedRequestKey = authenticatedMutationRedactedRequestKey(trace.requestKey);
    if (
      invocation.requestKey !== trace.requestKey &&
      invocation.requestKey !== redactedRequestKey
    ) {
      problems.push(`${trace.label}:tail-request-key`);
    }
    if (invocation.method !== trace.method) problems.push(`${trace.label}:tail-method`);
    if (invocation.status !== trace.status) problems.push(`${trace.label}:tail-status`);
    if (invocation.scriptName !== workerName) problems.push(`${trace.label}:script`);
    if (invocation.scriptVersionId !== authenticatedValidationVersionId) {
      problems.push(`${trace.label}:version`);
    }
    if (invocation.truncated !== false) problems.push(`${trace.label}:truncated`);
    if (invocation.outcome !== "ok") problems.push(`${trace.label}:outcome`);
    if (invocation.exceptionCount !== 0) problems.push(`${trace.label}:exception`);
    if (!invocation.logArrayValid) problems.push(`${trace.label}:log-shape`);
    if (invocation.warningOrErrorLogCount !== 0) {
      problems.push(`${trace.label}:warning-or-error-log`);
    }
    if (invocation.cpuTimeMs === null) problems.push(`${trace.label}:missing-cpu`);
    else if (invocation.cpuTimeMs < 0) problems.push(`${trace.label}:cpu<0`);
    else if (invocation.cpuTimeMs >= authenticatedMutationCpuThresholdMs) {
      problems.push(`${trace.label}:cpu>=${authenticatedMutationCpuThresholdMs}`);
    }
    if (invocation.wallTimeMs === null || invocation.wallTimeMs < 0) {
      problems.push(`${trace.label}:missing-or-negative-wall-time`);
    }
    if (invocation.eventTimestamp === null) {
      problems.push(`${trace.label}:invalid-event-timestamp`);
    }
  }
  return { ok: problems.length === 0, samples, problems };
}

export function evaluateAuthenticatedCriticalResourceTail(
  traces: readonly AuthenticatedMutationTrace[],
  samples: readonly AuthenticatedMutationTailSample[],
  authenticatedValidationVersionId: string,
): AuthenticatedCriticalResourceTailEvaluation {
  const problems: string[] = [];
  for (const requirement of authenticatedCriticalResourceTraceRequirements) {
    const matchingTraces = traces.filter((trace) => trace.label === requirement.label);
    if (matchingTraces.length !== 1) {
      problems.push(`${requirement.label}:required-trace-count=${matchingTraces.length}`);
      continue;
    }
    const trace = matchingTraces[0];
    if (trace.routeTemplate !== requirement.routeTemplate) {
      problems.push(`${requirement.label}:required-route`);
    }
    if (trace.method !== requirement.method) {
      problems.push(`${requirement.label}:required-method`);
    }
    if (trace.status !== requirement.status) {
      problems.push(`${requirement.label}:required-status`);
    }

    const matchingSamples = samples.filter(
      (sample) => sample.label === requirement.label && sample.probe === trace.probe,
    );
    if (matchingSamples.length !== 1) {
      problems.push(`${requirement.label}:required-tail-count=${matchingSamples.length}`);
      continue;
    }
    const sample = matchingSamples[0];
    if (sample.routeTemplate !== requirement.routeTemplate) {
      problems.push(`${requirement.label}:tail-route`);
    }
    if (sample.method !== requirement.method) {
      problems.push(`${requirement.label}:tail-method`);
    }
    if (sample.status !== requirement.status) {
      problems.push(`${requirement.label}:tail-status`);
    }
    if (sample.scriptName !== workerName) {
      problems.push(`${requirement.label}:tail-script`);
    }
    if (sample.scriptVersionId !== authenticatedValidationVersionId) {
      problems.push(`${requirement.label}:tail-version`);
    }
    if (sample.outcome !== "ok") {
      problems.push(`${requirement.label}:tail-outcome`);
    }
    if (sample.truncated !== false) {
      problems.push(`${requirement.label}:tail-truncated`);
    }
    if (sample.exceptionCount !== 0) {
      problems.push(`${requirement.label}:tail-exception`);
    }
    if (!sample.logArrayValid || sample.warningOrErrorLogCount !== 0) {
      problems.push(`${requirement.label}:tail-log`);
    }
    if (sample.cpuTimeMs === null || sample.cpuTimeMs < 0) {
      problems.push(`${requirement.label}:tail-cpu-missing-or-negative`);
    } else if (sample.cpuTimeMs >= authenticatedMutationCpuThresholdMs) {
      problems.push(`${requirement.label}:tail-cpu>=${authenticatedMutationCpuThresholdMs}`);
    }
  }
  return {
    ok: problems.length === 0,
    requiredRouteCount: authenticatedCriticalResourceTraceRequirements.length,
    problems,
  };
}

export function evaluateAuthenticatedMemoryQueueTail(
  source: string,
  input: {
    authenticatedValidationVersionId: string;
    userId: string;
    captureOutputOffset?: number;
    observationEndedAt?: number;
    successObservedAt?: number;
    settledLivenessProbe?: string;
    tailDiagnostics?: string;
    tailOutputClosed?: boolean;
  },
): AuthenticatedMemoryQueueTailEvaluation {
  const captureOutputOffset = input.captureOutputOffset ?? 0;
  const resourceWindow = evaluateAuthenticatedMemoryQueueResourceWindow(source, {
    authenticatedValidationVersionId: input.authenticatedValidationVersionId,
    captureOutputOffset,
    tailDiagnostics: input.tailDiagnostics,
    tailOutputClosed: input.tailOutputClosed,
  });
  const problems = new Set(resourceWindow.problems);
  const parsed = parseAuthenticatedTailWindow(
    source,
    captureOutputOffset,
    input.tailOutputClosed !== false,
  );
  const queueRecords = parsed.records.flatMap((value) => {
    const record = optionalRecord(value);
    const event = optionalRecord(record?.event);
    if (!record) return [];
    const logs = structuredTailLogRecords(record.logs);
    const correlated = logs.some((log) =>
      log.userId === input.userId &&
      log.type === "memory.post_turn.v2"
    );
    if (event?.queue !== MEMORY_POST_TURN_QUEUE_NAME && !correlated) return [];
    return correlated ? [{ record, event, logs }] : [];
  });
  if (queueRecords.length !== 1) problems.add(`matched-events=${queueRecords.length}`);
  const match = queueRecords.length === 1 ? queueRecords[0] : undefined;
  const record = match?.record;
  const event = match?.event;
  const logs = match?.logs ?? [];
  const scriptVersion = optionalRecord(record?.scriptVersion);
  const cpuTimeMs = finiteNumber(record?.cpuTime);
  const processed = logs.filter((log) =>
    log.event === "native_memory_queue_processed" &&
    log.type === "memory.post_turn.v2" &&
    log.userId === input.userId
  );
  const indexed = logs.filter((log) => log.event === "native_memory_vectors_indexed");
  const storedLogValid = processed.length === 1 &&
    validStoredMemoryProcessedLog(processed[0], input.userId);
  const indexedLogValid = indexed.length === 1 && validStoredMemoryIndexedLog(indexed[0]);
  const indexedVectorCount = indexedLogValid ? nonNegativeSafeInteger(indexed[0]?.count) : null;

  if (record) {
    if (record.scriptName !== workerName) problems.add("wrong-script");
    if (scriptVersion?.id !== input.authenticatedValidationVersionId) {
      problems.add("wrong-authenticated-validation-version");
    }
    if (record.outcome !== "ok") problems.add("outcome");
    if (record.truncated !== false) problems.add("truncated");
    if (!Array.isArray(record.exceptions) || record.exceptions.length !== 0) {
      problems.add("exceptions");
    }
    if (cpuTimeMs === null || cpuTimeMs < 0) problems.add("missing-or-negative-cpu");
    else if (cpuTimeMs >= authenticatedMutationCpuThresholdMs) problems.add("cpu>=8");
    if (tailInvocationHasForbiddenMemoryWarning(record)) problems.add("failure-log");
  }
  if (event && event.batchSize !== 1) problems.add("queue-batch-size");
  if (processed.length !== 1) problems.add(`stored-log-count=${processed.length}`);
  else if (!storedLogValid) problems.add("malformed-stored-log");
  if (indexed.length !== 1) problems.add(`indexed-log-count=${indexed.length}`);
  else if (!indexedLogValid) problems.add("malformed-indexed-log");
  if (indexedVectorCount === null || indexedVectorCount < 1) {
    problems.add("indexed-vector-count");
  }
  const contentProblems = [...problems];
  const successfulEvents = queueRecords.length === 1 && contentProblems.length === 0 ? 1 : 0;
  const quietWindow = authenticatedLocalQuietWindow(input);
  for (const problem of quietWindow.problems) problems.add(problem);
  const settledLivenessProbe = input.settledLivenessProbe ?? null;
  if (
    input.settledLivenessProbe !== undefined &&
    !authenticatedTailHasReadinessProbe(
      source.slice(captureOutputOffset),
      input.settledLivenessProbe,
      input.authenticatedValidationVersionId,
      input.tailOutputClosed !== false,
    )
  ) {
    problems.add("settled-liveness-marker");
  }
  const nonFatalProblems = new Set([
    "matched-events=0",
    "stored-log-count=0",
    "indexed-log-count=0",
    "indexed-vector-count",
  ]);
  const fatal = [...problems].some((problem) => !nonFatalProblems.has(problem));
  const settled = !fatal && successfulEvents === 1 && quietWindow.settled;
  if (successfulEvents === 1 && !settled && !fatal) {
    problems.add("queue-observation-not-settled");
  }
  const exactProblems = [...problems];

  return {
    ok: settled && exactProblems.length === 0,
    fatal,
    settled,
    authenticatedValidationVersionId: input.authenticatedValidationVersionId,
    captureOutputOffset,
    observationEndedAt: quietWindow.observationEndedAt,
    successObservedAt: quietWindow.successObservedAt,
    settledLivenessProbe,
    matchedEvents: queueRecords.length,
    successfulEvents,
    cpuTimeMs,
    indexedVectorCount,
    problems: exactProblems,
  };
}

export function evaluateAuthenticatedMemoryVectorCleanupQueueTail(
  source: string,
  input: {
    authenticatedValidationVersionId: string;
    captureOutputOffset?: number;
    reason: string;
    observationEndedAt?: number;
    successObservedAt?: number;
    settledLivenessProbe?: string;
    tailDiagnostics?: string;
    tailOutputClosed?: boolean;
  },
): AuthenticatedMemoryVectorCleanupQueueTailEvaluation {
  const captureOutputOffset = input.captureOutputOffset ?? 0;
  const resourceWindow = evaluateAuthenticatedMemoryQueueResourceWindow(source, {
    ...input,
    captureOutputOffset,
  });
  const fatalProblems = new Set(
    resourceWindow.problems.filter((problem) => problem !== "matched-events=0"),
  );
  if (!/^[a-z0-9-]{1,80}$/.test(input.reason)) fatalProblems.add("invalid-cleanup-reason");

  const parsed = parseAuthenticatedTailWindow(
    source,
    captureOutputOffset,
    input.tailOutputClosed !== false,
  );
  const queueRecords = parsed.records.flatMap((value, sourceOrder) => {
    const record = optionalRecord(value);
    const event = optionalRecord(record?.event);
    if (!record) return [];
    const eventTimestamp = nonNegativeSafeInteger(record.eventTimestamp);
    const logs = structuredTailLogRecords(record.logs);
    const starts = logs.filter((log) =>
      log.event === "native_memory_vector_cleanup_started" && log.reason === input.reason
    );
    const terminals = logs.filter((log) =>
      log.reason === input.reason &&
      (log.event === "native_memory_queue_processed" ||
        log.event === "native_memory_vector_cleanup_lease_deferred" ||
        log.event === "native_memory_queue_failed")
    );
    if (
      event?.queue !== MEMORY_POST_TURN_QUEUE_NAME &&
      starts.length === 0 &&
      terminals.length === 0
    ) return [];
    return starts.length > 0 || terminals.length > 0
      ? [{ record, logs, starts, terminals, eventTimestamp, sourceOrder }]
      : [];
  });

  let processedEvents = 0;
  let deferredEvents = 0;
  let failedEvents = 0;
  const correlatedSamples: Array<{
    sample: AuthenticatedMemoryVectorCleanupQueueTailSample;
    sourceOrder: number;
  }> = [];
  for (const { record, starts, terminals, eventTimestamp, sourceOrder } of queueRecords) {
    const cpuTimeMs = finiteNumber(record.cpuTime);
    processedEvents += terminals.filter((log) => log.event === "native_memory_queue_processed").length;
    deferredEvents += terminals.filter(
      (log) => log.event === "native_memory_vector_cleanup_lease_deferred",
    ).length;
    failedEvents += terminals.filter((log) => log.event === "native_memory_queue_failed").length;

    const start = starts.length === 1 ? starts[0] : undefined;
    const terminalLog = terminals.length === 1 ? terminals[0] : undefined;
    if (starts.length !== 1) fatalProblems.add(`cleanup-start-log-count=${starts.length}`);
    if (terminals.length !== 1) {
      fatalProblems.add(`cleanup-terminal-log-count=${terminals.length}`);
    }
    if (start && !validVectorCleanupStartLog(start, input.reason)) {
      fatalProblems.add("malformed-cleanup-start-log");
    }

    let terminal: AuthenticatedMemoryVectorCleanupQueueTailSample["terminal"] =
      terminals.length === 0 ? "missing" : terminals.length > 1 ? "multiple" : "missing";
    let pending: number | null = null;
    let nextDelaySeconds: number | null = null;
    if (terminalLog?.event === "native_memory_queue_processed") {
      terminal = "processed";
      const outcome = parsedProcessedVectorCleanupOutcome(terminalLog, input.reason);
      if (!outcome) fatalProblems.add("malformed-cleanup-processed-log");
      else {
        pending = outcome.pending;
        nextDelaySeconds = outcome.nextDelaySeconds;
      }
    } else if (terminalLog?.event === "native_memory_vector_cleanup_lease_deferred") {
      terminal = "deferred";
      if (!validDeferredVectorCleanupLog(terminalLog, input.reason)) {
        fatalProblems.add("malformed-cleanup-deferred-log");
      } else {
        nextDelaySeconds = nonNegativeSafeInteger(terminalLog.delaySeconds);
      }
    } else if (terminalLog?.event === "native_memory_queue_failed") {
      terminal = "failed";
      fatalProblems.add("failure-log");
      if (!validFailedVectorCleanupLog(terminalLog, input.reason)) {
        fatalProblems.add("malformed-cleanup-failed-log");
      }
    }

    const startMessageId = isNonEmptyString(start?.messageId) ? start.messageId : null;
    const terminalMessageId = isNonEmptyString(terminalLog?.messageId)
      ? terminalLog.messageId
      : null;
    const startAttempts = positiveSafeInteger(start?.attempts) ? start.attempts : null;
    const terminalAttempts = positiveSafeInteger(terminalLog?.attempts)
      ? terminalLog.attempts
      : null;
    if (
      start && terminalLog &&
      (startMessageId === null || terminalMessageId !== startMessageId ||
        startAttempts === null || terminalAttempts !== startAttempts)
    ) {
      fatalProblems.add("cleanup-start-terminal-identity");
    }
    correlatedSamples.push({
      sourceOrder,
      sample: {
        reason: input.reason,
        messageId: startMessageId ?? terminalMessageId,
        attempts: startAttempts ?? terminalAttempts,
        eventTimestamp,
        outcome: typeof record.outcome === "string" ? record.outcome : null,
        cpuTimeMs,
        terminal,
        pending,
        nextDelaySeconds,
      },
    });
  }

  correlatedSamples.sort((left, right) => left.sourceOrder - right.sourceOrder);
  const samples = correlatedSamples.map(({ sample }) => sample);
  const lastAttemptByMessageId = new Map<string, number>();
  for (const [index, sample] of samples.entries()) {
    if (!sample.messageId || sample.attempts === null) {
      fatalProblems.add("cleanup-attempt-sequence");
      continue;
    }
    const previous = lastAttemptByMessageId.get(sample.messageId);
    if (
      (previous === undefined && sample.attempts !== 1) ||
      (previous !== undefined && sample.attempts !== previous + 1)
    ) {
      fatalProblems.add("cleanup-attempt-sequence");
    }
    lastAttemptByMessageId.set(sample.messageId, sample.attempts);
    const previousSample = samples[index - 1];
    if (!previousSample) continue;
    if (previousSample.terminal === "processed" && previousSample.pending === 0) {
      fatalProblems.add("cleanup-event-after-settlement");
    } else if (
      previousSample.terminal === "deferred" &&
      (sample.messageId !== previousSample.messageId ||
        sample.attempts !== (previousSample.attempts ?? 0) + 1)
    ) {
      fatalProblems.add("cleanup-retry-discontinuity");
    } else if (
      previousSample.terminal === "processed" &&
      previousSample.pending === 1 &&
      (sample.messageId === previousSample.messageId || sample.attempts !== 1)
    ) {
      fatalProblems.add("cleanup-continuation-discontinuity");
    }
  }
  const quietWindow = authenticatedLocalQuietWindow(input);
  for (const problem of quietWindow.problems) fatalProblems.add(problem);
  const settledLivenessProbe = input.settledLivenessProbe ?? null;
  if (
    input.settledLivenessProbe !== undefined &&
    !authenticatedTailHasReadinessProbe(
      source.slice(captureOutputOffset),
      input.settledLivenessProbe,
      input.authenticatedValidationVersionId,
      input.tailOutputClosed !== false,
    )
  ) {
    fatalProblems.add("settled-liveness-marker");
  }
  const fatal = fatalProblems.size > 0;
  const latest = samples.at(-1);
  const chainComplete = !fatal &&
    latest?.terminal === "processed" &&
    latest.pending === 0 &&
    latest.nextDelaySeconds === null;
  const settled = chainComplete && quietWindow.settled;
  const problems = [...fatalProblems];
  if (samples.length === 0) problems.push("matched-events=0");
  if (!chainComplete) problems.push("cleanup-chain-not-settled");
  else if (!settled) problems.push("cleanup-observation-not-settled");
  return {
    ok: settled && problems.length === 0,
    fatal,
    settled,
    chainComplete,
    reason: input.reason,
    captureOutputOffset,
    observationEndedAt: quietWindow.observationEndedAt,
    successObservedAt: quietWindow.successObservedAt,
    settledLivenessProbe,
    authenticatedValidationVersionId: input.authenticatedValidationVersionId,
    matchedEvents: samples.length,
    processedEvents,
    deferredEvents,
    failedEvents,
    maximumCpuTimeMs: resourceWindow.maximumCpuTimeMs,
    samples,
    problems,
  };
}

export function evaluateAuthenticatedMemoryQueueResourceWindow(
  source: string,
  input: {
    authenticatedValidationVersionId: string;
    captureOutputOffset?: number;
    tailDiagnostics?: string;
    tailOutputClosed?: boolean;
  },
): AuthenticatedMemoryQueueResourceWindowEvaluation {
  const problems = new Set<string>();
  const captureOutputOffset = input.captureOutputOffset ?? 0;
  const parsed = parseAuthenticatedTailWindow(
    source,
    captureOutputOffset,
    input.tailOutputClosed !== false,
  );
  if (parsed.offsetProblem) problems.add(parsed.offsetProblem);
  if (parsed.problem) problems.add(parsed.problem);
  const fullCapture = parseTailJsonStream(source, input.tailOutputClosed !== false);
  if (fullCapture.problem) problems.add(fullCapture.problem);
  const tailCaptureLoss = authenticatedTailCaptureHasLoss(
    fullCapture.records,
    input.tailDiagnostics ?? "",
  );
  if (tailCaptureLoss) problems.add("tail-capture-loss");
  for (const value of parsed.records) {
    const record = optionalRecord(value);
    if (!record) continue;
    const event = optionalRecord(record.event);
    const logs = structuredTailLogRecords(record.logs);
    const memoryQueueLog = logs.some((log) =>
      log.type === "memory.post_turn.v2" ||
      log.type === "memory.vector_cleanup.v1" ||
      log.type === "memory.daily_synthesis.v1"
    );
    const triggerLike = event !== null && [
      "batchSize",
      "cron",
      "consumedEvents",
      "getWebSocketEvent",
      "mailFrom",
      "queue",
      "rawSize",
      "rcptTo",
      "request",
      "response",
      "rpcMethod",
      "scheduledTime",
    ].some((field) => Object.prototype.hasOwnProperty.call(event, field));
    const invocationLike = triggerLike || memoryQueueLog || [
      "cpuTime",
      "eventTimestamp",
      "exceptions",
      "logs",
      "outcome",
      "scriptName",
      "scriptVersion",
      "truncated",
      "wallTime",
    ].some((field) => Object.prototype.hasOwnProperty.call(record, field));
    if (!invocationLike) continue;
    const fetchLike = parseAuthenticatedTailFetchEvent(event) !== null;
    const scheduledLike = event !== null &&
      hasExactRecordKeys(event, ["cron", "scheduledTime"]) &&
      event.cron === "0 3 * * *" &&
      nonNegativeSafeInteger(event.scheduledTime) !== null;
    const queueLike = event !== null && (
      Object.prototype.hasOwnProperty.call(event, "batchSize") ||
      Object.prototype.hasOwnProperty.call(event, "queue")
    );
    if (!fetchLike && !scheduledLike && !queueLike && !memoryQueueLog) {
      problems.add("unclassified-invocation");
    }
    const scriptVersion = optionalRecord(record.scriptVersion);
    if (record.scriptName !== workerName) problems.add("wrong-script");
    if (scriptVersion?.id !== input.authenticatedValidationVersionId) {
      problems.add("wrong-authenticated-validation-version");
    }
    const cpuTimeMs = finiteNumber(record.cpuTime);
    const wallTimeMs = finiteNumber(record.wallTime);
    if (record.outcome !== "ok") problems.add("outcome");
    if (record.truncated !== false) problems.add("truncated");
    if (!Array.isArray(record.exceptions) || record.exceptions.length > 0) {
      problems.add("exceptions");
    }
    if (cpuTimeMs === null || cpuTimeMs < 0) {
      problems.add("missing-or-negative-cpu");
    } else if (cpuTimeMs >= authenticatedMutationCpuThresholdMs) {
      problems.add("cpu>=8");
    }
    if (wallTimeMs === null || wallTimeMs < 0) {
      problems.add("missing-or-negative-wall-time");
    }
    if (nonNegativeSafeInteger(record.eventTimestamp) === null) {
      problems.add("invalid-event-timestamp");
    }
    if (!authenticatedTailLogsHaveValidShape(record.logs)) problems.add("log-shape");
    if (tailInvocationHasForbiddenMemoryWarning(record)) problems.add("failure-log");
  }
  const cpuTimes: number[] = [];
  let matchedEvents = 0;
  for (const value of parsed.records) {
    const record = optionalRecord(value);
    const event = optionalRecord(record?.event);
    if (!record) continue;
    const logs = structuredTailLogRecords(record.logs);
    const memoryQueueLog = logs.some((log) =>
      log.type === "memory.post_turn.v2" ||
      log.type === "memory.vector_cleanup.v1" ||
      log.type === "memory.daily_synthesis.v1"
    );
    const queueLikeEvent = event !== null && (
      Object.prototype.hasOwnProperty.call(event, "queue") ||
      Object.prototype.hasOwnProperty.call(event, "batchSize")
    );
    if (!queueLikeEvent && !memoryQueueLog) continue;
    matchedEvents += 1;
    if (!event || !hasExactRecordKeys(event, ["batchSize", "queue"])) {
      problems.add("queue-event-shape");
    }
    if (event?.queue !== MEMORY_POST_TURN_QUEUE_NAME) problems.add("queue-name");
    const eventTimestamp = nonNegativeSafeInteger(record.eventTimestamp);
    if (eventTimestamp === null) {
      problems.add("invalid-event-timestamp");
    }
    const scriptVersion = optionalRecord(record.scriptVersion);
    const cpuTimeMs = finiteNumber(record.cpuTime);
    if (record.scriptName !== workerName) problems.add("wrong-script");
    if (scriptVersion?.id !== input.authenticatedValidationVersionId) {
      problems.add("wrong-authenticated-validation-version");
    }
    if (record.outcome !== "ok") problems.add("outcome");
    if (record.truncated !== false) problems.add("truncated");
    if (!Array.isArray(record.exceptions) || record.exceptions.length !== 0) {
      problems.add("exceptions");
    }
    if (cpuTimeMs === null || cpuTimeMs < 0) {
      problems.add("missing-or-negative-cpu");
    } else {
      cpuTimes.push(cpuTimeMs);
      if (cpuTimeMs >= authenticatedMutationCpuThresholdMs) problems.add("cpu>=8");
    }
    if (event?.batchSize !== 1) problems.add("queue-batch-size");
    if (tailInvocationHasForbiddenMemoryWarning(record)) problems.add("failure-log");
  }
  if (matchedEvents === 0) problems.add("matched-events=0");
  const exactProblems = [...problems];
  return {
    ok: exactProblems.length === 0,
    authenticatedValidationVersionId: input.authenticatedValidationVersionId,
    captureOutputOffset,
    matchedEvents,
    maximumCpuTimeMs: cpuTimes.length > 0 ? Math.max(...cpuTimes) : null,
    tailCaptureLoss,
    problems: exactProblems,
  };
}

function authenticatedTailCaptureHasLoss(records: readonly unknown[], diagnostics = "") {
  const controlEventLoss = records.some((value) => {
    const event = optionalRecord(optionalRecord(value)?.event);
    return typeof event?.type === "string" &&
      /^(?:overload|sampling|sampled|dropped)(?:$|[-_:.])/i.test(event.type);
  });
  const diagnosticLoss = diagnostics
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) =>
      /^Tail connection lost: the Worker did not respond to a keep-alive ping within \d+ms\.$/i.test(
        line,
      ) ||
      /^Tail connection lost\. Reconnecting \(attempt \d+ of \d+\)(?: in \d+(?:\.\d+)?s)?(?:\.\.\.)?$/i.test(
        line,
      ) ||
      /^Unable to reconnect to the tail for .+ after \d+ attempts\./i.test(line) ||
      /^Tail: reconnect attempt failed:/i.test(line) ||
      /^Tail (?:is |event )?(?:sampling|sampled|dropped)(?: events?)?(?: detected)?[.!]?$/i.test(
        line,
      )
    );
  return controlEventLoss || diagnosticLoss;
}

function parseAuthenticatedTailWindow(
  source: string,
  captureOutputOffset: number,
  closed: boolean,
) {
  if (
    !Number.isSafeInteger(captureOutputOffset) ||
    captureOutputOffset < 0 ||
    captureOutputOffset > source.length
  ) {
    return {
      records: [] as unknown[],
      complete: false,
      consumedLength: 0,
      problem: null,
      offsetProblem: "invalid-capture-output-offset",
    };
  }
  if (captureOutputOffset > 0) {
    const prefix = parseTailJsonStream(source.slice(0, captureOutputOffset), true);
    if (
      prefix.problem ||
      !prefix.complete ||
      prefix.consumedLength !== captureOutputOffset
    ) {
      return {
        records: [] as unknown[],
        complete: false,
        consumedLength: 0,
        problem: null,
        offsetProblem: "invalid-capture-output-offset",
      };
    }
  }
  return {
    ...parseTailJsonStream(source.slice(captureOutputOffset), closed),
    offsetProblem: null,
  };
}

function authenticatedLocalQuietWindow(input: {
  observationEndedAt?: number;
  successObservedAt?: number;
}) {
  const observationEndedAt = nonNegativeFiniteNumber(input.observationEndedAt);
  const successObservedAt = nonNegativeFiniteNumber(input.successObservedAt);
  const problems: string[] = [];
  if (input.observationEndedAt !== undefined && observationEndedAt === null) {
    problems.push("invalid-observation-end");
  }
  if (input.successObservedAt !== undefined && successObservedAt === null) {
    problems.push("invalid-success-observation");
  }
  if (
    observationEndedAt !== null &&
    successObservedAt !== null &&
    observationEndedAt < successObservedAt
  ) {
    problems.push("invalid-local-observation-window");
  }
  return {
    observationEndedAt,
    successObservedAt,
    settled: problems.length === 0 &&
      observationEndedAt !== null &&
      successObservedAt !== null &&
      observationEndedAt - successObservedAt >= authenticatedQueueSettlementQuietPeriodMs,
    problems,
  };
}

function validStoredMemoryProcessedLog(log: Record<string, unknown>, userId: string) {
  return hasExactRecordKeys(
    log,
    ["attempts", "event", "messageId", "outcome", "type", "userId"],
  ) &&
    log.event === "native_memory_queue_processed" &&
    log.type === "memory.post_turn.v2" &&
    log.userId === userId &&
    log.outcome === "stored" &&
    isNonEmptyString(log.messageId) &&
    log.attempts === 1;
}

function validStoredMemoryIndexedLog(log: Record<string, unknown>) {
  const count = nonNegativeSafeInteger(log.count);
  return hasExactRecordKeys(log, ["count", "event", "superseded"]) &&
    log.event === "native_memory_vectors_indexed" &&
    count !== null &&
    count >= 1 &&
    nonNegativeSafeInteger(log.superseded) !== null;
}

function validVectorCleanupStartLog(log: Record<string, unknown>, reason: string) {
  return hasExactRecordKeys(log, ["attempts", "event", "messageId", "reason", "type"]) &&
    log.event === "native_memory_vector_cleanup_started" &&
    log.type === "memory.vector_cleanup.v1" &&
    log.reason === reason &&
    isNonEmptyString(log.messageId) &&
    positiveSafeInteger(log.attempts);
}

function parsedProcessedVectorCleanupOutcome(
  log: Record<string, unknown>,
  reason: string,
): { pending: number; nextDelaySeconds: number | null } | null {
  if (
    !hasExactRecordKeys(
      log,
      ["attempts", "event", "messageId", "outcome", "reason", "type", "userId"],
    ) ||
    log.event !== "native_memory_queue_processed" ||
    log.type !== "memory.vector_cleanup.v1" ||
    log.reason !== reason ||
    log.userId !== null ||
    !isNonEmptyString(log.messageId) ||
    !positiveSafeInteger(log.attempts)
  ) {
    return null;
  }
  const outcome = optionalRecord(log.outcome);
  if (
    !outcome ||
    !hasExactRecordKeys(outcome, [
      "claimed",
      "deleteRequested",
      "nextDelaySeconds",
      "pending",
      "verifiedAbsent",
    ])
  ) {
    return null;
  }
  const claimed = nonNegativeSafeInteger(outcome.claimed);
  const deleteRequested = nonNegativeSafeInteger(outcome.deleteRequested);
  const verifiedAbsent = nonNegativeSafeInteger(outcome.verifiedAbsent);
  const pending = nonNegativeSafeInteger(outcome.pending);
  const nextDelaySeconds = nonNegativeSafeInteger(outcome.nextDelaySeconds);
  if (
    claimed === null || deleteRequested === null || verifiedAbsent === null ||
    pending === null || pending > 1 || deleteRequested + verifiedAbsent > claimed ||
    !((pending === 0 && outcome.nextDelaySeconds === null) ||
      (pending === 1 && nextDelaySeconds !== null))
  ) {
    return null;
  }
  return { pending, nextDelaySeconds };
}

function validDeferredVectorCleanupLog(log: Record<string, unknown>, reason: string) {
  const attempts = nonNegativeSafeInteger(log.attempts);
  const delaySeconds = nonNegativeSafeInteger(log.delaySeconds);
  return hasExactRecordKeys(
    log,
    ["attempts", "delaySeconds", "event", "messageId", "reason", "type"],
  ) &&
    log.event === "native_memory_vector_cleanup_lease_deferred" &&
    log.type === "memory.vector_cleanup.v1" &&
    log.reason === reason &&
    isNonEmptyString(log.messageId) &&
    attempts !== null &&
    attempts >= 1 &&
    delaySeconds !== null &&
    delaySeconds >= 60 &&
    delaySeconds <= 5 * 60;
}

function validFailedVectorCleanupLog(log: Record<string, unknown>, reason: string) {
  return hasExactRecordKeys(
    log,
    ["attempts", "error", "event", "messageId", "reason", "type", "userId"],
  ) &&
    log.event === "native_memory_queue_failed" &&
    log.type === "memory.vector_cleanup.v1" &&
    log.reason === reason &&
    log.userId === null &&
    isNonEmptyString(log.messageId) &&
    positiveSafeInteger(log.attempts) &&
    isNonEmptyString(log.error);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function evaluateAuthenticatedSemanticRetrievalTail(
  source: string,
  input: {
    authenticatedValidationVersionId: string;
    trace: AuthenticatedMutationTrace;
    tailDiagnostics?: string;
    tailOutputClosed?: boolean;
  },
): AuthenticatedSemanticRetrievalTailEvaluation {
  const base = evaluateAuthenticatedMutationTail(
    source,
    [input.trace],
    input.authenticatedValidationVersionId,
    input,
  );
  const problems = [...base.problems];
  const parsed = parseTailJsonStream(source, input.tailOutputClosed !== false);
  const matches = parsed.records.flatMap((value) => {
    const record = optionalRecord(value);
    const event = optionalRecord(record?.event);
    const request = optionalRecord(event?.request);
    if (!record || typeof request?.url !== "string") return [];
    try {
      const url = new URL(request.url);
      return url.searchParams.get(mutationProbeParameter) === input.trace.probe
        ? [{ record }]
        : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1) problems.push(`semantic-tail-count=${matches.length}`);
  const record = matches.length === 1 ? matches[0]?.record : undefined;
  const scriptVersion = optionalRecord(record?.scriptVersion);
  const cpuTimeMs = finiteNumber(record?.cpuTime);
  const retrievalLogs = structuredTailLogRecords(record?.logs).filter(
    (log) => log.event === "native_memory_vector_retrieval_completed",
  );
  const retrievalLog = retrievalLogs.length === 1 ? retrievalLogs[0] : undefined;
  const retrievalLogValid = retrievalLog !== undefined &&
    hasExactRecordKeys(retrievalLog, ["event", "memoryMatches", "turnMatches"]) &&
    nonNegativeSafeInteger(retrievalLog.memoryMatches) !== null &&
    nonNegativeSafeInteger(retrievalLog.turnMatches) !== null;
  const hydratedTurnCount = retrievalLogValid
    ? nonNegativeSafeInteger(retrievalLog.turnMatches)
    : null;

  if (record) {
    if (record.scriptName !== workerName) problems.push("semantic-wrong-script");
    if (scriptVersion?.id !== input.authenticatedValidationVersionId) {
      problems.push("semantic-wrong-authenticated-validation-version");
    }
    if (record.truncated !== false) problems.push("semantic-truncated");
    if (tailInvocationHasForbiddenMemoryWarning(record)) problems.push("semantic-failure-log");
  }
  if (retrievalLogs.length !== 1) {
    problems.push(`semantic-retrieval-log-count=${retrievalLogs.length}`);
  } else if (!retrievalLogValid) {
    problems.push("semantic-retrieval-log-malformed");
  }
  if (hydratedTurnCount === null || hydratedTurnCount < 1) {
    problems.push("semantic-hydrated-turn-count");
  }

  return {
    ok: problems.length === 0,
    authenticatedValidationVersionId: input.authenticatedValidationVersionId,
    matchedEvents: matches.length,
    cpuTimeMs,
    hydratedTurnCount,
    problems,
  };
}

function authenticatedTailLogLevel(value: unknown) {
  const entry = optionalRecord(value);
  const level = typeof entry?.level === "string" ? entry.level : null;
  return level === "debug" ||
      level === "info" ||
      level === "log" ||
      level === "warn" ||
      level === "error"
    ? level
    : null;
}

function parseAuthenticatedTailFetchEvent(value: unknown) {
  const event = optionalRecord(value);
  if (!event || !hasExactRecordKeys(event, ["request", "response"])) return null;
  const request = optionalRecord(event.request);
  const response = optionalRecord(event.response);
  if (
    !request ||
    !response ||
    !hasExactRecordKeys(request, ["cf", "headers", "method", "url"]) ||
    !hasExactRecordKeys(response, ["status"])
  ) {
    return null;
  }
  const cf = optionalRecord(request.cf);
  const headers = optionalRecord(request.headers);
  const status = nonNegativeSafeInteger(response.status);
  if (
    !cf ||
    !headers ||
    Object.values(headers).some((header) => typeof header !== "string") ||
    typeof request.method !== "string" ||
    !/^[A-Z]{1,32}$/.test(request.method) ||
    typeof request.url !== "string" ||
    request.url.length === 0 ||
    request.url.length > 8_192 ||
    status === null ||
    status < 100 ||
    status > 599
  ) {
    return null;
  }
  try {
    const url = new URL(request.url);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      request.url !== url.href ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return { event, request, response, url, status };
  } catch {
    return null;
  }
}

function authenticatedTailLogsHaveValidShape(logs: unknown) {
  if (!Array.isArray(logs)) return false;
  return logs.every((value) => {
    const entry = optionalRecord(value);
    if (
      !entry ||
      !hasExactRecordKeys(entry, ["level", "message", "timestamp"]) ||
      authenticatedTailLogLevel(entry) === null ||
      nonNegativeSafeInteger(entry.timestamp) === null ||
      !Object.prototype.hasOwnProperty.call(entry, "message")
    ) {
      return false;
    }
    return Array.isArray(entry.message) &&
      entry.message.length <= 100 &&
      entry.message.every((message) =>
        typeof message === "string" && message.length <= 32 * 1024
      );
  });
}

function structuredTailLogRecords(logs: unknown) {
  if (!Array.isArray(logs)) return [];
  const records: Record<string, unknown>[] = [];
  for (const value of logs) {
    const entry = optionalRecord(value);
    const messages = Array.isArray(entry?.message) ? entry.message : [entry?.message];
    for (const message of messages) {
      if (typeof message !== "string" || message.length > 32 * 1024) continue;
      const parsed = optionalRecord(parseJson(message));
      if (parsed) records.push(parsed);
    }
  }
  return records;
}

function tailInvocationHasForbiddenMemoryWarning(record: Record<string, unknown>) {
  const logs = Array.isArray(record.logs) ? record.logs : [];
  const warningLevel = logs.some((value) => {
    const level = authenticatedTailLogLevel(value);
    return level === "warn" || level === "error";
  });
  const structuredFailure = structuredTailLogRecords(logs).some((log) =>
    typeof log.event === "string" &&
    /^(?:native_memory_(?:queue_(?:failed|deferred|invalid_message)|vector_[a-z0-9_]*failed|retrieval_failed)|memory_post_turn_(?:dropped|enqueue_failed)|llm_budget_(?:denied|check_failed))$/.test(
      log.event,
    )
  );
  return warningLevel || structuredFailure;
}

async function createChat(
  request: (
    label: string,
    pathname: string,
    init: RequestInit,
    expectedStatus?: number,
  ) => Promise<MutationRequestResult>,
  topicId: string,
  label: string,
) {
  const payload = requiredRecord((await request(label, "/api/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topicId }),
  })).value, `${label} response`);
  return requiredUuid(payload.chatId, `${label} chat ID`);
}

function activityRun(value: unknown, expectedType: "quiz" | "flashcards") {
  const payload = requiredRecord(value, `${expectedType} response`);
  const activity = requiredRecord(payload.activityRun, `${expectedType} activity`);
  if (activity.type !== expectedType) throw new Error(`${expectedType} response has the wrong type.`);
  requiredUuid(activity.id, `${expectedType} activity ID`);
  requiredRecord(activity.state, `${expectedType} activity state`);
  return activity;
}

async function verifySavedActivity(
  request: (
    label: string,
    pathname: string,
    init: RequestInit,
    expectedStatus?: number,
  ) => Promise<MutationRequestResult>,
  chatId: string,
  activityId: string,
  activityType: "quiz" | "flashcards",
  label: string,
  expectedSpanishTopic: string,
  expectedSpanishSource?: string,
) {
  const detail = requiredRecord((await request(label, `/api/chats/${chatId}`, { method: "GET" })).value, label);
  const activity = requiredRecord(detail.activityRun, `${label} activity`);
  const state = requiredRecord(activity.state, `${label} state`);
  const messages = requiredArray(detail.messages, `${label} messages`);
  const completionMessage = messages.find((value) => {
    const message = optionalRecord(value);
    const metadata = optionalRecord(message?.metadata);
    return message?.role === "assistant" &&
      metadata?.activityRunId === activityId &&
      metadata.activityType === activityType &&
      metadata.event === "completed" &&
      metadata.displayKey === `activity.${activityType === "quiz" ? "quiz" : "flashcards"}.completed`;
  });
  const completion = optionalRecord(completionMessage);
  const completionMetadata = optionalRecord(completion?.metadata);
  const displayValues = requiredRecord(
    completionMetadata?.displayValues,
    `${label} completion display values`,
  );
  if (
    activity.id !== activityId ||
    activity.type !== activityType ||
    state.completed !== true ||
    !completionMessage
  ) {
    throw new Error(`${label} did not persist its complete result experience.`);
  }
  if (typeof completion?.content !== "string" || !/^✓ [0-9]+\/[0-9]+ · \S/u.test(completion.content)) {
    throw new Error(`${label} did not persist the intentional Spanish completion presentation.`);
  }
  if (/Quiz complete:|Flashcard deck complete:/i.test(completion.content)) {
    throw new Error(`${label} incorrectly persisted the English completion template for Spanish.`);
  }
  if (activityType === "quiz") {
    assertCompleteQuizResult(activity, state, displayValues, label);
  } else {
    assertCompleteFlashcardResult(activity, state, displayValues, label);
  }
  assertSpanishActivityResult(
    state,
    displayValues,
    activityType,
    expectedSpanishTopic,
    label,
    expectedSpanishSource,
  );
  return true;
}

function assertSpanishActivityResult(
  state: Record<string, unknown>,
  displayValues: Record<string, unknown>,
  activityType: "quiz" | "flashcards",
  expectedTopic: string,
  label: string,
  expectedSource?: string,
) {
  if (
    state.topic !== expectedTopic ||
    displayValues.topic !== expectedTopic
  ) {
    throw new Error(`${label} did not preserve its Spanish topic and completion content.`);
  }
  if (activityType === "quiz") {
    const localized = requiredArray(state.questions, `${label} Spanish questions`).filter((value) => {
      const question = optionalRecord(value);
      return isPredominantlySpanishText(
        `${String(question?.prompt ?? "")} ${String(question?.explanation ?? "")}`,
        [expectedTopic],
      );
    }).length;
    if (localized < 8) throw new Error(`${label} did not return a predominantly Spanish quiz.`);
    return;
  }
  if (!expectedSource || state.source !== expectedSource) {
    throw new Error(`${label} did not preserve its Spanish source notes.`);
  }
  const localized = requiredArray(state.cards, `${label} Spanish cards`).filter((value) => {
    const card = optionalRecord(value);
    return isPredominantlySpanishText(
      `${String(card?.front ?? "")} ${String(card?.back ?? "")} ${String(card?.hint ?? "")}`,
      [expectedTopic, expectedSource],
    );
  }).length;
  if (localized < 10) throw new Error(`${label} did not return a predominantly Spanish deck.`);
}

export function hasSpanishLanguageSignal(value: string) {
  const normalized = value.normalize("NFC").toLocaleLowerCase("es");
  if (/[áéíóúñü¿¡]/u.test(normalized)) return true;
  const tokens = normalized.match(/[a-z]+/g) ?? [];
  const distinctive = new Set([
    "agua", "ciclo", "completado", "conocidas", "correcta", "fotosintesis", "mazo",
    "pregunta", "puntuacion", "respuesta", "sabidas", "tarjeta",
  ]);
  if (tokens.some((token) => distinctive.has(token))) return true;
  const markers = new Set(["el", "la", "los", "las", "de", "del", "que", "para", "una", "un", "por", "con", "es", "en"]);
  return tokens.filter((token) => markers.has(token)).length >= 2;
}

export function isPredominantlySpanishText(
  value: string,
  excludedExactPhrases: readonly string[] = [],
) {
  let normalized = value.normalize("NFC").toLocaleLowerCase("es");
  for (const phrase of excludedExactPhrases) {
    const excluded = phrase.normalize("NFC").toLocaleLowerCase("es").trim();
    if (excluded) normalized = normalized.split(excluded).join(" ");
  }
  const tokens = normalized.match(/\p{L}+/gu) ?? [];
  if (tokens.length < 4) return false;
  const spanishMarkers = new Set([
    "al", "como", "con", "cuando", "cual", "cuál", "de", "del", "donde", "dónde",
    "el", "en", "es", "esta", "este", "la", "las", "lo", "los", "para", "pero",
    "por", "porque", "que", "qué", "se", "sin", "son", "su", "una", "y",
  ]);
  const englishMarkers = new Set([
    "a", "an", "and", "are", "because", "can", "does", "explain", "for", "happens",
    "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "what",
    "when", "where", "which", "why", "with", "without",
  ]);
  const spanishLexicalHits = tokens.filter((token) => spanishMarkers.has(token)).length;
  const englishLexicalHits = tokens.filter((token) => englishMarkers.has(token)).length;
  const spanishOrthographicHits = Math.min(3, normalized.match(/[áéíóúñü¿¡]/gu)?.length ?? 0);
  const spanishScore = spanishLexicalHits + spanishOrthographicHits;
  return spanishScore >= 3 && spanishScore >= englishLexicalHits + 1;
}

async function verifySpanishActivityBundle(
  fetcher: MutationFetcher,
  baseUrl: string,
  expectedVersion: string,
) {
  const bundle = getCuratedMainAppTranslationBundle("Spanish");
  if (!bundle) throw new Error("The curated Spanish main-app bundle is unavailable.");
  for (const key of [
    "activity.quiz.review.score",
    "activity.quiz.review.userAnswer",
    "activity.quiz.review.correctAnswer",
    "activity.flashcards.review.complete",
    "activity.flashcards.stat.known",
  ] as const) {
    const source = bundle.sourceStrings[key];
    const translated = bundle.strings[key];
    if (
      typeof source !== "string" ||
      typeof translated !== "string" ||
      translated === source ||
      !hasSpanishLanguageSignal(translated)
    ) {
      throw new Error(`Spanish activity bundle key ${key} is not independently localized.`);
    }
  }
  const asset = buildStaticMainAppBundleAsset("es", bundle);
  const response = await fetcher(new URL(asset.publicPath, baseUrl), {
    method: "GET",
    headers: {
      [versionOverrideHeader]: `${workerName}="${expectedVersion}"`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await readBoundedResponseText(response, maximumResponseBytes);
  if (
    response.status !== 200 ||
    response.headers.get("x-inspir-delivery") !== "static-assets" ||
    !response.headers.get("content-type")?.includes("application/json") ||
    body !== asset.serialized
  ) {
    throw new Error("Production did not serve the exact reviewed Spanish activity bundle.");
  }
  return true;
}

export function assertCompleteQuizResult(
  activity: Record<string, unknown>,
  state: Record<string, unknown>,
  displayValues: Record<string, unknown>,
  label: string,
) {
  const score = requiredIntegerInRange(state.score, 0, 10, `${label} score`);
  const maxScore = requiredIntegerInRange(state.maxScore, 1, 10, `${label} max score`);
  const questions = requiredArray(state.questions, `${label} questions`);
  if (questions.length !== maxScore || maxScore !== 10) {
    throw new Error(`${label} did not preserve its full ten-question result.`);
  }
  for (const [index, value] of questions.entries()) {
    const question = requiredRecord(value, `${label} question ${index}`);
    requiredNonEmptyString(question.id, `${label} question ${index} ID`);
    requiredNonEmptyString(question.prompt, `${label} question ${index} prompt`);
    const options = requiredArray(question.options, `${label} question ${index} options`);
    if (options.length !== 4 || options.some((option) => !isNonEmptyString(option))) {
      throw new Error(`${label} question ${index} omitted a complete option set.`);
    }
    const correctIndex = requiredIntegerInRange(
      question.correctIndex,
      0,
      3,
      `${label} question ${index} correct answer`,
    );
    requiredNonEmptyString(question.explanation, `${label} question ${index} explanation`);
    const userAnswerIndex = requiredIntegerInRange(
      question.userAnswerIndex,
      0,
      3,
      `${label} question ${index} learner answer`,
    );
    if (question.isCorrect !== (userAnswerIndex === correctIndex)) {
      throw new Error(`${label} question ${index} has inconsistent correctness feedback.`);
    }
  }
  if (
    activity.score !== score ||
    activity.maxScore !== maxScore ||
    displayValues.score !== score ||
    displayValues.maxScore !== maxScore ||
    !isNonEmptyString(displayValues.topic)
  ) {
    throw new Error(`${label} result summary does not match its structured quiz state.`);
  }
}

export function assertCompleteFlashcardResult(
  activity: Record<string, unknown>,
  state: Record<string, unknown>,
  displayValues: Record<string, unknown>,
  label: string,
) {
  const knownCount = requiredIntegerInRange(state.knownCount, 0, 12, `${label} known count`);
  const reviewedCount = requiredIntegerInRange(
    state.reviewedCount,
    0,
    12,
    `${label} reviewed count`,
  );
  const maxCards = requiredIntegerInRange(state.maxCards, 1, 12, `${label} max cards`);
  const cards = requiredArray(state.cards, `${label} cards`);
  if (
    cards.length !== maxCards ||
    maxCards !== 12 ||
    reviewedCount !== maxCards ||
    knownCount !== maxCards
  ) {
    throw new Error(`${label} did not preserve its full reviewed deck result.`);
  }
  for (const [index, value] of cards.entries()) {
    const card = requiredRecord(value, `${label} card ${index}`);
    for (const field of ["id", "front", "back", "hint", "example", "trap"] as const) {
      requiredNonEmptyString(card[field], `${label} card ${index} ${field}`);
    }
    const tags = requiredArray(card.tags, `${label} card ${index} tags`);
    if (!tags.length || tags.some((tag) => !isNonEmptyString(tag))) {
      throw new Error(`${label} card ${index} omitted its result tags.`);
    }
    if (
      card.isRevealed !== true ||
      card.rating !== "known" ||
      !isNonEmptyString(card.reviewedAt)
    ) {
      throw new Error(`${label} card ${index} omitted its revealed review result.`);
    }
  }
  if (
    activity.score !== knownCount ||
    activity.maxScore !== maxCards ||
    displayValues.knownCount !== knownCount ||
    displayValues.maxCards !== maxCards ||
    !isNonEmptyString(displayValues.topic)
  ) {
    throw new Error(`${label} result summary does not match its structured flashcard state.`);
  }
}

function requiredIntegerInRange(value: unknown, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function requiredNonEmptyString(value: unknown, label: string) {
  if (!isNonEmptyString(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function parseCompleteAuthenticatedOpenAiSse(source: string) {
  const chunks: string[] = [];
  let terminalSeen = false;
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:") && line.slice(6).trim() === "error") {
      throw new Error("Authenticated provider stream contained an error event.");
    }
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (terminalSeen) {
      throw new Error("Authenticated provider stream continued after its terminal event.");
    }
    if (data === "[DONE]") {
      terminalSeen = true;
      continue;
    }
    const value = parseJson(data);
    const record = optionalRecord(value);
    if (!record || record.error !== undefined) {
      throw new Error("Authenticated provider stream contained a malformed or error frame.");
    }
    const choices = Array.isArray(record?.choices) ? record.choices : [];
    if (!Array.isArray(record.choices)) {
      throw new Error("Authenticated provider stream frame omitted choices.");
    }
    const choice = optionalRecord(choices[0]);
    const delta = optionalRecord(choice?.delta);
    if (typeof delta?.content === "string") chunks.push(delta.content);
  }
  if (!terminalSeen) {
    throw new Error("Authenticated provider stream ended without a terminal event.");
  }
  const content = chunks.join("").trim();
  if (!content) throw new Error("Authenticated provider stream contained no assistant text.");
  return content;
}

function requireResponseUuid(response: Response, name: string) {
  return requiredUuid(response.headers.get(name), name);
}

function cleanupProof(secret: string, candidateVersionId: string, runId: string, userId: string) {
  return createHmac("sha256", secret)
    .update(`disposable-cleanup-v1\0${candidateVersionId}\0${runId}\0${userId}`)
    .digest("hex");
}

function disposableUserId(candidateVersionId: string, runId: string) {
  const bytes = createHash("sha256")
    .update(`inspir-disposable-mutation-v1\0${candidateVersionId}\0${runId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function expectedAuthenticatedMutationDisposableIdentity(
  candidateVersionId: string,
  runId: string,
): AuthenticatedMutationDisposableIdentity {
  const exactCandidateVersionId = requireUuid(
    candidateVersionId,
    "candidate Worker version",
  );
  const exactRunId = requireUuid(runId, "mutation run ID");
  const candidateSlug = exactCandidateVersionId.replaceAll("-", "").slice(0, 12);
  const runSlug = exactRunId.replaceAll("-", "");
  return {
    candidateVersionId: exactCandidateVersionId,
    runId: exactRunId,
    userId: disposableUserId(exactCandidateVersionId, exactRunId),
    email: `e2e-${candidateSlug}-${runSlug}@inspirlearning.invalid`,
  };
}

export function parseAuthenticatedMemoryRecoveryEvidence(
  value: unknown,
): AuthenticatedMemoryRecoveryEvidence {
  const evidence = requiredRecord(value, "authenticated memory recovery evidence");
  const keys = [
    "authenticatedValidationVersionId",
    "createdAt",
    "immutableReleaseIdentitySha256",
    "kind",
    "queuePushPreparedAt",
    "releaseCandidateVersionId",
    "runId",
    "sourceChatId",
    "sourceFingerprintSha256",
    "turnVectorId",
    "userId",
    "userMessageId",
  ] as const;
  if (!hasExactRecordKeys(evidence, keys)) {
    throw new Error("Authenticated memory recovery evidence has the wrong exact contract.");
  }
  const releaseCandidateVersionId = requiredUuid(
    evidence.releaseCandidateVersionId,
    "memory recovery release candidate version",
  );
  const authenticatedValidationVersionId = requiredUuid(
    evidence.authenticatedValidationVersionId,
    "memory recovery authenticated validation version",
  );
  const runId = requiredUuid(evidence.runId, "memory recovery run ID");
  const userId = requiredUuid(evidence.userId, "memory recovery user ID");
  const sourceChatId = requiredUuid(evidence.sourceChatId, "memory recovery source chat ID");
  const userMessageId = requiredUuid(
    evidence.userMessageId,
    "memory recovery user message ID",
  );
  const turnVectorId = requiredNonEmptyString(
    evidence.turnVectorId,
    "memory recovery turn vector ID",
  );
  const createdAt = requiredIsoTimestamp(evidence.createdAt, "memory recovery creation time");
  const queuePushPreparedAt = requiredIsoTimestamp(
    evidence.queuePushPreparedAt,
    "memory recovery Queue preparation time",
  );
  const sourceFingerprintSha256 = requireSha256(
    typeof evidence.sourceFingerprintSha256 === "string"
      ? evidence.sourceFingerprintSha256
      : undefined,
    "memory recovery source fingerprint",
  );
  const immutableReleaseIdentitySha256 = requireSha256(
    typeof evidence.immutableReleaseIdentitySha256 === "string"
      ? evidence.immutableReleaseIdentitySha256
      : undefined,
    "memory recovery immutable release identity",
  );
  const expectedIdentity = expectedAuthenticatedMutationDisposableIdentity(
    authenticatedValidationVersionId,
    runId,
  );
  if (
    evidence.kind !== "authenticated-production-memory-recovery-v2" ||
    userId !== expectedIdentity.userId ||
    parseNativeMemoryVectorId("chat_memory_turns", turnVectorId)?.rowId !== userMessageId ||
    parseNativeMemoryVectorId("chat_memory_turns", turnVectorId)?.marker !== turnVectorId ||
    turnVectorId === nativeMemoryVectorId("chat_memory_turns", userMessageId) ||
    Date.parse(queuePushPreparedAt) < Date.parse(createdAt)
  ) {
    throw new Error("Authenticated memory recovery evidence has inconsistent bound identities.");
  }
  return {
    kind: "authenticated-production-memory-recovery-v2",
    createdAt,
    releaseCandidateVersionId,
    authenticatedValidationVersionId,
    runId,
    userId,
    sourceChatId,
    userMessageId,
    turnVectorId,
    sourceFingerprintSha256,
    immutableReleaseIdentitySha256,
    queuePushPreparedAt,
  };
}

export function readAuthenticatedMemoryRecoveryEvidence(filePath: string) {
  return parseAuthenticatedMemoryRecoveryEvidence(readPrivateJsonNoFollow(filePath));
}

export function removeAuthenticatedMemoryRecoveryEvidence(
  filePath: string,
  expected: AuthenticatedMemoryRecoveryEvidence,
) {
  const actual = readAuthenticatedMemoryRecoveryEvidence(filePath);
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error("Authenticated memory recovery evidence changed before safe removal.");
  }
  fs.rmSync(filePath);
  fsyncParentDirectory(filePath);
}

export function assertAuthenticatedMutationDisposableIdentity(
  value: unknown,
  expected: Pick<AuthenticatedMutationDisposableIdentity, "candidateVersionId" | "runId">,
  label = "disposable identity",
): AuthenticatedMutationDisposableIdentity {
  const identity = requiredRecord(value, label);
  if (!hasExactRecordKeys(identity, ["candidateVersionId", "email", "runId", "userId"])) {
    throw new Error(`${label} has the wrong exact contract.`);
  }
  const deterministic = expectedAuthenticatedMutationDisposableIdentity(
    expected.candidateVersionId,
    expected.runId,
  );
  if (
    identity.candidateVersionId !== deterministic.candidateVersionId ||
    identity.runId !== deterministic.runId ||
    identity.userId !== deterministic.userId ||
    identity.email !== deterministic.email
  ) {
    throw new Error(`${label} has the wrong deterministic candidate/run identity.`);
  }
  return deterministic;
}

function assertAuthenticatedMutationRuntimeVersion(
  value: unknown,
  expectedRuntimeVersion: string,
  label = "migration authentication response",
) {
  const payload = requiredRecord(value, label);
  const runtimeVersionId = requireUuid(expectedRuntimeVersion, "runtime Worker version");
  if (payload.runtimeVersionId !== runtimeVersionId) {
    throw new Error(`${label} came from the wrong runtime Worker version.`);
  }
  return payload;
}

export function assertAuthenticatedMutationResponseProof(
  value: unknown,
  expected: {
    candidateVersionId: string;
    runId: string;
    runtimeVersionId: string;
  },
  label = "disposable migration authentication response",
) {
  const payload = assertAuthenticatedMutationRuntimeVersion(
    value,
    expected.runtimeVersionId,
    label,
  );
  const identity = assertAuthenticatedMutationDisposableIdentity(
    payload.identity,
    expected,
    `${label} identity`,
  );
  return { payload, identity };
}

function hasExactRecordKeys(record: Record<string, unknown>, names: readonly string[]) {
  const actual = Object.keys(record).sort();
  const expected = [...names].sort();
  return actual.length === expected.length &&
    actual.every((name, index) => name === expected[index]);
}

function inventoryIsZero(inventory: Record<string, unknown>) {
  const exact = exactDisposableInventory(inventory);
  return authenticatedMutationInventoryNames.every((name) => exact[name] === 0);
}

export function exactDisposableInventory(value: unknown): Record<string, number> {
  const inventory = requiredRecord(value, "cleanup inventory");
  const actualNames = Object.keys(inventory).sort();
  const expectedNames = [...authenticatedMutationInventoryNames].sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("Cleanup inventory omitted or added a protected residue class.");
  }
  const exact: Record<string, number> = {};
  for (const name of authenticatedMutationInventoryNames) {
    const count = inventory[name];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Cleanup inventory ${name} is not a non-negative safe integer.`);
    }
    exact[name] = count;
  }
  return exact;
}

async function readBoundedResponseText(response: Response, maximumBytes: number) {
  return new TextDecoder().decode(await readBoundedResponseBytes(response, maximumBytes));
}

async function readBoundedResponseBytes(response: Response, maximumBytes: number) {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Authenticated mutation response exceeded its byte limit.");
    }
    chunks.push(result.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function updatedSessionCookie(current: string, headers: Headers) {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return current;
  const match = setCookie.match(/(?:^|,\s*)((?:__Secure-)?better-auth\.session_token)=([^;,\s]+)/i);
  if (!match?.[1] || !match[2]) return current;
  return `${match[1]}=${match[2]}`;
}

async function waitForTailReadiness(input: {
  tails: ReadonlyArray<{
    label: string;
    tail: ChildProcess;
    output: () => string;
    diagnostics: () => string;
  }>;
  baseUrl: string;
  expectedVersion: string;
  tailSessionToken: string;
  markerLabel: "ready" | "settled";
  retryMissedMarker: boolean;
}) {
  if (input.tails.length !== 2) {
    throw new Error("Authenticated mutation readiness requires both JSON tails.");
  }
  const startedAt = performance.now();
  while (performance.now() - startedAt < tailWaitTimeoutMs) {
    const probe = createAuthenticatedTailReadinessProbe();
    const exited = input.tails.find(({ tail }) => hasChildExited(tail));
    if (exited) {
      throw new Error(
        `${exited.label} Wrangler JSON tail exited before the ${input.markerLabel} marker.`,
      );
    }
    const url = new URL("/api/health", input.baseUrl);
    url.searchParams.set(tailReadinessProbeParameter, probe);
    const remainingMs = tailWaitTimeoutMs - (performance.now() - startedAt);
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "cache-control": "no-cache",
        [versionOverrideHeader]: `${workerName}="${input.expectedVersion}"`,
        [tailSessionHeader]: input.tailSessionToken,
      },
      signal: AbortSignal.timeout(Math.max(1, Math.min(tailReadinessRequestTimeoutMs, remainingMs))),
    });
    const responseText = await readBoundedResponseText(
      response,
      tailReadinessMaximumResponseBytes,
    );
    const health = requiredRecord(parseJson(responseText), "tail readiness health response");
    const healthVersion = requiredRecord(health.version, "tail readiness health version");
    if (
      response.status !== 200 ||
      health.ok !== true ||
      healthVersion.id !== input.expectedVersion
    ) {
      throw new Error(
        `Authenticated tail readiness health probe did not return the exact expected version (HTTP ${response.status}).`,
      );
    }
    const markerStartedAt = performance.now();
    const markerTimeoutMs = input.retryMissedMarker
      ? Math.min(2_000, tailWaitTimeoutMs - (markerStartedAt - startedAt))
      : tailWaitTimeoutMs - (markerStartedAt - startedAt);
    while (performance.now() - markerStartedAt < markerTimeoutMs) {
      const sources = input.tails.map(({ output }) => output());
      for (const source of sources) {
        if (parseTailJsonStream(source, false).problem) {
          throw new Error("Authenticated Wrangler JSON Tail output became malformed.");
        }
      }
      if (authenticatedTailReadinessIsCapturedByEveryTail(
        sources,
        probe,
        input.expectedVersion,
      )) {
        const captureWithLoss = input.tails.find(({ output, diagnostics }) => {
          const parsed = parseTailJsonStream(output(), false);
          return authenticatedTailCaptureHasLoss(parsed.records, diagnostics());
        });
        if (captureWithLoss) {
          throw new Error(
            `${captureWithLoss.label} Wrangler JSON tail reported capture loss before validation.`,
          );
        }
        const exitedAfterCapture = input.tails.find(({ tail }) => hasChildExited(tail));
        if (exitedAfterCapture) {
          throw new Error(
            `${exitedAfterCapture.label} Wrangler JSON tail exited after its ${input.markerLabel} marker.`,
          );
        }
        return probe;
      }
      const exitedWhileWaiting = input.tails.find(({ tail }) => hasChildExited(tail));
      if (exitedWhileWaiting) {
        throw new Error(
          `${exitedWhileWaiting.label} Wrangler JSON tail exited before its ${input.markerLabel} marker arrived.`,
        );
      }
      await delay(250);
    }
    if (!input.retryMissedMarker) break;
  }
  throw new Error(
    `Every Wrangler JSON tail did not capture the bounded public ${input.markerLabel} marker.`,
  );
}

async function waitForTailProbes(tail: ChildProcess, output: () => string, probes: readonly string[]) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < tailWaitTimeoutMs) {
    const captured = new Set(tailRequestProbes(output()));
    if (probes.every((probe) => captured.has(probe))) return;
    if (hasChildExited(tail)) throw new Error("Wrangler tail exited before mutation evidence completed.");
    await delay(750);
  }
  throw new Error("Wrangler tail did not capture every authenticated mutation request.");
}

async function waitForCompleteTailOutputCheckpoint(
  tail: ChildProcess,
  output: () => string,
) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    const source = output();
    const parsed = parseTailJsonStream(source, false);
    if (parsed.problem) {
      throw new Error("Wrangler version Tail output was malformed before Queue publication.");
    }
    if (parsed.complete && parsed.consumedLength === source.length) return source.length;
    if (hasChildExited(tail)) {
      throw new Error("Wrangler version Tail exited before its Queue stream checkpoint.");
    }
    await delay(25);
  }
  throw new Error("Wrangler version Tail never reached a complete JSON boundary before publication.");
}

async function waitForAuthenticatedMemoryQueueEvidence(input: {
  tail: ChildProcess;
  output: () => string;
  diagnostics: () => string;
  baseUrl: string;
  authenticatedValidationVersionId: string;
  userId: string;
  captureOutputOffset: number;
}) {
  const startedAt = performance.now();
  let successObservedAt: number | undefined;
  const evaluateAt = (observationEndedAt: number) => {
    const source = input.output();
    const tailDiagnostics = input.diagnostics();
    let evaluation = evaluateAuthenticatedMemoryQueueTail(source, {
      ...input,
      ...(successObservedAt === undefined
        ? {}
        : { observationEndedAt, successObservedAt }),
      tailDiagnostics,
      tailOutputClosed: false,
    });
    if (successObservedAt === undefined && evaluation.successfulEvents === 1) {
      successObservedAt = observationEndedAt;
      evaluation = evaluateAuthenticatedMemoryQueueTail(source, {
        ...input,
        observationEndedAt,
        successObservedAt,
        tailDiagnostics,
        tailOutputClosed: false,
      });
    }
    return evaluation;
  };
  while (performance.now() - startedAt < queueCaptureTimeoutMs) {
    const evaluation = evaluateAt(performance.now());
    if (hasChildExited(input.tail)) {
      throw new Error("Wrangler version Tail exited before stored-memory Queue evidence arrived.");
    }
    if (evaluation.fatal) return evaluation;
    if (evaluation.settled) {
      const settledLivenessProbe = await waitForSingleTailPostSettlementLiveness({
        tail: input.tail,
        output: input.output,
        expectedVersion: input.authenticatedValidationVersionId,
        captureOutputOffset: input.captureOutputOffset,
        baseUrl: input.baseUrl,
      });
      return evaluateAuthenticatedMemoryQueueTail(input.output(), {
        ...input,
        observationEndedAt: performance.now(),
        successObservedAt,
        settledLivenessProbe,
        tailDiagnostics: input.diagnostics(),
        tailOutputClosed: false,
      });
    }
    await delay(1_000);
  }
  const evaluation = evaluateAt(performance.now());
  if (hasChildExited(input.tail)) {
    throw new Error("Wrangler version Tail exited before stored-memory Queue evidence arrived.");
  }
  return evaluation;
}

async function waitForAuthenticatedMemoryVectorCleanupQueueEvidence(input: {
  tail: ChildProcess;
  output: () => string;
  diagnostics: () => string;
  baseUrl: string;
  authenticatedValidationVersionId: string;
  captureOutputOffset: number;
  reason: string;
}) {
  const startedAt = performance.now();
  let successObservedAt: number | undefined;
  const evaluateAt = (observationEndedAt: number) => {
    const source = input.output();
    const tailDiagnostics = input.diagnostics();
    let evaluation = evaluateAuthenticatedMemoryVectorCleanupQueueTail(source, {
      ...input,
      ...(successObservedAt === undefined
        ? {}
        : { observationEndedAt, successObservedAt }),
      tailDiagnostics,
      tailOutputClosed: false,
    });
    if (successObservedAt === undefined && evaluation.chainComplete) {
      successObservedAt = observationEndedAt;
      evaluation = evaluateAuthenticatedMemoryVectorCleanupQueueTail(source, {
        ...input,
        observationEndedAt,
        successObservedAt,
        tailDiagnostics,
        tailOutputClosed: false,
      });
    }
    return evaluation;
  };
  while (performance.now() - startedAt < authenticatedCleanupQueueSettlementTimeoutMs) {
    const evaluation = evaluateAt(performance.now());
    if (hasChildExited(input.tail)) {
      throw new Error("Wrangler version Tail exited before Vectorize cleanup Queue evidence arrived.");
    }
    if (evaluation.fatal) return evaluation;
    if (evaluation.settled) {
      const settledLivenessProbe = await waitForSingleTailPostSettlementLiveness({
        tail: input.tail,
        output: input.output,
        expectedVersion: input.authenticatedValidationVersionId,
        captureOutputOffset: input.captureOutputOffset,
        baseUrl: input.baseUrl,
      });
      return evaluateAuthenticatedMemoryVectorCleanupQueueTail(input.output(), {
        ...input,
        observationEndedAt: performance.now(),
        successObservedAt,
        settledLivenessProbe,
        tailDiagnostics: input.diagnostics(),
        tailOutputClosed: false,
      });
    }
    await delay(1_000);
  }
  const evaluation = evaluateAt(performance.now());
  if (hasChildExited(input.tail)) {
    throw new Error("Wrangler version Tail exited before Vectorize cleanup Queue evidence arrived.");
  }
  return evaluation;
}

async function waitForSingleTailPostSettlementLiveness(input: {
  tail: ChildProcess;
  output: () => string;
  baseUrl: string;
  expectedVersion: string;
  captureOutputOffset: number;
}) {
  const probe = createAuthenticatedTailReadinessProbe();
  if (hasChildExited(input.tail)) {
    throw new Error("Wrangler version Tail exited before its post-settlement marker.");
  }
  const url = new URL("/api/health", input.baseUrl);
  url.searchParams.set(tailReadinessProbeParameter, probe);
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "cache-control": "no-cache",
      [versionOverrideHeader]: `${workerName}="${input.expectedVersion}"`,
    },
    signal: AbortSignal.timeout(tailReadinessRequestTimeoutMs),
  });
  const responseText = await readBoundedResponseText(
    response,
    tailReadinessMaximumResponseBytes,
  );
  const health = requiredRecord(parseJson(responseText), "post-settlement health response");
  const healthVersion = requiredRecord(
    health.version,
    "post-settlement health response version",
  );
  if (
    response.status !== 200 ||
    health.ok !== true ||
    healthVersion.id !== input.expectedVersion
  ) {
    throw new Error(
      `Authenticated post-settlement health marker returned the wrong version (HTTP ${response.status}).`,
    );
  }
  const startedAt = performance.now();
  while (performance.now() - startedAt < tailWaitTimeoutMs) {
    const source = input.output();
    const parsed = parseAuthenticatedTailWindow(source, input.captureOutputOffset, false);
    if (parsed.offsetProblem || parsed.problem) {
      throw new Error("Wrangler version Tail output became malformed after Queue settlement.");
    }
    if (authenticatedTailHasReadinessProbe(
      source.slice(input.captureOutputOffset),
      probe,
      input.expectedVersion,
    )) {
      if (hasChildExited(input.tail)) {
        throw new Error("Wrangler version Tail exited after its post-settlement marker.");
      }
      return probe;
    }
    if (hasChildExited(input.tail)) {
      throw new Error("Wrangler version Tail exited before its post-settlement marker arrived.");
    }
    await delay(250);
  }
  throw new Error("Wrangler version Tail did not capture its one-shot post-settlement marker.");
}

async function waitForAuthenticatedSemanticRetrievalEvidence(input: {
  tail: ChildProcess;
  output: () => string;
  diagnostics: () => string;
  authenticatedValidationVersionId: string;
  trace: AuthenticatedMutationTrace;
}) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < tailWaitTimeoutMs) {
    const evaluation = evaluateAuthenticatedSemanticRetrievalTail(input.output(), {
      ...input,
      tailDiagnostics: input.diagnostics(),
      tailOutputClosed: false,
    });
    if (evaluation.matchedEvents > 0) {
      await delay(1_000);
      return evaluateAuthenticatedSemanticRetrievalTail(input.output(), {
        ...input,
        tailDiagnostics: input.diagnostics(),
        tailOutputClosed: false,
      });
    }
    if (hasChildExited(input.tail)) {
      throw new Error("Wrangler HTTP Tail exited before semantic retrieval evidence arrived.");
    }
    await delay(250);
  }
  return evaluateAuthenticatedSemanticRetrievalTail(input.output(), {
    ...input,
    tailDiagnostics: input.diagnostics(),
    tailOutputClosed: false,
  });
}

function readQueueId(wrangler: string) {
  const result = spawnSync(
    wrangler,
    ["queues", "info", MEMORY_POST_TURN_QUEUE_NAME],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status !== 0) throw new Error("Could not resolve the production memory Queue ID.");
  const match = /^Queue ID:\s*([a-f0-9]{32})\s*$/im.exec(`${result.stdout}${result.stderr}`);
  if (!match?.[1]) throw new Error("Wrangler returned an invalid production memory Queue ID.");
  return match[1];
}

function requireCloudflareApiToken() {
  const credential = readCloudflareApiToken();
  if (credential.error || credential.token.length < 20 || credential.token.length > 2_048) {
    throw new Error(
      "Authenticated Queue and Vectorize validation requires a valid Cloudflare API token.",
    );
  }
  return credential.token;
}

async function pushAuthenticatedMemoryPostTurn(
  apiToken: string,
  queueId: string,
  job: AuthenticatedMemoryPostTurnJob,
) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues/${queueId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: job, content_type: "json" }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const value = parseCloudflareApiEnvelope(
    await readBoundedResponseText(response, cloudflareApiResponseLimit),
    "Cloudflare Queue publish",
  );
  if (!response.ok || value.success !== true) {
    throw new Error(`Cloudflare Queue publish failed with HTTP ${response.status}.`);
  }
}

export async function enqueueAuthenticatedMemoryVectorCleanupWake(reason: string) {
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  await pushAuthenticatedMemoryVectorCleanupWake(
    requireCloudflareApiToken(),
    readQueueId(wrangler),
    reason,
  );
}

async function pushAuthenticatedMemoryVectorCleanupWake(
  apiToken: string,
  queueId: string,
  reason: string,
) {
  const boundedReason = reason.trim();
  if (
    boundedReason.length < 1 ||
    boundedReason.length > 80 ||
    !/^[a-z0-9-]+$/.test(boundedReason)
  ) {
    throw new Error("Authenticated Vectorize cleanup wake reason is invalid.");
  }
  const message = {
    type: "memory.vector_cleanup.v1",
    enqueuedAt: new Date().toISOString(),
    reason: boundedReason,
  } satisfies MemoryVectorCleanupQueueMessage;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues/${queueId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: message, content_type: "json" }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const value = parseCloudflareApiEnvelope(
    await readBoundedResponseText(response, cloudflareApiResponseLimit),
    "Cloudflare Vectorize cleanup Queue publish",
  );
  if (!response.ok || value.success !== true) {
    throw new Error(
      `Cloudflare Vectorize cleanup Queue publish failed with HTTP ${response.status}.`,
    );
  }
}

async function readKnownVectorIds(apiToken: string, vectorId: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX_NAME}/get_by_ids`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids: [vectorId] }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const envelope = parseCloudflareApiEnvelope(
    await readBoundedResponseText(response, cloudflareApiResponseLimit),
    "Cloudflare Vectorize get-by-IDs",
  );
  if (!response.ok || envelope.success !== true || !Array.isArray(envelope.result)) {
    throw new Error(`Cloudflare Vectorize get-by-IDs failed with HTTP ${response.status}.`);
  }
  const ids = envelope.result.map((value) => {
    const vector = requiredRecord(value, "Cloudflare Vectorize get-by-IDs result");
    return requiredNonEmptyString(vector.id, "Cloudflare Vectorize result ID");
  });
  if (ids.length > 1 || ids.some((id) => id !== vectorId)) {
    throw new Error("Cloudflare Vectorize get-by-IDs returned an unexpected vector identity.");
  }
  return ids;
}

async function deleteKnownVector(apiToken: string, vectorId: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX_NAME}/delete_by_ids`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids: [vectorId] }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const envelope = parseCloudflareApiEnvelope(
    await readBoundedResponseText(response, cloudflareApiResponseLimit),
    "Cloudflare Vectorize delete-by-IDs",
  );
  if (!response.ok || envelope.success !== true) {
    throw new Error(`Cloudflare Vectorize delete-by-IDs failed with HTTP ${response.status}.`);
  }
}

async function waitForKnownVectorState(input: {
  apiToken: string;
  vectorId: string;
  expectedPresent: boolean;
  minimumSettleMs?: number;
}) {
  const startedAt = Date.now();
  const minimumSettleMs = input.minimumSettleMs ?? 0;
  let firstAbsentReadAt: number | null = null;
  let lastError: unknown = null;
  while (Date.now() - startedAt < vectorStateTimeoutMs) {
    try {
      const ids = await readKnownVectorIds(input.apiToken, input.vectorId);
      const present = ids.length === 1;
      if (input.expectedPresent && present) return;
      if (!input.expectedPresent && !present) {
        const checkedAt = Date.now();
        firstAbsentReadAt ??= checkedAt;
        if (
          checkedAt - startedAt >= minimumSettleMs &&
          checkedAt - firstAbsentReadAt >= vectorAbsenceVerificationSpacingMs
        ) {
          return;
        }
      } else {
        firstAbsentReadAt = null;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
      firstAbsentReadAt = null;
    }
    await delay(vectorStatePollDelayMs(firstAbsentReadAt));
  }
  const expected = input.expectedPresent ? "presence" : "absence";
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Authoritative Vectorize ${expected} was not proven for the known turn ID.${suffix}`);
}

export async function deleteAuthenticatedValidationVectorAndRequireAbsent(input: {
  vectorId: string;
  minimumSettleMs?: number;
}) {
  const apiToken = requireCloudflareApiToken();
  const startedAt = Date.now();
  const minimumSettleMs = input.minimumSettleMs ?? 0;
  let firstAbsentReadAt: number | null = null;
  let lastError: unknown = null;
  await deleteKnownVector(apiToken, input.vectorId);
  while (Date.now() - startedAt < vectorStateTimeoutMs) {
    try {
      const ids = await readKnownVectorIds(apiToken, input.vectorId);
      if (ids.length === 0) {
        const checkedAt = Date.now();
        firstAbsentReadAt ??= checkedAt;
        if (
          checkedAt - startedAt >= minimumSettleMs &&
          checkedAt - firstAbsentReadAt >= vectorAbsenceVerificationSpacingMs
        ) {
          return;
        }
      } else {
        firstAbsentReadAt = null;
        await deleteKnownVector(apiToken, input.vectorId);
      }
      lastError = null;
    } catch (error) {
      lastError = error;
      firstAbsentReadAt = null;
    }
    await delay(vectorStatePollDelayMs(firstAbsentReadAt));
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `Recovery could not prove authoritative absence of the known validation vector.${suffix}`,
  );
}

function vectorStatePollDelayMs(firstAbsentReadAt: number | null) {
  if (firstAbsentReadAt === null) return 1_000;
  const remaining = vectorAbsenceVerificationSpacingMs - (Date.now() - firstAbsentReadAt);
  return Math.max(1_000, Math.min(30_000, remaining));
}

function parseCloudflareApiEnvelope(source: string, label: string) {
  const value = requiredRecord(parseJson(source), label);
  if (!hasExactCloudflareEnvelopeShape(value)) {
    throw new Error(`${label} returned a malformed API envelope.`);
  }
  return value;
}

function hasExactCloudflareEnvelopeShape(value: Record<string, unknown>) {
  return typeof value.success === "boolean" &&
    Array.isArray(value.errors) &&
    Array.isArray(value.messages) &&
    Object.prototype.hasOwnProperty.call(value, "result");
}

function tailRequestProbes(source: string) {
  const parsed = parseTailJsonStream(source, false);
  if (parsed.problem) {
    throw new Error("Wrangler HTTP Tail output was malformed while awaiting mutation evidence.");
  }
  return parsed.records.flatMap((value) => {
    const record = optionalRecord(value);
    const request = optionalRecord(optionalRecord(record?.event)?.request);
    if (typeof request?.url !== "string") return [];
    try {
      const url = new URL(request.url);
      const probe = url.searchParams.get(mutationProbeParameter);
      return probe ? [probe] : [];
    } catch {
      return [];
    }
  });
}

export function createAuthenticatedTailReadinessProbe(
  now = Date.now(),
  pid = process.pid,
) {
  if (
    !Number.isSafeInteger(now) || now < 0 ||
    !Number.isSafeInteger(pid) || pid < 0
  ) {
    throw new Error("Authenticated tail readiness probe identity is invalid.");
  }
  return `inspir-auth-tail-ready-${now}-${pid}`;
}

export function authenticatedTailHasReadinessProbe(
  source: string,
  probe: string,
  expectedVersion: string,
  closed = false,
) {
  if (
    !/^inspir-auth-tail-ready-[0-9]+-[0-9]+$/.test(probe) ||
    !uuidPattern().test(expectedVersion)
  ) {
    return false;
  }
  const parsed = parseTailJsonStream(source, closed);
  if (parsed.problem) return false;
  const matches = parsed.records.filter((value) => {
    const record = optionalRecord(value);
    const event = optionalRecord(record?.event);
    const fetchEvent = parseAuthenticatedTailFetchEvent(event);
    const request = optionalRecord(event?.request);
    const response = optionalRecord(event?.response);
    const scriptVersion = optionalRecord(record?.scriptVersion);
    const cpuTimeMs = finiteNumber(record?.cpuTime);
    const wallTimeMs = finiteNumber(record?.wallTime);
    if (
      !record ||
      !fetchEvent ||
      record.scriptName !== workerName ||
      scriptVersion?.id !== expectedVersion ||
      record.outcome !== "ok" ||
      record.truncated !== false ||
      nonNegativeSafeInteger(record.eventTimestamp) === null ||
      !Array.isArray(record.exceptions) ||
      record.exceptions.length !== 0 ||
      !authenticatedTailLogsHaveValidShape(record.logs) ||
      cpuTimeMs === null ||
      cpuTimeMs < 0 ||
      cpuTimeMs >= authenticatedMutationCpuThresholdMs ||
      wallTimeMs === null ||
      wallTimeMs < 0 ||
      tailInvocationHasForbiddenMemoryWarning(record) ||
      request?.method !== "GET" ||
      response?.status !== 200 ||
      typeof request.url !== "string"
    ) {
      return false;
    }
    try {
      const url = new URL(request.url);
      return url.origin === defaultBaseUrl &&
        url.username === "" &&
        url.password === "" &&
        url.hash === "" &&
        url.pathname === "/api/health" &&
        url.searchParams.size === 1 &&
        url.searchParams.get(tailReadinessProbeParameter) === probe;
    } catch {
      return false;
    }
  });
  return matches.length === 1;
}

export function authenticatedTailReadinessIsCapturedByEveryTail(
  sources: readonly string[],
  probe: string,
  expectedVersion: string,
  closed = false,
) {
  return sources.length > 0 &&
    sources.every((source) =>
      authenticatedTailHasReadinessProbe(source, probe, expectedVersion, closed)
    );
}

export function normalizeAuthenticatedMutationRoute(pathname: string) {
  const normalized = pathname.split("/").map((segment) =>
    segment === "REDACTED" || uuidPattern().test(segment) ? ":uuid" : segment
  ).join("/");
  return normalized || "/";
}

function authenticatedMutationRedactedRequestKey(requestKey: string) {
  const url = new URL(requestKey, defaultBaseUrl);
  url.pathname = url.pathname.split("/").map((segment) =>
    uuidPattern().test(segment) ? "REDACTED" : segment
  ).join("/");
  return `${url.pathname}${url.search}`;
}

export function createAuthenticatedMutationProbe(label: string, requestIndex: number) {
  if (!Number.isSafeInteger(requestIndex) || requestIndex < 0) {
    throw new Error("Authenticated mutation probe index is invalid.");
  }
  return `inspir-mutation-${Date.now()}-${process.pid}-${requestIndex}-${safeProbeLabel(label)}`;
}

async function stopTail(child: ChildProcess, closed: Promise<void>) {
  if (hasChildExited(child)) return false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    if (!child.kill(signal)) {
      if (hasChildExited(child)) return false;
      throw new Error(`Wrangler JSON tail rejected ${signal}.`);
    }
    if (await resolvesWithin(closed, 5_000)) return true;
  }
  const forced = child.kill("SIGKILL");
  if (forced) await resolvesWithin(closed, 5_000);
  throw new Error("Wrangler JSON Tail required SIGKILL; authenticated proof is invalid.");
}

function extractJsonObjects(source: string) {
  const values: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const value = parseJson(source.slice(start, index + 1));
        if (value !== null) values.push(value);
        start = -1;
      }
    }
  }
  return values;
}

function requireActiveDeployment(wrangler: string, expectedVersion: string) {
  const result = spawnSync(
    wrangler,
    ["deployments", "status", "--name", workerName, "--json"],
    { cwd: process.cwd(), env: commandEnv(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error("Could not verify the active production Worker version.");
  const value = parseJson(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  const deployment = optionalRecord(value) ??
    extractJsonObjects(`${result.stdout ?? ""}${result.stderr ?? ""}`)
      .map(optionalRecord)
      .find((entry) => Array.isArray(entry?.versions));
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  const active = versions.flatMap((entry) => {
    const version = optionalRecord(entry);
    return typeof version?.version_id === "string" && version.percentage === 100
      ? [version.version_id]
      : [];
  });
  if (active.length !== 1 || active[0] !== expectedVersion) {
    throw new Error("Authenticated mutation validation is not pinned to the sole active Worker version.");
  }
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Authenticated mutation validation requires a clean HTTPS base URL.");
  }
  return url.origin;
}

function requireSecret(value: string | undefined) {
  const bytes = value ? Buffer.byteLength(value, "utf8") : 0;
  if (!value || bytes < 32 || bytes > 512) {
    throw new Error("E2E_TEST_AUTH_SECRET must contain 32 to 512 UTF-8 bytes.");
  }
  return value;
}

function requireUuid(value: string | undefined, label: string) {
  if (!value || !uuidPattern().test(value) || value !== value.toLowerCase()) {
    throw new Error(`Authenticated mutation validation requires an exact lowercase ${label} UUID.`);
  }
  return value;
}

function requiredUuid(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is missing.`);
  return requireUuid(value, label);
}

function uuidPattern() {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} is malformed.`);
  return record;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function requiredArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function nonNegativeSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function requireSha256(value: string | undefined, label: string) {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Authenticated mutation validation requires an exact lowercase ${label} SHA-256.`);
  }
  return value;
}

function requiredIsoTimestamp(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is malformed.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function requireMemoryRecoveryEvidencePath(value: string | undefined) {
  if (!value) {
    throw new Error("Authenticated mutation validation requires its owner-only memory recovery path.");
  }
  const resolved = path.resolve(value);
  const expectedDirectory = cloudflareDir(resolveBackupDir());
  if (
    path.dirname(resolved) !== expectedDirectory ||
    path.basename(resolved) !== authenticatedMemoryRecoveryEvidenceName
  ) {
    throw new Error("Authenticated memory recovery evidence must use the private report directory.");
  }
  return resolved;
}

function assertPathAbsent(filePath: string, label: string) {
  try {
    fs.lstatSync(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists; run authenticated validation recovery first.`);
}

function fsyncParentDirectory(filePath: string) {
  const descriptor = fs.openSync(path.dirname(filePath), "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function safeProbeLabel(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe || safe.length > 80) throw new Error("Authenticated mutation probe label is invalid.");
  return safe;
}

function hasChildExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function resolvesWithin(promise: Promise<unknown>, milliseconds: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    void promise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
