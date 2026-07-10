import { createHash } from "node:crypto";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { topicSeeds } from "@/lib/content/topics";
import { mainAppComponentText } from "./main-app-component-text";
import type { MainAppTranslationBundle } from "./main-app-types";

export const mainAppTranslationNamespace = "main-app";

const baseStrings: Record<string, string> = {
  "onboarding.age.title": "Help inspir fit your age",
  "onboarding.age.body":
    "Tell us your date of birth so we can build an age-appropriate learning experience. We use it to adjust examples, tone, and safety boundaries.",
  "onboarding.age.label": "Date of birth",
  "onboarding.age.submit": "Continue",
  "onboarding.age.saving": "Saving...",
  "onboarding.age.error": "Please enter a valid date of birth.",
  "profile.age": "Age",
  "profile.ageUnknown": "Add your date of birth",
  "sidebar.openLearningStore": "Open learning store",
  "sidebar.search": "Search",
  "sidebar.searchChats": "Search chats",
  "guest.continue.kicker": "free guest messages used",
  "guest.continue.title": "Continue learning",
  "guest.continue.body":
    "Easy Google login, then inspir stores your learning history, language preference, and chats so everything is ready next time. inspir stays free to use.",
  "guest.continue.google": "Continue with Google",
  "guest.continue.later": "Maybe later",
  "language.prompt.kicker": "Preferred Language",
  "language.prompt.title": "Choose your learning language",
  "language.prompt.body": "Use inspir in the language that feels easiest. You can change this later from your profile.",
  "language.prompt.description": "You can switch again later from Profile.",
  "language.prompt.english": "Continue with English",
  "age.modal.kicker": "Age-appropriate learning",
  "age.modal.body":
    "Add your date of birth and preferred language so inspir can adapt examples, tone, safety boundaries, and app text for your learning experience.",
  "age.modal.languageDescription": "App text and tutoring replies will follow this setting.",
  "age.modal.missing": "Please enter your date of birth.",
  "profile.header.kicker": "Learning profile",
  "profile.header.title": "Make inspir feel like it knows how you learn.",
  "profile.details.kicker": "Profile details",
  "profile.details.title": "Your app identity",
  "profile.details.displayName": "Display name",
  "profile.details.googleEmail": "Google email",
  "profile.details.enterName": "Enter a display name.",
  "profile.details.saved": "Profile saved.",
  "profile.details.saveError": "Could not save profile.",
  "profile.details.save": "Save profile",
  "profile.photo.change": "Change photo",
  "profile.photo.updated": "Profile photo updated.",
  "profile.photo.uploadError": "Could not update profile photo.",
  "profile.photo.chooseFile": "Choose an image file.",
  "profile.photo.tooLarge": "Choose an image under 1 MB.",
  "profile.photo.unsupported": "Use a JPG, PNG, or WebP image.",
  "profile.overview.kicker": "Overview",
  "profile.overview.title": "Your learning snapshot",
  "profile.overview.score": "Learning score",
  "profile.overview.since": "inspir'ed since",
  "profile.memory.kicker": "Memory",
  "profile.memory.title": "What inspir can remember",
  "profile.account.kicker": "Account and privacy",
  "profile.account.title": "Control what stays with you",
  "profile.account.body":
    "Your saved chats, language preference, date of birth, and learning memory are used to make the app more useful for you.",
  "profile.account.terms": "Terms",
  "profile.account.privacy": "Privacy",
  "profile.account.admin": "Admin dashboard",
  "profile.account.logout": "Logout",
  "memory.status.on": "On for this account",
  "memory.status.off": "Off for this account",
  "memory.master.onTitle": "Memory is on",
  "memory.master.offTitle": "Memory is off",
  "memory.master.onBody": "Used only when it helps.",
  "memory.master.offBody": "Nothing is saved or used.",
  "memory.toggle.on": "On",
  "memory.toggle.off": "Off",
  "memory.savedMemory": "Saved memory",
  "memory.pastChats": "Past chats",
  "memory.synthesis": "Synthesis",
  "memory.loading": "Loading memory...",
  "memory.notice.title": "Memory is on for signed-in accounts.",
  "memory.notice.body":
    "Everything Inspir remembers is shown below as editable memory cards. You can add, edit, delete, or clear them anytime.",
  "memory.notice.gotIt": "Got it",
  "memory.summary.title": "Memory summary",
  "memory.summary.empty": "No summary yet",
  "memory.summary.correct": "Correct or add what Inspir should remember.",
  "memory.saved.empty": "No saved memories yet.",
  "memory.saved.countOne": "saved memory",
  "memory.saved.countMany": "saved memories",
  "memory.actions.add": "Add",
  "memory.actions.clearAll": "Clear all",
  "memory.actions.save": "Save",
  "memory.actions.cancel": "Cancel",
  "memory.category.preferences": "Preferences",
  "memory.category.learningStyle": "Learning style",
  "memory.category.projects": "Projects",
  "memory.category.goals": "Goals",
  "memory.category.knowledge": "Knowledge",
  "memory.category.constraints": "Constraints",
  "memory.category.interaction": "Interaction",
  "memory.category.identity": "Identity",
  "memory.category.general": "General",
};

