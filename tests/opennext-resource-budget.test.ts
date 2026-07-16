import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultOpenNextResourceBudget,
  expectedLocalizedStaticAssetPaths,
  inspectOpenNextResourceBudget,
  type OpenNextResourceBudget,
} from "../scripts/cloudflare/check-opennext-resource-budget";
import {
  buildStaticAssetLocalizedPathContract,
  staticAssetLocalizedPathContract,
} from "../scripts/cloudflare/static-asset-release-contract";
import { staticSiteTranslationNamespaceAvailability } from "../lib/i18n/site-availability-manifest";
import { renderLocalizedSiteTranslationNamespaces } from "../lib/i18n/render-localized-namespaces";

const limits: OpenNextResourceBudget = {
  assetFiles: 3,
  largestAssetBytes: 25,
};

test("OpenNext resource report keeps cache and total raw asset sizes observational", () => {
  const cwd = makeArtifact({
    cacheFiles: [
      ["deploy/home.cache", 100],
      ["deploy/es.cache", 100],
      ["deploy/es/mission.cache", 100],
    ],
    assetFiles: [
      ["index.html", 20],
      ["sentinel.txt", 20],
    ],
  });
  const metrics = inspectOpenNextResourceBudget(cwd, limits, {
    expectedLocalizedAssetPaths: null,
  });

  assert.equal(metrics.ok, true);
  assert.equal(metrics.assetBytes, 40);
  assert.equal(metrics.assetFiles, 2);
  assert.equal(metrics.largestAssetBytes, 20);
  assert.equal(metrics.cacheBytes, 300);
  assert.equal(metrics.cacheEntries, 3);
  assert.equal(metrics.localizedCacheEntries, 2);
  assert.equal(metrics.largestCacheEntryBytes, 100);
});

test("cache totals do not reject an otherwise admitted Static Assets release", () => {
  const metrics = inspectOpenNextResourceBudget(
    makeArtifact({
      cacheFiles: [
        ["deploy/one.cache", 10_000],
        ["deploy/two.cache", 10_000],
        ["deploy/three.cache", 10_000],
        ["deploy/four.cache", 10_000],
      ],
      assetFiles: [["index.html", 1]],
    }),
    limits,
    { expectedLocalizedAssetPaths: null },
  );

  assert.equal(metrics.cacheBytes, 40_000);
  assert.equal(metrics.cacheEntries, 4);
  assert.equal(metrics.ok, true);
});

test("total raw asset bytes are observational when file count and per-file size pass", () => {
  const metrics = inspectOpenNextResourceBudget(
    makeArtifact({
      assetFiles: [
        ["one.txt", 25],
        ["two.txt", 25],
        ["three.txt", 25],
      ],
    }),
    limits,
    { expectedLocalizedAssetPaths: null },
  );

  assert.equal(metrics.assetBytes, 75);
  assert.equal(metrics.largestAssetBytes, 25);
  assert.equal(metrics.ok, true);
});

test("Static Assets admission rejects the per-file cap plus one", () => {
  const atLimit = inspectOpenNextResourceBudget(
    makeArtifact({ assetFiles: [["index.html", 25]] }),
    limits,
    { expectedLocalizedAssetPaths: null },
  );
  const aboveLimit = inspectOpenNextResourceBudget(
    makeArtifact({ assetFiles: [["index.html", 26]] }),
    limits,
    { expectedLocalizedAssetPaths: null },
  );

  assert.equal(atLimit.ok, true);
  assert.equal(aboveLimit.largestAssetBytes, 26);
  assert.equal(aboveLimit.ok, false);
});

test("Static Assets admission rejects the file-count cap plus one", () => {
  const atLimit = inspectOpenNextResourceBudget(
    makeArtifact({
      assetFiles: [
        ["one.txt", 1],
        ["two.txt", 1],
        ["three.txt", 1],
      ],
    }),
    limits,
    { expectedLocalizedAssetPaths: null },
  );
  const aboveLimit = inspectOpenNextResourceBudget(
    makeArtifact({
      assetFiles: [
        ["one.txt", 1],
        ["two.txt", 1],
        ["three.txt", 1],
        ["four.txt", 1],
      ],
    }),
    limits,
    { expectedLocalizedAssetPaths: null },
  );

  assert.equal(atLimit.ok, true);
  assert.equal(aboveLimit.assetFiles, 4);
  assert.equal(aboveLimit.ok, false);
});

test("OpenNext resource admission fails closed when Static Assets are absent", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-opennext-budget-missing-"));
  const metrics = inspectOpenNextResourceBudget(cwd, limits, {
    expectedLocalizedAssetPaths: null,
  });

  assert.equal(metrics.ok, false);
  assert.equal(metrics.assetBytes, 0);
  assert.equal(metrics.assetFiles, 0);
});

