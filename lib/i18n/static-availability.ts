import {
  defaultLanguage,
  normalizeLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { staticSiteTranslationNamespaceAvailability } from "@/lib/i18n/site-availability-manifest";
import { getPotentialSiteTranslationNamespacesForPath } from "@/lib/i18n/site-path-namespaces";
import { localizeHref, normalizePathname, removeLocaleFromPath } from "@/lib/i18n/routing";

// This map is bounded by the curated, generated language manifest. It avoids
// rebuilding namespace sets on every request without retaining request keys.
const staticNamespaceAvailability = new Map<SupportedLanguage, ReadonlySet<string>>(
  supportedLanguages.map((language) => [
    language,
    new Set<string>(staticSiteTranslationNamespaceAvailability[language] ?? []),
  ]),
);

export function isStaticSiteLanguageAvailableForPath(pathname: string, language: SupportedLanguage) {
  if (language === defaultLanguage) return true;

  const requiredNamespaces = getPotentialSiteTranslationNamespacesForPath(pathname);
  if (!requiredNamespaces.length) return false;
  const available = staticNamespaceAvailability.get(language);
  if (!available?.size) return false;

  return requiredNamespaces.every((namespace) => available.has(namespace));
}

export function staticSiteLanguagesForPath(pathname: string) {
  // `pathname` can be attacker-controlled on middleware and 404 paths. This
  // small filter is intentionally recomputed instead of retaining an unbounded
  // Worker-isolate map keyed by arbitrary request paths.
  return supportedLanguages.filter((language) => isStaticSiteLanguageAvailableForPath(pathname, language));
}

export function localizeStaticSiteHref(href: string, language: SupportedLanguage | string) {
  if (/^(?:https?:|mailto:|tel:|#)/i.test(href)) return href;

  const unlocalizedHref = removeLocaleFromPath(href);
  const pathname = normalizePathname(unlocalizedHref.split(/[?#]/, 1)[0] || "/");
  const normalizedLanguage = normalizeLanguage(language);

  if (pathname === "/chat" || pathname.startsWith("/chat/")) {
    return localizeHref(unlocalizedHref, normalizedLanguage);
  }
  if (!isStaticSiteLanguageAvailableForPath(pathname, normalizedLanguage)) {
    return unlocalizedHref;
  }
  return localizeHref(unlocalizedHref, normalizedLanguage);
}
