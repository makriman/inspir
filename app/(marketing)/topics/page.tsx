import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, Compass, SearchCheck, Sparkles } from "lucide-react";
import { MarketingFooter, MarketingHeader, MarketingPageHero } from "@/components/marketing/MarketingShell";
import {
  getTopicCategoryHubs,
  getTopicSpotlightModes,
  topicDirectoryFaqs,
} from "@/lib/content/topic-directory";
import { topicSeeds } from "@/lib/content/topics";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  learningModesItemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const pageMetadata: Metadata = {
  title: "AI Learning Modes",
  description:
    "Browse every public inspir AI learning mode: Socratic tutoring, homework coaching, math help, writing feedback, flashcards, quizzes, history roleplay, debate, and more.",
  alternates: metadataAlternates("/topics"),
  openGraph: {
    title: "AI Learning Modes | inspir",
    description:
      "Browse every public inspir AI learning mode and land directly inside the matching guest chat.",
    url: "/topics",
    siteName,
    images: [
      socialImage({
        title: "AI Learning Modes",
        eyebrow: "Mode directory",
        description:
          "Browse Socratic tutoring, homework coaching, math help, flashcards, quizzes, history roleplay, debate, and more.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Modes | inspir",
    description:
      "Browse every public inspir AI learning mode and land directly inside the matching guest chat.",
    images: [
      socialImage({
        title: "AI Learning Modes",
        eyebrow: "Mode directory",
        description:
          "Browse Socratic tutoring, homework coaching, math help, flashcards, quizzes, history roleplay, debate, and more.",
      }).url,
    ],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/topics");
}

export default function TopicsPage() {
  const categoryHubs = getTopicCategoryHubs();
  const spotlightModes = getTopicSpotlightModes();
  const jsonLd = [
    webPageJsonLd({
      path: "/topics",
      name: "AI Learning Modes",
      description:
        "A public directory of inspir's guest AI learning modes, organized by learning need, category, and live chat entrypoint.",
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Learning modes", url: "/topics" },
    ]),
    learningModesItemListJsonLd(topicSeeds),
    itemListJsonLd({
      path: "/topics",
      id: "mode-categories",
      name: "AI learning mode categories",
      items: categoryHubs.map((hub) => ({
        name: `${hub.name} AI learning modes`,
        url: hub.href,
        description: hub.description,
      })),
    }),
    itemListJsonLd({
      path: "/topics",
      id: "featured-mode-entrypoints",
      name: "Featured public AI learning mode entrypoints",
      items: spotlightModes.map((mode) => ({
        name: mode.name,
        url: mode.href,
        description: mode.reason,
      })),
    }),
    faqPageJsonLd({ path: "/topics", questions: topicDirectoryFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Learning modes" title="Start from the exact kind of help you need." visual="modes">
        Every public inspir mode has its own examples and teaching behavior, so learners can open the right kind of help
        without starting from a blank chat box.
      </MarketingPageHero>

      <section className="marketing-band is-topic-finder">
        <div className="marketing-section-copy">
          <span>Best first clicks</span>
          <h2>Common learning problems should open into useful help, not a brochure.</h2>
          <p>
            These entrypoints cover the searches learners make when they need immediate help:
            explanations, Socratic questions, homework hints, math steps, writing feedback,
            flashcards, quizzes, and historical conversations.
          </p>
        </div>
        <div className="marketing-mode-finder-grid">
          {spotlightModes.map((mode) => (
            <Link key={mode.slug} href={mode.href} className="marketing-mode-finder-card">
              <span>{mode.intent}</span>
              <strong>{mode.name}</strong>
              <p>{mode.reason}</p>
              <small>
                {mode.category}
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Mode directory</span>
          <h2>All public AI learning chats in one clear place.</h2>
          <p>
            These are live entrypoints for learning by explanation, practice, questioning,
            roleplay, planning, critique, and active recall.
          </p>
        </div>
        <nav className="marketing-mode-category-nav" aria-label="Learning mode categories">
          {categoryHubs.map((hub) => (
            <Link key={hub.slug} href={hub.href}>
              {hub.name}
              <span>{hub.modeCount}</span>
            </Link>
          ))}
        </nav>
        <div className="marketing-mode-directory">
          {categoryHubs.map((hub) => (
            <section
              key={hub.slug}
              id={hub.slug}
              className="marketing-mode-category"
              aria-labelledby={`mode-${hub.slug}`}
            >
              <div className="marketing-mode-category-header">
                <div>
                  <h3 id={`mode-${hub.slug}`}>{hub.name}</h3>
                  <p>{hub.description}</p>
                </div>
                <strong>{hub.modeCount} modes</strong>
              </div>
              <div className="marketing-mode-category-summary">
                <div>
                  <Compass size={18} />
                  <span>{hub.bestFor}</span>
                </div>
                <div>
                  <SearchCheck size={18} />
                  <span>{hub.searchIntents.join(" | ")}</span>
                </div>
              </div>
              <div className="marketing-topic-grid">
                {hub.topics.map((topic) => {
                  const seo = getTopicSeo(topic);
                  const starters = topic.metadata.starters.slice(0, 2);
                  return (
                    <Link key={topic.slug} href={`/chat/${topic.slug}`} className="marketing-topic-link">
                      <span>{topic.metadata.uiMode.replaceAll("-", " ")}</span>
                      <strong>{topic.name}</strong>
                      <p>{seo.description}</p>
                      {starters.length ? (
                        <ul>
                          {starters.map((starter) => (
                            <li key={starter}>{starter}</li>
                          ))}
                        </ul>
                      ) : null}
                      <small>
                        Open mode
                        <ArrowUpRight size={14} />
                      </small>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="marketing-band is-topic-faq">
        <div className="marketing-section-copy">
          <span>Public guest mode FAQ</span>
          <h2>Built for people who want to start learning quickly.</h2>
          <p>
            Each public mode explains what it is for, shows examples, and opens directly inside the learning experience.
          </p>
        </div>
        <div className="marketing-mode-faq-list">
          {topicDirectoryFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Not sure where to begin?</h2>
        <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
          Start with Learn Anything
          <Sparkles size={18} />
        </Link>
      </section>

      <MarketingFooter />
    </main>
  );
}
