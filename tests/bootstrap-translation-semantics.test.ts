import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  supportedLanguages,
  type SupportedLanguage,
} from "../lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { readStaticMainAppTranslations } from "../lib/i18n/static-main-app-translations";

const workspaceRoot = process.cwd();
const mainAppSourceStrings = getMainAppSourceStrings();
const mainAppSource = {
  namespace: mainAppTranslationNamespace,
  sourceHash: getMainAppSourceHash(mainAppSourceStrings),
  sourceStrings: mainAppSourceStrings,
};

const bootstrapSiteValues: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ar: {
    "site.42c11babbea60523de": "قواعد الوصول الحالية للمسارات العامة والخاصة.",
    "site.4d31a14e3ac004dd3e": "هل محادثات الضيوف العامة متاحة؟",
    "site.9711f0284628a152bd": "نعم. يُفتح {value1} كوضع تعلّم عام للضيوف على {value2}، لذا يمكنك البدء ببضع رسائل مجانية كضيف قبل إنشاء حساب.",
    "site.193cb603180a74c92e": "حوّل هدف المستخدم إلى مسودة عمل مشتركة قبل تقديم النصيحة. ابدأ بقول: «أنشأت المسودة الأولية. عدّل ما تشاء. سأستجيب لتغييراتك». اطرح سؤالًا عمليًا واحدًا فقط عن السياق عند الحاجة، مع الاستمرار في إنشاء المسودة الأولية.",
    "site.a4d26ae1b3500af2f6": "نعم. تُفتح أوضاع الضيوف العامة، مثل «تعلّم أي شيء» و«التعليم السقراطي» و«مدرب الواجبات» والاختبارات والبطاقات التعليمية، مباشرةً من روابط بسيطة مثل /chat/{topicSlug}.",
    "site.1d357527da50cab875": "ابدأ برفيق التعلّم العام.",
    "site.9efaa42335ec444a7f": "تعلّم مجاني للضيوف، مع مسارات للمدارس والشركاء.",
    "site.a72eb3d150a98b94ed": "مسارات دراسية تربط أوضاع الضيوف والمطالبات والتدريب والأدلة ذات الصلة.",
    "site.d6ba5578e27d0d617b": "معلّم {value1} بالذكاء الاصطناعي",
    "site.2db8868061f2f29045": "ضوابط السلامة: {value1}",
    "site.2e70d2b0915c157e36": "جرّب إحدى هذه البدايات:",
  },
  hi: {
    "site.42c11babbea60523de": "सार्वजनिक और निजी रास्तों के लिए मौजूदा पहुँच नियम।",
    "site.4d31a14e3ac004dd3e": "क्या सार्वजनिक अतिथि चैट उपलब्ध हैं?",
    "site.9711f0284628a152bd": "हाँ। {value1}, {value2} पर सार्वजनिक अतिथि शिक्षण मोड के रूप में खुलता है, इसलिए खाता बनाने से पहले आप कुछ मुफ़्त अतिथि संदेशों से शुरुआत कर सकते हैं।",
    "site.193cb603180a74c92e": "सलाह देने से पहले उपयोगकर्ता के लक्ष्य को एक शुरुआती साझा मसौदे में बदलें। शुरुआत करें: \"मैंने पहला शुरुआती ढाँचा बना दिया है। आप कुछ भी बदल सकते हैं। मैं आपके बदलावों के अनुसार प्रतिक्रिया दूँगा।\" ज़रूरत हो तो संदर्भ से जुड़ा अधिकतम एक व्यावहारिक सवाल पूछें, लेकिन शुरुआती ढाँचा फिर भी बनाएँ।",
    "site.a4d26ae1b3500af2f6": "हाँ। कुछ भी सीखें, सुकराती शिक्षण, होमवर्क कोच, क्विज़ और फ्लैशकार्ड जैसे सार्वजनिक अतिथि मोड सीधे /chat/{topicSlug} जैसे सरल लिंक से खुलते हैं।",
    "site.1d357527da50cab875": "सार्वजनिक सीखने के साथी से शुरुआत करें।",
    "site.9efaa42335ec444a7f": "अतिथियों के लिए मुफ़्त सीखना, साथ ही स्कूलों और साझेदारों के लिए रास्ते।",
    "site.a72eb3d150a98b94ed": "अतिथि मोड, प्रॉम्प्ट, अभ्यास और संबंधित मार्गदर्शिकाओं को जोड़ने वाले अध्ययन कार्यप्रवाह।",
    "site.d6ba5578e27d0d617b": "{value1} एआई ट्यूटर",
    "site.2db8868061f2f29045": "सुरक्षा सीमाएँ: {value1}",
    "site.2e70d2b0915c157e36": "इन शुरुआती वाक्यों में से कोई आज़माएँ:",
  },
  ml: {
    "site.42c11babbea60523de": "പൊതു, സ്വകാര്യ റൂട്ടുകൾക്കുള്ള നിലവിലെ പ്രവേശന നിയമങ്ങൾ.",
    "site.4d31a14e3ac004dd3e": "പൊതു അതിഥി ചാറ്റുകൾ ലഭ്യമാണോ?",
    "site.9711f0284628a152bd": "അതെ. {value1}, {value2}-ൽ ഒരു പൊതു അതിഥി പഠന മോഡായി തുറക്കുന്നു; അതിനാൽ അക്കൗണ്ട് സൃഷ്ടിക്കുന്നതിന് മുമ്പ് കുറച്ച് സൗജന്യ അതിഥി സന്ദേശങ്ങളോടെ തുടങ്ങാം.",
    "site.193cb603180a74c92e": "ഉപദേശം നൽകുന്നതിന് മുമ്പ് ഉപയോക്താവിന്റെ ലക്ഷ്യം ഒരു പ്രാഥമിക പങ്കിട്ട കരടാക്കി മാറ്റുക. ഇങ്ങനെ തുടങ്ങുക: \"ഞാൻ ആദ്യത്തെ പ്രാഥമിക ഘടന തയ്യാറാക്കി. എന്തും തിരുത്താം. നിങ്ങളുടെ മാറ്റങ്ങൾക്ക് അനുസരിച്ച് ഞാൻ പ്രതികരിക്കും.\" ആവശ്യമെങ്കിൽ സാഹചര്യത്തെക്കുറിച്ച് പരമാവധി ഒരു പ്രായോഗിക ചോദ്യം ചോദിക്കാം; എന്നിരുന്നാലും പ്രാഥമിക ഘടന തയ്യാറാക്കണം.",
    "site.a4d26ae1b3500af2f6": "അതെ. എന്തും പഠിക്കൂ, സോക്രട്ടിക് അധ്യാപനം, ഗൃഹപാഠ സഹായി, ക്വിസുകൾ, ഫ്ലാഷ്‌കാർഡുകൾ തുടങ്ങിയ പൊതു അതിഥി രീതികൾ ലളിതമായ /chat/{topicSlug} ലിങ്കുകളിൽനിന്ന് നേരിട്ട് തുറക്കുന്നു.",
    "site.1d357527da50cab875": "പൊതു പഠന സഹായിയുമായി തുടങ്ങുക.",
    "site.9efaa42335ec444a7f": "അതിഥികൾക്ക് സൗജന്യ പഠനം; സ്കൂളുകൾക്കും പങ്കാളികൾക്കും അനുയോജ്യമായ വഴികളോടെ.",
    "site.a72eb3d150a98b94ed": "അതിഥി മോഡുകൾ, പ്രോംപ്റ്റുകൾ, പരിശീലനം, ബന്ധപ്പെട്ട മാർഗ്ഗനിർദ്ദേശങ്ങൾ എന്നിവ ബന്ധിപ്പിക്കുന്ന പഠന പ്രവർത്തനരീതികൾ.",
    "site.d6ba5578e27d0d617b": "{value1} AI ട്യൂട്ടർ",
    "site.2db8868061f2f29045": "സുരക്ഷാ പരിധികൾ: {value1}",
    "site.2e70d2b0915c157e36": "ഈ തുടക്കങ്ങളിൽ ഒന്ന് പരീക്ഷിക്കുക:",
  },
};

