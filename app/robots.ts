import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/seo/config";

const publicDisallow = ["/api/", "/admin/", "/reset_pw"];
const aiDiscoveryCrawlers = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "Applebot",
  "Google-Extended",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: aiDiscoveryCrawlers,
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
