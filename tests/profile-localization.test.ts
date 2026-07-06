import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicSystemPrompt } from "../lib/ai/prompts";
import {
  defaultLanguage,
  languageConfigs,
  languageDisplayName,
  supportedLanguages,
} from "../lib/content/languages";
import { topicSeeds } from "../lib/content/topics";
import { recommendLanguageFromCountry } from "../lib/i18n/language-detection";
import { resolveRequestLanguage } from "../lib/i18n/language-preference";
import { localizeStructuredDataValue } from "../lib/i18n/metadata";
import { getEnglishMainAppTranslationBundle, getMainAppSourceHash } from "../lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
  getSiteSourceStrings,
  getSiteTranslationNamespacesForPath,
  legalEnglishControlsNotice,
  marketingShellTranslationNamespace,
} from "../lib/i18n/site-source";
import { translationStringsFromDbPayload } from "../lib/i18n/db-translations";
import { getLocalizedPathInfo, languageAlternatesForPath, localizeHref, localizePath } from "../lib/i18n/routing";
import { createTranslationLookup } from "../lib/i18n/translation-lookup";
import { isValidFieldTranslation } from "../lib/i18n/translation-field-validation";
import { isFreshAppTranslation, validateTranslationPayload } from "../lib/i18n/translation-validation";
import { calculateAge, validateDateOfBirth } from "../lib/profile/age";
import {
  isOversizedProfileImageUpload,
  maxProfileImageBytes,
  maxProfileImageUploadRequestBytes,
  prepareProfileImage,
} from "../lib/profile/photo";
import { profileImageObjectKey } from "../lib/profile/photo-key";
import { updateProfileSchema } from "../lib/profile/validation";
import { isChatAppPath } from "../lib/routes/chat-path";

test("calculateAge handles birthday boundaries", () => {
  const today = new Date(Date.UTC(2026, 4, 29));

  assert.equal(calculateAge("2010-05-29", today), 16);
  assert.equal(calculateAge("2010-05-30", today), 15);
  assert.equal(calculateAge("2010-05-28", today), 16);
  assert.equal(calculateAge("not-a-date", today), null);
});

test("date of birth validation rejects invalid and future dates", () => {
  const today = new Date(Date.UTC(2026, 4, 29));

  assert.equal(validateDateOfBirth("2026-05-29", today).success, true);
  assert.equal(validateDateOfBirth("2026-05-30", today).success, false);
  assert.equal(validateDateOfBirth("2026-02-31", today).success, false);
  assert.equal(updateProfileSchema.safeParse({ dateOfBirth: "2999-01-01" }).success, false);
});

test("profile photo validation accepts small real image types only", () => {
  const jpeg = prepareProfileImage(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), "application/octet-stream");
  assert.equal(jpeg.success, true);
  if (jpeg.success) {
    assert.equal(jpeg.mimeType, "image/jpeg");
    assert.ok(jpeg.hash);
  }

  const invalid = prepareProfileImage(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf");
  assert.equal(invalid.success, false);

  const truncatedPng = prepareProfileImage(new Uint8Array([0x89, 0x50, 0x4e]), "image/png");
  assert.equal(truncatedPng.success, false);

  const spoofedMime = prepareProfileImage(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "image/png");
  assert.equal(spoofedMime.success, false);

  const tooLarge = prepareProfileImage(new Uint8Array(maxProfileImageBytes + 1), "image/png");
  assert.equal(tooLarge.success, false);
});

test("profile photo upload preflight rejects oversized content length", () => {
  assert.equal(isOversizedProfileImageUpload(null), false);
  assert.equal(isOversizedProfileImageUpload("not-a-number"), false);
  assert.equal(isOversizedProfileImageUpload(String(maxProfileImageUploadRequestBytes)), false);
  assert.equal(isOversizedProfileImageUpload(String(maxProfileImageUploadRequestBytes + 1)), true);
});

test("profile photo R2 keys are deterministic and do not expose user ids", () => {
  const key = profileImageObjectKey("user@example.com", "a".repeat(64));
  assert.match(key, /^profile-images\/users\/[a-f0-9]{2}\/[a-f0-9]{64}\/a{64}$/);
  assert.equal(key.includes("user@example.com"), false);
  assert.equal(key.includes(".."), false);
});

