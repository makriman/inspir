import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { staticSiteTranslationNamespaceAvailability } from "../lib/i18n/site-availability-manifest";
import { siteSourceManifest } from "../lib/i18n/site-source-manifest";
import { buildStaticAssetLocalizedPathContract } from "../scripts/cloudflare/static-asset-release-contract";
import {
  assertCurrentSiteSourceManifestFreshness,
  assertSiteAvailabilityManifestFreshness,
  assertSiteSourceManifestFreshness,
  siteSourceKey,
  siteSourceStringsSha256,
} from "../scripts/verify-site-source-manifest";

type FixtureEntry = Readonly<{
  namespace: string;
  sourceHash: string;
  sourceStrings: Readonly<Record<string, string>>;
}>;

const fixtureEntries = [
  fixtureEntry("marketing-site", ["Aggregate alpha", "Aggregate beta"]),
  fixtureEntry("route:home", ["Home alpha", "Home beta"]),
  fixtureEntry("blog:sampled", ["Sampled article"]),
  fixtureEntry("route:outside-legacy-sample", ["Non-sample SEO copy"]),
] as const;

test("complete site source freshness returns exact dynamic count and root evidence", () => {
  const validation = validateFixture(fixtureEntries);
  const expectedFieldCount = fixtureEntries.reduce(
    (count, entry) => count + Object.keys(entry.sourceStrings).length,
    0,
  );
  const routedEntries = fixtureEntries.filter(
    (entry) => entry.namespace !== "marketing-site",
  );
  const expectedRoutedFieldCount = routedEntries.reduce(
    (count, entry) => count + Object.keys(entry.sourceStrings).length,
    0,
  );

  assert.equal(validation.namespaceCount, fixtureEntries.length);
  assert.equal(validation.fieldCount, expectedFieldCount);
  assert.equal(validation.routedNamespaceCount, routedEntries.length);
  assert.equal(validation.routedFieldCount, expectedRoutedFieldCount);
  assert.equal(validation.staleNamespaceCount, 0);
  assert.equal(validation.staleFieldCount, 0);
  assert.match(validation.manifestRootSha256, /^[a-f0-9]{64}$/);
  assert.equal(validation.manifestRootSha256, validation.extractedRootSha256);
  assert.match(validation.routedManifestRootSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    validation.routedManifestRootSha256,
    validation.routedExtractedRootSha256,
  );
  assert.notEqual(
    validation.manifestRootSha256,
    validation.routedManifestRootSha256,
  );
});

test("complete freshness catches a source edit in a non-sample SEO namespace", () => {
  const mutated = fixtureEntries.map((entry) =>
    entry.namespace === "route:outside-legacy-sample"
      ? fixtureEntry(entry.namespace, ["Changed non-sample SEO copy"])
      : entry,
  );

  assert.throws(
    () => validateFixture(mutated, manifestFor(fixtureEntries)),
    /hash is stale for route:outside-legacy-sample/,
  );
});

test("complete freshness catches field addition, removal, and source change", async (t) => {
  const home = fixtureEntries.find((entry) => entry.namespace === "route:home");
  assert.ok(home);
  const mutations: ReadonlyArray<Readonly<{
    name: string;
    values: readonly string[];
  }>> = [
    {
      name: "field addition",
      values: [...Object.values(home.sourceStrings), "Home added"],
    },
    {
      name: "field removal",
      values: Object.values(home.sourceStrings).slice(0, -1),
    },
    {
      name: "field source change",
      values: ["Home changed", ...Object.values(home.sourceStrings).slice(1)],
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const extracted = fixtureEntries.map((entry) =>
        entry.namespace === home.namespace
          ? fixtureEntry(home.namespace, mutation.values)
          : entry,
      );
      assert.throws(
        () => validateFixture(extracted, manifestFor(fixtureEntries)),
        /hash is stale for route:home/,
      );
    });
  }
});

