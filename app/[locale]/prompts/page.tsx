import type { Metadata } from "next";
import {
  generatePromptsMetadata,
  PromptsPageContent,
} from "@/components/marketing/pages/PromptsMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = 3600;

type LocalizedPromptsPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedPromptsPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generatePromptsMetadata(language);
}

export default async function LocalizedPromptsPage({ params }: LocalizedPromptsPageProps) {
  const language = await resolveLocaleParam(params);
  return <PromptsPageContent language={language} pathname="/prompts" />;
}
