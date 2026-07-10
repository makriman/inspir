import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  inspectOpenNextResourceBudget,
  type OpenNextResourceBudget,
} from "../scripts/cloudflare/check-opennext-resource-budget";

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
  ]);
  const metrics = inspectOpenNextResourceBudget(cwd, limits);

  assert.equal(metrics.ok, true);
  assert.equal(metrics.cacheEntries, 3);
  assert.equal(metrics.localizedCacheEntries, 2);
  assert.equal(metrics.cacheBytes, 30);
  assert.equal(metrics.largestCacheEntryBytes, 10);
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

test("OpenNext resource budget fails closed when no artifact exists", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-opennext-budget-missing-"));
  const metrics = inspectOpenNextResourceBudget(cwd, limits);

  assert.equal(metrics.ok, false);
  assert.equal(metrics.artifactBytes, 0);
  assert.equal(metrics.cacheEntries, 0);
});

function makeArtifact(files: Array<readonly [string, number]>) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-opennext-budget-"));
  for (const [relativePath, size] of files) {
    const filePath = path.join(cwd, ".open-next/cache", relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "x".repeat(size));
  }
  return cwd;
}
