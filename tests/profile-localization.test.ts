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
import {
  recommendLanguage,
  recommendLanguageFromAcceptLanguage,
  recommendLanguageFromCountry,
} from "../lib/i18n/language-detection";
import { resolveRequestLanguage } from "../lib/i18n/language-preference";
import { localizeStructuredDataValue } from "../lib/i18n/metadata";
import {
  isStaticSiteLanguageAvailableForPath,
  localizeStaticSiteHref,
} from "../lib/i18n/static-availability";
import {
  getEnglishMainAppTranslationBundle,
  getMainAppSourceHash,
  getMainAppSourceStrings,
} from "../lib/i18n/main-app-source";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
  getSiteSourceStrings,
  getSiteTranslationNamespacesForPath,
  legalEnglishControlsNotice,
  marketingShellTranslationNamespace,
} from "../lib/i18n/site-source";
import { translationStringsFromDbPayload } from "../lib/i18n/db-translations";
import {
  getLocalizedPathInfo,
  languageAlternatesForPath,
  localizeHref,
  localizePath,
  removeLocaleFromPath,
} from "../lib/i18n/routing";
import { createTranslationLookup } from "../lib/i18n/translation-lookup";
import {
  isTranslationBundleCompleteAndFluent,
  isTranslationFieldLikelyFluent,
} from "../lib/i18n/translation-quality";
import { isValidFieldTranslation } from "../lib/i18n/translation-field-validation";
import { isFreshAppTranslation, validateTranslationPayload } from "../lib/i18n/translation-validation";
import { calculateAge, validateDateOfBirth } from "../lib/profile/age";
import {
  isOversizedProfileImageUpload,
  maxProfileImageBytes,
  maxProfileImageUploadRequestBytes,
  prepareProfileImage,
} from "../lib/profile/photo";
import {
  isValidProfileImageObjectKey,
  profileImageObjectKey,
} from "../lib/profile/photo-key";
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

test("profile photo validation accepts small real image types only", async () => {
  const jpeg = await prepareProfileImage(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), "application/octet-stream");
  assert.equal(jpeg.success, true);
  if (jpeg.success) {
    assert.equal(jpeg.mimeType, "image/jpeg");
    assert.ok(jpeg.hash);
  }

  const invalid = await prepareProfileImage(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf");
  assert.equal(invalid.success, false);

  const truncatedPng = await prepareProfileImage(new Uint8Array([0x89, 0x50, 0x4e]), "image/png");
  assert.equal(truncatedPng.success, false);

  const spoofedMime = await prepareProfileImage(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "image/png");
  assert.equal(spoofedMime.success, false);

  const tooLarge = await prepareProfileImage(new Uint8Array(maxProfileImageBytes + 1), "image/png");
  assert.equal(tooLarge.success, false);
});

test("profile photo upload preflight rejects oversized content length", () => {
  assert.equal(isOversizedProfileImageUpload(null), false);
  assert.equal(isOversizedProfileImageUpload("not-a-number"), false);
  assert.equal(isOversizedProfileImageUpload(String(maxProfileImageUploadRequestBytes)), false);
  assert.equal(isOversizedProfileImageUpload(String(maxProfileImageUploadRequestBytes + 1)), true);
});

test("profile photo R2 keys are unique per upload without exposing user ids", async () => {
  const [firstKey, secondKey] = await Promise.all([
    profileImageObjectKey("user@example.com", "a".repeat(64)),
    profileImageObjectKey("user@example.com", "a".repeat(64)),
  ]);
  const uniqueKeyPattern = /^profile-images\/users\/[a-f0-9]{2}\/[a-f0-9]{64}\/a{64}\/[a-f0-9-]{36}$/;
  assert.match(firstKey, uniqueKeyPattern);
  assert.match(secondKey, uniqueKeyPattern);
  assert.notEqual(firstKey, secondKey);
  assert.equal(firstKey.includes("user@example.com"), false);
  assert.equal(firstKey.includes(".."), false);
  assert.equal(isValidProfileImageObjectKey(firstKey), true);

  const historicalKey = `profile-images/users/${"b".repeat(2)}/${"b".repeat(64)}/${"c".repeat(64)}`;
  assert.equal(isValidProfileImageObjectKey(historicalKey), true);
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
  const sourceHash = getMainAppSourceHash();

  assert.equal(bundle.sourceHash, sourceHash);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.sourceStrings), true);
  assert.strictEqual(getMainAppSourceStrings(), getMainAppSourceStrings());
  assert.strictEqual(getMainAppSourceStrings(), bundle.sourceStrings);
  assert.strictEqual(getEnglishMainAppTranslationBundle(), bundle);
  assert.strictEqual(getEnglishMainAppTranslationBundle().sourceStrings, bundle.sourceStrings);
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

