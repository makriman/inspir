import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import queueCache from "@opennextjs/cloudflare/overrides/queue/queue-cache";

export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: "long-lived",
    // This app does not call revalidateTag/revalidatePath. Build-scoped cache keys
    // and TTL-based ISR let regional hits avoid a redundant R2 read + JSON parse.
    bypassTagCacheOnCacheHit: true,
    shouldLazilyUpdateOnCacheHit: false,
  }),
  queue: queueCache(doQueue, {
    regionalCacheTtlSec: 5,
    waitForQueueAck: true,
  }),
  enableCacheInterception: true,
  routePreloadingBehavior: "none",
});
