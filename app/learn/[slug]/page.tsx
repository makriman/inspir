import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, CheckCircle2, CornerDownRight, Sparkles } from "lucide-react";
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
import { absoluteUrl, metadataAlternates, siteName, siteUrl, socialImage } from "@/lib/seo/config";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  serializeJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

type LearningPathPageProps = {
  params: Promise<{ slug: string }>;
};

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
    provider: { "@id": `${siteUrl}/#organization` },
    hasPart: path.links.map((link) => ({
      "@type": "LearningResource",
      name: link.label,
      url: absoluteUrl(link.href),
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

  return {
    title: path.seoTitle,
    description: path.seoDescription,
    alternates: metadataAlternates(learningPathHref(path.slug)),
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
  };
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
    faqPageJsonLd({
      path: learningPathHref(path.slug),
      questions: path.faqs,
    }),
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
      <MarketingPageHero eyebrow="Learning path" title={path.title}>
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
            These are canonical guest entrypoints that search visitors and learners can open
            directly without needing a saved private chat.
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
                  {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(post.date))}
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
