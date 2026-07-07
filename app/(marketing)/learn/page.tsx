import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, CornerDownRight, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { homepageLearningPaths, learningPathHref } from "@/lib/content/landing";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const pageMetadata: Metadata = {
  title: "AI Learning Paths",
  description:
    "Practical AI learning paths for understanding hard topics, homework help, exam prep, history, debate, flashcards, and active recall.",
  openGraph: {
    title: "AI Learning Paths | inspir",
    description:
      "Follow practical study workflows that connect free guest AI learning modes with guides, prompts, quizzes, and review loops.",
    url: "/learn",
    siteName,
    images: [
      socialImage({
        title: "AI Learning Paths",
        eyebrow: "Study workflows",
        description:
          "Practical paths for understanding, homework help, exam prep, history, debate, and active recall.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Paths | inspir",
    description:
      "Follow practical study workflows that connect free guest AI learning modes with guides, prompts, quizzes, and review loops.",
    images: [
      socialImage({
        title: "AI Learning Paths",
        eyebrow: "Study workflows",
      }).url,
    ],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/learn");
}

export default function LearningPathsPage() {
  const jsonLd = [
    webPageJsonLd({
      path: "/learn",
      name: "AI Learning Paths | inspir",
      description:
        "Practical AI learning paths connecting free public learning modes with study guides, active recall, and review loops.",
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Learning paths", url: "/learn" },
    ]),
    itemListJsonLd({
      path: "/learn",
      id: "learning-paths",
      name: "AI learning paths",
      items: homepageLearningPaths.map((path) => ({
        name: path.title,
        url: learningPathHref(path.slug),
        description: path.description,
      })),
    }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Learning paths" title="Use AI as a study workflow, not a shortcut." visual="paths">
        Each path connects the right guest modes, prompts, and guides so learners can move from a question into a real
        practice loop.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Choose a path</span>
          <h2>Start with the job you need done.</h2>
          <p>
            Choose the path that matches the moment: understand a hard idea, get unstuck, prepare for an exam, or explore
            a bigger question.
          </p>
        </div>
        <div className="marketing-path-grid is-directory">
          {homepageLearningPaths.map((path) => (
            <article key={path.slug} className="marketing-path-card">
              <h3>{path.title}</h3>
              <p>{path.description}</p>
              <div>
                <Link href={learningPathHref(path.slug)}>
                  <ArrowUpRight size={15} />
                  Open the full path
                </Link>
                {path.links.slice(0, 2).map((link) => (
                  <Link key={link.href} href={link.href}>
                    <CornerDownRight size={15} />
                    {link.label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Need a first step right now?</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/topics">Browse every mode</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
