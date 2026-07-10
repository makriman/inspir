import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, ClipboardList, SearchCheck, Sparkles } from "lucide-react";
import {
  MarketingFooterWithChrome,
  MarketingHeaderWithChrome,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  getPromptCategoryHubs,
  getPromptEntries,
  getPromptSpotlightEntries,
  promptLibraryFaqs,
  promptLibrarySearchIntents,
} from "@/lib/content/prompt-library";
import type { SupportedLanguage } from "@/lib/content/languages";
import { getStaticMarketingChrome } from "@/lib/i18n/marketing-chrome";
import { localizeMarketingMetadataForLanguage } from "@/lib/i18n/metadata";
import { localizeStaticSiteHref } from "@/lib/i18n/static-availability";
import { siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "A public AI learning prompt library with starter prompts for tutoring, homework help, Socratic questions, quizzes, flashcards, writing feedback, exam prep, and more.";

const pageMetadata: Metadata = {
  title: "AI Learning Prompt Library",
  description,
  openGraph: {
    title: "AI Learning Prompt Library | inspir",
    description,
    url: "/prompts",
    siteName,
    images: [
      socialImage({
        title: "AI Learning Prompt Library",
        eyebrow: "Prompts",
        description,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Prompt Library | inspir",
    description,
    images: [
      socialImage({
        title: "AI Learning Prompt Library",
        eyebrow: "Prompts",
        description,
      }).url,
    ],
  },
};

export function generatePromptsMetadata(language: SupportedLanguage) {
  return localizeMarketingMetadataForLanguage(pageMetadata, "/prompts", language);
}

export async function PromptsPageContent({
  language,
  pathname,
}: {
  language: SupportedLanguage;
  pathname: string;
}) {
  const chrome = await getStaticMarketingChrome(pathname, language);
  const { hrefLanguage } = chrome;
  const entries = getPromptEntries();
  const categoryHubs = getPromptCategoryHubs();
  const spotlightPrompts = getPromptSpotlightEntries();
  const jsonLd = [
    webPageJsonLd({
      path: "/prompts",
      name: "AI Learning Prompt Library | inspir",
      description,
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "AI learning prompts", url: "/prompts" },
    ]),
    itemListJsonLd({
      path: "/prompts",
      id: "prompt-categories",
      name: "AI learning prompt categories",
      items: categoryHubs.map((hub) => ({
        name: `${hub.name} AI learning prompts`,
        url: hub.href,
        description: hub.description,
      })),
    }),
    itemListJsonLd({
      path: "/prompts",
      id: "featured-prompts",
      name: "Featured AI learning prompt starters",
      items: spotlightPrompts.map((entry) => ({
        name: `${entry.topicName}: ${entry.prompt}`,
        url: entry.href,
        description: entry.description,
      })),
    }),
    itemListJsonLd({
      path: "/prompts",
      id: "all-prompts",
      name: "All inspir AI learning prompt starters",
      items: entries.map((entry) => ({
        name: `${entry.topicName}: ${entry.prompt}`,
        url: entry.href,
        description: entry.description,
      })),
    }),
    itemListJsonLd({
      path: "/prompts",
      id: "prompt-common-questions",
      name: "AI learning prompt questions",
      items: promptLibrarySearchIntents.map((intent) => ({
        name: intent,
        url: "/prompts",
      })),
    }),
    faqPageJsonLd({ path: "/prompts", questions: promptLibraryFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} path="/prompts" language={language} />
      <MarketingHeaderWithChrome chrome={chrome} />
      <MarketingPageHero
        eyebrow="Prompt library"
        title="Better AI learning starts with better prompts."
        visual="prompts"
        chrome={chrome}
      >
        Browse starter prompts for every public inspir mode, then open the matching guest chat
        to turn the prompt into a live learning loop.
      </MarketingPageHero>

      <section className="marketing-band is-topic-finder">
        <div className="marketing-section-copy">
          <span>{entries.length} starter prompts</span>
          <h2>Prompt examples that point into real learning modes.</h2>
          <p>
            These are not generic copy-paste tricks. Each starter is attached to a public mode
            with a specific teaching behavior: questioning, hints, quizzes, flashcards,
            critique, roleplay, planning, or review.
          </p>
        </div>
        <div className="marketing-mode-finder-grid">
          {spotlightPrompts.map((entry) => (
            <Link key={entry.id} href={localizeStaticSiteHref(entry.href, hrefLanguage)} className="marketing-mode-finder-card">
              <span>{entry.category}</span>
              <strong>{entry.topicName}</strong>
              <p>{entry.prompt}</p>
              <small>
                Open mode
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Prompt help</span>
          <h2>The prompt questions this library is built to answer.</h2>
          <p>
            Learners often search for prompts before they know which AI tool behavior they need.
            This page routes those searches into the right public learning mode.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {promptLibrarySearchIntents.map((intent) => (
            <Link key={intent} href={localizeStaticSiteHref("/prompts", hrefLanguage)}>
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Prompt categories</span>
          <h2>Choose the learning job before choosing the words.</h2>
          <p>
            The same topic can need a different prompt depending on whether the learner needs an
            explanation, a hint, a quiz, a debate, or a plan.
          </p>
        </div>
        <nav className="marketing-mode-category-nav" aria-label="Prompt categories">
          {categoryHubs.map((hub) => (
            <Link key={hub.slug} href={localizeStaticSiteHref(hub.href, hrefLanguage)}>
              {hub.name}
              <span>{hub.promptCount}</span>
            </Link>
          ))}
        </nav>
        <div className="marketing-mode-directory">
          {categoryHubs.map((hub) => (
            <section
              key={hub.slug}
              id={hub.slug}
              className="marketing-mode-category"
              aria-labelledby={`prompt-${hub.slug}`}
            >
              <div className="marketing-mode-category-header">
                <div>
                  <h3 id={`prompt-${hub.slug}`}>{hub.name}</h3>
                  <p>{hub.description}</p>
                </div>
                <strong>{hub.promptCount} prompts</strong>
              </div>
              <div className="marketing-mode-category-summary">
                <div>
                  <ClipboardList size={18} />
                  <span>{hub.bestFor}</span>
                </div>
                <div>
                  <SearchCheck size={18} />
                  <span>{hub.searchIntents.join(" | ")}</span>
                </div>
              </div>
              <div className="marketing-topic-grid">
                {hub.prompts.map((entry) => (
                  <Link key={entry.id} href={localizeStaticSiteHref(entry.href, hrefLanguage)} className="marketing-topic-link">
                    <span>{entry.uiMode.replaceAll("-", " ")}</span>
                    <strong>{entry.topicName}</strong>
                    <p>{entry.prompt}</p>
                    <small>
                      Open prompt mode
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Prompt FAQ</span>
          <h2>Use prompts to learn actively, not passively.</h2>
        </div>
        <div className="marketing-faq-list">
          {promptLibraryFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Ready to try one?</h2>
        <Link href={localizeStaticSiteHref("/chat/learn-anything", hrefLanguage)} className="marketing-primary-cta is-dark">
          Start learning
          <Sparkles size={18} />
        </Link>
      </section>

      <MarketingFooterWithChrome chrome={chrome} />
    </main>
  );
}
