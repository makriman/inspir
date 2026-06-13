import type { Metadata } from "next";
import { defaultLanguage, languageConfigs, normalizeLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { alternatesForAvailableLanguages, isSiteLanguageAvailableForPath } from "@/lib/i18n/availability";
import { getRequestLanguage } from "@/lib/i18n/request-locale";
import { localizeHref } from "@/lib/i18n/routing";
import {
  getCachedSiteTranslationBundle,
  getSiteTranslationNamespaces,
} from "@/lib/i18n/site-translations";
import { createTranslationLookup, normalizeTranslationText } from "@/lib/i18n/translation-lookup";
import { absoluteUrl, siteName, siteUrl, socialImage } from "@/lib/seo/config";

export type LocalizedMetadataInput = {
  path: string;
  title: string;
  description: string;
  openGraphTitle?: string;
  openGraphDescription?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  imageTitle?: string;
  imageEyebrow?: string;
  imageDescription?: string;
  type?: "website" | "article";
  robots?: Metadata["robots"];
};

const structuredDataUrlKeys = new Set([
  "@context",
  "@id",
  "availability",
  "contentUrl",
  "duration",
  "encodingFormat",
  "item",
  "logo",
  "sameAs",
  "target",
  "thumbnailUrl",
  "uploadDate",
  "url",
]);
const localizableStructuredDataUrlKeys = new Set([
  "@id",
  "item",
  "mainEntityOfPage",
  "target",
  "url",
]);
const structuredDataCodeKeys = new Set([
  "@type",
  "applicationCategory",
  "operatingSystem",
  "price",
  "priceCurrency",
  "query-input",
]);

export async function localizeMarketingMetadata(metadata: Metadata, path: string): Promise<Metadata> {
  const language = await getRequestLanguage();
  const languageAvailable = await isSiteLanguageAvailableForPath(path, language);
  const t =
    language === defaultLanguage || !languageAvailable
      ? (value: string) => value
      : await getSiteMetadataTranslator(language, path);
  const availableLanguages = metadataAvailableLanguages(language, languageAvailable);

  return {
    ...metadata,
    title: localizeTitle(metadata.title, t),
    description: typeof metadata.description === "string" ? t(metadata.description) : metadata.description,
    alternates: localizedAlternates(path, availableLanguages),
    robots:
      language === defaultLanguage || languageAvailable
        ? metadata.robots
        : { index: false, follow: true },
    openGraph: metadata.openGraph
        ? {
          ...metadata.openGraph,
          title: localizeOptionalTitle(metadata.openGraph.title, t),
          description:
            typeof metadata.openGraph.description === "string"
              ? t(metadata.openGraph.description)
              : metadata.openGraph.description,
          url: localizeHref(path, languageAvailable ? language : defaultLanguage),
          siteName,
        }
      : metadata.openGraph,
    twitter: metadata.twitter
      ? {
          ...metadata.twitter,
          title: localizeOptionalTitle(metadata.twitter.title, t),
          description:
            typeof metadata.twitter.description === "string"
              ? t(metadata.twitter.description)
              : metadata.twitter.description,
        }
      : metadata.twitter,
  };
}

export async function localizeMarketingStructuredData(items: ReadonlyArray<unknown>, path?: string) {
  const pathname = path ?? "/";
  const language = await getRequestLanguage();
  if (language === defaultLanguage) return items;
  const languageAvailable = await isSiteLanguageAvailableForPath(pathname, language);
  if (!languageAvailable) return items;
  const t = await getSiteMetadataTranslator(language, pathname);
  return items.map((item) => localizeStructuredDataValue(item, t, undefined, language));
}

export function localizeStructuredDataValue(
  value: unknown,
  t: (value: string) => string,
  key?: string,
  language: string = defaultLanguage,
): unknown {
  if (typeof value === "string") {
    if (key === "inLanguage") return languageConfigs[normalizeLanguage(language)].locale;
    const localizedUrl = key ? localizeStructuredDataUrl(key, value, language) : null;
    if (localizedUrl) return localizedUrl;
    if (key && shouldPreserveStructuredDataString(key, value)) return value;
    return t(value);
  }
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date || value instanceof URL) return value;
  if (Array.isArray(value)) {
    return value.map((item) => localizeStructuredDataValue(item, t, key, language));
  }

  const localized: Record<string, unknown> = {};
  for (const [objectKey, objectValue] of Object.entries(value)) {
    localized[objectKey] = localizeStructuredDataValue(objectValue, t, objectKey, language);
  }
  return localized;
}

