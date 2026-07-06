import {
  marketingShellTranslationNamespace,
  siteTranslationNamespace,
  staticSiteTranslationNamespaces,
} from "@/lib/i18n/site-source-constants";

export function isPotentialSiteTranslationNamespace(namespace: string) {
  return (
    namespace === siteTranslationNamespace ||
    staticSiteTranslationNamespaces.includes(namespace as (typeof staticSiteTranslationNamespaces)[number]) ||
    /^blog:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespace)
  );
}

export function getPotentialSiteTranslationNamespacesForPath(pathname: string) {
  const path = normalizeSiteTranslationPath(pathname);
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

  return Array.from(namespaces).filter((namespace) => isPotentialSiteTranslationNamespace(namespace));
}

function normalizeSiteTranslationPath(pathname: string) {
  const withoutQuery = pathname.split(/[?#]/)[0] || "/";
  const path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
