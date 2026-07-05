import assert from "node:assert/strict";
import test from "node:test";
import { scanSourceText } from "../scripts/cloudflare/scan-source-secrets";

test("source secret scan reports high-risk provider tokens without storing the raw token", () => {
  const token = "cfat_" + "A".repeat(32);
  const findings = scanSourceText("fixture.ts", `const token = "${token}";\n`);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "cloudflare-api-token");
  assert.equal(findings[0].file, "fixture.ts");
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].redactedSnippet.includes(token), false);
  assert.match(findings[0].redactedSnippet, /\[REDACTED:[a-f0-9]{12}\]/);
});

test("source secret scan reports Cloudflare AI Gateway run tokens", () => {
  const token = "cfut_" + "A".repeat(32);
  const findings = scanSourceText("fixture.ts", `const token = "${token}";\n`);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "cloudflare-ai-gateway-token");
  assert.equal(findings[0].redactedSnippet.includes(token), false);
});

test("source secret scan ignores empty env placeholders and documented key names", () => {
  const content = [
    "OPENAI_API_KEY=",
    "AUTH_SECRET=",
    "NEXTAUTH_SECRET=",
    "SUPABASE_SERVICE_ROLE_KEY=your-service-role-key",
  ].join("\n");

  assert.deepEqual(scanSourceText(".env.example", content), []);
});

test("source secret scan detects credentialed postgres URLs", () => {
  const password = "p".repeat(24);
  const scheme = "postgres" + "://";
  const findings = scanSourceText("fixture.md", `DATABASE_URL=${scheme}user:${password}@db.example.com/app\n`);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "credentialed-postgres-url");
  assert.equal(findings[0].redactedSnippet.includes(password), false);
});
