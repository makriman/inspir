import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { LOCAL_GATE_IDS } from "../scripts/cloudflare/migration-config";

test("Cloudflare package scripts avoid nested pnpm invocations", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const cloudflareScripts = Object.entries(packageJson.scripts ?? {}).filter(([name]) => name.startsWith("cf:"));
  const nestedPnpmScripts = cloudflareScripts.filter(([, command]) => /(?:^|[;&|]\s*)pnpm\s/.test(command));

  assert.deepEqual(
    nestedPnpmScripts.map(([name]) => name),
    [],
    "Cloudflare package scripts should call tsx/wrangler/tsc directly so non-interactive cutover runs do not trigger nested pnpm dependency checks.",
  );
});

test("preview Playwright resets only declared local runtime counters", () => {
  const previewRunner = fs.readFileSync(path.resolve("scripts/cloudflare/run-preview-playwright.ts"), "utf8");
  const localD1Setup = fs.readFileSync(path.resolve("scripts/cloudflare/setup-local-d1.ts"), "utf8");

  assert.match(previewRunner, /setup-local-d1\.ts", "--reset-runtime-state"/);
  assert.match(localD1Setup, /RUNTIME_MUTABLE_TABLES/);
  assert.match(localD1Setup, /delete from "\$\{table\}";/);
  assert.doesNotMatch(localD1Setup, /delete from "users"/);
  assert.doesNotMatch(localD1Setup, /drop table/i);
});

test("Cloudflare scripts avoid machine-local absolute tool paths", () => {
  const scriptsDir = path.resolve("scripts/cloudflare");
  const scriptFiles = fs
    .readdirSync(scriptsDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => path.join(scriptsDir, file));

  for (const filePath of scriptFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(process.cwd(), filePath);
    assert.doesNotMatch(source, /\/Users\//, `${relativePath} should not embed a user home path`);
    assert.doesNotMatch(source, /codex-runtimes/, `${relativePath} should not embed Codex runtime paths`);
  }
});

test("GitHub CI runs the core quality and build gates", () => {
  const workflow = fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8");

  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm typecheck/);
  assert.match(workflow, /pnpm lint/);
  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /pnpm build/);
  assert.match(workflow, /pnpm cf:build/);
  assert.match(workflow, /node-version: 22/);
  assert.doesNotMatch(workflow, /NEXTAUTH_/);
});

test("reset password page is honest about Google-only auth", () => {
  const source = fs.readFileSync(path.resolve("app/(marketing)/reset_pw/page.tsx"), "utf8");

  assert.doesNotMatch(source, /type="password"/);
  assert.doesNotMatch(source, /<form/);
  assert.match(source, /no inspir password to reset/i);
  assert.match(source, /GoogleContinueButton/);
  assert.match(source, /callbackUrl="\/chat"/);
});

test("marketing metadata has one localized alternates source of truth", () => {
  const marketingDir = path.resolve("app/(marketing)");
  const pageFiles = fs
    .readdirSync(marketingDir, { recursive: true })
    .filter((file): file is string => typeof file === "string" && /page\.tsx$/.test(file))
    .map((file) => path.join(marketingDir, file));

  for (const filePath of pageFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /alternates:\s*metadataAlternates\(/, path.relative(process.cwd(), filePath));
  }

  const marketingLayout = fs.readFileSync(path.resolve("app/(marketing)/layout.tsx"), "utf8");
  const marketingMetadata = fs.readFileSync(path.resolve("lib/i18n/metadata.ts"), "utf8");
  assert.doesNotMatch(marketingLayout, /"ai-content-index"/);
  assert.doesNotMatch(marketingMetadata, /ai-content-index\.json/);
});

