import type { NextConfig } from "next";

import("@opennextjs/cloudflare").then((module) => module.initOpenNextCloudflareForDev());

const securityHeaders = [
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://*.googleusercontent.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://api.openai.com",
    ].join("; "),
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
];

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
    "/api/site-translations": siteTranslationTraceFiles,
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
        headers: securityHeaders,
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
