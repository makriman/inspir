import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  generateLearningPathsMetadata,
  LearningPathsPageContent,
} from "@/components/marketing/pages/LearningPathsMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateLearningPathsMetadata(defaultLanguage);
}

export default function LearningPathsPage() {
  return <LearningPathsPageContent language={defaultLanguage} pathname="/learn" />;
}