test("database translation payloads fail closed unless every expected string is verified", () => {
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
    {},
  );

  assert.deepEqual(
    translationStringsFromDbPayload(source, {
      title: "Aprende cualquier cosa",
      action: "Continuar",
      unchanged: "inspir",
      languageSpecific: "Blog",
      empty: "Guardado",
      unknown: "Ignored",
    }, "Spanish"),
    {
      title: "Aprende cualquier cosa",
      action: "Continuar",
      unchanged: "inspir",
      languageSpecific: "Blog",
      empty: "Guardado",
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

test("field translation validation rejects unchanged capitalized UI copy", () => {
  assert.equal(isValidFieldTranslation("Privacy Policy", "Privacy Policy", "Hindi"), false);
  assert.equal(isValidFieldTranslation("Get Started Now", "Get Started Now", "Hindi"), false);
  assert.equal(isValidFieldTranslation("Task Board", "Task Board", "Hindi"), false);
  assert.equal(isValidFieldTranslation("For", "For", "Chinese"), false);
  assert.equal(isValidFieldTranslation("For", "For", "Yoruba"), false);
  assert.equal(isValidFieldTranslation("Age", "Age", "French"), false);
  assert.equal(isValidFieldTranslation("GET STARTED", "GET STARTED", "Spanish"), false);
  assert.equal(isValidFieldTranslation("STEM", "STEM", "Spanish"), true);
  assert.equal(
    isValidFieldTranslation("Freedman accountant", "Freedman accountant", "Dutch"),
    false,
  );
  assert.equal(isValidFieldTranslation("XP & Leveling", "XP & Leveling", "Malay"), false);
});

test("translation fluency preserves explicit historical names across localized punctuation", () => {
  const source = "Ada Lovelace, Cleopatra, B. R. Ambedkar...";

  assert.equal(isValidFieldTranslation(source, source, "Spanish"), true);
  assert.equal(isTranslationFieldLikelyFluent(source, source, "Spanish"), true);
  assert.equal(
    isTranslationFieldLikelyFluent(
      source,
      "Ada Lovelace、Cleopatra、B. R. Ambedkar...",
      "Japanese",
    ),
    true,
  );
  assert.equal(isTranslationFieldLikelyFluent("Privacy Policy", "Privacy Policy", "Hindi"), false);
});

test("translation fluency rejects exact English scaffolding and short non-Latin hybrids", () => {
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Important events, facts learned, and uncertainty notes stay visible.",
      "Impotant events, facts aprendered, y uncertainty notas stay visible.",
      "Spanish",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "It is impossible to know anything until terminal value is calculated.",
      "It es impossible un know anything until terminal valo es calculated.",
      "Spanish",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Right. Transfer to a fresh example is stronger evidence than recognition.",
      "Right. Transfer un un fresh ejemplo es más fuerte evidencia than recognition.",
      "Spanish",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Assistant to a trading household or workshop",
      "Assistant un un trading household o wokshop",
      "Spanish",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Public learning pages are open, while API routes remain blocked.",
      "Public öğrenme pages are open, while API rotaları remain blocked.",
      "Turkish",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent("Time travel", "Time यात्रा", "Hindi"),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Work through fractions",
      "Work के ज़रिए fractions",
      "Hindi",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Debate with a personality",
      "Debate के साथ a personality",
      "Hindi",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Pick the strongest",
      "समझें: Pick the strongest",
      "Hindi",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "How do I look at a painting?",
      "हिंदी में: How do I look at a painting?",
      "Hindi",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "The goal is not to make people passive in front of AI. The goal is to give every learner a patient first place to ask, practise, get feedback, try again, and build confidence.",
      "Cíl is ne k make people passive v front z AI. cíl is k give every student patient nejprve place k ask, practise, get zpětná vazba, vyzkoušet again, build confidence.",
      "Czech",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Unlike a generic chatbot, inspir organizes AI around learning modes so learners can start with the kind of help they need: hints, questions, quizzes, active recall, roleplay, debate, or feedback.",
      "Unlike ein generic chatbot, inspir organizes AI rund um Lernen Modi damit Lernende kann starten mit die kind von help sie brauchen: hints, Fragen, Quizze, aktives Abrufen, Rollenspiel, Debatte, oder Feedback.",
      "German",
    ),
    false,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "inspir is a free AI learning platform with public guest modes for explanations, Socratic tutoring, homework coaching, quizzes, flashcards, debate, roleplay, writing feedback, and study planning.",
      "inspir is a مجاني تعلم AI platform مع عام وضع الضيفs لـ explanations، مدرب سقراطيing، الواجبات coaching، اختبارات، بطاقات تعليمية، نقاش، تمثيل أدوار، الكتابة تغذية راجعة، و الدراسة planning.",
      "Arabic",
    ),
    false,
  );
});

