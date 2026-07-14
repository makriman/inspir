import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
} from "../../lib/content/languages";
import { topicSeeds } from "../../lib/content/topics";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { getMainAppSourceHash } from "../../lib/i18n/main-app-source";
import { buildStaticMainAppBundleAsset } from "../../lib/i18n/main-app-static-asset";
import {
  getPublishedLegacySiteTranslationPairs,
  legacyTranslationAssetPath,
} from "../../lib/i18n/legacy-api-compat";
import {
  materializeLegacyTranslationApiAssets,
  type LegacyTranslationApiAssetOptions,
} from "./materialize-legacy-translation-api-assets";
import {
  buildWorkerDeployArtifactManifest,
  type WorkerDeployArtifactManifest,
} from "./worker-deploy-evidence";

export const STATIC_ASSET_RELEASE_FILE_LIMIT = 5_000;
export const STATIC_ASSET_RELEASE_REPORT_MAX_AGE_MS = 60 * 60 * 1000;
const maxAssetBytes = 25 * 1024 * 1024;
const maxStaticRedirectRules = 2_000;
const maxDynamicRedirectRules = 100;
const maxTotalRedirectRules = 2_100;
const minimumHtmlDocuments = 100;
const minimumLocalizedHomeDocuments = supportedLanguages.length - 1;
const localizedHomeOutputPaths = new Set(
  supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => `${languageConfigs[language].prefix}/index.html`),
);
const localizedRoutePrefixes = new Set(
  supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => languageConfigs[language].prefix),
);
const staticChatCacheKeys = new Set([
  "chat",
  ...supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => `${languageConfigs[language].prefix}/chat`),
]);

const privateAppPrefixes = new Set([
  "_global-error",
  "api",
  "chat",
  "games",
]);

const textualRouteKeys = new Set([
  "ai-content-index.json",
  "api/topics",
  "llms-full.txt",
  "llms.txt",
  "manifest.webmanifest",
  "robots.txt",
  "rss.xml",
  "sitemap",
]);
const binaryRouteContentTypes: ReadonlyMap<string, string> = new Map([
  ["icon.png", "image/png"],
]);
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
const expectedLegacyTranslationReportCounts = {
  total: 280,
  mainApp: 70,
  site: 210,
  complete: 280,
  incomplete: 0,
} as const;
const expectedLegacyMainAppTranslationPaths = supportedLanguages.map((language) =>
  legacyTranslationAssetPath({ kind: "main-app", language }),
);
const expectedLegacySiteTranslationPaths = getPublishedLegacySiteTranslationPairs().map(
  ({ language, namespace }) =>
    legacyTranslationAssetPath({ kind: "site", language, namespace }),
);
const expectedLegacyTranslationPaths = [
  ...expectedLegacyMainAppTranslationPaths,
  ...expectedLegacySiteTranslationPaths,
].sort();
const expectedLegacyTranslationPathSet = new Set(expectedLegacyTranslationPaths);

type AppCacheEntry = {
  type: "app";
  html: string;
};

type RouteCacheEntry = {
  type: "route";
  body: string;
  contentType: string | null;
};

export type StaticMarketingAssetReport = {
  createdAt: string;
  buildId: string;
  cacheEntries: number;
  htmlDocuments: number;
  localizedHomeDocuments: number;
  staticChatDocuments: number;
  staticChatRedirects: number;
  staticChatExactRedirects: number;
  staticChatDynamicRedirects: number;
  staticMainAppBundles: number;
  legacyTranslationApiAssets: number;
  legacyMainAppTranslationResponses: number;
  legacySiteTranslationResponses: number;
  legacyCompleteTranslationResponses: number;
  legacyIncompleteTranslationResponses: number;
  legacyTranslationApiBytes: number;
  routeDocuments: number;
  skippedEntries: number;
  assetFiles: number;
  assetManifestBytes: number;
  assetManifestSha256: string;
  largestAssetBytes: number;
  outputSha256: string;
  generatedPaths: string[];
};

