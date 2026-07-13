import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "../lib/content/languages";
import {
  getSiteTranslationSource,
  isKnownSiteTranslationNamespace,
} from "../lib/i18n/site-source";
import {
  isCaseOnlyPseudoTranslation,
  isValidFieldTranslation,
} from "../lib/i18n/translation-field-validation";
import { placeholdersIn } from "../lib/i18n/translation-validation";

type SiteEntry = {
  key: string;
  source: string;
  value: string;
};

type SitePack = {
  relativePath: string;
  schemaVersion: 1;
  language: SupportedLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  entries: SiteEntry[];
};

type FixtureCorrection = {
  source: string;
  value: string;
};

type FixturePack = {
  language: SupportedLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  corrections: Record<string, FixtureCorrection>;
};

type SiteCorrectionsFixture = {
  schemaVersion: 1;
  kind: "site-case-semantic-corrections";
  packCount: number;
  correctionCount: number;
  packs: Record<string, FixturePack>;
};

const curatedRoot = path.join(process.cwd(), "translations/curated");

test("all 691 tracked site packs reject unapproved case-only source copies", () => {
  const packs = readSitePacks();
  assert.equal(packs.length, 691);

  for (const pack of packs) {
    const languageConfig = languageConfigs[pack.language];
    const expectedDirectory = languageConfig.prefix || languageConfig.locale;
    assert.equal(
      pack.relativePath.split("/")[0],
      expectedDirectory,
      `${pack.relativePath} language directory drifted`,
    );
    assert.equal(pack.locale, languageConfig.locale, `${pack.relativePath} locale drifted`);
    assert.equal(
      isKnownSiteTranslationNamespace(pack.namespace),
      true,
      `${pack.relativePath} has an unknown namespace`,
    );

    const source = getSiteTranslationSource(pack.namespace);
    assert.equal(pack.sourceHash, source.sourceHash, `${pack.relativePath} source hash drifted`);
    assert.equal(
      pack.entries.length,
      Object.keys(source.sourceStrings).length,
      `${pack.relativePath} key count drifted`,
    );

    const seenKeys = new Set<string>();
    for (const entry of pack.entries) {
      assert.equal(
        seenKeys.has(entry.key),
        false,
        `${pack.relativePath} duplicates ${entry.key}`,
      );
      seenKeys.add(entry.key);
      assert.equal(
        entry.source,
        source.sourceStrings[entry.key],
        `${pack.relativePath}/${entry.key} source drifted`,
      );
      assert.equal(
        entry.value,
        entry.value.normalize("NFC"),
        `${pack.relativePath}/${entry.key} is not NFC`,
      );
      assert.deepEqual(
        placeholdersIn(entry.value).sort(),
        placeholdersIn(entry.source).sort(),
        `${pack.relativePath}/${entry.key} placeholders drifted`,
      );
      assert.equal(
        isValidFieldTranslation(
          entry.source,
          entry.value,
          pack.language,
          entry.key,
        ),
        true,
        `${pack.relativePath}/${entry.key} is structurally invalid`,
      );
      assert.equal(
        isCaseOnlyPseudoTranslation(
          entry.source,
          entry.value,
          pack.language,
          entry.key,
        ),
        false,
        `${pack.relativePath}/${entry.key} is an unapproved case-only source copy`,
      );
    }
  }
});

test("reviewed site semantic corrections remain exact", () => {
  const packs = new Map(readSitePacks().map((pack) => [pack.relativePath, pack]));
  const fixture = readFixture();
  assert.equal(Object.keys(fixture.packs).length, fixture.packCount);
  assert.equal(
    Object.values(fixture.packs).reduce(
      (total, pack) => total + Object.keys(pack.corrections).length,
      0,
    ),
    fixture.correctionCount,
  );
  assert.equal(fixture.packCount, 6);
  assert.equal(fixture.correctionCount, 18);

  for (const [relativePath, expectedPack] of Object.entries(fixture.packs)) {
    const pack = packs.get(relativePath);
    assert.ok(pack, `missing corrected site pack ${relativePath}`);
    assert.equal(pack.language, expectedPack.language, `${relativePath} language drifted`);
    assert.equal(pack.locale, expectedPack.locale, `${relativePath} locale drifted`);
    assert.equal(pack.namespace, expectedPack.namespace, `${relativePath} namespace drifted`);
    assert.equal(pack.sourceHash, expectedPack.sourceHash, `${relativePath} hash drifted`);

    const entries = new Map(pack.entries.map((entry) => [entry.key, entry]));
    for (const [key, correction] of Object.entries(expectedPack.corrections)) {
      const entry = entries.get(key);
      assert.ok(entry, `missing corrected site value ${relativePath}/${key}`);
      assert.equal(entry.source, correction.source, `${relativePath}/${key} source changed`);
      assert.equal(entry.value, correction.value, `${relativePath}/${key} value regressed`);
      assert.equal(
        correction.value,
        correction.value.normalize("NFC"),
        `${relativePath}/${key} fixture value is not NFC`,
      );
      assert.deepEqual(
        placeholdersIn(correction.value).sort(),
        placeholdersIn(correction.source).sort(),
        `${relativePath}/${key} fixture placeholders drifted`,
      );
      assert.equal(
        isValidFieldTranslation(
          correction.source,
          correction.value,
          expectedPack.language,
          key,
        ),
        true,
        `${relativePath}/${key} fixture value is invalid`,
      );
    }
  }
});

