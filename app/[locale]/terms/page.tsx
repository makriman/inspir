import type { Metadata } from "next";
import { TermsAndConditionsContent } from "@/components/legal/TermsAndConditionsContent";
import { getStaticMarketingChrome } from "@/lib/i18n/marketing-chrome";
import {
  generateLocalizedStaticParams,
  resolveLocaleParam,
  type LocaleRouteParams,
} from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/terms");
}

type LocalizedTermsPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({
  params,
}: LocalizedTermsPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return TermsAndConditionsContent.generateMetadata(language);
}

export default async function LocalizedTermsPage({
  params,
}: LocalizedTermsPageProps) {
  const language = await resolveLocaleParam(params);
  const chrome = await getStaticMarketingChrome("/terms", language);
  return (
    <TermsAndConditionsContent
      path="/terms"
      language={language}
      chrome={chrome}
    />
  );
}
