import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { getBlogPost, getBlogPosts } from "@/lib/content/blog";
import { defaultSocialImage, siteName } from "@/lib/seo/config";
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

  const image = post.image ?? defaultSocialImage.url;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      siteName,
      images: [{ ...defaultSocialImage, url: image }],
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
      images: [image],
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

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
        </header>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
      </article>
      <MarketingFooter />
    </main>
  );
}
