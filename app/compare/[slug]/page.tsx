import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  BadgeCheck,
  BookOpenCheck,
  CornerDownRight,
  ExternalLink,
  Scale,
  SearchCheck,
  Sparkles,
} from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  comparisonPath,
  getComparisonPage,
  getComparisonPageResources,
  getComparisonPages,
} from "@/lib/content/comparisons";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { absoluteUrl, metadataAlternates, siteName, siteUrl, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

type ComparisonPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getComparisonPages().map((page) => ({ slug: page.slug }));
}

function comparisonLearningResourceJsonLd(page: NonNullable<ReturnType<typeof getComparisonPage>>) {
  const url = absoluteUrl(comparisonPath(page.slug));

  return {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    "@id": `${url}#comparison-resource`,
    name: page.seoTitle,
    url,
    description: page.description,
    educationalUse: ["Self-study", "Tutoring", "Tool comparison"],
    learningResourceType: "AI tutor comparison",
    teaches: page.searchIntents,
    provider: { "@id": `${siteUrl}/#organization` },
  };
}

export async function generateMetadata({ params }: ComparisonPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getComparisonPage(slug);
  if (!page) return {};

  const image = socialImage({
    title: page.seoTitle,
    eyebrow: "Compare",
    description: page.description,
  });

  return localizeMarketingMetadata({
    title: page.seoTitle,
    description: page.description,
    alternates: metadataAlternates(comparisonPath(page.slug)),
    openGraph: {
      title: `${page.seoTitle} | inspir`,
      description: page.description,
      url: comparisonPath(page.slug),
      siteName,
      images: [image],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${page.seoTitle} | inspir`,
      description: page.description,
      images: [image.url],
    },
  }, comparisonPath(page.slug));
}

export default async function ComparisonDetailPage({ params }: ComparisonPageProps) {
  const { slug } = await params;
  const page = getComparisonPage(slug);
  if (!page) notFound();

  const resources = getComparisonPageResources(page);
  const jsonLd = [
    webPageJsonLd({
      path: comparisonPath(page.slug),
      name: `${page.seoTitle} | inspir`,
      description: page.description,
    }),
    comparisonLearningResourceJsonLd(page),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
      { name: page.seoTitle, url: comparisonPath(page.slug) },
    ]),
    itemListJsonLd({
      path: comparisonPath(page.slug),
      id: "comparison-points",
      name: `${page.seoTitle} comparison points`,
      items: page.comparisonRows.map((row, index) => ({
        name: row.label,
        url: `${comparisonPath(page.slug)}#comparison-${index + 1}`,
        description: `${row.establishedOption} ${row.inspir}`,
      })),
    }),
    itemListJsonLd({
      path: comparisonPath(page.slug),
      id: "public-mode-entrypoints",
      name: `${page.seoTitle} public mode entrypoints`,
      items: resources.modes.map((mode) => ({
        name: mode.name,
        url: mode.href,
        description: mode.description,
      })),
    }),
    itemListJsonLd({
      path: comparisonPath(page.slug),
      id: "related-guides",
      name: `${page.seoTitle} related guides`,
      items: resources.guides.map((guide) => ({
        name: guide.title,
        url: guide.href,
        description: guide.description,
      })),
    }),
    faqPageJsonLd({ path: comparisonPath(page.slug), questions: page.faqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow={page.eyebrow} title={page.title}>
        {page.description}
      </MarketingPageHero>

      <section className="marketing-band learning-path-intro">
        <div className="marketing-section-copy">
          <span>Short answer</span>
          <h2>{page.shortAnswer}</h2>
          <p>{page.balancedPosition}</p>
        </div>
        <div className="learning-path-step-grid">
          {page.bestFor.map((item, index) => (
            <article key={item} className="learning-path-step">
              <span>
                <BadgeCheck size={16} />
                Fit {index + 1}
              </span>
              <h3>{item}</h3>
              <p>Use the comparison below to pick the first public mode or guide.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Comparison</span>
          <h2>When to use {page.competitorName}, and when to open inspir.</h2>
          <p>
            The point is not to flatten two different tools into one winner. The point is to
            match the learning job to the behavior that helps fastest.
          </p>
        </div>
        <div className="marketing-mode-directory">
          <section className="marketing-mode-category">
            <div className="marketing-mode-category-header">
              <div>
                <span>Side by side</span>
                <h3>{page.competitorName} alternative comparison</h3>
                <p>Balanced, action-oriented differences for learners arriving from search.</p>
              </div>
              <strong>{page.comparisonRows.length} points</strong>
            </div>
            <div className="marketing-topic-grid">
              {page.comparisonRows.map((row, index) => (
                <article key={row.label} id={`comparison-${index + 1}`} className="marketing-topic-link">
                  <span>
                    <Scale size={15} />
                    {row.label}
                  </span>
                  <strong>{page.competitorName}</strong>
                  <p>{row.establishedOption}</p>
                  <strong>inspir</strong>
                  <p>{row.inspir}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Use cases</span>
          <h2>Open the mode that matches the job.</h2>
          <p>
            These are the high-intent moments where a learner usually needs a live teaching
            behavior rather than another broad page.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {page.useCases.map((useCase) => (
            <article key={useCase.title} className="learning-path-step">
              <span>
                <CornerDownRight size={16} />
                Start here
              </span>
              <h3>{useCase.title}</h3>
              <p>{useCase.text}</p>
              <Link href={useCase.href}>
                Open mode
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Public entrypoints</span>
          <h2>Live modes, guides, and workflows related to this comparison.</h2>
          <p>
            Every link here is public and crawlable. Private user chats stay out of comparison,
            sitemap, and AI-readable discovery files.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {resources.modes.map((mode) => (
            <Link key={mode.slug} href={mode.href} className="marketing-topic-link">
              <span>{mode.category}</span>
              <strong>{mode.name}</strong>
              <p>{mode.description}</p>
              {mode.starters.length ? (
                <ul>
                  {mode.starters.map((starter) => (
                    <li key={starter}>{starter}</li>
                  ))}
                </ul>
              ) : null}
              <small>
                Open mode
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
          {resources.workflows.map((workflow) => (
            <Link key={workflow.slug} href={workflow.href} className="marketing-topic-link">
              <span>Learning workflow</span>
              <strong>{workflow.title}</strong>
              <p>{workflow.description}</p>
              <small>
                Open workflow
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
          {resources.guides.map((guide) => (
            <Link key={guide.slug} href={guide.href} className="marketing-topic-link">
              <span>Guide</span>
              <strong>{guide.title}</strong>
              <p>{guide.description}</p>
              <small>
                Read guide
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Search intent</span>
          <h2>The searches this page is designed to answer.</h2>
          <p>
            These phrases are surfaced naturally on the page and in structured discovery files
            so crawlers can understand the exact comparison intent.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {page.searchIntents.map((intent) => (
            <Link key={intent} href={comparisonPath(page.slug)}>
              <SearchCheck size={15} />
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Reference notes</span>
          <h2>External facts are linked to official sources.</h2>
          <p>
            inspir comparison pages should be useful without pretending another platform is
            static. Check official sources for the latest product details.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {page.officialReferences.map((reference) => (
            <article key={reference.href} className="learning-path-step">
              <span>
                <BookOpenCheck size={16} />
                Official source
              </span>
              <h3>{reference.title}</h3>
              <p>{reference.text}</p>
              <a href={reference.href} target="_blank" rel="noreferrer">
                Open source
                <ExternalLink size={15} />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Comparison FAQ</span>
          <h2>Use the right tool for the learning job.</h2>
        </div>
        <div className="marketing-faq-list">
          {page.faqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Try the live AI learning path.</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/compare">Back to comparisons</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
