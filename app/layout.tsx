import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import {
  metadataAlternates,
  socialImage,
  siteDescription,
  siteName,
  siteTitle,
  siteUrl,
} from "@/lib/seo/config";
import {
  organizationJsonLd,
  serializeJsonLd,
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

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: "%s | inspir",
  },
  description: siteDescription,
  applicationName: siteName,
  creator: siteName,
  publisher: siteName,
  keywords: [
    "AI tutor",
    "free AI learning",
    "Socratic AI tutor",
    "AI homework coach",
    "AI flashcards",
    "AI quiz generator",
    "learn anything",
  ],
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
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
  const jsonLd = [organizationJsonLd(), websiteJsonLd(), webApplicationJsonLd()];

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-black text-white">
        {jsonLd.map((entry, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }}
          />
        ))}
        {children}
      </body>
    </html>
  );
}
