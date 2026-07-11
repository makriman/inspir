import { StaticGuestChatPage } from "@/components/chat/StaticGuestChatPage";
import { defaultLanguage, languageConfigs, supportedLanguages } from "@/lib/content/languages";
import {
  resolveLocaleParam,
  type LocaleRouteParams,
} from "../../../[locale]/locale-utils";

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
  return supportedLanguages.reduce<Array<{ locale: string }>>((params, language) => {
    if (language !== defaultLanguage) params.push({ locale: languageConfigs[language].prefix });
    return params;
  }, []);
}

export default async function LocalizedChatPage({ params }: { params: LocaleRouteParams }) {
  const language = await resolveLocaleParam(params);
  return <StaticGuestChatPage language={language} />;
}
