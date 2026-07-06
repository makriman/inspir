import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, BadgeCheck, CornerDownRight, SearchCheck, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  comparisonHubFaqs,
  comparisonHubSearchIntents,
  comparisonPath,
  getComparisonPages,
} from "@/lib/content/comparisons";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "Compare inspir with other learning tools and choose when to use live AI tutoring, public guest modes, prompts, guides, and study workflows.";

const pageMetadata: Metadata = {
  title: "AI Tutor Comparisons",
  description,
  alternates: metadataAlternates("/compare"),
  openGraph: {
    title: "AI Tutor Comparisons | inspir",
    description,
    url: "/compare",
    siteName,
    images: [
      socialImage({
        title: "AI Tutor Comparisons",
        eyebrow: "Compare",
        description,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Tutor Comparisons | inspir",
    description,
    images: [
      socialImage({
        title: "AI Tutor Comparisons",
        eyebrow: "Compare",
      }).url,
    ],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/compare");
}

export default function ComparePage() {
  const pages = getComparisonPages();
  const jsonLd = [
    webPageJsonLd({
      path: "/compare",
      name: "AI Tutor Comparisons | inspir",
      description,
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
    ]),
    itemListJsonLd({
      path: "/compare",
      id: "comparison-pages",
      name: "AI tutor comparison pages",
      items: pages.map((page) => ({
        name: page.seoTitle,
        url: comparisonPath(page.slug),
        description: page.description,
      })),
    }),
    itemListJsonLd({
      path: "/compare",
      id: "comparison-common-questions",
      name: "AI tutor comparison questions",
      items: comparisonHubSearchIntents.map((intent) => ({
        name: intent,
        url: "/compare",
      })),
    }),
    faqPageJsonLd({ path: "/compare", questions: comparisonHubFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Compare" title="Choose the right learning tool for the moment." visual="compare">
        Some searches need a course library. Some need a live AI tutor, a hint, a Socratic
        question, a quiz, or a flashcard deck. These pages make that choice clearer.
      </MarketingPageHero>

      <section className="marketing-band is-topic-finder">
        <div className="marketing-section-copy">
          <span>{pages.length} comparison page</span>
          <h2>Learners comparing tools deserve a clear answer, not a vague landing page.</h2>
          <p>
            Each comparison is written to be fair, useful, and action-oriented: what the known
            tool is good for, where inspir is different, and which public mode to open first.
          </p>
        </div>
        <div className="marketing-mode-finder-grid">
          {pages.map((page) => (
            <Link key={page.slug} href={comparisonPath(page.slug)} className="marketing-mode-finder-card">
              <span>{page.eyebrow}</span>
              <strong>{page.seoTitle}</strong>
              <p>{page.description}</p>
              <small>
                Read comparison
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Common questions</span>
          <h2>The comparison questions this hub helps answer.</h2>
          <p>
            Learners often search with a product they already know. The useful answer is not
            winner-take-all; it is which tool behavior fits the job.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {comparisonHubSearchIntents.map((intent) => (
            <Link key={intent} href="/compare">
              <SearchCheck size={15} />
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>How to compare</span>
          <h2>Do not ask which product wins. Ask which learning behavior fits.</h2>
          <p>
            A learner choosing between tools usually needs one of three things: a structured
            curriculum, a live tutor for the stuck point, or a practice loop that makes the
            idea stay learned.
          </p>
        </div>
        <div className="learning-path-step-grid">
          <article className="learning-path-step">
            <span>
              <BadgeCheck size={16} />
              Curriculum
            </span>
            <h3>Use structured lessons when the path is known.</h3>
            <p>Prepared courses, videos, and exercises are strongest when the learner knows the topic sequence.</p>
          </article>
          <article className="learning-path-step">
            <span>
              <CornerDownRight size={16} />
              Live help
            </span>
            <h3>Use inspir when the stuck point is specific.</h3>
            <p>Public modes are tuned for explanations, Socratic questions, hints, step checks, quizzes, and review.</p>
          </article>
          <article className="learning-path-step">
            <span>
              <SearchCheck size={16} />
              Next step
            </span>
            <h3>Use comparison pages to choose what to try next.</h3>
            <p>Each page links the comparison to live modes, guides, prompts, and practical study paths.</p>
          </article>
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Comparison FAQ</span>
          <h2>Fair comparisons help learners choose faster.</h2>
        </div>
        <div className="marketing-faq-list">
          {comparisonHubFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Want the live learning version right now?</h2>
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
