import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  cacheDurableObjectBindingIsTombstone,
  cacheDurableObjectMigrationIsTombstone,
  FREE_TIER_COST_LIMITS,
  memoryQueueConsumerWithinFreeTier,
  observabilitySamplingWithinFreeTier,
  onlyMemoryPostTurnQueueIsActive,
  retiredOpenNextCacheR2IsUnbound,
  RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME,
} from "../lib/free-runtime/free-tier-cost-limits";
import {
  MAX_RATE_LIMIT_PRUNE_ROWS,
  MAX_STALE_AI_RUN_REPAIRS,
  NATIVE_SCHEDULED_MEMORY_USER_CAP,
} from "../lib/free-runtime/state-api";
import { R2_BUCKET_NAME } from "../scripts/cloudflare/migration-config";

const queue = "inspirlearning-memory-post-turn-prod";
const deadLetterQueue = "inspirlearning-memory-post-turn-dlq";

function memoryConsumer(overrides: Record<string, unknown> = {}) {
  return {
    queue,
    max_batch_size: 1,
    max_batch_timeout: 10,
    max_retries: 5,
    retry_delay: 60,
    dead_letter_queue: deadLetterQueue,
    ...overrides,
  };
}

test("Free-tier cost ceilings stay pinned to the runtime cron caps", () => {
  assert.deepEqual(FREE_TIER_COST_LIMITS, {
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
  });
  assert.equal(NATIVE_SCHEDULED_MEMORY_USER_CAP, 25);
  assert.equal(MAX_RATE_LIMIT_PRUNE_ROWS, 5_000);
  assert.equal(MAX_STALE_AI_RUN_REPAIRS, 500);
  assert.equal(NATIVE_SCHEDULED_MEMORY_USER_CAP, FREE_TIER_COST_LIMITS.synthesisUserCap);
  assert.equal(MAX_RATE_LIMIT_PRUNE_ROWS, FREE_TIER_COST_LIMITS.rateLimitPruneRows);
  assert.equal(MAX_STALE_AI_RUN_REPAIRS, FREE_TIER_COST_LIMITS.staleAiRunRepairs);
  assert.equal(R2_BUCKET_NAME, RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME);

  const stateApi = fs.readFileSync(path.resolve("lib/free-runtime/state-api.ts"), "utf8");
  assert.match(stateApi, /limit \$\{MAX_RATE_LIMIT_PRUNE_ROWS\}/);
  assert.match(stateApi, /limit \$\{MAX_STALE_AI_RUN_REPAIRS\}/);
  assert.match(
    stateApi,
    /Math\.min\(maxDailySynthesisUsers, Math\.max\(1, Math\.trunc\(input\.limit\)\)\)/,
  );

  const preflight = fs.readFileSync(path.resolve("scripts/cloudflare/deploy-preflight.ts"), "utf8");
  assert.match(preflight, /freeTierCostLimitsMatchPins/);
  assert.match(preflight, /runtimeCronCapsUseSharedLimits/);
  assert.match(preflight, /synthesisUserCap: 25/);
  assert.match(preflight, /rateLimitPruneRows: 5_000/);
  assert.match(preflight, /staleAiRunRepairs: 500/);
});

test("memory queue consumer rejects batch, timeout, and retry settings above the Free ceiling", () => {
  assert.equal(memoryQueueConsumerWithinFreeTier(memoryConsumer(), queue, deadLetterQueue), true);
  assert.equal(
    memoryQueueConsumerWithinFreeTier(memoryConsumer({ max_batch_size: 5 }), queue, deadLetterQueue),
    false,
  );
  assert.equal(
    memoryQueueConsumerWithinFreeTier(memoryConsumer({ max_batch_timeout: 11 }), queue, deadLetterQueue),
    false,
  );
  assert.equal(
    memoryQueueConsumerWithinFreeTier(memoryConsumer({ max_batch_timeout: 0 }), queue, deadLetterQueue),
    false,
  );
  assert.equal(
    memoryQueueConsumerWithinFreeTier(memoryConsumer({ max_retries: 6 }), queue, deadLetterQueue),
    false,
  );
  assert.equal(
    memoryQueueConsumerWithinFreeTier(memoryConsumer({ retry_delay: 59 }), queue, deadLetterQueue),
    false,
  );
  assert.equal(
    memoryQueueConsumerWithinFreeTier(
      memoryConsumer({ max_concurrency: 10 }),
      queue,
      deadLetterQueue,
    ),
    false,
  );
});

