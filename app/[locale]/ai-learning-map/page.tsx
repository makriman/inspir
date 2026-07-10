import type { Metadata } from "next";
import {
  AiLearningMapPageContent,
  generateAiLearningMapMetadata,
} from "@/components/marketing/pages/AiLearningMapMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/ai-learning-map");
}

type LocalizedAiLearningMapPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedAiLearningMapPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateAiLearningMapMetadata(language);
}

export default async function LocalizedAiLearningMapPage({ params }: LocalizedAiLearningMapPageProps) {
  const language = await resolveLocaleParam(params);
  return <AiLearningMapPageContent language={language} pathname="/ai-learning-map" />;
}
