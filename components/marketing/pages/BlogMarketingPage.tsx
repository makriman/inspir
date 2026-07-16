import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, BookOpenCheck, Library, Route } from "lucide-react";
import {
  MarketingFooterWithChrome,
  MarketingHeaderWithChrome,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { getBlogCategories, getBlogPosts } from "@/lib/content/blog";
import { blogHubFaqs, getBlogPillarClusters } from "@/lib/content/blog-directory";
import { indexedBlogPosts, isIndexedBlogPost } from "@/lib/content/blog-seo-policy";
import {
  type SupportedLanguage,
  languageConfigs,
  supportedLanguages,
} from "@/lib/content/languages";
import { topicSeeds } from "@/lib/content/topics";
import { getStaticMarketingChrome } from "@/lib/i18n/marketing-chrome";
import { localizeMarketingMetadataForLanguage } from "@/lib/i18n/metadata";
import { localizeStaticSiteHref } from "@/lib/i18n/static-availability";
import { siteName, socialImage } from "@/lib/seo/config";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const blogDescription =
  "Explore practical AI learning guides for tutoring, active recall, homework help, writing feedback, coding, and exam prep.";

const blogDateFormatters = new Map<SupportedLanguage, Intl.DateTimeFormat>();
for (const language of supportedLanguages) {
  blogDateFormatters.set(
    language,
    new Intl.DateTimeFormat(languageConfigs[language].locale, {
      dateStyle: "medium",
    }),
  );
}

function getBlogDateFormatter(language: SupportedLanguage) {
  const formatter = blogDateFormatters.get(language);
  if (!formatter) {
    throw new Error(language);
  }
  return formatter;
}

function interpolateCopy(
  template: string,
  value: string | number,
  fallbackText?: string,
) {
  const interpolated = template.replace("{value1}", String(value));
  return interpolated === template && fallbackText
    ? String(value) + " " + fallbackText
    : interpolated;
}

const pageMetadata: Metadata = {
  title: "AI Learning Blog",
  description: blogDescription,
  openGraph: {
    title: "AI Learning Blog | inspir",
    description: blogDescription,
    url: "/blog",
    siteName,
    images: [
      socialImage({
        title: "AI Learning Blog",
        eyebrow: "Guides",
        description: blogDescription,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Blog | inspir",
    description: blogDescription,
    images: [
      socialImage({
        title: "AI Learning Blog",
        eyebrow: "Guides",
        description: blogDescription,
      }).url,
    ],
  },
};

export function generateBlogMetadata(language: SupportedLanguage) {
  return localizeMarketingMetadataForLanguage(pageMetadata, "/blog", language);
}

export async function BlogPageContent({
  language,
  pathname,
}: {
  language: SupportedLanguage;
  pathname: string;
}) {
  const chrome = await getStaticMarketingChrome(pathname, language);
  const { hrefLanguage, t } = chrome;
  const posts = getBlogPosts();
  const categories = getBlogCategories().slice(0, 12);
  const pillarClusters = getBlogPillarClusters(posts);
  const corePosts = indexedBlogPosts(posts);
  const topicPosts = posts.filter((post) => !isIndexedBlogPost(post));
  const dateFormatter = getBlogDateFormatter(language);
  const jsonLd = [
    webPageJsonLd({
      path: "/blog",
      name: "AI Learning Blog",
      description:
        "A practical guide library for AI tutoring, study skills, active recall, public learning modes, and useful AI-assisted learning.",
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Blog", url: "/blog" },
    ]),
    itemListJsonLd({
      path: "/blog",
      id: "pillar-clusters",
      name: "AI learning blog pillar clusters",
      items: pillarClusters.map((cluster) => ({
        name: cluster.title,
        url: `/blog#${cluster.slug}`,
        description: cluster.description,
      })),
    }),
    itemListJsonLd({
      path: "/blog",
      id: "core-guides",
      name: "Core AI learning guides",
      items: corePosts.map((post) => ({
        name: post.title,
        url: `/blog/${post.slug}`,
        description: post.description,
      })),
    }),
    itemListJsonLd({
      path: "/blog",
      id: "recommended-guide-library",
      name: "Recommended AI learning guide library",
      items: corePosts.map((post) => ({
        name: post.title,
        url: `/blog/${post.slug}`,
        description: post.description,
      })),
    }),
    faqPageJsonLd({ path: "/blog", questions: blogHubFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} path="/blog" language={language} />
      <MarketingHeaderWithChrome chrome={chrome} />
      <MarketingPageHero
        eyebrow="Blog"
        title="Better ways to learn with AI."
        visual="blog"
        showFilm
        filmMuted={false}
        filmOnly
        chrome={chrome}
      >
        {t(
          interpolateCopy(
            "{value1} guides for tutoring, memory, active practice, historical roleplay, homework help, writing feedback, coding, and learning without becoming passive.",
            posts.length,
            "guides for tutoring, memory, active practice, historical roleplay, homework help, writing feedback, coding, and learning without becoming passive.",
          ),
        )}
      </MarketingPageHero>

      <section className="marketing-band is-blog-library">
        <div className="blog-hub-stats" aria-label={t("Blog library summary")}>
          <div>
            <Library size={20} />
            <strong>
              {t(interpolateCopy("{value1} guides", posts.length))}
            </strong>
            <span>{t("Articles, mode guides, and prompt loops")}</span>
          </div>
          <div>
            <Route size={20} />
            <strong>
              {t(
                interpolateCopy(
                  "{value1} live modes",
                  topicSeeds.length,
                  "live modes",
                ),
              )}
            </strong>
            <span>{t("Public guest chats linked from guides")}</span>
          </div>
          <div>
            <BookOpenCheck size={20} />
            <strong>
              {t(interpolateCopy("{value1} themes", categories.length))}
            </strong>
            <span>{t("Topic clusters for search and browsing")}</span>
          </div>
        </div>
      </section>

      <section className="marketing-band is-blog-pillars">
        <div className="marketing-section-copy">
          <span>{t("Pillar clusters")}</span>
          <h2>{t("Start from a learning job, then move into practice.")}</h2>
          <p>
            {t(
              "These clusters keep the library useful for learners and legible for search: each theme connects cornerstone articles, a blog category, and a live learning mode.",
            )}
          </p>
        </div>
        <div className="blog-pillar-grid">
          {pillarClusters.map((cluster) => (
            <article key={cluster.slug} id={cluster.slug} className="blog-pillar-card">
              <span>{t(cluster.audience)}</span>
              <h3>{t(cluster.title)}</h3>
              <p>{t(cluster.description)}</p>
              <div className="blog-pillar-actions">
                <Link href={cluster.categoryHref}>
                  {t(cluster.categoryLabel)}
                  <ArrowUpRight size={14} />
                </Link>
                <Link href={localizeStaticSiteHref(cluster.modeHref, hrefLanguage)}>
                  {t(interpolateCopy("Open {value1}", cluster.modeLabel))}
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="blog-pillar-guides">
                {cluster.guides.slice(0, 4).map((guide) => (
                  <Link key={guide.slug} href={guide.href}>
                    <strong>{t(guide.title)}</strong>
                    <small>{t(guide.relatedMode ? guide.relatedMode.name : "Learning guide")}</small>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>{t("Explore by theme")}</span>
          <h2>{t("Find the right guide faster.")}</h2>
          <p>
            {t(
              "The blog is organized around study methods, prompt loops, and the public AI learning modes people can use immediately.",
            )}
          </p>
        </div>
        <div className="blog-category-strip">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/blog/category/${category.slug}`}
              className="blog-category-chip"
            >
              <strong>{t(category.name)}</strong>
              <span>
                {t(interpolateCopy("{value1} articles", category.count))}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>{t("Core guides")}</span>
          <h2>{t("Practical learning ideas, not hype.")}</h2>
          <p>
            {t(
              "Each article is written to help learners, parents, educators, and builders use AI for understanding, practice, and confidence.",
            )}
          </p>
        </div>
        <div className="marketing-repo-grid">
          {corePosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="marketing-repo-card blog-card"
            >
              <time dateTime={post.date}>{dateFormatter.format(new Date(post.date))}</time>
              <strong>{t(post.title)}</strong>
              <span>{t(post.description)}</span>
              <small>
                {t("Read article")}
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-topic-library">
        <div className="marketing-section-copy">
          <span>{t("Topic library")}</span>
          <h2>{t("Every public learning mode has guides and prompt loops.")}</h2>
          <p>
            {t(
              "These guides answer specific learning questions and link directly into the matching guest chat experience.",
            )}
          </p>
        </div>
        <div className="marketing-topic-grid">
          {topicPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="marketing-topic-link blog-card"
            >
              <time dateTime={post.date}>{dateFormatter.format(new Date(post.date))}</time>
              <strong>{t(post.title)}</strong>
              <p>{t(post.description)}</p>
              <small>
                {t("Read article")}
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-blog-faq">
        <div className="marketing-section-copy">
          <span>{t("How to use the guide library")}</span>
          <h2>{t("Read one thing, then do the next thing.")}</h2>
          <p>
            {t(
              "The blog should not be a dead end. Every cluster is designed to move a learner from advice into a mode, prompt loop, quiz, flashcard set, or revision habit.",
            )}
          </p>
        </div>
        <div className="marketing-mode-faq-list">
          {blogHubFaqs.map((item) => (
            <details key={item.question}>
              <summary>{t(item.question)}</summary>
              <p>{t(item.answer)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>{t("Ready to try the learning modes?")}</h2>
        <Link
          href={localizeStaticSiteHref("/chat/learn-anything", hrefLanguage)}
          className="marketing-primary-cta is-dark"
        >
          {t("Start learning")}
          <ArrowUpRight size={18} />
        </Link>
      </section>

      <MarketingFooterWithChrome chrome={chrome} />
    </main>
  );
}
