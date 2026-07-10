import type { Metadata } from "next";
import {
  generateTrustMetadata,
  TrustPageContent,
} from "@/components/marketing/pages/TrustMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/trust");
}

type LocalizedTrustPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedTrustPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateTrustMetadata(language);
}

export default async function LocalizedTrustPage({ params }: LocalizedTrustPageProps) {
  const language = await resolveLocaleParam(params);
  return <TrustPageContent language={language} pathname="/trust" />;
}
