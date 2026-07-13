import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { readStaticMainAppTranslations } from "../lib/i18n/static-main-app-translations";
import { isTranslationBundleCompleteAndFluent } from "../lib/i18n/translation-quality";

const workspaceRoot = process.cwd();
const spanishRoot = path.join(workspaceRoot, "translations/curated/es");
const auditedMainAppCorrections = parseStringRecord(JSON.parse(
  fs.readFileSync(
    path.join(workspaceRoot, "tests/fixtures/spanish-main-app-corrections.json"),
    "utf8",
  ),
));
const mainAppSourceStrings = getMainAppSourceStrings();
const spanishMainApp = readStaticMainAppTranslations(
  {
    namespace: mainAppTranslationNamespace,
    sourceHash: getMainAppSourceHash(mainAppSourceStrings),
    sourceStrings: mainAppSourceStrings,
  },
  "Spanish",
  workspaceRoot,
);

type CuratedEntry = { key: string; source: string; value: string };
type CuratedPack = {
  language: string;
  locale: string;
  namespace: string;
  sourceHash: string;
  entries: CuratedEntry[];
};

const sitePacks = fs.readdirSync(spanishRoot)
  .filter((file) => file.endsWith(".json") && file !== "main-app.json")
  .sort()
  .map((file) => ({
    file,
    pack: parseCuratedPack(
      JSON.parse(fs.readFileSync(path.join(spanishRoot, file), "utf8")),
      file,
    ),
  }));

const malformedSpanishSpacing = /(?:\s+[.,;:!?](?:$|\s)|[¿¡]\s)/u;
const knownSpanishCorruption = /(?:- ¿Qué quieres\?|¿Cómo está\?|¿No es cierto\?|Tabla de dibujo\/dibujo|¡\s*Ayuda\s*!|Hazme una prueba en Trivia|\b10 MCQs\b|Recuento de interrupción|Generador de juego de juego|Resumidor de texto|No por esta cuenta)/iu;

test("Spanish main-app keeps audited account, memory, activity, and topic copy", () => {
  assert.ok(spanishMainApp);
  const expected = {
    "activity.flashcards.review.anotherAction": "Crear otro mazo",
    "activity.flashcards.stat.left": "Restantes",
    "activity.quiz.progress": "Pregunta {current} de {total}",
    "auth.signInError": "No hemos podido iniciar sesión. Inténtalo de nuevo.",
    "component.d614793e93c0": "Ponme a prueba",
    "guest.continue.body": "Inicia sesión fácilmente con Google y, después, inspir guardará tu historial de aprendizaje, tu idioma preferido y tus chats para que todo esté listo la próxima vez. inspir seguirá siendo gratuito.",
    "memory.actions.clearAll": "Borrar todo",
    "memory.actions.save": "Guardar",
    "memory.status.off": "Desactivada para esta cuenta",
    "memory.toggle.on": "Activada",
    "onboarding.age.title": "Ayuda a inspir a adaptarse a tu edad",
    "profile.account.logout": "Cerrar sesión",
    "profile.details.displayName": "Nombre para mostrar",
    "profile.memory.title": "Lo que inspir puede recordar",
    "topic.break-reminder.name": "Recordatorio de descanso",
    "topic.draw-sketch-board.name": "Pizarra de dibujo",
    "topic.image-analysis-coach.category": "Ayuda con IA",
    "topic.quiz-me-on-trivia.name": "Ponme a prueba con preguntas de cultura general",
    "topic.quiz-me-on-trivia.subText": "10 preguntas de opción múltiple sobre cualquier tema, con puntuación",
    "topic.source-critic.subText": "Evalúa la credibilidad y los sesgos",
    "topic.spaced-review.name": "Repaso espaciado",
    "topic.study-streaks.name": "Rachas de estudio",
    "topic.text-summarizer.name": "Generador de resúmenes",
    "topic.worksheet-builder.description": "Crea hojas de trabajo con tipos de preguntas como rellenar espacios en blanco, preguntas de opción múltiple, verdadero/falso, respuestas cortas y ejercicios de correspondencia.",
  } as const;

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(spanishMainApp[key], value, key);
  }
});

