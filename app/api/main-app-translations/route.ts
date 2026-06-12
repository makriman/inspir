import { NextRequest, NextResponse } from "next/server";

import { supportedLanguages, type SupportedLanguage } from "@/lib/content/languages";
import { getOrCreateMainAppTranslationResult } from "@/lib/i18n/main-app-translations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const language = request.nextUrl.searchParams.get("language");

  if (!isSupportedLanguage(language)) {
    return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  }

  const result = await getOrCreateMainAppTranslationResult(language);
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": result.complete
        ? "public, max-age=300, s-maxage=3600"
        : "no-store",
    },
  });
}

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return Boolean(value && supportedLanguages.includes(value as SupportedLanguage));
}
