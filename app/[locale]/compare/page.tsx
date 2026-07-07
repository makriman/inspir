import type { Metadata } from "next";
import {
  ComparePageContent,
  generateCompareMetadata,
} from "@/components/marketing/pages/CompareMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = 3600;

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