test("Spanish main-app keeps every audited linguistic repair", () => {
  assert.ok(spanishMainApp);
  assert.equal(Object.keys(auditedMainAppCorrections).length, 423);

  for (const [key, value] of Object.entries(auditedMainAppCorrections)) {
    assert.ok(key in mainAppSourceStrings, `unknown Spanish regression key ${key}`);
    assert.equal(spanishMainApp[key], value, key);
    assert.deepEqual(placeholders(value), placeholders(mainAppSourceStrings[key]), `placeholders ${key}`);
  }
});

test("Spanish translation values reject the audited punctuation and artifact families", () => {
  assert.ok(spanishMainApp);
  for (const [key, value] of Object.entries(spanishMainApp)) {
    assert.equal(value, value.normalize("NFC"), `non-NFC main-app/${key}`);
    assert.doesNotMatch(value, malformedSpanishSpacing, `malformed spacing in main-app/${key}`);
    assert.doesNotMatch(value, knownSpanishCorruption, `known corruption in main-app/${key}`);
  }

  for (const { file, pack } of sitePacks) {
    assert.equal(pack.language, "Spanish", file);
    assert.equal(pack.locale, "es", file);
    assert.match(pack.sourceHash, /^[a-f0-9]{64}$/, file);
    for (const entry of pack.entries) {
      assert.equal(entry.value, entry.value.normalize("NFC"), `non-NFC ${file}/${entry.key}`);
      assert.deepEqual(placeholders(entry.value), placeholders(entry.source), `placeholders ${file}/${entry.key}`);
      assert.doesNotMatch(entry.value, malformedSpanishSpacing, `malformed spacing in ${file}/${entry.key}`);
      assert.doesNotMatch(entry.value, knownSpanishCorruption, `known corruption in ${file}/${entry.key}`);
      if (entry.source.startsWith("Yes.")) {
        assert.match(entry.value, /^Sí\./u, `Spanish yes-answer prefix in ${file}/${entry.key}`);
      }
    }
  }
});

test("Spanish route-home translations remain canonical for identical shared site keys", () => {
  const home = sitePacks.find(({ file }) => file === "route__home.json")?.pack;
  assert.ok(home);
  const homeByKey = new Map(home.entries.map((entry) => [entry.key, entry]));

  for (const { file, pack } of sitePacks) {
    if (file === "route__home.json") continue;
    for (const entry of pack.entries) {
      const canonical = homeByKey.get(entry.key);
      if (!canonical || canonical.source !== entry.source) continue;
      assert.equal(entry.value, canonical.value, `${file}/${entry.key}`);
    }
  }
});

test("Spanish legal privacy copy passes the shared complete-and-fluent gate", () => {
  const legal = sitePacks.find(({ file }) => file === "legal__privacy.json")?.pack;
  assert.ok(legal);
  const sourceStrings = Object.fromEntries(legal.entries.map((entry) => [entry.key, entry.source]));
  const source = {
    namespace: legal.namespace,
    sourceHash: legal.sourceHash,
    sourceStrings,
  };
  const bundle = {
    ...source,
    language: "Spanish" as const,
    strings: Object.fromEntries(legal.entries.map((entry) => [entry.key, entry.value])),
  };

  assert.equal(isTranslationBundleCompleteAndFluent(source, bundle, "Spanish"), true);
});

