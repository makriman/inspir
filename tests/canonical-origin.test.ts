import assert from "node:assert/strict";
import test from "node:test";
import { canonicalOriginRedirectUrl } from "../lib/http/canonical-origin";

test("canonical origin redirects confirmed Cloudflare production HTTP requests", () => {
  const redirect = canonicalOriginRedirectUrl(
    new URL("http://inspirlearning.com/chat/learn-anything?source=canonical"),
    new Headers({ "cf-ray": "canonical-test-LHR", "cf-visitor": JSON.stringify({ scheme: "http" }) }),
  );

  assert.equal(redirect?.toString(), "https://inspirlearning.com/chat/learn-anything?source=canonical");
});

test("canonical origin redirects www to the apex while preserving the request target", () => {
  const redirect = canonicalOriginRedirectUrl(
    new URL("https://www.inspirlearning.com/hi/about?source=canonical"),
    new Headers({ host: "www.inspirlearning.com", "x-forwarded-proto": "https" }),
  );

  assert.equal(redirect?.toString(), "https://inspirlearning.com/hi/about?source=canonical");
});

test("canonical origin never redirects local preview despite an internal production URL", () => {
  for (const host of ["localhost:8787", "127.0.0.1:8787", "[::1]:8787"]) {
    const redirect = canonicalOriginRedirectUrl(
      new URL("http://inspirlearning.com/chat/learn-anything"),
      new Headers({ host, "x-forwarded-proto": "http" }),
    );
    assert.equal(redirect, null, host);
  }
});

test("canonical origin does not trust an APP_URL-derived production hostname without edge evidence", () => {
  assert.equal(
    canonicalOriginRedirectUrl(
      new URL("http://inspirlearning.com/chat/learn-anything"),
      new Headers({ "x-forwarded-proto": "http" }),
    ),
    null,
  );
});
