"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { LanguagePicker } from "@/components/i18n/LanguagePicker";
import {
  defaultLanguage,
  languageDisplayName,
  type SupportedLanguage,
} from "@/lib/content/languages";

type LanguageControlsProps = {
  currentLanguage: SupportedLanguage;
  recommendedLanguage: SupportedLanguage;
  currentPathname: string;
  hasLocalePrefix: boolean;
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
  currentPathname,
  hasLocalePrefix,
  copy,
}: LanguageControlsProps) {
  const [promptVisible, setPromptVisible] = useState(false);
  const recommendedLabel = languageDisplayName(recommendedLanguage);
  const shouldRecommend = recommendedLanguage !== defaultLanguage;

  useEffect(() => {
    if (hasLocalePrefix) return;
    const frame = window.requestAnimationFrame(() => {
      if (window.localStorage.getItem(promptStorageKey) === "1") return;
      setPromptVisible(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasLocalePrefix]);

  async function saveLanguage(language: SupportedLanguage) {
    window.localStorage.setItem(promptStorageKey, "1");
    setPromptVisible(false);
    const response = await fetch("/api/language-preference", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language,
        pathname: currentPathname || window.location.pathname + window.location.search,
      }),
    });
    const data = await response.json().catch(() => null);
    if (data?.redirectTo) {
      window.location.assign(data.redirectTo);
      return;
    }
    window.location.reload();
  }

  function dismissPrompt() {
    window.localStorage.setItem(promptStorageKey, "1");
    setPromptVisible(false);
  }

  return (
    <>
      <LanguagePicker
        currentLanguage={currentLanguage}
        recommendedLanguage={recommendedLanguage}
        buttonLabel={copy.buttonLabel}
        title={copy.chooseTitle}
        description={copy.chooseDescription}
        closeLabel={copy.dismissLabel}
        quickChoicesLabel={copy.promptAriaLabel}
        onSelect={(language) => void saveLanguage(language)}
        className="marketing-language-picker-shell"
      />
      {promptVisible ? (
        <div className="marketing-language-bar" role="region" aria-label={copy.promptAriaLabel}>
          <div>
            <strong>{copy.promptTitle}</strong>
            <span>{copy.promptDescription}</span>
          </div>
          <div className="marketing-language-bar-actions">
            {shouldRecommend ? (
              <button type="button" onClick={() => void saveLanguage(recommendedLanguage)}>
                {recommendedLabel}
              </button>
            ) : null}
            <button type="button" onClick={() => void saveLanguage(defaultLanguage)}>
              {copy.continueEnglish}
            </button>
            <LanguagePicker
              currentLanguage={currentLanguage}
              recommendedLanguage={recommendedLanguage}
              buttonLabel={copy.chooseButtonLabel}
              title={copy.chooseAnotherTitle}
              description={copy.chooseAnotherDescription}
              closeLabel={copy.dismissLabel}
              quickChoicesLabel={copy.promptAriaLabel}
              onSelect={(language) => void saveLanguage(language)}
              className="marketing-language-bar-picker"
            />
            <button type="button" onClick={dismissPrompt} aria-label={copy.dismissLabel}>
              <X size={17} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
