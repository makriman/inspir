import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME,
  CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS,
  cloudflareApiTokenInstructions,
  readCloudflareApiToken,
} from "../scripts/cloudflare/cloudflare-api-token";

test("Cloudflare API token can be read from a 0600 token file", () => {
  withTokenFile(0o600, (tokenFile) => {
    const result = readCloudflareApiToken({
      CLOUDFLARE_API_TOKEN_FILE: tokenFile,
    });

    assert.equal(result.token, "cfat_test_token_value");
    assert.deepEqual(result.source, { kind: "file", name: "CLOUDFLARE_API_TOKEN_FILE" });
    assert.equal(result.error, undefined);
  });
});

test("Cloudflare API token files reject group/other readable modes", () => {
  withTokenFile(0o644, (tokenFile) => {
    const result = readCloudflareApiToken({
      CLOUDFLARE_API_TOKEN_FILE: tokenFile,
    });

    assert.equal(result.token, "");
    assert.match(result.error ?? "", /mode is 0644/);
    assert.match(result.error ?? "", /0600 or stricter/);
  });
});

test("direct Cloudflare API token env remains supported", () => {
  const result = readCloudflareApiToken({
    CLOUDFLARE_API_TOKEN: " cfat_direct_test_value\n",
  });

  assert.equal(result.token, "cfat_direct_test_value");
  assert.deepEqual(result.source, { kind: "env", name: "CLOUDFLARE_API_TOKEN" });
});

test("Cloudflare API token file takes precedence over stale direct env", () => {
  withTokenFile(0o600, (tokenFile) => {
    const result = readCloudflareApiToken({
      CLOUDFLARE_API_TOKEN: "cfat_stale_direct_value",
      CLOUDFLARE_API_TOKEN_FILE: tokenFile,
    });

    assert.equal(result.token, "cfat_test_token_value");
    assert.deepEqual(result.source, { kind: "file", name: "CLOUDFLARE_API_TOKEN_FILE" });
  });
});

test("Cloudflare token capability verifier requires a confirmed temporary DNS write/delete probe", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/cloudflare/verify-cloudflare-api-token.ts"), "utf8");

  assert.match(source, /CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE/);
  assert.match(source, /CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /method:\s*"DELETE"/);
  assert.match(source, /Cloudflare DNS records write\/delete probe/);
  assert.match(source, /requiredPermissions/);
  assert.match(source, /Zone:Read/);
  assert.match(source, /DNS:Read/);
  assert.match(source, /DNS:Edit/);
  assert.match(CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME, /_codex-migration-token-check/);
});

test("Cloudflare API token instructions include DNS cutover permissions and probe record", () => {
  const instructions = cloudflareApiTokenInstructions();

  assert.equal(instructions.requiredPermissions.accountId, "a1e5e542dc1d5fe5a5c6b2a10d755a81");
  assert.equal(instructions.requiredPermissions.zone, "inspirlearning.com");
  assert.deepEqual(instructions.requiredPermissions.zonePermissions, ["Zone:Read"]);
  assert.deepEqual(instructions.requiredPermissions.dnsPermissions, ["DNS:Read", "DNS:Edit"]);
  assert.equal(instructions.requiredPermissions.temporaryProbeRecord, CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME);
  assert.equal(CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS, instructions.requiredPermissions);
});

function withTokenFile(mode: number, callback: (tokenFile: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-cf-token-"));
  const tokenFile = path.join(dir, "token.txt");
  try {
    fs.writeFileSync(tokenFile, "cfat_test_token_value\n", { mode });
    fs.chmodSync(tokenFile, mode);
    callback(tokenFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
