import { getLocalizedPathInfo } from "@/lib/i18n/routing";

export function isChatAppPath(pathname: string) {
  const effectivePathname = getLocalizedPathInfo(pathname).pathnameWithoutLocale;
  return effectivePathname === "/chat" || effectivePathname.startsWith("/chat/");
}
