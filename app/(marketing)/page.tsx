import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateLandingMetadata,
  LandingPageContent,
} from "@/components/marketing/pages/LandingMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateLandingMetadata(defaultLanguage);
}

export default function LandingPage() {
  return <LandingPageContent language={defaultLanguage} pathname="/" />;
}
