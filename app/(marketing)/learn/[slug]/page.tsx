import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowUpRight, CheckCircle2, CornerDownRight, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { getBlogPost } from "@/lib/content/blog";
import {
  getLearningPath,
  homepageLearningPaths,
  learningPathHref,
  type HomepageLearningPath,
} from "@/lib/content/landing";
import { getLearningPathHeroVisual } from "@/lib/content/marketing-visuals";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { absoluteUrl, siteName, siteUrl, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { formatMediumDate } from "@/lib/utils/dates";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

type LearningPathPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

function pathJsonLd(path: HomepageLearningPath) {
  return {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    "@id": `${absoluteUrl(learningPathHref(path.slug))}#learning-resource`,
    name: path.seoTitle,
    url: absoluteUrl(learningPathHref(path.slug)),
    description: path.seoDescription,
    educationalUse: ["Self-study", "Tutoring", "Practice"],
    learningResourceType: "AI learning path",
    teaches: path.title,
    keywords: path.searchIntents,
    provider: { "@id": `${siteUrl}/#organization` },
    hasPart: [
      ...path.links.map((link) => ({
        "@type": "LearningResource",
        name: link.label,
        url: absoluteUrl(link.href),
      })),
      ...path.examplePrompts.map((prompt) => ({
        "@type": "CreativeWork",
        name: prompt.title,
        text: prompt.text,
        url: absoluteUrl(prompt.href),
      })),
    ],
  };
}

function pathHowToJsonLd(path: HomepageLearningPath) {
  const url = absoluteUrl(learningPathHref(path.slug));

  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${url}#how-to`,
    name: path.seoTitle,
    description: path.seoDescription,
    totalTime: "PT30M",
    step: path.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.text,
      url: absoluteUrl(step.href),
    })),
  };
}

export function generateStaticParams() {
  return homepageLearningPaths.map((path) => ({ slug: path.slug }));
}

export async function generateMetadata({ params }: LearningPathPageProps): Promise<Metadata> {
  const { slug } = await params;
  const path = getLearningPath(slug);
  if (!path) return {};

  const image = socialImage({
    title: path.seoTitle,
    eyebrow: "Learning path",
    description: path.seoDescription,
  });

  return localizeMarketingMetadata({
    title: path.seoTitle,
    description: path.seoDescription,
    openGraph: {
      title: path.seoTitle,
      description: path.seoDescription,
      url: learningPathHref(path.slug),
      siteName,
      images: [image],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: path.seoTitle,
      description: path.seoDescription,
      images: [image.url],
    },
  }, learningPathHref(path.slug));
}

