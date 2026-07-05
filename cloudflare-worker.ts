import { default as handler } from "./.open-next/worker.js";
import { processMemoryPostTurnQueueBatch } from "./lib/ai/memory-queue";

export default {
  fetch: handler.fetch,

  async scheduled(controller, env, ctx) {
    const cronSecret = env.CRON_SECRET?.trim();
    if (!cronSecret) {
      console.error(JSON.stringify({ event: "cron_skipped", reason: "missing_cron_secret" }));
      return;
    }

    const cronUrl = new URL("/api/cron/memory-dreaming", env.APP_URL ?? "https://inspirlearning.com");
    console.log(JSON.stringify({ event: "cron_dispatch", cron: controller.cron, origin: cronUrl.origin }));

    const request = new Request(cronUrl.toString(), {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "x-inspir-cron-source": "cloudflare-scheduled",
      },
    });

    ctx.waitUntil(
      (async () => {
        const response = await handler.fetch(request, env, ctx);
        if (!response.ok) {
          console.error(
            JSON.stringify({
              event: "cron_failed",
              status: response.status,
              statusText: response.statusText,
            }),
          );
        }
      })(),
    );
  },

  async queue(batch, env) {
    await processMemoryPostTurnQueueBatch(batch, env);
  },
} satisfies ExportedHandler<CloudflareEnv>;

// Re-exported for OpenNext cache internals when enabled.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
