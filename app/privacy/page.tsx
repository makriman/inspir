import type { Metadata } from "next";
import { ContentPage } from "@/components/legal/ContentPage";
import { extractedPages } from "@/lib/content/extracted-pages";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";

const description =
  "How inspir describes data use, privacy practices, and user rights for the public learning platform.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description,
  alternates: metadataAlternates("/privacy"),
  robots: { index: false, follow: true },
  openGraph: {
    title: "Privacy Policy | inspir",
    description,
    url: "/privacy",
    siteName,
    images: [socialImage({ title: "Privacy Policy", eyebrow: "Privacy", description })],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Policy | inspir",
    description,
    images: [socialImage({ title: "Privacy Policy", eyebrow: "Privacy", description }).url],
  },
};

export default function PrivacyPage() {
  return (
    <ContentPage
      title="Privacy Policy"
      blocks={extractedPages.privacy}
      description={description}
      eyebrow="Privacy"
      path="/privacy"
    />
  );
}
