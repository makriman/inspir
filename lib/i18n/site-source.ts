import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { defaultLanguage } from "@/lib/content/languages";
import type { TranslationBundle, TranslationSource } from "./translation-types";

export const siteTranslationNamespace = "marketing-site";
export const marketingShellTranslationNamespace = "marketing-shell";
export const legalEnglishControlsNotice =
  "This translation is provided for readability. If there is any conflict, the English version controls.";

const sourceRoots = [
  "app",
  "components/marketing",
  "components/legal",
  "lib/content",
  "lib/seo/config.ts",
  "lib/seo/json-ld.ts",
  "content/blog",
] as const;

const skippedAppSegments = new Set(["api", "admin"]);
const skippedJsxAttributes = new Set([
  "className",
  "href",
  "src",
  "rel",
  "target",
  "id",
  "htmlFor",
  "type",
  "width",
  "height",
  "sizes",
  "poster",
  "preload",
]);
const visibleJsxAttributes = new Set(["aria-label", "title", "placeholder", "alt"]);
const translatableFrontmatterKeys = new Set(["title", "description", "tags"]);
const staticSiteTranslationNamespaces = [
  marketingShellTranslationNamespace,
  "route:home",
  "route:about",
  "route:ai-learning-map",
  "route:blog",
  "route:chat-public",
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
  "legal:tnc",
] as const;
const legalNamespaces = new Set(["legal:privacy", "legal:terms", "legal:tnc"]);
let cachedCandidateSourceFiles: string[] | undefined;
const extractedSourceValueCache = new Map<string, string[]>();

export function getSiteTranslationSource(namespace = siteTranslationNamespace): TranslationSource {
  const sourceStrings = getSiteSourceStrings(namespace);
  return {
    namespace,
    sourceHash: getSiteSourceHash(sourceStrings),
    sourceStrings,
    systemInstruction: buildSiteTranslationSystemInstruction(),
  };
}

export function getEnglishSiteTranslationBundle(namespace = siteTranslationNamespace): TranslationBundle {
  const source = getSiteTranslationSource(namespace);
  return {
    namespace,
    language: defaultLanguage,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
    strings: source.sourceStrings,
  };
}

export function getSiteSourceStrings(namespace = siteTranslationNamespace) {
  const values = new Set<string>();
  if (namespace === siteTranslationNamespace || legalNamespaces.has(namespace)) {
    values.add(legalEnglishControlsNotice);
  }

  for (const path of getSourceFiles(namespace)) {
    for (const value of getExtractedSourceValues(path)) {
      addSourceValue(values, value);
    }
  }

  return Object.fromEntries(
    Array.from(values)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => [`site.${hashText(value).slice(0, 18)}`, value]),
  );
}

function getExtractedSourceValues(path: string) {
  const cached = extractedSourceValueCache.get(path);
  if (cached) return cached;
  const source = readFileSync(path, "utf8");
  const values = path.endsWith(".md") ? extractMarkdownText(source) : extractTsxText(path, source);
  extractedSourceValueCache.set(path, values);
  return values;
}

export function getAllSiteTranslationNamespaces() {
  return [
    ...staticSiteTranslationNamespaces,
    ...getBlogSlugs().map((slug) => `blog:${slug}`),
  ];
}

export function isKnownSiteTranslationNamespace(namespace: string) {
  return namespace === siteTranslationNamespace || getAllSiteTranslationNamespaces().includes(namespace);
}

export function getSiteTranslationNamespacesForPath(pathname: string) {
  const path = normalizePath(pathname);
  const namespaces = new Set<string>([marketingShellTranslationNamespace]);
  const firstSegment = path === "/" ? "" : path.split("/").filter(Boolean)[0] ?? "";

  if (path === "/") namespaces.add("route:home");
  else if (firstSegment === "privacy") namespaces.add("legal:privacy");
  else if (firstSegment === "terms") namespaces.add("legal:terms");
  else if (firstSegment === "tnc") namespaces.add("legal:tnc");
  else if (firstSegment === "blog") {
    namespaces.add("route:blog");
    const [, maybeSlug] = path.match(/^\/blog\/([^/]+)$/) ?? [];
    if (maybeSlug && maybeSlug !== "category") namespaces.add(`blog:${maybeSlug}`);
  } else if (firstSegment === "chat") {
    namespaces.add("route:chat-public");
  } else {
    const routeNamespace = `route:${firstSegment || "home"}`;
    if (staticSiteTranslationNamespaces.includes(routeNamespace as (typeof staticSiteTranslationNamespaces)[number])) {
      namespaces.add(routeNamespace);
    } else {
      namespaces.add("route:home");
    }
  }

  return Array.from(namespaces).filter(isKnownSiteTranslationNamespace);
}

