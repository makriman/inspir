import type { MetadataRoute } from "next";
import { audiencePath, getAudiencePages } from "@/lib/content/audiences";
import { getBlogCategories, getBlogPosts } from "@/lib/content/blog";
import { comparisonPath, getComparisonPages } from "@/lib/content/comparisons";
import { homepageFilm, homepageLearningPaths, learningPathHref } from "@/lib/content/landing";
import { getSubjectPages, subjectPath } from "@/lib/content/subjects";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { localizePath } from "@/lib/i18n/routing";
import { absoluteUrl, defaultSocialImage, socialImage } from "@/lib/seo/config";

const staticLastModified = new Date();

type SitemapEntry = MetadataRoute.Sitemap[number];
type SitemapIndexEntry = {
  loc: string;
  lastModified?: string | Date;
};
type SitemapVideo = NonNullable<SitemapEntry["videos"]>[number];

function isoDurationToSeconds(value: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return undefined;
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function canonicalPathForEntry(entry: SitemapEntry) {
  const url = new URL(entry.url);
  return url.pathname === "/" ? "/" : `${url.pathname}${url.search}`;
}

function languageAlternatesForEntry(entry: SitemapEntry) {
  const path = canonicalPathForEntry(entry);
  const languages = Object.fromEntries(
    supportedLanguages.map((language) => [
      languageConfigs[language].locale,
      absoluteUrl(localizePath(path, language)),
    ]),
  );

  return {
    ...languages,
    "x-default": entry.url,
  };
}

function withLanguageAlternates(
  routes: MetadataRoute.Sitemap,
  language: SupportedLanguage = defaultLanguage,
): MetadataRoute.Sitemap {
  return routes.map((entry) => {
    const path = canonicalPathForEntry(entry);

    return {
      ...entry,
      url: absoluteUrl(localizePath(path, language)),
      alternates: {
        languages: languageAlternatesForEntry(entry),
      },
    };
  });
}

function escapeXml(value: string | number | Date) {
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderTag(name: string, value: string | number | Date | undefined, indent = "    ") {
  if (value === undefined || value === null || value === "") return "";
  return `${indent}<${name}>${escapeXml(value)}</${name}>`;
}

function renderVideo(video: SitemapVideo) {
  const fields = [
    renderTag("video:title", video.title, "      "),
    renderTag("video:thumbnail_loc", video.thumbnail_loc, "      "),
    renderTag("video:description", video.description, "      "),
    renderTag("video:content_loc", video.content_loc, "      "),
    renderTag("video:player_loc", video.player_loc, "      "),
    renderTag("video:duration", video.duration, "      "),
    renderTag("video:tag", video.tag, "      "),
    renderTag("video:publication_date", video.publication_date, "      "),
    renderTag("video:family_friendly", video.family_friendly, "      "),
    renderTag("video:requires_subscription", video.requires_subscription, "      "),
  ];

  if (video.uploader?.content) {
    const info = video.uploader.info ? ` info="${escapeXml(video.uploader.info)}"` : "";
    fields.push(`      <video:uploader${info}>${escapeXml(video.uploader.content)}</video:uploader>`);
  }

  return ["    <video:video>", ...fields.filter(Boolean), "    </video:video>"].join("\n");
}

function renderEntry(entry: SitemapEntry) {
  const alternates = Object.entries(entry.alternates?.languages ?? {})
    .filter((alternate): alternate is [string, string] => Boolean(alternate[1]))
    .map(
      ([language, href]) =>
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(language)}" href="${escapeXml(href)}" />`,
    );
  const images = (entry.images ?? [])
    .filter((image) => image !== defaultSocialImage.url)
    .map(
    (image) => `    <image:image>\n      <image:loc>${escapeXml(image)}</image:loc>\n    </image:image>`,
  );
  const videos = (entry.videos ?? []).map(renderVideo);
  const fields = [
    renderTag("loc", entry.url),
    ...alternates,
    ...images,
    ...videos,
    renderTag("lastmod", entry.lastModified),
    renderTag("changefreq", entry.changeFrequency),
    renderTag("priority", entry.priority),
  ].filter(Boolean);

  return ["  <url>", ...fields, "  </url>"].join("\n");
}

function renderSitemapIndexEntry(entry: SitemapIndexEntry) {
  const fields = [renderTag("loc", entry.loc), renderTag("lastmod", entry.lastModified)].filter(Boolean);
  return ["  <sitemap>", ...fields, "  </sitemap>"].join("\n");
}

export function sitemapFileSlugForLanguage(language: SupportedLanguage | string) {
  const config = languageConfigs[normalizeLanguage(language)];
  return config.prefix || config.locale;
}

export function sitemapFilePathForLanguage(language: SupportedLanguage | string) {
  return `/sitemap/${sitemapFileSlugForLanguage(language)}.xml`;
}

export function sitemapLanguages() {
  return supportedLanguages;
}

export function languageFromSitemapFileSlug(value: string): SupportedLanguage | null {
  const slug = value.trim().replace(/\.xml$/i, "").toLowerCase();
  if (!slug) return null;

  return (
    supportedLanguages.find((language) => {
      const config = languageConfigs[language];
      return (
        slug === language.toLowerCase() ||
        slug === config.locale.toLowerCase() ||
        slug === config.locale.toLowerCase().split("-")[0] ||
        (Boolean(config.prefix) && slug === config.prefix.toLowerCase())
      );
    }) ?? null
  );
}

export function sitemapIndexEntries(): SitemapIndexEntry[] {
  return supportedLanguages.map((language) => ({
    loc: absoluteUrl(sitemapFilePathForLanguage(language)),
    lastModified: staticLastModified,
  }));
}

export default function sitemapEntries(language: SupportedLanguage | string = defaultLanguage): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      lastModified: staticLastModified,
      changeFrequency: "weekly",
      priority: 1,
      images: [absoluteUrl(homepageFilm.thumbnailUrl)],
      videos: [
        {
          title: homepageFilm.title,
          thumbnail_loc: absoluteUrl(homepageFilm.thumbnailUrl),
          description: homepageFilm.description,
          content_loc: absoluteUrl(homepageFilm.contentUrl),
          player_loc: `${absoluteUrl("/")}#learning-film`,
          duration: isoDurationToSeconds(homepageFilm.duration),
          publication_date: homepageFilm.uploadDate,
          family_friendly: "yes",
          requires_subscription: "no",
          uploader: {
            info: absoluteUrl("/about"),
            content: "inspir",
          },
          tag: "free AI learning",
        },
      ],
    },
    {
      url: absoluteUrl("/mission"),
      lastModified: staticLastModified,
      changeFrequency: "monthly",
      priority: 0.8,
      images: [socialImage({ title: "Learning is for everyone", eyebrow: "Mission" }).url],
    },
    { url: absoluteUrl("/about"), lastModified: staticLastModified, changeFrequency: "monthly", priority: 0.75 },
    { url: absoluteUrl("/schools"), lastModified: staticLastModified, changeFrequency: "monthly", priority: 0.75 },
    { url: absoluteUrl("/trust"), lastModified: staticLastModified, changeFrequency: "monthly", priority: 0.74 },
    { url: absoluteUrl("/media"), lastModified: staticLastModified, changeFrequency: "monthly", priority: 0.65 },
    { url: absoluteUrl("/topics"), lastModified: staticLastModified, changeFrequency: "weekly", priority: 0.82 },
    {
      url: absoluteUrl("/subjects"),
      lastModified: staticLastModified,
      changeFrequency: "weekly",
      priority: 0.81,
      images: [socialImage({ title: "AI Tutors by Subject", eyebrow: "Subjects" }).url],
    },
    {
      url: absoluteUrl("/prompts"),
      lastModified: staticLastModified,
      changeFrequency: "weekly",
      priority: 0.8,
      images: [socialImage({ title: "AI Learning Prompt Library", eyebrow: "Prompts" }).url],
    },
    {
      url: absoluteUrl("/ai-learning-map"),
      lastModified: staticLastModified,
      changeFrequency: "weekly",
      priority: 0.81,
      images: [socialImage({ title: "AI Learning Map", eyebrow: "Learning workflows" }).url],
    },
    {
      url: absoluteUrl("/compare"),
      lastModified: staticLastModified,
      changeFrequency: "weekly",
      priority: 0.79,
      images: [socialImage({ title: "AI Tutor Comparisons", eyebrow: "Compare" }).url],
    },
    {
      url: absoluteUrl("/for"),
      lastModified: staticLastModified,
      changeFrequency: "weekly",
      priority: 0.8,
      images: [socialImage({ title: "AI Learning by Audience", eyebrow: "For learners" }).url],
    },
    { url: absoluteUrl("/learn"), lastModified: staticLastModified, changeFrequency: "weekly", priority: 0.78 },
    { url: absoluteUrl("/blog"), lastModified: staticLastModified, changeFrequency: "weekly", priority: 0.7 },
  ];

  const topicRoutes: MetadataRoute.Sitemap = topicSeeds.map((topic) => ({
    url: absoluteUrl(topicPath(topic.slug)),
    lastModified: staticLastModified,
    changeFrequency: "weekly",
    priority: topic.slug === "learn-anything" ? 0.95 : 0.85,
    images: [socialImage({ title: topic.name, eyebrow: "Learning mode", description: topic.description }).url],
  }));

  const blogRoutes: MetadataRoute.Sitemap = getBlogPosts().map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.updated ?? post.date),
    changeFrequency: "monthly",
    priority: 0.68,
    images: [
      post.image ??
        socialImage({
          title: post.title,
          eyebrow: "Learning guide",
          description: post.description,
        }).url,
    ],
  }));

  const blogCategoryRoutes: MetadataRoute.Sitemap = getBlogCategories().map((category) => ({
    url: absoluteUrl(`/blog/category/${category.slug}`),
    lastModified: staticLastModified,
    changeFrequency: "weekly",
    priority: 0.62,
    images: [socialImage({ title: `${category.name} AI Learning Guides`, eyebrow: "Blog theme" }).url],
  }));

  const learningPathRoutes: MetadataRoute.Sitemap = homepageLearningPaths.map((path) => ({
    url: absoluteUrl(learningPathHref(path.slug)),
    lastModified: staticLastModified,
    changeFrequency: "weekly",
    priority: 0.76,
    images: [
      socialImage({
        title: path.seoTitle,
        eyebrow: "Learning path",
        description: path.seoDescription,
      }).url,
    ],
  }));

  const comparisonRoutes: MetadataRoute.Sitemap = getComparisonPages().map((page) => ({
    url: absoluteUrl(comparisonPath(page.slug)),
    lastModified: staticLastModified,
    changeFrequency: "weekly",
    priority: 0.77,
    images: [
      socialImage({
        title: page.seoTitle,
        eyebrow: "Compare",
        description: page.description,
      }).url,
    ],
  }));

  const audienceRoutes: MetadataRoute.Sitemap = getAudiencePages().map((page) => ({
    url: absoluteUrl(audiencePath(page.slug)),
    lastModified: staticLastModified,
    changeFrequency: "weekly",
    priority: 0.79,
    images: [
      socialImage({
        title: page.seoTitle,
        eyebrow: page.eyebrow,
        description: page.description,
      }).url,
    ],
  }));

  const subjectRoutes: MetadataRoute.Sitemap = getSubjectPages().map((page) => ({
    url: absoluteUrl(subjectPath(page.slug)),
    lastModified: staticLastModified,
    changeFrequency: "weekly",
    priority: 0.8,
    images: [
      socialImage({
        title: page.seoTitle,
        eyebrow: page.eyebrow,
        description: page.description,
      }).url,
    ],
  }));

  return withLanguageAlternates(
    [
      ...staticRoutes,
      ...learningPathRoutes,
      ...comparisonRoutes,
      ...audienceRoutes,
      ...subjectRoutes,
      ...topicRoutes,
      ...blogRoutes,
      ...blogCategoryRoutes,
    ],
    normalizeLanguage(language),
  );
}

export function sitemapEntriesForLanguage(language: SupportedLanguage | string) {
  return sitemapEntries(language);
}

export function buildSitemapXml(entries = sitemapEntries()) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.map(renderEntry),
    "</urlset>",
    "",
  ].join("\n");
}

export function buildLanguageSitemapXml(language: SupportedLanguage | string) {
  return buildSitemapXml(sitemapEntriesForLanguage(language));
}

export function buildSitemapIndexXml(entries = sitemapIndexEntries()) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(renderSitemapIndexEntry),
    "</sitemapindex>",
    "",
  ].join("\n");
}