test("Spanish repeated route and FAQ keys keep their audited semantic values", () => {
  const expected = {
    "site.0320ac9cef49bf6819": "Siguiente paso",
    "site.09b147c2709a66e103": "¿inspir ofrece soluciones para escuelas?",
    "site.0c8b27aca2d5e45f71": "¿inspir publica los chats privados de un menor?",
    "site.0e2b94f596aa9eac3f": "Genera exactamente 10 preguntas de opción múltiple, preséntalas de una en una, califica las respuestas en el servidor y revísalas solo después de responder.",
    "site.1f683bad50d2662168": "Finales de 2022",
    "site.251edb415d354f2aea": "Desbloquéate con las tareas",
    "site.2a90a8b22a57c0b210": "¿En qué se diferencia {value1} de un chatbot de IA genérico?",
    "site.565557754d90d3800d": "¿Para quién es inspir?",
    "site.5728bdb5f3eb838312": "Ponme a prueba con preguntas de cultura general",
    "site.701c0e1b8668dc6401": "Crea hojas de trabajo con tipos de preguntas como rellenar espacios en blanco, preguntas de opción múltiple, verdadero/falso, respuestas cortas y ejercicios de correspondencia.",
    "site.814b66298cd294012b": "Deja de posponer las matemáticas",
    "site.8db561c2dc80b4a00f": "Le damos la bienvenida a Great Indian Company (Holding Partnership Firm, GST: 29AAWFG7015K1ZQ) («Compañía», «nosotros», «nuestro», «nos»). Estas Condiciones del servicio («Condiciones», «Condiciones del servicio») regulan el uso de nuestro sitio web, ubicado en www.inspir.app, y de las aplicaciones disponibles en las tiendas de aplicaciones (conjunta o individualmente, el «Servicio»), operados por Great Indian Company (Holding Partnership Firm, GST: 29AAWFG7015K1ZQ). Nuestra Política de privacidad también regula el uso de nuestro Servicio y explica cómo recopilamos, protegemos y divulgamos la información derivada del uso de nuestras páginas web. La Política de privacidad está disponible en inspir.app/privacy. Su acuerdo con nosotros incluye estas Condiciones y nuestra Política de privacidad (los «Acuerdos»). Usted reconoce haber leído y comprendido los Acuerdos y acepta quedar vinculado por ellos. Si no acepta los Acuerdos o no puede cumplirlos, no podrá utilizar el Servicio; no obstante, escríbanos a support@inspir.app para que podamos intentar encontrar una solución. Estas Condiciones se aplican a todos los visitantes, usuarios y demás personas que deseen acceder al Servicio o utilizarlo.",
    "site.a06fbb33165c168d14": "¿En qué se diferencia inspir de un chatbot de IA genérico?",
    "site.a20153834d2a77a457": "Generador de resúmenes",
    "site.ccfef258be21678f73": "¿inspir expone a Google los chats privados sobre tareas?",
    "site.d73d62c23277b234a6": "Haz una sesión de grupo de 45 minutos",
    "site.e99ebc202b4b05ef72": "Explícalo de forma sencilla hasta dominarlo",
  } as const;
  const seen = new Map<string, number>();

  for (const { file, pack } of sitePacks) {
    for (const entry of pack.entries) {
      const value = expected[entry.key as keyof typeof expected];
      if (value === undefined) continue;
      assert.equal(entry.value, value, `${file}/${entry.key}`);
      seen.set(entry.key, (seen.get(entry.key) ?? 0) + 1);
    }
  }
  for (const key of Object.keys(expected)) {
    assert.ok((seen.get(key) ?? 0) > 0, `missing Spanish regression key ${key}`);
  }
});

function placeholders(value: string) {
  return [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((match) => match[0]).sort();
}

function parseStringRecord(value: unknown) {
  assert.ok(isRecord(value), "Spanish correction fixture must be an object");
  const parsed: Record<string, string> = {};
  for (const [key, translated] of Object.entries(value)) {
    if (typeof translated !== "string") {
      throw new Error(`Spanish correction ${key} must be a string`);
    }
    parsed[key] = translated;
  }
  return parsed;
}

function parseCuratedPack(value: unknown, file: string): CuratedPack {
  if (
    !isRecord(value) ||
    typeof value.language !== "string" ||
    typeof value.locale !== "string" ||
    typeof value.namespace !== "string" ||
    typeof value.sourceHash !== "string" ||
    !Array.isArray(value.entries)
  ) {
    throw new Error(`Invalid Spanish curated pack metadata in ${file}`);
  }

  const entries: CuratedEntry[] = value.entries.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      typeof entry.source !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw new Error(`Invalid Spanish curated entry ${file}/${index}`);
    }
    return { key: entry.key, source: entry.source, value: entry.value };
  });

  return {
    language: value.language,
    locale: value.locale,
    namespace: value.namespace,
    sourceHash: value.sourceHash,
    entries,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
