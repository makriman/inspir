import { default as handler } from "./.open-next/worker.js";
import { enqueueDueMemorySynthesis, processMemoryQueueBatch } from "./lib/ai/memory-queue";
import { runWithRuntimeCloudflareEnv } from "./lib/runtime/cloudflare";
import { pruneExpiredRateLimits } from "./lib/utils/rate-limit";

export default {
  fetch: handler.fetch,

  async scheduled(controller, env, ctx) {
    console.log(JSON.stringify({ event: "cron_dispatch", cron: controller.cron, target: "memory_daily_synthesis" }));

    ctx.waitUntil(
      (async () => {
        try {
          const [stats, rateLimitPrune] = await Promise.all([
            enqueueDueMemorySynthesis(env, { reason: "daily_cron" }),
            runWithRuntimeCloudflareEnv(env, () => pruneExpiredRateLimits()),
          ]);
          console.log(JSON.stringify({ event: "cron_completed", cron: controller.cron, rateLimitPrune, ...stats }));
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "cron_failed",
              cron: controller.cron,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      })(),
    );
  },

  async queue(batch, env) {
    await processMemoryQueueBatch(batch, env);
  },
} satisfies ExportedHandler<CloudflareEnv>;

// Re-exported for OpenNext cache internals when enabled.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