test("complete freshness catches namespace addition, removal, and reordering", async (t) => {
  const scenarios: ReadonlyArray<Readonly<{
    name: string;
    manifest: Readonly<Record<string, unknown>>;
    extracted: readonly FixtureEntry[];
  }>> = [
    {
      name: "namespace added to extraction",
      manifest: manifestFor(fixtureEntries),
      extracted: [...fixtureEntries, fixtureEntry("route:new", ["New route"])],
    },
    {
      name: "namespace removed from extraction",
      manifest: manifestFor(fixtureEntries),
      extracted: fixtureEntries.slice(0, -1),
    },
    {
      name: "namespace added to manifest",
      manifest: manifestFor([
        ...fixtureEntries,
        fixtureEntry("route:manifest-only", ["Manifest only"]),
      ]),
      extracted: fixtureEntries,
    },
    {
      name: "namespace removed from manifest",
      manifest: manifestFor(fixtureEntries.slice(0, -1)),
      extracted: fixtureEntries,
    },
    {
      name: "namespace order changed",
      manifest: manifestFor([
        fixtureEntries[0],
        fixtureEntries[2],
        fixtureEntries[1],
        fixtureEntries[3],
      ]),
      extracted: fixtureEntries,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => validateFixture(scenario.extracted, scenario.manifest),
        /namespace order is stale/,
      );
    });
  }
});

test("complete freshness rejects forged hashes and stale keys", async (t) => {
  const home = fixtureEntries[1];
  const homeKeys = Object.keys(home.sourceStrings);
  assert.equal(homeKeys.length, 2);

  await t.test("forged source hash", () => {
    const manifest = manifestFor(fixtureEntries);
    const forged = {
      ...manifest,
      [home.namespace]: {
        sourceHash: "0".repeat(64),
        sourceStrings: home.sourceStrings,
      },
    };
    assert.throws(
      () => validateFixture(fixtureEntries, forged),
      /Generated manifest source hash is stale/,
    );
  });

  await t.test("stale source key", () => {
    const staleEntry: FixtureEntry = {
      namespace: home.namespace,
      sourceHash: siteSourceStringsSha256({ "site.stale": "Home alpha" }),
      sourceStrings: { "site.stale": "Home alpha" },
    };
    const extracted = fixtureEntries.map((entry) =>
      entry.namespace === home.namespace ? staleEntry : entry,
    );
    assert.throws(
      () => validateFixture(extracted, manifestFor(fixtureEntries)),
      /Current extraction source key is stale/,
    );
  });

});

test("complete freshness canonicalizes field property order", () => {
  const home = fixtureEntries[1];
  const reversedSourceStrings = Object.fromEntries(
    [...Object.entries(home.sourceStrings)].reverse(),
  );
  const reordered: FixtureEntry = {
    namespace: home.namespace,
    sourceHash: home.sourceHash,
    sourceStrings: reversedSourceStrings,
  };
  const manifestEntries = fixtureEntries.map((entry) =>
    entry.namespace === home.namespace ? reordered : entry,
  );
  const validation = validateFixture(
    fixtureEntries,
    manifestFor(manifestEntries),
  );
  assert.equal(validation.manifestRootSha256, validation.extractedRootSha256);
});

