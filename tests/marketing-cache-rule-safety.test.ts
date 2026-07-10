import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketingCacheRules } from "../scripts/cloudflare/upsert-marketing-cache-rule";

test("localized edge caching is limited to exact deploy-proven public pages", () => {
  const rules = buildMarketingCacheRules();
  const englishRule = rules.find((rule) => rule.ref.endsWith("_english"));
  const localizedRules = rules.filter((rule) => rule.ref.includes("_localized-pages-"));
  const localizedExpression = localizedRules.map((rule) => rule.expression).join("\n");

  assert.equal(cacheEdgeTtl(englishRule), 3_600);
  assert.ok(localizedRules.length > 0);
  assert.ok(localizedRules.every((rule) => cacheEdgeTtl(rule) === 31_536_000));
  assert.match(localizedExpression, /http\.request\.uri\.path in/);
  assert.match(localizedExpression, /"\/hi"/);
  assert.match(localizedExpression, /"\/es\/mission"/);
  assert.doesNotMatch(localizedExpression, /starts_with\(http\.request\.uri\.path/);
  assert.doesNotMatch(localizedExpression, /"\/hi\/profile"|"\/es\/games"|"\/fr\/settings"/);

  for (const rule of rules) {
    if (rule.action_parameters.cache !== true) continue;
    assert.match(rule.expression, /not http\.request\.uri\.path contains "\/api"/);
    assert.match(rule.expression, /not http\.request\.uri\.path contains "\/admin"/);
    assert.match(rule.expression, /not http\.request\.uri\.path contains "\/chat"/);
  }
});

function cacheEdgeTtl(rule: ReturnType<typeof buildMarketingCacheRules>[number] | undefined) {
  if (!rule || rule.action_parameters.cache !== true) return null;
  return rule.action_parameters.edge_ttl.default;
}
