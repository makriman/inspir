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

const privacyDescription =
  "How inspir describes data use, privacy practices, and user rights for the public learning platform.";

const pageMetadata: Metadata = {
  title: "Privacy Policy",
  description: privacyDescription,
  robots: { index: false, follow: true },
  openGraph: {
    title: "Privacy Policy | inspir",
    description: privacyDescription,
    url: "/privacy",
    siteName,
    images: [
      socialImage({
        title: "Privacy Policy",
        eyebrow: "Privacy",
        description: privacyDescription,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Policy | inspir",
    description: privacyDescription,
    images: [
      socialImage({
        title: "Privacy Policy",
        eyebrow: "Privacy",
        description: privacyDescription,
      }).url,
    ],
  },
};

function generatePrivacyMetadata(language: SupportedLanguage) {
  return localizeMarketingMetadataForLanguage(
    pageMetadata,
    "/privacy",
    language,
  );
}

export function PrivacyPolicyContent({
  language = defaultLanguage,
  chrome,
}: {
  language?: SupportedLanguage;
  chrome?: MarketingChrome;
}) {
  return (
    <ContentPage
      title="Privacy Policy"
      blocks={extractedPages.privacy}
      description={privacyDescription}
      eyebrow="Privacy"
      path="/privacy"
      language={language}
      chrome={chrome}
    />
  );
}

PrivacyPolicyContent.generateMetadata = generatePrivacyMetadata;
