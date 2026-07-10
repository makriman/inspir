import type { Metadata } from "next";
import {
  generateMediaMetadata,
  MediaPageContent,
} from "@/components/marketing/pages/MediaMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/media");
}

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
