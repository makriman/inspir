import type { Metadata } from "next";
import { ContentPage } from "@/components/legal/ContentPage";
import { extractedPages } from "@/lib/content/extracted-pages";

export const metadata: Metadata = {
  title: "Privacy Policy",
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return <ContentPage title="Privacy Policy" blocks={extractedPages.privacy} />;
}
