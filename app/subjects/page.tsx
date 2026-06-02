import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BookOpenCheck, SearchCheck, Sparkles, Waypoints } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  getSubjectPages,
  subjectHubFaqs,
  subjectHubSearchIntents,
  subjectPath,
} from "@/lib/content/subjects";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "Explore inspir AI learning by subject: math, writing, coding, history, homework, and exam prep, each connected to public guest modes, guides, prompts, and review loops.";

export const metadata: Metadata = {
  title: "AI Tutors by Subject",
  description,
  alternates: metadataAlternates("/subjects"),
  robots: { index: true, follow: true },
  openGraph: {
    title: "AI Tutors by Subject | inspir",
    description,
    url: "/subjects",
    siteName,
    images: [
      socialImage({
        title: "AI Tutors by Subject",
        eyebrow: "Subjects",
        description,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Tutors by Subject | inspir",
    description,
    images: [
      socialImage({
        title: "AI Tutors by Subject",
        eyebrow: "Subjects",
      }).url,
    ],
  },
};

export default function SubjectHubPage() {
  const pages = getSubjectPages();
  const jsonLd = [
    webPageJsonLd({
      path: "/subjects",
      name: "AI Tutors by Subject | inspir",
      description,
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Subjects", url: "/subjects" },
    ]),
    itemListJsonLd({
      path: "/subjects",
      id: "subject-pages",
      name: "AI tutor subject pages",
      items: pages.map((page) => ({
        name: page.seoTitle,
        url: subjectPath(page.slug),
        description: page.description,
      })),
    }),
    itemListJsonLd({
      path: "/subjects",
      id: "subject-search-intents",
      name: "AI tutor subject search intents",
      items: subjectHubSearchIntents.map((intent) => ({
        name: intent,
        url: "/subjects",
      })),
    }),
    faqPageJsonLd({ path: "/subjects", questions: subjectHubFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Subjects" title="Find the right AI tutor for the subject in front of you.">
        Math, writing, coding, history, homework, and exam prep each need a different kind of help.
        These pages route learners into the public mode, prompt, guide, and review loop that fits.
      </MarketingPageHero>

      <section className="marketing-band is-topic-finder">
        <div className="marketing-section-copy">
          <span>{pages.length} subject hubs</span>
          <h2>Subject pages built around real learning jobs.</h2>
          <p>
            Each hub is a crawlable subject guide, but it also sends learners straight into
            live guest-mode learning instead of stranding them on a brochure page.
          </p>
        </div>
        <div className="marketing-mode-finder-grid">
          {pages.map((page) => (
            <Link key={page.slug} href={subjectPath(page.slug)} className="marketing-mode-finder-card">
              <span>{page.eyebrow}</span>
              <strong>{page.seoTitle}</strong>
              <p>{page.description}</p>
              <small>
                Open subject hub
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Search intent</span>
          <h2>The subject searches this hub is built to answer.</h2>
          <p>
            Broad subject queries are competitive, so these pages pair the subject keyword with
            interactive behaviors: tutoring, hints, feedback, quizzes, flashcards, debate, and planning.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {subjectHubSearchIntents.map((intent) => (
            <Link key={intent} href="/subjects">
              <SearchCheck size={15} />
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>How it works</span>
          <h2>Every subject page connects content to action.</h2>
          <p>
            The goal is not only to rank. It is to make the first click useful for a learner and
            easy for search engines to understand.
          </p>
        </div>
        <div className="learning-path-step-grid">
          <article className="learning-path-step">
            <span>
              <BookOpenCheck size={16} />
              Subject
            </span>
            <h3>Name the subject and learner need.</h3>
            <p>Math help, writing feedback, code tutoring, history context, homework hints, and exam prep are separate needs.</p>
          </article>
          <article className="learning-path-step">
            <span>
              <Sparkles size={16} />
              Live mode
            </span>
            <h3>Open the right public guest mode.</h3>
            <p>The subject hub links directly to focused chat entrypoints such as Math Step Coach and Writing Coach.</p>
          </article>
          <article className="learning-path-step">
            <span>
              <Waypoints size={16} />
              Review
            </span>
            <h3>Finish with evidence of learning.</h3>
            <p>Each route ends with explain-back, a quiz, a flashcard, a source check, or a study plan.</p>
          </article>
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Subject FAQ</span>
          <h2>Public pages for subjects, private chats for learners.</h2>
        </div>
        <div className="marketing-faq-list">
          {subjectHubFaqs.map((item) => (
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