test("translation fluency keeps protected names, technical terms, and fully translated short copy", () => {
  assert.equal(
    isTranslationFieldLikelyFluent(
      "From inspir.app to inspirlearning.com",
      "Von inspir.app zu inspirlearning.com",
      "German",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Format this website in MLA",
      "Formatieren Sie diese Website in MLA",
      "German",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "From inspir.app to inspirlearning.com",
      "inspir.app से inspirlearning.com तक",
      "Hindi",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Meet B. R. Ambedkar in committee",
      "समिति में B. R. Ambedkar से मिलें",
      "Hindi",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent("Google email", "Google ईमेल", "Hindi"),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent("Mock IELTS speaking", "IELTS बोलने का अभ्यास", "Hindi"),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent("Time travel", "समय यात्रा", "Hindi"),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "DeepHack recognition",
      "የDeepHack እውቅና",
      "Amharic",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "The goal is to help people find the right public learning page quickly. Public routes, guides, and learning hubs are open; API, admin, reset, and private utility routes stay closed.",
      "الهدف هو مساعدة الناس على العثور بسرعة على صفحة التعلم العامة المناسبة. المسارات والأدلة ومراكز التعلم العامة مفتوحة، بينما تظل مسارات API وadmin وreset والمسارات المساعدة الخاصة مغلقة.",
      "Arabic",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Format this website in MLA",
      "Formate este website em MLA",
      "Portuguese",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Try first: a value logs as undefined right after a fetch call. What is the most useful first check?",
      "መጀመሪያ ሞክር፦ fetch call በኋላ ዋጋ undefined ብሎ ይመዘገባል። በጣም ጠቃሚው የመጀመሪያ ምርመራ ምንድነው?",
      "Amharic",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "St Paul's Cathedral was destroyed",
      "Nawasak ang St Paul's Cathedral",
      "Filipino",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Work through algebra, calculus, word problems, and math concepts one step at a time with an AI coach.",
      "Aralin ang algebra, calculus, problemang pasalaysay, at mga konsepto sa matematika nang paisa-isang hakbang kasama ang AI coach.",
      "Filipino",
    ),
    true,
  );
  assert.equal(
    isTranslationFieldLikelyFluent(
      "Jury's Choice recognition from Amod Malviya at DeepHack for AI learning work.",
      "Karramawar Jury's Choice daga Amod Malviya a DeepHack saboda aikin koyon AI.",
      "Hausa",
    ),
    true,
  );
});

