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
});

test("analytics scripts and product events are installed without inline CSP fallback", () => {
  const analyticsScripts = fs.readFileSync(path.resolve("components/analytics/AnalyticsScripts.tsx"), "utf8");
  const productAnalytics = fs.readFileSync(path.resolve("components/analytics/ProductAnalytics.tsx"), "utf8");
  const middleware = fs.readFileSync(path.resolve("middleware.ts"), "utf8");
  const csp = fs.readFileSync(path.resolve("lib/security/headers.ts"), "utf8");
  const scriptDirective = csp.split("\n").find((line) => line.includes("script-src")) ?? "";

  assert.match(analyticsScripts, /G-S3E1FV3RK8/);
  assert.match(analyticsScripts, /xi5vqkce95/);
  assert.match(productAnalytics, /auth_error_seen/);
  assert.match(productAnalytics, /\/api\/analytics\/events/);
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
