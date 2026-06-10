import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import type { ReactNode } from "react";
import { ArrowUpRight, Code2 } from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { MarketingVideoEngine } from "@/components/marketing/MarketingVideoEngine";
import { MarketingDomLocalizer } from "@/components/i18n/MarketingDomLocalizer";
import { MarketingLanguageControls } from "@/components/marketing/LanguageControls";
import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import type { TranslationBundle } from "@/lib/i18n/translation-types";
import {
  getRequestLanguage,
  getRequestPathname,
  getRequestRecommendedLanguage,
  requestHasLocalePrefix,
} from "@/lib/i18n/request-locale";
import { localizeHref } from "@/lib/i18n/routing";
import {
  getCachedSiteTranslationBundle,
  getCachedSiteTranslationEntries,
  getSiteTranslationNamespaces,
} from "@/lib/i18n/site-translations";

const navLinks = [
  { href: "/chat/learn-anything", label: "Start" },
  { href: "/subjects", label: "Subjects" },
  { href: "/topics", label: "Modes" },
  { href: "/learn", label: "Paths" },
  { href: "/blog", label: "Blog" },
  { href: "/schools", label: "Schools" },
  { href: "/trust", label: "Trust" },
] as const;

export async function MarketingHeader({ hero = false }: { hero?: boolean }) {
  const chrome = await getMarketingChrome();
  return (
    <header className={`marketing-header ${hero ? "is-hero" : ""}`}>
      <MarketingDomLocalizer
        language={chrome.language}
        namespaces={chrome.translationNamespaces}
        initialEntries={chrome.translationEntries}
      />
      <Link href={localizeHref("/", chrome.language)} aria-label="inspir home" className="marketing-brand">
        <InspirLogo variant="white" className="marketing-brand-mark" />
      </Link>
      <nav className="marketing-nav" aria-label="Primary navigation">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={localizeHref(link.href, chrome.language)}
            className={link.href.startsWith("/chat") ? "is-primary" : ""}
          >
            {chrome.t(link.label)}
          </Link>
        ))}
        <a href="https://github.com/makriman/inspir" target="_blank" rel="noreferrer">
          <Code2 size={17} />
          GitHub
        </a>
        <MarketingLanguageControls
          currentLanguage={chrome.language}
          recommendedLanguage={chrome.recommendedLanguage}
          currentPathname={chrome.currentPathname}
          hasLocalePrefix={chrome.hasLocalePrefix}
        />
      </nav>
    </header>
  );
}

export async function MarketingFooter() {
  const chrome = await getMarketingChrome();
  return (
    <footer className="marketing-footer">
      <div>
        <InspirLogo variant="white" className="marketing-footer-logo" />
        <p>{chrome.t("Learning is for everyone.")}</p>
      </div>
      <nav className="marketing-footer-links" aria-label="Footer links">
        {[
          ["/mission", "Mission"],
          ["/topics", "Modes"],
          ["/subjects", "Subjects"],
          ["/prompts", "Prompts"],
          ["/learn", "Paths"],
          ["/for", "For"],
          ["/ai-learning-map", "Map"],
          ["/compare", "Compare"],
          ["/schools", "Schools"],
          ["/blog", "Blog"],
          ["/media", "Media"],
          ["/trust", "Trust"],
          ["/about", "About"],
          ["/terms", "Terms"],
          ["/privacy", "Privacy"],
        ].map(([href, label]) => (
          <Link key={href} href={localizeHref(href, chrome.language)}>
            {chrome.t(label)}
          </Link>
        ))}
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
            aria-label="inspir learning film preview"
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

export async function ArrowLink({
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

  const language = await getRequestLanguage();
  return (
    <Link className="marketing-arrow-link" href={localizeHref(href, language)}>
      {children}
      <ArrowUpRight size={17} />
    </Link>
  );
}

async function getMarketingChrome() {
  const language = await getRequestLanguage();
  const recommendedLanguage = await getRequestRecommendedLanguage();
  const currentPathname = await getRequestPathname();
  const hasLocalePrefix = await requestHasLocalePrefix();
  const translationNamespaces = getSiteTranslationNamespaces(currentPathname);
  const bundles =
    language === defaultLanguage
      ? []
      : await Promise.all(translationNamespaces.map((namespace) => getCachedSiteTranslationBundle(language, namespace)));
  const translationEntries =
    language === defaultLanguage ? [] : await getCachedSiteTranslationEntries(language, translationNamespaces);
  const textMap = buildTextMap(bundles.filter((bundle) => bundle !== null));

  return {
    language,
    recommendedLanguage,
    currentPathname,
    hasLocalePrefix,
    translationNamespaces,
    translationEntries,
    t: (value: string) => textMap.get(value) ?? value,
  } satisfies {
    language: SupportedLanguage;
    recommendedLanguage: SupportedLanguage;
    currentPathname: string;
    hasLocalePrefix: boolean;
    translationNamespaces: string[];
    translationEntries: Array<[string, string]>;
    t: (value: string) => string;
  };
}

function buildTextMap(bundles: TranslationBundle[]) {
  const map = new Map<string, string>();
  for (const bundle of bundles) {
    for (const [key, source] of Object.entries(bundle.sourceStrings)) {
      const translated = bundle.strings[key];
      if (translated) map.set(source, translated);
    }
  }
  return map;
}
