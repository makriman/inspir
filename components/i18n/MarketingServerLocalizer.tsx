import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { defaultLanguage } from "@/lib/content/languages";
import { isStaticSiteLanguageAvailableForPath } from "@/lib/i18n/static-availability";
import { getRequestLanguage, getRequestPathname } from "@/lib/i18n/request-locale";
import { localizeHref } from "@/lib/i18n/routing";
import { getCachedSiteTranslationEntries, getSiteTranslationNamespaces } from "@/lib/i18n/site-translations";
import { createTranslationLookup, normalizeTranslationText } from "@/lib/i18n/translation-lookup";

type MarketingServerLocalizerProps = {
  children: ReactNode;
};

const translatableAttributes = new Set(["aria-label", "title", "placeholder", "alt"]);
const skippedTags = new Set(["code", "pre", "script", "style", "textarea", "select"]);

export async function MarketingServerLocalizer({ children }: MarketingServerLocalizerProps) {
  const [language, pathname] = await Promise.all([getRequestLanguage(), getRequestPathname()]);
  if (language === defaultLanguage) return children;
  if (pathname === "/") return children;
  if (!isStaticSiteLanguageAvailableForPath(pathname, language)) return children;

  const namespaces = getSiteTranslationNamespaces(pathname);
  if (!namespaces.length) return children;

  const entries = await getCachedSiteTranslationEntries(language, namespaces);
  if (!entries.length) return children;

  const lookup = createTranslationLookup(entries);
  return translateNode(children, lookup.translate, language, false);
}

function translateNode(
  node: ReactNode,
  translate: (value: string) => string,
  language: string,
  insideSkippedElement: boolean,
): ReactNode {
  if (typeof node === "string") return insideSkippedElement ? node : translateText(node, translate);
  if (typeof node !== "object" || node === null) return node;
  if (Array.isArray(node)) {
    return node.map((child) => translateNode(child, translate, language, insideSkippedElement));
  }
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  const tagName = typeof element.type === "string" ? element.type.toLowerCase() : "";
  const shouldSkip =
    insideSkippedElement ||
    skippedTags.has(tagName) ||
    Boolean(element.props["data-no-auto-translate"]);

  const nextProps: Record<string, unknown> = {};
  let changed = false;

  for (const [key, value] of Object.entries(element.props)) {
    if (key === "children") continue;
    if (!shouldSkip && translatableAttributes.has(key) && typeof value === "string") {
      const translated = translateText(value, translate);
      nextProps[key] = translated;
      changed = changed || translated !== value;
      continue;
    }
    if (!shouldSkip && key === "href" && typeof value === "string" && tagName === "a") {
      const localized = localizeHref(value, language);
      nextProps[key] = localized;
      changed = changed || localized !== value;
      continue;
    }
    nextProps[key] = value;
  }

  const originalChildren = element.props.children as ReactNode;
  const translatedChildren = translateNode(originalChildren, translate, language, shouldSkip);
  if (translatedChildren !== element.props.children) {
    nextProps.children = translatedChildren;
    changed = true;
  }

  return changed ? cloneElement(element, nextProps) : node;
}

function translateText(value: string, translate: (value: string) => string) {
  const normalized = normalizeTranslationText(value);
  if (!normalized) return value;
  const translated = translate(normalized);
  if (!translated || translated === normalized) return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}
