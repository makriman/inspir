import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const maxAssetFiles = 20_000;
const maxAssetBytes = 25 * 1024 * 1024;
const minimumHtmlDocuments = 100;
const minimumLocalizedHomeDocuments = 50;

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

  const cacheFiles = listFiles(buildRoot).filter((file) => file.endsWith(".cache")).sort();
  const generatedPaths: string[] = [];
  let htmlDocuments = 0;
  let localizedHomeDocuments = 0;
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
      if (/^[a-z]{2,3}\/index\.html$/.test(outputPath) || /^en-US\/index\.html$/.test(outputPath)) {
        localizedHomeDocuments += 1;
      }
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
  for (const required of [
    "index.html",
    "404.html",
    "manifest.webmanifest",
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
  ]) {
    if (!generatedPaths.includes(required)) throw new Error(`Required static document was not materialized: ${required}`);
  }
  if (generatedPaths.some((entry) => entry === "games/index.html" || entry.startsWith("games/"))) {
    throw new Error("Game routes must not be present in the static production assets.");
  }

  const outputSha256 = hashGeneratedOutput(assetsRoot, generatedPaths);
  const report: StaticMarketingAssetReport = {
    createdAt: new Date().toISOString(),
    buildId,
    cacheEntries: cacheFiles.length,
    htmlDocuments,
    localizedHomeDocuments,
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
  const firstSegment = cacheKey.split("/")[0] ?? "";
  if (privateAppPrefixes.has(firstSegment) || firstSegment.startsWith("_")) return null;
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
      (relative.startsWith("sitemap/") && relative.endsWith(".xml"))
    ) {
      fs.rmSync(file, { force: true });
    }
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
