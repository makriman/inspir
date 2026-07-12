import type { Metadata, Viewport } from "next";
import "../../globals.css";
import "katex/dist/katex.min.css";
import { Suspense } from "react";
import { AnalyticsScripts } from "@/components/analytics/AnalyticsScripts";
import { ProductAnalytics } from "@/components/analytics/ProductAnalytics";
import { StaticDocumentNavigation } from "@/components/navigation/StaticDocumentNavigation";
import { languageConfigs } from "@/lib/content/languages";
import { siteName, siteUrl } from "@/lib/seo/config";
import { cn } from "@/lib/utils";
import { Geist } from "next/font/google";
import {
  resolveLocaleParam,
  type LocaleRouteParams,
} from "../../[locale]/locale-utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Chat | inspir",
  applicationName: siteName,
  robots: { index: false, follow: true, nocache: true },
  alternates: {},
  keywords: [],
  icons: {
    icon: [
      { url: "/inspir-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/inspir-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/inspir-app-icon-192.png",
    apple: [{ url: "/inspir-app-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  formatDetection: { email: false, address: false, telephone: false },
  other: {},
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf8" },
    { media: "(prefers-color-scheme: dark)", color: "#171614" },
  ],
  colorScheme: "light dark",
};

export default async function LocalizedWorkspaceLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: LocaleRouteParams }>) {
  const language = await resolveLocaleParam(params);
  const languageConfig = languageConfigs[language];

  return (
    <html
      lang={languageConfig.locale}
      dir={languageConfig.dir}
      className={cn("h-full antialiased", "font-sans", geist.variable)}
    >
      <body className="min-h-full bg-[#171614] text-white">
        <StaticDocumentNavigation />
        <AnalyticsScripts automaticPageViews={false} />
        <Suspense fallback={null}>
          <ProductAnalytics />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
