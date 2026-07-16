import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { extractedPages } from "../lib/content/extracted-pages";
import {
  legacySiteTranslationStaticAssetNamespaces,
} from "../lib/i18n/legacy-api-compat";
import {
  isRenderLocalizedSiteTranslationNamespace,
  renderLocalizedSiteTranslationNamespaces,
} from "../lib/i18n/render-localized-namespaces";
import {
  getSiteSourceStrings,
  getSiteTranslationSource,
  legalEnglishControlsNotice,
} from "../lib/i18n/site-source";
import { hasStaticSiteNamespaceCoverage } from "../lib/i18n/static-availability";

const localizedDocumentPaths = [
  "/",
  "/about",
  "/ai-learning-map",
  "/blog",
  "/compare",
  "/for",
  "/learn",
  "/media",
  "/mission",
  "/privacy",
  "/prompts",
  "/schools",
  "/subjects",
  "/terms",
  "/topics",
  "/trust",
] as const;

test("render-localized publication is bounded to the shell and 16 top-level documents", () => {
  assert.deepEqual(renderLocalizedSiteTranslationNamespaces, [
    "marketing-shell",
    "route:home",
    "route:about",
    "route:ai-learning-map",
    "route:blog",
    "route:compare",
    "route:for",
    "route:learn",
    "route:media",
    "route:mission",
    "route:prompts",
    "route:schools",
    "route:subjects",
    "route:topics",
    "route:trust",
    "legal:privacy",
    "legal:terms",
  ]);
  assert.equal(renderLocalizedSiteTranslationNamespaces.length, 17);

  for (const namespace of [
    "route:chat-public",
    "route:loading",
    "route:reset_pw",
    "route:games",
    "legal:tnc",
    "blog:ai-learn-anything-guide",
  ]) {
    assert.equal(
      isRenderLocalizedSiteTranslationNamespace(namespace),
      false,
      `${namespace} must remain outside bounded render publication`,
    );
  }
});

test("complete promoted top-level packs become available without admitting incomplete routes", () => {
  const completeTopLevelCoverage = new Set<string>(
    renderLocalizedSiteTranslationNamespaces,
  );

  for (const pathname of localizedDocumentPaths) {
    assert.equal(
      hasStaticSiteNamespaceCoverage(pathname, completeTopLevelCoverage),
      true,
      `${pathname} must become available when its promoted pack is complete`,
    );
  }

  assert.equal(hasStaticSiteNamespaceCoverage("/about", new Set(["marketing-shell"])), false);
  assert.equal(hasStaticSiteNamespaceCoverage("/about", new Set(["route:about"])), false);
  assert.equal(hasStaticSiteNamespaceCoverage("/about", undefined), false);
  assert.equal(
    hasStaticSiteNamespaceCoverage(
      "/blog/ai-learn-anything-guide",
      completeTopLevelCoverage,
    ),
    false,
  );
  assert.equal(hasStaticSiteNamespaceCoverage("/tnc", completeTopLevelCoverage), false);
  assert.equal(hasStaticSiteNamespaceCoverage("/loading", completeTopLevelCoverage), false);
  assert.equal(hasStaticSiteNamespaceCoverage("/reset_pw", completeTopLevelCoverage), false);
  assert.equal(hasStaticSiteNamespaceCoverage("/chat/learn-anything", completeTopLevelCoverage), false);
});

test("legacy static translation assets stay on the exact three-namespace contract", () => {
  assert.deepEqual(legacySiteTranslationStaticAssetNamespaces, [
    "marketing-shell",
    "route:home",
    "route:mission",
  ]);
  assert.notDeepEqual(
    legacySiteTranslationStaticAssetNamespaces,
    renderLocalizedSiteTranslationNamespaces,
  );
});

test("privacy and terms extraction include only their intended legal document blocks", () => {
  const privacySource = sourceValueSet("legal:privacy");
  const termsSource = sourceValueSet("legal:terms");
  const tncSource = sourceValueSet("legal:tnc");
  const privacyBlocks = normalizedValueSet(extractedPages.privacy);
  const termsBlocks = normalizedValueSet(extractedPages.tnc);

  assert.equal(privacySource.has(legalEnglishControlsNotice), true);
  assert.equal(termsSource.has(legalEnglishControlsNotice), true);
  assert.equal(tncSource.has(legalEnglishControlsNotice), true);

  for (const block of privacyBlocks) assert.equal(privacySource.has(block), true);
  for (const block of termsBlocks) {
    assert.equal(termsSource.has(block), true);
    assert.equal(tncSource.has(block), true);
  }

  assert.deepEqual(
    [...termsBlocks].filter(
      (block) => !privacyBlocks.has(block) && privacySource.has(block),
    ),
    [],
    "privacy must not absorb terms component copy or body blocks",
  );
  assert.deepEqual(
    [...privacyBlocks].filter(
      (block) => !termsBlocks.has(block) && termsSource.has(block),
    ),
    ["Privacy Policy"],
    "terms may reference the privacy title but must not absorb privacy body blocks",
  );
  assert.deepEqual([...tncSource].sort(), [...termsSource].sort());
});