export async function localizedMarketingMetadata(input: LocalizedMetadataInput): Promise<Metadata> {
  const language = await getRequestLanguage();
  const languageAvailable = await isSiteLanguageAvailableForPath(input.path, language);
  const t =
    language === defaultLanguage || !languageAvailable
      ? (value: string) => value
      : await getSiteMetadataTranslator(language, input.path);
  const availableLanguages = metadataAvailableLanguages(language, languageAvailable);

  const title = t(input.title);
  const description = t(input.description);
  const openGraphTitle = t(input.openGraphTitle ?? input.title);
  const openGraphDescription = t(input.openGraphDescription ?? input.description);
  const twitterTitle = t(input.twitterTitle ?? input.openGraphTitle ?? input.title);
  const twitterDescription = t(input.twitterDescription ?? input.openGraphDescription ?? input.description);
  const image = socialImage({
    title: t(input.imageTitle ?? input.openGraphTitle ?? input.title),
    eyebrow: input.imageEyebrow ? t(input.imageEyebrow) : undefined,
    description: input.imageDescription ? t(input.imageDescription) : description,
  });

  return {
    title,
    description,
    alternates: localizedAlternates(input.path, availableLanguages),
    robots:
      language === defaultLanguage || languageAvailable
        ? input.robots
        : { index: false, follow: true },
    openGraph: {
      title: openGraphTitle,
      description: openGraphDescription,
      url: localizeHref(input.path, languageAvailable ? language : defaultLanguage),
      siteName,
      images: [image],
      type: input.type ?? "website",
    },
    twitter: {
      card: "summary_large_image",
      title: twitterTitle,
      description: twitterDescription,
      images: [image.url],
    },
  };
}

function localizedAlternates(path: string, languages: SupportedLanguage[]): NonNullable<Metadata["alternates"]> {
  return {
    canonical: path,
    languages: {
      ...alternatesForAvailableLanguages(path, languages),
      "x-default": absoluteUrl(path),
    },
    types: {
      "application/rss+xml": "/rss.xml",
      "text/plain": "/llms.txt",
      "application/json": "/ai-content-index.json",
    },
  };
}

function metadataAvailableLanguages(language: SupportedLanguage, languageAvailable: boolean): SupportedLanguage[] {
  if (language === defaultLanguage || !languageAvailable) return [defaultLanguage];
  return [defaultLanguage, language];
}

function localizeTitle(title: Metadata["title"], t: (value: string) => string): Metadata["title"] {
  if (typeof title === "string") return t(title);
  if (!title || typeof title !== "object") return title;
  const titleParts = title as {
    default?: unknown;
    template?: unknown;
    absolute?: unknown;
  };
  const localized = { ...(title as Record<string, unknown>) };
  if (typeof titleParts.default === "string") localized.default = t(titleParts.default);
  if (typeof titleParts.template === "string") localized.template = t(titleParts.template);
  if (typeof titleParts.absolute === "string") localized.absolute = t(titleParts.absolute);
  return localized as Metadata["title"];
}

function localizeOptionalTitle(title: Metadata["title"], t: (value: string) => string): NonNullable<Metadata["title"]> | undefined {
  const localized = localizeTitle(title, t);
  return localized ?? undefined;
}

function shouldPreserveStructuredDataString(key: string, value: string) {
  if (structuredDataUrlKeys.has(key) || structuredDataCodeKeys.has(key)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^\/[^ ]*$/.test(value)) return true;
  if (/^#/.test(value)) return true;
  if (/^PT\d+[A-Z]$/i.test(value)) return true;
  if (/^\d+(?:\.\d+)?$/.test(value)) return true;
  return false;
}

function localizeStructuredDataUrl(key: string, value: string, language: string) {
  if (!localizableStructuredDataUrlKeys.has(key)) return null;
  if (key === "@id" && isGlobalStructuredDataId(value)) return null;
  return localizeInternalUrl(value, normalizeLanguage(language));
}

function localizeInternalUrl(value: string, language: SupportedLanguage) {
  if (language === defaultLanguage) return null;
  if (/^(?:mailto:|tel:)/i.test(value)) return null;
  if (isAssetLikeUrl(value)) return null;

  if (value.startsWith("/")) {
    return localizeHref(value, language);
  }

  if (!/^https?:\/\//i.test(value)) return null;

  try {
    const url = new URL(value);
    const site = new URL(siteUrl);
    if (url.origin !== site.origin) return null;
    if (isAssetLikeUrl(url.pathname)) return null;
    return absoluteUrl(localizeHref(`${url.pathname}${url.search}${url.hash}`, language));
  } catch {
    return null;
  }
}

function isAssetLikeUrl(value: string) {
  const pathname = value.split(/[?#]/)[0] ?? value;
  return /\.(?:avif|css|gif|ico|jpg|jpeg|js|json|m4v|mov|mp3|mp4|png|svg|webm|webmanifest|webp|xml|xsl)$/i.test(
    pathname,
  );
}

function isGlobalStructuredDataId(value: string) {
  return /^https:\/\/inspirlearning\.com\/#(?:app|organization|site-navigation|website)$/i.test(value);
}

async function getSiteMetadataTranslator(language: string, pathname: string) {
  const namespaces = getSiteTranslationNamespaces(pathname);
  const bundles = await Promise.all(
    namespaces.map((namespace) => getCachedSiteTranslationBundle(language, namespace)),
  );
  const entries: Array<[string, string]> = [];

  for (const bundle of bundles) {
    if (!bundle) continue;
    for (const [key, source] of Object.entries(bundle.sourceStrings)) {
      const translated = bundle.strings[key];
      if (translated) entries.push([source, translated]);
    }
  }

  const lookup = createTranslationLookup(entries);
  return (value: string) => {
    const translated = lookup.translate(value);
    if (translated !== normalizeTranslationText(value)) return translated;

    const socialSuffix = ` | ${siteName}`;
    if (value.endsWith(socialSuffix)) {
      const base = value.slice(0, -socialSuffix.length);
      const translatedBase = lookup.translate(base);
      if (translatedBase !== normalizeTranslationText(base)) return `${translatedBase}${socialSuffix}`;
    }
    return value;
  };
}
