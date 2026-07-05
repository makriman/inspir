import { NextRequest, NextResponse } from "next/server";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import {
  localeCookieName,
  localePromptCookieName,
  localizeHref,
  removeLocaleFromPath,
} from "@/lib/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { language?: unknown; pathname?: unknown };
  const language = normalizeLanguage(body.language);
  const rawPathname = typeof body.pathname === "string" ? body.pathname : "/";
  const pathname = removeLocaleFromPath(rawPathname);
  const redirectTo = language === defaultLanguage ? pathname : localizeHref(pathname, language);

  const response = NextResponse.json({ language, redirectTo });
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
