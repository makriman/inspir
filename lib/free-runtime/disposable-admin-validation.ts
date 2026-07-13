export type DisposableAdminValidationIdentity = {
  candidateVersionId: string;
  runId: string;
  userId: string;
  email: string;
};

export type DisposableAdminValidationRuntimeIdentity =
  DisposableAdminValidationIdentity & {
    markerToken: string;
  };

export type DisposableAdminValidationEnv = {
  CF_VERSION_METADATA?: Pick<WorkerVersionMetadata, "id">;
  E2E_TEST_AUTH_SECRET?: string;
  E2E_TEST_MUTATION_RUN_ID?: string;
  E2E_TEST_AUTH_EXPIRES_AT?: string;
};

export type DisposableAdminValidationScope =
  | { kind: "ordinary" }
  | { kind: "invalid" }
  | {
      kind: "validation";
      expiresAt: number;
      identity: DisposableAdminValidationRuntimeIdentity;
      topic: DisposableAdminTopicFixture;
    };

export type DisposableAdminTopicFixture = {
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  systemPrompt: string;
};

const exactUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const disposableValidationEmailPattern =
  /^e2e-[0-9a-f]{12}-[0-9a-f]{32}@inspirlearning\.invalid$/;
const capabilityMaximumFutureMs = 2 * 60 * 60 * 1_000;
const topicOwnershipTokenPrefix = "inspir-disposable-admin-topic-v1";
const cleanupFenceTokenPrefix = "inspir-disposable-mutation-fenced-v1";

export function disposableAdminTopicFixture(
  identity: DisposableAdminValidationIdentity,
): DisposableAdminTopicFixture {
  const candidateSlug = identity.candidateVersionId.replaceAll("-", "").slice(0, 12);
  const runSlug = identity.runId.replaceAll("-", "");
  const marker =
    `candidate=${identity.candidateVersionId};run=${identity.runId};` +
    `user=${identity.userId};email=${identity.email}`;
  return {
    slug: `e2e-validation-${candidateSlug}-${runSlug}`,
    name: `E2E validation ${candidateSlug} ${runSlug}`,
    subText: `Temporary candidate-bound admin validation ${runSlug}`,
    description: `Disposable production validation topic. ${marker}`,
    inputboxText: `Temporary validation prompt ${runSlug}`,
    systemPrompt: `This topic exists only for reversible production validation. ${marker}`,
  };
}

function isDisposableAdminValidationEmail(value: string) {
  return disposableValidationEmailPattern.test(value.trim().toLowerCase());
}

export function disposableAdminTopicOwnershipToken(
  identity: DisposableAdminValidationIdentity,
) {
  return `${topicOwnershipTokenPrefix}:${identity.candidateVersionId}:${identity.runId}`;
}

export function disposableAdminCleanupFenceToken(
  identity: Pick<DisposableAdminValidationRuntimeIdentity, "markerToken">,
) {
  const digest = identity.markerToken.split(":", 2)[1] ?? "";
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("Disposable admin cleanup marker is invalid.");
  }
  return `${cleanupFenceTokenPrefix}:${digest}`;
}

export async function deriveDisposableAdminValidationIdentity(
  candidateVersionId: string,
  runId: string,
): Promise<DisposableAdminValidationRuntimeIdentity | null> {
  if (!exactUuid(candidateVersionId) || !exactUuid(runId)) return null;
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `inspir-disposable-mutation-v1\0${candidateVersionId}\0${runId}`,
    ),
  ));
  const uuidBytes = digest.slice(0, 16);
  uuidBytes[6] = ((uuidBytes[6] ?? 0) & 0x0f) | 0x40;
  uuidBytes[8] = ((uuidBytes[8] ?? 0) & 0x3f) | 0x80;
  const uuidHex = bytesToHex(uuidBytes);
  const userId =
    `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-` +
    `${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`;
  const candidateSlug = candidateVersionId.replaceAll("-", "").slice(0, 12);
  const runSlug = runId.replaceAll("-", "");
  return {
    candidateVersionId,
    runId,
    userId,
    email: `e2e-${candidateSlug}-${runSlug}@inspirlearning.invalid`,
    markerToken: `inspir-disposable-mutation-v1:${bytesToHex(digest)}`,
  };
}

export async function resolveDisposableAdminValidationScope(
  user: { id: string; email: string },
  env: DisposableAdminValidationEnv,
  now = Date.now(),
): Promise<DisposableAdminValidationScope> {
  const normalizedEmail = user.email.trim().toLowerCase();
  if (!isDisposableAdminValidationEmail(normalizedEmail)) return { kind: "ordinary" };
  if (!Number.isSafeInteger(now) || now <= 0 || !boundedCapabilitySecret(env.E2E_TEST_AUTH_SECRET)) {
    return { kind: "invalid" };
  }
  const candidateVersionId = exactUuid(env.CF_VERSION_METADATA?.id);
  const runId = exactUuid(env.E2E_TEST_MUTATION_RUN_ID);
  const expiresAt = exactCapabilityExpiry(env.E2E_TEST_AUTH_EXPIRES_AT, now);
  if (!candidateVersionId || !runId || expiresAt === null) return { kind: "invalid" };
  const identity = await deriveDisposableAdminValidationIdentity(candidateVersionId, runId);
  if (!identity || user.id !== identity.userId || normalizedEmail !== identity.email) {
    return { kind: "invalid" };
  }
  return {
    kind: "validation",
    expiresAt,
    identity,
    topic: disposableAdminTopicFixture(identity),
  };
}

function exactUuid(value: unknown) {
  return typeof value === "string" && exactUuidPattern.test(value) ? value : null;
}

function boundedCapabilitySecret(value: string | undefined) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return false;
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= 32 && bytes <= 512;
}

function exactCapabilityExpiry(value: string | undefined, now: number) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const expiresAt = Number(value);
  return Number.isSafeInteger(expiresAt) &&
      expiresAt > now &&
      expiresAt <= now + capabilityMaximumFutureMs
    ? expiresAt
    : null;
}

function bytesToHex(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}
