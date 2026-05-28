import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { MarketingFooter, MarketingHeader, MarketingPageHero } from "@/components/marketing/MarketingShell";
import { getBlogCategories, getBlogCategory } from "@/lib/content/blog";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  serializeJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

type BlogCategoryPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getBlogCategories().map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: BlogCategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getBlogCategory(slug);
  if (!category) return {};

  const title = `${category.name} AI Learning Guides`;
  const description = `Read ${category.count} inspir articles about ${category.name.toLowerCase()}, with practical AI learning prompts, study loops, and links into live learning modes.`;
  const image = socialImage({ title, eyebrow: "Blog theme", description });

  return {
    title,
    description,
    alternates: metadataAlternates(`/blog/category/${category.slug}`),
    openGraph: {
      title: `${title} | inspir`,
      description,
      url: `/blog/category/${category.slug}`,
      siteName,
      images: [image],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | inspir`,
      description,
      images: [image.url],
    },
  };
}

export default async function BlogCategoryPage({ params }: BlogCategoryPageProps) {
  const { slug } = await params;
  const category = getBlogCategory(slug);
  if (!category) notFound();

  const description = `Read ${category.count} inspir articles about ${category.name.toLowerCase()}, with practical AI learning prompts, study loops, and links into live learning modes.`;
  const jsonLd = [
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Blog", url: "/blog" },
      { name: category.name, url: `/blog/category/${category.slug}` },
    ]),
    webPageJsonLd({
      path: `/blog/category/${category.slug}`,
      name: `${category.name} AI Learning Guides`,
      description,
      type: "CollectionPage",
    }),
    itemListJsonLd({
      path: `/blog/category/${category.slug}`,
      id: "articles",
      name: `${category.name} articles`,
      items: category.posts.map((post) => ({
        name: post.title,
        url: `/blog/${post.slug}`,
        description: post.description,
      })),
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
      <MarketingPageHero eyebrow="Blog theme" title={`${category.name} guides`}>
        Practical articles, prompts, and study loops for learners exploring{" "}
        {category.name.toLowerCase()} with inspir.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>{category.count} articles</span>
          <h2>Read, practise, then open the matching learning mode.</h2>
          <p>
            Each guide is designed to move from advice into action, with internal links to
            public guest chats and related study methods.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {category.posts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="marketing-topic-link blog-card">
              <time dateTime={post.date}>
                {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(post.date))}
              </time>
              <strong>{post.title}</strong>
              <p>{post.description}</p>
              <small>
                Read article
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Browse all public learning modes.</h2>
        <Link href="/topics" className="marketing-primary-cta is-dark">
          View modes
          <ArrowUpRight size={18} />
        </Link>
      </section>

      <MarketingFooter />
    </main>
  );
}
