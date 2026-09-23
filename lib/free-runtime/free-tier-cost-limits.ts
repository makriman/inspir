/**
 * Workers Free cost ceilings shared by the native runtime and deploy preflight.
 * Raising a value here fails preflight until the pinned ceilings move with it.
 * Request-path Vectorize gating stays in draft PR #12 (`MEMORY_REQUEST_VECTOR_QUERY=0`).
 */
export const FREE_TIER_COST_LIMITS = {
  memoryQueueMaxBatchSize: 1,
  memoryQueueMaxBatchTimeoutSeconds: 10,
  memoryQueueMaxRetries: 5,
  memoryQueueMinRetryDelaySeconds: 60,
  synthesisUserCap: 25,
  rateLimitPruneRows: 5_000,
  staleAiRunRepairs: 500,
  observabilityHeadSampleRate: 0.02,
  observabilityLogSampleRate: 0.05,
  observabilityTraceSampleRate: 0.02,
} as const;

export const RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME = "inspirlearning-next-cache-prod";
export const RETIRED_OPENNEXT_CACHE_R2_BINDING_NAMES = [
  "NEXT_INC_CACHE_R2_BUCKET",
  "NEXT_CACHE_R2_BUCKET",
] as const;
export const DORMANT_CACHE_DO_BINDING_NAME = "NEXT_CACHE_DO_QUEUE";
export const DORMANT_CACHE_DO_CLASS_NAME = "DOQueueHandler";
export const DORMANT_CACHE_DO_MIGRATION_TAG = "opennext-cache-queue-v1";

const MEMORY_QUEUE_CONSUMER_KEYS = [
  "queue",
  "max_batch_size",
  "max_batch_timeout",
  "max_retries",
  "retry_delay",
  "dead_letter_queue",
] as const;

const retiredCacheR2Bindings = new Set<string>(RETIRED_OPENNEXT_CACHE_R2_BINDING_NAMES);

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function integerInRange(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function integerAtLeast(value: unknown, min: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

export function memoryQueueConsumerWithinFreeTier(
  consumer: Readonly<Record<string, unknown>> | undefined,
  expectedQueue: string,
  expectedDeadLetterQueue: string,
) {
  if (!consumer || !hasExactKeys(consumer, MEMORY_QUEUE_CONSUMER_KEYS)) return false;
  return (
    consumer.queue === expectedQueue &&
    consumer.dead_letter_queue === expectedDeadLetterQueue &&
    consumer.max_batch_size === FREE_TIER_COST_LIMITS.memoryQueueMaxBatchSize &&
    integerInRange(
      consumer.max_batch_timeout,
      1,
      FREE_TIER_COST_LIMITS.memoryQueueMaxBatchTimeoutSeconds,
    ) &&
    integerInRange(consumer.max_retries, 1, FREE_TIER_COST_LIMITS.memoryQueueMaxRetries) &&
    integerAtLeast(consumer.retry_delay, FREE_TIER_COST_LIMITS.memoryQueueMinRetryDelaySeconds)
  );
}

export function onlyMemoryPostTurnQueueIsActive(
  producers: readonly Readonly<Record<string, unknown>>[],
  consumers: readonly Readonly<Record<string, unknown>>[],
  expectedQueue: string,
) {
  if (producers.length !== 1 || consumers.length !== 1) return false;
  const producer = producers[0];
  if (!producer || !hasExactKeys(producer, ["binding", "queue"])) return false;
  return producer.binding === "MEMORY_POST_TURN_QUEUE" && producer.queue === expectedQueue;
}

export function cacheDurableObjectBindingIsTombstone(
  bindings: readonly Readonly<Record<string, unknown>>[],
) {
  if (bindings.length !== 1) return false;
  const binding = bindings[0];
  if (!binding || !hasExactKeys(binding, ["name", "class_name"])) return false;
  return (
    binding.name === DORMANT_CACHE_DO_BINDING_NAME &&
    binding.class_name === DORMANT_CACHE_DO_CLASS_NAME
  );
}

export function cacheDurableObjectMigrationIsTombstone(
  migrations: readonly Readonly<Record<string, unknown>>[],
) {
  const sqliteClasses = migrations.flatMap((migration) =>
    Array.isArray(migration.new_sqlite_classes)
      ? migration.new_sqlite_classes.filter((name): name is string => typeof name === "string")
      : [],
  );
  const classicClasses = migrations.flatMap((migration) =>
    Array.isArray(migration.new_classes)
      ? migration.new_classes.filter((name): name is string => typeof name === "string")
      : [],
  );
  return (
    migrations.some((migration) => migration.tag === DORMANT_CACHE_DO_MIGRATION_TAG) &&
    sqliteClasses.length === 1 &&
    sqliteClasses[0] === DORMANT_CACHE_DO_CLASS_NAME &&
    classicClasses.length === 0
  );
}

export function retiredOpenNextCacheR2IsUnbound(
  buckets: readonly Readonly<Record<string, unknown>>[],
  configuredRetiredBucketName: string,
) {
  if (configuredRetiredBucketName !== RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME) return false;
  return buckets.every((bucket) => {
    const binding = bucket.binding;
    const bucketName = bucket.bucket_name;
    return (
      typeof binding === "string" &&
      typeof bucketName === "string" &&
      !retiredCacheR2Bindings.has(binding) &&
      bucketName !== RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME
    );
  });
}

export function steadyStateSampleRateAtMost(value: unknown, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= max;
}

export function observabilitySamplingWithinFreeTier(
  rates: { worker: unknown; logs: unknown; traces: unknown },
  incidentMode: boolean,
) {
  const workerMax = incidentMode ? 1 : FREE_TIER_COST_LIMITS.observabilityHeadSampleRate;
  const logMax = incidentMode ? 1 : FREE_TIER_COST_LIMITS.observabilityLogSampleRate;
  const traceMax = incidentMode ? 1 : FREE_TIER_COST_LIMITS.observabilityTraceSampleRate;
  return (
    steadyStateSampleRateAtMost(rates.worker, workerMax) &&
    steadyStateSampleRateAtMost(rates.logs, logMax) &&
    steadyStateSampleRateAtMost(rates.traces, traceMax)
  );
}