export type StaticMarketingAssetOptions = {
  legacyTranslationApi?: LegacyTranslationApiAssetOptions;
};

export type StaticMarketingAssetReleaseValidation = {
  createdAt: string;
  buildId: string;
  assetFiles: number;
  generatedPaths: number;
  legacyTranslationPaths: number;
  mainAppTranslationPaths: number;
  siteTranslationPaths: number;
  incompleteTranslationPaths: number;
  outputSha256: string;
  assetManifest: WorkerDeployArtifactManifest;
};

export type StaticMarketingAssetReleaseValidationOptions = {
  nowMs?: number;
  maxAgeMs?: number;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = materializeStaticMarketingAssets(process.cwd());
  console.log(JSON.stringify(report, null, 2));
}

export function assertStaticAssetReleaseFileCount(assetFileCount: number) {
  if (!Number.isSafeInteger(assetFileCount) || assetFileCount < 0) {
    throw new Error(`Static asset count must be a non-negative safe integer; received ${assetFileCount}.`);
  }
  if (assetFileCount > STATIC_ASSET_RELEASE_FILE_LIMIT) {
    throw new Error(
      `Static asset count ${assetFileCount} exceeds the internal release limit ${STATIC_ASSET_RELEASE_FILE_LIMIT}.`,
    );
  }
}

