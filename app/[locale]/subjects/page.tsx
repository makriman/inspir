import type { Metadata } from "next";
import {
  generateSubjectsMetadata,
  SubjectsPageContent,
} from "@/components/marketing/pages/SubjectsMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

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
