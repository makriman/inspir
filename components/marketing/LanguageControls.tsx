"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Globe2, X } from "lucide-react";
import { setClientLanguagePreferenceCookie } from "@/components/i18n/client-language-preference";
import { LanguagePicker } from "@/components/i18n/LanguagePicker";
import {
  defaultLanguage,
  languageDisplayName,
  type SupportedLanguage,
} from "@/lib/content/languages";
import {
  localeCookieName,
  localePromptCookieName,
  localizeHref,
  removeLocaleFromPath,
} from "@/lib/i18n/routing";

type LanguageControlsProps = {
  currentLanguage: SupportedLanguage;
  recommendedLanguage: SupportedLanguage;
  hasLocalePrefix: boolean;
  availableLanguages: readonly SupportedLanguage[];
  copy: {
    buttonLabel: string;
    chooseTitle: string;
    chooseDescription: string;
    promptAriaLabel: string;
    promptTitle: string;
    promptDescription: string;
    continueEnglish: string;
    chooseButtonLabel: string;
    chooseAnotherTitle: string;
    chooseAnotherDescription: string;
    dismissLabel: string;
  };
};

const promptStorageKey = "inspir_locale_prompt_dismissed";

export function MarketingLanguageControls({
  currentLanguage,
  recommendedLanguage,
  hasLocalePrefix,
  availableLanguages,
  copy,
}: LanguageControlsProps) {
  const [promptVisible, setPromptVisible] = useState(false);
  const recommendedLabel = languageDisplayName(recommendedLanguage);
  const shouldRecommend = recommendedLanguage !== defaultLanguage && availableLanguages.includes(recommendedLanguage);

  useEffect(() => {
    if (hasLocalePrefix) return;
    const frame = window.requestAnimationFrame(() => {
      if (window.localStorage.getItem(promptStorageKey) === "1") return;
      setPromptVisible(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasLocalePrefix]);

  function saveLanguage(language: SupportedLanguage) {
    window.localStorage.setItem(promptStorageKey, "1");
    setPromptVisible(false);
    setClientLanguagePreferenceCookie(localeCookieName, language);
    setClientLanguagePreferenceCookie(localePromptCookieName, "1");

    const requestedPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const unlocalizedPath = removeLocaleFromPath(requestedPath);
    const redirectTo = language === defaultLanguage ? unlocalizedPath : localizeHref(unlocalizedPath, language);
    window.location.assign(redirectTo);
  }

  function dismissPrompt() {
    window.localStorage.setItem(promptStorageKey, "1");
    setPromptVisible(false);
  }

  const prompt = promptVisible ? (
    <section className="marketing-language-bar" aria-label={copy.promptAriaLabel}>
      <div className="marketing-language-bar-copy">
        <span className="marketing-language-bar-icon" aria-hidden="true">
          <Globe2 size={18} />
        </span>
        <div>
          <strong>{copy.promptTitle}</strong>
          <span>{copy.promptDescription}</span>
        </div>
      </div>
      <div className="marketing-language-bar-actions">
        {shouldRecommend ? (
          <>
            <button type="button" className="is-recommended" onClick={() => saveLanguage(recommendedLanguage)}>
              {recommendedLabel}
            </button>
            <button type="button" className="is-secondary" onClick={() => saveLanguage(defaultLanguage)}>
              {copy.continueEnglish}
            </button>
          </>
        ) : null}
        <LanguagePicker
          currentLanguage={currentLanguage}
          recommendedLanguage={recommendedLanguage}
          languages={availableLanguages}
          buttonLabel={copy.chooseButtonLabel}
          title={copy.chooseAnotherTitle}
          description={copy.chooseAnotherDescription}
          closeLabel={copy.dismissLabel}
          quickChoicesLabel={copy.promptAriaLabel}
          onSelect={saveLanguage}
          className="marketing-language-bar-picker"
        />
        <button type="button" onClick={dismissPrompt} aria-label={copy.dismissLabel}>
          <X size={17} />
        </button>
      </div>
    </section>
  ) : null;

  return (
    <>
      <LanguagePicker
        currentLanguage={currentLanguage}
        recommendedLanguage={recommendedLanguage}
        languages={availableLanguages}
        buttonLabel={copy.buttonLabel}
        title={copy.chooseTitle}
        description={copy.chooseDescription}
        closeLabel={copy.dismissLabel}
        quickChoicesLabel={copy.promptAriaLabel}
        onSelect={saveLanguage}
        className="marketing-language-picker-shell"
      />
      {prompt && typeof document !== "undefined" ? createPortal(prompt, document.body) : null}
    </>
  );
}