test("prompt assembly includes age context only when known", () => {
  const seed = topicSeeds.find((topic) => topic.slug === "learn-anything");
  assert.ok(seed);

  const withAge = buildTopicSystemPrompt(seed, defaultLanguage, { learnerAge: 12 });
  assert.ok(withAge.includes("The learner is 12 years old."));
  assert.ok(withAge.includes("Do not mention their age unless directly relevant or asked."));

  const withoutAge = buildTopicSystemPrompt(seed, defaultLanguage);
  assert.equal(withoutAge.includes("The learner is"), false);
});

test("main app translation source has stable keys and validates placeholders", () => {
  const bundle = getEnglishMainAppTranslationBundle();
  const sourceHash = getMainAppSourceHash(bundle.sourceStrings);

  assert.equal(bundle.sourceHash, sourceHash);
  assert.equal(bundle.strings["onboarding.age.submit"], "Continue");
  assert.ok(Object.keys(bundle.sourceStrings).some((key) => key.startsWith("topic.learn-anything.")));
  assert.equal(Object.keys(bundle.sourceStrings).some((key) => key.includes(".seo.")), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("Who it helps"), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("Why it is different"), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("- Apply constraints around language, rank, gender, class, law, religion, money, sanitation, and access."), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("1. If discovery or time-slice choice is needed, show choices and stop."), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("Ask one question at a time, track assumptions and evidence, offer hints on request, and do not synthesize until I have tried."), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("399 BCE"), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("10-15 min"), false);
  assert.equal(Object.values(bundle.sourceStrings).includes("10-minute visit"), false);
  assert.equal(validateTranslationPayload(bundle.sourceStrings, bundle.strings), true);
  assert.equal(isFreshAppTranslation({ sourceHash }, sourceHash), true);
  assert.equal(isFreshAppTranslation({ sourceHash: "old" }, sourceHash), false);

  const broken: Record<string, string> = { ...bundle.strings, "onboarding.age.body": "Missing" };
  broken["onboarding.age.title"] = "";
  assert.equal(validateTranslationPayload(bundle.sourceStrings, broken), false);
});

test("database translation payloads can serve partial verified strings", () => {
  const source = {
    sourceStrings: {
      title: "Learn Anything",
      action: "Continue",
      unchanged: "inspir",
      languageSpecific: "Blog",
      empty: "Saved",
    },
  };

  assert.deepEqual(
    translationStringsFromDbPayload(source, {
      title: "Aprende cualquier cosa",
      action: "Continuar",
      unchanged: "inspir",
      languageSpecific: "Blog",
      empty: "",
      unknown: "Ignored",
    }, "Spanish"),
    {
      title: "Aprende cualquier cosa",
      action: "Continuar",
      unchanged: "inspir",
      languageSpecific: "Blog",
    },
  );
});

test("language selector display names stay native and stable", () => {
  assert.equal(languageDisplayName("English"), "English");
  assert.equal(languageDisplayName("Hindi"), "हिन्दी");
  assert.equal(languageDisplayName("Kannada"), "ಕನ್ನಡ");
  assert.equal(languageDisplayName("Tamil"), "தமிழ்");
  assert.equal(languageDisplayName("Malayalam"), "മലയാളം");
  assert.equal(languageDisplayName("Arabic"), "العربية");
  assert.equal(languageDisplayName("Spanish"), "Español");
  assert.equal(languageDisplayName("Telugu"), "తెలుగు");

  for (const language of supportedLanguages) {
    assert.ok(languageDisplayName(language).trim());
  }
});

test("field translation validation rejects unchanged visible mode labels", () => {
  assert.equal(isValidFieldTranslation("Learn Anything", "Learn Anything", "Spanish"), false);
  assert.equal(isValidFieldTranslation("Homework Coach", "Homework Coach", "Arabic"), false);
  assert.equal(isValidFieldTranslation("{value1} FAQ", "{value1} Preguntas frecuentes", "Spanish"), true);
  assert.equal(isValidFieldTranslation("GitHub", "GitHub", "Spanish"), true);
  assert.equal(isValidFieldTranslation("\\u003c", "\\u003c", "Arabic"), true);
  assert.equal(
    isValidFieldTranslation(
      "ai-learning-platform, ai-study-platform",
      "ai-learning-platform, ai-study-platform",
      "Hindi",
    ),
    true,
  );
});

