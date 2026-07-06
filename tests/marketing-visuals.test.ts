import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { audiencePath, getAudiencePages } from "../lib/content/audiences";
import { comparisonPath, getComparisonPages } from "../lib/content/comparisons";
import { getBlogCategories } from "../lib/content/blog";
import { homepageLearningPaths, learningPathHref } from "../lib/content/landing";
import {
  audienceHeroVisualBySlug,
  blogCategoryHeroVisualBySlug,
  comparisonHeroVisualBySlug,
  getAudienceHeroVisual,
  getBlogCategoryHeroVisual,
  getComparisonHeroVisual,
  getLearningPathHeroVisual,
  getSubjectHeroVisual,
  learningPathHeroVisualBySlug,
  marketingHeroVisualAssetById,
  subjectHeroVisualBySlug,
  type MarketingHeroVisual,
} from "../lib/content/marketing-visuals";
import { getSubjectPages, subjectPath } from "../lib/content/subjects";

function hasOwnKey<T extends object>(record: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function missingMappedSlugs<TMap extends object>(
  slugs: string[],
  map: TMap,
): string[] {
  return slugs.filter((slug) => !hasOwnKey(map, slug));
}

test("generated marketing detail routes have explicit hero visual maps", () => {
  assert.deepEqual(
    missingMappedSlugs(getSubjectPages().map((page) => page.slug), subjectHeroVisualBySlug),
    [],
  );
  assert.deepEqual(
    missingMappedSlugs(getComparisonPages().map((page) => page.slug), comparisonHeroVisualBySlug),
    [],
  );
  assert.deepEqual(
    missingMappedSlugs(getAudiencePages().map((page) => page.slug), audienceHeroVisualBySlug),
    [],
  );
  assert.deepEqual(
    missingMappedSlugs(homepageLearningPaths.map((page) => page.slug), learningPathHeroVisualBySlug),
    [],
  );
  assert.deepEqual(
    missingMappedSlugs(getBlogCategories().map((category) => category.slug), blogCategoryHeroVisualBySlug),
    [],
  );
});

test("image-backed marketing routes do not reuse hero image assets", () => {
  const routes: Array<{ path: string; visual: MarketingHeroVisual }> = [
    { path: "/about", visual: "about" },
    { path: "/topics", visual: "modes" },
    { path: "/subjects", visual: "subjects" },
    { path: "/prompts", visual: "prompts" },
    { path: "/ai-learning-map", visual: "map" },
    { path: "/media", visual: "media" },
    { path: "/schools", visual: "schools" },
    { path: "/trust", visual: "trust" },
    { path: "/compare", visual: "compare" },
    { path: "/for", visual: "audience" },
    { path: "/learn", visual: "paths" },
    ...getSubjectPages().map((page) => ({
      path: subjectPath(page.slug),
      visual: getSubjectHeroVisual(page.slug),
    })),
    ...getComparisonPages().map((page) => ({
      path: comparisonPath(page.slug),
      visual: getComparisonHeroVisual(page.slug),
    })),
    ...getAudiencePages().map((page) => ({
      path: audiencePath(page.slug),
      visual: getAudienceHeroVisual(page.slug),
    })),
    ...homepageLearningPaths.map((page) => ({
      path: learningPathHref(page.slug),
      visual: getLearningPathHeroVisual(page.slug),
    })),
    ...getBlogCategories().map((category) => ({
      path: `/blog/category/${category.slug}`,
      visual: getBlogCategoryHeroVisual(category.slug),
    })),
  ];
  const firstRouteByAsset = new Map<string, string>();
  const duplicates: Array<{ asset: string; firstPath: string; duplicatePath: string }> = [];

  for (const route of routes) {
    const asset = marketingHeroVisualAssetById[route.visual];
    const firstPath = firstRouteByAsset.get(asset);
    if (firstPath) {
      duplicates.push({ asset, firstPath, duplicatePath: route.path });
    } else {
      firstRouteByAsset.set(asset, route.path);
    }
  }

  assert.deepEqual(duplicates, []);
});

test("marketing hero visual assets exist in public media", () => {
  const missingAssets = Object.values(marketingHeroVisualAssetById).filter((asset) => {
    const publicPath = path.join(process.cwd(), "public", asset.replace(/^\/+/, ""));
    return !existsSync(publicPath);
  });

  assert.deepEqual(missingAssets, []);
});
