"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Globe2, Search, X } from "lucide-react";
import {
  defaultLanguage,
  languageDisplayName,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";

export type LanguagePickerProps = {
  currentLanguage: SupportedLanguage | string;
  recommendedLanguage?: SupportedLanguage | string;
  onSelect: (language: SupportedLanguage) => void;
  disabled?: boolean;
  buttonLabel?: string;
  title?: string;
  description?: string;
  closeLabel?: string;
  quickChoicesLabel?: string;
  recommendedLabel?: string;
  searchPlaceholder?: string;
  className?: string;
};

export function LanguagePicker({
  currentLanguage,
  recommendedLanguage = defaultLanguage,
  onSelect,
  disabled = false,
  buttonLabel = "Preferred Language",
  title = "Choose a language",
  description = "Pick the language that feels easiest for learning.",
  closeLabel,
  quickChoicesLabel,
  recommendedLabel = "",
  searchPlaceholder = "",
  className,
}: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = normalizePickerLanguage(currentLanguage);
  const recommended = normalizePickerLanguage(recommendedLanguage);
  const filteredLanguages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return supportedLanguages;
    return supportedLanguages.filter((language) => {
      const nativeName = languageDisplayName(language).toLowerCase();
      return nativeName.includes(q) || language.toLowerCase().includes(q);
    });
  }, [query]);
  const quickChoices = uniqueLanguages([recommended, defaultLanguage, current]);

  function choose(language: SupportedLanguage) {
    onSelect(language);
    setOpen(false);
    setQuery("");
  }

  const panel = open ? (
    <div className="language-picker-layer" role="presentation">
      <section className="language-picker-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="language-picker-head">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" aria-label={closeLabel || title} onClick={() => setOpen(false)}>
            <X size={20} />
          </button>
        </header>
        <div className="language-picker-quick" aria-label={quickChoicesLabel || title}>
          {quickChoices.map((language) => (
            <button
              key={language}
              type="button"
              className={language === current ? "is-active" : ""}
              onClick={() => choose(language)}
            >
              {language === recommended && recommended !== defaultLanguage && recommendedLabel ? (
                <small>{recommendedLabel}</small>
              ) : null}
              <span>{languageDisplayName(language)}</span>
            </button>
          ))}
        </div>
        <label className="language-picker-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
          />
        </label>
        <div className="language-picker-list app-scrollbar">
          {filteredLanguages.map((language) => (
            <button
              key={language}
              type="button"
              className={language === current ? "is-active" : ""}
              onClick={() => choose(language)}
            >
              <span>{languageDisplayName(language)}</span>
              {language === current ? <Check size={17} /> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <div className={`language-picker ${className ?? ""}`} data-no-auto-translate="true">
      <button
        type="button"
        className="language-picker-button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
      >
        <Globe2 size={16} />
        <span>
          <small>{buttonLabel}</small>
          <strong>{languageDisplayName(current)}</strong>
        </span>
        <ChevronDown size={16} />
      </button>
      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </div>
  );
}

function normalizePickerLanguage(language: SupportedLanguage | string): SupportedLanguage {
  return supportedLanguages.includes(language as SupportedLanguage) ? (language as SupportedLanguage) : defaultLanguage;
}

function uniqueLanguages(languages: SupportedLanguage[]) {
  return languages.filter((language, index) => languages.indexOf(language) === index);
}
