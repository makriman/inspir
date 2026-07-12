import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs, supportedLanguages } from "../../lib/content/languages";

export type OpenNextResourceBudget = {
  artifactBytes: number;
  cacheBytes: number;
  cacheEntries: number;
  localizedCacheEntries: number;
  largestCacheEntryBytes: number;
};

export type OpenNextResourceMetrics = OpenNextResourceBudget & {
  ok: boolean;
  limits: OpenNextResourceBudget;
};

const localizedLanguageCount = supportedLanguages.filter(
  (language) => language !== defaultLanguage,
).length;

export const defaultOpenNextResourceBudget: OpenNextResourceBudget = {
  artifactBytes: 256 * 1024 * 1024,
  cacheBytes: 128 * 1024 * 1024,
  // The deploy intentionally prerenders three complete localized route
  // families: home, the static chat shell, and mission. Keep the localized
  // cap exact so a fourth family still fails closed. The separate 450-entry
  // internal-cache guard leaves only deterministic headroom; the materializer
  // independently enforces Cloudflare Free's final Static Asset file limit.
  cacheEntries: 450,
  localizedCacheEntries: localizedLanguageCount * 3,
  largestCacheEntryBytes: 2 * 1024 * 1024,
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
): OpenNextResourceMetrics {
  const artifactRoot = path.join(cwd, ".open-next");
  const cacheRoot = path.join(artifactRoot, "cache");
  const artifactPresent = fs.existsSync(artifactRoot) && fs.statSync(artifactRoot).isDirectory();
  const artifactFiles = listFiles(artifactRoot);
  const cacheFiles = listFiles(cacheRoot);
  // The native Worker deploy graph contains cloudflare-worker.ts and
  // `.open-next/assets`; `.open-next/cache` is build-time input consumed by
  // the static materializer and is never uploaded by wrangler.jsonc. Keep the
  // cache under its own strict byte/entry limits without counting the same
  // prerender payload a second time against the deployable-artifact budget.
  const cacheFileSet = new Set(cacheFiles);
  const deployableArtifactFiles = artifactFiles.filter((file) => !cacheFileSet.has(file));
  const artifactBytes = totalBytes(deployableArtifactFiles);
  const cacheBytes = totalBytes(cacheFiles);
  const largestCacheEntryBytes = Math.max(0, ...cacheFiles.map((file) => fs.statSync(file).size));
  const localizedCacheEntries = cacheFiles.filter((file) => isLocalizedCacheEntry(cacheRoot, file)).length;
  const metrics = {
    artifactBytes,
    cacheBytes,
    cacheEntries: cacheFiles.length,
    localizedCacheEntries,
    largestCacheEntryBytes,
  };

  return {
    ...metrics,
    ok:
      artifactPresent &&
      deployableArtifactFiles.length > 0 &&
      (Object.keys(limits) as Array<keyof OpenNextResourceBudget>).every((key) => metrics[key] <= limits[key]),
    limits,
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

function totalBytes(files: string[]) {
  return files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
}

function isLocalizedCacheEntry(cacheRoot: string, file: string) {
  const parts = path.relative(cacheRoot, file).split(path.sep);
  const routeParts = parts.slice(1);
  const first = routeParts[0] ?? "";
  const candidate = first.endsWith(".cache") ? first.slice(0, -".cache".length) : first;
  return localizedPrefixes.has(candidate);
}
