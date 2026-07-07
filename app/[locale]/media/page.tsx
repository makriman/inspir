import type { Metadata } from "next";
import {
  generateMediaMetadata,
  MediaPageContent,
} from "@/components/marketing/pages/MediaMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

type LocalizedMediaPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedMediaPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateMediaMetadata(language);
}

export default async function LocalizedMediaPage({ params }: LocalizedMediaPageProps) {
  const language = await resolveLocaleParam(params);
  return <MediaPageContent language={language} pathname="/media" />;
}
