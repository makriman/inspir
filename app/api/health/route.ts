import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const healthHeaders = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "private, no-store",
  "Cloudflare-CDN-Cache-Control": "private, no-store",
} as const;

export function GET() {
  const env = getCloudflareContext().env;
  return NextResponse.json(
    {
      ok: true,
      runtime: "cloudflare-workers",
      version: {
        id: env.CF_VERSION_METADATA.id,
        tag: env.CF_VERSION_METADATA.tag,
        timestamp: env.CF_VERSION_METADATA.timestamp,
      },
      build: {
        id: process.env.OPEN_NEXT_BUILD_ID ?? "unknown-build",
      },
      architecture: {
        cacheRevalidationQueue: Boolean(env.NEXT_CACHE_DO_QUEUE),
        incrementalCache: "regional-r2",
        workerWideCache: false,
      },
    },
    { headers: healthHeaders },
  );
}
