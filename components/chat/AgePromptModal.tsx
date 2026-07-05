import { FormEvent, useState } from "react";
import { X } from "lucide-react";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { profileFromApiUser, type ProfileResponse, type UserProfile } from "@/components/chat/profile-model";
import { LanguagePicker } from "@/components/i18n/LanguagePicker";
import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";

export function AgePromptModal({
  onClose,
  onSaved,
  initialLanguage,
  t,
}: {
  onClose: () => void;
  onSaved: (user: UserProfile) => void;
  initialLanguage: string;
  t: UiTranslator;
}) {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguage>((initialLanguage as SupportedLanguage) || defaultLanguage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  async function submitDateOfBirth(event: FormEvent) {
    event.preventDefault();
    if (!dateOfBirth) {
      setError(t("Please enter your date of birth."));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dateOfBirth, preferredLanguage }),
      });
      const data = (await response.json().catch(() => null)) as ProfileResponse | null;
      if (!response.ok || !data?.user) {
        throw new Error(data?.error || t("Could not save date of birth"));
      }
      onSaved(profileFromApiUser(data.user));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("Please enter a valid date of birth."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inspir-guest-modal-backdrop" role="presentation">
      <dialog open className="inspir-guest-modal inspir-age-modal" aria-modal="true" aria-labelledby="age-modal-title">
        <button type="button" onClick={onClose} aria-label={t("Close")} className="inspir-guest-modal-close">
          <X size={20} />
        </button>
        <span className="inspir-guest-modal-kicker">{t("Age-appropriate learning")}</span>
        <h2 id="age-modal-title">{t("Help inspir fit your age")}</h2>
        <p>
          {t(
            "Add your date of birth and preferred language so inspir can adapt examples, tone, safety boundaries, and app text for your learning experience.",
          )}
        </p>
        <form onSubmit={submitDateOfBirth} className="inspir-age-form">
          <label className="inspir-age-label" htmlFor="date-of-birth">
            {t("Date of birth")}
          </label>
          <input
            id="date-of-birth"
            type="date"
            value={dateOfBirth}
            max={today}
            onChange={(event) => setDateOfBirth(event.target.value)}
            className="inspir-age-input"
            required
          />
          <LanguagePicker
            currentLanguage={preferredLanguage}
            recommendedLanguage={preferredLanguage}
            buttonLabel={t("Preferred Language")}
            title={t("Choose your learning language")}
            description={t("App text and tutoring replies will follow this setting.")}
            closeLabel={t("Close")}
            quickChoicesLabel={t("Preferred Language")}
            onSelect={setPreferredLanguage}
            className="inspir-modal-language-picker"
          />
          {error ? <span className="inspir-age-error">{error}</span> : null}
          <button type="submit" disabled={saving} className="inspir-guest-modal-primary">
            {saving ? t("Saving...") : t("Continue")}
          </button>
          <button type="button" onClick={onClose} className="inspir-guest-modal-secondary">
            {t("Maybe later")}
          </button>
        </form>
      </dialog>
    </div>
  );
}
