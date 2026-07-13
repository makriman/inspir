import { createHash } from "node:crypto";
import { defaultLanguage } from "@/lib/content/languages";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import type { MainAppTranslationBundle } from "@/lib/i18n/main-app-types";

export type StaticMainAppBundleAsset = {
  relativePath: string;
  publicPath: string;
  sourceHash: string;
  contentHash: string;
  serialized: string;
};

export function buildStaticMainAppBundleAsset(
  locale: string,
  bundle: MainAppTranslationBundle,
): StaticMainAppBundleAsset {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(locale)) {
    throw new Error(`Unsafe main-app translation locale: ${locale}`);
  }
  if (!/^[a-f0-9]{64}$/.test(bundle.sourceHash)) {
    throw new Error(`Invalid main-app translation source hash for ${locale}.`);
  }

  const publicBundle = buildCompleteStaticGuestTranslationSubset(locale, bundle);
  const serialized = JSON.stringify(publicBundle);
  const contentHash = createHash("sha256").update(serialized).digest("hex");
  const relativePath = `i18n/main-app/${locale}.${bundle.sourceHash}.${contentHash}.json`;
  return {
    relativePath,
    publicPath: `/${relativePath}`,
    sourceHash: bundle.sourceHash,
    contentHash,
    serialized,
  };
}

function buildCompleteStaticGuestTranslationSubset(
  locale: string,
  bundle: MainAppTranslationBundle,
): MainAppTranslationBundle {
  const sourceStrings: Record<string, string> = {};
  const strings: Record<string, string> = {};
  for (const [key, source] of Object.entries(bundle.sourceStrings)) {
    const translated = bundle.strings[key];
    if (typeof translated !== "string" || !translated.trim()) {
      throw new Error(`Incomplete static guest translation for ${locale}: ${key}`);
    }
    if (translated !== translated.normalize("NFC")) {
      throw new Error(`Non-NFC static guest translation for ${locale}: ${key}`);
    }
    if (
      bundle.language !== defaultLanguage &&
      !isValidFieldTranslation(source, translated, bundle.language, key)
    ) {
      throw new Error(`Invalid static guest translation for ${locale}: ${key}`);
    }
    sourceStrings[key] = source;
    strings[key] = translated;
  }
  return { ...bundle, sourceStrings, strings };
}
