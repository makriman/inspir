import type { Metadata } from "next";
import { PrivacyPolicyContent } from "@/components/legal/PrivacyPolicyContent";
import { getStaticMarketingChrome } from "@/lib/i18n/marketing-chrome";
import {
  generateLocalizedStaticParams,
  resolveLocaleParam,
  type LocaleRouteParams,
} from "../locale-utils";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/privacy");
}

type LocalizedPrivacyPageProps = {
  params: LocaleRouteParams;
};

export async function generateMetadata({
  params,
}: LocalizedPrivacyPageProps): Promise<Metadata> {
  const language = await resolveLocaleParam(params);
  return PrivacyPolicyContent.generateMetadata(language);
}

export default async function LocalizedPrivacyPage({
  params,
}: LocalizedPrivacyPageProps) {
  const language = await resolveLocaleParam(params);
  const chrome = await getStaticMarketingChrome("/privacy", language);
  return <PrivacyPolicyContent language={language} chrome={chrome} />;
}
