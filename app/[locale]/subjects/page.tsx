import type { Metadata } from "next";
import {
  generateSubjectsMetadata,
  SubjectsPageContent,
} from "@/components/marketing/pages/SubjectsMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = 3600;

type LocalizedSubjectsPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedSubjectsPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateSubjectsMetadata(language);
}

export default async function LocalizedSubjectsPage({ params }: LocalizedSubjectsPageProps) {
  const language = await resolveLocaleParam(params);
  return <SubjectsPageContent language={language} pathname="/subjects" />;
}