export function getSiteSourceHash(sourceStrings = getSiteSourceStrings()) {
  const stablePayload = Object.keys(sourceStrings)
    .sort()
    .map((key) => `${key}\u0000${sourceStrings[key]}`)
    .join("\u0001");
  return createHash("sha256").update(stablePayload).digest("hex");
}

export function buildSiteTranslationSystemInstruction() {
  return [
    "You are a meticulous localization specialist for inspir, an education website and AI learning app.",
    "Translate exactly the provided visible website, article, metadata, legal, or app-adjacent text into the target language.",
    "Return only JSON with the translated value in the value field.",
    "Preserve markdown-visible meaning, placeholders, punctuation attached to placeholders, URLs, route slugs, code terms, and the product name inspir.",
    "Do not translate HTML class names, file names, package names, route paths, email addresses, URLs, or code identifiers.",
    "Legal translations must be clear and conservative; do not add legal obligations or remove limitations.",
    "Use natural educational product copy in the target language.",
  ].join("\n");
}

function getSourceFiles(namespace = siteTranslationNamespace) {
  if (!isKnownSiteTranslationNamespace(namespace)) return [];
  const root = process.cwd();
  return getCandidateSourceFiles().filter((path) =>
    fileBelongsToNamespace(relative(root, path), namespace),
  );
}

function getCandidateSourceFiles() {
  if (cachedCandidateSourceFiles) return cachedCandidateSourceFiles;

  const files: string[] = [];
  const root = process.cwd();

  for (const sourceRoot of sourceRoots) {
    const path = join(root, sourceRoot);
    if (!existsSync(path)) continue;
    collectFiles(path, files);
  }

  cachedCandidateSourceFiles = files.filter((path) => {
    const relativePath = relative(root, path);
    if (relativePath.startsWith("app/api/") || relativePath.startsWith("app/admin/")) return false;
    if (relativePath.startsWith("app/") && skippedAppSegments.has(relativePath.split("/")[1])) return false;
    if (relativePath === "lib/content/languages.ts") return false;
    return /\.(?:tsx?|md)$/.test(path) && !path.endsWith(".d.ts");
  });
  return cachedCandidateSourceFiles;
}

function fileBelongsToNamespace(relativePath: string, namespace: string) {
  if (namespace === siteTranslationNamespace) return true;
  if (namespace === marketingShellTranslationNamespace) {
    return [
      "components/marketing/MarketingShell.tsx",
      "components/marketing/LanguageControls.tsx",
      "components/marketing/SignInButton.tsx",
      "lib/seo/json-ld.ts",
    ].includes(relativePath);
  }
  if (namespace.startsWith("blog:")) {
    const slug = namespace.slice("blog:".length);
    return relativePath === `content/blog/${slug}.md`;
  }
  if (namespace.startsWith("legal:")) {
    const page = namespace.slice("legal:".length);
    if (relativePath === `app/${page}/page.tsx`) return true;
    if (relativePath.startsWith("components/legal/")) return true;
    return page === "privacy" && relativePath === "lib/content/extracted-pages.ts";
  }
  if (!namespace.startsWith("route:")) return false;

  const route = namespace.slice("route:".length);
  if (route === "home") {
    return (
      relativePath === "app/page.tsx" ||
      relativePath === "components/marketing/MarketingVideoEngine.tsx" ||
      relativePath === "lib/content/landing.ts" ||
      relativePath.startsWith("lib/content/") ||
      relativePath.startsWith("content/blog/")
    );
  }
  if (route === "chat-public") {
    return (
      relativePath === "app/chat/page.tsx" ||
      relativePath === "app/chat/[chatId]/page.tsx" ||
      relativePath.startsWith("content/blog/") ||
      contentFileBelongsToRoute(relativePath, route)
    );
  }
  if (route === "blog") {
    return (
      relativePath.startsWith("app/blog/") ||
      relativePath === "app/blog/page.tsx" ||
      /^lib\/content\/blog(?:-|\.ts)/.test(relativePath) ||
      relativePath.startsWith("content/blog/")
    );
  }
  if (relativePath === `app/${route}/page.tsx` || relativePath.startsWith(`app/${route}/[`)) return true;

  return contentFileBelongsToRoute(relativePath, route);
}

