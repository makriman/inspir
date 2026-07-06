import { toNextJsHandler } from "better-auth/next-js";
import { after } from "next/server";
import { createAuth } from "@/lib/auth/better-auth";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";
import { recordOpsEvent } from "@/lib/observability/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = toNextJsHandler((request) => createAuth().handler(request));

export async function GET(request: Request) {
  const freeze = authWriteFreezeResponse(request);
  if (freeze) return freeze;
  return runObservedAuthHandler("GET", request, handler.GET);
}

export async function POST(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return runObservedAuthHandler("POST", request, handler.POST);
}

export async function PATCH(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return runObservedAuthHandler("PATCH", request, handler.PATCH);
}

export async function PUT(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return runObservedAuthHandler("PUT", request, handler.PUT);
}

export async function DELETE(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return runObservedAuthHandler("DELETE", request, handler.DELETE);
}

function authWriteFreezeResponse(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.includes("/api/auth/callback/")) return null;
  return writeFreezeResponse("auth");
}

async function runObservedAuthHandler(
  method: string,
  request: Request,
  action: (request: Request) => Response | Promise<Response>,
) {
  const response = await action(request);
  queueAuthTelemetry(method, request, response);
  return response;
}

function queueAuthTelemetry(method: string, request: Request, response: Response) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isInteresting =
    response.status >= 400 ||
    path.includes("/api/auth/callback/") ||
    path.includes("/api/auth/sign-in") ||
    path.includes("/api/auth/sign-out");
  if (!isInteresting) return;

  after(async () => {
    await recordOpsEvent({
      eventName: response.status >= 400 ? "auth_route_error" : "auth_route_event",
      severity: response.status >= 500 ? "critical" : response.status >= 400 ? "warning" : "info",
      surface: "auth",
      message: `${method} ${path} returned ${response.status}`,
      metadata: {
        method,
        path,
        status: response.status,
        redirected: response.redirected,
        location: response.headers.get("location")?.slice(0, 240) ?? null,
      },
    });
  });
}
