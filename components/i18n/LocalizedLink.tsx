import Link, { type LinkProps } from "next/link";
import { cache, type AnchorHTMLAttributes, type ReactNode } from "react";
import { getRequestLanguage } from "@/lib/i18n/request-locale";
import { localizeHref } from "@/lib/i18n/routing";

type LocalizedLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children?: ReactNode;
  };

const getCachedRequestLanguage = cache(getRequestLanguage);

export async function LocalizedLink({ href, ...props }: LocalizedLinkProps) {
  const language = await getCachedRequestLanguage();
  const localizedHref = typeof href === "string" ? localizeHref(href, language) : href;
  return <Link href={localizedHref} {...props} />;
}