const bootstrapMainValues: Partial<
  Record<SupportedLanguage, Readonly<Record<string, string>>>
> = {
  Arabic: {
    "activity.flashcards.review.anotherAction": "أنشئ مجموعة بطاقات أخرى",
    "activity.flashcards.start.action": "أنشئ مجموعة بطاقات",
    "activity.flashcards.stat.left": "المتبقي",
    "component.c32c06424e70": "إغلاق الملف الشخصي",
    "guest.continue.google": "المتابعة باستخدام Google",
    "memory.actions.clearAll": "مسح الكل",
    "memory.status.off": "متوقفة لهذا الحساب",
    "onboarding.age.body": "أخبرنا بتاريخ ميلادك حتى نبني تجربة تعلّم مناسبة للعمر. نستخدمه لضبط الأمثلة والنبرة وحدود السلامة.",
    "topic.learn-anything.inputboxText": "ما الذي يثير فضولك اليوم؟",
    "topic.learn-anything.subText": "شروحات واضحة لكل فضول",
  },
  Hindi: {
    "activity.flashcards.progress": "कुल {total} में से कार्ड {current}",
    "activity.flashcards.stat.left": "शेष",
    "component.c32c06424e70": "प्रोफ़ाइल बंद करें",
    "guest.continue.google": "Google के साथ जारी रखें",
    "memory.notice.body": "inspir जो कुछ याद रखता है, वह नीचे संपादन योग्य मेमोरी कार्ड के रूप में दिखता है। आप कभी भी जोड़, संपादित, मिटा या साफ़ कर सकते हैं।",
    "memory.summary.correct": "inspir को क्या याद रखना चाहिए, उसे सुधारें या जोड़ें।",
    "profile.memory.title": "inspir क्या याद रख सकता है",
    "topic.learn-anything.inputboxText": "आज आप किस बारे में जिज्ञासु हैं?",
    "topic.learn-anything.subText": "हर जिज्ञासा के लिए साफ़ समझ",
  },
  Hausa: {
    "component.e36edd1713a8": "Ƙayyade abin da muke ƙerawa da ƙa'idar da dole ne ya cika.",
  },
  Marathi: {
    "topic.accountability-partner.starter.0": "साप्ताहिक जबाबदारीची व्यवस्था करा",
  },
  Yoruba: {
    "component.6cc11866dd7d": "Ìlànà àtúnṣe àṣìṣe = tún àṣìṣe náà ṣe, ya ohun tó fa á sọ́tọ̀, ṣe àròjinlẹ̀, dán àyípadà kan wò, kí o sì jẹ́risi abajade.",
    "component.968d8ccd3939": "Tang Chang'an jẹ́ olú-ìlú ọba àgbáyé kan tí ó ní ìbáṣepọ̀ pẹ̀lú àwọn nẹ́tíwọ́ọ̀kì pẹ̀tẹ́lẹ̀ koríko, Àárín Gbùngbùn Éṣíà, àti ẹ̀sìn Búdà.",
    "topic.diagram-labeling-practice.description": "Yí àwọn àwòrán ìlà, ètò ara, máàpù, ìṣàn iṣẹ́, tàbí ìṣètò yàrá ìdánwò padà sí àṣà fífi àkọlé sí wọn pẹ̀lú àwọn àmọ̀ràn àti àyẹ̀wò ìdáhùn.",
    "topic.study-timer.subText": "Aago Pomodoro tí ń bá a lọ pẹ̀lú àwọn ìkìlọ̀",
  },
};

