import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isKnownTopicSlug, isUuidPathSegment } from "@/lib/content/topic-routing";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const chatSegment = pathname.match(/^\/chat\/([^/]+)$/)?.[1];
  const isPublicTopicChat = chatSegment ? isKnownTopicSlug(chatSegment) : false;
  const isPrivateChatThread = chatSegment ? isUuidPathSegment(chatSegment) : false;
  const needsAuth = pathname.startsWith("/admin") || (isPrivateChatThread && !isPublicTopicChat);

  if (!needsAuth) return NextResponse.next();

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  });

  if (!token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/chat/:path*", "/admin/:path*"],
};
