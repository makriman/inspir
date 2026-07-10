"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  languages?: readonly SupportedLanguage[];
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
  languages = supportedLanguages,
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = normalizePickerLanguage(currentLanguage, languages);
  const recommended = normalizePickerLanguage(recommendedLanguage, languages);
  const filteredLanguages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter((language) => {
      const nativeName = languageDisplayName(language).toLowerCase();
      return nativeName.includes(q) || language.toLowerCase().includes(q);
    });
  }, [languages, query]);
  const quickChoices = uniqueLanguages([recommended, defaultLanguage, current]).filter((language) => languages.includes(language));

  function choose(language: SupportedLanguage) {
    onSelect(language);
    closePanel();
  }

  function closePanel() {
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  const panel = open ? (
    <dialog
      ref={dialogRef}
      className="language-picker-layer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        closePanel();
      }}
    >
      <section className="language-picker-panel">
        <header className="language-picker-head">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" aria-label={closeLabel || title} onClick={closePanel}>
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
    </dialog>
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

function normalizePickerLanguage(
  language: SupportedLanguage | string,
  languages: readonly SupportedLanguage[],
): SupportedLanguage {
  const match = languages.find((candidate) => candidate === language);
  return match ?? (languages.includes(defaultLanguage) ? defaultLanguage : languages[0] ?? defaultLanguage);
}

function uniqueLanguages(languages: SupportedLanguage[]) {
  return languages.filter((language, index) => languages.indexOf(language) === index);
}
