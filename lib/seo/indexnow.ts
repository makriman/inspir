import { absoluteUrl } from "@/lib/seo/config";

export const indexNowKey = "557eacaad4a08888b546f7a9c43c6258";
const indexNowKeyPath = `/${indexNowKey}.txt`;
export const indexNowKeyLocation = absoluteUrl(indexNowKeyPath);

export const indexNowReleaseUrls = [
  "/",
  "/about",
  "/media",
  "/mission",
  "/schools",
  "/trust",
  "/topics",
  "/subjects",
  "/prompts",
  "/ai-learning-map",
  "/compare",
  "/for",
  "/learn",
  "/blog",
  "/sitemap.xml",
  "/llms.txt",
  "/llms-full.txt",
  "/ai-content-index.json",
] as const;