test("reviewed site loanwords require their exact language and source key", () => {
  assert.equal(
    isValidFieldTranslation(
      "Media",
      "Media",
      "Afrikaans",
      "site.0c77aeece8c2581131",
    ),
    true,
  );
  assert.equal(isValidFieldTranslation("Media", "Media", "Afrikaans"), false);
  assert.equal(
    isValidFieldTranslation("Media", "Media", "Afrikaans", "site.unreviewed"),
    false,
  );
  assert.equal(
    isValidFieldTranslation(
      "Start",
      "Start",
      "Norwegian",
      "site.952f375412e89ff213",
    ),
    true,
  );
  assert.equal(
    isValidFieldTranslation("Start", "Start", "Norwegian", "site.unreviewed"),
    false,
  );
  assert.equal(
    isValidFieldTranslation(
      "Blog",
      "Blog",
      "Slovak",
      "site.0b9d2b2362bc33581b",
    ),
    true,
  );
  assert.equal(
    isValidFieldTranslation("Blog", "Blog", "Slovak", "site.unreviewed"),
    false,
  );
});

function readSitePacks(): SitePack[] {
  const packs: SitePack[] = [];
  for (const languageDirectory of fs
    .readdirSync(curatedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = path.join(curatedRoot, languageDirectory.name);
    for (const file of fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = `${languageDirectory.name}/${file.name}`;
      const pack = parseSitePack(
        relativePath,
        JSON.parse(fs.readFileSync(path.join(directory, file.name), "utf8")),
      );
      if (pack) packs.push(pack);
    }
  }
  return packs;
}

function parseSitePack(relativePath: string, value: unknown): SitePack | null {
  if (isRecord(value) && value.namespace === "main-app") return null;
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.language !== "string" ||
    !isSupportedLanguage(value.language) ||
    typeof value.locale !== "string" ||
    typeof value.namespace !== "string" ||
    typeof value.sourceHash !== "string" ||
    !Array.isArray(value.entries)
  ) {
    throw new Error(`Invalid site translation pack metadata: ${relativePath}.`);
  }

  const entries: SiteEntry[] = [];
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      typeof entry.source !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw new Error(`Invalid site translation entry: ${relativePath}.`);
    }
    entries.push({ key: entry.key, source: entry.source, value: entry.value });
  }

  return {
    relativePath,
    schemaVersion: 1,
    language: value.language,
    locale: value.locale,
    namespace: value.namespace,
    sourceHash: value.sourceHash,
    entries,
  };
}

function readFixture(): SiteCorrectionsFixture {
  const filePath = path.join(
    process.cwd(),
    "tests/fixtures/site-case-semantic-corrections.json",
  );
  const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "site-case-semantic-corrections" ||
    typeof value.packCount !== "number" ||
    typeof value.correctionCount !== "number" ||
    !isRecord(value.packs)
  ) {
    throw new Error("Invalid site case semantic corrections fixture metadata.");
  }

  const packs: Record<string, FixturePack> = {};
  for (const [relativePath, packValue] of Object.entries(value.packs)) {
    if (
      !isRecord(packValue) ||
      typeof packValue.language !== "string" ||
      !isSupportedLanguage(packValue.language) ||
      typeof packValue.locale !== "string" ||
      typeof packValue.namespace !== "string" ||
      typeof packValue.sourceHash !== "string" ||
      !isRecord(packValue.corrections)
    ) {
      throw new Error(`Invalid site corrections fixture pack: ${relativePath}.`);
    }

    const corrections: Record<string, FixtureCorrection> = {};
    for (const [key, correctionValue] of Object.entries(packValue.corrections)) {
      if (
        !isRecord(correctionValue) ||
        typeof correctionValue.source !== "string" ||
        typeof correctionValue.value !== "string" ||
        !correctionValue.value.trim()
      ) {
        throw new Error(`Invalid site correction fixture value: ${relativePath}/${key}.`);
      }
      corrections[key] = {
        source: correctionValue.source,
        value: correctionValue.value,
      };
    }
    packs[relativePath] = {
      language: packValue.language,
      locale: packValue.locale,
      namespace: packValue.namespace,
      sourceHash: packValue.sourceHash,
      corrections,
    };
  }

  return {
    schemaVersion: 1,
    kind: "site-case-semantic-corrections",
    packCount: value.packCount,
    correctionCount: value.correctionCount,
    packs,
  };
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.some((language) => language === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
