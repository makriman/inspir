import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth/config";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthRouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

const handler = NextAuth(authOptions);

export function GET(request: NextRequest, context: AuthRouteContext) {
  const pathname = new URL(request.url).pathname;
  if (pathname.includes("/api/auth/callback/")) {
    const freeze = writeFreezeResponse("auth");
    if (freeze) return freeze;
  }
  return handler(request, context);
}

export function POST(request: NextRequest, context: AuthRouteContext) {
  const freeze = writeFreezeResponse("auth");
  if (freeze) return freeze;
  return handler(request, context);
}
