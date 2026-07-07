import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { InspirLogo } from "@/components/brand/InspirLogo";
import { SocialLinks } from "@/components/brand/SocialLinks";
import { MarketingVideoEngine } from "@/components/marketing/MarketingVideoEngine";
import { MarketingLanguageControls } from "@/components/marketing/LanguageControls";
import { type SupportedLanguage } from "@/lib/content/languages";
import { localizeHref } from "@/lib/i18n/routing";
import { getRequestMarketingChrome, type MarketingChrome } from "@/lib/i18n/marketing-chrome";
import type { MarketingHeroVisual } from "@/lib/content/marketing-visuals";

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
  const chrome = await getRequestMarketingChrome();
  return <MarketingHeaderWithChrome chrome={chrome} hero={hero} />;
}

export function MarketingHeaderWithChrome({
  chrome,
  hero = false,
}: {
  chrome: MarketingChrome;
  hero?: boolean;
}) {
  return (
    <header className={`marketing-header ${hero ? "is-hero" : ""}`}>
      <Link href={localizeHref("/", chrome.hrefLanguage)} aria-label="inspir home" className="marketing-brand">
        <InspirLogo variant="white" className="marketing-brand-mark" />
      </Link>
      <nav className="marketing-nav" aria-label="Primary navigation">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={localizeHref(link.href, chrome.hrefLanguage)}
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
  const chrome = await getRequestMarketingChrome();
  return <MarketingFooterWithChrome chrome={chrome} />;
}

export function MarketingFooterWithChrome({ chrome }: { chrome: MarketingChrome }) {
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
          <Link key={href} href={localizeHref(href, chrome.hrefLanguage)}>
            {chrome.t(label)}
          </Link>
        ))}
        <a href="https://github.com/greatindiancompany/ai-study-platform" target="_blank" rel="noreferrer">
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
  visual,
  showFilm = false,
  filmMuted = true,
  filmOnly = false,
  chrome: chromeOverride,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  visual: MarketingHeroVisual;
  showFilm?: boolean;
  filmMuted?: boolean;
  filmOnly?: boolean;
  chrome?: MarketingChrome;
}) {
  const chrome = chromeOverride ?? (await getRequestMarketingChrome());
  const filmHasAudio = showFilm && !filmMuted;
  const showSupportingPhoto = showFilm && !filmOnly;
  return (
    <section className="marketing-page-hero">
      <div className="marketing-page-hero-copy">
        <span>{chrome.t(eyebrow)}</span>
        <h1>{chrome.t(title)}</h1>
        <p>{translateInlineNode(children, chrome.t)}</p>
      </div>
      <div
        className={`marketing-page-visual has-visual-${visual} ${showFilm ? "has-film" : "has-photos"} ${
          filmOnly ? "is-film-only" : ""
        }`}
        aria-hidden={filmHasAudio ? undefined : true}
      >
        {showFilm ? (
          <figure className="is-film">
            <video
              aria-label={chrome.t("inspir learning film preview")}
              src="/media/inspir-learning-film.mp4"
              poster="/media/inspir-learning-film-poster.webp"
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
          <figure className="is-photo" aria-hidden="true" />
        )}
        {showSupportingPhoto ? <figure className="is-photo" aria-hidden="true" /> : null}
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
  chrome,
}: {
  chapters?: ReadonlyArray<MarketingHeroVideoChapter>;
  transcript?: string;
  src?: string;
  poster?: string;
  captionsSrc?: string;
  chapterTrackSrc?: string;
  autoPlay?: boolean;
  loop?: boolean;
  chrome?: MarketingChrome;
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
      chrome={chrome}
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
  chrome: chromeOverride,
}: {
  chapters?: ReadonlyArray<MarketingHeroVideoChapter>;
  transcript?: string;
  src?: string;
  poster?: string;
  captionsSrc?: string;
  chapterTrackSrc?: string;
  autoPlay?: boolean;
  loop?: boolean;
  chrome?: MarketingChrome;
}) {
  const chrome = chromeOverride ?? (await getRequestMarketingChrome());
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
  hrefLanguage,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
  hrefLanguage?: SupportedLanguage;
}) {
  if (external) {
    return (
      <a className="marketing-arrow-link" href={href} target="_blank" rel="noreferrer">
        {children}
        <ArrowUpRight size={17} />
      </a>
    );
  }

  const language = hrefLanguage ?? (await getRequestMarketingChrome()).hrefLanguage;
  return (
    <Link className="marketing-arrow-link" href={localizeHref(href, language)}>
      {children}
      <ArrowUpRight size={17} />
    </Link>
  );
}

function translateInlineNode(node: ReactNode, t: (value: string) => string): ReactNode {
  if (typeof node === "string") return t(node);
  if (Array.isArray(node)) return node.map((child) => translateInlineNode(child, t));
  return node;
}
