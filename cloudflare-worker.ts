import {
  handleAccountApiRequest,
  prewarmAccountApi,
} from "./lib/free-runtime/account-api";
import { handleFreeGuestChat } from "./lib/free-runtime/guest-chat";
import { handleLegacyI18nApiRequest } from "./lib/free-runtime/legacy-i18n-api";
import { handleProtectedAiApiRequest } from "./lib/free-runtime/protected-ai-api";
import {
  handleMemoryQueue,
  handleMemoryScheduled,
  handleStateApiRequest,
} from "./lib/free-runtime/state-api";
import { isUuidPathSegment, resolveTopicSlug } from "./lib/content/topic-routing";
import { languagePrefixToLanguage } from "./lib/content/languages";
import {
  isWriteFreezeEnabled,
  writeFreezeErrorCode,
} from "./lib/migration/write-freeze";
import { DurableObject, env as workerEnv } from "cloudflare:workers";

const nativeWorkerDelivery = "lean-api-worker";

// Validate the native auth configuration at isolate startup. OAuth request
// handling stays framework-free so cold requests fit Workers Free's CPU limit.
await prewarmAccountApi(workerEnv);

const privateApiHeaders = {
  "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "cdn-cache-control": "private, no-store",
  "cloudflare-cdn-cache-control": "private, no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-inspir-delivery": nativeWorkerDelivery,
} as const;

const handler = {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    try {
      if (pathname === "/api/health") return healthResponse(request, env);
      if (pathname === "/api/migration/write-freeze") {
        return writeFreezeStatusResponse(request, env);
      }
      if (pathname === "/api/guest-chat") {
        return withNativeWorkerDelivery(await handleFreeGuestChat(request, env));
      }
      if (isChatChildPath(pathname)) return handleChatDocumentRequest(request, env);

      const legacyI18nResponse = await handleLegacyI18nApiRequest(request, env);
      if (legacyI18nResponse) return legacyI18nResponse;

      const accountResponse = await handleAccountApiRequest(request, env, ctx);
      if (accountResponse) return withNativeWorkerDelivery(accountResponse);

      const stateResponse = await handleStateApiRequest(request, env, ctx);
      if (stateResponse) return withNativeWorkerDelivery(stateResponse);

      const protectedResponse = await handleProtectedAiApiRequest(request, env, ctx);
      if (protectedResponse) return withNativeWorkerDelivery(protectedResponse);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "native_worker_request_failed",
          path: pathname,
          method: request.method,
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return jsonResponse({ error: "The request could not be completed right now." }, 500);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    await handleMemoryScheduled(controller, env, ctx);
  },

  async queue(batch, env, ctx) {
    await handleMemoryQueue(batch, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;

export default handler;

function healthResponse(request: Request, env: CloudflareEnv) {
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
      deploymentMode: "free-static-native-accounts",
      publicDocuments: "workers-static-assets",
      workerCpuPlan: "free-10ms",
      openNext: false,
      accounts: true,
      savedState: true,
      memory: true,
      admin: true,
      activities: true,
      games: false,
      guestTutor: true,
      authenticatedTutor: true,
      incrementalCache: "none",
      cacheQueueActive: false,
      memoryQueueActive: true,
    },
  } as const;

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: responseHeaders() });
  }
  return jsonResponse(body, 200);
}

function writeFreezeStatusResponse(request: Request, env: CloudflareEnv) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed" }, 405, { allow: "GET, HEAD" });
  }
  const writeFreezeActive = isWriteFreezeEnabled({
    APP_WRITE_FREEZE: env.APP_WRITE_FREEZE,
  });
  const status = writeFreezeActive ? 200 : 409;
  const body = {
    ok: writeFreezeActive,
    writeFreezeActive,
    code: writeFreezeActive ? writeFreezeErrorCode : "write_freeze_inactive",
    versionId: env.CF_VERSION_METADATA.id,
  } as const;
  if (request.method === "HEAD") {
    return new Response(null, { status, headers: responseHeaders() });
  }
  return jsonResponse(body, status);
}

function isChatChildPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "chat") return true;
  return (
    segments.length === 3 &&
    segments[1] === "chat" &&
    Object.hasOwn(languagePrefixToLanguage, segments[0])
  );
}

async function handleChatDocumentRequest(request: Request, env: CloudflareEnv) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed" }, 405, { allow: "GET, HEAD" });
  }

  const url = new URL(request.url);
  const assets = env.ASSETS;
  if (!assets) return jsonResponse({ error: "Static chat assets are unavailable." }, 503);
  const segments = url.pathname.split("/").filter(Boolean);
  const localized = segments.length === 3;
  const candidate = segments.at(-1) ?? "";
  const publicTopicSlug = resolveTopicSlug(candidate);
  const chatDocumentPath = localized ? `/${segments[0]}/chat` : "/chat";

  if (publicTopicSlug) {
    url.pathname = chatDocumentPath;
    url.searchParams.set("topic", publicTopicSlug);
    url.searchParams.delete("chat");
    return new Response(null, {
      status: 308,
      headers: {
        location: url.toString(),
        "cache-control": "public, max-age=300, s-maxage=3600",
        "x-content-type-options": "nosniff",
        "x-inspir-delivery": nativeWorkerDelivery,
      },
    });
  }

  if (!isUuidPathSegment(candidate)) {
    return withNativeWorkerDelivery(await assets.fetch(request), { privateCache: true });
  }

  const shellUrl = new URL(request.url);
  shellUrl.pathname = chatDocumentPath;
  shellUrl.search = "";
  const shellRequest = new Request(shellUrl, {
    method: request.method,
    headers: request.headers,
  });
  return withNativeWorkerDelivery(await assets.fetch(shellRequest), { privateCache: true });
}

function withNativeWorkerDelivery(response: Response, options: { privateCache?: boolean } = {}) {
  const headers = new Headers(response.headers);
  headers.set("x-inspir-delivery", nativeWorkerDelivery);
  headers.set("x-content-type-options", "nosniff");
  if (options.privateCache) {
    headers.set("cache-control", privateApiHeaders["cache-control"]);
    headers.set("cdn-cache-control", privateApiHeaders["cdn-cache-control"]);
    headers.set("cloudflare-cdn-cache-control", privateApiHeaders["cloudflare-cdn-cache-control"]);
    headers.set("pragma", "no-cache");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

// Preserve the migrated class name without pulling OpenNext code into the
// Free-plan Worker. The old cache queue is intentionally dormant.
export class DOQueueHandler extends DurableObject<CloudflareEnv> {
  fetch() {
    return new Response("OpenNext cache queue is retired.", {
      status: 410,
      headers: { "cache-control": "private, no-store" },
    });
  }
}
