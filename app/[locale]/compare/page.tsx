import type { Metadata } from "next";
import {
  ComparePageContent,
  generateCompareMetadata,
} from "@/components/marketing/pages/CompareMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/compare");
}

type LocalizedComparePageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedComparePageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateCompareMetadata(language);
}

export default async function LocalizedComparePage({ params }: LocalizedComparePageProps) {
  const language = await resolveLocaleParam(params);
  return <ComparePageContent language={language} pathname="/compare" />;
}
