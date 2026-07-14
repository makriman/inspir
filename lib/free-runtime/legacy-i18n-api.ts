import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import {
  isKnownLegacySiteTranslationNamespace,
  isPublishedLegacySiteTranslationPair,
  isSupportedLegacyTranslationLanguage,
  legacyLanguagePreferenceApiPath,
  legacyMainAppTranslationsApiPath,
  legacySiteTranslationsApiPath,
  legacyTranslationAssetPath,
} from "@/lib/i18n/legacy-api-compat";
import {
  localeCookieName,
  localePromptCookieName,
  localizeHref,
  removeLocaleFromPath,
} from "@/lib/i18n/routing";
import { getPotentialSiteTranslationNamespacesForPath } from "@/lib/i18n/site-path-namespaces";
import { isStaticSiteLanguageAvailableForPath } from "@/lib/i18n/static-availability";

const nativeWorkerDelivery = "lean-api-worker";
const maxLanguagePreferenceBodyBytes = 4_096;
const maxLanguagePreferencePathLength = 2_048;
const completeCacheControl = "public, max-age=300, s-maxage=3600";
const privateCacheControl = "private, no-cache, no-store, max-age=0, must-revalidate";

type StaticAssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

export type LegacyI18nApiEnv = {
  ASSETS?: StaticAssetFetcher;
};

type LanguagePreferencePayload = {
  language?: unknown;
  pathname?: unknown;
};

export async function handleLegacyI18nApiRequest(
  request: Request,
  env: LegacyI18nApiEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === legacyLanguagePreferenceApiPath) {
    return handleLanguagePreference(request);
  }
  if (url.pathname === legacyMainAppTranslationsApiPath) {
    return handleTranslationAssetRequest(request, env, "main-app");
  }
  if (url.pathname === legacySiteTranslationsApiPath) {
    return handleTranslationAssetRequest(request, env, "site");
  }
  return null;
}

async function handleLanguagePreference(request: Request) {
  if (request.method !== "POST") return methodNotAllowed("POST");

  const payload = await readBoundedLanguagePreferencePayload(request);
  if (payload === "too-large") {
    return jsonResponse({ error: "Request body too large" }, 413);
  }

  const language = normalizeLanguage(payload.language);
  const pathname = safeLegacyPathname(payload.pathname);
  const withoutLocale = safeInternalHref(removeLocaleFromPath(pathname)) ?? "/";
  const isKnownSitePath = getPotentialSiteTranslationNamespacesForPath(withoutLocale).length > 0;
  const canLocalizePath =
    !isKnownSitePath || isStaticSiteLanguageAvailableForPath(withoutLocale, language);
  const localized =
    language === defaultLanguage || !canLocalizePath
      ? withoutLocale
      : localizeHref(withoutLocale, language);
  const redirectTo = safeInternalHref(localized) ?? "/";
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const headers = responseHeaders();
  headers.append(
    "set-cookie",
    `${localeCookieName}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`,
  );
  headers.append(
    "set-cookie",
    `${localePromptCookieName}=1; Path=/; Max-Age=31536000; SameSite=Lax${secure}`,
  );
  return new Response(JSON.stringify({ language, redirectTo }), { status: 200, headers });
}

async function handleTranslationAssetRequest(
  request: Request,
  env: LegacyI18nApiEnv,
  kind: "main-app" | "site",
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }

  const url = new URL(request.url);
  const languageValue = url.searchParams.get("language");
  if (!isSupportedLegacyTranslationLanguage(languageValue)) {
    return jsonResponse({ error: "Unsupported language" }, 400, request.method === "HEAD");
  }

  let namespace: string | undefined;
  if (kind === "site") {
    const namespaceValue = url.searchParams.get("namespace");
    if (!isKnownLegacySiteTranslationNamespace(namespaceValue)) {
      return jsonResponse({ error: "Unsupported namespace" }, 400, request.method === "HEAD");
    }
    namespace = namespaceValue;
    if (!isPublishedLegacySiteTranslationPair(languageValue, namespace)) {
      return jsonResponse(
        { error: "Translation bundle is not published" },
        404,
        request.method === "HEAD",
      );
    }
  }

  const assets = env.ASSETS;
  if (!assets) {
    return jsonResponse(
      { error: "Translation bundle is temporarily unavailable" },
      503,
      request.method === "HEAD",
    );
  }

  const assetPath = legacyTranslationAssetPath({
    kind,
    language: languageValue,
    namespace,
  });
  const assetUrl = new URL(`/${assetPath}`, request.url);
  assetUrl.search = "";
  const assetResponse = await assets.fetch(
    new Request(assetUrl, { method: request.method === "HEAD" ? "HEAD" : "GET" }),
  );
  if (assetResponse.status === 200) {
    return translationAssetResponse(request, assetResponse);
  }
  await assetResponse.body?.cancel();

  console.error(
    JSON.stringify({
      event: "legacy_translation_asset_missing",
      kind,
      language: languageValue,
      namespace,
    }),
  );
  return jsonResponse(
    { error: "Translation bundle is temporarily unavailable" },
    503,
    request.method === "HEAD",
  );
}

function translationAssetResponse(
  request: Request,
  assetResponse: Response,
) {
  const headers = new Headers({
    "cache-control": completeCacheControl,
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-inspir-delivery": nativeWorkerDelivery,
  });
  return new Response(request.method === "HEAD" ? null : assetResponse.body, {
    status: 200,
    headers,
  });
}

async function readBoundedLanguagePreferencePayload(
  request: Request,
): Promise<LanguagePreferencePayload | "too-large"> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxLanguagePreferenceBodyBytes) {
      return "too-large";
    }
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    byteLength += result.value.byteLength;
    if (byteLength > maxLanguagePreferenceBodyBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeLegacyPathname(value: unknown) {
  if (typeof value !== "string" || value.length > maxLanguagePreferencePathLength) return "/";
  return safeInternalHref(value) ?? "/";
}

function safeInternalHref(value: string) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}

function methodNotAllowed(allow: string) {
  return jsonResponse({ error: "Method not allowed" }, 405, false, { allow });
}

function jsonResponse(
  body: Readonly<Record<string, unknown>>,
  status: number,
  head = false,
  extraHeaders?: Readonly<Record<string, string>>,
) {
  return new Response(head ? null : JSON.stringify(body), {
    status,
    headers: responseHeaders(extraHeaders),
  });
}

function responseHeaders(extraHeaders?: Readonly<Record<string, string>>) {
  return new Headers({
    "cache-control": privateCacheControl,
    "cdn-cache-control": "private, no-store",
    "cloudflare-cdn-cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "x-inspir-delivery": nativeWorkerDelivery,
    ...extraHeaders,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
