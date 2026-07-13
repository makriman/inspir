import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SupportedLanguage } from "../lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { readStaticMainAppTranslations } from "../lib/i18n/static-main-app-translations";

type CuratedEntry = {
  key: string;
  source: string;
  value: string;
};

type CuratedPack = {
  entries: CuratedEntry[];
};

const workspaceRoot = process.cwd();
const curatedRoot = path.join(workspaceRoot, "translations", "curated");
const mainAppSourceStrings = getMainAppSourceStrings();
const mainAppSourceHash = getMainAppSourceHash(mainAppSourceStrings);
const mainAppLanguageByLocale = {
  ar: "Arabic",
  es: "Spanish",
  hi: "Hindi",
} as const satisfies Record<string, SupportedLanguage>;

function readPack(locale: string, filename: string): CuratedPack {
  if (filename === "main-app.json") {
    const language = mainAppLanguage(locale);
    assert.ok(language, `Unsupported tracked main-app locale ${locale}`);
    const translations = readStaticMainAppTranslations(
      {
        namespace: mainAppTranslationNamespace,
        sourceHash: mainAppSourceHash,
        sourceStrings: mainAppSourceStrings,
      },
      language,
      workspaceRoot,
    );
    assert.ok(translations, `Missing tracked main-app deploy bundle for ${locale}`);
    return {
      entries: Object.entries(mainAppSourceStrings).map(([key, source]) => ({
        key,
        source,
        value: translations[key] ?? "",
      })),
    };
  }

  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(curatedRoot, locale, filename), "utf8"),
  );
  assert.ok(isRecord(parsed) && Array.isArray(parsed.entries), `Invalid curated pack ${locale}/${filename}`);
  const entries: CuratedEntry[] = [];
  for (const entry of parsed.entries) {
    assert.ok(isRecord(entry), `Invalid curated entry ${locale}/${filename}`);
    const key = entry.key;
    const source = entry.source;
    const value = entry.value;
    assert.ok(typeof key === "string", `Invalid curated key ${locale}/${filename}`);
    assert.ok(typeof source === "string", `Invalid curated source ${locale}/${filename}`);
    assert.ok(typeof value === "string", `Invalid curated value ${locale}/${filename}`);
    entries.push({ key, source, value });
  }
  return { entries };
}

function mainAppLanguage(locale: string): SupportedLanguage | null {
  if (locale === "ar") return mainAppLanguageByLocale.ar;
  if (locale === "es") return mainAppLanguageByLocale.es;
  if (locale === "hi") return mainAppLanguageByLocale.hi;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireEntry(locale: string, filename: string, key: string) {
  const entry = readPack(locale, filename).entries.find(
    (candidate) => candidate.key === key,
  );
  assert.ok(entry, `${locale}/${filename}/${key}`);
  return entry;
}

test("Spanish protected route literals keep word boundaries and canonical copy", () => {
  const expected = {
    "site.2c5d950f9023b4c753":
      "inspir abre los modos de aprendizaje en /chat/{topicSlug}, para que los estudiantes lleguen directamente a la experiencia de aprendizaje con IA adecuada sin necesitar una conversación privada guardada.",
    "site.d915c021851d2ab6be":
      "Use https://inspirlearning.com para el sitio, /mission para la misión, /topics para el directorio público de modos de aprendizaje y /chat/learn-anything para la experiencia predeterminada de aprendizaje como invitado.",
  } as const;
  const repeatedFiles = [
    "route__about.json",
    "route__media.json",
    "route__mission.json",
    "route__schools.json",
    "route__trust.json",
  ];

  for (const filename of repeatedFiles) {
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(requireEntry("es", filename, key).value, value, `${filename}/${key}`);
    }
  }

  assert.equal(
    requireEntry("es", "route__topics.json", "site.a1fe70c3b9937a6d1d").value,
    "Son puntos de acceso reales a los modos públicos para invitados. Cada modo tiene un enlace /chat/{topicSlug}, indicaciones iniciales visibles y orientación de aprendizaje que cualquiera puede probar de inmediato.",
  );
});

