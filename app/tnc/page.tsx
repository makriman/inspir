import type { Metadata } from "next";
import { ContentPage } from "@/components/legal/ContentPage";
import { extractedPages } from "@/lib/content/extracted-pages";

export const metadata: Metadata = {
  title: "Terms And Conditions",
  robots: { index: false, follow: true },
};

export default function TermsAndConditionsPage() {
  return <ContentPage title="Terms And Conditions" blocks={extractedPages.tnc} />;
}
