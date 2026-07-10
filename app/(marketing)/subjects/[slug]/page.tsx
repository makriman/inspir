import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  BookOpenCheck,
  CornerDownRight,
  GraduationCap,
  Lightbulb,
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
  getSubjectPage,
  getSubjectPageResources,
  getSubjectPages,
  subjectPath,
} from "@/lib/content/subjects";
import { getSubjectHeroVisual } from "@/lib/content/marketing-visuals";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { absoluteUrl, siteName, siteUrl, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

type SubjectDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

type Subject = NonNullable<ReturnType<typeof getSubjectPage>>;

export function generateStaticParams() {
  return getSubjectPages().map((page) => ({ slug: page.slug }));
}

function subjectLearningResourceJsonLd(page: Subject) {
  const url = absoluteUrl(subjectPath(page.slug));

  return {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    "@id": `${url}#learning-resource`,
    name: page.seoTitle,
    url,
    description: page.description,
    teaches: page.subjectArea,
    keywords: page.searchIntents,
    educationalUse: ["Tutoring", "Self-study", "Practice", "Assessment"],
    learningResourceType: "AI subject tutor hub",
    provider: { "@id": `${siteUrl}/#organization` },
  };
}

function subjectSoftwareApplicationJsonLd(page: Subject) {
  const url = absoluteUrl(subjectPath(page.slug));

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${url}#software-application`,
    name: `${page.seoTitle} by inspir`,
    url,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description: page.description,
    featureList: page.jobs.map((job) => job.title),
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    provider: { "@id": `${siteUrl}/#organization` },
  };
}

export async function generateMetadata({ params }: SubjectDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getSubjectPage(slug);
  if (!page) return {};

  const image = socialImage({
    title: page.seoTitle,
    eyebrow: page.eyebrow,
    description: page.description,
  });

  return localizeMarketingMetadata({
    title: page.seoTitle,
    description: page.description,
    robots: { index: true, follow: true },
    openGraph: {
      title: `${page.seoTitle} | inspir`,
      description: page.description,
      url: subjectPath(page.slug),
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
  }, subjectPath(page.slug));
}

export default async function SubjectDetailPage({ params }: SubjectDetailPageProps) {
  const { slug } = await params;
  const page = getSubjectPage(slug);
  if (!page) notFound();

  const resources = getSubjectPageResources(page);
  const jsonLd = [
    webPageJsonLd({
      path: subjectPath(page.slug),
      name: `${page.seoTitle} | inspir`,
      description: page.description,
    }),
    subjectLearningResourceJsonLd(page),
    subjectSoftwareApplicationJsonLd(page),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Subjects", url: "/subjects" },
      { name: page.seoTitle, url: subjectPath(page.slug) },
    ]),
    itemListJsonLd({
      path: subjectPath(page.slug),
      id: "subject-jobs",
      name: `${page.seoTitle} learning jobs`,
      items: page.jobs.map((job) => ({
        name: job.title,
        url: job.href,
        description: job.text,
      })),
    }),
    itemListJsonLd({
      path: subjectPath(page.slug),
      id: "public-mode-entrypoints",
      name: `${page.seoTitle} public mode entrypoints`,
      items: resources.modes.map((mode) => ({
        name: mode.name,
        url: mode.href,
        description: mode.description,
      })),
    }),
    itemListJsonLd({
      path: subjectPath(page.slug),
      id: "subject-prompts",
      name: `${page.seoTitle} starter prompts`,
      items: resources.prompts.map((prompt) => ({
        name: `${prompt.topicName}: ${prompt.prompt}`,
        url: prompt.href,
        description: prompt.description,
      })),
    }),
    itemListJsonLd({
      path: subjectPath(page.slug),
      id: "related-guides",
      name: `${page.seoTitle} related guides`,
      items: resources.guides.map((guide) => ({
        name: guide.title,
        url: guide.href,
        description: guide.description,
      })),
    }),
    faqPageJsonLd({ path: subjectPath(page.slug), questions: page.faqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow={page.eyebrow} title={page.title} visual={getSubjectHeroVisual(page.slug)}>
        {page.description}
      </MarketingPageHero>

      <section className="marketing-band learning-path-intro">
        <div className="marketing-section-copy">
          <span>{page.subjectArea}</span>
          <h2>{page.summary}</h2>
          <p>{page.why}</p>
        </div>
        <div className="learning-path-step-grid">
          {page.jobs.map((job, index) => (
            <article key={job.title} className="learning-path-step">
              <span>
                <CornerDownRight size={16} />
                Use {index + 1}
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
          <h2>Start with the mode that matches the learning problem.</h2>
          <p>
            These are live guest entrypoints anyone can try. Private learner conversations
            stay private and are not treated as public learning material.
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
          <span>Prompts</span>
          <h2>Starter prompts turn the subject page into a first action.</h2>
          <p>
            Each prompt opens the matching public mode, so a learner can move from a question
            to a focused study session quickly.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {resources.prompts.slice(0, 6).map((prompt) => (
            <article key={prompt.id} className="learning-path-step">
              <span>
                <Lightbulb size={16} />
                {prompt.topicName}
              </span>
              <h3>{prompt.prompt}</h3>
              <p>{prompt.description}</p>
              <Link href={prompt.href}>
                Try prompt
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Guides and workflows</span>
          <h2>Turn the first click into a complete learning loop.</h2>
          <p>
            Subject hubs connect direct help to deeper guides, learning paths, workflows, and
            repeatable review steps.
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
              <span>
                <BookOpenCheck size={15} />
                Workflow
              </span>
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
          <h2>The questions this page helps learners answer.</h2>
          <p>
            These common starting points help learners choose a mode, ask a better question,
            and leave with a useful next step.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {page.searchIntents.map((intent) => (
            <Link key={intent} href={subjectPath(page.slug)}>
              <SearchCheck size={15} />
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Review loop</span>
          <h2>Useful subject help ends with proof that the idea stuck.</h2>
          <p>
            These steps make the AI session feel more like tutoring and less like passive answer collection.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {page.reviewLoop.map((step, index) => (
            <article key={step} className="learning-path-step">
              <span>
                <ShieldCheck size={16} />
                Step {index + 1}
              </span>
              <h3>{step}</h3>
              <p>Keep the session focused on reasoning, evidence, and recall.</p>
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
        <h2>Ready to try this subject route?</h2>
        <div className="marketing-inline-actions">
          <Link href={resources.modes[0]?.href ?? "/chat/learn-anything"} className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/subjects">Back to subjects</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
