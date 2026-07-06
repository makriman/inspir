import { ChangeEvent, FormEvent, useReducer, useRef } from "react";
import Link from "next/link";
import { Camera, Trash2, X } from "lucide-react";
import { SocialLinks } from "@/components/brand/SocialLinks";
import type { UiTranslator } from "@/components/chat/chat-ui-types";
import { MemoryPanel } from "@/components/chat/MemoryPanel";
import { ProfileAvatarImage } from "@/components/chat/ProfileAvatarImage";
import {
  type MemoryCreateInput,
  type MemoryDashboard,
  type MemorySettingsPatch,
  type MemoryUpdateInput,
} from "@/components/chat/memory-model";
import { ProfileStat } from "@/components/chat/ProfileStat";
import type { ProfileDetailsInput, UserProfile } from "@/components/chat/profile-model";
import { LanguagePicker } from "@/components/i18n/LanguagePicker";
import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { localizeHref } from "@/lib/i18n/routing";
import { formatAppDate } from "@/lib/utils/dates";

type ProfilePanelState = {
  name: string;
  dateOfBirth: string;
  preferredLanguage: SupportedLanguage;
  detailsSaving: boolean;
  detailsMessage: string;
  detailsError: string;
  photoSaving: boolean;
  photoMessage: string;
  photoError: string;
};

function profilePanelStateFromUser(user: UserProfile): ProfilePanelState {
  return {
    name: user.name ?? "",
    dateOfBirth: user.dateOfBirth ?? "",
    preferredLanguage: (user.preferredLanguage as SupportedLanguage) || defaultLanguage,
    detailsSaving: false,
    detailsMessage: "",
    detailsError: "",
    photoSaving: false,
    photoMessage: "",
    photoError: "",
  };
}

function profilePanelReducer(state: ProfilePanelState, patch: Partial<ProfilePanelState>) {
  return { ...state, ...patch };
}

