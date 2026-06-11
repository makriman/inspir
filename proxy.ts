import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isKnownTopicSlug, isUuidPathSegment } from "@/lib/content/topic-routing";
import { normalizeLanguage } from "@/lib/content/languages";
import { recommendLanguage } from "@/lib/i18n/language-detection";
import {
  getLocalizedPathInfo,
  localeCookieName,
  localizePath,
  requestLanguageHeader,
  requestLocaleHeader,
  requestLocalePrefixHeader,
  requestPathnameHeader,
  requestRecommendedLanguageHeader,
} from "@/lib/i18n/routing";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const localizedPath = getLocalizedPathInfo(pathname);
  const effectivePathname = localizedPath.pathnameWithoutLocale;
  const cookieLanguage = normalizeLanguage(request.cookies.get(localeCookieName)?.value);
  const referrerLanguage = getReferrerLocaleLanguage(request.headers.get("referer"));
  const language = localizedPath.hasLocalePrefix ? localizedPath.language : referrerLanguage ?? cookieLanguage;
  const recommendedLanguage = recommendLanguage({
    countryCode: request.headers.get("x-vercel-ip-country"),
    acceptLanguage: request.headers.get("accept-language"),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(requestLanguageHeader, language);
  requestHeaders.set(requestLocaleHeader, language);
  requestHeaders.set(requestLocalePrefixHeader, localizedPath.hasLocalePrefix ? "1" : "0");
  requestHeaders.set(requestPathnameHeader, effectivePathname);
  requestHeaders.set(requestRecommendedLanguageHeader, recommendedLanguage);

  const chatSegment = effectivePathname.match(/^\/chat\/([^/]+)$/)?.[1];
  const isPublicTopicChat = chatSegment ? isKnownTopicSlug(chatSegment) : false;
  const isPrivateChatThread = chatSegment ? isUuidPathSegment(chatSegment) : false;
  const needsAuth = effectivePathname.startsWith("/admin") || (isPrivateChatThread && !isPublicTopicChat);
  const shouldRedirectToLocale =
    !localizedPath.hasLocalePrefix && language !== "English" && shouldLocaleRedirectPath(effectivePathname);

  if (shouldRedirectToLocale) {
    const url = request.nextUrl.clone();
    url.pathname = localizePath(effectivePathname, language);
    return NextResponse.redirect(url);
  }

  const buildResponse = () => {
    if (!localizedPath.hasLocalePrefix) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    const url = request.nextUrl.clone();
    url.pathname = effectivePathname;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  };

  if (!needsAuth) {
    const response = buildResponse();
    if (localizedPath.hasLocalePrefix) {
      response.cookies.set(localeCookieName, localizedPath.language, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || undefined,
  });

  if (!token) {
    return NextResponse.redirect(new URL(localizePath("/", language), request.url));
  }

  return buildResponse();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest|.*\\..*).*)"],
};

function getReferrerLocaleLanguage(referrer: string | null) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    const info = getLocalizedPathInfo(url.pathname);
    return info.hasLocalePrefix ? info.language : null;
  } catch {
    return null;
  }
}

function shouldLocaleRedirectPath(pathname: string) {
  if (pathname.startsWith("/admin")) return false;
  if (pathname.startsWith("/onboarding")) return false;
  return true;
}
