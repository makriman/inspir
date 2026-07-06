import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { MarketingVideoEngine } from "@/components/marketing/MarketingVideoEngine";
import { MarketingDomLocalizer } from "@/components/i18n/MarketingDomLocalizer";
import { MarketingLanguageControls } from "@/components/marketing/LanguageControls";
import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import type { TranslationBundle } from "@/lib/i18n/translation-types";
import { localizeHref } from "@/lib/i18n/routing";
import {
  getRequestLanguage,
  getRequestPathname,
  getRequestRecommendedLanguage,
  requestHasLocalePrefix,
} from "@/lib/i18n/request-locale";
import {
  getCachedSiteTranslationBundle,
  getCachedSiteTranslationEntries,
  getSiteTranslationNamespaces,
} from "@/lib/i18n/site-translations";
import { createTranslationLookup, normalizeTranslationText } from "@/lib/i18n/translation-lookup";

const navLinks = [
  { href: "/chat/learn-anything", label: "Start" },
  { href: "/subjects", label: "Subjects" },
  { href: "/topics", label: "Modes" },
  { href: "/learn", label: "Paths" },
  { href: "/blog", label: "Blog" },
  { href: "/mission", label: "Mission" },
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
        <MarketingLanguageControls
          currentLanguage={chrome.language}
          recommendedLanguage={chrome.recommendedLanguage}
          currentPathname={chrome.currentPathname}
          hasLocalePrefix={chrome.hasLocalePrefix}
          copy={{
            buttonLabel: chrome.t("Language"),
            chooseTitle: chrome.t("Choose your language"),
            chooseDescription: chrome.t("Use inspir in the language that feels most natural."),
            promptAriaLabel: chrome.t("Language options"),
            promptTitle: chrome.t("Translate inspir?"),
            promptDescription: chrome.t("Choose the language for this visit."),
            continueEnglish: chrome.t("Continue with English"),
            chooseButtonLabel: chrome.t("Choose"),
            chooseAnotherTitle: chrome.t("Choose another language"),
            chooseAnotherDescription: chrome.t("Search the full language list."),
            dismissLabel: chrome.t("Dismiss language options"),
          }}
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
        <a href="https://github.com/makriman/inspir" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
      <SocialLinks compact className="marketing-footer-social" />
    </footer>
  );
}

export async function MarketingPageHero({
  eyebrow,
  title,
  children,
  showFilm = false,
  filmMuted = true,
  filmOnly = false,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  showFilm?: boolean;
  filmMuted?: boolean;
  filmOnly?: boolean;
}) {
  const chrome = await getMarketingChrome();
  const filmHasAudio = showFilm && !filmMuted;
  return (
    <section className="marketing-page-hero">
      <div className="marketing-page-hero-copy">
        <span>{chrome.t(eyebrow)}</span>
        <h1>{chrome.t(title)}</h1>
        <p>{translateInlineNode(children, chrome.t)}</p>
      </div>
      <div
        className={`marketing-page-visual ${showFilm ? "has-film" : "has-photos"} ${filmOnly ? "is-film-only" : ""}`}
        aria-hidden={filmHasAudio ? undefined : true}
      >
        {showFilm ? (
          <figure className="is-film">
            <video
              aria-label={chrome.t("inspir learning film preview")}
              src="/media/inspir-learning-film.mp4"
              poster="/inspir-social-preview.png"
              muted={filmMuted}
              controls={filmHasAudio}
              autoPlay
              loop
              playsInline
              preload="auto"
            >
              <track kind="captions" src="/media/inspir-learning-film.en.vtt" srcLang="en" label="English captions" />
              <track kind="chapters" src="/media/inspir-learning-film.chapters.vtt" srcLang="en" label="Film chapters" />
            </video>
          </figure>
        ) : (
          <figure className="is-photo is-1" />
        )}
        {filmOnly ? null : <figure className="is-photo is-2" />}
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
  src,
  poster,
  captionsSrc,
  chapterTrackSrc,
  autoPlay = false,
  loop = false,
}: {
  chapters?: ReadonlyArray<MarketingHeroVideoChapter>;
  transcript?: string;
  src?: string;
  poster?: string;
  captionsSrc?: string;
  chapterTrackSrc?: string;
  autoPlay?: boolean;
  loop?: boolean;
}) {
  return (
    <LocalizedMarketingHeroVideo
      chapters={chapters}
      transcript={transcript}
      src={src}
      poster={poster}
      captionsSrc={captionsSrc}
      chapterTrackSrc={chapterTrackSrc}
      autoPlay={autoPlay}
      loop={loop}
    />
  );
}