test("Spanish relative route literals are separated from surrounding words", () => {
  const directory = path.join(curatedRoot, "es");
  const relativePathPattern =
    /(?<![:/A-Za-z0-9}])\/[a-z{][a-z0-9_{}-]*(?:\/[a-z{][a-z0-9_{}-]*)*/giu;
  const allowedBefore = /[\s([{"'«“—–:]/u;
  const allowedAfter = /[\s)\]}"'»”.,;:!?—–]/u;

  for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith(".json"))) {
    for (const entry of readPack("es", filename).entries) {
      const literals = [...new Set(entry.source.match(relativePathPattern) ?? [])];
      for (const literal of literals) {
        const index = entry.value.indexOf(literal);
        assert.notEqual(index, -1, `${filename}/${entry.key}/${literal}`);
        const before = index === 0 ? "" : entry.value[index - 1];
        const after = entry.value[index + literal.length] ?? "";
        if (before) {
          assert.match(before, allowedBefore, `before ${filename}/${entry.key}/${literal}`);
        }
        if (after) {
          assert.match(after, allowedAfter, `after ${filename}/${entry.key}/${literal}`);
        }
      }
    }
  }
});

test("Spanish repeated mission identities use the reviewed mission canonical", () => {
  const missionEntries = readPack("es", "route__mission.json").entries;
  const missionByIdentity = new Map(
    missionEntries.map((entry) => [`${entry.key}\u0000${entry.source}`, entry.value]),
  );
  const directory = path.join(curatedRoot, "es");

  for (const filename of fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json") && name !== "route__mission.json")) {
    for (const entry of readPack("es", filename).entries) {
      const canonical = missionByIdentity.get(`${entry.key}\u0000${entry.source}`);
      if (canonical === undefined) continue;
      assert.equal(entry.value, canonical, `${filename}/${entry.key}`);
    }
  }
});

test("mission audience labels use the existing school and learner canonicals", () => {
  const expectedStudents = {
    as: "শিক্ষাৰ্থীসকল",
    el: "Μαθητές",
    pl: "Uczniowie",
    ro: "Elevi",
    uk: "Учні",
  } as const;

  for (const [locale, value] of Object.entries(expectedStudents)) {
    assert.equal(
      requireEntry(locale, "route__mission.json", "site.fcfac3efb6ae696fcb").value,
      value,
      locale,
    );
  }

  assert.equal(
    requireEntry("as", "route__mission.json", "site.8d50862a1031d7cbc6").value,
    "শিক্ষণ সকলোৰে বাবে।",
  );
  assert.equal(
    requireEntry("mr", "route__mission.json", "site.15232ca14fa99ffee5").value,
    "ध्येय लोकांना AI समोर निष्क्रिय बनवणे नाही. प्रत्येक शिकणाऱ्याला विचारण्यासाठी, सरावासाठी, अभिप्राय मिळवण्यासाठी, पुन्हा प्रयत्न करण्यासाठी आणि आत्मविश्वास बांधण्यासाठी संयमी पहिली जागा देणे हे ध्येय आहे.",
  );
});

test("Arabic legal navigation uses site-navigation meanings", () => {
  const files = ["legal__privacy.json", "legal__terms.json", "legal__tnc.json"];
  for (const filename of files) {
    assert.equal(
      requireEntry("ar", filename, "site.70f8bb9a8a5393ef08").value,
      "الرئيسية",
      `${filename}/Home`,
    );
    assert.equal(
      requireEntry("ar", filename, "site.e4698d4ceacbe68b86").value,
      "الرسالة",
      `${filename}/Mission`,
    );
  }
});

test("Arabic main-app translations retain the four severe semantic repairs", () => {
  const expected = {
    "component.377bb29fd8b8":
      "نقود نحاسية، ولفائف من القماش، وعلاقات ائتمانية",
    "component.99072f1f6723":
      "مشكلة محتملة: الخلط بين الارتباط والسببية",
    "topic.socratic-instruction.subText":
      "مساحة استدلال موجّهة لطرح أسئلة منضبطة",
    "component.f927d36bbccb":
      "أظهر المعتقدات الرئيسية للشخص في ذلك الوقت، ونقاطه العمياء، وما يُرجّح أن يقاوم فهمه.",
  } as const;

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(requireEntry("ar", "main-app.json", key).value, value, key);
  }
});

test("Arabic main-app semantic gate catches long-string truncation missed by structure checks", () => {
  for (const entry of readPack("ar", "main-app.json").entries) {
    if (entry.source.length < 40) continue;
    assert.ok(
      entry.value.length >= Math.ceil(entry.source.length * 0.6),
      `${entry.key}: ${entry.value.length}/${entry.source.length}`,
    );
  }
});