function contentFileBelongsToRoute(relativePath: string, route: string) {
  const contentByRoute: Record<string, string[]> = {
    about: ["lib/content/authority.ts"],
    "ai-learning-map": ["lib/content/learning-map.ts", "lib/content/topics.ts"],
    "chat-public": [
      "lib/content/topic-public-seo.ts",
      "lib/content/topic-routing.ts",
      "lib/content/topic-seo.ts",
      "lib/content/topics.ts",
      "lib/content/seeded-topics.ts",
    ],
    compare: ["lib/content/comparisons.ts"],
    for: ["lib/content/audiences.ts"],
    learn: ["lib/content/landing.ts", "lib/content/blog-link-graph.ts", "lib/content/topics.ts"],
    media: ["lib/content/authority.ts"],
    mission: ["lib/content/authority.ts"],
    prompts: ["lib/content/prompt-library.ts", "lib/content/topics.ts"],
    schools: ["lib/content/authority.ts"],
    subjects: ["lib/content/subjects.ts", "lib/content/topics.ts"],
    topics: [
      "lib/content/topic-directory.ts",
      "lib/content/topic-public-seo.ts",
      "lib/content/topic-routing.ts",
      "lib/content/topic-seo.ts",
      "lib/content/topics.ts",
      "lib/content/seeded-topics.ts",
    ],
    trust: ["lib/content/authority.ts"],
  };
  return contentByRoute[route]?.includes(relativePath) ?? false;
}

function getBlogSlugs() {
  const blogPath = join(process.cwd(), "content", "blog");
  if (!existsSync(blogPath)) return [];
  return readdirSync(blogPath)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.replace(/\.md$/, ""))
    .sort((a, b) => a.localeCompare(b));
}

