import { toNextJsHandler } from "better-auth/next-js";
import { createAuth } from "@/lib/auth/better-auth";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = toNextJsHandler((request) => createAuth().handler(request));

export async function GET(request: Request) {
  const freeze = authWriteFreezeResponse(request);
  if (freeze) return freeze;
  return handler.GET(request);
}

export async function POST(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return handler.POST(request);
}

export async function PATCH(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return handler.PATCH(request);
}

export async function PUT(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return handler.PUT(request);
}

export async function DELETE(request: Request) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return handler.DELETE(request);
}

function authWriteFreezeResponse(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.includes("/api/auth/callback/")) return null;
  return writeFreezeResponse("auth");
}
