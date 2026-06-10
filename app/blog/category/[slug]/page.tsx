import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { MarketingFooter, MarketingHeader, MarketingPageHero } from "@/components/marketing/MarketingShell";
import { getBlogCategories, getBlogCategory } from "@/lib/content/blog";
import {
  getBlogCategoryFaqs,
  getBlogCategoryFeaturedPosts,
  getBlogCategoryProfile,
  getBlogCategoryRelatedModes,
} from "@/lib/content/blog-directory";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { formatMediumDate } from "@/lib/utils/dates";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
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

  const profile = getBlogCategoryProfile(category);
  const title = profile.title;
  const description = `${profile.description} Browse ${category.count} guides linked to live AI learning modes.`;
  const image = socialImage({ title, eyebrow: "Blog theme", description });

  return localizeMarketingMetadata({
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
  }, `/blog/category/${category.slug}`);
}

export default async function BlogCategoryPage({ params }: BlogCategoryPageProps) {
  const { slug } = await params;
  const category = getBlogCategory(slug);
  if (!category) notFound();

  const profile = getBlogCategoryProfile(category);
  const relatedModes = getBlogCategoryRelatedModes(category);
  const featuredPosts = getBlogCategoryFeaturedPosts(category);
  const categoryFaqs = getBlogCategoryFaqs(category);
  const otherCategories = getBlogCategories().filter((item) => item.slug !== category.slug).slice(0, 6);
  const description = `${profile.description} Browse ${category.count} guides linked to live AI learning modes.`;
  const jsonLd = [
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Blog", url: "/blog" },
      { name: category.name, url: `/blog/category/${category.slug}` },
    ]),
    webPageJsonLd({
      path: `/blog/category/${category.slug}`,
      name: profile.title,
      description,
      type: "CollectionPage",
    }),
    itemListJsonLd({
      path: `/blog/category/${category.slug}`,
      id: "featured-guides",
      name: `${category.name} featured guides`,
      items: featuredPosts.map((post) => ({
        name: post.title,
        url: `/blog/${post.slug}`,
        description: post.description,
      })),
    }),
    itemListJsonLd({
      path: `/blog/category/${category.slug}`,
      id: "related-live-modes",
      name: `${category.name} related public AI learning modes`,
      items: relatedModes.map((mode) => ({
        name: mode.name,
        url: mode.href,
        description: mode.description,
      })),
    }),
    itemListJsonLd({
      path: `/blog/category/${category.slug}`,
      id: "category-workflows",
      name: `${category.name} learning workflows`,
      items: profile.workflows.map((workflow, index) => ({
        name: workflow.title,
        url: `${`/blog/category/${category.slug}`}#workflow-${index + 1}`,
        description: workflow.text,
      })),
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
    faqPageJsonLd({
      path: `/blog/category/${category.slug}`,
      questions: categoryFaqs,
    }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Blog theme" title={profile.title}>
        {profile.description}
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>{category.count} articles</span>
          <h2>{profile.audience}</h2>
          <p>{profile.outcome}</p>
        </div>
        <div className="marketing-card-grid">
          {profile.workflows.map((workflow, index) => (
            <article key={workflow.title} id={`workflow-${index + 1}`} className="learning-path-step">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{workflow.title}</h3>
              <p>{workflow.text}</p>
              <Link href={workflow.href}>
                Open next
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      {featuredPosts.length ? (
        <section className="marketing-band is-learning-paths">
          <div className="marketing-section-copy">
            <span>Best starting points</span>
            <h2>Read these first, then move into practice.</h2>
            <p>
              These guides are the clearest entry points for this topic cluster and connect
              back into live public learning modes.
            </p>
          </div>
          <div className="marketing-repo-grid">
            {featuredPosts.map((post) => (
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

      {relatedModes.length ? (
        <section className="marketing-band">
          <div className="marketing-section-copy">
            <span>Related live modes</span>
            <h2>Open the AI learning tools behind this category.</h2>
            <p>
              These public guest chats are the strongest practice destinations from this guide
              cluster, based on the modes the articles connect to most often.
            </p>
          </div>
          <div className="marketing-topic-grid">
            {relatedModes.map((mode) => (
              <Link key={mode.slug} href={mode.href} className="marketing-topic-link">
                <span>{mode.count} related guides</span>
                <strong>{mode.name}</strong>
                <p>{mode.description}</p>
                <small>
                  Open mode
                  <ArrowUpRight size={14} />
                </small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Search intent</span>
          <h2>The questions this hub is built to answer.</h2>
          <p>
            Each category has its own search intent, live mode links, and guide structure so
            the library is useful to people and legible to search systems.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {profile.searchIntents.map((intent) => (
            <Link key={intent} href={`/blog/category/${category.slug}`}>
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>All guides</span>
          <h2>Every article in this topic cluster.</h2>
          <p>
            Browse the complete cluster, then follow the internal links into learning paths,
            public modes, and related guides.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {category.posts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="marketing-topic-link blog-card">
              <time dateTime={post.date}>
                {formatMediumDate(post.date)}
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

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Category questions</span>
          <h2>How to use this guide cluster.</h2>
        </div>
        <div className="marketing-faq-list">
          {categoryFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>More clusters</span>
          <h2>Keep moving through the learning library.</h2>
          <p>
            Related category hubs help search visitors and learners find the next useful
            branch without falling back to a generic blog archive.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {otherCategories.map((item) => (
            <Link key={item.slug} href={`/blog/category/${item.slug}`}>
              {item.name}
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
