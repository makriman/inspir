import type { Metadata } from "next";
import {
  AudiencePageContent,
  generateAudienceMetadata,
} from "@/components/marketing/pages/AudienceMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = 3600;

type LocalizedAudiencePageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedAudiencePageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateAudienceMetadata(language);
}

export default async function LocalizedAudiencePage({ params }: LocalizedAudiencePageProps) {
  const language = await resolveLocaleParam(params);
  return <AudiencePageContent language={language} pathname="/for" />;
}