export default async function LearningPathPage({ params }: LearningPathPageProps) {
  const { slug } = await params;
  const path = getLearningPath(slug);
  if (!path) notFound();

  const relatedPosts = path.relatedBlogSlugs
    .map((postSlug) => getBlogPost(postSlug))
    .filter((post): post is NonNullable<typeof post> => Boolean(post));

  const jsonLd = [
    webPageJsonLd({
      path: learningPathHref(path.slug),
      name: path.seoTitle,
      description: path.seoDescription,
    }),
    pathJsonLd(path),
    pathHowToJsonLd(path),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Learning paths", url: "/learn" },
      { name: path.title, url: learningPathHref(path.slug) },
    ]),
    itemListJsonLd({
      path: learningPathHref(path.slug),
      id: "path-steps",
      name: `${path.title} steps`,
      items: path.steps.map((step) => ({
        name: step.title,
        url: step.href,
        description: step.text,
      })),
    }),
    itemListJsonLd({
      path: learningPathHref(path.slug),
      id: "example-prompts",
      name: `${path.title} example AI prompts`,
      items: path.examplePrompts.map((prompt) => ({
        name: prompt.title,
        url: prompt.href,
        description: prompt.text,
      })),
    }),
    itemListJsonLd({
      path: learningPathHref(path.slug),
      id: "review-loop",
      name: `${path.title} review loop`,
      items: path.reviewLoop.map((step) => ({
        name: step.title,
        url: step.href,
        description: step.text,
      })),
    }),
    itemListJsonLd({
      path: learningPathHref(path.slug),
      id: "mistakes-to-avoid",
      name: `${path.title} mistakes to avoid`,
      items: path.avoid.map((mistake, index) => ({
        name: mistake,
        url: `${learningPathHref(path.slug)}#avoid-${index + 1}`,
      })),
    }),
    faqPageJsonLd({
      path: learningPathHref(path.slug),
      questions: path.faqs,
    }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Learning path" title={path.title} visual={getLearningPathHeroVisual(path.slug)}>
        {path.seoDescription}
      </MarketingPageHero>

      <section className="marketing-band learning-path-intro">
        <div className="marketing-section-copy">
          <span>Who this helps</span>
          <h2>{path.audience}</h2>
          <p>{path.outcome}</p>
          <div className="marketing-inline-actions">
            <Link href={path.links[0].href} className="marketing-primary-cta">
              Start this path
              <Sparkles size={18} />
            </Link>
            <ArrowLink href="/learn">All learning paths</ArrowLink>
          </div>
        </div>
        <div className="learning-path-proof-strip">
          {path.proofPoints.map((point) => (
            <div key={point}>
              <CheckCircle2 size={19} />
              {point}
            </div>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>The workflow</span>
          <h2>Move through the path in three focused steps.</h2>
          <p>
            Each step opens a live guest mode, so this is not a static guide. It is a route into
            practice, feedback, and review.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {path.steps.map((step, index) => (
            <article key={step.title} className="learning-path-step">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <Link href={step.href}>
                Open step
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Live modes</span>
          <h2>The public AI chats in this path.</h2>
          <p>
            These guest modes open directly, so you can start practising without needing a saved private chat.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {path.links.map((link) => (
            <Link key={link.href} href={link.href}>
              <CornerDownRight size={17} />
              {link.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Prompt examples</span>
          <h2>Start with prompts that keep the learning active.</h2>
          <p>
            These are written to make the AI coach, question, and review rather than simply
            produce an answer to copy.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {path.examplePrompts.map((prompt) => (
            <Link key={prompt.title} href={prompt.href} className="marketing-topic-link">
              <span>Example prompt</span>
              <strong>{prompt.title}</strong>
              <p>{prompt.text}</p>
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
          <span>What to avoid</span>
          <h2>Common traps that make AI learning weaker.</h2>
          <p>
            The point is not to use AI less. It is to use it in a way that leaves you with
            stronger understanding after the session.
          </p>
        </div>
        <div className="marketing-card-grid">
          {path.avoid.map((mistake, index) => (
            <article key={mistake} id={`avoid-${index + 1}`} className="marketing-card">
              <AlertTriangle size={22} />
              <h3>{`Avoid ${index + 1}`}</h3>
              <p>{mistake}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Review loop</span>
          <h2>Make the session leave evidence of learning.</h2>
          <p>
            A good path does not end at the answer. It ends with a test, a correction, and a
            next repetition.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {path.reviewLoop.map((step, index) => (
            <article key={step.title} className="learning-path-step">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <Link href={step.href}>
                Continue loop
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      {relatedPosts.length ? (
        <section className="marketing-band is-learning-paths">
          <div className="marketing-section-copy">
            <span>Related guides</span>
            <h2>Read, then practise immediately.</h2>
            <p>
              The blog supports the path with prompts, study strategy, and examples that link
              back into live modes.
            </p>
          </div>
          <div className="marketing-repo-grid">
            {relatedPosts.map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="marketing-repo-card blog-card">
                <time dateTime={post.date}>
                  {formatMediumDate(post.date)}
                </time>
                <strong>{post.title}</strong>
                <span>{post.description}</span>
                <small>
                  Read guide
                  <ArrowUpRight size={14} />
                </small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Search paths</span>
          <h2>The learning jobs this page is built to answer.</h2>
          <p>
            Each phrase maps to the same practical workflow: choose a public mode, ask for
            active help, then review what changed.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {path.searchIntents.map((intent) => (
            <Link key={intent} href={learningPathHref(path.slug)}>
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Questions</span>
          <h2>Before you start.</h2>
        </div>
        <div className="marketing-faq-list">
          {path.faqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
