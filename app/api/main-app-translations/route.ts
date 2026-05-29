import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOrCreateMainAppTranslationBundle } from "@/lib/i18n/main-app-translations";
import { normalizeLanguage } from "@/lib/content/languages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const language = normalizeLanguage(request.nextUrl.searchParams.get("language"));

  try {
    const bundle = await getOrCreateMainAppTranslationBundle(language);
    return NextResponse.json({ bundle });
  } catch (error) {
    console.error("Main app translation failed", error);
    return NextResponse.json({ error: "Translation unavailable" }, { status: 500 });
  }
}
