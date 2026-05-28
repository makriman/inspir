import type { Metadata } from "next";
import { TermsAndConditionsContent, termsDescription } from "@/components/legal/TermsAndConditionsContent";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";

export const metadata: Metadata = {
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

export default function TermsAndConditionsPage() {
  return <TermsAndConditionsContent path="/terms" />;
}
