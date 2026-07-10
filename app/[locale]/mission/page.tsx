import type { Metadata } from "next";
import {
  generateMissionMetadata,
  MissionPageContent,
} from "@/components/marketing/pages/MissionMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/mission");
}

type LocalizedMissionPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedMissionPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateMissionMetadata(language);
}

export default async function LocalizedMissionPage({ params }: LocalizedMissionPageProps) {
  const language = await resolveLocaleParam(params);
  return <MissionPageContent language={language} pathname="/mission" />;
}