test("locale routing helpers preserve canonical English and prefix non-English paths", () => {
  assert.equal(localizePath("/", "Spanish"), "/es");
  assert.equal(localizePath("/blog/example", "Spanish"), "/es/blog/example");
  assert.equal(localizePath("/blog/example", "English"), "/blog/example");
  assert.equal(localizeHref("/topics?tab=math", "Hindi"), "/hi/topics?tab=math");
  assert.deepEqual(getLocalizedPathInfo("/ar/blog/example"), {
    language: "Arabic",
    prefix: "ar",
    hasLocalePrefix: true,
    pathnameWithoutLocale: "/blog/example",
  });

  const alternates = languageAlternatesForPath("/subjects");
  assert.equal(alternates["en-US"], "/subjects");
  assert.equal(alternates.es, "/es/subjects");
  assert.equal(alternates.ml, "/ml/subjects");
  assert.equal(languageConfigs.Arabic.dir, "rtl");
});

test("explicit English language cookie wins over localized referrer", () => {
  assert.equal(
    resolveRequestLanguage({
      cookieLanguage: "English",
      referrerLanguage: "Spanish",
    }),
    "English",
  );
  assert.equal(resolveRequestLanguage({ referrerLanguage: "Spanish" }), "Spanish");
  assert.equal(
    resolveRequestLanguage({
      localeLanguage: "Malayalam",
      cookieLanguage: "English",
      referrerLanguage: "Spanish",
    }),
    "Malayalam",
  );
});

test("chat app path helper is narrow to private app routes", () => {
  assert.equal(isChatAppPath("/chat"), true);
  assert.equal(isChatAppPath("/chat/learn-anything"), true);
  assert.equal(isChatAppPath("/es/chat/learn-anything"), true);
  assert.equal(isChatAppPath("/chat-public"), false);
  assert.equal(isChatAppPath("/subjects/chat"), false);
});

test("country recommendation maps IP country signals to supported languages", () => {
  assert.equal(recommendLanguageFromCountry("IN"), "Hindi");
  assert.equal(recommendLanguageFromCountry("ES"), "Spanish");
  assert.equal(recommendLanguageFromCountry("AE"), "Arabic");
  assert.equal(recommendLanguageFromCountry("JP"), "Japanese");
  assert.equal(recommendLanguageFromCountry("XX"), null);
  assert.equal(recommendLanguageFromCountry("T1"), null);
});

test("site translation source includes short UI labels and legal notice", () => {
  const source = getSiteSourceStrings();
  const values = new Set(Object.values(source));
  assert.ok(values.has("Start"));
  assert.ok(values.has("Blog"));
  assert.ok(values.has("Learning is for everyone."));
  assert.ok(values.has(legalEnglishControlsNotice));
});

test("site translation namespaces are segmented by route and content", () => {
  const namespaces = getAllSiteTranslationNamespaces();
  assert.ok(namespaces.includes(marketingShellTranslationNamespace));
  assert.ok(namespaces.includes("route:home"));
  assert.ok(namespaces.includes("route:blog"));
  assert.ok(namespaces.includes("legal:privacy"));
  assert.ok(namespaces.includes("blog:socratic-ai-tutor"));

  assert.deepEqual(getSiteTranslationNamespacesForPath("/"), [
    marketingShellTranslationNamespace,
    "route:home",
  ]);
  assert.deepEqual(getSiteTranslationNamespacesForPath("/blog/socratic-ai-tutor"), [
    marketingShellTranslationNamespace,
    "route:blog",
    "blog:socratic-ai-tutor",
  ]);
  assert.deepEqual(getSiteTranslationNamespacesForPath("/privacy"), [
    marketingShellTranslationNamespace,
    "legal:privacy",
  ]);
  assert.deepEqual(getSiteTranslationNamespacesForPath("/chat/learn-anything"), []);

  const shellValues = new Set(Object.values(getSiteSourceStrings(marketingShellTranslationNamespace)));
  assert.ok(shellValues.has("Start"));
  assert.ok(shellValues.has("Learning is for everyone."));
  assert.ok(shellValues.has("inspir public navigation"));
  assert.ok(shellValues.has("AI tutoring"));
  assert.ok(shellValues.has("{value1} on inspir"));
  assert.ok(!shellValues.has(legalEnglishControlsNotice));

  const blogValues = new Set(Object.values(getSiteSourceStrings("blog:socratic-ai-tutor")));
  assert.ok(blogValues.has("Why a Socratic AI tutor can make ideas stick"));
  assert.ok(!blogValues.has("Learning is for everyone."));

  const chatValues = new Set(Object.values(getSiteSourceStrings("route:chat-public")));
  assert.ok(chatValues.has("Learn Anything"));
  assert.ok(chatValues.has("Learn Anything With a Free AI Tutor"));

  const topicValues = new Set(Object.values(getSiteSourceStrings("route:topics")));
  assert.ok(topicValues.has("{value1} AI learning modes"));

  const publicChatValues = new Set(Object.values(getSiteSourceStrings("route:chat-public")));
  assert.ok(!publicChatValues.has("learning mode"));
});

