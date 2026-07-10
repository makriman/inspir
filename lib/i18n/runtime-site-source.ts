import { defaultLanguage } from "@/lib/content/languages";
import { getAppTranslationSource } from "@/lib/db/queries";
import { knownSiteTranslationNamespaces } from "@/lib/i18n/site-namespace-manifest";
import {
  siteTranslationNamespace,
} from "@/lib/i18n/site-source-constants";
import { getPotentialSiteTranslationNamespacesForPath } from "@/lib/i18n/site-path-namespaces";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

type StaticSiteTranslationSource = {
  sourceHash: string;
  sourceStrings: Record<string, string>;
};

const knownRuntimeNamespaceSet = new Set<string>(knownSiteTranslationNamespaces);
let buildTimeSourceManifestPromise: Promise<Record<string, StaticSiteTranslationSource> | null> | undefined;

export function isKnownRuntimeSiteTranslationNamespace(namespace: string) {
  return knownRuntimeNamespaceSet.has(namespace);
}

export function getRuntimeSiteTranslationNamespacesForPath(pathname: string) {
  return getPotentialSiteTranslationNamespacesForPath(pathname);
}

export async function getRuntimeSiteTranslationSource(namespace = siteTranslationNamespace) {
  if (!isKnownRuntimeSiteTranslationNamespace(namespace)) return null;

  const buildTimeSource = await getBuildTimeSiteTranslationSource(namespace);
  if (buildTimeSource) {
    return {
      namespace,
      sourceHash: buildTimeSource.sourceHash,
      sourceStrings: buildTimeSource.sourceStrings,
      systemInstruction: buildRuntimeSiteTranslationSystemInstruction(),
    } satisfies TranslationSource;
  }

  try {
    return await readRuntimeSiteTranslationSource(namespace);
  } catch (error) {
    console.warn("site_translation_source_unavailable", {
      namespace,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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

async function getBuildTimeSiteTranslationSource(namespace: string) {
  if (!shouldReadBuildTimeTranslationFiles()) return null;
  const manifest = await readBuildTimeSourceManifest();
  return manifest?.[namespace] ?? null;
}

function shouldReadBuildTimeTranslationFiles() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function readBuildTimeSourceManifest() {
  buildTimeSourceManifestPromise ??= readBuildTimeSourceManifestFile().catch((error) => {
    console.warn("site_translation_source_manifest_unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  return buildTimeSourceManifestPromise;
}

async function readBuildTimeSourceManifestFile() {
  const [{ readFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const filePath = path.join(process.cwd(), "lib/i18n/site-source-manifest.ts");
  const source = await readFile(filePath, "utf8");
  const marker = "export const siteSourceManifest = ";
  const start = source.indexOf(marker);
  const end = source.lastIndexOf(" as const;");
  if (start < 0 || end <= start) return null;

  const parsed: unknown = JSON.parse(source.slice(start + marker.length, end));
  if (!isBuildTimeSourceManifest(parsed)) return null;
  return parsed;
}

function isBuildTimeSourceManifest(value: unknown): value is Record<string, StaticSiteTranslationSource> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  for (const entry of Object.values(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const source = entry as Partial<StaticSiteTranslationSource>;
    if (typeof source.sourceHash !== "string") return false;
    if (!isStringRecord(source.sourceStrings)) return false;
  }

  return true;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
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
