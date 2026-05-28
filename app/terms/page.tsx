import type { Metadata } from "next";
import { TermsAndConditionsContent, termsDescription } from "@/components/legal/TermsAndConditionsContent";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";

export const metadata: Metadata = {
  title: "Terms",
  description: termsDescription,
  alternates: metadataAlternates("/terms"),
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

export default function TermsPage() {
  return <TermsAndConditionsContent path="/terms" />;
}
