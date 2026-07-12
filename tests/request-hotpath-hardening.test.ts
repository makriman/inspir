import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { privateAuthCacheControl, withPrivateAuthCache } from "../lib/auth/private-response";
import { topicSeeds, type TopicSeed } from "../lib/content/topics";
import {
  buildTopicSeedSql,
  buildTopicSeedSqlBatches,
  topicSeedHash,
} from "../scripts/cloudflare/sync-topic-seeds";

const read = (file: string) => fs.readFileSync(path.resolve(file), "utf8");

test("Better Auth responses fail closed against browser and shared-cache storage", async () => {
  const headers = new Headers({
    "Cache-Control": "public, s-maxage=86400",
    Location: "https://accounts.example.test/oauth",
    "Set-Cookie": "session=secret; Path=/; HttpOnly",
    "X-Auth-Result": "preserved",
  });
  headers.append("Set-Cookie", "csrf=nonce; Path=/; SameSite=Lax");
  const response = withPrivateAuthCache(
    new Response("redirecting", {
      status: 302,
      statusText: "Found",
      headers,
    }),
  );

  assert.equal(response.status, 302);
  assert.equal(response.statusText, "Found");
  assert.equal(await response.text(), "redirecting");
  assert.equal(response.headers.get("location"), "https://accounts.example.test/oauth");
  assert.match(response.headers.get("set-cookie") ?? "", /session=secret; Path=\/; HttpOnly/);
  assert.match(response.headers.get("set-cookie") ?? "", /csrf=nonce; Path=\/; SameSite=Lax/);
  assert.equal(response.headers.get("x-auth-result"), "preserved");
  assert.equal(response.headers.get("cache-control"), privateAuthCacheControl);
  assert.equal(response.headers.get("cdn-cache-control"), "private, no-store");
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "private, no-store");
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("every exported Better Auth method protects normal and write-freeze responses", () => {
  const source = read("app/api/auth/[...all]/route.ts");
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.equal(source.match(/if \(freeze\) return withPrivateAuthCache\(freeze\);/g)?.length, 5);
  assert.match(source, /queueAuthTelemetry\(method, request, response\);\s+return withPrivateAuthCache\(response\);/);

  for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
    assert.match(source, new RegExp(`export async function ${method}\\(request: Request\\)`));
    assert.match(source, new RegExp(`runObservedAuthHandler\\("${method}"`));
  }
});

test("regional incremental-cache hits do not re-read and parse R2 entries", () => {
  const config = read("open-next.config.ts");
  const runtimeSources = ["app", "lib"].flatMap((directory) =>
    fs
      .readdirSync(path.resolve(directory), { recursive: true })
      .filter((entry): entry is string => typeof entry === "string" && /\.[cm]?[jt]sx?$/.test(entry))
      .map((entry) => read(path.join(directory, entry))),
  );

  assert.match(config, /bypassTagCacheOnCacheHit: true/);
  assert.match(config, /shouldLazilyUpdateOnCacheHit: false/);
  assert.equal(runtimeSources.some((source) => /revalidate(?:Tag|Path)\s*\(/.test(source)), false);
});

test("topic reads never synchronize or write seed data from a request", () => {
  const queries = read("lib/db/queries.ts");
  assert.doesNotMatch(queries, /ensureSeedTopics|syncSeedTopics|seedTopicsPromise|topic_seed_hash/);
  assert.doesNotMatch(queries, /createHash.*node:crypto/);
  assert.doesNotMatch(queries, /insert\(topics\)[\s\S]*topicSeeds/);

  for (const query of ["getActiveTopics", "getPublicActiveTopics", "getDefaultTopic", "getTopicByIdOrSlug"]) {
    assert.match(queries, new RegExp(`export async function ${query}\\(`));
  }
});

test("translation availability never retains attacker-controlled request paths", () => {
  const availability = read("lib/i18n/static-availability.ts");

  assert.doesNotMatch(availability, /staticPathAvailabilityCache/);
  assert.doesNotMatch(availability, /\.set\(cacheKey|new Map<string, SupportedLanguage\[\]>/);
  assert.match(availability, /staticNamespaceAvailability/);
  assert.match(availability, /bounded by the curated, generated language manifest/);
});

test("topic seed synchronization is explicit, deterministic, and local-setup owned", () => {
  const setup = read("scripts/cloudflare/setup-local-d1.ts");
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const hash = topicSeedHash();
  const sql = buildTopicSeedSql(topicSeeds, 123, hash);
  const batches = buildTopicSeedSqlBatches(topicSeeds, 123, hash);

  assert.equal(
    packageJson.scripts?.["cf:sync:topic-seeds"],
    "tsx scripts/cloudflare/run-production-release-operation.ts sync-topic-seeds",
  );
  assert.match(setup, /syncTopicSeeds\("local"\)/);
  assert.ok(setup.indexOf('syncTopicSeeds("local")') < setup.indexOf('syncSiteTranslationSources("local")'));
  assert.equal(hash.length, 64);
  assert.equal(sql.match(/INSERT INTO topics/g)?.length, topicSeeds.length);
  assert.match(sql, /ON CONFLICT\(slug\) DO UPDATE SET name = excluded\.name/);
  assert.doesNotMatch(sql, /status = excluded\.status/);
  assert.doesNotMatch(sql, /id = excluded\.id/);
  assert.match(sql, new RegExp(`'topic_seed_hash', '${hash}', 123`));
  assert.match(sql, /UPDATE topics SET status = 'archived'/);
  assert.match(sql, /slug IN \('ai-game-arena'\)/);
  assert.match(sql, /json_each\(COALESCE/);
  assert.match(sql, /'topic_seed_slugs'/);
  assert.ok(batches.length > 2);
  assert.ok(batches.every((batch) => Buffer.byteLength(batch) < 100_000));
  assert.doesNotMatch(batches.slice(0, -1).join(""), /topic_seed_hash/);
  assert.match(batches.at(-1) ?? "", /topic_seed_hash/);
});

test("topic seed SQL escapes curated text without weakening its typed contract", () => {
  const seed: TopicSeed = {
    slug: "learner-s-question",
    name: "Learner's Question",
    subText: "What's next?",
    description: "Don't lose the source text.",
    inputboxText: "What's your question?",
    systemPrompt: "Treat the learner's text carefully.",
    sortOrder: 1,
    metadata: {
      category: "Test",
      uiMode: "chat",
      modelProfile: "fast",
      starters: ["What's this?"],
    },
  };
  const sql = buildTopicSeedSql([seed], 456);

  assert.match(sql, /Learner''s Question/);
  assert.match(sql, /What''s next\?/);
  assert.match(sql, /learner''s text/);
});