test("the tracked manifest exactly matches every current extracted namespace and field", () => {
  const validation = assertCurrentSiteSourceManifestFreshness();
  const manifestEntries = Object.entries(siteSourceManifest);
  const expectedFieldCount = manifestEntries.reduce(
    (count, [, entry]) => count + Object.keys(entry.sourceStrings).length,
    0,
  );
  const routedEntries = manifestEntries.filter(
    ([namespace]) => namespace !== "marketing-site",
  );
  const expectedRoutedFieldCount = routedEntries.reduce(
    (count, [, entry]) => count + Object.keys(entry.sourceStrings).length,
    0,
  );
  const expectedAvailabilityNamespaceEntries = Object.values(
    staticSiteTranslationNamespaceAvailability,
  ).reduce((count, namespaces) => count + (namespaces?.length ?? 0), 0);
  const localizedContract = buildStaticAssetLocalizedPathContract(
    staticSiteTranslationNamespaceAvailability,
  );

  assert.equal(validation.namespaceCount, manifestEntries.length);
  assert.equal(validation.fieldCount, expectedFieldCount);
  assert.equal(validation.routedNamespaceCount, routedEntries.length);
  assert.equal(validation.routedFieldCount, expectedRoutedFieldCount);
  assert.equal(validation.manifestRootSha256, validation.extractedRootSha256);
  assert.equal(
    validation.routedManifestRootSha256,
    validation.routedExtractedRootSha256,
  );
  assert.equal(validation.availabilityLanguages, 69);
  assert.equal(
    validation.availabilityNamespaceEntries,
    expectedAvailabilityNamespaceEntries,
  );
  assert.equal(validation.invalidAdvertisedNamespaceCount, 0);
  assert.equal(
    validation.localizedHtmlPaths,
    localizedContract.localizedPaths.length,
  );
  assert.match(validation.availabilityRootSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    validation.localizedHtmlPathsSha256,
    localizedContract.localizedPathsSha256,
  );
});

test("availability freshness rejects advertised stale packs and exact-set drift", () => {
  const languages = ["Alpha", "Beta"] as const;
  const namespaces = ["marketing-shell", "route:home"] as const;
  const clean = new Set(["Alpha/marketing-shell", "Alpha/route:home", "Beta/route:home"]);
  const isAvailable = (language: (typeof languages)[number], namespace: string) =>
    clean.has(`${language}/${namespace}`);

  const exact = assertSiteAvailabilityManifestFreshness({
    languages,
    namespaces,
    availability: {
      Alpha: ["marketing-shell", "route:home"],
      Beta: ["route:home"],
    },
    isAvailable,
  });
  assert.equal(exact.availabilityNamespaceEntries, 3);
  assert.equal(exact.invalidAdvertisedNamespaceCount, 0);

  assert.throws(
    () =>
      assertSiteAvailabilityManifestFreshness({
        languages,
        namespaces,
        availability: {
          Alpha: ["marketing-shell", "route:home"],
          Beta: ["marketing-shell", "route:home"],
        },
        isAvailable,
      }),
    /availability manifest is stale for Beta|advertises non-current or non-fluent/,
  );
  assert.throws(
    () =>
      assertSiteAvailabilityManifestFreshness({
        languages,
        namespaces,
        availability: {
          Alpha: ["marketing-shell"],
          Beta: ["route:home"],
        },
        isAvailable,
      }),
    /availability manifest is stale for Alpha/,
  );
});

test("the live extractor refuses to attest a different workspace", () => {
  assert.throws(
    () =>
      assertCurrentSiteSourceManifestFreshness({
        workspaceRoot: path.join(process.cwd(), "different-workspace"),
      }),
    /refusing to attest/,
  );
});

function validateFixture(
  extractedEntries: readonly FixtureEntry[],
  manifest: Readonly<Record<string, unknown>> = manifestFor(extractedEntries),
) {
  const extractedByNamespace = new Map(
    extractedEntries.map((entry) => [entry.namespace, entry]),
  );
  return assertSiteSourceManifestFreshness({
    extractedNamespaceOrder: extractedEntries.map((entry) => entry.namespace),
    manifest,
    extractSource: (namespace) => extractedByNamespace.get(namespace),
    aggregateNamespace: "marketing-site",
  });
}

function fixtureEntry(
  namespace: string,
  values: readonly string[],
): FixtureEntry {
  const sourceStrings = Object.fromEntries(
    values.map((value) => [siteSourceKey(value), value]),
  );
  return Object.freeze({
    namespace,
    sourceHash: siteSourceStringsSha256(sourceStrings),
    sourceStrings: Object.freeze(sourceStrings),
  });
}

function manifestFor(entries: readonly FixtureEntry[]) {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.namespace,
      {
        sourceHash: entry.sourceHash,
        sourceStrings: entry.sourceStrings,
      },
    ]),
  );
}
