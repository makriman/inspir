import { handleFreeGuestChat } from "./lib/free-runtime/guest-chat";

const leanApiDelivery = "lean-api-worker";

type LeanWorkerEnv = Pick<
  CloudflareEnv,
  | "DB"
  | "CF_VERSION_METADATA"
  | "APP_WRITE_FREEZE"
  | "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS"
  | "RATE_LIMIT_GUEST_SESSION_DAILY"
  | "RATE_LIMIT_GUEST_FINGERPRINT_DAILY"
  | "RATE_LIMIT_GUEST_IP_DAILY"
  | "LLM_GLOBAL_DAILY_CALL_LIMIT"
  | "CLOUDFLARE_AI_GATEWAY_BASE_URL"
  | "CLOUDFLARE_AI_GATEWAY_TOKEN"
  | "CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS"
  | "OPENAI_MODEL"
  | "OPENAI_FAST_MODEL"
  | "OPENAI_REASONING_MODEL"
  | "OPENAI_STRUCTURED_MODEL"
>;

const privateApiHeaders = {
  "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "cdn-cache-control": "private, no-store",
  "cloudflare-cdn-cache-control": "private, no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-inspir-delivery": leanApiDelivery,
} as const;

const handler = {
  fetch(request: Request, env: LeanWorkerEnv): Response | Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/api/health") return healthResponse(request, env);
    if (pathname === "/api/guest-chat") return handleFreeGuestChat(request, env);

    return jsonResponse({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<LeanWorkerEnv>;

export default handler;

function healthResponse(request: Request, env: LeanWorkerEnv) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed" }, 405, { allow: "GET, HEAD" });
  }

  const body = {
    ok: true,
    runtime: "cloudflare-workers",
    version: {
      id: env.CF_VERSION_METADATA.id,
      tag: env.CF_VERSION_METADATA.tag,
      timestamp: env.CF_VERSION_METADATA.timestamp,
    },
    architecture: {
      deploymentMode: "free-static-lean-guest",
      publicDocuments: "workers-static-assets",
      workerCpuPlan: "free-10ms",
      openNext: false,
      accounts: false,
      savedState: false,
      games: false,
      guestTutor: true,
      incrementalCache: "none",
      cacheQueueActive: false,
    },
  } as const;

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: responseHeaders() });
  }
  return jsonResponse(body, 200);
}

function jsonResponse(
  body: Readonly<Record<string, unknown>>,
  status: number,
  extraHeaders?: Readonly<Record<string, string>>,
) {
  const headers = responseHeaders(extraHeaders);
  return new Response(JSON.stringify(body), { status, headers });
}

function responseHeaders(extraHeaders?: Readonly<Record<string, string>>) {
  return new Headers({
    ...privateApiHeaders,
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
}

// Keep the existing post-migration Durable Object class available for safe rollback.
// It is not called by the static/guest runtime.
export { DOQueueHandler } from "./.open-next/.build/durable-objects/queue.js";