test("marketing performance path avoids runtime translation fan-out and DOM walking", () => {
  const metadata = fs.readFileSync(path.resolve("lib/i18n/metadata.ts"), "utf8");
  const sitemap = fs.readFileSync(path.resolve("lib/seo/sitemap.ts"), "utf8");
  const shell = fs.readFileSync(path.resolve("components/marketing/MarketingShell.tsx"), "utf8");
  const layout = fs.readFileSync(path.resolve("app/(marketing)/layout.tsx"), "utf8");
  const jsonLd = fs.readFileSync(path.resolve("components/seo/JsonLdScripts.tsx"), "utf8");
  const requestLocale = fs.readFileSync(path.resolve("lib/i18n/request-locale.ts"), "utf8");
  const manifestGenerator = fs.readFileSync(path.resolve("scripts/generate-site-source-manifest.ts"), "utf8");

  assert.match(metadata, /isStaticSiteLanguageAvailableForPath/);
  assert.match(metadata, /staticSiteLanguagesForPath/);
  assert.doesNotMatch(metadata, /availableSiteLanguagesForPath/);
  assert.match(sitemap, /staticSiteLanguagesForPath/);
  assert.doesNotMatch(shell, /MarketingDomLocalizer/);
  assert.match(shell, /isStaticSiteLanguageAvailableForPath/);
  assert.match(shell, /hrefLanguage/);
  assert.doesNotMatch(layout, /MarketingServerLocalizer/);
  assert.match(manifestGenerator, /isRenderLocalizedSiteTranslationNamespace/);
  assert.doesNotMatch(layout, /headers\(\)/);
  assert.doesNotMatch(jsonLd, /headers\(\)/);
  assert.equal(requestLocale.match(/await headers\(\)/g)?.length, 1);
  assert.match(requestLocale, /getRequestLocaleHeaderSnapshot/);
});

