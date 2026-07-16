import { marketingShellTranslationNamespace } from "@/lib/i18n/site-source-constants";

export const renderLocalizedSiteTranslationNamespaces = [
  marketingShellTranslationNamespace,
  "route:home",
  "route:about",
  "route:ai-learning-map",
  "route:blog",
  "route:compare",
  "route:for",
  "route:learn",
  "route:media",
  "route:mission",
  "route:prompts",
  "route:schools",
  "route:subjects",
  "route:topics",
  "route:trust",
  "legal:privacy",
  "legal:terms",
] as const;

const renderLocalizedNamespaceSet = new Set<string>(renderLocalizedSiteTranslationNamespaces);

export function isRenderLocalizedSiteTranslationNamespace(namespace: string) {
  return renderLocalizedNamespaceSet.has(namespace);
}
