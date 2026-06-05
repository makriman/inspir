import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  absoluteUrl,
  metadataAlternates,
  socialImage,
  siteDescription,
  siteName,
  siteTitle,
  siteUrl,
} from "@/lib/seo/config";
import {
  organizationJsonLd,
  siteNavigationJsonLd,
  webApplicationJsonLd,
  websiteJsonLd,
} from "@/lib/seo/json-ld";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const rootSocialImage = socialImage({
  title: "Free AI learning for everyone",
  eyebrow: "inspir",
  description: siteDescription,
});

const rootJsonLd = [organizationJsonLd(), websiteJsonLd(), webApplicationJsonLd(), siteNavigationJsonLd()];

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: "%s | inspir",
  },
  description: siteDescription,
  applicationName: siteName,
  authors: [{ name: siteName, url: siteUrl }],
  creator: siteName,
  publisher: siteName,
  category: "education",
  referrer: "origin-when-cross-origin",
  keywords: [
    "AI tutor",
    "free AI tutor",
    "free AI learning",
    "AI learning companion",
    "Socratic AI tutor",
    "AI homework coach",
    "AI study planner",
    "AI flashcards",
    "AI quiz generator",
    "AI writing coach",
    "AI code tutor",
    "learn anything",
  ],
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/inspir-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/inspir-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/inspir-app-icon-192.png",
    apple: [{ url: "/inspir-app-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: "/",
    siteName,
    images: [rootSocialImage],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [rootSocialImage.url],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: metadataAlternates("/"),
  manifest: "/manifest.webmanifest",
  other: {
    "ai-content-index": absoluteUrl("/ai-content-index.json"),
    "llms-txt": absoluteUrl("/llms.txt"),
    "llms-full": absoluteUrl("/llms-full.txt"),
    "content-language": "en-US",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf8" },
    { media: "(prefers-color-scheme: dark)", color: "#171614" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#171614] text-white">
        <JsonLdScripts items={rootJsonLd} />
        {children}
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