test("locale routing helpers preserve canonical English and prefix non-English paths", () => {
  assert.equal(localizePath("/", "Spanish"), "/es");
  assert.equal(localizePath("/blog/example", "Spanish"), "/es/blog/example");
  assert.equal(localizePath("/blog/example", "English"), "/blog/example");
  assert.equal(localizeHref("/topics?tab=math", "Hindi"), "/hi/topics?tab=math");
  assert.equal(removeLocaleFromPath("/hi/topics?tab=math#practice"), "/topics?tab=math#practice");
  assert.equal(localizeHref("/hi/topics?tab=math#practice", "Spanish"), "/es/topics?tab=math#practice");
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

test("static locale availability admits only render-localized page bodies", () => {
  assert.equal(isStaticSiteLanguageAvailableForPath("/", "Spanish"), true);
  assert.equal(isStaticSiteLanguageAvailableForPath("/mission", "Spanish"), true);
  assert.equal(isStaticSiteLanguageAvailableForPath("/about", "Spanish"), false);
  assert.equal(isStaticSiteLanguageAvailableForPath("/mission", "Hindi"), true);
  assert.equal(isStaticSiteLanguageAvailableForPath("/reset_pw", "Spanish"), false);
  assert.equal(localizeStaticSiteHref("/mission?source=home#principles", "Spanish"), "/es/mission?source=home#principles");
  assert.equal(
    localizeStaticSiteHref("/mission?source=home#principles", "Hindi"),
    "/hi/mission?source=home#principles",
  );
  assert.equal(localizeStaticSiteHref("/chat/learn-anything?source=home", "Hindi"), "/hi/chat/learn-anything?source=home");
  assert.equal(localizeStaticSiteHref("/blog/ai-learn-anything-guide", "Spanish"), "/blog/ai-learn-anything-guide");
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

test("browser language skips unknown tags and takes precedence over country inference", () => {
  assert.equal(recommendLanguageFromAcceptLanguage("xx,es;q=0.9"), "Spanish");
  assert.equal(recommendLanguageFromAcceptLanguage("xx,fr;q=0"), null);
  assert.equal(recommendLanguage({ countryCode: "ES", acceptLanguage: "fr-FR,fr;q=0.9" }), "French");
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

test("site translation fluency gate rejects mixed-language complete bundles", () => {
  const source = {
    namespace: "route:mission",
    sourceHash: "test-source",
    sourceStrings: {
      "site.example":
        "Every public mode is a doorway into a different learning behavior, so the format can match the job instead of forcing every learner into one generic chat box.",
    },
  };
  const bundle = {
    ...source,
    language: "Spanish" as const,
    strings: {
      "site.example":
        "Every público modo is a doorway into a different aprendizaje behavior, so the format can match the job instead of forcing every learner into one generic chat box.",
    },
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, bundle, "Spanish"), false);
});

test("site translation fluency gate rejects Latin scaffolding in a non-Latin translation", () => {
  const source = {
    namespace: "marketing-shell",
    sourceHash: "test-source",
    sourceStrings: {
      "site.example": "The film has a text transcript, timed captions, and chapter markers on the page.",
    },
  };
  const bundle = {
    ...source,
    language: "Hindi" as const,
    strings: {
      "site.example": "film has एक text transcript, timed captions, और chapter markers on पेज.",
    },
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, bundle, "Hindi"), false);
});

test("site translation fluency gate permits translated prose with shared short words", () => {
  const source = {
    namespace: "route:home",
    sourceHash: "test-source",
    sourceStrings: {
      "site.example": "Use the exam date, syllabus, available time, and weak areas to create a plan that can survive real life.",
    },
  };
  const bundle = {
    ...source,
    language: "Portuguese" as const,
    strings: {
      "site.example": "Use a data da prova, o programa, o tempo disponível e as áreas fracas para criar um plano que sobreviva à vida real.",
    },
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, bundle, "Portuguese"), true);
});

test("site translation fluency gate preserves target-language diacritics during leakage checks", () => {
  const source = {
    namespace: "route:home",
    sourceHash: "test-source",
    sourceStrings: {
      "site.example": "Turn the explanation into active recall cards with one conceptual card, one example card, and one misconception card.",
    },
  };
  const bundle = {
    ...source,
    language: "Vietnamese" as const,
    strings: {
      "site.example": "Biến lời giải thích thành thẻ gợi nhớ chủ động gồm một thẻ khái niệm, một thẻ ví dụ và một thẻ hiểu lầm thường gặp.",
    },
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, bundle, "Vietnamese"), true);
});

test("site translation fluency gate rejects embedded untranslated mode names", () => {
  const source = {
    namespace: "route:home",
    sourceHash: "test-source",
    sourceStrings: {
      "site.example": "Start with Learn Anything",
    },
  };
  const bundle = {
    ...source,
    language: "Czech" as const,
    strings: {
      "site.example": "Začněte s Learn Anything",
    },
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, bundle, "Czech"), false);
});

test("site translation fluency gate rejects one generic value reused for unrelated copy", () => {
  const source = {
    namespace: "marketing-shell",
    sourceHash: "test-source",
    sourceStrings: {
      "site.about": "About",
      "site.media": "Media",
      "site.trust": "Trust",
    },
  };
  const bundle = {
    ...source,
    language: "Czech" as const,
    strings: {
      "site.about": "Část učení inspir",
      "site.media": "Část učení inspir",
      "site.trust": "Část učení inspir",
    },
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, bundle, "Czech"), false);
});

test("site translation fluency gate rejects unchanged UI copy and broken placeholders", () => {
  const source = {
    namespace: "marketing-shell",
    sourceHash: "test-source",
    sourceStrings: {
      answer: "Answer",
      greeting: "Hello {name}",
    },
  };
  const unchanged = {
    ...source,
    language: "Spanish" as const,
    strings: { answer: "Answer", greeting: "Hola {name}" },
  };
  const wrongPlaceholder = {
    ...source,
    language: "Spanish" as const,
    strings: { answer: "Respuesta", greeting: "Hola {wrong}" },
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, unchanged, "Spanish"), false);
  assert.equal(isTranslationBundleCompleteAndFluent(source, wrongPlaceholder, "Spanish"), false);
});
