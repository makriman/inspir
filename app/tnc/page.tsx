import type { Metadata } from "next";
import { TermsAndConditionsContent, termsDescription } from "@/components/legal/TermsAndConditionsContent";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";

const pageMetadata: Metadata = {
  title: "Terms And Conditions",
  description: termsDescription,
  alternates: metadataAlternates("/terms"),
  robots: { index: false, follow: true },
  openGraph: {
    title: "Terms And Conditions | inspir",
    description: termsDescription,
    url: "/terms",
    siteName,
    images: [
      socialImage({
        title: "Terms And Conditions",
        eyebrow: "Terms",
        description: termsDescription,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms And Conditions | inspir",
    description: termsDescription,
    images: [
      socialImage({
        title: "Terms And Conditions",
        eyebrow: "Terms",
        description: termsDescription,
      }).url,
    ],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/terms");
}

export default function TermsAndConditionsPage() {
  return <TermsAndConditionsContent path="/terms" />;
}