test("site source manifest is fresh for Cloudflare runtime translation hashes", () => {
  for (const namespace of [marketingShellTranslationNamespace, "route:home", "blog:socratic-ai-tutor"]) {
    const manifestSource = getSiteTranslationSource(namespace);
    const extractedSource = getSiteTranslationSource(namespace, { mode: "extract" });
    assert.equal(manifestSource.sourceHash, extractedSource.sourceHash, namespace);
    assert.equal(Object.keys(manifestSource.sourceStrings).length, Object.keys(extractedSource.sourceStrings).length);
  }
});

test("structured data localization translates text while preserving schema identifiers", () => {
  const source = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": "https://inspirlearning.com/#webpage",
    url: "https://inspirlearning.com/",
    name: "Start learning",
    description: "Learning is for everyone.",
    knowsAbout: ["AI tutoring", "Socratic learning"],
    publisher: { "@id": "https://inspirlearning.com/#organization", name: "inspir" },
  };
  const translations = new Map([
    ["Start learning", "शुरू करें"],
    ["Learning is for everyone.", "सीखना सभी के लिए है।"],
    ["AI tutoring", "एआई ट्यूशन"],
    ["Socratic learning", "सॉक्रेटिक सीखना"],
  ]);
  const localized = localizeStructuredDataValue(source, (value) => translations.get(value) ?? value) as typeof source;

  assert.equal(localized["@context"], "https://schema.org");
  assert.equal(localized["@type"], "WebPage");
  assert.equal(localized["@id"], "https://inspirlearning.com/#webpage");
  assert.equal(localized.url, "https://inspirlearning.com/");
  assert.equal(localized.name, "शुरू करें");
  assert.equal(localized.description, "सीखना सभी के लिए है।");
  assert.deepEqual(localized.knowsAbout, ["एआई ट्यूशन", "सॉक्रेटिक सीखना"]);
  assert.equal(localized.publisher.name, "inspir");

  const localizedUrls = localizeStructuredDataValue(
    {
      "@id": "https://inspirlearning.com/blog/example#webpage",
      url: "https://inspirlearning.com/blog/example",
      mainEntityOfPage: "https://inspirlearning.com/blog/example",
      publisher: { "@id": "https://inspirlearning.com/#organization", name: "inspir" },
      thumbnailUrl: "https://inspirlearning.com/inspir-social-preview.png",
    },
    (value) => translations.get(value) ?? value,
    undefined,
    "Spanish",
  ) as {
    "@id": string;
    url: string;
    mainEntityOfPage: string;
    publisher: { "@id": string; name: string };
    thumbnailUrl: string;
  };

  assert.equal(localizedUrls["@id"], "https://inspirlearning.com/es/blog/example#webpage");
  assert.equal(localizedUrls.url, "https://inspirlearning.com/es/blog/example");
  assert.equal(localizedUrls.mainEntityOfPage, "https://inspirlearning.com/es/blog/example");
  assert.equal(localizedUrls.publisher["@id"], "https://inspirlearning.com/#organization");
  assert.equal(localizedUrls.thumbnailUrl, "https://inspirlearning.com/inspir-social-preview.png");
});

test("translation lookup localizes template-composed text", () => {
  const lookup = createTranslationLookup([
    ["Mathematics", "गणित"],
    ["{value1} on inspir", "inspir पर {value1}"],
    ["{value1} AI learning modes", "{value1} एआई सीखने के मोड"],
  ]);

  assert.equal(lookup.translate("Mathematics"), "गणित");
  assert.equal(lookup.translate("Mathematics on inspir"), "inspir पर गणित");
  assert.equal(lookup.translate("Mathematics AI learning modes"), "गणित एआई सीखने के मोड");
  assert.equal(lookup.translate("Unknown text"), "Unknown text");
});
