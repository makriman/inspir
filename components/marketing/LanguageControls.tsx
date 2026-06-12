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
};

const promptStorageKey = "inspir_locale_prompt_dismissed";

export function MarketingLanguageControls({
  currentLanguage,
  recommendedLanguage,
  currentPathname,
  hasLocalePrefix,
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
        buttonLabel="Language"
        title="Choose your language"
        description="Use inspir in the language that feels most natural."
        onSelect={(language) => void saveLanguage(language)}
        className="marketing-language-picker-shell"
      />
      {promptVisible ? (
        <div className="marketing-language-bar" role="region" aria-label="Language options">
          <div>
            <strong>Translate inspir?</strong>
            <span>Choose the language for this visit.</span>
          </div>
          <div className="marketing-language-bar-actions">
            {shouldRecommend ? (
              <button type="button" onClick={() => void saveLanguage(recommendedLanguage)}>
                Switch to {recommendedLabel}
              </button>
            ) : null}
            <button type="button" onClick={() => void saveLanguage(defaultLanguage)}>
              Continue with English
            </button>
            <LanguagePicker
              currentLanguage={currentLanguage}
              recommendedLanguage={recommendedLanguage}
              buttonLabel="Choose"
              title="Choose another language"
              description="Search the full language list."
              onSelect={(language) => void saveLanguage(language)}
              className="marketing-language-bar-picker"
            />
            <button type="button" onClick={dismissPrompt} aria-label="Dismiss language options">
              <X size={17} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
