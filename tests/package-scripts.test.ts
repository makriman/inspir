import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FREE_PLAN_WORKER_FIRST_ROUTES } from "../scripts/cloudflare/deploy-preflight";
import { LOCAL_GATE_IDS } from "../scripts/cloudflare/migration-config";
import { assertSafeStaticMainAppOutputRoot } from "../scripts/static-main-app-output-safety";

test("static main-app translation generator fails closed on unsafe CLI arguments", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-translation-cli-"));
  const generator = path.resolve("scripts/generate-static-main-app-translations.ts");
  const tsx = path.resolve("node_modules/.bin/tsx");
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const runGenerator = (args: string[]) =>
    spawnSync(tsx, [generator, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  const output = (result: ReturnType<typeof runGenerator>) => `${result.stdout}\n${result.stderr}`;

  const unknownFlag = runGenerator([
    "--output-dir",
    path.join(temporaryRoot, "ignored-output"),
    "--source-dir",
    path.join(temporaryRoot, "missing-source"),
  ]);
  assert.notEqual(unknownFlag.status, 0);
  assert.match(output(unknownFlag), /Unknown static main-app translation argument: --output-dir/);

  const missingValue = runGenerator(["--out-dir", "--check"]);
  assert.notEqual(missingValue.status, 0);
  assert.match(output(missingValue), /--out-dir requires a non-empty path/);

  const emptyInlineValue = runGenerator(["--source-dir="]);
  assert.notEqual(emptyInlineValue.status, 0);
  assert.match(output(emptyInlineValue), /--source-dir requires a non-empty path/);

  const conflictingModes = runGenerator([
    "--out-dir",
    path.join(temporaryRoot, "conflicting-output"),
    "--check",
    "--clean",
  ]);
  assert.notEqual(conflictingModes.status, 0);
  assert.match(output(conflictingModes), /--check and --clean cannot be used together/);
  assert.deepEqual(fs.readdirSync(temporaryRoot), [], "invalid arguments must not mutate output files");
});

test("static main-app translation output cannot delete source or workspace paths", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-translation-output-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const sourceRoot = path.join(workspaceRoot, "translations/curated");
  const trackedOutputRoot = path.join(workspaceRoot, "translations/static-main-app");
  const externalOutputRoot = path.join(temporaryRoot, "generated-output");
  const workspaceLink = path.join(temporaryRoot, "workspace-link");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(trackedOutputRoot, { recursive: true });
  fs.symlinkSync(workspaceRoot, workspaceLink, "dir");
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const assertSafe = (outputRoot: string) =>
    assertSafeStaticMainAppOutputRoot({ workspaceRoot, sourceRoot, outputRoot });

  assert.doesNotThrow(() => assertSafe(trackedOutputRoot));
  assert.doesNotThrow(() => assertSafe(externalOutputRoot));
  assert.throws(() => assertSafe(workspaceRoot), /workspace root or one of its ancestors/);
  assert.throws(() => assertSafe(path.dirname(workspaceRoot)), /workspace root or one of its ancestors/);
  assert.throws(() => assertSafe(sourceRoot), /must not overlap the curated source/);
  assert.throws(() => assertSafe(path.dirname(sourceRoot)), /must not overlap the curated source/);
  assert.throws(() => assertSafe(path.join(sourceRoot, "nested")), /must not overlap the curated source/);
  assert.throws(
    () => assertSafe(path.join(workspaceRoot, "node_modules")),
    /inside the workspace must be translations\/static-main-app/,
  );
  assert.throws(
    () => assertSafe(path.join(workspaceLink, "node_modules")),
    /inside the workspace must be translations\/static-main-app/,
  );
  assert.throws(
    () =>
      assertSafeStaticMainAppOutputRoot({
        workspaceRoot: process.cwd(),
        sourceRoot: path.resolve("translations/curated"),
        outputRoot: os.tmpdir(),
      }),
    /workspace root or one of its ancestors|isolated OS-temporary subdirectory/,
  );
});

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

