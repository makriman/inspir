import type { MetadataRoute } from "next";
import { getBlogCategories, getBlogPosts } from "@/lib/content/blog";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { absoluteUrl, socialImage } from "@/lib/seo/config";

const staticLastModified = new Date("2026-05-28T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: staticLastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: absoluteUrl("/mission"),
      lastModified: staticLastModified,
      changeFrequency: "monthly",
      priority: 0.8,
      images: [socialImage({ title: "Learning is for everyone", eyebrow: "Mission" }).url],
    },
    { url: absoluteUrl("/about"), lastModified: staticLastModified, changeFrequency: "monthly", priority: 0.75 },
    { url: absoluteUrl("/schools"), lastModified: staticLastModified, changeFrequency: "monthly", priority: 0.75 },
    { url: absoluteUrl("/media"), lastModified: staticLastModified, changeFrequency: "monthly", priority: 0.65 },
    { url: absoluteUrl("/topics"), lastModified: staticLastModified, changeFrequency: "weekly", priority: 0.82 },
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

  return [...staticRoutes, ...topicRoutes, ...blogRoutes, ...blogCategoryRoutes];
}