test("Arabic main-app word-salad and hybrid repairs stay fluent", () => {
  const expected = {
    "age.modal.body":
      "أضف تاريخ ميلادك ولغتك المفضلة كي يتمكّن inspir من تكييف الأمثلة والنبرة وحدود السلامة ونص التطبيق مع تجربة تعلّمك.",
    "component.2ce8b9e121f0":
      "حرارة الحجر الرملي الأحمر، والحبر، والورق المعطّر، والصمت المنضبط، ولغات كثيرة تدور في فلك السلطة.",
    "component.3fb5f4e0ceaf":
      "استعد لمناقشة صفية حول استحواذ Tata على JLR",
    "component.b7fb265a3c44":
      "شظية أوستراكون (Ostrakon)",
    "component.e8717a83a9ba":
      "لا تشغّل هذا كتطبيق دردشة آلي عام أو كتقمّص لشخصية مشهورة.",
    "guest.continue.body":
      "سجّل الدخول بسهولة باستخدام Google، ثم يحفظ inspir سجلّ تعلّمك ولغتك المفضلة ومحادثاتك ليكون كل شيء جاهزًا في المرة القادمة. يظل استخدام inspir مجانيًا.",
    "language.prompt.body":
      "استخدم inspir باللغة التي تشعر أنها الأسهل لك. يمكنك تغييرها لاحقًا من ملفك الشخصي.",
    "onboarding.age.title":
      "ساعد inspir على التكيّف مع عمرك",
    "profile.details.googleEmail":
      "بريد Google الإلكتروني",
    "profile.header.title":
      "اجعل inspir يبدو وكأنه يعرف كيف تتعلّم.",
    "topic.citation-generator.description":
      "أنشئ مراجع بتنسيقات APA أو MLA أو Chicago أو Harvard، أو ببليوغرافيا بسيطة، من تفاصيل المصدر مع التحقق من الحقول الناقصة.",
    "topic.citation-generator.starter.0":
      "أنشئ مرجعًا بتنسيق APA",
    "topic.citation-generator.starter.1":
      "نسّق هذا الموقع وفق أسلوب MLA",
    "topic.collaborative-instruction.starter.1":
      "ابنِ معي شرحًا لعملية البناء الضوئي",
    "topic.grade-gpa-calculator.name":
      "حاسبة الدرجات ومعدل GPA",
    "topic.grade-gpa-calculator.starter.2":
      "خطّط للوصول إلى معدل GPA المستهدف",
    "topic.speaking-practice.starter.1":
      "تدرّب على محاكاة قسم التحدّث في اختبار IELTS",
    "component.b2f3fda7599a":
      "اشرح الفكرة بكلماتك، وقدّم مثالًا واحدًا ومثالًا مضادًا واحدًا، ثم طبّقها على حالة جديدة.",
    "component.f427ebda080f":
      "إذا كنت تفهم مفهومًا، فيمكنك تقديم مثال ومثال مضاد وحل حالة صغيرة غير مألوفة.",
  } as const;

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(requireEntry("ar", "main-app.json", key).value, value, key);
  }
});

test("Hindi and Spanish main-app semantic repairs stay complete and idiomatic", () => {
  const expected = {
    hi: {
      "component.46e32d8f91f3":
        "पिछली स्थिति को बनाए रखने वाला अन्वेषण, जिसमें निर्णयों के परिणाम और बदलते जोखिम शामिल हों।",
      "component.b6c87de6f0fd":
        "उस काल के अनुरूप और सामाजिक हैसियत से मेल खाते वस्त्र",
    },
    es: {
      "component.170fbf477bcc":
        "Aplica la idea a una situación nueva sin que te lleven de la mano.",
      "component.70f61e817363":
        "Época, cosmovisión pública, voz y aquello que los registros pueden respaldar.",
      "topic.citation-generator.starter.2":
        "Comprueba qué campos le faltan a mi cita",
      "topic.cornell-notes.description":
        "Convierte clases, lecturas o apuntes preliminares al método Cornell, con preguntas clave, notas principales, resumen y pautas de repaso.",
      "topic.matching-game-generator.subText":
        "Empareja términos, definiciones, causas y ejemplos",
    },
  } as const;

  for (const [locale, entries] of Object.entries(expected)) {
    for (const [key, value] of Object.entries(entries)) {
      assert.equal(requireEntry(locale, "main-app.json", key).value, value, `${locale}/${key}`);
    }
  }
});
