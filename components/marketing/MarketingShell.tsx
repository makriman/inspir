import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Code2 } from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { MarketingVideoEngine } from "@/components/marketing/MarketingVideoEngine";

const navLinks = [
  { href: "/chat/learn-anything", label: "Start" },
  { href: "/subjects", label: "Subjects" },
  { href: "/topics", label: "Modes" },
  { href: "/learn", label: "Paths" },
  { href: "/blog", label: "Blog" },
  { href: "/schools", label: "Schools" },
  { href: "/trust", label: "Trust" },
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
        <Link href="/subjects">Subjects</Link>
        <Link href="/prompts">Prompts</Link>
        <Link href="/learn">Paths</Link>
        <Link href="/for">For</Link>
        <Link href="/ai-learning-map">Map</Link>
        <Link href="/compare">Compare</Link>
        <Link href="/schools">Schools</Link>
        <Link href="/blog">Blog</Link>
        <Link href="/media">Media</Link>
        <Link href="/trust">Trust</Link>
        <Link href="/about">About</Link>
        <Link href="/terms">Terms</Link>
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
        <figure className="is-film">
          <video
            src="/media/inspir-learning-film.mp4"
            poster="/inspir-social-preview.png"
            muted
            autoPlay
            loop
            playsInline
            preload="metadata"
          />
        </figure>
        <figure className="is-map">
          <div className="marketing-page-map">
            <span />
            <span />
            <span />
            <span />
            <i />
            <i />
          </div>
        </figure>
      </div>
    </section>
  );
}

type MarketingHeroVideoChapter = {
  title: string;
  start: number;
  end: number;
  text: string;
};

export function MarketingHeroVideo({
  chapters,
  transcript,
}: {
  chapters?: ReadonlyArray<MarketingHeroVideoChapter>;
  transcript?: string;
}) {
  return <MarketingVideoEngine chapters={chapters} transcript={transcript} />;
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