async function LocalizedMarketingHeroVideo({
  chapters,
  transcript,
  src,
  poster,
  captionsSrc,
  chapterTrackSrc,
  autoPlay,
  loop,
}: {
  chapters?: ReadonlyArray<MarketingHeroVideoChapter>;
  transcript?: string;
  src?: string;
  poster?: string;
  captionsSrc?: string;
  chapterTrackSrc?: string;
  autoPlay?: boolean;
  loop?: boolean;
}) {
  const chrome = await getMarketingChrome();
  const localizedChapters = chapters?.map((chapter) => ({
    ...chapter,
    title: chrome.t(chapter.title),
    text: chrome.t(chapter.text),
  }));

  return (
    <MarketingVideoEngine
      chapters={localizedChapters}
      transcript={transcript ? chrome.t(transcript) : undefined}
      src={src}
      poster={poster}
      captionsSrc={captionsSrc}
      chapterTrackSrc={chapterTrackSrc}
      autoPlay={autoPlay}
      loop={loop}
      copy={{
        ariaLabel: chrome.t("inspir learning film"),
        playLabel: chrome.t("Play inspir learning preview"),
        kicker: chrome.t("Watch 31s"),
        captionTitle: chrome.t("inspir in motion"),
        captionText: chrome.t("Curiosity, practice, and AI that teaches."),
        chaptersLabel: chrome.t("Film chapters"),
        transcriptLabel: chrome.t("Transcript"),
        nextStepLabel: chrome.t("Next step"),
        nextStepTitle: chrome.t("Start a live learning session."),
        nextStepText: chrome.t("Ask your first question and move straight into practice."),
        startLearningLabel: chrome.t("Start learning"),
        replayLabel: chrome.t("Replay"),
        pauseLabel: chrome.t("Pause film"),
        playFilmLabel: chrome.t("Play film"),
        restartLabel: chrome.t("Restart film"),
        hideChaptersLabel: chrome.t("Hide film chapters"),
        showChaptersLabel: chrome.t("Show film chapters"),
        hideTranscriptLabel: chrome.t("Hide film transcript"),
        showTranscriptLabel: chrome.t("Show film transcript"),
        controlsLabel: chrome.t("Video controls"),
        progressLabel: chrome.t("Video progress"),
        unmuteLabel: chrome.t("Unmute film"),
        muteLabel: chrome.t("Mute film"),
        fullscreenLabel: chrome.t("Open film fullscreen"),
      }}
    />
  );
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

  return (
    <Link className="marketing-arrow-link" href={localizeHref(href, await getRequestLanguage())}>
      {children}
      <ArrowUpRight size={17} />
    </Link>
  );
}

async function getMarketingChrome() {
  const [language, recommendedLanguage, currentPathname, hasLocalePrefix] = await Promise.all([
    getRequestLanguage(),
    getRequestRecommendedLanguage(),
    getRequestPathname(),
    requestHasLocalePrefix(),
  ]);
  const translationNamespaces = getSiteTranslationNamespaces(currentPathname);
  const bundles =
    language === defaultLanguage
      ? []
      : await Promise.all(translationNamespaces.map((namespace) => getCachedSiteTranslationBundle(language, namespace)));
  const translationEntries =
    language === defaultLanguage ? [] : await getCachedSiteTranslationEntries(language, translationNamespaces);
  const textMap = buildTextMap(bundles.filter((bundle) => bundle !== null));
  const lookup = createTranslationLookup(translationEntries);

  return {
    language,
    recommendedLanguage,
    currentPathname,
    hasLocalePrefix,
    translationNamespaces,
    translationEntries,
    t: (value: string) => translateMarketingText(value, lookup.translate, textMap),
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
      if (translated) map.set(normalizeTranslationText(source), translated);
    }
  }
  return map;
}

function translateMarketingText(
  value: string,
  translate: (value: string) => string,
  textMap: Map<string, string>,
) {
  const normalized = normalizeTranslationText(value);
  if (!normalized) return value;
  const translated = textMap.get(normalized) ?? translate(normalized);
  if (!translated || translated === normalized) return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

function translateInlineNode(node: ReactNode, t: (value: string) => string): ReactNode {
  if (typeof node === "string") return t(node);
  if (Array.isArray(node)) return node.map((child) => translateInlineNode(child, t));
  return node;
}
