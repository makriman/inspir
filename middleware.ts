import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  });
  const pathname = request.nextUrl.pathname;

  if ((pathname.startsWith("/chat") || pathname.startsWith("/admin")) && !token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/" && token) {
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/chat/:path*", "/admin/:path*"],
};
