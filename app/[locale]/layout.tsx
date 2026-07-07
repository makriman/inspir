import type { Metadata, Viewport } from "next";
import "../globals.css";
import { Suspense } from "react";
import { AnalyticsScripts } from "@/components/analytics/AnalyticsScripts";
import { ProductAnalytics } from "@/components/analytics/ProductAnalytics";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { languageConfigs } from "@/lib/content/languages";
import { localizedMarketingMetadataForLanguage } from "@/lib/i18n/metadata";
import {
  absoluteUrl,
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
import { cn } from "@/lib/utils";
import { Geist } from "next/font/google";
import { resolveLocaleParam, type LocaleRouteParams } from "./locale-utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const rootJsonLd = [organizationJsonLd(), websiteJsonLd(), webApplicationJsonLd(), siteNavigationJsonLd()];

export const dynamic = "force-static";
export const revalidate = 3600;

type LocalizedLayoutProps = Readonly<{
  children: React.ReactNode;
  params: LocaleRouteParams;
}>;

export function generateStaticParams(): Array<{ locale: string }> {
  // Locale HTML is generated into OpenNext's R2 ISR cache on first request, when D1 translations are available.
  return [];
}

export async function generateMetadata({ params }: { params: LocaleRouteParams }): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  const localized = await localizedMarketingMetadataForLanguage(
    {
      path: "/",
      title: siteTitle,
      description: siteDescription,
      openGraphTitle: siteTitle,
      openGraphDescription: siteDescription,
      imageTitle: "Free AI learning for everyone",
      imageEyebrow: "inspir",
      imageDescription: siteDescription,
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
    },
    language,
  );

  return {
    ...localized,
    metadataBase: new URL(siteUrl),
    title: {
      default: typeof localized.title === "string" ? localized.title : siteTitle,
      template: "%s | inspir",
    },
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
    manifest: "/manifest.webmanifest",
    verification: siteVerificationMetadata(),
    other: {
      "llms-txt": absoluteUrl("/llms.txt"),
      "llms-full": absoluteUrl("/llms-full.txt"),
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf8" },
    { media: "(prefers-color-scheme: dark)", color: "#171614" },
  ],
  colorScheme: "light dark",
};

export default async function LocalizedLayout({ children, params }: LocalizedLayoutProps) {
  const language = await resolveLocaleParam(params);
  const languageConfig = languageConfigs[language];

  return (
    <html lang={languageConfig.locale} dir={languageConfig.dir} className={cn("h-full antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full bg-[#171614] text-white">
        <AnalyticsScripts />
        <Suspense fallback={null}>
          <ProductAnalytics />
        </Suspense>
        <JsonLdScripts items={rootJsonLd} language={language} />
        {children}
        <PwaInstallPrompt />
      </body>
    </html>
  );
}

function siteVerificationMetadata(): Metadata["verification"] | undefined {
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  if (!google && !bing) return undefined;

  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}
