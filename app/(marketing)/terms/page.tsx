import type { Metadata } from "next";
import { TermsAndConditionsContent, termsDescription } from "@/components/legal/TermsAndConditionsContent";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { siteName, socialImage } from "@/lib/seo/config";

const pageMetadata: Metadata = {
  title: "Terms",
  description: termsDescription,
  robots: { index: false, follow: true },
  openGraph: {
    title: "Terms | inspir",
    description: termsDescription,
    url: "/terms",
    siteName,
    images: [socialImage({ title: "Terms", eyebrow: "Terms", description: termsDescription })],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms | inspir",
    description: termsDescription,
    images: [socialImage({ title: "Terms", eyebrow: "Terms", description: termsDescription }).url],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/terms");
}

export default function TermsPage() {
  return <TermsAndConditionsContent path="/terms" />;
}
