import type { Metadata } from "next";
import {
  generateLandingMetadata,
  LandingPageContent,
} from "@/components/marketing/pages/LandingMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "./locale-utils";

type LocalizedLandingPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedLandingPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateLandingMetadata(language);
}

export default async function LocalizedLandingPage({ params }: LocalizedLandingPageProps) {
  const language = await resolveLocaleParam(params);
  return <LandingPageContent language={language} pathname="/" />;
}