function normalizePath(pathname: string) {
  const withoutQuery = pathname.split(/[?#]/)[0] || "/";
  const path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function collectFiles(path: string, files: string[]) {
  const stat = statSync(path);
  if (stat.isFile()) {
    files.push(path);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    collectFiles(join(path, entry), files);
  }
}

function extractTsxText(path: string, source: string) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const values: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isJsxElement(node)) {
      values.push(...extractJsxChildTemplates(node.children));
    } else if (ts.isJsxFragment(node)) {
      values.push(...extractJsxChildTemplates(node.children));
    }

    if (ts.isJsxText(node)) {
      values.push(normalizeVisibleText(node.getText()));
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (isVisibleStringLiteral(node)) values.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      if (isVisibleTextExpression(node)) values.push(templateExpressionText(node));
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return values;
}

function extractJsxChildTemplates(children: ts.NodeArray<ts.JsxChild>) {
  const values: string[] = [];
  const parts: string[] = [];
  let placeholderIndex = 1;
  let hasPlaceholder = false;
  let hasNestedElement = false;

  for (const child of children) {
    if (ts.isJsxText(child)) {
      parts.push(child.text);
    } else if (ts.isJsxExpression(child)) {
      if (!child.expression) continue;
      parts.push(`{value${placeholderIndex}}`);
      placeholderIndex += 1;
      hasPlaceholder = true;
    } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      hasNestedElement = true;
    }
  }

  if (!hasPlaceholder || hasNestedElement) return values;

  const value = normalizeVisibleText(parts.join(""));
  if (hasTemplateLiteralText(value)) values.push(value);
  return values;
}

function templateExpressionText(node: ts.TemplateExpression) {
  const parts: string[] = [node.head.text];
  let placeholderIndex = 1;

  for (const span of node.templateSpans) {
    parts.push(`{value${placeholderIndex}}`);
    parts.push(span.literal.text);
    placeholderIndex += 1;
  }

  return normalizeVisibleText(parts.join(""));
}

function hasTemplateLiteralText(value: string) {
  return /\{value\d+\}/.test(value) && /\p{L}/u.test(value.replace(/\{value\d+\}/g, " "));
}

function isVisibleStringLiteral(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return false;
  if (ts.isExternalModuleReference(parent)) return false;
  if (ts.isCallExpression(parent) && parent.expression.getText().includes("require")) return false;
  if (ts.isJsxAttribute(parent)) {
    const name = parent.name.getText();
    if (skippedJsxAttributes.has(name)) return false;
    return visibleJsxAttributes.has(name);
  }
  if (ts.isPropertyAssignment(parent)) {
    const name = parent.name.getText().replace(/^["']|["']$/g, "");
    if (["href", "src", "url", "path", "slug", "id", "icon", "className"].includes(name)) return false;
  }
  return true;
}

function isVisibleTextExpression(node: ts.Expression) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isTaggedTemplateExpression(parent)) return false;
  if (ts.isJsxExpression(parent)) {
    const jsxParent = parent.parent;
    if (ts.isJsxAttribute(jsxParent)) {
      const name = jsxParent.name.getText();
      if (skippedJsxAttributes.has(name)) return false;
      return visibleJsxAttributes.has(name);
    }
    return true;
  }
  if (ts.isPropertyAssignment(parent)) {
    const name = parent.name.getText().replace(/^["']|["']$/g, "");
    if (["href", "src", "url", "path", "slug", "id", "icon", "className"].includes(name)) return false;
  }
  if (ts.isCallExpression(parent) && parent.expression.getText().includes("require")) return false;
  return true;
}

function extractMarkdownText(source: string) {
  const values: string[] = [];
  let body = source;
  if (source.startsWith("---\n")) {
    const end = source.indexOf("\n---", 4);
    if (end !== -1) {
      const frontmatter = source.slice(4, end).trim();
      for (const line of frontmatter.split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;
        const key = line.slice(0, separator).trim();
        const rawValue = line.slice(separator + 1).trim();
        if (!translatableFrontmatterKeys.has(key)) continue;
        for (const value of frontmatterValues(rawValue)) values.push(stripMarkdownFormatting(value));
      }
      body = source.slice(end + 4).trim();
    }
  }
  let paragraph: string[] = [];
  let inCodeFence = false;

  function flushParagraph() {
    if (!paragraph.length) return;
    values.push(stripMarkdownFormatting(paragraph.join(" ")));
    paragraph = [];
  }

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      flushParagraph();
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      values.push(stripMarkdownFormatting(heading[2]));
      continue;
    }

    const listItem = /^[-*+]\s+(.+)$/.exec(trimmed) ?? /^\d+\.\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph();
      values.push(stripMarkdownFormatting(listItem[1]));
      continue;
    }

    if (/^\|/.test(trimmed)) {
      flushParagraph();
      for (const cell of trimmed.split("|")) values.push(stripMarkdownFormatting(cell));
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return values;
}

function frontmatterValues(rawValue: string) {
  const value = rawValue.trim().replace(/^["']|["']$/g, "");
  if (!value.startsWith("[") || !value.endsWith("]")) return [value];
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function stripMarkdownFormatting(value: string) {
  return normalizeVisibleText(
    value
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~>#]/g, "")
      .replace(/<[^>]+>/g, ""),
  );
}

function addSourceValue(values: Set<string>, value: string) {
  const normalized = normalizeVisibleText(value);
  if (!isTranslatableText(normalized)) return;
  values.add(normalized);
}

function normalizeVisibleText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isTranslatableText(value: string) {
  if (value.length < 2 || value.length > 5000) return false;
  if (!/\p{L}/u.test(value)) return false;
  if (value.startsWith("--")) return false;
  if (/^\([^)]+\)$/.test(value)) return false;
  if (/^\d+x\d+$/i.test(value)) return false;
  if (value.includes("%s")) return false;
  if (/^(?:public|private|no-cache|max-age|must-revalidate|immutable|s-maxage)[a-z0-9=, -]*$/i.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return false;
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value)) return false;
  if (/^(?:\/|#|mailto:|tel:)/i.test(value)) return false;
  if (/^[a-z]+\/[-+.a-z0-9]+(?:;\s*charset=[-a-z0-9]+)?$/i.test(value)) return false;
  if (!/\s/.test(value) && /^[.@/#]/.test(value)) return false;
  if (!/\s/.test(value) && /[_/]/.test(value)) return false;
  if (!/\s/.test(value) && /-/.test(value)) return false;
  if (!/\s/.test(value) && /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(value)) return false;
  if (!/\s/.test(value) && /^[a-z]+$/.test(value)) return false;
  if (!/\s/.test(value) && /[a-z]/i.test(value) && /\d/.test(value) && /^[a-z0-9]+$/i.test(value)) return false;
  if (!/\s/.test(value) && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value)) return false;
  if (/\{value\d+\}/.test(value) && !/\s/.test(value)) return false;
  if (/^[a-z]{2,3}$/.test(value)) return false;
  if (/bot$/i.test(value)) return false;
  if (/^[A-Z][A-Za-z]+Page$/.test(value)) return false;
  if (/^(?:Article|BreadcrumbList|CreativeWork|FAQPage|HowTo|ItemList|LearningResource|Organization|SoftwareApplication|WebApplication|WebPage|WebSite)$/.test(value)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return false;
  if (/^[A-Z0-9_]+$/.test(value)) return false;
  if (/^\{[^}]+\}$/.test(value)) return false;
  if (/^[Mm][0-9,.\sCcSsLlHhVvZz-]+$/.test(value)) return false;
  return true;
}

function hashText(value: string) {
  return createHash("sha1").update(value).digest("hex");
}
