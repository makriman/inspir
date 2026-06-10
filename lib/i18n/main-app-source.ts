import { createHash } from "node:crypto";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { getTopicSeo } from "@/lib/content/topic-seo";
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
};

export function getMainAppSourceStrings() {
  const strings: Record<string, string> = { ...baseStrings };

  for (const text of mainAppComponentText) {
    if (!isTranslatableComponentText(text)) continue;
    strings[`component.${stableTextKey(text)}`] = text;
  }

  for (const topic of topicSeeds) {
    const seo = getTopicSeo(topic);
    strings[`topic.${topic.slug}.name`] = topic.name;
    strings[`topic.${topic.slug}.subText`] = topic.subText;
    strings[`topic.${topic.slug}.description`] = topic.description;
    strings[`topic.${topic.slug}.inputboxText`] = topic.inputboxText;
    strings[`topic.${topic.slug}.category`] = topic.metadata.category;
    strings[`topic.${topic.slug}.seo.description`] = seo.description;
    strings[`topic.${topic.slug}.seo.who`] = seo.who;
    strings[`topic.${topic.slug}.seo.whyDifferent`] = seo.whyDifferent;
    seo.outcomes.forEach((outcome, index) => {
      strings[`topic.${topic.slug}.seo.outcome.${index}`] = outcome;
    });
    topic.metadata.starters.forEach((starter, index) => {
      strings[`topic.${topic.slug}.starter.${index}`] = starter;
    });
  }

  return strings;
}

export function getMainAppSourceHash(sourceStrings = getMainAppSourceStrings()) {
  const stablePayload = Object.keys(sourceStrings)
    .sort()
    .map((key) => `${key}\u0000${sourceStrings[key]}`)
    .join("\u0001");
  return createHash("sha256").update(stablePayload).digest("hex");
}

export function getEnglishMainAppTranslationBundle(): MainAppTranslationBundle {
  const sourceStrings = getMainAppSourceStrings();
  return {
    namespace: mainAppTranslationNamespace,
    language: defaultLanguage,
    sourceHash: getMainAppSourceHash(sourceStrings),
    sourceStrings,
    strings: sourceStrings,
  };
}

export function buildMainAppTranslationBundle(
  language: string,
  strings: Record<string, string>,
): MainAppTranslationBundle {
  const sourceStrings = getMainAppSourceStrings();
  return {
    namespace: mainAppTranslationNamespace,
    language: normalizeLanguage(language),
    sourceHash: getMainAppSourceHash(sourceStrings),
    sourceStrings,
    strings,
  };
}

function stableTextKey(text: string) {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function isTranslatableComponentText(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (/^\[[^\]]+\]$/.test(value)) return false;
  if (/\b[a-z]+(?:\s*\|\s*)[A-Z]?[A-Za-z]+\b/.test(value)) return false;
  if (/\b(?:bubble|coach|historical|app)-[a-z0-9-]+\b/.test(value)) return false;
  if (/^[Mm][0-9,.\sCcSsLlHhVvZz-]+$/.test(value)) return false;
  return true;
}
