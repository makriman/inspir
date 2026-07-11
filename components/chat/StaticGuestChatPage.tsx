import { StaticGuestChatBootstrap } from "@/components/chat/StaticGuestChatBootstrap";
import {
  defaultLanguage,
  languageConfigs,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { defaultTopicSlug } from "@/lib/content/topics";
import { getCuratedMainAppTranslationBundle } from "@/lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "@/lib/i18n/main-app-static-asset";

export function StaticGuestChatPage({ language = defaultLanguage }: { language?: SupportedLanguage }) {
  const bundle = getCuratedMainAppTranslationBundle(language);
  if (!bundle) throw new Error(`The static guest chat translation bundle is incomplete for ${language}.`);
  const config = languageConfigs[language];
  const locale = config.prefix || config.locale;
  const asset = buildStaticMainAppBundleAsset(locale, bundle);

  return (
    <StaticGuestChatBootstrap
      language={language}
      defaultTopicId={defaultTopicSlug}
      translationBundleUrl={asset.publicPath}
      translationSourceHash={asset.sourceHash}
    />
  );
}
