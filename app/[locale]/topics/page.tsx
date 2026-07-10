import type { Metadata } from "next";
import {
  generateTopicsMetadata,
  TopicsPageContent,
} from "@/components/marketing/pages/TopicsMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/topics");
}

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
