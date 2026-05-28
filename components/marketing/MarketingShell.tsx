import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { ArrowUpRight, Code2 } from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { MarketingVideoEngine } from "@/components/marketing/MarketingVideoEngine";

export const missionImages = [
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191905644x747393734386347000/inspire-logo-presentation_compressed_page-0008.jpg",
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191915410x254612906062515970/inspire-logo-presentation_compressed_page-0007.jpg",
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191628192x310335032442042600/inspire-logo-presentation_compressed_page-0009.jpg",
] as const;

const navLinks = [
  { href: "/chat/learn-anything", label: "Start" },
  { href: "/topics", label: "Modes" },
  { href: "/learn", label: "Paths" },
  { href: "/mission", label: "Mission" },
  { href: "/schools", label: "Schools" },
  { href: "/blog", label: "Blog" },
  { href: "/media", label: "Media" },
  { href: "/about", label: "About" },
] as const;

export function MarketingHeader({ hero = false }: { hero?: boolean }) {
  return (
    <header className={`marketing-header ${hero ? "is-hero" : ""}`}>
      <Link href="/" aria-label="inspir home" className="marketing-brand">
        <InspirLogo variant="white" className="marketing-brand-mark" />
      </Link>
      <nav className="marketing-nav" aria-label="Primary navigation">
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} className={link.href.startsWith("/chat") ? "is-primary" : ""}>
            {link.label}
          </Link>
        ))}
        <a href="https://github.com/makriman/inspir" target="_blank" rel="noreferrer">
          <Code2 size={17} />
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div>
        <InspirLogo variant="white" className="marketing-footer-logo" />
        <p>Learning is for everyone.</p>
      </div>
      <nav className="marketing-footer-links" aria-label="Footer links">
        <Link href="/mission">Mission</Link>
        <Link href="/topics">Modes</Link>
        <Link href="/learn">Paths</Link>
        <Link href="/schools">Schools</Link>
        <Link href="/blog">Blog</Link>
        <Link href="/media">Media</Link>
        <Link href="/about">About</Link>
        <Link href="/tnc">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
      <SocialLinks compact className="marketing-footer-social" />
    </footer>
  );
}

export function MarketingPageHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="marketing-page-hero">
      <div className="marketing-page-hero-copy">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      <div className="marketing-page-visual" aria-hidden="true">
        {[missionImages[0], missionImages[2]].map((src, index) => (
          <figure key={src} className={`is-${index + 1}`}>
            <Image
              src={src}
              alt=""
              width={900}
              height={506}
              priority={index === 0}
            />
          </figure>
        ))}
      </div>
    </section>
  );
}

export function MarketingHeroVideo() {
  return <MarketingVideoEngine />;
}

export function ArrowLink({
  href,
  children,
  external = false,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  if (external) {
    return (
      <a className="marketing-arrow-link" href={href} target="_blank" rel="noreferrer">
        {children}
        <ArrowUpRight size={17} />
      </a>
    );
  }

  return (
    <Link className="marketing-arrow-link" href={href}>
      {children}
      <ArrowUpRight size={17} />
    </Link>
  );
}