test("reviewed bootstrap site translations stay canonical across every repeated pack", () => {
  for (const [locale, expected] of Object.entries(bootstrapSiteValues)) {
    const directory = path.join(workspaceRoot, "translations", "curated", locale);
    const seen = new Map<string, number>();
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json") && name !== "main-app.json")) {
      const entries = parseSiteEntries(
        JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")),
        `${locale}/${file}`,
      );
      for (const entry of entries) {
        const value = expected[entry.key];
        if (value === undefined) continue;
        assert.equal(entry.value, value, `${locale}/${file}/${entry.key}`);
        seen.set(entry.key, (seen.get(entry.key) ?? 0) + 1);
      }
    }
    for (const key of Object.keys(expected)) {
      assert.ok((seen.get(key) ?? 0) > 0, `missing ${locale}/${key}`);
    }
  }
});

test("reviewed account, memory, activity, and recovery translations remain in static main bundles", () => {
  for (const language of supportedLanguages) {
    const expected = bootstrapMainValues[language];
    if (!expected) continue;
    const strings = readStaticMainAppTranslations(mainAppSource, language, workspaceRoot);
    assert.ok(strings, language);
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(strings[key], value, `${language}/${key}`);
    }
  }
});

function parseSiteEntries(value: unknown, label: string) {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error(`Invalid bootstrap site translation pack: ${label}`);
  }

  return value.entries.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw new Error(`Invalid bootstrap site translation entry: ${label}/${index}`);
    }
    return { key: entry.key, value: entry.value };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
