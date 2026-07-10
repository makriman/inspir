import type { Metadata } from "next";
import {
  generateLearningPathsMetadata,
  LearningPathsPageContent,
} from "@/components/marketing/pages/LearningPathsMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/learn");
}

type LocalizedLearningPathsPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedLearningPathsPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateLearningPathsMetadata(language);
}

export default async function LocalizedLearningPathsPage({ params }: LocalizedLearningPathsPageProps) {
  const language = await resolveLocaleParam(params);
  return <LearningPathsPageContent language={language} pathname="/learn" />;
}
