import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { MarketingFooter, MarketingHeader, MarketingPageHero } from "@/components/marketing/MarketingShell";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import {
  breadcrumbJsonLd,
  learningModesItemListJsonLd,
  serializeJsonLd,
} from "@/lib/seo/json-ld";

export const metadata: Metadata = {
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

function groupedTopics() {
  const groups = new Map<string, typeof topicSeeds>();
  for (const topic of topicSeeds) {
    const category = topic.metadata.category;
    groups.set(category, [...(groups.get(category) ?? []), topic]);
  }
  return Array.from(groups.entries());
}

export default function TopicsPage() {
  const jsonLd = [
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Learning modes", url: "/topics" },
    ]),
    learningModesItemListJsonLd(topicSeeds),
  ];

  return (
    <main className="marketing-site">
      {jsonLd.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }}
        />
      ))}
      <MarketingHeader />
      <MarketingPageHero eyebrow="Learning modes" title="Start from the exact kind of help you need.">
        Every public inspir mode has its own guest URL, examples, and teaching behavior, so
        learners can arrive directly from search and begin in the right flow.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Mode directory</span>
          <h2>All public AI learning chats in one clear place.</h2>
          <p>
            These are live entrypoints for learning by explanation, practice, questioning,
            roleplay, planning, critique, and active recall.
          </p>
        </div>
        <div className="marketing-mode-directory">
          {groupedTopics().map(([category, topics]) => (
            <section
              key={category}
              className="marketing-mode-category"
              aria-labelledby={`mode-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="marketing-mode-category-header">
                <span id={`mode-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{category}</span>
                <strong>{topics.length} modes</strong>
              </div>
              <div className="marketing-topic-grid">
                {topics.map((topic) => {
                  const seo = getTopicSeo(topic);
                  const starters = topic.metadata.starters.slice(0, 2);
                  return (
                    <Link key={topic.slug} href={topicPath(topic.slug)} className="marketing-topic-link">
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
