import fs from "node:fs";
import path from "node:path";
import { cloudflareDir, resolveBackupDir } from "./migration-config";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail?: unknown;
};

type FetchResult = {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  bodyPreview: string;
};

const backupDir = resolveBackupDir();
const baseUrl = normalizeBaseUrl(getArg("--base-url") ?? process.env.PRODUCTION_BASE_URL ?? "https://inspirlearning.com");
const outputPath = path.join(cloudflareDir(backupDir), "production-smoke-report.json");
const checks: Check[] = [];

void main().catch((error) => {
  fail("production smoke runtime", error instanceof Error ? error.message : String(error));
  writeReport();
  process.exitCode = 1;
});

async function main() {
  const home = await request("/");
  checkResponse("home", home, {
    bodyIncludes: [/free ai learning/i, /learn/i],
    requireCloudflare: true,
    requireNoVercel: true,
  });

  const localized = await request("/hi");
  checkResponse("localized Hindi route", localized, {
    bodyIncludes: [/learn|सीख|सीखने|शिक्ष/i],
    requireNoVercel: true,
  });
  if ((localized.headers["set-cookie"] ?? "").includes("inspir_locale=Hindi")) {
    pass("localized Hindi route language cookie");
  } else {
    fail("localized Hindi route language cookie", { setCookie: localized.headers["set-cookie"] ?? null });
  }

  const robots = await request("/robots.txt");
  checkResponse("robots", robots, { bodyIncludes: [/User-Agent/i], requireNoVercel: true });

  const sitemap = await request("/sitemap");
  checkResponse("sitemap index", sitemap, { bodyIncludes: [/<sitemapindex/i], requireNoVercel: true });

  const englishSitemap = await request("/sitemap/en-US.xml");
  checkResponse("English sitemap", englishSitemap, { bodyIncludes: [/<urlset/i], requireNoVercel: true });

  const rss = await request("/rss.xml");
  checkResponse("RSS", rss, { bodyIncludes: [/<rss/i], requireNoVercel: true });

  const og = await request("/og");
  checkResponse("OG image", og, { contentTypeIncludes: "image/png", requireNoVercel: true });

  const topics = await request("/api/topics");
  checkResponse("topics API", topics, { contentTypeIncludes: "application/json", requireNoVercel: true });
  checkTopicsPayload(topics);

  await checkGuestChat();

  const ok = writeReport();
  if (!ok) process.exitCode = 1;
}

async function checkGuestChat() {
  if (process.env.REQUIRE_LIVE_AI !== "1") {
    fail("live guest chat", "Set REQUIRE_LIVE_AI=1 for the required production chat smoke gate.");
    return;
  }

  const response = await request("/api/guest-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topicId: "learn-anything",
      content: "Say hello in one short sentence.",
      preferredLanguage: "English",
      messages: [],
    }),
  });

  checkResponse("live guest chat", response, { requireNoVercel: true });
  if (response.ok && response.bodyPreview.trim().length > 0) {
    const used = Number(response.headers["x-guest-messages-used"]);
    const limit = Number(response.headers["x-guest-messages-limit"]);
    pass("live guest chat streamed body", {
      messageLimit: response.headers["x-guest-messages-limit"] ?? null,
      messagesUsed: response.headers["x-guest-messages-used"] ?? null,
    });
    if (Number.isInteger(used) && Number.isInteger(limit) && used >= 1 && limit >= used) {
      pass("live guest chat limit headers", { messagesUsed: used, messageLimit: limit });
    } else {
      fail("live guest chat limit headers", {
        messageLimit: response.headers["x-guest-messages-limit"] ?? null,
        messagesUsed: response.headers["x-guest-messages-used"] ?? null,
      });
    }
  } else {
    fail("live guest chat streamed body", {
      status: response.status,
      bodyPreview: response.bodyPreview,
    });
    fail("live guest chat limit headers", {
      messageLimit: response.headers["x-guest-messages-limit"] ?? null,
      messagesUsed: response.headers["x-guest-messages-used"] ?? null,
    });
  }
}

async function request(route: string, init?: RequestInit): Promise<FetchResult> {
  const url = new URL(route, baseUrl).toString();
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const headers = Object.fromEntries([...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
  const contentType = headers["content-type"] ?? "";
  const body =
    contentType.includes("image/") || response.status === 204 ? "" : await response.text().catch((error) => String(error));
  return {
    url,
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    headers,
    body,
    bodyPreview: body.slice(0, 2000),
  };
}

function checkResponse(
  name: string,
  result: FetchResult,
  options: {
    bodyIncludes?: RegExp[];
    contentTypeIncludes?: string;
    requireCloudflare?: boolean;
    requireNoVercel?: boolean;
  } = {},
) {
  if (result.ok) pass(`${name} status`, { status: result.status, url: result.url });
  else fail(`${name} status`, { status: result.status, url: result.url, bodyPreview: result.bodyPreview });

  for (const pattern of options.bodyIncludes ?? []) {
    if (pattern.test(result.bodyPreview)) pass(`${name} body: ${pattern.source}`);
    else fail(`${name} body: ${pattern.source}`, { bodyPreview: result.bodyPreview });
  }

  if (options.contentTypeIncludes) {
    const contentType = result.headers["content-type"] ?? "";
    if (contentType.includes(options.contentTypeIncludes)) {
      pass(`${name} content type`, { contentType });
    } else {
      fail(`${name} content type`, { expected: options.contentTypeIncludes, actual: contentType });
    }
  }

  if (options.requireCloudflare) {
    const server = result.headers.server ?? "";
    const hasCloudflareSignal = server.toLowerCase().includes("cloudflare") || Boolean(result.headers["cf-ray"]);
    if (hasCloudflareSignal) {
      pass(`${name} Cloudflare edge signal`, { server, cfRay: result.headers["cf-ray"] ?? null });
    } else {
      fail(`${name} Cloudflare edge signal`, { server, cfRay: result.headers["cf-ray"] ?? null });
    }
  }

  if (options.requireNoVercel) {
    const vercelHeaders = Object.keys(result.headers).filter((header) => header.startsWith("x-vercel"));
    if (!vercelHeaders.length) pass(`${name} not served by Vercel`);
    else fail(`${name} not served by Vercel`, { vercelHeaders });
  }
}

function checkTopicsPayload(result: FetchResult) {
  try {
    const payload = JSON.parse(result.body) as { topics?: Array<{ slug?: string }> };
    const topics = payload.topics ?? [];
    if (topics.length > 50 && topics.some((topic) => topic.slug === "learn-anything")) {
      pass("topics API payload", { topics: topics.length });
    } else {
      fail("topics API payload", { topics: topics.length, hasLearnAnything: topics.some((topic) => topic.slug === "learn-anything") });
    }
  } catch (error) {
    fail("topics API payload", error instanceof Error ? error.message : String(error));
  }
}

function writeReport() {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    baseUrl,
    ok: failed.length === 0,
    failedChecks: failed.length,
    checks,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}
