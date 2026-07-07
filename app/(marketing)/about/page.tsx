import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  AboutPageContent,
  generateAboutMetadata,
} from "@/components/marketing/pages/AboutMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateAboutMetadata(defaultLanguage);
}

export default function AboutPage() {
  return <AboutPageContent language={defaultLanguage} pathname="/about" />;
}