test("default admission proves the exact availability-derived localized path set", () => {
  const exactMatrix = expectedLocalizedStaticAssetPaths.map(
    (assetPath) => [assetPath, 1] as const,
  );
  const withinBudget = inspectOpenNextResourceBudget(
    makeArtifact({ assetFiles: exactMatrix }),
  );
  const missingPath = inspectOpenNextResourceBudget(
    makeArtifact({ assetFiles: exactMatrix.slice(1) }),
  );
  const unexpectedPath = inspectOpenNextResourceBudget(
    makeArtifact({
      assetFiles: [...exactMatrix, ["hi/extra/index.html", 1]],
    }),
  );

  assert.equal(defaultOpenNextResourceBudget.assetFiles, 5_000);
  assert.equal(defaultOpenNextResourceBudget.largestAssetBytes, 25 * 1024 * 1024);
  assert.equal(
    expectedLocalizedStaticAssetPaths.length,
    staticAssetLocalizedPathContract.localizedPaths.length,
  );
  assert.equal(
    withinBudget.translationAvailabilitySha256,
    staticAssetLocalizedPathContract.availabilitySha256,
  );
  assert.equal(
    withinBudget.expectedLocalizedAssetPathCount,
    expectedLocalizedStaticAssetPaths.length,
  );
  assert.equal(withinBudget.localizedAssetPathSetExact, true);
  assert.equal(
    withinBudget.localizedAssetPathsSha256,
    withinBudget.expectedLocalizedAssetPathsSha256,
  );
  assert.equal(withinBudget.ok, true);
  assert.equal(missingPath.missingLocalizedAssetPaths, 1);
  assert.equal(missingPath.ok, false);
  assert.equal(unexpectedPath.unexpectedLocalizedAssetPaths, 1);
  assert.equal(unexpectedPath.ok, false);
});

test("localized path admission changes only with the bound availability identity", () => {
  const preAfrikaansAvailability = {
    ...staticSiteTranslationNamespaceAvailability,
    Afrikaans: ["marketing-shell", "route:home", "route:mission"],
  };
  const preAfrikaans = buildStaticAssetLocalizedPathContract(
    preAfrikaansAvailability,
  );
  const postAfrikaansAvailability = {
    ...preAfrikaansAvailability,
    Afrikaans: renderLocalizedSiteTranslationNamespaces,
  };
  const postAfrikaans = buildStaticAssetLocalizedPathContract(
    postAfrikaansAvailability,
  );

  assert.equal(preAfrikaans.localizedPaths.length, 245);
  assert.equal(postAfrikaans.localizedPaths.length, 259);
  assert.notEqual(
    postAfrikaans.availabilitySha256,
    preAfrikaans.availabilitySha256,
  );
  assert.notEqual(
    postAfrikaans.localizedPathsSha256,
    preAfrikaans.localizedPathsSha256,
  );
  assert.throws(
    () =>
      buildStaticAssetLocalizedPathContract({
        ...postAfrikaansAvailability,
        Afrikaans: [
          ...renderLocalizedSiteTranslationNamespaces,
          "route:home",
        ],
      }),
    /duplicate namespaces/,
  );
  assert.throws(
    () =>
      buildStaticAssetLocalizedPathContract({
        ...postAfrikaansAvailability,
        English: ["marketing-shell"],
      }),
    /unsupported language key: English/,
  );
  assert.throws(
    () =>
      buildStaticAssetLocalizedPathContract(
        Object.assign({}, postAfrikaansAvailability, {
          Klingon: ["marketing-shell"],
        }),
      ),
    /unsupported language key: Klingon/,
  );
  assert.throws(
    () =>
      buildStaticAssetLocalizedPathContract({
        ...postAfrikaansAvailability,
        Afrikaans: ["route:games"],
      }),
    /non-render namespace.*route:games/,
  );
  assert.throws(
    () =>
      buildStaticAssetLocalizedPathContract({
        ...preAfrikaansAvailability,
        Afrikaans: [],
      }),
    /must omit empty language entries/,
  );
  assert.throws(
    () =>
      buildStaticAssetLocalizedPathContract({
        ...postAfrikaansAvailability,
        Afrikaans: ["route:home", "marketing-shell"],
      }),
    /namespaces are not canonical/,
  );
  assert.throws(
    () =>
      buildStaticAssetLocalizedPathContract(
        Object.assign(
          {},
          { Afrikaans: renderLocalizedSiteTranslationNamespaces },
          staticSiteTranslationNamespaceAvailability,
        ),
      ),
    /language keys are not in canonical supported-language order/,
  );
});

function makeArtifact(options: Readonly<{
  cacheFiles?: ReadonlyArray<readonly [string, number]>;
  assetFiles?: ReadonlyArray<readonly [string, number]>;
}>) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-opennext-budget-"));
  for (const [relativePath, size] of options.cacheFiles ?? []) {
    writeSizedFile(path.join(cwd, ".open-next/cache", relativePath), size);
  }
  for (const [relativePath, size] of options.assetFiles ?? []) {
    writeSizedFile(path.join(cwd, ".open-next/assets", relativePath), size);
  }
  return cwd;
}

function writeSizedFile(filePath: string, size: number) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "x".repeat(size));
}
