import Link, { type LinkProps } from "next/link";
import { type AnchorHTMLAttributes, type ReactNode } from "react";

type LocalizedLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children?: ReactNode;
  };

export function LocalizedLink({ href, prefetch = false, ...props }: LocalizedLinkProps) {
  return <Link href={href} prefetch={prefetch} {...props} />;
}
