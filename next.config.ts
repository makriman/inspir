import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security/headers";

import("@opennextjs/cloudflare").then((module) => module.initOpenNextCloudflareForDev());

const contentTraceFiles = [
  "./content/blog/**/*.md",
  "./lib/content/**/*.ts",
];

const siteTranslationTraceFiles = [
  "./app/**/*.ts",
  "./app/**/*.tsx",
  "./components/marketing/**/*.tsx",
  "./components/legal/**/*.tsx",
  "./lib/content/**/*.ts",
  "./lib/seo/config.ts",
  "./lib/seo/json-ld.ts",
  "./content/blog/**/*.md",
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  experimental: {
    globalNotFound: true,
  },
  outputFileTracingIncludes: {
    "/": siteTranslationTraceFiles,
    "/about": siteTranslationTraceFiles,
    "/ai-learning-map": siteTranslationTraceFiles,
    "/blog/:path*": siteTranslationTraceFiles,
    "/compare/:path*": siteTranslationTraceFiles,
    "/for/:path*": siteTranslationTraceFiles,
    "/learn/:path*": siteTranslationTraceFiles,
    "/media": siteTranslationTraceFiles,
    "/mission": siteTranslationTraceFiles,
    "/privacy": siteTranslationTraceFiles,
    "/prompts": siteTranslationTraceFiles,
    "/schools": siteTranslationTraceFiles,
    "/subjects/:path*": siteTranslationTraceFiles,
    "/terms": siteTranslationTraceFiles,
    "/topics": siteTranslationTraceFiles,
    "/trust": siteTranslationTraceFiles,
    "/rss.xml": contentTraceFiles,
    "/sitemap/:path*": contentTraceFiles,
    "/llms.txt": contentTraceFiles,
    "/llms-full.txt": contentTraceFiles,
    "/ai-content-index.json": contentTraceFiles,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
        port: "",
        pathname: "/**",
        search: "",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/tnc",
        destination: "/terms",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/sitemap.xml",
        destination: "/sitemap",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...staticSecurityHeaders],
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
      {
        source: "/reset_pw",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
      {
        source: "/media/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/inspir-social-preview.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
