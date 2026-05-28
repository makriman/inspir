import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import {
  getBlogCategories,
  getBlogPost,
  getBlogPostTopic,
  getBlogPosts,
  getRelatedBlogPosts,
  slugifyBlogTag,
} from "@/lib/content/blog";
import { topicPath } from "@/lib/content/topic-routing";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { defaultSocialImage, metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { blogPostingJsonLd, breadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";

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
  return {
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
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();
  const topic = getBlogPostTopic(post);
  const topicSeo = topic ? getTopicSeo(topic) : null;
  const relatedPosts = getRelatedBlogPosts(post, 4);
  const categorySlugs = new Set(getBlogCategories().map((category) => category.slug));

  const jsonLd = [
    blogPostingJsonLd(post),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Blog", url: "/blog" },
      { name: post.title, url: `/blog/${post.slug}` },
    ]),
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
      <article className="blog-article">
        <Link href="/blog" className="blog-back-link">
          Blog
        </Link>
        <header className="blog-article-header">
          <time dateTime={post.date}>{new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(post.date))}</time>
          <h1>{post.title}</h1>
          <p>{post.description}</p>
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
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
                    {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(related.date))}
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
