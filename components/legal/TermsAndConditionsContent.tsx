import type { Metadata } from "next";
import { ContentPage } from "@/components/legal/ContentPage";
import {
  defaultLanguage,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { extractedPages } from "@/lib/content/extracted-pages";
import type { MarketingChrome } from "@/lib/i18n/marketing-chrome";
import { localizeMarketingMetadataForLanguage } from "@/lib/i18n/metadata";
import { siteName, socialImage } from "@/lib/seo/config";

const termsDescription =
  "The terms that describe acceptable use, account responsibilities, and public service conditions for inspir.";

const pageMetadata: Metadata = {
  title: "Terms",
  description: termsDescription,
  robots: { index: false, follow: true },
  openGraph: {
    title: "Terms | inspir",
    description: termsDescription,
    url: "/terms",
    siteName,
    images: [
      socialImage({
        title: "Terms",
        eyebrow: "Terms",
        description: termsDescription,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms | inspir",
    description: termsDescription,
    images: [
      socialImage({
        title: "Terms",
        eyebrow: "Terms",
        description: termsDescription,
      }).url,
    ],
  },
};

function generateTermsMetadata(language: SupportedLanguage) {
  return localizeMarketingMetadataForLanguage(pageMetadata, "/terms", language);
}

export function TermsAndConditionsContent({
  path = "/terms",
  language = defaultLanguage,
  chrome,
}: {
  path?: string;
  language?: SupportedLanguage;
  chrome?: MarketingChrome;
}) {
  return (
    <ContentPage
      title="Terms And Conditions"
      blocks={extractedPages.tnc}
      description={termsDescription}
      eyebrow="Terms"
      path={path}
      language={language}
      chrome={chrome}
      relatedLinks={[
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/mission", label: "Mission" },
        { href: "/topics", label: "Learning modes" },
      ]}
    />
  );
}

TermsAndConditionsContent.generateMetadata = generateTermsMetadata;