export function materializeStaticMarketingAssets(
  cwd: string,
  options: StaticMarketingAssetOptions = {},
): StaticMarketingAssetReport {
  const openNextRoot = path.join(cwd, ".open-next");
  const assetsRoot = path.join(openNextRoot, "assets");
  const cacheRoot = path.join(openNextRoot, "cache");
  const buildRoot = findReleaseBuildRoot(cacheRoot);
  const buildId = path.basename(buildRoot);

  if (!fs.existsSync(assetsRoot) || !fs.statSync(assetsRoot).isDirectory()) {
    throw new Error("OpenNext assets directory is missing; run the OpenNext build first.");
  }

  removePreviouslyMaterializedFiles(assetsRoot);
  removeEmptyDirectories(assetsRoot);

  const cacheFiles = listFiles(buildRoot).filter((file) => file.endsWith(".cache")).sort();
  const generatedPaths: string[] = [];
  let htmlDocuments = 0;
  let localizedHomeDocuments = 0;
  let staticChatDocuments = 0;
  let routeDocuments = 0;
  let skippedEntries = 0;

  for (const cacheFile of cacheFiles) {
    const cacheKey = cacheKeyForFile(buildRoot, cacheFile);
    const entry = parseCacheEntry(cacheFile);

    if (entry.type === "app") {
      const outputPath = htmlOutputPath(cacheKey);
      if (!outputPath) {
        skippedEntries += 1;
        continue;
      }
      writeAsset(assetsRoot, outputPath, entry.html);
      generatedPaths.push(outputPath);
      htmlDocuments += 1;
      if (localizedHomeOutputPaths.has(outputPath)) {
        localizedHomeDocuments += 1;
      }
      if (staticChatCacheKeys.has(cacheKey)) staticChatDocuments += 1;
      continue;
    }

    const outputPath = routeOutputPath(cacheKey);
    if (!outputPath) {
      skippedEntries += 1;
      continue;
    }
    writeAsset(assetsRoot, outputPath, routeAssetContent(cacheKey, entry));
    generatedPaths.push(outputPath);
    routeDocuments += 1;
  }

  assertNoRemovedGameAssets(assetsRoot);

  const staticMainAppBundlePaths = writeStaticMainAppBundles(assetsRoot);
  generatedPaths.push(...staticMainAppBundlePaths);

  const legacyTranslationApi = materializeLegacyTranslationApiAssets(
    assetsRoot,
    options.legacyTranslationApi,
  );
  generatedPaths.push(...legacyTranslationApi.paths);

  const staticChatRedirects = writeStaticRedirects(cwd, assetsRoot);
  generatedPaths.push("_redirects");

  generatedPaths.sort();
  const assetFiles = listFiles(assetsRoot);
  const imageOptimizerReferences = assetFiles
    .filter((file) => file.endsWith(".html"))
    .flatMap((file) =>
      fs.readFileSync(file, "utf8").includes("/_next/image")
        ? [path.relative(assetsRoot, file).split(path.sep).join("/")]
        : [],
    );
  if (imageOptimizerReferences.length > 0) {
    throw new Error(
      `Static HTML must not depend on the billable Next image optimizer: ${imageOptimizerReferences
        .slice(0, 10)
        .join(", ")}`,
    );
  }
  const largestAssetBytes = Math.max(0, ...assetFiles.map((file) => fs.statSync(file).size));
  assertStaticAssetReleaseFileCount(assetFiles.length);
  if (largestAssetBytes > maxAssetBytes) {
    throw new Error(`Largest static asset ${largestAssetBytes} bytes exceeds the ${maxAssetBytes}-byte limit.`);
  }
  if (htmlDocuments < minimumHtmlDocuments) {
    throw new Error(`Only ${htmlDocuments} public HTML documents were materialized; expected at least ${minimumHtmlDocuments}.`);
  }
  if (localizedHomeDocuments < minimumLocalizedHomeDocuments) {
    throw new Error(
      `Only ${localizedHomeDocuments} localized home documents were materialized; expected at least ${minimumLocalizedHomeDocuments}.`,
    );
  }
  if (staticChatDocuments !== staticChatCacheKeys.size) {
    throw new Error(
      `Only ${staticChatDocuments} static chat documents were materialized; expected ${staticChatCacheKeys.size}.`,
    );
  }
  for (const required of [
    "index.html",
    "404.html",
    "manifest.webmanifest",
    "icon.png",
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    "api/topics",
    "admin/index.html",
    "_redirects",
  ]) {
    if (!generatedPaths.includes(required)) throw new Error(`Required static document was not materialized: ${required}`);
  }
  const assetManifest = buildWorkerDeployArtifactManifest(assetsRoot);
  if (assetManifest.fileCount !== assetFiles.length) {
    throw new Error(
      `Static Asset tree changed during materialization: counted ${assetFiles.length} files, then ${assetManifest.fileCount}.`,
    );
  }
  const outputSha256 = hashGeneratedOutput(assetsRoot, generatedPaths);
  const createdAt = new Date().toISOString();
  const report: StaticMarketingAssetReport = {
    createdAt,
    buildId,
    cacheEntries: cacheFiles.length,
    htmlDocuments,
    localizedHomeDocuments,
    staticChatDocuments,
    staticChatRedirects: staticChatRedirects.total,
    staticChatExactRedirects: staticChatRedirects.exact,
    staticChatDynamicRedirects: staticChatRedirects.dynamic,
    staticMainAppBundles: staticMainAppBundlePaths.length,
    legacyTranslationApiAssets: legacyTranslationApi.paths.length,
    legacyMainAppTranslationResponses: legacyTranslationApi.mainAppResponses,
    legacySiteTranslationResponses: legacyTranslationApi.siteResponses,
    legacyCompleteTranslationResponses: legacyTranslationApi.completeResponses,
    legacyIncompleteTranslationResponses: legacyTranslationApi.incompleteResponses,
    legacyTranslationApiBytes: legacyTranslationApi.bytes,
    routeDocuments,
    skippedEntries,
    assetFiles: assetFiles.length,
    assetManifestBytes: assetManifest.bytes,
    assetManifestSha256: assetManifest.sha256,
    largestAssetBytes,
    outputSha256,
    generatedPaths,
  };
  fs.writeFileSync(
    path.join(openNextRoot, "static-marketing-assets-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const partialLegacyTranslationFixture =
    options.legacyTranslationApi?.mainAppLanguages !== undefined ||
    options.legacyTranslationApi?.sitePairs !== undefined;
  if (!partialLegacyTranslationFixture) {
    validateStaticMarketingAssetRelease(cwd, { nowMs: Date.parse(createdAt) });
  }
  return report;
}

export function validateStaticMarketingAssetRelease(
  cwd: string,
  options: StaticMarketingAssetReleaseValidationOptions = {},
): StaticMarketingAssetReleaseValidation {
  const openNextRoot = path.join(cwd, ".open-next");
  const assetsRoot = path.join(openNextRoot, "assets");
  const reportPath = path.join(openNextRoot, "static-marketing-assets-report.json");
  const reportStat = lstatRequiredReleasePath(reportPath, "Static Asset materialization report");
  if (reportStat.isSymbolicLink() || !reportStat.isFile()) {
    throw new Error("Static Asset materialization report must be a regular non-symlink file.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Static Asset materialization report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("Static Asset materialization report must be a JSON object.");
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STATIC_ASSET_RELEASE_REPORT_MAX_AGE_MS;
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("Static Asset release validation requires a finite clock and non-negative safe max age.");
  }
  const createdAt = requireReleaseReportString(parsed, "createdAt");
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs) || new Date(createdAtMs).toISOString() !== createdAt) {
    throw new Error("Static Asset materialization report createdAt must be a canonical ISO timestamp.");
  }
  const reportAgeMs = nowMs - createdAtMs;
  if (reportAgeMs < 0 || reportAgeMs > maxAgeMs) {
    throw new Error(
      `Static Asset materialization report is stale or from the future: age ${reportAgeMs}ms, maximum ${maxAgeMs}ms.`,
    );
  }

  const buildId = requireReleaseReportString(parsed, "buildId");
  const currentBuildId = path.basename(findReleaseBuildRoot(path.join(openNextRoot, "cache")));
  if (buildId !== currentBuildId) {
    throw new Error(
      `Static Asset materialization report buildId ${buildId} does not match the current OpenNext build ${currentBuildId}.`,
    );
  }

  assertExpectedLegacyTranslationContract();
  const generatedPaths = requireReleaseReportStringArray(parsed, "generatedPaths");
  for (const generatedPath of generatedPaths) assertSafeReleaseAssetPath(generatedPath);
  if (!sameStringSequence(generatedPaths, [...generatedPaths].sort())) {
    throw new Error("Static Asset materialization report generatedPaths must be sorted.");
  }
  if (new Set(generatedPaths).size !== generatedPaths.length) {
    throw new Error("Static Asset materialization report generatedPaths must not contain duplicates.");
  }

  const reportCounts = {
    total: requireReleaseReportInteger(parsed, "legacyTranslationApiAssets"),
    mainApp: requireReleaseReportInteger(parsed, "legacyMainAppTranslationResponses"),
    site: requireReleaseReportInteger(parsed, "legacySiteTranslationResponses"),
    complete: requireReleaseReportInteger(parsed, "legacyCompleteTranslationResponses"),
    incomplete: requireReleaseReportInteger(parsed, "legacyIncompleteTranslationResponses"),
  };
  for (const key of ["total", "mainApp", "site", "complete", "incomplete"] as const) {
    if (reportCounts[key] !== expectedLegacyTranslationReportCounts[key]) {
      throw new Error(
        `Static Asset materialization report legacy ${key} count ${reportCounts[key]} must equal ${expectedLegacyTranslationReportCounts[key]}.`,
      );
    }
  }

  const reportLegacyPaths = generatedPaths.filter((entry) =>
    entry.startsWith("i18n/legacy-api/"),
  );
  assertNoIncompleteLegacyPaths(reportLegacyPaths, "reported");
  assertExactLegacyTranslationPaths(reportLegacyPaths, "reported");

  const actualPaths = listReleaseAssetPaths(assetsRoot);
  const assetFiles = requireReleaseReportInteger(parsed, "assetFiles");
  assertStaticAssetReleaseFileCount(actualPaths.length);
  if (assetFiles !== actualPaths.length) {
    throw new Error(
      `Static Asset materialization report declares ${assetFiles} asset files but the release tree contains ${actualPaths.length}.`,
    );
  }
  const actualLegacyPaths = actualPaths.filter((entry) =>
    entry.startsWith("i18n/legacy-api/"),
  );
  assertNoIncompleteLegacyPaths(actualLegacyPaths, "materialized");
  assertExactLegacyTranslationPaths(actualLegacyPaths, "materialized");
  const actualPathSet = new Set(actualPaths);
  const missingGeneratedPaths = generatedPaths.filter((entry) => !actualPathSet.has(entry));
  if (missingGeneratedPaths.length > 0) {
    throw new Error(
      `Static Asset release tree is missing reported generated paths: ${missingGeneratedPaths.slice(0, 10).join(", ")}.`,
    );
  }

  const outputSha256 = requireReleaseReportSha256(parsed, "outputSha256");
  const actualOutputSha256 = hashGeneratedOutput(assetsRoot, generatedPaths);
  if (outputSha256 !== actualOutputSha256) {
    throw new Error(
      `Static Asset generated-output hash does not match its report: expected ${outputSha256}, received ${actualOutputSha256}.`,
    );
  }

  const reportedAssetManifestBytes = requireReleaseReportInteger(
    parsed,
    "assetManifestBytes",
  );
  const reportedAssetManifestSha256 = requireReleaseReportSha256(
    parsed,
    "assetManifestSha256",
  );
  const assetManifest = buildWorkerDeployArtifactManifest(assetsRoot);
  if (
    assetManifest.fileCount !== assetFiles ||
    assetManifest.bytes !== reportedAssetManifestBytes ||
    assetManifest.sha256 !== reportedAssetManifestSha256
  ) {
    throw new Error(
      "Static Asset release tree manifest does not match the materialization report.",
    );
  }

  return {
    createdAt,
    buildId,
    assetFiles,
    generatedPaths: generatedPaths.length,
    legacyTranslationPaths: reportLegacyPaths.length,
    mainAppTranslationPaths: expectedLegacyMainAppTranslationPaths.length,
    siteTranslationPaths: expectedLegacySiteTranslationPaths.length,
    incompleteTranslationPaths: 0,
    outputSha256,
    assetManifest,
  };
}

function parseCacheEntry(file: string): AppCacheEntry | RouteCacheEntry {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Invalid OpenNext cache object: ${file}`);
  if (parsed.type === "app" && typeof parsed.html === "string") return { type: "app", html: parsed.html };
  if (parsed.type === "route" && typeof parsed.body === "string") {
    return { type: "route", body: parsed.body, contentType: cacheEntryContentType(parsed) };
  }
  throw new Error(`Unsupported OpenNext cache entry in ${file}.`);
}

function cacheEntryContentType(entry: Record<string, unknown>) {
  if (!isRecord(entry.meta) || !isRecord(entry.meta.headers)) return null;
  const value = entry.meta.headers["content-type"];
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

function cacheKeyForFile(buildRoot: string, file: string) {
  const relative = path.relative(buildRoot, file).split(path.sep).join("/");
  if (!relative.endsWith(".cache")) throw new Error(`Unexpected cache filename: ${relative}`);
  const key = relative.slice(0, -".cache".length);
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\")) {
    throw new Error(`Unsafe OpenNext cache key: ${key}`);
  }
  return key;
}

function htmlOutputPath(cacheKey: string) {
  if (cacheKey === "_not-found") return "404.html";
  if (staticChatCacheKeys.has(cacheKey)) return `${cacheKey}/index.html`;
  const segments = cacheKey.split("/");
  const firstSegment = segments[0] ?? "";
  const appRouteSegment = localizedRoutePrefixes.has(firstSegment)
    ? (segments[1] ?? "")
    : firstSegment;
  if (
    (localizedRoutePrefixes.has(firstSegment) && appRouteSegment === "admin") ||
    privateAppPrefixes.has(appRouteSegment) ||
    appRouteSegment.startsWith("_") ||
    segments.includes("games")
  ) {
    return null;
  }
  return cacheKey === "index" ? "index.html" : `${cacheKey}/index.html`;
}

function routeOutputPath(cacheKey: string) {
  if (cacheKey.startsWith("sitemap/") && cacheKey.endsWith(".xml")) return cacheKey;
  if (binaryRouteContentTypes.has(cacheKey)) return cacheKey;
  if (!textualRouteKeys.has(cacheKey)) return null;
  return cacheKey === "sitemap" ? "sitemap.xml" : cacheKey;
}

function routeAssetContent(cacheKey: string, entry: RouteCacheEntry) {
  const expectedContentType = binaryRouteContentTypes.get(cacheKey);
  if (!expectedContentType) return entry.body;
  if (entry.contentType !== expectedContentType) {
    throw new Error(
      `OpenNext ${cacheKey} cache must use ${expectedContentType}; received ${entry.contentType ?? "no content type"}.`,
    );
  }
  if (
    entry.body.length === 0 ||
    entry.body.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.body)
  ) {
    throw new Error(`OpenNext ${cacheKey} cache must contain canonical base64.`);
  }
  const content = Buffer.from(entry.body, "base64");
  if (content.toString("base64") !== entry.body || !content.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`OpenNext ${cacheKey} cache must contain a valid PNG.`);
  }
  return content;
}

function writeAsset(assetsRoot: string, relativePath: string, content: string | Uint8Array) {
  const destination = path.resolve(assetsRoot, relativePath);
  const normalizedRoot = `${path.resolve(assetsRoot)}${path.sep}`;
  if (!destination.startsWith(normalizedRoot)) throw new Error(`Refusing unsafe asset path: ${relativePath}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function writeStaticRedirects(cwd: string, assetsRoot: string) {
  const sourcePath = path.join(cwd, "public", "_redirects");
  if (!fs.existsSync(sourcePath)) throw new Error("The committed public/_redirects file is missing.");

  const source = fs.readFileSync(sourcePath, "utf8").trim();
  if (/^\s*\/(?:[^\s]*\/)?chat\/\*/m.test(source)) {
    throw new Error("Broad chat wildcard redirects would turn unknown or private chat URLs into soft 404s.");
  }
  const exactTopicRules: string[] = [];
  const dynamicTopicRules: string[] = [];
  for (const topic of topicSeeds) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic.slug)) {
      throw new Error(`Unsafe static chat topic slug: ${topic.slug}`);
    }
    exactTopicRules.push(`/chat/${topic.slug} /chat?topic=${topic.slug} 308`);
    dynamicTopicRules.push(`/:locale/chat/${topic.slug} /:locale/chat?topic=${topic.slug} 308`);
  }
  const committedRules = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const committedDynamicRules = committedRules.filter((line) => {
    const sourcePattern = line.split(/\s+/, 1)[0] ?? "";
    return sourcePattern.includes(":") || sourcePattern.includes("*");
  }).length;
  const committedStaticRules = committedRules.length - committedDynamicRules;
  const dynamicRules = committedDynamicRules + dynamicTopicRules.length;
  const staticRules = committedStaticRules + exactTopicRules.length;
  if (dynamicRules > maxDynamicRedirectRules) {
    throw new Error(
      `Static Assets would have ${dynamicRules} dynamic redirect rules; the limit is ${maxDynamicRedirectRules}.`,
    );
  }
  if (staticRules > maxStaticRedirectRules || staticRules + dynamicRules > maxTotalRedirectRules) {
    throw new Error(
      `Static Assets redirect rules exceed the platform limits: ${staticRules} static, ${dynamicRules} dynamic.`,
    );
  }
  const content = [
    source,
    "",
    "# Exact public topic redirects preserve static 404s for unknown and private chat paths.",
    ...exactTopicRules,
    ...dynamicTopicRules,
    "",
  ].join("\n");
  writeAsset(assetsRoot, "_redirects", content);
  return {
    total: exactTopicRules.length + dynamicTopicRules.length,
    exact: exactTopicRules.length,
    dynamic: dynamicTopicRules.length,
  };
}

