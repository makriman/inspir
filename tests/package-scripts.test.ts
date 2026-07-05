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
