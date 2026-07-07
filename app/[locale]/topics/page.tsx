import type { Metadata } from "next";
import {
  generateTopicsMetadata,
  TopicsPageContent,
} from "@/components/marketing/pages/TopicsMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = 3600;

type LocalizedTopicsPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedTopicsPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateTopicsMetadata(language);
}

export default async function LocalizedTopicsPage({ params }: LocalizedTopicsPageProps) {
  const language = await resolveLocaleParam(params);
  return <TopicsPageContent language={language} pathname="/topics" />;
}
