import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Code2 } from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";

export const missionImages = [
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191905644x747393734386347000/inspire-logo-presentation_compressed_page-0008.jpg",
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191915410x254612906062515970/inspire-logo-presentation_compressed_page-0007.jpg",
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191628192x310335032442042600/inspire-logo-presentation_compressed_page-0009.jpg",
] as const;

const navLinks = [
  { href: "/chat/learn-anything", label: "Start" },
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
        {missionImages.map((src, index) => (
          <img key={src} src={src} alt="" className={`is-${index + 1}`} loading={index === 0 ? "eager" : "lazy"} />
        ))}
      </div>
    </section>
  );
}

export function MarketingHeroVideo() {
  return (
    <div className="marketing-hero-video" aria-hidden="true">
      <iframe
        src="https://www.youtube-nocookie.com/embed/HOSC6eGLj20?autoplay=1&mute=1&controls=0&loop=1&playlist=HOSC6eGLj20&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&fs=0"
        title="inspir learning video"
        tabIndex={-1}
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
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