function writeStaticMainAppBundles(assetsRoot: string) {
  const sourceHash = getMainAppSourceHash();
  return supportedLanguages.map((language) => {
    const bundle = getCuratedMainAppTranslationBundle(language);
    if (!bundle || bundle.sourceHash !== sourceHash || bundle.language !== language) {
      throw new Error(`The static main-app translation bundle is incomplete for ${language}.`);
    }
    const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
    const asset = buildStaticMainAppBundleAsset(locale, bundle);
    writeAsset(assetsRoot, asset.relativePath, asset.serialized);
    return asset.relativePath;
  });
}

function removePreviouslyMaterializedFiles(assetsRoot: string) {
  for (const file of listFiles(assetsRoot)) {
    const relative = path.relative(assetsRoot, file).split(path.sep).join("/");
    if (
      relative.endsWith("/index.html") ||
      relative === "index.html" ||
      relative === "404.html" ||
      relative === "robots.txt" ||
      relative === "manifest.webmanifest" ||
      relative === "icon.png" ||
      relative === "sitemap.xml" ||
      relative === "llms.txt" ||
      relative === "llms-full.txt" ||
      relative === "rss.xml" ||
      relative === "ai-content-index.json" ||
      relative === "api/topics" ||
      (relative.startsWith("i18n/main-app/") && relative.endsWith(".json")) ||
      (relative.startsWith("i18n/legacy-api/") && relative.endsWith(".json")) ||
      (relative.startsWith("sitemap/") && relative.endsWith(".xml"))
    ) {
      fs.rmSync(file, { force: true });
    }
  }
}

