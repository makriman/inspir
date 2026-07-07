import type { Metadata } from "next";
import {
  generateSchoolsMetadata,
  SchoolsPageContent,
} from "@/components/marketing/pages/SchoolsMarketingPage";
import { resolveLocaleParam, type LocaleRouteParams } from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = 3600;

type LocalizedSchoolsPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({ params }: LocalizedSchoolsPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return generateSchoolsMetadata(language);
}

export default async function LocalizedSchoolsPage({ params }: LocalizedSchoolsPageProps) {
  const language = await resolveLocaleParam(params);
  return <SchoolsPageContent language={language} pathname="/schools" />;
}
