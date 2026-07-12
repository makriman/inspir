import { StaticGuestChatBootstrap } from "@/components/chat/StaticGuestChatBootstrap";
import {
  defaultLanguage,
  languageConfigs,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { defaultTopicSlug } from "@/lib/content/topics";
import { getCuratedMainAppTranslationBundle } from "@/lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "@/lib/i18n/main-app-static-asset";
import { createTranslationLookup } from "@/lib/i18n/translation-lookup";

export function StaticGuestChatPage({ language = defaultLanguage }: { language?: SupportedLanguage }) {
  const bundle = getCuratedMainAppTranslationBundle(language);
  if (!bundle) throw new Error(`The static guest chat translation bundle is incomplete for ${language}.`);
  const config = languageConfigs[language];
  const locale = config.prefix || config.locale;
  const asset = buildStaticMainAppBundleAsset(locale, bundle);
  const lookup = createTranslationLookup(
    Object.entries(bundle.sourceStrings).map(([key, source]) => [
      source,
      bundle.strings[key] ?? source,
    ]),
  );

  return (
    <StaticGuestChatBootstrap
      language={language}
      defaultTopicId={defaultTopicSlug}
      translationBundleUrl={asset.publicPath}
      translationSourceHash={asset.sourceHash}
      loadingLabel={lookup.translate("Loading your learning space…")}
      loadErrorLabel={lookup.translate(
        "We could not load your learning space. Your saved data has not been changed.",
      )}
      retryLabel={lookup.translate("Try again")}
      authErrorLabel={lookup.translate("We could not sign you in. Please try again.")}
    />
  );
}
