import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  ComparePageContent,
  generateCompareMetadata,
} from "@/components/marketing/pages/CompareMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateCompareMetadata(defaultLanguage);
}

export default function ComparePage() {
  return <ComparePageContent language={defaultLanguage} pathname="/compare" />;
}
