import type { Metadata } from "next";
import { defaultLanguage } from "@/lib/content/languages";
import {
  AiLearningMapPageContent,
  generateAiLearningMapMetadata,
} from "@/components/marketing/pages/AiLearningMapMarketingPage";

export const dynamic = "force-static";
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return generateAiLearningMapMetadata(defaultLanguage);
}

export default function AiLearningMapPage() {
  return <AiLearningMapPageContent language={defaultLanguage} pathname="/ai-learning-map" />;
}
