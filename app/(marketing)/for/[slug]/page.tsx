import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  CornerDownRight,
  GraduationCap,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  audiencePath,
  getAudiencePage,
  getAudiencePageResources,
  getAudiencePages,
} from "@/lib/content/audiences";
import { getAudienceHeroVisual } from "@/lib/content/marketing-visuals";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { absoluteUrl, metadataAlternates, siteName, siteUrl, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

type AudienceDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getAudiencePages().map((page) => ({ slug: page.slug }));
}

function audienceJsonLd(page: NonNullable<ReturnType<typeof getAudiencePage>>) {
  const url = absoluteUrl(audiencePath(page.slug));

  return {
    "@context": "https://schema.org",
    "@type": "EducationalAudience",
    "@id": `${url}#audience`,
    name: page.seoTitle,
    audienceType: page.role,
    educationalRole: page.role,
    description: page.description,
  };
}

function audienceLearningResourceJsonLd(page: NonNullable<ReturnType<typeof getAudiencePage>>) {
  const url = absoluteUrl(audiencePath(page.slug));

  return {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    "@id": `${url}#learning-resource`,
    name: page.seoTitle,
    url,
    description: page.description,
    educationalUse: ["Self-study", "Tutoring", "Practice"],
    learningResourceType: "Audience learning path",
    audience: { "@id": `${url}#audience` },
    provider: { "@id": `${siteUrl}/#organization` },
  };
}

export async function generateMetadata({ params }: AudienceDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getAudiencePage(slug);
  if (!page) return {};

  const image = socialImage({
    title: page.seoTitle,
    eyebrow: page.eyebrow,
    description: page.description,
  });

  return localizeMarketingMetadata({
    title: page.seoTitle,
    description: page.description,
    alternates: metadataAlternates(audiencePath(page.slug)),
    openGraph: {
      title: `${page.seoTitle} | inspir`,
      description: page.description,
      url: audiencePath(page.slug),
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
  }, audiencePath(page.slug));
}

export default async function AudienceDetailPage({ params }: AudienceDetailPageProps) {
  const { slug } = await params;
  const page = getAudiencePage(slug);
  if (!page) notFound();

  const resources = getAudiencePageResources(page);
  const jsonLd = [
    webPageJsonLd({
      path: audiencePath(page.slug),
      name: `${page.seoTitle} | inspir`,
      description: page.description,
    }),
    audienceJsonLd(page),
    audienceLearningResourceJsonLd(page),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "For learners", url: "/for" },
      { name: page.seoTitle, url: audiencePath(page.slug) },
    ]),
    itemListJsonLd({
      path: audiencePath(page.slug),
      id: "audience-jobs",
      name: `${page.seoTitle} use cases`,
      items: page.jobs.map((job) => ({
        name: job.title,
        url: job.href,
        description: job.text,
      })),
    }),
    itemListJsonLd({
      path: audiencePath(page.slug),
      id: "public-mode-entrypoints",
      name: `${page.seoTitle} public mode entrypoints`,
      items: resources.modes.map((mode) => ({
        name: mode.name,
        url: mode.href,
        description: mode.description,
      })),
    }),
    itemListJsonLd({
      path: audiencePath(page.slug),
      id: "related-guides",
      name: `${page.seoTitle} related guides`,
      items: resources.guides.map((guide) => ({
        name: guide.title,
        url: guide.href,
        description: guide.description,
      })),
    }),
    faqPageJsonLd({ path: audiencePath(page.slug), questions: page.faqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow={page.eyebrow} title={page.title} visual={getAudienceHeroVisual(page.slug)}>
        {page.description}
      </MarketingPageHero>

      <section className="marketing-band learning-path-intro">
        <div className="marketing-section-copy">
          <span>Audience route</span>
          <h2>{page.summary}</h2>
          <p>{page.why}</p>
        </div>
        <div className="learning-path-step-grid">
          {page.jobs.map((job, index) => (
            <article key={job.title} className="learning-path-step">
              <span>
                <CornerDownRight size={16} />
                Job {index + 1}
              </span>
              <h3>{job.title}</h3>
              <p>{job.text}</p>
              <Link href={job.href}>
                Open this route
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Public modes</span>
          <h2>Start with the mode that matches the moment.</h2>
          <p>
            These live guest modes are open to try. Private user conversations stay private.
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
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Guides and workflows</span>
          <h2>Turn the first click into a complete learning loop.</h2>
          <p>
            A good first step should lead somewhere useful: paths, workflows, guides, and repeatable review.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {resources.paths.map((path) => (
            <Link key={path.slug} href={path.href} className="marketing-topic-link">
              <span>
                <GraduationCap size={15} />
                Learning path
              </span>
              <strong>{path.title}</strong>
              <p>{path.description}</p>
              <small>
                Open path
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
          <span>Common questions</span>
          <h2>The questions this page is designed to answer.</h2>
          <p>
            These are common ways people describe the same learning need.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {page.searchIntents.map((intent) => (
            <Link key={intent} href={audiencePath(page.slug)}>
              <SearchCheck size={15} />
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Boundaries</span>
          <h2>Useful AI learning has a clear contract.</h2>
          <p>
            The audience pages make the expected learning behavior explicit so the first session
            starts with better judgment.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {page.safeguards.map((safeguard, index) => (
            <article key={safeguard} className="learning-path-step">
              <span>
                <ShieldCheck size={16} />
                Boundary {index + 1}
              </span>
              <h3>{safeguard}</h3>
              <p>Keep the session focused on learning evidence, not passive answer collection.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>{page.eyebrow} FAQ</span>
          <h2>Start with public guidance, then open the right mode.</h2>
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
        <h2>Ready to try the first mode?</h2>
        <div className="marketing-inline-actions">
          <Link href={resources.modes[0]?.href ?? "/chat/learn-anything"} className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/for">Back to audience paths</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
