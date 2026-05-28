import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/seo/config";

const publicDisallow = ["/api/", "/admin/", "/reset_pw"];
const aiSearchCrawlers = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: ["GPTBot", "ClaudeBot"],
        disallow: "/",
      },
      {
        userAgent: aiSearchCrawlers,
        allow: "/",
        disallow: publicDisallow,
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: publicDisallow,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl,
  };
}
