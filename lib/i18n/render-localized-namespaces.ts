import { marketingShellTranslationNamespace } from "@/lib/i18n/site-source-constants";

export const renderLocalizedSiteTranslationNamespaces = [
  marketingShellTranslationNamespace,
  "route:home",
  "route:mission",
] as const;

const renderLocalizedNamespaceSet = new Set<string>(renderLocalizedSiteTranslationNamespaces);

export function isRenderLocalizedSiteTranslationNamespace(namespace: string) {
  return renderLocalizedNamespaceSet.has(namespace);
}
