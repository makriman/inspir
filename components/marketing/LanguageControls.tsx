"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe2, X } from "lucide-react";
import {
  defaultLanguage,
  languageDisplayName,
  supportedLanguages,
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

  const pickerLabel = useMemo(
    () => `${languageDisplayName(currentLanguage)} language selector`,
    [currentLanguage],
  );

  return (
    <>
      <label className="marketing-language-picker" aria-label={pickerLabel} data-no-auto-translate="true">
        <Globe2 size={16} />
        <select
          value={currentLanguage}
          onChange={(event) => void saveLanguage(event.target.value as SupportedLanguage)}
          data-no-auto-translate="true"
        >
          {supportedLanguages.map((language) => (
            <option key={language} value={language} data-no-auto-translate="true">
              {languageDisplayName(language)}
            </option>
          ))}
        </select>
      </label>
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
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) void saveLanguage(event.target.value as SupportedLanguage);
              }}
              data-no-auto-translate="true"
              aria-label="Choose another language"
            >
              <option value="" disabled>
                Choose another language
              </option>
              {supportedLanguages.map((language) => (
                <option key={language} value={language}>
                  {languageDisplayName(language)}
                </option>
              ))}
            </select>
            <button type="button" onClick={dismissPrompt} aria-label="Dismiss language options">
              <X size={17} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
