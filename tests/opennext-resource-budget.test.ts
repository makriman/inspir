import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultOpenNextResourceBudget,
  inspectOpenNextResourceBudget,
  type OpenNextResourceBudget,
} from "../scripts/cloudflare/check-opennext-resource-budget";
import { defaultLanguage, languageConfigs, supportedLanguages } from "../lib/content/languages";

const limits: OpenNextResourceBudget = {
  artifactBytes: 100,
  cacheBytes: 50,
  cacheEntries: 3,
  localizedCacheEntries: 2,
  largestCacheEntryBytes: 25,
};

test("OpenNext resource budget counts localized cache entries and accepts bounded output", () => {
  const cwd = makeArtifact([
    ["deploy/home.cache", 10],
    ["deploy/es.cache", 10],
    ["deploy/es/mission.cache", 10],
  ], [["assets/index.html", 40]]);
  const metrics = inspectOpenNextResourceBudget(cwd, limits);

  assert.equal(metrics.ok, true);
  assert.equal(metrics.artifactBytes, 40);
  assert.equal(metrics.cacheEntries, 3);
  assert.equal(metrics.localizedCacheEntries, 2);
  assert.equal(metrics.cacheBytes, 30);
  assert.equal(metrics.largestCacheEntryBytes, 10);
});

test("OpenNext resource budget does not double-count build-only cache in deployable artifacts", () => {
  const cwd = makeArtifact(
    [
      ["deploy/index.cache", 25],
      ["deploy/about.cache", 25],
    ],
    [["assets/index.html", 100]],
  );
  const metrics = inspectOpenNextResourceBudget(cwd, limits);

  assert.equal(metrics.artifactBytes, 100);
  assert.equal(metrics.cacheBytes, 50);
  assert.equal(metrics.ok, true);
});

test("OpenNext resource budget fails on locale multiplication", () => {
  const cwd = makeArtifact([
    ["deploy/es.cache", 10],
    ["deploy/es/mission.cache", 10],
    ["deploy/fr.cache", 10],
  ]);
  const metrics = inspectOpenNextResourceBudget(cwd, limits);

  assert.equal(metrics.ok, false);
  assert.equal(metrics.localizedCacheEntries, 3);
});

test("OpenNext resource budget rejects the cache-byte cap plus one", () => {
  const atLimit = inspectOpenNextResourceBudget(
    makeArtifact([
      ["deploy/one.cache", 20],
      ["deploy/two.cache", 15],
      ["deploy/three.cache", 15],
    ]),
    limits,
  );
  const aboveLimit = inspectOpenNextResourceBudget(
    makeArtifact([
      ["deploy/one.cache", 20],
      ["deploy/two.cache", 15],
      ["deploy/three.cache", 16],
    ]),
    limits,
  );

  assert.equal(atLimit.cacheBytes, 50);
  assert.equal(atLimit.ok, true);
  assert.equal(aboveLimit.cacheBytes, 51);
  assert.equal(aboveLimit.largestCacheEntryBytes, 20);
  assert.equal(aboveLimit.ok, false);
});

test("OpenNext resource budget fails closed when no artifact exists", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-opennext-budget-missing-"));
  const metrics = inspectOpenNextResourceBudget(cwd, limits);

  assert.equal(metrics.ok, false);
  assert.equal(metrics.artifactBytes, 0);
  assert.equal(metrics.cacheEntries, 0);
});

test("OpenNext resource budget fails closed when only build-time cache exists", () => {
  const metrics = inspectOpenNextResourceBudget(
    makeArtifact([["deploy/index.cache", 10]], []),
    limits,
  );

  assert.equal(metrics.artifactBytes, 0);
  assert.equal(metrics.cacheBytes, 10);
  assert.equal(metrics.ok, false);
});

test("default OpenNext budget admits exactly three localized static route families", () => {
  const prefixes = supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => languageConfigs[language].prefix);
  const threeFamilies = prefixes.flatMap((prefix) => [
    [`deploy/${prefix}.cache`, 1] as const,
    [`deploy/${prefix}/chat.cache`, 1] as const,
    [`deploy/${prefix}/mission.cache`, 1] as const,
  ]);
  const withinBudget = inspectOpenNextResourceBudget(makeArtifact(threeFamilies));
  const fourthFamily = inspectOpenNextResourceBudget(
    makeArtifact([...threeFamilies, [`deploy/${prefixes[0]}/extra.cache`, 1]]),
  );

  assert.equal(defaultOpenNextResourceBudget.cacheEntries, 450);
  assert.equal(defaultOpenNextResourceBudget.localizedCacheEntries, prefixes.length * 3);
  assert.equal(withinBudget.localizedCacheEntries, prefixes.length * 3);
  assert.equal(withinBudget.ok, true);
  assert.equal(fourthFamily.localizedCacheEntries, prefixes.length * 3 + 1);
  assert.equal(fourthFamily.ok, false);
});

test("default OpenNext total-entry guard keeps only narrow nonlocalized headroom", () => {
  const withinLimit = Array.from({ length: 450 }, (_, index) =>
    [`deploy/page-${index}.cache`, 1] as const,
  );
  const withinBudget = inspectOpenNextResourceBudget(makeArtifact(withinLimit));
  const aboveBudget = inspectOpenNextResourceBudget(
    makeArtifact([...withinLimit, ["deploy/page-overflow.cache", 1]]),
  );

  assert.equal(withinBudget.cacheEntries, 450);
  assert.equal(withinBudget.ok, true);
  assert.equal(aboveBudget.cacheEntries, 451);
  assert.equal(aboveBudget.ok, false);
});

function makeArtifact(
  files: Array<readonly [string, number]>,
  artifactFiles: Array<readonly [string, number]> = [["assets/sentinel.txt", 1]],
) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-opennext-budget-"));
  for (const [relativePath, size] of files) {
    const filePath = path.join(cwd, ".open-next/cache", relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "x".repeat(size));
  }
  for (const [relativePath, size] of artifactFiles) {
    const filePath = path.join(cwd, ".open-next", relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "x".repeat(size));
  }
  return cwd;
}