test("cache queue consumers and the retired OpenNext R2 bucket stay inactive", () => {
  const producer = [{ binding: "MEMORY_POST_TURN_QUEUE", queue }];
  const consumer = [memoryConsumer()];
  assert.equal(onlyMemoryPostTurnQueueIsActive(producer, consumer, queue), true);
  assert.equal(
    onlyMemoryPostTurnQueueIsActive(
      producer,
      [memoryConsumer(), { queue: "inspirlearning-cache", max_batch_size: 10 }],
      queue,
    ),
    false,
  );
  assert.equal(
    cacheDurableObjectBindingIsTombstone([
      { name: "NEXT_CACHE_DO_QUEUE", class_name: "DOQueueHandler" },
    ]),
    true,
  );
  assert.equal(
    cacheDurableObjectBindingIsTombstone([
      { name: "NEXT_CACHE_DO_QUEUE", class_name: "DOQueueHandler", script_name: "open-next" },
    ]),
    false,
  );
  assert.equal(cacheDurableObjectBindingIsTombstone([]), false);
  assert.equal(
    cacheDurableObjectMigrationIsTombstone([
      { tag: "opennext-cache-queue-v1", new_sqlite_classes: ["DOQueueHandler"] },
    ]),
    true,
  );
  assert.equal(
    cacheDurableObjectMigrationIsTombstone([
      { tag: "opennext-cache-queue-v1", new_sqlite_classes: ["DOQueueHandler"] },
      { tag: "extra-do", new_sqlite_classes: ["PaidHandler"] },
    ]),
    false,
  );
  assert.equal(
    retiredOpenNextCacheR2IsUnbound(
      [{ binding: "PROFILE_IMAGES_R2_BUCKET", bucket_name: "inspirlearning-profile-images-prod" }],
      RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME,
    ),
    true,
  );
  assert.equal(
    retiredOpenNextCacheR2IsUnbound(
      [
        { binding: "PROFILE_IMAGES_R2_BUCKET", bucket_name: "inspirlearning-profile-images-prod" },
        { binding: "NEXT_CACHE_R2_BUCKET", bucket_name: "some-cache" },
      ],
      RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME,
    ),
    false,
  );
  assert.equal(
    retiredOpenNextCacheR2IsUnbound(
      [{ binding: "CACHE", bucket_name: RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME }],
      RETIRED_OPENNEXT_CACHE_R2_BUCKET_NAME,
    ),
    false,
  );
});

test("steady-state observability sample rates stay at the committed Free head rates", () => {
  assert.equal(
    observabilitySamplingWithinFreeTier({ worker: 0.02, logs: 0.05, traces: 0.02 }, false),
    true,
  );
  assert.equal(
    observabilitySamplingWithinFreeTier({ worker: 0.03, logs: 0.05, traces: 0.02 }, false),
    false,
  );
  assert.equal(
    observabilitySamplingWithinFreeTier({ worker: 0.02, logs: 0.1, traces: 0.02 }, false),
    false,
  );
  assert.equal(
    observabilitySamplingWithinFreeTier({ worker: 1, logs: 1, traces: 1 }, true),
    true,
  );
  assert.equal(
    observabilitySamplingWithinFreeTier({ worker: 1, logs: 1, traces: 1 }, false),
    false,
  );
});