test("native Wrangler preview preserves sanitized build and local D1 gates", () => {
  const previewRunner = fs.readFileSync(path.resolve("scripts/cloudflare/run-preview-playwright.ts"), "utf8");
  const localD1Setup = fs.readFileSync(path.resolve("scripts/cloudflare/setup-local-d1.ts"), "utf8");
  const sanitizedBuild = fs.readFileSync(path.resolve("scripts/cloudflare/run-sanitized-build.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const nativePreviewCommand = sanitizedBuild.match(
    /"wrangler-preview": \{([\s\S]*?)\n  \},/,
  )?.[1];

  assert.ok(nativePreviewCommand, "native Wrangler preview command should remain statically inspectable");
  assert.equal(
    packageJson.scripts?.["cf:preview"],
    "tsx scripts/cloudflare/setup-local-d1.ts && tsx scripts/cloudflare/run-sanitized-build.ts wrangler-preview",
  );
  assert.equal(
    packageJson.scripts?.["cf:preview:remote"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:preview:remote",
  );
  assert.match(previewRunner, /setup-local-d1\.ts", "--reset-runtime-state"/);
  assert.match(previewRunner, /run-sanitized-build\.ts", "wrangler-preview"/);
  assert.match(previewRunner, /clearLocalPreviewCacheApiState\(\)/);
  assert.match(localD1Setup, /RUNTIME_MUTABLE_TABLES/);
  assert.match(localD1Setup, /delete from "\$\{table\}";/);
  assert.doesNotMatch(localD1Setup, /delete from "users"/);
  assert.doesNotMatch(localD1Setup, /drop table/i);
  assert.match(nativePreviewCommand, /executable: bin\("wrangler"\)/);
  assert.match(nativePreviewCommand, /args: \["dev", "--show-interactive-dev-session=false"\]/);
  assert.match(nativePreviewCommand, /buildBefore: true/);
  assert.match(nativePreviewCommand, /scanBefore: true/);
  assert.match(sanitizedBuild, /mode === "wrangler-preview"/);
  assert.match(sanitizedBuild, /writeLocalPreviewRuntimeVars\(localPreviewProviderSecrets\)/);
  assert.match(sanitizedBuild, /localPreviewRuntimeDotEnvContent\(process\.cwd\(\), providerSecrets\)/);
  assert.match(sanitizedBuild, /writeLocalPreviewWranglerConfig\(\)/);
  assert.match(sanitizedBuild, /\["--config", localPreviewConfig, \.\.\.passthroughArgs\]/);
  assert.match(sanitizedBuild, /delete config\.routes/);
  assert.doesNotMatch(sanitizedBuild, /opennext-preview/);
  assert.doesNotMatch(sanitizedBuild, /NEXT_INC_CACHE_R2_BUCKET/);
  assert.doesNotMatch(previewRunner, /opennext-preview/);
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
  assert.match(source, /export const dynamic = "force-static"/);
  assert.match(source, /export const revalidate = false/);
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
  const marketingChrome = fs.readFileSync(path.resolve("lib/i18n/marketing-chrome.ts"), "utf8");
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
  assert.match(marketingChrome, /isStaticSiteLanguageAvailableForPath/);
  assert.match(marketingChrome, /getRequestMarketingChrome/);
  assert.match(shell, /hrefLanguage/);
  assert.doesNotMatch(layout, /MarketingServerLocalizer/);
  assert.match(manifestGenerator, /isRenderLocalizedSiteTranslationNamespace/);
  assert.match(fs.readFileSync(path.resolve("lib/i18n/site-source.ts"), "utf8"), /"api", "admin"/);
  assert.doesNotMatch(layout, /headers\(\)/);
  assert.doesNotMatch(jsonLd, /headers\(\)/);
  assert.equal(requestLocale.match(/await headers\(\)/g)?.length, 1);
  assert.match(requestLocale, /getRequestLocaleHeaderSnapshot/);
});

test("large translation dictionaries are not exposed through dynamic public API routes", () => {
  assert.equal(fs.existsSync(path.resolve("app/api/site-translations/route.ts")), false);
  assert.equal(fs.existsSync(path.resolve("app/api/main-app-translations/route.ts")), false);

  const nextConfig = fs.readFileSync(path.resolve("next.config.ts"), "utf8");
  assert.doesNotMatch(nextConfig, /\/api\/site-translations/);
  assert.doesNotMatch(nextConfig, /\/api\/main-app-translations/);
});

test("tracked curated packs cannot be shadowed by ignored authoring bundles", () => {
  const loader = fs.readFileSync(path.resolve("lib/i18n/curated-translations.ts"), "utf8");

  assert.match(loader, /const curatedRoot = "translations\/curated"/);
  assert.doesNotMatch(loader, /translations\/curated-bundles|curatedBundledPack|languagePackCache/);
});

test("runtime translation reads cannot accumulate request-bound promises in isolate globals", () => {
  const sourceReader = fs.readFileSync(path.resolve("lib/i18n/runtime-site-source.ts"), "utf8");
  const bundleReader = fs.readFileSync(path.resolve("lib/i18n/db-translations.ts"), "utf8");
  const manifestGenerator = fs.readFileSync(path.resolve("scripts/generate-site-source-manifest.ts"), "utf8");

  assert.match(sourceReader, /knownSiteTranslationNamespaces/);
  assert.match(sourceReader, /knownRuntimeNamespaceSet\.has\(namespace\)/);
  assert.doesNotMatch(sourceReader, /runtimeSourceCache/);
  assert.doesNotMatch(bundleReader, /dbBundleCache/);
  assert.doesNotMatch(bundleReader, /Promise<TranslationBundle \| null>/);
  assert.match(manifestGenerator, /site-namespace-manifest\.ts/);
});

test("public delivery is Static Assets with exact native account Worker routes", () => {
  const middleware = fs.readFileSync(path.resolve("middleware.ts"), "utf8");
  const nextConfig = fs.readFileSync(path.resolve("next.config.ts"), "utf8");
  const globalNotFound = fs.readFileSync(path.resolve("app/global-not-found.tsx"), "utf8");
  const csp = fs.readFileSync(path.resolve("lib/security/headers.ts"), "utf8");
  const staticHeaders = fs.readFileSync(path.resolve("public/_headers"), "utf8");
  const staticRedirects = fs.readFileSync(path.resolve("public/_redirects"), "utf8");
  const materializer = fs.readFileSync(path.resolve("scripts/cloudflare/materialize-static-marketing-assets.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const wrangler = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    main?: string;
    placement?: { mode?: string };
    limits?: { cpu_ms?: number };
    assets?: {
      directory?: string;
      html_handling?: string;
      not_found_handling?: string;
      run_worker_first?: string[];
    };
    cache?: { enabled?: boolean };
    d1_databases?: Array<{ binding?: string; database_name?: string }>;
    vectorize?: unknown[];
    r2_buckets?: unknown[];
    queues?: { producers?: unknown[]; consumers?: unknown[] };
    triggers?: { crons?: string[] };
    services?: Array<{ binding?: string; service?: string }>;
    version_metadata?: { binding?: string };
    durable_objects?: { bindings?: Array<{ name?: string; class_name?: string }> };
    migrations?: Array<{ new_sqlite_classes?: string[] }>;
    secrets?: { required?: string[] };
    vars?: Record<string, string>;
  };

  assert.match(middleware, /buildCacheableMarketingContentSecurityPolicy/);
  assert.match(middleware, /canonicalOriginRedirectUrl\(request\.nextUrl, request\.headers\)/);
  assert.match(middleware, /isMarketingPageRequest/);
  assert.match(middleware, /isPubliclyCacheableMarketingRequest/);
  assert.match(middleware, /"\/blog"/);
  assert.match(middleware, /pathname === "\/reset_pw"/);
  assert.match(middleware, /public, s-maxage=3600, stale-while-revalidate=86400/);
  assert.match(middleware, /public, max-age=0, s-maxage=31536000, must-revalidate/);
  assert.match(middleware, /Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate"/);
  assert.match(middleware, /Vary", "Accept-Encoding, Cookie"/);
  assert.match(middleware, /localizedPath\.hasLocalePrefix && !cacheableMarketingRequest/);
  assert.match(middleware, /isStaticSiteLanguageAvailableForPath\(effectivePathname, language\)/);
  assert.match(csp, /buildCacheableMarketingContentSecurityPolicy/);
  assert.match(staticHeaders, /X-Inspir-Delivery: static-assets/);
  assert.match(staticHeaders, /^\/api\/topics$/m);
  assert.match(staticHeaders, /^\/chat$/m);
  assert.match(staticHeaders, /^\/:locale\/chat$/m);
  assert.doesNotMatch(staticHeaders, /^\/chat\*$/m);
  assert.doesNotMatch(staticHeaders, /^\/\*\/chat\*$/m);
  assert.match(staticHeaders, /accounts\.google\.com/);
  assert.match(staticHeaders, /script-src[^\n]*https:\/\/\*\.clarity\.ms/);
  assert.doesNotMatch(staticHeaders, /api\.openai\.com/);
  assert.match(staticRedirects, /^\/tnc\s+\/terms\s+308$/m);
  assert.doesNotMatch(staticRedirects, /^\s*\/(?:[^\s]*\/)?chat\/\*/m);
  assert.match(materializer, /minimumLocalizedHomeDocuments/);
  assert.match(materializer, /staticChatCacheKeys/);
  assert.match(materializer, /Exact public topic redirects/);
  assert.match(materializer, /\/chat\?topic=\$\{topic\.slug\} 308/);
  assert.match(materializer, /staticChatDynamicRedirects/);
  assert.match(materializer, /api\/topics/);
  assert.match(materializer, /Required static document was not materialized/);
  assert.match(materializer, /Static HTML must not depend on the billable Next image optimizer/);
  assert.match(nextConfig, /unoptimized:\s*true/);
  assert.match(globalNotFound, /from "next\/link"/);
  assert.match(globalNotFound, /<Link href="\/chat\/learn-anything" prefetch=\{false\}>/);
  assert.match(globalNotFound, /<Link href="\/" prefetch=\{false\}>/);
  assert.equal(fs.existsSync(path.resolve("scripts/cloudflare/upsert-marketing-cache-rule.ts")), false);
  assert.equal(fs.existsSync(path.resolve("scripts/cloudflare/purge-deploy-html-cache.ts")), false);
  assert.equal(fs.existsSync(path.resolve("scripts/cloudflare/verify-marketing-edge-cache.ts")), false);
  assert.equal(packageJson.scripts?.["cf:cache:upsert-marketing-html"], undefined);
  assert.equal(packageJson.scripts?.["cf:cache:purge-deploy-html"], undefined);
  assert.equal(packageJson.scripts?.["cf:verify:edge-cache"], undefined);
  assert.equal(
    packageJson.scripts?.["cf:verify:authenticated-production"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:verify:authenticated-production",
  );
  assert.equal(
    packageJson.scripts?.["cf:verify:vectorize-readiness"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:verify:vectorize-readiness",
  );
  assert.equal(
    packageJson.scripts?.["cf:upload-candidate"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:upload-candidate",
  );
  assert.equal(
    packageJson.scripts?.["cf:activate-candidate"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:activate-candidate",
  );
  assert.equal(
    packageJson.scripts?.["cf:stage-candidate"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:stage-candidate",
  );
  assert.equal(
    packageJson.scripts?.["cf:upload"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:upload",
  );
  assert.equal(
    packageJson.scripts?.["cf:deploy"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:deploy",
  );
  assert.equal(
    packageJson.scripts?.["cf:apply:d1-runtime-migrations"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:apply:d1-runtime-migrations",
  );
  assert.equal(
    packageJson.scripts?.["cf:check:d1-migration-0017-budget"],
    undefined,
  );
  assert.equal(
    packageJson.scripts?.["cf:apply:d1-runtime-migration-0017"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:apply:d1-runtime-migration-0017",
  );
  assert.equal(
    packageJson.scripts?.["cf:verify:d1-runtime-migration-0017"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:verify:d1-runtime-migration-0017",
  );
  assert.equal(
    packageJson.scripts?.["cf:rollback"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:rollback",
  );
  assert.equal(
    packageJson.scripts?.["cf:resolve:production-maintenance"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:resolve:production-maintenance",
  );
  assert.equal(packageJson.scripts?.["cf:activate:write-freeze"], undefined);
  assert.equal(packageJson.scripts?.["cf:backup:frozen-cloudflare"], undefined);
  assert.equal(
    packageJson.scripts?.["cf:verify:historical-data-preservation"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:verify:historical-data-preservation",
  );
  assert.equal(packageJson.scripts?.["seo:lastmod:generate"], "tsx scripts/seo/generate-sitemap-lastmod.ts");
  assert.equal(packageJson.scripts?.["seo:lastmod:check"], "tsx scripts/seo/generate-sitemap-lastmod.ts --check");
  assert.equal(wrangler.main, "./cloudflare-worker.ts");
  assert.equal(wrangler.placement, undefined);
  assert.equal(wrangler.cache, undefined);
  assert.equal(wrangler.limits, undefined);
  assert.equal(wrangler.assets?.directory, ".open-next/assets");
  assert.equal(wrangler.assets?.html_handling, "drop-trailing-slash");
  assert.equal(wrangler.assets?.not_found_handling, "404-page");
  assert.deepEqual(wrangler.assets?.run_worker_first, [...FREE_PLAN_WORKER_FIRST_ROUTES]);
  const workerFirstRoutes = new Set<string>(wrangler.assets?.run_worker_first ?? []);
  assert.ok(workerFirstRoutes.has("/api/auth/*"));
  assert.ok(workerFirstRoutes.has("/api/chats/*"));
  assert.ok(workerFirstRoutes.has("/api/migration/e2e-auth"));
  assert.ok(workerFirstRoutes.has("/api/memory/*"));
  assert.ok(workerFirstRoutes.has("/chat/*"));
  assert.ok(workerFirstRoutes.has("!/_next/static/*"));
  assert.deepEqual(
    [...workerFirstRoutes].filter((route) => route.startsWith("!")),
    ["!/_next/static/*"],
  );
  assert.equal(workerFirstRoutes.has("/api/*"), false);
  assert.equal(workerFirstRoutes.has("/*"), false);
  assert.ok(
    wrangler.d1_databases?.some(
      (binding) => binding.binding === "DB" && binding.database_name === "inspirlearning-prod",
    ),
  );
  assert.deepEqual(wrangler.vectorize, [
    { binding: "MEMORY_VECTORIZE", index_name: "inspirlearning-memory-prod" },
  ]);
  assert.deepEqual(wrangler.r2_buckets, [
    { binding: "PROFILE_IMAGES_R2_BUCKET", bucket_name: "inspirlearning-profile-images-prod" },
  ]);
  assert.equal(wrangler.queues?.producers?.length, 1);
  assert.equal(wrangler.queues?.consumers?.length, 1);
  assert.deepEqual(wrangler.triggers?.crons, ["0 3 * * *"]);
  assert.ok(
    wrangler.services?.some(
      (binding) => binding.binding === "WORKER_SELF_REFERENCE" && binding.service === "inspirlearning",
    ),
  );
  assert.equal(wrangler.version_metadata?.binding, "CF_VERSION_METADATA");
  assert.ok(
    wrangler.durable_objects?.bindings?.some(
      (binding) => binding.name === "NEXT_CACHE_DO_QUEUE" && binding.class_name === "DOQueueHandler",
    ),
  );
  assert.ok(wrangler.migrations?.some((migration) => migration.new_sqlite_classes?.includes("DOQueueHandler")));
  assert.deepEqual(wrangler.secrets?.required, [
    "CLOUDFLARE_AI_GATEWAY_TOKEN",
    "AUTH_SECRET",
    "AUTH_GOOGLE_ID",
    "AUTH_GOOGLE_SECRET",
    "ADMIN_EMAILS",
    "CRON_SECRET",
  ]);
  assert.equal(wrangler.vars?.AUTH_URL, "https://inspirlearning.com");
  assert.equal(wrangler.vars?.AI_RESPONSE_CACHE_TTL_SECONDS, undefined);
});

test("localized marketing chrome avoids English-only video and PWA labels", () => {
  const marketingShell = fs.readFileSync(path.resolve("components/marketing/MarketingShell.tsx"), "utf8");
  const pwaPrompt = fs.readFileSync(path.resolve("components/pwa/PwaInstallPrompt.tsx"), "utf8");
  const playerLabels = [
    "inspir learning film",
    "Play inspir learning preview",
    "Watch 31s",
    "inspir in motion",
    "Curiosity, practice, and AI that teaches.",
    "Film chapters",
    "Transcript",
    "Next step",
    "Start a live learning session.",
    "Ask your first question and move straight into practice.",
    "Start learning",
    "Replay",
    "Pause film",
    "Play film",
    "Restart film",
    "Hide film chapters",
    "Show film chapters",
    "Hide film transcript",
    "Show film transcript",
    "Video controls",
    "Video progress",
    "Unmute film",
    "Mute film",
    "Open film fullscreen",
  ];

  for (const label of playerLabels) {
    assert.ok(marketingShell.includes(`chrome.t("${label}")`), `Expected localized video label: ${label}`);
  }

  assert.match(pwaPrompt, /const promptEnabled = enabled && !hasLocalePathPrefix\(pathname\)/);
  assert.match(pwaPrompt, /if \(!promptEnabled \|\| !sheet\.isVisible \|\| !sheet\.mode\)/);
  assert.match(marketingShell, /availableLanguages=\{chrome\.availableLanguages\}/);
});

test("homepage film keeps the poster as the first visible LCP surface", () => {
  const landingPage = fs.readFileSync(path.resolve("components/marketing/pages/LandingMarketingPage.tsx"), "utf8");
  const videoEngine = fs.readFileSync(path.resolve("components/marketing/MarketingVideoEngine.tsx"), "utf8");
  const globals = fs.readFileSync(path.resolve("app/globals.css"), "utf8");

  assert.doesNotMatch(landingPage, /rel="preload"\s+as="image"\s+href=\{homepageFilm\.thumbnailUrl\}/);
  assert.match(videoEngine, /poster=\{autoPlay \? undefined : poster\}/);
  assert.match(globals, /\.marketing-hero-video\.is-started\.is-ready \.marketing-video-frame\s*{\s*opacity: 1;/);
  assert.doesNotMatch(globals, /\.marketing-hero-video\.is-started \.marketing-video-frame\s*{\s*opacity: 1;/);
  assert.match(
    globals,
    /\.marketing-hero > \.marketing-hero-video \.marketing-video-ambient\s*{[\s\S]*?display: none;[\s\S]*?background: none;/,
  );
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
  const socialConfig = fs.readFileSync(path.resolve("lib/seo/config.ts"), "utf8");

  assert.equal(fs.existsSync(path.resolve("app/og/route.ts")), false);
  assert.match(socialConfig, /url:\s*`\$\{siteUrl\}\/inspir-social-preview\.png`/);
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

test("chat auto-translation is incremental and preserves workspace node identity", () => {
  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  const richMarkdown = fs.readFileSync(path.resolve("components/chat/RichMarkdownContent.tsx"), "utf8");
  const observerStart = chatClient.indexOf("const observer = new MutationObserver");
  const observerEnd = chatClient.indexOf("observer.observe(root", observerStart);
  assert.ok(observerStart >= 0 && observerEnd > observerStart);
  const observerBody = chatClient.slice(observerStart, observerEnd);

  assert.match(chatClient, /new MutationObserver\(\(mutations\) =>/);
  assert.match(chatClient, /closest\("\[data-no-auto-translate\], code, pre, script, style"\)/);
  assert.match(chatClient, /translateNodeTree\(root, textMap, translationState\)/);
  assert.match(observerBody, /if \(shouldSkipTranslation\(mutation\.target\)\) continue/);
  assert.match(observerBody, /translateNodeTree\(addedNode, textMap, translationState\)/);
  assert.match(observerBody, /translateTextNode\(mutation\.target, textMap, translationState\)/);
  assert.match(observerBody, /translateElementAttribute\(mutation\.target, mutation\.attributeName, textMap, translationState\)/);
  assert.doesNotMatch(observerBody, /translateNodeTree\(root/);
  assert.doesNotMatch(observerBody, /querySelectorAll|createTreeWalker/);
  assert.match(chatClient, /textNodes: WeakMap<Text, AppliedTranslation>/);
  assert.match(chatClient, /previous\?\.applied === currentValue \? previous\.source : currentValue/);
  assert.match(chatClient, /useAutoTranslate\(translationRootRef, translationTextMap\)/);
  assert.equal(chatClient.match(/buildTranslationTextMap\(/g)?.length, 2);
  assert.match(chatClient, /<div ref=\{translationRootRef\}/);
  assert.doesNotMatch(chatClient, /key=\{`\$\{translationBundle\.language\}-\$\{translationBundle\.sourceHash\}`\}/);
  assert.equal(richMarkdown.match(/data-no-auto-translate="true"/g)?.length, 2);
  assert.match(
    richMarkdown,
    /className=\{`\$\{className\} is-streaming`\}[\s\S]*?data-no-auto-translate="true"/,
  );
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

test("static chat shells upgrade safely to authenticated accounts and saved state", () => {
  const page = fs.readFileSync(path.resolve("app/(workspace)/chat/page.tsx"), "utf8");
  const localizedPage = fs.readFileSync(
    path.resolve("app/(localized-workspace)/[locale]/chat/page.tsx"),
    "utf8",
  );
  const bootstrap = fs.readFileSync(path.resolve("components/chat/StaticGuestChatBootstrap.tsx"), "utf8");
  const topicsRoute = fs.readFileSync(path.resolve("app/api/topics/route.ts"), "utf8");
  const publicTopics = fs.readFileSync(path.resolve("lib/content/public-topics.ts"), "utf8");
  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.resolve("components/chat/TopicSidebar.tsx"), "utf8");
  const learningStore = fs.readFileSync(path.resolve("components/chat/LearningStore.tsx"), "utf8");
  const staticPage = fs.readFileSync(path.resolve("components/chat/StaticGuestChatPage.tsx"), "utf8");
  const signIn = fs.readFileSync(path.resolve("components/marketing/SignInButton.tsx"), "utf8");

  assert.equal(fs.existsSync(path.resolve("app/(workspace)/chat/[chatId]/page.tsx")), false);
  assert.match(page, /export const dynamic = "force-static"/);
  assert.match(page, /<StaticGuestChatPage/);
  assert.match(localizedPage, /export const dynamic = "force-static"/);
  assert.match(localizedPage, /export const dynamicParams = false/);
  assert.match(localizedPage, /generateStaticParams/);
  assert.match(bootstrap, /useSyncExternalStore/);
  assert.match(bootstrap, /topicSlugFromChatLocation/);
  assert.match(bootstrap, /window\.location\.search/);
  assert.match(bootstrap, /topics\.find\(\(topic\) => topic\.slug === slug\)/);
  assert.match(bootstrap, /fetch\("\/api\/me"/);
  assert.match(bootstrap, /fetch\("\/api\/account\/topics"/);
  assert.match(bootstrap, /privateChatIdFromLocation/);
  assert.match(bootstrap, /inspir-bootstrap-error/);
  assert.match(bootstrap, /window\.location\.reload\(\)/);
  assert.match(bootstrap, /inspir-auth-error-notice/);
  assert.match(bootstrap, /oauth_callback_failed/);
  assert.match(staticPage, /Your saved data has not been changed/);
  assert.match(signIn, /google-auth-error/);
  assert.match(signIn, /setFailed\(true\)/);
  assert.match(signIn, /accounts\.google\.com/);
  assert.match(topicsRoute, /export const dynamic = "force-static"/);
  assert.match(topicsRoute, /getPublicSeededTopics/);
  assert.match(publicTopics, /topicSeeds\.map/);
  assert.match(chatClient, /authMode: "authenticated" \| "guest"/);
  assert.match(chatClient, /trackProductEvent/);
  assert.match(chatClient, /localizeHref\(`\/chat\/\$\{(?:data\.chatId|chatId)\}`, currentLanguage\)/);
  assert.doesNotMatch(chatClient, /replaceState\(null, "", `\/chat\/\$\{/);
  assert.match(sidebar, /GoogleContinueButton|Continue with Google/);
  assert.doesNotMatch(learningStore, /ai-game-arena|href=\{?["'`]\/games/);
  assert.equal(fs.existsSync(path.resolve("components/analytics/trackProductEvent.ts")), true);
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
  const adminDashboard = fs.readFileSync(path.resolve("components/admin/AdminDashboard.tsx"), "utf8");
  const schema = fs.readFileSync(path.resolve("lib/db/schema.ts"), "utf8");

  assert.match(adminAuth, /makridroid@gmail\.com/);
  assert.match(adminAuth, /isAdminEmailAsync/);
  assert.match(schema, /sqliteTable\(\s*"admin_users"/);
  assert.match(profilePanel, /user\.isAdmin/);
  assert.match(profilePanel, /t\("Admin dashboard"\)/);
  assert.match(adminPage, /dynamic = "force-static"/);
  assert.match(adminPage, /AdminDashboard/);
  assert.match(adminDashboard, /\/api\/admin\/dashboard/);
  assert.match(adminDashboard, /AdminUserManager/);
  assert.match(adminDashboard, /Response cache/);
  assert.match(adminDashboard, /Cache savings/);
  assert.match(adminDashboard, /Cached topics/);
});

test("static workspace restores bounded product analytics while marketing remains external-only", () => {
  const analyticsScripts = fs.readFileSync(path.resolve("components/analytics/AnalyticsScripts.tsx"), "utf8");
  const marketingLayout = fs.readFileSync(path.resolve("app/(marketing)/layout.tsx"), "utf8");
  const localizedLayout = fs.readFileSync(path.resolve("app/[locale]/layout.tsx"), "utf8");
  const workspaceLayout = fs.readFileSync(path.resolve("app/(workspace)/layout.tsx"), "utf8");

  assert.match(analyticsScripts, /G-S3E1FV3RK8/);
  assert.match(analyticsScripts, /xi5vqkce95/);
  assert.match(analyticsScripts, /automaticPageViews = true/);
  assert.match(analyticsScripts, /send_page_view: \$\{automaticPageViews \? "true" : "false"\}/);
  assert.match(marketingLayout, /AnalyticsScripts/);
  assert.match(localizedLayout, /AnalyticsScripts/);
  assert.match(workspaceLayout, /AnalyticsScripts/);
  assert.doesNotMatch(marketingLayout, /ProductAnalytics/);
  assert.doesNotMatch(localizedLayout, /ProductAnalytics/);
  assert.match(workspaceLayout, /ProductAnalytics/);
  assert.match(workspaceLayout, /<AnalyticsScripts automaticPageViews=\{false\} \/>/);
  assert.equal(fs.existsSync(path.resolve("components/analytics/trackProductEvent.ts")), true);
  assert.match(workspaceLayout, /export const dynamic = "force-static"/);
  assert.doesNotMatch(workspaceLayout, /headers\(\)/);
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
