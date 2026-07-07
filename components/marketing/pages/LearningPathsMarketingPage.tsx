import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, CornerDownRight, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooterWithChrome,
  MarketingHeaderWithChrome,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { homepageLearningPaths, learningPathHref } from "@/lib/content/landing";
import type { SupportedLanguage } from "@/lib/content/languages";
import { getStaticMarketingChrome } from "@/lib/i18n/marketing-chrome";
import { localizeMarketingMetadataForLanguage } from "@/lib/i18n/metadata";
import { localizeHref } from "@/lib/i18n/routing";
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

export function generateLearningPathsMetadata(language: SupportedLanguage) {
  return localizeMarketingMetadataForLanguage(pageMetadata, "/learn", language);
}

export async function LearningPathsPageContent({
  language,
  pathname,
}: {
  language: SupportedLanguage;
  pathname: string;
}) {
  const chrome = await getStaticMarketingChrome(pathname, language);
  const { hrefLanguage } = chrome;
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
      <JsonLdScripts items={jsonLd} path="/learn" language={language} />
      <MarketingHeaderWithChrome chrome={chrome} />
      <MarketingPageHero
        eyebrow="Learning paths"
        title="Use AI as a study workflow, not a shortcut."
        visual="paths"
        chrome={chrome}
      >
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
                <Link href={localizeHref(learningPathHref(path.slug), hrefLanguage)}>
                  <ArrowUpRight size={15} />
                  Open the full path
                </Link>
                {path.links.slice(0, 2).map((link) => (
                  <Link key={link.href} href={localizeHref(link.href, hrefLanguage)}>
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
          <Link href={localizeHref("/chat/learn-anything", hrefLanguage)} className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/topics" hrefLanguage={hrefLanguage}>Browse every mode</ArrowLink>
        </div>
      </section>

      <MarketingFooterWithChrome chrome={chrome} />
    </main>
  );
}
