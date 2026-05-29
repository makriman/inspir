"use client";

import { FormEvent, useMemo, useState } from "react";
import type { MainAppTranslationBundle } from "@/lib/i18n/main-app-types";

export function AgeOnboardingForm({
  nextUrl,
  translationBundle,
}: {
  nextUrl: string;
  translationBundle: MainAppTranslationBundle;
}) {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const t = useMemo(() => makeTranslator(translationBundle), [translationBundle]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dateOfBirth) {
      setError(t("onboarding.age.error"));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dateOfBirth }),
      });
      if (!response.ok) throw new Error("Could not save date of birth");
      window.location.assign(nextUrl);
    } catch {
      setError(t("onboarding.age.error"));
      setSaving(false);
    }
  }

  return (
    <main className="age-onboarding-page">
      <form className="age-onboarding-card" onSubmit={submit}>
        <div>
          <span className="age-onboarding-kicker">inspir</span>
          <h1>{t("onboarding.age.title")}</h1>
          <p>{t("onboarding.age.body")}</p>
        </div>
        <label>
          <span>{t("onboarding.age.label")}</span>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            disabled={saving}
            required
          />
        </label>
        {error ? <p className="age-onboarding-error">{error}</p> : null}
        <button type="submit" disabled={saving}>
          {saving ? t("onboarding.age.saving") : t("onboarding.age.submit")}
        </button>
      </form>
    </main>
  );
}

function makeTranslator(bundle: MainAppTranslationBundle) {
  return (key: string) => bundle.strings[key] ?? bundle.sourceStrings[key] ?? key;
}
