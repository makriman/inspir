import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { MarketingServerLocalizer } from "@/components/i18n/MarketingServerLocalizer";
import { getRequestLanguageConfig, getRequestPathname } from "@/lib/i18n/request-locale";
import { localizedMarketingMetadata, localizeMarketingStructuredData } from "@/lib/i18n/metadata";
import { isChatAppPath } from "@/lib/routes/chat-path";
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
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const rootJsonLd = [organizationJsonLd(), websiteJsonLd(), webApplicationJsonLd(), siteNavigationJsonLd()];

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const pathname = await getRequestPathname();
  const isChatApp = isChatAppPath(pathname);

  if (isChatApp) {
    return {
      metadataBase: new URL(siteUrl),
      title: {
        default: "Chat | inspir",
        template: "%s | inspir",
      },
      applicationName: siteName,
      manifest: "/manifest.webmanifest",
      icons: {
        icon: [
          { url: "/inspir-app-icon-192.png", sizes: "192x192", type: "image/png" },
          { url: "/inspir-app-icon-512.png", sizes: "512x512", type: "image/png" },
        ],
        shortcut: "/inspir-app-icon-192.png",
        apple: [{ url: "/inspir-app-icon-180.png", sizes: "180x180", type: "image/png" }],
      },
      formatDetection: {
        email: false,
        address: false,
        telephone: false,
      },
    };
  }

  const localized = await localizedMarketingMetadata({
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
  });

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
    other: {
      "ai-content-index": absoluteUrl("/ai-content-index.json"),
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [languageConfig, pathname] = await Promise.all([getRequestLanguageConfig(), getRequestPathname()]);
  const isChatApp = isChatAppPath(pathname);
  const localizedRootJsonLd = isChatApp ? [] : await localizeMarketingStructuredData(rootJsonLd, pathname);
  return (
    <html lang={languageConfig.locale} dir={languageConfig.dir} className={cn("h-full antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full bg-[#171614] text-white">
        {isChatApp ? null : <JsonLdScripts items={localizedRootJsonLd} />}
        {isChatApp ? children : <MarketingServerLocalizer>{children}</MarketingServerLocalizer>}
        {isChatApp ? null : <PwaInstallPrompt />}
      </body>
    </html>
  );
}
