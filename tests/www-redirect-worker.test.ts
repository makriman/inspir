import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { canonicalWwwRedirect } from "../cloudflare-www-redirect";

test("www redirect Worker preserves path and query on the canonical HTTPS origin", () => {
  const response = canonicalWwwRedirect(
    new Request("http://www.inspirlearning.com/hi/about?utm_source=canonical-test&next=a%2Fb", {
      method: "POST",
    }),
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://inspirlearning.com/hi/about?utm_source=canonical-test&next=a%2Fb",
  );
  assert.equal(response.headers.get("x-inspir-delivery"), "www-redirect-worker");
  assert.match(response.headers.get("cache-control") ?? "", /max-age=86400/);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
});

test("www redirect Worker config stays isolated, Free-plan compatible, and ahead of the main Custom Domain", () => {
  const redirectConfig = JSON.parse(fs.readFileSync(path.resolve("wrangler.www-redirect.jsonc"), "utf8")) as {
    name?: string;
    main?: string;
    compatibility_date?: string;
    compatibility_flags?: string[];
    workers_dev?: boolean;
    preview_urls?: boolean;
    routes?: Array<{ pattern?: string; zone_name?: string; custom_domain?: boolean }>;
    limits?: unknown;
    assets?: unknown;
    vars?: unknown;
  };
  const mainConfig = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
  };
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(redirectConfig.name, "inspirlearning-www-redirect");
  assert.equal(redirectConfig.main, "./cloudflare-www-redirect.ts");
  assert.equal(redirectConfig.compatibility_date, "2026-07-10");
  assert.deepEqual(redirectConfig.compatibility_flags, ["nodejs_compat"]);
  assert.equal(redirectConfig.workers_dev, false);
  assert.equal(redirectConfig.preview_urls, false);
  assert.deepEqual(redirectConfig.routes, [
    { pattern: "www.inspirlearning.com/*", zone_name: "inspirlearning.com" },
  ]);
  assert.equal(redirectConfig.limits, undefined);
  assert.equal(redirectConfig.assets, undefined);
  assert.equal(redirectConfig.vars, undefined);
  assert.ok(mainConfig.routes?.some((route) => route.pattern === "www.inspirlearning.com" && route.custom_domain));
  assert.equal(
    packageJson.scripts?.["cf:deploy:www-redirect"],
    "wrangler deploy --config wrangler.www-redirect.jsonc",
  );
  assert.equal(
    packageJson.scripts?.["cf:check:www-redirect"],
    "wrangler deploy --dry-run --config wrangler.www-redirect.jsonc",
  );
});