function buildMainAppSourceStrings() {
  const strings: Record<string, string> = { ...baseStrings };

  for (const text of mainAppComponentText) {
    if (!isTranslatableComponentText(text)) continue;
    strings[`component.${stableTextKey(text)}`] = text;
  }

  for (const topic of topicSeeds) {
    strings[`topic.${topic.slug}.name`] = topic.name;
    strings[`topic.${topic.slug}.subText`] = topic.subText;
    strings[`topic.${topic.slug}.description`] = topic.description;
    strings[`topic.${topic.slug}.inputboxText`] = topic.inputboxText;
    strings[`topic.${topic.slug}.category`] = topic.metadata.category;
    topic.metadata.starters.forEach((starter, index) => {
      strings[`topic.${topic.slug}.starter.${index}`] = starter;
    });
  }

  return strings;
}

function hashMainAppSourceStrings(sourceStrings: Record<string, string>) {
  const stablePayload = Object.keys(sourceStrings)
    .sort()
    .map((key) => `${key}\u0000${sourceStrings[key]}`)
    .join("\u0001");
  return createHash("sha256").update(stablePayload).digest("hex");
}

export function getMainAppSourceStrings() {
  return mainAppSourceStrings;
}

export function getMainAppSourceHash(sourceStrings = mainAppSourceStrings) {
  return sourceStrings === mainAppSourceStrings ? mainAppSourceHash : hashMainAppSourceStrings(sourceStrings);
}

export function getEnglishMainAppTranslationBundle(): MainAppTranslationBundle {
  return englishMainAppTranslationBundle;
}

export function buildMainAppTranslationBundle(
  language: string,
  strings: Record<string, string>,
): MainAppTranslationBundle {
  return {
    namespace: mainAppTranslationNamespace,
    language: normalizeLanguage(language),
    sourceHash: mainAppSourceHash,
    sourceStrings: mainAppSourceStrings,
    strings,
  };
}

const internalPromptComponentText = new Set([
  "Ask one question at a time, track assumptions and evidence, offer hints on request, and do not synthesize until I have tried.",
  "Begin with a persona card, then answer in character with brief context notes and suggested follow-up questions.",
  "Build momentum, make a useful first pass, and ask for decisions without overpraising.",
  "Challenge the weakest part of the current artifact. Be direct, name the assumption, and ask me to defend or revise it.",
  "Track decisions and open questions. Preserve my voice in writing tasks. Ask at most one practical question if context is missing.",
  "Use visible sections: Shared artifact, AI contribution, User move, Inline comments, Decision log, Open questions, Next action.",
]);

function stableTextKey(text: string) {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function isTranslatableComponentText(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (/^[-–]\s+/.test(value)) return false;
  if (/^\d+\.\s+/.test(value)) return false;
  if (/^\d{1,4}\s*(?:BCE|CE)$/.test(value)) return false;
  if (/^\d+\s*[-–]\s*\d+\s*(?:min|mins|minutes|sec|secs|hours?|hrs?)$/i.test(value)) return false;
  if (/^\d+-minute\b/i.test(value)) return false;
  if (internalPromptComponentText.has(value)) return false;
  if (/^\[[^\]]+\]$/.test(value)) return false;
  if (/\b[a-z]+(?:\s*\|\s*)[A-Z]?[A-Za-z]+\b/.test(value)) return false;
  if (/\b(?:inspir|coach|historical|app)-[a-z0-9-]+\b/.test(value)) return false;
  if (/^[Mm][0-9,.\sCcSsLlHhVvZz-]+$/.test(value)) return false;
  return true;
}

const mainAppSourceStrings: Record<string, string> = Object.freeze(buildMainAppSourceStrings());
const mainAppSourceHash = hashMainAppSourceStrings(mainAppSourceStrings);
const englishMainAppTranslationBundle: MainAppTranslationBundle = Object.freeze({
  namespace: mainAppTranslationNamespace,
  language: defaultLanguage,
  sourceHash: mainAppSourceHash,
  sourceStrings: mainAppSourceStrings,
  strings: mainAppSourceStrings,
});
