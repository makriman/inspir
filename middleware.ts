import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isKnownTopicSlug, isUuidPathSegment } from "@/lib/content/topic-routing";
import { buildForwardedRequestHeaders } from "@/lib/http/forwarded-request-headers";
import { recommendLanguage } from "@/lib/i18n/language-detection";
import { resolveRequestLanguage } from "@/lib/i18n/language-preference";
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
import { buildContentSecurityPolicy, cspNonceHeader, staticSecurityHeaders } from "@/lib/security/headers";

// OpenNext Cloudflare 1.19.11 does not yet support the Next 16 nodejs proxy output.
// Keep Edge Middleware until the Cloudflare adapter supports proxy.ts.
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce);
  const canonicalUrl = canonicalOriginRedirectUrl(request);
  if (canonicalUrl) {
    return applySecurityHeaders(NextResponse.redirect(canonicalUrl, 308), csp);
  }

  const localizedPath = getLocalizedPathInfo(pathname);
  const effectivePathname = localizedPath.pathnameWithoutLocale;
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
  const requestHeaders = buildForwardedRequestHeaders(request.headers, [
    [cspNonceHeader, nonce],
    ["Content-Security-Policy", csp],
    [requestLanguageHeader, language],
    [requestLocaleHeader, language],
    [requestLocalePrefixHeader, localizedPath.hasLocalePrefix ? "1" : "0"],
    [requestPathnameHeader, effectivePathname],
    [requestRecommendedLanguageHeader, recommendedLanguage],
  ]);

  const chatSegment = effectivePathname.match(/^\/chat\/([^/]+)$/)?.[1];
  const isPublicTopicChat = chatSegment ? isKnownTopicSlug(chatSegment) : false;
  const isPrivateChatThread = chatSegment ? isUuidPathSegment(chatSegment) : false;
  const needsAuth = effectivePathname.startsWith("/admin") || (isPrivateChatThread && !isPublicTopicChat);
  const shouldRedirectToLocale =
    !localizedPath.hasLocalePrefix && language !== "English" && shouldLocaleRedirectPath(effectivePathname);

  if (shouldRedirectToLocale) {
    const url = request.nextUrl.clone();
    url.pathname = localizePath(effectivePathname, language);
    return applySecurityHeaders(NextResponse.redirect(url), csp);
  }

  const buildResponse = () => {
    let response: NextResponse;
    if (!localizedPath.hasLocalePrefix) {
      response = NextResponse.next({ request: { headers: requestHeaders } });
      return applySecurityHeaders(response, csp);
    }

    const url = request.nextUrl.clone();
    url.pathname = effectivePathname;
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    return applySecurityHeaders(response, csp);
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

function canonicalOriginRedirectUrl(request: NextRequest) {
  const url = request.nextUrl.clone();
  const hostname = url.hostname.toLowerCase();
  const isInspirHost = hostname === "inspirlearning.com" || hostname === "www.inspirlearning.com";
  const needsHttps = isInspirHost && url.protocol === "http:";
  const needsApex = hostname === "www.inspirlearning.com";

  if (!needsHttps && !needsApex) return null;

  url.protocol = "https:";
  if (needsApex) {
    url.hostname = "inspirlearning.com";
    url.port = "";
  }
  return url;
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