function removeEmptyDirectories(root: string) {
  for (const entry of fs.readdirSync(root)) {
    const entryPath = path.join(root, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    removeEmptyDirectories(entryPath);
    if (fs.readdirSync(entryPath).length === 0) fs.rmdirSync(entryPath);
  }
}

function assertNoRemovedGameAssets(assetsRoot: string) {
  const removedGameAssets = listFiles(assetsRoot)
    .map((file) => path.relative(assetsRoot, file).split(path.sep).join("/"))
    .filter((file) => file.split("/").includes("games"));
  if (removedGameAssets.length > 0) {
    throw new Error(
      `Game assets must not be present in the static production output: ${removedGameAssets
        .slice(0, 10)
        .join(", ")}`,
    );
  }
}

function hashGeneratedOutput(assetsRoot: string, generatedPaths: string[]) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of generatedPaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(assetsRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function lstatRequiredReleasePath(filePath: string, label: string) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${filePath}`, { cause: error });
  }
}

function findReleaseBuildRoot(cacheRoot: string) {
  const cacheStat = lstatRequiredReleasePath(cacheRoot, "OpenNext cache directory");
  if (cacheStat.isSymbolicLink() || !cacheStat.isDirectory()) {
    throw new Error("OpenNext cache root must be a non-symlink directory.");
  }
  const directories: string[] = [];
  for (const entry of fs.readdirSync(cacheRoot)) {
    const entryPath = path.join(cacheRoot, entry);
    const entryStat = lstatRequiredReleasePath(entryPath, "OpenNext cache entry");
    if (entryStat.isSymbolicLink()) {
      throw new Error(`OpenNext cache must not contain symlinks: ${entryPath}`);
    }
    if (entryStat.isDirectory()) directories.push(entryPath);
    else if (!entryStat.isFile()) {
      throw new Error(`OpenNext cache contains an unsupported entry: ${entryPath}`);
    }
  }
  if (directories.length !== 1) {
    throw new Error(`Expected exactly one OpenNext cache build, found ${directories.length}.`);
  }
  return directories[0]!;
}

function requireReleaseReportString(report: Record<string, unknown>, key: string) {
  const value = report[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Static Asset materialization report ${key} must be a non-empty string.`);
  }
  return value;
}

