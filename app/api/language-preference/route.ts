import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { isStaticSiteLanguageAvailableForPath } from "@/lib/i18n/static-availability";
import {
  localeCookieName,
  localePromptCookieName,
  localizeHref,
  removeLocaleFromPath,
} from "@/lib/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const languagePreferenceRequestSchema = z
  .object({
    language: z.string().trim().min(1).max(80),
    pathname: z.string().trim().max(2_048).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = languagePreferenceRequestSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid language preference" }, { status: 400 });

  const language = normalizeLanguage(parsed.data.language);
  const rawPathname = parsed.data.pathname ?? "/";
  const pathname = removeLocaleFromPath(rawPathname);
  const pathnameWithoutSuffix = pathname.split(/[?#]/)[0] || "/";
  const requiresStaticCoverage =
    isMarketingPreferencePath(pathnameWithoutSuffix) || pathnameWithoutSuffix.startsWith("/games");
  const routeAvailable =
    !requiresStaticCoverage || isStaticSiteLanguageAvailableForPath(pathnameWithoutSuffix, language);
  const redirectTo = language === defaultLanguage || !routeAvailable ? pathname : localizeHref(pathname, language);

  const response = NextResponse.json({ language, redirectTo });
  response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
  response.cookies.set(localeCookieName, language, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.cookies.set(localePromptCookieName, "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

const marketingPreferencePaths = new Set([
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

function isMarketingPreferencePath(pathname: string) {
  if (marketingPreferencePaths.has(pathname)) return true;
  return ["/blog/", "/compare/", "/for/", "/learn/", "/subjects/"].some((prefix) => pathname.startsWith(prefix));
}
