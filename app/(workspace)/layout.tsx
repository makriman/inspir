import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "../globals.css";
import { Suspense } from "react";
import { AnalyticsScripts } from "@/components/analytics/AnalyticsScripts";
import { ProductAnalytics } from "@/components/analytics/ProductAnalytics";
import { StaticDocumentNavigation } from "@/components/navigation/StaticDocumentNavigation";
import { Geist } from "next/font/google";
import { languageConfigs } from "@/lib/content/languages";
import { siteName, siteUrl } from "@/lib/seo/config";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const dynamic = "force-static";
export const revalidate = false;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Chat | inspir",
    template: "%s | inspir",
  },
  description: "Private inspir chat workspace.",
  applicationName: siteName,
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  keywords: [],
  alternates: {},
  icons: {
    icon: [
      { url: "/inspir-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/inspir-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/inspir-app-icon-192.png",
    apple: [{ url: "/inspir-app-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: "Chat | inspir",
    description: "Private inspir chat workspace.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Chat | inspir",
    description: "Private inspir chat workspace.",
  },
  other: {},
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf8" },
    { media: "(prefers-color-scheme: dark)", color: "#171614" },
  ],
  colorScheme: "light dark",
};

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const languageConfig = languageConfigs.English;
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
