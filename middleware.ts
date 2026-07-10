import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isKnownTopicSlug, isUuidPathSegment } from "@/lib/content/topic-routing";
import { buildForwardedRequestHeaders } from "@/lib/http/forwarded-request-headers";
import { canonicalOriginRedirectUrl } from "@/lib/http/canonical-origin";
import { recommendLanguage } from "@/lib/i18n/language-detection";
import { resolveRequestLanguage } from "@/lib/i18n/language-preference";
import { isStaticSiteLanguageAvailableForPath } from "@/lib/i18n/static-availability";
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
import {
  buildCacheableMarketingContentSecurityPolicy,
  buildContentSecurityPolicy,
  cspNonceHeader,
  staticSecurityHeaders,
} from "@/lib/security/headers";

// OpenNext Cloudflare 1.19.11 does not yet support the Next 16 nodejs proxy output.
// Keep Edge Middleware until the Cloudflare adapter supports proxy.ts.
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const canonicalUrl = canonicalOriginRedirectUrl(request.nextUrl, request.headers);
  if (canonicalUrl) {
    return applySecurityHeaders(NextResponse.redirect(canonicalUrl, 308), buildContentSecurityPolicy(createNonce()));
  }

  const localizedPath = getLocalizedPathInfo(pathname);
  const effectivePathname = localizedPath.pathnameWithoutLocale;
  const marketingPageRequest = isMarketingPageRequest(request, effectivePathname);
  const cacheableMarketingRequest =
    marketingPageRequest && isPubliclyCacheableMarketingRequest(request, effectivePathname);
  const immutableLocalizedMarketingRequest =
    cacheableMarketingRequest &&
    localizedPath.hasLocalePrefix &&
    isStaticSiteLanguageAvailableForPath(effectivePathname, localizedPath.language);
  const nonce = marketingPageRequest ? undefined : createNonce();
  const csp = nonce ? buildContentSecurityPolicy(nonce) : buildCacheableMarketingContentSecurityPolicy();
  const referrerLanguage = getReferrerLocaleLanguage(request.headers.get("referer"));
  const language = resolveRequestLanguage({
    localeLanguage: localizedPath.hasLocalePrefix ? localizedPath.language : null,
    cookieLanguage: request.cookies.get(localeCookieName)?.value,
    referrerLanguage,
  });
  const recommendedLanguage = recommendLanguage({
    countryCode: request.headers.get("cf-ipcountry"),
    acceptLanguage: request.headers.get("accept-language"),
  });
  const internalHeaders: Array<readonly [string, string]> = [
    ["Content-Security-Policy", csp],
    [requestLanguageHeader, language],
    [requestLocaleHeader, language],
    [requestLocalePrefixHeader, localizedPath.hasLocalePrefix ? "1" : "0"],
    [requestPathnameHeader, effectivePathname],
    [requestRecommendedLanguageHeader, recommendedLanguage],
  ];
  if (nonce) internalHeaders.unshift([cspNonceHeader, nonce]);
  const requestHeaders = buildForwardedRequestHeaders(request.headers, internalHeaders);

  const chatSegment = effectivePathname.match(/^\/chat\/([^/]+)$/)?.[1];
  const isPublicTopicChat = chatSegment ? isKnownTopicSlug(chatSegment) : false;
  const isPrivateChatThread = chatSegment ? isUuidPathSegment(chatSegment) : false;
  const needsAuth = effectivePathname.startsWith("/admin") || (isPrivateChatThread && !isPublicTopicChat);
  const shouldRedirectToLocale =
    !localizedPath.hasLocalePrefix &&
    language !== "English" &&
    shouldLocaleRedirectPath(effectivePathname) &&
    (!isMarketingPath(effectivePathname) || isStaticSiteLanguageAvailableForPath(effectivePathname, language));

  if (
    localizedPath.hasLocalePrefix &&
    isMarketingPath(effectivePathname) &&
    !isStaticSiteLanguageAvailableForPath(effectivePathname, localizedPath.language)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = effectivePathname;
    const response = NextResponse.redirect(url, 308);
    response.cookies.set(localeCookieName, localizedPath.language, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return applyMarketingCacheHeaders(applySecurityHeaders(response, csp), false);
  }

  if (shouldRedirectToLocale) {
    const url = request.nextUrl.clone();
    url.pathname = localizePath(effectivePathname, language);
    return applySecurityHeaders(NextResponse.redirect(url), csp);
  }

  const buildResponse = () => {
    let response: NextResponse;
    if (!localizedPath.hasLocalePrefix || hasLocalizedMarketingRoute(effectivePathname)) {
      response = NextResponse.next({ request: { headers: requestHeaders } });
      return applyMarketingCacheHeaders(
        applySecurityHeaders(response, csp),
        cacheableMarketingRequest,
        immutableLocalizedMarketingRequest,
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = effectivePathname;
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    return applyMarketingCacheHeaders(
      applySecurityHeaders(response, csp),
      cacheableMarketingRequest,
      immutableLocalizedMarketingRequest,
    );
  };

  if (!needsAuth) {
    const response = buildResponse();
    if (localizedPath.hasLocalePrefix && !cacheableMarketingRequest) {
      response.cookies.set(localeCookieName, localizedPath.language, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  }

  if (!hasBetterAuthSessionCookie(request)) {
    return applySecurityHeaders(NextResponse.redirect(new URL(localizePath("/", language), request.url)), csp);
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

const marketingStaticPaths = new Set([
  "/",
  "/about",
  "/ai-learning-map",
  "/blog",
  "/compare",
  "/for",
  "/learn",
  "/loading",
  "/media",
  "/mission",
  "/privacy",
  "/prompts",
  "/reset_pw",
  "/schools",
  "/subjects",
  "/terms",
  "/topics",
  "/trust",
]);

const marketingStaticPrefixes = ["/blog", "/compare", "/for", "/learn", "/subjects"];

const localizedMarketingRoutePaths = new Set([
  "/",
  "/mission",
]);

function isMarketingPageRequest(request: NextRequest, pathname: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.headers.get("rsc") === "1") return false;
  if (request.nextUrl.searchParams.has("_rsc")) return false;
  return isMarketingPath(pathname);
}

function isPubliclyCacheableMarketingRequest(request: NextRequest, pathname: string) {
  if (pathname === "/reset_pw") return false;
  return !hasBetterAuthSessionCookie(request);
}

function isMarketingPath(pathname: string) {
  if (marketingStaticPaths.has(pathname)) return true;
  return marketingStaticPrefixes.some((prefix) => pathname.startsWith(`${prefix}/`));
}

function hasLocalizedMarketingRoute(pathname: string) {
  return localizedMarketingRoutePaths.has(pathname);
}

function hasBetterAuthSessionCookie(request: NextRequest) {
  return (
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("__Secure-better-auth.session_token")
  );
}

function createNonce() {
  return btoa(crypto.randomUUID());
}

function applySecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp);
  for (const header of staticSecurityHeaders) {
    response.headers.set(header.key, header.value);
  }
  return response;
}

function applyMarketingCacheHeaders(
  response: NextResponse,
  cacheable: boolean,
  immutableLocalized = false,
) {
  response.headers.set("Vary", "Accept-Encoding, Cookie");
  if (!cacheable) {
    response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
    return response;
  }
  response.headers.set(
    "Cache-Control",
    immutableLocalized
      ? "public, max-age=0, s-maxage=31536000, must-revalidate"
      : "public, s-maxage=3600, stale-while-revalidate=86400",
  );
  return response;
}
