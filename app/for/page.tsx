import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, SearchCheck, Sparkles, UsersRound } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  audienceHubFaqs,
  audienceHubSearchIntents,
  audiencePath,
  getAudiencePages,
} from "@/lib/content/audiences";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "Find the right inspir AI learning workflow for students, parents, teachers, and self-taught learners.";

export const metadata: Metadata = {
  title: "AI Learning for Students, Parents, and Teachers",
  description,
  alternates: metadataAlternates("/for"),
  openGraph: {
    title: "AI Learning for Students, Parents, and Teachers | inspir",
    description,
    url: "/for",
    siteName,
    images: [
      socialImage({
        title: "AI Learning by Audience",
        eyebrow: "For learners",
        description,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning for Students, Parents, and Teachers | inspir",
    description,
    images: [
      socialImage({
        title: "AI Learning by Audience",
        eyebrow: "For learners",
      }).url,
    ],
  },
};

export default function AudienceHubPage() {
  const pages = getAudiencePages();
  const jsonLd = [
    webPageJsonLd({
      path: "/for",
      name: "AI Learning for Students, Parents, and Teachers | inspir",
      description,
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "For learners", url: "/for" },
    ]),
    itemListJsonLd({
      path: "/for",
      id: "audience-pages",
      name: "AI learning audience pages",
      items: pages.map((page) => ({
        name: page.seoTitle,
        url: audiencePath(page.slug),
        description: page.description,
      })),
    }),
    itemListJsonLd({
      path: "/for",
      id: "audience-search-intents",
      name: "AI learning audience search intents",
      items: audienceHubSearchIntents.map((intent) => ({
        name: intent,
        url: "/for",
      })),
    }),
    faqPageJsonLd({ path: "/for", questions: audienceHubFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="For learners" title="AI learning should fit the person using it.">
        Students, parents, teachers, and self-taught learners search for different things.
        These pages route each audience to the right public mode, guide, and study workflow.
      </MarketingPageHero>

      <section className="marketing-band is-topic-finder">
        <div className="marketing-section-copy">
          <span>{pages.length} audience paths</span>
          <h2>Choose who is learning, then choose the right behavior.</h2>
          <p>
            The same AI tutor can be a homework hint, a parent-supervised explain-back loop,
            a teacher evaluation surface, or a self-study coach. The page should make that clear.
          </p>
        </div>
        <div className="marketing-mode-finder-grid">
          {pages.map((page) => (
            <Link key={page.slug} href={audiencePath(page.slug)} className="marketing-mode-finder-card">
              <span>{page.eyebrow}</span>
              <strong>{page.seoTitle}</strong>
              <p>{page.description}</p>
              <small>
                Open audience path
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Search intent</span>
          <h2>The audience searches this hub is built to answer.</h2>
          <p>
            Audience pages let search engines and AI answer engines distinguish students,
            parents, teachers, and independent learners instead of flattening everyone into one generic page.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {audienceHubSearchIntents.map((intent) => (
            <Link key={intent} href="/for">
              <SearchCheck size={15} />
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>How it works</span>
          <h2>Each audience path connects to public, crawlable learning surfaces.</h2>
          <p>
            The pages do not expose private conversations. They organize public modes, prompts,
            guides, workflows, and safety boundaries so a learner can start in the right place.
          </p>
        </div>
        <div className="learning-path-step-grid">
          <article className="learning-path-step">
            <span>
              <UsersRound size={16} />
              Audience
            </span>
            <h3>Name the learning situation.</h3>
            <p>Student homework, parent support, teacher evaluation, and self-study all need different framing.</p>
          </article>
          <article className="learning-path-step">
            <span>
              <Sparkles size={16} />
              Mode
            </span>
            <h3>Open a focused public mode.</h3>
            <p>Use a mode tuned for hints, questions, quizzes, flashcards, writing feedback, or planning.</p>
          </article>
          <article className="learning-path-step">
            <span>
              <SearchCheck size={16} />
              Review
            </span>
            <h3>End with evidence of learning.</h3>
            <p>Finish with explain-back, a quiz, a flashcard, a project step, or a study routine.</p>
          </article>
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Audience FAQ</span>
          <h2>Different people need different AI learning routes.</h2>
        </div>
        <div className="marketing-faq-list">
          {audienceHubFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Want the broadest place to start?</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/ai-learning-map">Open the learning map</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