test("legal source manifests preserve the corrected canonical English copy", () => {
  const expectedHashes = {
    "legal:privacy":
      "28716f737f9e79719469e06bfbbca5084c1e533315b1b9ef5fa6f270503e67bb",
    "legal:terms":
      "f8f20182b03b4c9fa33c4c90dd7f765e65b61206e43ee1ec15f7e88c3c30dc0b",
    "legal:tnc":
      "f8f20182b03b4c9fa33c4c90dd7f765e65b61206e43ee1ec15f7e88c3c30dc0b",
  } as const;

  for (const [namespace, expectedHash] of Object.entries(expectedHashes)) {
    const manifestSource = getSiteTranslationSource(namespace);
    const extractedSource = getSiteTranslationSource(namespace, {
      mode: "extract",
    });

    assert.equal(manifestSource.sourceHash, expectedHash, namespace);
    assert.equal(extractedSource.sourceHash, expectedHash, namespace);
    assert.deepEqual(
      manifestSource.sourceStrings,
      extractedSource.sourceStrings,
      namespace,
    );
  }

  const termsText = extractedPages.tnc.join("\n");
  assert.match(termsText, /laws of India and foreign countries/);
  assert.doesNotMatch(
    termsText,
    /laws of and foreign countries|Claims” You|Service, You represent|Service are the property/,
  );

  const privacyText = extractedPages.privacy.join("\n");
  const repeatedGdprSentence =
    "If you are a resident of the European Union (EU) and European Economic Area (EEA), you have certain data protection rights, covered by GDPR.";
  assert.equal(privacyText.split(repeatedGdprSentence).length - 1, 1);
  assert.doesNotMatch(
    privacyText,
    /xTracking Cookies Data|\bhe categories of sources|conceivable the world|may not able|use:Session|support@inspir\.app Your/,
  );
});

test("localized blog and legal routes resolve locale-specific body, metadata, and JSON-LD", () => {
  const localizedRouteFiles = [
    "app/[locale]/blog/page.tsx",
    "app/[locale]/privacy/page.tsx",
    "app/[locale]/terms/page.tsx",
  ] as const;

  for (const relativePath of localizedRouteFiles) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /export\s*\{\s*default/);
    assert.doesNotMatch(source, /@\/app\/\(marketing\)\//);
    assert.match(source, /resolveLocaleParam\(params\)/);
    assert.match(source, /generateMetadata/);
    assert.match(source, /generateLocalizedStaticParams\(/);
    assert.match(source, /revalidate = false/);
  }

  const blog = read("components/marketing/pages/BlogMarketingPage.tsx");
  assert.match(blog, /getStaticMarketingChrome\(pathname, language\)/);
  assert.match(blog, /localizeMarketingMetadataForLanguage\(pageMetadata, "\/blog", language\)/);
  assert.match(blog, /<JsonLdScripts items=\{jsonLd\} path="\/blog" language=\{language\}/);
  assert.match(blog, /t\(post\.title\)/);
  assert.match(blog, /t\(post\.description\)/);
  assert.match(blog, /"\{value1\} guides"/);
  assert.doesNotMatch(blog, /getRequestMarketingChrome/);

  const legal = read("components/legal/ContentPage.tsx");
  assert.match(legal, /localizedBlock: t\(block\)/);
  assert.match(legal, /t\(legalEnglishControlsNotice\)/);
  assert.match(legal, /<JsonLdScripts items=\{jsonLd\} path=\{path\} language=\{language\}/);
  assert.match(legal, /MarketingHeaderWithChrome/);
  assert.match(legal, /MarketingFooterWithChrome/);

  const privacy = read("components/legal/PrivacyPolicyContent.tsx");
  const terms = read("components/legal/TermsAndConditionsContent.tsx");
  assert.match(privacy, /localizeMarketingMetadataForLanguage/);
  assert.match(privacy, /blocks=\{extractedPages\.privacy\}/);
  assert.match(terms, /localizeMarketingMetadataForLanguage/);
  assert.match(terms, /blocks=\{extractedPages\.tnc\}/);

  assert.doesNotMatch(
    `${blog}\n${legal}\n${privacy}\n${terms}`,
    /MutationObserver|querySelector(?:All)?\(|document\./,
  );

  const blogManifestSource = getSiteTranslationSource("route:blog");
  const blogExtractedSource = getSiteTranslationSource("route:blog", {
    mode: "extract",
  });
  assert.equal(blogExtractedSource.sourceHash, blogManifestSource.sourceHash);
  assert.deepEqual(
    blogExtractedSource.sourceStrings,
    blogManifestSource.sourceStrings,
  );
});

function sourceValueSet(namespace: "legal:privacy" | "legal:terms" | "legal:tnc") {
  return new Set(Object.values(getSiteSourceStrings(namespace, { mode: "extract" })));
}

function normalizedValueSet(values: readonly string[]) {
  return new Set(values.map((value) => value.replace(/\s+/g, " ").trim()));
}

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