export function ProfilePanel({
  user,
  avatarSrc,
  languageSaving,
  memoryDashboard,
  memoryLoading,
  memorySaving,
  memoryError,
  onPhotoUpload,
  onPhotoRemove,
  onProfileSave,
  onMemorySettings,
  onMemoryCreate,
  onMemoryUpdate,
  onMemoryDelete,
  onMemoryClear,
  onClose,
  t,
}: {
  user: UserProfile;
  avatarSrc?: string;
  languageSaving: boolean;
  memoryDashboard: MemoryDashboard | null;
  memoryLoading: boolean;
  memorySaving: boolean;
  memoryError: string | null;
  onPhotoUpload: (file: File) => Promise<string | null>;
  onPhotoRemove: () => Promise<void>;
  onProfileSave: (input: ProfileDetailsInput) => Promise<UserProfile>;
  onMemorySettings: (input: MemorySettingsPatch) => void;
  onMemoryCreate: (input: MemoryCreateInput) => void;
  onMemoryUpdate: (memoryId: string, input: MemoryUpdateInput) => void;
  onMemoryDelete: (memoryId: string) => void;
  onMemoryClear: () => void;
  onClose: () => void;
  t: UiTranslator;
}) {
  const [state, updateState] = useReducer(profilePanelReducer, user, profilePanelStateFromUser);
  const {
    name,
    dateOfBirth,
    preferredLanguage,
    detailsSaving,
    detailsMessage,
    detailsError,
    photoSaving,
    photoMessage,
    photoError,
  } = state;
  const photoInputRef = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    updateState({ photoSaving: true, photoError: "", photoMessage: "" });
    try {
      await onPhotoUpload(file);
      updateState({ photoMessage: t("Profile photo updated.") });
    } catch (uploadError) {
      updateState({ photoError: uploadError instanceof Error ? uploadError.message : t("Could not update profile photo.") });
    } finally {
      updateState({ photoSaving: false });
      event.target.value = "";
    }
  }

  async function resetPhoto() {
    updateState({ photoSaving: true, photoError: "", photoMessage: "" });
    try {
      await onPhotoRemove();
      updateState({ photoMessage: t("Using your Google photo.") });
    } catch (removeError) {
      updateState({ photoError: removeError instanceof Error ? removeError.message : t("Could not reset profile photo.") });
    } finally {
      updateState({ photoSaving: false });
    }
  }

  async function submitProfileDetails(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      updateState({ detailsError: t("Enter a display name."), detailsMessage: "" });
      return;
    }

    updateState({ detailsSaving: true, detailsError: "", detailsMessage: "" });
    const previousLanguage = user.preferredLanguage || defaultLanguage;
    try {
      const updatedUser = await onProfileSave({
        name: trimmedName,
        dateOfBirth: dateOfBirth || null,
        preferredLanguage,
      });
      updateState({
        name: updatedUser.name ?? "",
        dateOfBirth: updatedUser.dateOfBirth ?? "",
        preferredLanguage: (updatedUser.preferredLanguage as SupportedLanguage) || defaultLanguage,
        detailsMessage: t("Profile saved."),
      });
      if ((updatedUser.preferredLanguage || defaultLanguage) !== previousLanguage) {
        window.location.assign(localizeHref(window.location.pathname + window.location.search, updatedUser.preferredLanguage));
      }
    } catch (saveError) {
      updateState({ detailsError: saveError instanceof Error ? saveError.message : t("Could not save profile.") });
    } finally {
      updateState({ detailsSaving: false });
    }
  }

  return (
    <main className="inspir-profile-panel inspir-profile-workspace app-scrollbar">
      <div className="inspir-profile-header">
        <div>
          <span>{t("Learning profile")}</span>
          <h2>{t("Make inspir feel like it knows how you learn.")}</h2>
        </div>
        <button type="button" aria-label={t("Close profile")} onClick={onClose}>
          <X size={24} strokeWidth={3.5} />
        </button>
      </div>
      <div className="inspir-profile-body">
        <section className="inspir-profile-section inspir-profile-identity-section">
          <div className="inspir-profile-section-head">
            <span>{t("Profile details")}</span>
            <h3>{t("Your app identity")}</h3>
          </div>
          <div className="inspir-profile-identity-grid">
            <div className="inspir-profile-hero">
              <div className="inspir-profile-avatar">
                <ProfileAvatarImage
                  src={avatarSrc}
                  fallbackSrc={user.image}
                  width={96}
                  height={96}
                  sizes="96px"
                  iconSize={42}
                />
              </div>
              <div className="inspir-profile-hero-copy">
                <h3>{user.name || "Learner"}</h3>
                <p>{user.email || "user@example.com"}</p>
              </div>
              <div className="inspir-profile-photo-actions">
                <input
                  ref={photoInputRef}
                  type="file"
                  aria-label={t("Profile photo")}
                  accept="image/jpeg,image/png,image/webp"
                  className="inspir-profile-photo-input"
                  onChange={(event) => void handlePhotoChange(event)}
                />
                <button
                  type="button"
                  disabled={photoSaving}
                  onClick={() => photoInputRef.current?.click()}
                  className="inspir-profile-photo-button"
                >
                  <Camera size={16} />
                  <span>{photoSaving ? t("Saving...") : t("Change photo")}</span>
                </button>
                {user.profileImageHash ? (
                  <button
                    type="button"
                    disabled={photoSaving}
                    onClick={() => void resetPhoto()}
                    className="inspir-profile-photo-button is-muted"
                  >
                    <Trash2 size={15} />
                    <span>{t("Use Google photo")}</span>
                  </button>
                ) : null}
              </div>
              {photoError ? <span className="inspir-profile-details-error">{photoError}</span> : null}
              {photoMessage ? <span className="inspir-profile-details-success">{photoMessage}</span> : null}
            </div>
            <form className="inspir-profile-details-form" onSubmit={submitProfileDetails}>
              <label>
                <span>{t("Display name")}</span>
                <input
                  type="text"
                  value={name}
                  maxLength={120}
                  autoComplete="name"
                  onChange={(event) => updateState({ name: event.target.value })}
                />
              </label>
              <label>
                <span>{t("Date of birth")}</span>
                <input
                  type="date"
                  value={dateOfBirth}
                  max={today}
                  onChange={(event) => updateState({ dateOfBirth: event.target.value })}
                />
              </label>
              <div className="inspir-profile-details-language">
                <span>{t("Preferred Language")}</span>
                <LanguagePicker
                  currentLanguage={preferredLanguage}
                  recommendedLanguage={preferredLanguage}
                  disabled={detailsSaving || languageSaving}
                  buttonLabel={t("Preferred Language")}
                  title={t("Choose your learning language")}
                  description={t("All app text and tutoring replies follow this setting.")}
                  closeLabel={t("Close")}
                  quickChoicesLabel={t("Preferred Language")}
                  onSelect={(language) => updateState({ preferredLanguage: language })}
                  className="inspir-profile-language-picker"
                />
              </div>
              {detailsError ? <span className="inspir-profile-details-error">{detailsError}</span> : null}
              {detailsMessage ? <span className="inspir-profile-details-success">{detailsMessage}</span> : null}
              <button type="submit" disabled={detailsSaving || languageSaving} className="inspir-profile-save-button">
                {detailsSaving || languageSaving ? t("Saving...") : t("Save profile")}
              </button>
            </form>
          </div>
        </section>

        <section className="inspir-profile-section">
          <div className="inspir-profile-section-head">
            <span>{t("Overview")}</span>
            <h3>{t("Your learning snapshot")}</h3>
          </div>
          <div className="inspir-profile-stats-grid">
            <ProfileStat
              label={t("Age")}
              value={typeof user.age === "number" ? String(user.age) : t("Add your date of birth")}
            />
            <ProfileStat label={t("Learning score")} value={String(user.score ?? 0)} />
            <ProfileStat label={t("inspir'ed since")} value={formatAppDate(user.createdAt)} />
          </div>
        </section>

        <section className="inspir-profile-section">
          <div className="inspir-profile-section-head">
            <span>{t("Memory")}</span>
            <h3>{t("What inspir can remember")}</h3>
          </div>
          <MemoryPanel
            dashboard={memoryDashboard}
            loading={memoryLoading}
            saving={memorySaving}
            error={memoryError}
            onSettings={onMemorySettings}
            onCreate={onMemoryCreate}
            onUpdate={onMemoryUpdate}
            onDelete={onMemoryDelete}
            onClear={onMemoryClear}
            t={t}
          />
        </section>

        <section className="inspir-profile-section inspir-profile-account-section">
          <div className="inspir-profile-section-head">
            <span>{t("Account and privacy")}</span>
            <h3>{t("Control what stays with you")}</h3>
          </div>
          <p>
            {t(
              "Your saved chats, language preference, date of birth, and learning memory are used to make the app more useful for you.",
            )}
          </p>
          <div className="inspir-profile-account-list">
            <div className="inspir-profile-account-row">
              <span>{t("Google email")}</span>
              <strong>{user.email || "Not connected"}</strong>
            </div>
          </div>
          <div className="inspir-profile-account-actions">
            <Link href="/terms">{t("Terms")}</Link>
            <Link href="/privacy">{t("Privacy")}</Link>
            <button type="button" onClick={() => void signOutToHome()} className="inspir-profile-logout">
              {t("Logout")}
            </button>
          </div>
          <SocialLinks compact className="inspir-profile-social" />
        </section>
      </div>
    </main>
  );
}

async function signOutToHome() {
  try {
    const csrfResponse = await fetch("/api/auth/csrf");
    const csrf = (await csrfResponse.json().catch(() => null)) as { csrfToken?: string } | null;
    const body = new URLSearchParams({
      callbackUrl: "/",
      json: "true",
    });
    if (csrf?.csrfToken) body.set("csrfToken", csrf.csrfToken);
    await fetch("/api/auth/signout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } finally {
    window.location.assign("/");
  }
}
