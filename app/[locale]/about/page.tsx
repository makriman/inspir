import type { Metadata } from "next";
import {
  AboutPageContent,
  generateAboutMetadata,
} from "@/components/marketing/pages/AboutMarketingPage";
import { generateLocalizedStaticParams, resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/about");
}

type LocalizedAboutPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedAboutPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateAboutMetadata(language);
}

export default async function LocalizedAboutPage({ params }: LocalizedAboutPageProps) {
  const language = await resolveLocaleParam(params);
  return <AboutPageContent language={language} pathname="/about" />;
}
