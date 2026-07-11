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

const maxAssetFiles = 20_000;
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
  "admin",
  "api",
  "chat",
  "games",
  "reset_pw",
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

type AppCacheEntry = {
  type: "app";
  html: string;
};

type RouteCacheEntry = {
  type: "route";
  body: string;
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
  routeDocuments: number;
  skippedEntries: number;
  assetFiles: number;
  largestAssetBytes: number;
  outputSha256: string;
  generatedPaths: string[];
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = materializeStaticMarketingAssets(process.cwd());
  console.log(JSON.stringify(report, null, 2));
}

export function materializeStaticMarketingAssets(cwd: string): StaticMarketingAssetReport {
  const openNextRoot = path.join(cwd, ".open-next");
  const assetsRoot = path.join(openNextRoot, "assets");
  const cacheRoot = path.join(openNextRoot, "cache");
  const buildRoot = findBuildRoot(cacheRoot);
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
    writeAsset(assetsRoot, outputPath, entry.body);
    generatedPaths.push(outputPath);
    routeDocuments += 1;
  }

  assertNoRemovedGameAssets(assetsRoot);

  const staticMainAppBundlePaths = writeStaticMainAppBundles(assetsRoot);
  generatedPaths.push(...staticMainAppBundlePaths);

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
  if (assetFiles.length > maxAssetFiles) {
    throw new Error(`Static asset count ${assetFiles.length} exceeds the Workers Free limit ${maxAssetFiles}.`);
  }
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
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    "api/topics",
    "_redirects",
  ]) {
    if (!generatedPaths.includes(required)) throw new Error(`Required static document was not materialized: ${required}`);
  }
  const outputSha256 = hashGeneratedOutput(assetsRoot, generatedPaths);
  const report: StaticMarketingAssetReport = {
    createdAt: new Date().toISOString(),
    buildId,
    cacheEntries: cacheFiles.length,
    htmlDocuments,
    localizedHomeDocuments,
    staticChatDocuments,
    staticChatRedirects: staticChatRedirects.total,
    staticChatExactRedirects: staticChatRedirects.exact,
    staticChatDynamicRedirects: staticChatRedirects.dynamic,
    staticMainAppBundles: staticMainAppBundlePaths.length,
    routeDocuments,
    skippedEntries,
    assetFiles: assetFiles.length,
    largestAssetBytes,
    outputSha256,
    generatedPaths,
  };
  fs.writeFileSync(
    path.join(openNextRoot, "static-marketing-assets-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function findBuildRoot(cacheRoot: string) {
  if (!fs.existsSync(cacheRoot)) throw new Error("OpenNext cache directory is missing.");
  const directories = fs
    .readdirSync(cacheRoot)
    .map((entry) => path.join(cacheRoot, entry))
    .filter((entry) => fs.statSync(entry).isDirectory());
  if (directories.length !== 1) {
    throw new Error(`Expected exactly one OpenNext cache build, found ${directories.length}.`);
  }
  return directories[0];
}

function parseCacheEntry(file: string): AppCacheEntry | RouteCacheEntry {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Invalid OpenNext cache object: ${file}`);
  if (parsed.type === "app" && typeof parsed.html === "string") return { type: "app", html: parsed.html };
  if (parsed.type === "route" && typeof parsed.body === "string") return { type: "route", body: parsed.body };
  throw new Error(`Unsupported OpenNext cache entry in ${file}.`);
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
  if (!textualRouteKeys.has(cacheKey)) return null;
  return cacheKey === "sitemap" ? "sitemap.xml" : cacheKey;
}

function writeAsset(assetsRoot: string, relativePath: string, content: string) {
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
      relative === "sitemap.xml" ||
      relative === "llms.txt" ||
      relative === "llms-full.txt" ||
      relative === "rss.xml" ||
      relative === "ai-content-index.json" ||
      relative === "api/topics" ||
      (relative.startsWith("i18n/main-app/") && relative.endsWith(".json")) ||
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

function listFiles(root: string) {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    const stats = fs.statSync(current);
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
