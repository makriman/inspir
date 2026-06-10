import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { notFound } from "next/navigation";
import { ArrowUpRight, Sparkles } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import {
  extractBlogHeadings,
  getBlogCategories,
  getBlogPost,
  getBlogPostTopic,
  getBlogPosts,
  getRelatedBlogPosts,
  slugifyBlogTag,
} from "@/lib/content/blog";
import { estimateBlogIndexedReadingMinutes, getBlogPostDepth } from "@/lib/content/blog-depth";
import { getBlogPostLearningGraph } from "@/lib/content/blog-link-graph";
import { getBlogPostPracticePlan } from "@/lib/content/blog-practice";
import { topicPath } from "@/lib/content/topic-routing";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { getRequestLanguage } from "@/lib/i18n/request-locale";
import { localizeHref } from "@/lib/i18n/routing";
import { defaultSocialImage, metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { formatMediumDate, formatLongDate } from "@/lib/utils/dates";
import {
  blogLearningResourceJsonLd,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  howToJsonLd,
  itemListJsonLd,
} from "@/lib/seo/json-ld";

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};

  const image = post.image
    ? { ...defaultSocialImage, url: post.image, alt: post.title }
    : socialImage({
        title: post.title,
        eyebrow: "Learning guide",
        description: post.description,
      });
  return localizeMarketingMetadata({
    title: post.title,
    description: post.description,
    alternates: metadataAlternates(`/blog/${post.slug}`),
    openGraph: {
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      siteName,
      images: [image],
      type: "article",
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [image.url],
    },
  }, `/blog/${post.slug}`);
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();
  const topic = getBlogPostTopic(post);
  const topicSeo = topic ? getTopicSeo(topic) : null;
  const relatedPosts = getRelatedBlogPosts(post, 4);
  const learningGraph = getBlogPostLearningGraph(post);
  const practicePlan = getBlogPostPracticePlan(post);
  const editorialDepth = getBlogPostDepth(post);
  const learningActionLinks = learningGraph.primaryLinks.length
    ? learningGraph.primaryLinks
    : learningGraph.secondaryLinks.slice(0, 4);
  const categorySlugs = new Set(getBlogCategories().map((category) => category.slug));
  const headings = extractBlogHeadings(post);
  const readingMinutes = estimateBlogIndexedReadingMinutes(post);
  const headingIdByLine = new Map(headings.map((heading) => [heading.line, heading.id]));
  const language = await getRequestLanguage();
  const markdownComponents: Components = {
    h2: ({ children, node }) => <h2 id={headingIdByLine.get(node?.position?.start.line ?? -1)}>{children}</h2>,
    h3: ({ children, node }) => <h3 id={headingIdByLine.get(node?.position?.start.line ?? -1)}>{children}</h3>,
    a: ({ children, href }) => <a href={href ? localizeHref(href, language) : undefined}>{children}</a>,
  };

  const jsonLd = [
    blogPostingJsonLd(post),
    blogLearningResourceJsonLd(post),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Blog", url: "/blog" },
      { name: post.title, url: `/blog/${post.slug}` },
    ]),
    howToJsonLd({
      path: `/blog/${post.slug}`,
      id: "article-practice-loop",
      name: practicePlan.title,
      description: practicePlan.intro,
      totalTime: "PT12M",
      steps: practicePlan.steps.map((step, index) => ({
        name: step.title,
        text: step.text,
        url: `/blog/${post.slug}#practice-step-${index + 1}`,
      })),
    }),
    ...(relatedPosts.length
      ? [
          itemListJsonLd({
            path: `/blog/${post.slug}`,
            id: "related-reading",
            name: `${post.title} related reading`,
            items: relatedPosts.map((related) => ({
              name: related.title,
              url: `/blog/${related.slug}`,
              description: related.description,
            })),
          }),
        ]
      : []),
    ...(learningActionLinks.length
      ? [
          itemListJsonLd({
            path: `/blog/${post.slug}`,
            id: "article-learning-actions",
            name: `${post.title} learning actions`,
            items: learningActionLinks.map((link) => ({
              name: link.title,
              url: link.href,
              description: link.description,
            })),
          }),
        ]
      : []),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <article className="blog-article">
        <Link href="/blog" className="blog-back-link">
          Blog
        </Link>
        <header className="blog-article-header">
          <time dateTime={post.date}>{formatLongDate(post.date)}</time>
          <h1>{post.title}</h1>
          <p>{post.description}</p>
          <dl className="blog-article-meta-list">
            <div>
              <dt>Reading time</dt>
              <dd>{readingMinutes} min</dd>
            </div>
            <div>
              <dt>Study action</dt>
              <dd>{topic ? `Open ${topic.name}` : "Open a learning mode"}</dd>
            </div>
          </dl>
          {post.tags.length ? (
            <div className="blog-tag-list" aria-label="Article topics">
              {post.tags.map((tag) => {
                const tagSlug = slugifyBlogTag(tag);
                return categorySlugs.has(tagSlug) ? (
                  <Link key={tag} href={`/blog/category/${tagSlug}`} className="blog-tag-chip">
                    {tag}
                  </Link>
                ) : (
                  <span key={tag} className="blog-tag-chip">
                    {tag}
                  </span>
                );
              })}
            </div>
          ) : null}
        </header>
        <div className="blog-article-layout">
          <aside className="blog-article-rail" aria-label="Article navigation">
            {headings.length ? (
              <nav className="blog-article-index" aria-label="In this guide">
                <span>In this guide</span>
                {headings.slice(0, 8).map((heading) => (
                  <a key={heading.id} href={`#${heading.id}`} className={heading.level === 3 ? "is-nested" : ""}>
                    {heading.title}
                  </a>
                ))}
              </nav>
            ) : null}
            {topic && topicSeo ? (
              <div className="blog-article-mode-card">
                <span>Live mode</span>
                <strong>{topic.name}</strong>
                <p>{topicSeo.description}</p>
                <Link href={topicPath(topic.slug)}>
                  Start mode
                  <Sparkles size={15} />
                </Link>
              </div>
            ) : null}
            {learningGraph.secondaryLinks.length ? (
              <div className="blog-article-link-card">
                <span>Learning graph</span>
                {learningGraph.secondaryLinks.slice(0, 5).map((link) => (
                  <Link key={`${link.kind}-${link.href}-${link.title}`} href={link.href}>
                    {link.title}
                  </Link>
                ))}
              </div>
            ) : null}
          </aside>
          <div className="blog-article-body">
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {post.body}
            </ReactMarkdown>
            <section className="blog-editorial-depth" aria-labelledby="blog-editorial-depth">
              <span>Field guide</span>
              <h2 id="blog-editorial-depth">{editorialDepth.title}</h2>
              <p>{editorialDepth.intro}</p>
              <div className="blog-editorial-depth-list">
                {editorialDepth.sections.map((section) => (
                  <section key={section.title} className="blog-editorial-depth-section">
                    <h3>{section.title}</h3>
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    <ul>
                      {section.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                    <div className="blog-editorial-depth-links" aria-label={`${section.title} routes`}>
                      {section.links.map((link) => (
                        <Link key={`${section.title}-${link.href}`} href={link.href}>
                          <span>{link.eyebrow}</span>
                          <strong>{link.title}</strong>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
            <section className="blog-practice-plan" aria-labelledby="blog-practice-plan">
              <span>Active study loop</span>
              <h2 id="blog-practice-plan">{practicePlan.title}</h2>
              <p>{practicePlan.intro}</p>
              <ol className="blog-practice-steps">
                {practicePlan.steps.map((step, index) => (
                  <li key={step.title} id={`practice-step-${index + 1}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="blog-practice-checks">
                <h3>Before you leave the guide</h3>
                <ul>
                  {practicePlan.checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              </div>
              <div className="blog-practice-route-list" aria-label="Routes to continue learning">
                {practicePlan.routes.map((route) => (
                  <Link key={`${route.kind}-${route.href}-${route.title}`} href={route.href}>
                    <span>{route.eyebrow}</span>
                    <strong>{route.title}</strong>
                    <small>
                      Continue
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
              </div>
            </section>
            {learningActionLinks.length ? (
              <section className="blog-learning-graph" aria-labelledby="blog-learning-graph">
                <span>Practice map</span>
                <h2 id="blog-learning-graph">Turn this guide into a learning route.</h2>
                <p>
                  The article is only the starting point. These public routes connect the idea
                  to a live mode, subject hub, study path, or workflow.
                </p>
                <div className="blog-learning-link-grid">
                  {learningActionLinks.map((link) => (
                    <Link key={`${link.kind}-${link.href}-${link.title}`} href={link.href} className="blog-learning-link-card">
                      <span>{link.eyebrow}</span>
                      <strong>{link.title}</strong>
                      <p>{link.description}</p>
                      <small>
                        Open route
                        <ArrowUpRight size={14} />
                      </small>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
            {topic && topicSeo ? (
              <section className="blog-next-step-card" aria-labelledby="blog-next-step">
                <span>Live learning mode</span>
                <h2 id="blog-next-step">Continue in {topic.name}</h2>
                <p>{topicSeo.description}</p>
                <Link href={topicPath(topic.slug)} className="marketing-primary-cta">
                  Open {topic.name}
                  <Sparkles size={18} />
                </Link>
              </section>
            ) : null}
          </div>
        </div>
        {relatedPosts.length ? (
          <aside className="blog-related-block" aria-labelledby="related-reading">
            <div className="marketing-section-copy">
              <span>Related reading</span>
              <h2 id="related-reading">Keep the study loop going.</h2>
            </div>
            <div className="marketing-repo-grid">
              {relatedPosts.map((related) => (
                <Link key={related.slug} href={`/blog/${related.slug}`} className="marketing-repo-card blog-card">
                  <time dateTime={related.date}>
                    {formatMediumDate(related.date)}
                  </time>
                  <strong>{related.title}</strong>
                  <span>{related.description}</span>
                  <small>
                    Read article
                    <ArrowUpRight size={14} />
                  </small>
                </Link>
              ))}
            </div>
          </aside>
        ) : null}
      </article>
      <MarketingFooter />
    </main>
  );
}
