import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs, supportedLanguages } from "../../lib/content/languages";
import {
  expectedLocalizedStaticAssetPaths,
  staticAssetLocalizedPathContract,
  STATIC_ASSET_RELEASE_FILE_LIMIT,
  STATIC_ASSET_RELEASE_MAX_FILE_BYTES,
} from "./static-asset-release-contract";

/**
 * Admission limits backed by the Static Assets release contract. Cache totals
 * and total raw asset bytes remain metrics because OpenNext cache is not
 * uploaded and Cloudflare does not impose a total raw Static Assets byte cap.
 */
export type OpenNextResourceBudget = {
  assetFiles: number;
  largestAssetBytes: number;
};

export type OpenNextResourceMetrics = {
  ok: boolean;
  limits: OpenNextResourceBudget;
  assetBytes: number;
  assetFiles: number;
  largestAssetBytes: number;
  cacheBytes: number;
  cacheEntries: number;
  localizedCacheEntries: number;
  largestCacheEntryBytes: number;
  localizedAssetPathSetExact: boolean;
  localizedAssetPathsSha256: string;
  expectedLocalizedAssetPathsSha256: string;
  missingLocalizedAssetPaths: number;
  unexpectedLocalizedAssetPaths: number;
  translationAvailabilitySha256: string;
  expectedLocalizedAssetPathCount: number;
};

export type OpenNextResourceInspectionOptions = Readonly<{
  /** `null` is reserved for narrow synthetic metric/admission tests. */
  expectedLocalizedAssetPaths?: readonly string[] | null;
}>;

export { expectedLocalizedStaticAssetPaths };

export const defaultOpenNextResourceBudget: OpenNextResourceBudget = {
  assetFiles: STATIC_ASSET_RELEASE_FILE_LIMIT,
  largestAssetBytes: STATIC_ASSET_RELEASE_MAX_FILE_BYTES,
};

const localizedPrefixes = new Set(
  supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => languageConfigs[language].prefix),
);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const metrics = inspectOpenNextResourceBudget(process.cwd());
  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.ok) process.exitCode = 1;
}

export function inspectOpenNextResourceBudget(
  cwd: string,
  limits: OpenNextResourceBudget = defaultOpenNextResourceBudget,
  options: OpenNextResourceInspectionOptions = {},
): OpenNextResourceMetrics {
  const openNextRoot = path.join(cwd, ".open-next");
  const assetsRoot = path.join(openNextRoot, "assets");
  const cacheRoot = path.join(openNextRoot, "cache");
  const assetsPresent = fs.existsSync(assetsRoot) && fs.statSync(assetsRoot).isDirectory();
  const assetFiles = listFiles(assetsRoot);
  const cacheFiles = listFiles(cacheRoot);
  const assetPaths = assetFiles
    .map((file) => relativePath(assetsRoot, file))
    .sort(compareCodePoints);
  const localizedAssetPaths = assetPaths
    .filter(isLocalizedHtmlAsset)
    .sort(compareCodePoints);
  const expectedLocalizedAssetPathSet = options.expectedLocalizedAssetPaths === null
    ? undefined
    : [...(options.expectedLocalizedAssetPaths ?? expectedLocalizedStaticAssetPaths)]
        .sort(compareCodePoints);
  const localizedAssetPathSetExact = expectedLocalizedAssetPathSet === undefined ||
    equalStringArrays(localizedAssetPaths, expectedLocalizedAssetPathSet);
  const actualPathSet = new Set(localizedAssetPaths);
  const expectedPathSet = new Set(expectedLocalizedAssetPathSet ?? localizedAssetPaths);
  const missingLocalizedAssetPaths = [...expectedPathSet]
    .filter((entry) => !actualPathSet.has(entry)).length;
  const unexpectedLocalizedAssetPaths = [...actualPathSet]
    .filter((entry) => !expectedPathSet.has(entry)).length;
  const assetBytes = totalBytes(assetFiles);
  const largestAssetBytes = largestFileBytes(assetFiles);
  const cacheBytes = totalBytes(cacheFiles);
  const largestCacheEntryBytes = largestFileBytes(cacheFiles);
  const localizedCacheEntries = cacheFiles.filter((file) =>
    isLocalizedCacheEntry(cacheRoot, file)
  ).length;

  return {
    ok:
      assetsPresent &&
      assetFiles.length > 0 &&
      localizedAssetPathSetExact &&
      assetFiles.length <= limits.assetFiles &&
      largestAssetBytes <= limits.largestAssetBytes,
    limits,
    assetBytes,
    assetFiles: assetFiles.length,
    largestAssetBytes,
    cacheBytes,
    cacheEntries: cacheFiles.length,
    localizedCacheEntries,
    largestCacheEntryBytes,
    localizedAssetPathSetExact,
    localizedAssetPathsSha256: hashPathSet(localizedAssetPaths),
    expectedLocalizedAssetPathsSha256: hashPathSet(
      expectedLocalizedAssetPathSet ?? localizedAssetPaths,
    ),
    missingLocalizedAssetPaths,
    unexpectedLocalizedAssetPaths,
    translationAvailabilitySha256:
      staticAssetLocalizedPathContract.availabilitySha256,
    expectedLocalizedAssetPathCount:
      expectedLocalizedAssetPathSet?.length ?? localizedAssetPaths.length,
  };
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

function totalBytes(files: readonly string[]) {
  return files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
}

function largestFileBytes(files: readonly string[]) {
  return Math.max(0, ...files.map((file) => fs.statSync(file).size));
}

function isLocalizedCacheEntry(cacheRoot: string, file: string) {
  const parts = path.relative(cacheRoot, file).split(path.sep);
  const routeParts = parts.slice(1);
  const first = routeParts[0] ?? "";
  const candidate = first.endsWith(".cache") ? first.slice(0, -".cache".length) : first;
  return localizedPrefixes.has(candidate);
}

function isLocalizedHtmlAsset(assetPath: string) {
  const parts = assetPath.split("/");
  return assetPath.endsWith("/index.html") && localizedPrefixes.has(parts[0] ?? "");
}

function relativePath(root: string, file: string) {
  return path.relative(root, file).split(path.sep).join("/");
}

function hashPathSet(paths: readonly string[]) {
  return createHash("sha256").update(paths.join("\n")).digest("hex");
}

function equalStringArrays(left: readonly string[], right: readonly string[]) {
  return left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}

function compareCodePoints(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