function requireReleaseReportSha256(report: Record<string, unknown>, key: string) {
  const value = requireReleaseReportString(report, key);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Static Asset materialization report ${key} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function requireReleaseReportInteger(report: Record<string, unknown>, key: string) {
  const value = report[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Static Asset materialization report ${key} must be a non-negative safe integer.`);
  }
  return value;
}

function requireReleaseReportStringArray(report: Record<string, unknown>, key: string) {
  const value = report[key];
  if (
    !Array.isArray(value) ||
    !value.every((entry): entry is string => typeof entry === "string")
  ) {
    throw new Error(`Static Asset materialization report ${key} must contain only strings.`);
  }
  return [...value];
}

function assertExpectedLegacyTranslationContract() {
  if (
    expectedLegacyMainAppTranslationPaths.length !==
      expectedLegacyTranslationReportCounts.mainApp ||
    expectedLegacySiteTranslationPaths.length !== expectedLegacyTranslationReportCounts.site ||
    expectedLegacyTranslationPaths.length !== expectedLegacyTranslationReportCounts.total ||
    expectedLegacyTranslationPathSet.size !== expectedLegacyTranslationReportCounts.total
  ) {
    throw new Error(
      "Legacy translation source manifests must derive exactly 70 main-app and 210 site paths (280 unique total).",
    );
  }
}

function assertSafeReleaseAssetPath(relativePath: string) {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath === "." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(`Static Asset release contains an unsafe relative path: ${relativePath || "empty"}.`);
  }
}

function listReleaseAssetPaths(assetsRoot: string) {
  const rootStat = lstatRequiredReleasePath(assetsRoot, "Static Asset release tree");
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Static Asset release tree must be a non-symlink directory.");
  }
  const relativePaths: string[] = [];
  const pending = [assetsRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of fs.readdirSync(directory)) {
      const entryPath = path.join(directory, entry);
      const entryStat = lstatRequiredReleasePath(entryPath, "Static Asset release entry");
      if (entryStat.isSymbolicLink()) {
        throw new Error(`Static Asset release tree must not contain symlinks: ${entryPath}`);
      }
      if (entryStat.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entryStat.isFile()) {
        throw new Error(`Static Asset release tree contains an unsupported entry: ${entryPath}`);
      }
      const relativePath = path.relative(assetsRoot, entryPath).split(path.sep).join("/");
      assertSafeReleaseAssetPath(relativePath);
      relativePaths.push(relativePath);
    }
  }
  relativePaths.sort();
  if (relativePaths.length === 0) {
    throw new Error("Static Asset release tree must contain at least one file.");
  }
  return relativePaths;
}

function assertNoIncompleteLegacyPaths(paths: readonly string[], label: string) {
  const incompletePaths = paths.filter((entry) => entry.includes(".incomplete"));
  if (incompletePaths.length > 0) {
    throw new Error(
      `Static Asset release contains ${label} incomplete legacy translation paths: ${incompletePaths.slice(0, 10).join(", ")}.`,
    );
  }
}

function assertExactLegacyTranslationPaths(paths: readonly string[], label: string) {
  const actual = new Set(paths);
  const missing = expectedLegacyTranslationPaths.filter((entry) => !actual.has(entry));
  const extra = [...actual].filter((entry) => !expectedLegacyTranslationPathSet.has(entry));
  const duplicateCount = paths.length - actual.size;
  if (missing.length > 0 || extra.length > 0 || duplicateCount > 0) {
    throw new Error(
      `Static Asset release ${label} legacy translation paths must be the exact 280-path contract; missing=${missing.length}, extra=${extra.length}, duplicates=${duplicateCount}.`,
    );
  }
}

function sameStringSequence(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value);
}

function listFiles(root: string) {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`Static Asset materialization must not traverse symlinks: ${current}`);
    }
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
    } else if (stats.isFile()) {
      files.push(current);
    }
  }
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