test("marketing cacheability config is deterministic for cookieless GET pages", () => {
  const middleware = fs.readFileSync(path.resolve("middleware.ts"), "utf8");
  const csp = fs.readFileSync(path.resolve("lib/security/headers.ts"), "utf8");
  const cacheRule = fs.readFileSync(path.resolve("scripts/cloudflare/upsert-marketing-cache-rule.ts"), "utf8");
  const edgeCacheVerifier = fs.readFileSync(path.resolve("scripts/cloudflare/verify-marketing-edge-cache.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const wrangler = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    placement?: { mode?: string };
    limits?: { cpu_ms?: number };
  };

  assert.match(middleware, /buildCacheableMarketingContentSecurityPolicy/);
  assert.match(middleware, /isMarketingPageRequest/);
  assert.match(middleware, /isPubliclyCacheableMarketingRequest/);
  assert.match(middleware, /pathname === "\/reset_pw"/);
  assert.match(middleware, /Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400"/);
  assert.match(middleware, /Vary", "Accept-Encoding"/);
  assert.match(middleware, /localizedPath\.hasLocalePrefix && !cacheableMarketingRequest/);
  assert.match(csp, /buildCacheableMarketingContentSecurityPolicy/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/accounts\.google\.com/);
  assert.match(cacheRule, /http_request_cache_settings/);
  assert.match(cacheRule, /set_cache_settings/);
  assert.match(cacheRule, /inspir_marketing_html_edge_cache_v1/);
  assert.match(cacheRule, /not http\.cookie contains "="/);
  assert.match(cacheRule, /edge_ttl:\s*\{ mode: "respect_origin" \}/);
  assert.match(cacheRule, /exclude:\s*\["\*"\]/);
  assert.match(edgeCacheVerifier, /cf-cache-status/);
  assert.match(edgeCacheVerifier, /better-auth\.session_token=edge-cache-probe/);
  assert.equal(packageJson.scripts?.["cf:cache:upsert-marketing-html"], "tsx scripts/cloudflare/upsert-marketing-cache-rule.ts");
  assert.equal(packageJson.scripts?.["cf:verify:edge-cache"], "tsx scripts/cloudflare/verify-marketing-edge-cache.ts");
  assert.equal(packageJson.scripts?.["seo:lastmod:generate"], "tsx scripts/seo/generate-sitemap-lastmod.ts");
  assert.equal(packageJson.scripts?.["seo:lastmod:check"], "tsx scripts/seo/generate-sitemap-lastmod.ts --check");
  assert.equal(wrangler.placement?.mode, "smart");
  assert.equal(wrangler.limits, undefined);
});

test("sitemap lastmod data is generated from git content sources", () => {
  const sitemap = fs.readFileSync(path.resolve("lib/seo/sitemap.ts"), "utf8");
  const lastmod = fs.readFileSync(path.resolve("lib/seo/content-lastmod.generated.ts"), "utf8");
  const generator = fs.readFileSync(path.resolve("scripts/seo/generate-sitemap-lastmod.ts"), "utf8");

  assert.match(sitemap, /sitemapContentLastModified/);
  assert.doesNotMatch(sitemap, /const contentLastModified = \{/);
  assert.doesNotMatch(sitemap, /lastModified:\s*new Date\(/);
  assert.match(lastmod, /Generated by pnpm seo:lastmod:generate/);
  assert.match(generator, /"git", \["log", "-1", "--format=%cs"/);
});

test("social preview metadata points at the static PNG fallback", () => {
  const source = fs.readFileSync(path.resolve("app/og/route.ts"), "utf8");
  const socialConfig = fs.readFileSync(path.resolve("lib/seo/config.ts"), "utf8");

  assert.match(source, /inspir-social-preview\.png/);
  assert.match(socialConfig, /url:\s*`\$\{siteUrl\}\/inspir-social-preview\.png`/);
  assert.doesNotMatch(source, /ImageResponse/);
  assert.doesNotMatch(source, /runtime\s*=\s*"edge"/);
});

test("IndexNow key is root-served and submit script targets Bing", () => {
  const indexNow = fs.readFileSync(path.resolve("lib/seo/indexnow.ts"), "utf8");
  const keyMatch = indexNow.match(/indexNowKey = "([a-f0-9]{32})"/);
  assert.ok(keyMatch);

  const keyFile = path.resolve(`public/${keyMatch[1]}.txt`);
  assert.equal(fs.readFileSync(keyFile, "utf8").trim(), keyMatch[1]);

  const submitScript = fs.readFileSync(path.resolve("scripts/seo/submit-indexnow.ts"), "utf8");
  assert.match(submitScript, /https:\/\/www\.bing\.com\/indexnow/);
});

test("chat auto-translation skips streaming markdown mutations", () => {
  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  const richMarkdown = fs.readFileSync(path.resolve("components/chat/RichMarkdownContent.tsx"), "utf8");

  assert.match(chatClient, /new MutationObserver\(\(mutations\) =>/);
  assert.match(chatClient, /mutations\.every\(\(mutation\) => shouldSkipTranslation\(mutation\.target\)\)/);
  assert.match(richMarkdown, /data-no-auto-translate="true"/);
});

test("profile layout merges identity into details and uses full-width sections", () => {
  const profilePanel = fs.readFileSync(path.resolve("components/chat/ProfilePanel.tsx"), "utf8");
  const globals = fs.readFileSync(path.resolve("app/globals.css"), "utf8");

  assert.match(profilePanel, /inspir-profile-section inspir-profile-identity-section/);
  assert.match(profilePanel, /<div className="inspir-profile-identity-grid">/);
  assert.match(profilePanel, /inspir-profile-avatar inspir-profile-avatar-button/);
  assert.doesNotMatch(profilePanel, /inspir-profile-photo-button/);
  assert.ok(
    profilePanel.indexOf('className="inspir-profile-hero"') >
      profilePanel.indexOf('className="inspir-profile-section inspir-profile-identity-section"'),
    "profile hero should live inside the details section instead of occupying its own column",
  );
  assert.match(
    globals,
    /\.inspir-profile-workspace \.inspir-profile-body\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.doesNotMatch(
    globals,
    /\.inspir-profile-workspace \.inspir-profile-body\s*{[\s\S]*?grid-template-columns: minmax\(260px, 340px\) minmax\(0, 1fr\)/,
  );
  assert.match(globals, /\.inspir-profile-identity-grid\s*{[\s\S]*?grid-template-columns:/);
});

test("profile avatars fall back instead of rendering broken images", () => {
  const avatar = fs.readFileSync(path.resolve("components/chat/ProfileAvatarImage.tsx"), "utf8");
  const profilePanel = fs.readFileSync(path.resolve("components/chat/ProfilePanel.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.resolve("components/chat/TopicSidebar.tsx"), "utf8");
  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");

  assert.match(avatar, /fallbackSrc/);
  assert.match(avatar, /onError=\{\(\) =>\s*setFailureState/);
  assert.match(avatar, /<UserRound size=\{iconSize\}/);
  assert.match(profilePanel, /fallbackSrc=\{user\.image\}/);
  assert.match(sidebar, /avatarFallbackSrc/);
  assert.match(chatClient, /const avatarFallbackSrc = profileUser\.image \|\| undefined/);
});

test("signed-in public chat routes stay authenticated when topic lookup falls back to seeds", () => {
  const page = fs.readFileSync(path.resolve("app/(workspace)/chat/[chatId]/page.tsx"), "utf8");
  const chatsRoute = fs.readFileSync(path.resolve("app/api/chats/route.ts"), "utf8");
  const queries = fs.readFileSync(path.resolve("lib/db/queries.ts"), "utf8");

  assert.match(page, /const savedChatsAvailable = Boolean\(session\?\.user\?\.id\)/);
  assert.match(page, /withPublicTopicTimeout\(getPublicActiveTopics\(\)\)\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(page, /savedChatsAvailable = false/);
  assert.match(chatsRoute, /topicId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(120\)/);
  assert.match(queries, /export async function getTopicByIdOrSlug/);
  assert.match(queries, /const topic = await getTopicByIdOrSlug\(topicId\)/);
});

test("Better Auth can safely link migrated Google-only users", () => {
  const source = fs.readFileSync(path.resolve("lib/auth/better-auth.ts"), "utf8");

  assert.match(source, /trustedProviders:\s*\["google"\]/);
  assert.match(source, /requireLocalEmailVerified:\s*false/);
  assert.match(source, /Revisit before adding any non-Google provider/);
  assert.match(source, /additionalFields:\s*{[\s\S]*?type:\s*{[\s\S]*?defaultValue:\s*"oauth"/);
});

test("admin dashboard is DB-backed and reachable from admin profiles", () => {
  const adminAuth = fs.readFileSync(path.resolve("lib/auth/admin.ts"), "utf8");
  const profilePanel = fs.readFileSync(path.resolve("components/chat/ProfilePanel.tsx"), "utf8");
  const adminPage = fs.readFileSync(path.resolve("app/(workspace)/admin/page.tsx"), "utf8");
  const schema = fs.readFileSync(path.resolve("lib/db/schema.ts"), "utf8");

  assert.match(adminAuth, /makridroid@gmail\.com/);
  assert.match(adminAuth, /isAdminEmailAsync/);
  assert.match(schema, /sqliteTable\(\s*"admin_users"/);
  assert.match(profilePanel, /user\.isAdmin/);
  assert.match(profilePanel, /t\("Admin dashboard"\)/);
  assert.match(adminPage, /getAdminDashboardData\(14\)/);
  assert.match(adminPage, /AdminUserManager/);
  assert.match(adminPage, /Response cache/);
  assert.match(adminPage, /Cache savings/);
  assert.match(adminPage, /Cached topics/);
});

test("analytics scripts and product events are installed without inline CSP fallback", () => {
  const analyticsScripts = fs.readFileSync(path.resolve("components/analytics/AnalyticsScripts.tsx"), "utf8");
  const productAnalytics = fs.readFileSync(path.resolve("components/analytics/ProductAnalytics.tsx"), "utf8");
  const trackProductEvent = fs.readFileSync(path.resolve("components/analytics/trackProductEvent.ts"), "utf8");
  const middleware = fs.readFileSync(path.resolve("middleware.ts"), "utf8");
  const csp = fs.readFileSync(path.resolve("lib/security/headers.ts"), "utf8");
  const scriptDirective = csp.split("\n").find((line) => line.includes("script-src")) ?? "";

  assert.match(analyticsScripts, /G-S3E1FV3RK8/);
  assert.match(analyticsScripts, /xi5vqkce95/);
  assert.match(productAnalytics, /auth_error_seen/);
  assert.match(productAnalytics, /trackProductEvent/);
  assert.match(trackProductEvent, /\/api\/analytics\/events/);
  assert.match(middleware, /buildContentSecurityPolicy\(nonce\)/);
  assert.match(csp, /'nonce-\$\{nonce\}'/);
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/);
});

test("Better Auth schema keeps rollback columns documented during soak", () => {
  const schema = fs.readFileSync(path.resolve("lib/db/schema.ts"), "utf8");

  assert.match(schema, /Legacy NextAuth rollback data[\s\S]*expires_at/);
  assert.match(schema, /Legacy NextAuth rollback data[\s\S]*token_type/);
  assert.match(schema, /Legacy NextAuth rollback data[\s\S]*session_state/);
  assert.match(schema, /avoided a risky D1 table rebuild[\s\S]*id: uuidText\("id"\)/);
});

test("deploy quality gates avoid floating CLI resolution", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const qualityScripts = Object.entries(packageJson.scripts ?? {}).filter(
    ([name]) => name.startsWith("cf:") || name.startsWith("doctor"),
  );
  for (const [name, command] of qualityScripts) {
    assert.doesNotMatch(command, /\bnpx\b/, `${name} should use pinned local dependencies instead of npx`);
    assert.doesNotMatch(command, /@latest\b/, `${name} should not resolve tools from a floating latest tag`);
  }
});

test("every required local Cloudflare gate has a runner", () => {
  const source = fs.readFileSync(path.resolve("scripts/cloudflare/run-local-gates.ts"), "utf8");

  for (const gateId of LOCAL_GATE_IDS) {
    assert.match(source, new RegExp(`id: "${escapeRegExp(gateId)}"`), `${gateId} should have a local gate runner`);
  }
  assert.match(source, /run-react-doctor-gate\.ts/);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
