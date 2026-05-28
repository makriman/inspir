import type { MetadataRoute } from "next";
import { audiencePath, getAudiencePages } from "@/lib/content/audiences";
import { getBlogCategories, getBlogPosts } from "@/lib/content/blog";
import { comparisonPath, getComparisonPages } from "@/lib/content/comparisons";
import { homepageFilm, homepageLearningPaths, learningPathHref } from "@/lib/content/landing";
import { getSubjectPages, subjectPath } from "@/lib/content/subjects";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { absoluteUrl, socialImage } from "@/lib/seo/config";

const staticLastModified = new Date("2026-05-28T00:00:00.000Z");

function isoDurationToSeconds(value: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return undefined;
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export default function sitemap(): MetadataRoute.Sitemap {
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

  return [
    ...staticRoutes,
    ...learningPathRoutes,
    ...comparisonRoutes,
    ...audienceRoutes,
    ...subjectRoutes,
    ...topicRoutes,
    ...blogRoutes,
    ...blogCategoryRoutes,
  ];
}
