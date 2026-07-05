import { defaultLanguage } from "@/lib/content/languages";
import { getAppTranslationSource } from "@/lib/db/queries";
import {
  marketingShellTranslationNamespace,
  siteTranslationNamespace,
  staticSiteTranslationNamespaces,
} from "@/lib/i18n/site-source-constants";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

type CachedRuntimeSource = {
  expiresAt: number;
  promise: Promise<TranslationSource | null>;
};

const runtimeSourceCacheTtlMs = 5 * 60 * 1000;
const runtimeSourceCache = new Map<string, CachedRuntimeSource>();

export {
  marketingShellTranslationNamespace,
  siteTranslationNamespace,
  staticSiteTranslationNamespaces,
};

export function getAllRuntimeSiteTranslationNamespaces() {
  return [...staticSiteTranslationNamespaces];
}

export function isKnownRuntimeSiteTranslationNamespace(namespace: string) {
  return (
    namespace === siteTranslationNamespace ||
    staticSiteTranslationNamespaces.includes(namespace as (typeof staticSiteTranslationNamespaces)[number]) ||
    /^blog:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace)
  );
}

export function getRuntimeSiteTranslationNamespacesForPath(pathname: string) {
  const path = normalizePath(pathname);
  const firstSegment = path === "/" ? "" : path.split("/").filter(Boolean)[0] ?? "";
  if (firstSegment === "chat") return [];

  const namespaces = new Set<string>([marketingShellTranslationNamespace]);

  if (path === "/") namespaces.add("route:home");
  else if (firstSegment === "privacy") namespaces.add("legal:privacy");
  else if (firstSegment === "terms") namespaces.add("legal:terms");
  else if (firstSegment === "tnc") namespaces.add("legal:tnc");
  else if (firstSegment === "blog") {
    namespaces.add("route:blog");
    const [, maybeSlug] = path.match(/^\/blog\/([^/]+)$/) ?? [];
    if (maybeSlug && maybeSlug !== "category") namespaces.add(`blog:${maybeSlug}`);
  } else {
    const routeNamespace = `route:${firstSegment || "home"}`;
    if (staticSiteTranslationNamespaces.includes(routeNamespace as (typeof staticSiteTranslationNamespaces)[number])) {
      namespaces.add(routeNamespace);
    } else {
      namespaces.add("route:home");
    }
  }

  return Array.from(namespaces).filter((namespace) => isKnownRuntimeSiteTranslationNamespace(namespace));
}

export async function getRuntimeSiteTranslationSource(namespace = siteTranslationNamespace) {
  if (!isKnownRuntimeSiteTranslationNamespace(namespace)) return null;

  const cached = runtimeSourceCache.get(namespace);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) runtimeSourceCache.delete(namespace);

  const promise = readRuntimeSiteTranslationSource(namespace).catch((error) => {
    runtimeSourceCache.delete(namespace);
    console.warn("site_translation_source_unavailable", {
      namespace,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  runtimeSourceCache.set(namespace, { expiresAt: Date.now() + runtimeSourceCacheTtlMs, promise });
  return promise;
}

export async function getRuntimeEnglishSiteTranslationBundle(namespace = siteTranslationNamespace) {
  const source = await getRuntimeSiteTranslationSource(namespace);
  if (!source) return null;
  return {
    namespace: source.namespace,
    language: defaultLanguage,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
    strings: source.sourceStrings,
  } satisfies TranslationBundle;
}

async function readRuntimeSiteTranslationSource(namespace: string): Promise<TranslationSource | null> {
  const row = await getAppTranslationSource(namespace);
  if (!row) return null;
  return {
    namespace: row.namespace,
    sourceHash: row.sourceHash,
    sourceStrings: row.sourceStrings,
    systemInstruction: buildRuntimeSiteTranslationSystemInstruction(),
  };
}

function buildRuntimeSiteTranslationSystemInstruction() {
  return [
    "You are a meticulous localization specialist for inspir, an education website and AI learning app.",
    "Translate exactly the provided visible website, article, metadata, legal, or app-adjacent text into the target language.",
    "Return only JSON with the translated value in the value field.",
    "Preserve markdown-visible meaning, placeholders, punctuation attached to placeholders, URLs, route slugs, code terms, and the product name inspir.",
    "Do not translate HTML class names, file names, package names, route paths, email addresses, URLs, or code identifiers.",
    "Legal translations must be clear and conservative; do not add legal obligations or remove limitations.",
    "Use natural educational product copy in the target language.",
  ].join("\n");
}

function normalizePath(pathname: string) {
  if (!pathname) return "/";
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] || "/";
  if (withoutQuery === "/") return withoutQuery;
  return withoutQuery.replace(/\/+$/, "") || "/";
}
