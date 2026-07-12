import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeSignature } from "better-auth/crypto";
import {
  handleLogout,
  handleMigrationE2EAuthRequest,
  handleNativeAuthRequest,
  findUniqueGoogleEmailUser,
  type MigrationE2EAuthEnv,
  type NativeAuthEnv,
} from "../lib/free-runtime/account-api";
import {
  buildNativeSessionCookie,
  privateNoStoreHeaders,
  readVerifiedNativeSessionToken,
  requireNativeSession,
  shouldRefreshNativeSession,
  verifyNativeAuthValue,
} from "../lib/free-runtime/native-session";

const testSecret = "native-session-test-secret-that-is-long-enough";
const testToken = "01JSESSIONTOKEN_FOR_NATIVE_ACCOUNT_TEST";
const configuredE2ESecret = "configured-e2e-secret-with-at-least-32-bytes";
const configuredE2EEmail = "test@example.com";
const configuredE2ERunId = "22222222-2222-4222-8222-222222222222";
const configuredE2EVersionId = "11111111-1111-4111-8111-111111111111";
const configuredE2EExpiresAt = String(Date.now() + 60 * 60 * 1_000);
const trustedTestIp = "203.0.113.42";

test("native session verification accepts Better Auth HMAC cookies and rejects tampering", async () => {
  const cookie = await buildNativeSessionCookie(
    testToken,
    testSecret,
    "https://inspirlearning.com/api/me",
    Date.now() + 60_000,
  );
  assert.match(cookie, /^__Secure-better-auth\.session_token=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  const cookieValue = decodeURIComponent(cookie.split(";", 1)[0].split("=", 2)[1]);
  assert.equal(cookieValue, `${testToken}.${await makeSignature(testToken, testSecret)}`);

  const request = new Request("https://inspirlearning.com/api/me", {
    headers: { cookie: cookie.split(";", 1)[0] },
  });
  assert.equal(await readVerifiedNativeSessionToken(request, testSecret), testToken);
  assert.equal(await readVerifiedNativeSessionToken(request, `${testSecret}-wrong`), null);

  const cookiePair = cookie.split(";", 1)[0];
  const tamperedRequest = new Request("https://inspirlearning.com/api/me", {
    headers: { cookie: `${cookiePair.slice(0, -1)}A` },
  });
  assert.equal(await readVerifiedNativeSessionToken(tamperedRequest, testSecret), null);
});

test("native session verification does not let a stale non-secure cookie shadow a valid production cookie", async () => {
  const validCookie = await buildNativeSessionCookie(
    testToken,
    testSecret,
    "https://inspirlearning.com/api/me",
    Date.now() + 60_000,
  );
  const request = new Request("https://inspirlearning.com/api/me", {
    headers: {
      cookie: `better-auth.session_token=stale.invalid; ${validCookie.split(";", 1)[0]}`,
    },
  });
  assert.equal(await readVerifiedNativeSessionToken(request, testSecret), testToken);
});

test("native logout reports the exact D1 session deletion outcome", async () => {
  const cookie = await buildNativeSessionCookie(
    testToken,
    testSecret,
    "https://inspirlearning.com/api/auth/sign-out",
    Date.now() + 60_000,
  );
  for (const [changes, expected] of [[1, "deleted"], [0, "absent"]] as const) {
    const database = new LogoutD1Database(changes);
    const response = await handleNativeAuthRequest(
      new Request("https://inspirlearning.com/api/auth/sign-out", {
        method: "POST",
        headers: {
          cookie: cookie.split(";", 1)[0],
          origin: "https://inspirlearning.com",
          "sec-fetch-site": "same-origin",
        },
      }),
      oauthEnv(database),
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("x-inspir-session-cleanup"), expected);
    assert.equal(database.deletedToken, testToken);
  }
});

test("write freeze blocks both native logout aliases before any D1 session deletion", async () => {
  const cookie = await buildNativeSessionCookie(
    testToken,
    testSecret,
    "https://inspirlearning.com/api/auth/sign-out",
    Date.now() + 60_000,
  );
  for (const pathname of ["/api/auth/sign-out", "/api/logout"] as const) {
    const database = new LogoutD1Database(1);
    const response = await handleLogout(
      new Request(`https://inspirlearning.com${pathname}`, {
        method: "POST",
        headers: {
          cookie: cookie.split(";", 1)[0],
          origin: "https://inspirlearning.com",
          "sec-fetch-site": "same-origin",
        },
      }),
      oauthEnv(database, { APP_WRITE_FREEZE: "1" }),
    );
    assert.equal(response.status, 503, pathname);
    assert.equal(response.headers.get("retry-after"), "300", pathname);
    assert.deepEqual(await response.json(), {
      error: "The service is temporarily read-only while a migration is in progress.",
      code: "write_freeze_active",
      surface: "auth",
    });
    assert.equal(database.prepareCalls, 0, pathname);
    assert.equal(database.deletedToken, null, pathname);
  }
});

test("native private responses fail closed against browser and shared-cache storage", () => {
  const headers = privateNoStoreHeaders({ "content-type": "application/json" });
  assert.equal(headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
  assert.equal(headers.get("cdn-cache-control"), "private, no-store");
  assert.equal(headers.get("cloudflare-cdn-cache-control"), "private, no-store");
  assert.equal(headers.get("pragma"), "no-cache");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
});

test("session sliding refresh becomes read-only for every supported write-freeze value", () => {
  const now = Date.now();
  const staleUpdatedAt = now - 2 * 24 * 60 * 60 * 1_000;
  assert.equal(shouldRefreshNativeSession(staleUpdatedAt, now, {}), true);
  assert.equal(shouldRefreshNativeSession(staleUpdatedAt, now, { APP_WRITE_FREEZE: "0" }), true);
  for (const value of ["1", "true", "YES", " on "]) {
    assert.equal(
      shouldRefreshNativeSession(staleUpdatedAt, now, { APP_WRITE_FREEZE: value }),
      false,
      value,
    );
  }
  assert.equal(shouldRefreshNativeSession(staleUpdatedAt, now, { WRITE_FREEZE: "1" }), false);
  assert.equal(shouldRefreshNativeSession(staleUpdatedAt, now, {}, { refresh: false }), false);
});

test("a frozen native session stays authenticated without issuing a D1 refresh update or cookie", async () => {
  const now = Date.now();
  const updatedAt = now - 2 * 24 * 60 * 60 * 1_000;
  const expiresAt = now + 7 * 24 * 60 * 60 * 1_000;
  const cookie = await buildNativeSessionCookie(
    testToken,
    testSecret,
    "https://inspirlearning.com/api/me",
    expiresAt,
  );
  const request = new Request("https://inspirlearning.com/api/me", {
    headers: { cookie: cookie.split(";", 1)[0] },
  });

  const frozenDatabase = new SessionD1Database({ updatedAt, expiresAt });
  const frozenSession = await requireNativeSession(request, {
    DB: frozenDatabase,
    AUTH_SECRET: testSecret,
    ADMIN_EMAILS: "",
    APP_WRITE_FREEZE: "true",
  });
  assert.ok(frozenSession);
  assert.equal(frozenSession.session.updatedAt.getTime(), updatedAt);
  assert.equal(frozenSession.session.expiresAt.getTime(), expiresAt);
  assert.equal(frozenSession.refreshedSessionCookie, null);
  assert.equal(frozenDatabase.sessionRefreshUpdates, 0);

  const writableDatabase = new SessionD1Database({ updatedAt, expiresAt });
  const refreshedSession = await requireNativeSession(request, {
    DB: writableDatabase,
    AUTH_SECRET: testSecret,
    ADMIN_EMAILS: "",
    APP_WRITE_FREEZE: "0",
  });
  assert.ok(refreshedSession?.refreshedSessionCookie);
  assert.equal(writableDatabase.sessionRefreshUpdates, 1);
});

test("native profile photo mutations use create-only objects and pointer compare-and-swap", () => {
  const source = fs.readFileSync(path.resolve("lib/free-runtime/account-api.ts"), "utf8");
  assert.match(source, /onlyIf:\s*\{\s*etagDoesNotMatch:\s*"\*"\s*\}/);
  assert.equal(source.match(/const mutationDb = env\.DB\.withSession\("first-primary"\);/g)?.length, 2);
  assert.match(
    source,
    /readProfilePhotoPointerForReconciliation[\s\S]*?db\.withSession\("first-primary"\)/,
  );
  assert.match(
    source,
    /set profile_image_mime = \?1,[\s\S]*?where id = \?7\s+and profile_image_r2_key is \?8/,
  );
  assert.match(source, /session\.user\.id,\s+previousKey,\s+\)\s+\.run\(\)/);
  assert.match(
    source,
    /set profile_image_mime = null,[\s\S]*?where id = \?2\s+and profile_image_r2_key is \?3/,
  );
  assert.match(source, /\.bind\(Date\.now\(\), session\.user\.id, previousKey\)\s+\.run\(\)/);
  assert.match(
    source,
    /if \(updateResult\.meta\.changes === 0\) \{\s+await deleteUncommittedProfileImageObject\(env, key\);\s+return profilePhotoConflictResponse\(session\);/,
  );
  assert.match(source, /if \(updateResult\.meta\.changes === 0\) return profilePhotoConflictResponse\(session\);/);
  assert.match(source, /pointer\.known && pointer\.key === key/);
  assert.match(source, /if \(!pointer\.known\) \{[\s\S]*?throw error;/);
  assert.match(source, /code: "profile_photo_conflict"/);
});

test("native Google initiation preserves the Better Auth client contract with signed short-lived PKCE state", async () => {
  const database = new OAuthInitiationD1Database("allow");
  const startedAt = Date.now();
  const response = await handleNativeAuthRequest(
    new Request("https://inspirlearning.com/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": trustedTestIp,
        origin: "https://inspirlearning.com",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/fr/chat?topic=biology",
      }),
    }),
    oauthEnv(database),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
  const responseValue: unknown = await response.json();
  assertRecord(responseValue);
  assert.equal(responseValue.redirect, true);
  assert.equal(typeof responseValue.url, "string");
  if (typeof responseValue.url !== "string") return;

  const authorizationURL = new URL(responseValue.url);
  assert.equal(authorizationURL.origin, "https://accounts.google.com");
  assert.equal(authorizationURL.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorizationURL.searchParams.get("client_id"), "google-client-id");
  assert.equal(
    authorizationURL.searchParams.get("redirect_uri"),
    "https://inspirlearning.com/api/auth/callback/google",
  );
  assert.equal(authorizationURL.searchParams.get("response_type"), "code");
  assert.equal(authorizationURL.searchParams.get("scope"), "email profile openid");
  assert.equal(authorizationURL.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizationURL.searchParams.get("access_type"), "offline");
  assert.equal(authorizationURL.searchParams.get("prompt"), "select_account");
  assert.equal(authorizationURL.searchParams.get("include_granted_scopes"), "true");

  const state = authorizationURL.searchParams.get("state");
  assert.ok(state);
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  const stateCookie = response.headers.get("set-cookie") ?? "";
  assert.match(stateCookie, /^__Secure-better-auth\.state=/);
  assert.match(stateCookie, /HttpOnly/);
  assert.match(stateCookie, /SameSite=Lax/);
  assert.match(stateCookie, /Secure/);
  const cookiePair = stateCookie.split(";", 1)[0] ?? "";
  const encodedCookieValue = cookiePair.slice(cookiePair.indexOf("=") + 1);
  const signedStatePayload = await verifyNativeAuthValue(
    decodeURIComponent(encodedCookieValue),
    testSecret,
  );
  assert.ok(signedStatePayload);
  const storedValue = decodeTestBase64UrlJson(signedStatePayload);
  assertRecord(storedValue);
  assert.equal(storedValue.oauthState, state);
  assert.equal(storedValue.callbackURL, "https://inspirlearning.com/fr/chat?topic=biology");
  assert.equal(storedValue.clientId, "google-client-id");
  assert.equal(typeof storedValue.codeVerifier, "string");
  assert.equal(typeof storedValue.expiresAt, "number");
  if (typeof storedValue.codeVerifier !== "string" || typeof storedValue.expiresAt !== "number") {
    return;
  }
  assert.match(storedValue.codeVerifier, /^[A-Za-z0-9_-]{86}$/);
  assert.ok(storedValue.expiresAt >= startedAt + 4 * 60 * 1_000);
  assert.ok(storedValue.expiresAt <= Date.now() + 5 * 60 * 1_000);
  const challengeDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(storedValue.codeVerifier),
  );
  assert.equal(
    authorizationURL.searchParams.get("code_challenge"),
    testBase64Url(new Uint8Array(challengeDigest)),
  );

  const limiter = database.statements.find((statement) =>
    statement.query.includes("insert into rate_limit_windows"),
  );
  assert.ok(limiter);
  assert.equal(limiter.boundValues[3], 20);
  assert.equal(typeof limiter.boundValues[0], "string");
  if (typeof limiter.boundValues[0] === "string") {
    assert.match(limiter.boundValues[0], /^native-google-oauth-initiation:[0-9a-f]{64}$/);
    assert.doesNotMatch(limiter.boundValues[0], new RegExp(trustedTestIp.replaceAll(".", "\\.")));
  }
  assert.equal(database.prepareCalls, 1);
  assert.ok(
    database.statements.every((statement) => !statement.query.includes("verification_tokens")),
  );

  const cancelledCallback = await handleNativeAuthRequest(
    new Request(
      `https://inspirlearning.com/api/auth/callback/google?state=${encodeURIComponent(state)}&error=access_denied`,
      { headers: { cookie: cookiePair } },
    ),
    oauthEnv(database),
  );
  assert.equal(cancelledCallback.status, 302);
  const cancelledLocation = cancelledCallback.headers.get("location");
  assert.ok(cancelledLocation);
  const cancelledURL = new URL(cancelledLocation);
  assert.equal(cancelledURL.pathname, "/fr/chat");
  assert.equal(cancelledURL.searchParams.get("topic"), "biology");
  assert.equal(cancelledURL.searchParams.get("error"), "provider_error");
  assert.match(cancelledCallback.headers.get("set-cookie") ?? "", /better-auth\.state=;/);
  assert.equal(database.prepareCalls, 1);
});

test("native Google OAuth rejects missing or cross-origin initiation and invalid callback state before D1", async () => {
  const crossOriginDatabase = new GuardD1Database();
  const crossOrigin = await handleNativeAuthRequest(
    new Request("https://inspirlearning.com/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": trustedTestIp,
        origin: "https://attacker.invalid",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ provider: "google", callbackURL: "/chat" }),
    }),
    oauthEnv(crossOriginDatabase),
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOriginDatabase.prepareCalls, 0);

  const missingOriginDatabase = new GuardD1Database();
  const missingOrigin = await handleNativeAuthRequest(
    new Request("https://inspirlearning.com/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": trustedTestIp,
      },
      body: JSON.stringify({ provider: "google", callbackURL: "/chat" }),
    }),
    oauthEnv(missingOriginDatabase),
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOriginDatabase.prepareCalls, 0);

  const missingIpDatabase = new GuardD1Database();
  const missingIp = await handleNativeAuthRequest(
    new Request("https://inspirlearning.com/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://inspirlearning.com",
      },
      body: JSON.stringify({ provider: "google", callbackURL: "/chat" }),
    }),
    oauthEnv(missingIpDatabase),
  );
  assert.equal(missingIp.status, 503);
  assert.equal(missingIpDatabase.prepareCalls, 0);

  const callbackDatabase = new GuardD1Database();
  const callback = await handleNativeAuthRequest(
    new Request(
      "https://inspirlearning.com/api/auth/callback/google?state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code=test-code",
    ),
    oauthEnv(callbackDatabase),
  );
  assert.equal(callback.status, 302);
  const callbackLocation = callback.headers.get("location");
  assert.ok(callbackLocation);
  assert.equal(new URL(callbackLocation).searchParams.get("error"), "invalid_state");
  assert.equal(callbackDatabase.prepareCalls, 0);
});

test("native Google initiation atomically caps state writes and fails closed on limiter errors", async () => {
  const limitedDatabase = new OAuthInitiationD1Database("deny");
  const limited = await handleNativeAuthRequest(
    oauthInitiationRequest(),
    oauthEnv(limitedDatabase),
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "3600");
  assert.equal(limited.headers.get("x-ratelimit-limit"), "20");
  assert.equal(limitedDatabase.prepareCalls, 1);
  assert.ok(
    limitedDatabase.statements.every(
      (statement) => !statement.query.includes("insert into verification_tokens"),
    ),
  );

  const failingDatabase = new ThrowingOAuthLimiterD1Database();
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const failed = await handleNativeAuthRequest(
      oauthInitiationRequest(),
      oauthEnv(failingDatabase),
    );
    assert.equal(failed.status, 503);
    assert.ok(
      failingDatabase.statements.every(
        (statement) => !statement.query.includes("insert into verification_tokens"),
      ),
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("Google linking fails closed before account or session writes for ambiguous case-folded emails", async () => {
  const database = new AmbiguousGoogleEmailD1Database();
  const originalConsoleError = console.error;
  const loggedEvents: string[] = [];
  console.error = (value) => loggedEvents.push(String(value));
  try {
    await assert.rejects(
      () => findUniqueGoogleEmailUser(database, "learner@example.com"),
      (error) => error instanceof Error && error.name === "GoogleAccountLinkConflictError",
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.ok(loggedEvents.some((value) => value.includes("native_google_casefold_email_conflict")));
  assert.ok(loggedEvents.every((value) => !value.includes("learner@example.com")));
  assert.ok(database.statements.some((statement) => statement.query.includes("where email = ?1")));
  assert.ok(database.statements.some((statement) => statement.query.includes("where lower(email) = ?1")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into accounts")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into sessions")));
});

test("migration E2E auth requires a 32-byte secret and a trusted Cloudflare client IP", async () => {
  const database = new GuardD1Database();
  const unconfigured = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", { method: "POST" }),
    e2eEnv(database),
  );
  assert.equal(unconfigured.status, 404);
  assert.equal(unconfigured.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");

  const shortConfiguredSecret = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "cf-connecting-ip": trustedTestIp,
        "x-migration-e2e-auth-secret": "short-secret",
      },
    }),
    e2eEnv(database, {
      E2E_TEST_AUTH_SECRET: "short-secret",
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
    }),
  );
  assert.equal(shortConfiguredSecret.status, 404);

  for (const clientIp of [undefined, "not-an-ip"]) {
    const headers = new Headers({ "x-migration-e2e-auth-secret": configuredE2ESecret });
    if (clientIp) headers.set("cf-connecting-ip", clientIp);
    const missingOrInvalidIp = await handleMigrationE2EAuthRequest(
      new Request("https://inspirlearning.com/api/migration/e2e-auth", {
        method: "POST",
        headers,
      }),
      e2eEnv(database, {
        E2E_TEST_AUTH_SECRET: configuredE2ESecret,
        E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
      }),
    );
    assert.equal(missingOrInvalidIp.status, 404);
  }
  assert.equal(database.prepareCalls, 0);
});

test("migration E2E auth rejects wrong secrets without amplifying them into D1 writes", async () => {
  const database = new GuardD1Database();
  const response = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "cf-connecting-ip": trustedTestIp,
        "x-migration-e2e-auth-secret": "wrong-secret",
      },
    }),
    e2eEnv(database, {
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
    }),
  );
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "");
  assert.equal(database.prepareCalls, 0);
});

test("an explicit localhost E2E opt-in creates only an isolated preview user and never mutates admin membership", async () => {
  const database = new SuccessfulE2ED1Database();
  const response = await handleMigrationE2EAuthRequest(
    new Request("http://localhost:8787/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "cf-connecting-ip": trustedTestIp,
        "content-type": "application/json",
        "x-migration-e2e-auth-secret": configuredE2ESecret,
      },
      body: JSON.stringify({ email: configuredE2EEmail }),
    }),
    e2eEnv(database, {
      ADMIN_EMAILS: configuredE2EEmail,
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
      E2E_TEST_AUTH_ALLOW_LOCAL_CREATE: "1",
      E2E_TEST_AUTH_REQUIRE_EXISTING: "0",
    }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /^(?:__Secure-)?better-auth\.session_token=/);
  assert.deepEqual(await response.json(), {
    ok: true,
    user: {
      id: "e2e-user-id",
      email: configuredE2EEmail,
      image: "/icon.png",
      isAdmin: true,
    },
  });
  assert.ok(database.statements.some((statement) => statement.query.includes("insert into users")));
  assert.ok(database.statements.some((statement) => statement.query.includes("insert into sessions")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("rate_limit_windows")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("admin_users")));
});

test("migration E2E auth defaults to existing-user-only even with the local creation capability", async () => {
  const database = new SuccessfulE2ED1Database();
  const response = await handleMigrationE2EAuthRequest(
    new Request("http://localhost:8787/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "cf-connecting-ip": trustedTestIp,
        "content-type": "application/json",
        "x-migration-e2e-auth-secret": configuredE2ESecret,
      },
      body: JSON.stringify({ email: configuredE2EEmail }),
    }),
    e2eEnv(database, {
      ADMIN_EMAILS: configuredE2EEmail,
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
      E2E_TEST_AUTH_ALLOW_LOCAL_CREATE: "1",
    }),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "The configured validation account does not exist.",
  });
  assert.ok(database.statements.some((statement) => statement.query.includes("from users where email = ?1")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into users")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into sessions")));
});

test("migration E2E auth never creates a user on the production origin", async () => {
  const database = new SuccessfulE2ED1Database();
  const response = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "cf-connecting-ip": trustedTestIp,
        "content-type": "application/json",
        "x-migration-e2e-auth-secret": configuredE2ESecret,
      },
      body: JSON.stringify(boundExistingAuthPayload()),
    }),
    e2eEnv(database, {
      ADMIN_EMAILS: configuredE2EEmail,
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
      E2E_TEST_AUTH_ALLOW_LOCAL_CREATE: "1",
      E2E_TEST_AUTH_REQUIRE_EXISTING: "0",
    }),
  );

  assert.equal(response.status, 409);
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into users")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into sessions")));
});

test("migration E2E existing-user guard overrides the localhost creation opt-in", async () => {
  const database = new SuccessfulE2ED1Database();
  const response = await handleMigrationE2EAuthRequest(
    new Request("http://127.0.0.1:8787/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "cf-connecting-ip": trustedTestIp,
        "content-type": "application/json",
        "x-migration-e2e-auth-secret": configuredE2ESecret,
      },
      body: JSON.stringify({ email: configuredE2EEmail }),
    }),
    e2eEnv(database, {
      ADMIN_EMAILS: configuredE2EEmail,
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
      E2E_TEST_AUTH_ALLOW_LOCAL_CREATE: "1",
      E2E_TEST_AUTH_REQUIRE_EXISTING: "1",
    }),
  );

  assert.equal(response.status, 409);
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into users")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into sessions")));
});

test("migration E2E auth reuses an existing user without changing any profile field", async () => {
  const database = new ExistingValidationSessionD1Database();
  const response = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "cf-connecting-ip": trustedTestIp,
        "content-type": "application/json",
        "x-migration-e2e-auth-secret": configuredE2ESecret,
      },
      body: JSON.stringify(boundExistingAuthPayload()),
    }),
    e2eEnv(database, {
      ADMIN_EMAILS: configuredE2EEmail,
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
    }),
  );

  assert.equal(response.status, 200);
  const authenticated = await response.json();
  assertRecord(authenticated);
  assert.equal(authenticated.ok, true);
  assert.equal(authenticated.runtimeVersionId, configuredE2EVersionId);
  assert.deepEqual(authenticated.user, {
    email: configuredE2EEmail,
    isAdmin: true,
  });
  assertRecord(authenticated.validationSession);
  assert.equal(authenticated.validationSession.candidateVersionId, configuredE2EVersionId);
  assert.equal(authenticated.validationSession.runId, configuredE2ERunId);
  assert.equal(authenticated.validationSession.purpose, "production-playwright");
  assert.match(String(authenticated.validationSession.userRef), /^[a-f0-9]{64}$/);
  assert.match(String(authenticated.validationSession.sessionRef), /^[a-f0-9]{64}$/);
  assert.ok(database.statements.some((statement) => statement.query.includes("from users where email = ?1")));
  assert.ok(database.statements.some((statement) => statement.query.includes("insert into sessions")));
  assert.ok(database.statements.every((statement) => !statement.query.includes("insert into users")));
  assert.ok(database.statements.every((statement) => !/update\s+users/i.test(statement.query)));
  assert.ok(database.statements.every((statement) => !statement.query.includes("admin_users")));
});

test("bound existing-account sessions clean exactly after a lost auth response and expired mint window", async () => {
  const database = new ExistingValidationSessionD1Database();
  const env = e2eEnv(database, {
    ADMIN_EMAILS: configuredE2EEmail,
    E2E_TEST_AUTH_SECRET: configuredE2ESecret,
    E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
  });
  const auth = await handleMigrationE2EAuthRequest(
    productionE2ERequest(boundExistingAuthPayload()),
    env,
  );
  assert.equal(auth.status, 200);
  assert.ok(database.session, "auth must persist the deterministic session before its response");

  const expiredRecoveryEnv = {
    ...env,
    E2E_TEST_AUTH_EXPIRES_AT: "1",
    CF_VERSION_METADATA: { id: "33333333-3333-4333-8333-333333333333" },
  };
  const cleanup = await handleMigrationE2EAuthRequest(
    productionE2ERequest(boundExistingCleanupPayload("cleanup-existing-session")),
    expiredRecoveryEnv,
  );
  assert.equal(cleanup.status, 200);
  const cleanupBody = await cleanup.json();
  assertRecord(cleanupBody);
  assert.equal(cleanupBody.ok, true);
  assert.equal(cleanupBody.runtimeVersionId, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(cleanupBody.before, { idRows: 1, exactSessions: 1, markerSessions: 1 });
  assert.deepEqual(cleanupBody.after, { idRows: 0, exactSessions: 0, markerSessions: 0 });
  assert.equal(database.session, null);
  assert.ok(
    database.statements.some(
      (statement) =>
        statement.query.includes("delete from sessions") &&
        statement.query.includes("id = ?1") &&
        statement.query.includes("session_token = ?2") &&
        statement.query.includes("user_id = ?3") &&
        statement.query.includes("user_agent = ?4"),
    ),
  );

  const verified = await handleMigrationE2EAuthRequest(
    productionE2ERequest(boundExistingCleanupPayload("verify-existing-session-cleanup")),
    expiredRecoveryEnv,
  );
  assert.equal(verified.status, 200);
  const verifiedBody = await verified.json();
  assertRecord(verifiedBody);
  assert.equal(verifiedBody.ok, true);
  assert.equal(verifiedBody.runtimeVersionId, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(verifiedBody.after, { idRows: 0, exactSessions: 0, markerSessions: 0 });
});

test("production E2E minting fails hidden before D1 when binding or expiry is absent", async () => {
  for (const [payload, overrides] of [
    [{ email: configuredE2EEmail }, {}],
    [boundExistingAuthPayload(), { CF_VERSION_METADATA: undefined }],
    [boundExistingAuthPayload(), { E2E_TEST_AUTH_EXPIRES_AT: "1" }],
    [boundExistingAuthPayload(), { E2E_TEST_AUTH_EXPIRES_AT: String(Date.now() + 3 * 60 * 60 * 1_000) }],
  ] as const) {
    const database = new GuardD1Database();
    const response = await handleMigrationE2EAuthRequest(
      productionE2ERequest(payload),
      e2eEnv(database, {
        E2E_TEST_AUTH_SECRET: configuredE2ESecret,
        E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
        ...overrides,
      }),
    );
    assert.equal(response.status, 404);
    assert.equal(database.prepareCalls, 0);
  }
});

test("existing-session marker collisions cannot strand a newly inserted validation row", async () => {
  const preexisting = new ExistingValidationSessionD1Database();
  preexisting.externalMarkerSessions = 1;
  const preexistingResponse = await handleMigrationE2EAuthRequest(
    productionE2ERequest(boundExistingAuthPayload()),
    e2eEnv(preexisting, {
      ADMIN_EMAILS: configuredE2EEmail,
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
    }),
  );
  assert.equal(preexistingResponse.status, 409);
  assert.equal(preexisting.session, null);
  assert.ok(preexisting.statements.every((statement) => !statement.query.includes("insert into sessions")));

  const raced = new ExistingValidationSessionD1Database();
  raced.injectMarkerCollisionAfterInsert = true;
  const racedResponse = await handleMigrationE2EAuthRequest(
    productionE2ERequest(boundExistingAuthPayload()),
    e2eEnv(raced, {
      ADMIN_EMAILS: configuredE2EEmail,
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
    }),
  );
  assert.equal(racedResponse.status, 409);
  assert.equal(raced.session, null);
  assert.ok(raced.statements.some((statement) => statement.query.includes("delete from sessions")));

  const afterMint = new ExistingValidationSessionD1Database();
  const afterMintEnv = e2eEnv(afterMint, {
    ADMIN_EMAILS: configuredE2EEmail,
    E2E_TEST_AUTH_SECRET: configuredE2ESecret,
    E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
  });
  assert.equal(
    (await handleMigrationE2EAuthRequest(
      productionE2ERequest(boundExistingAuthPayload()),
      afterMintEnv,
    )).status,
    200,
  );
  afterMint.externalMarkerSessions = 1;
  const cleanup = await handleMigrationE2EAuthRequest(
    productionE2ERequest(boundExistingCleanupPayload("cleanup-existing-session")),
    afterMintEnv,
  );
  assert.equal(cleanup.status, 200);
  const cleanupBody = await cleanup.json();
  assertRecord(cleanupBody);
  assert.equal(cleanupBody.ok, false);
  assert.equal(afterMint.session, null, "exact validation row must still be deleted");
  assert.deepEqual(cleanupBody.after, { idRows: 0, exactSessions: 0, markerSessions: 1 });
});

test("migration E2E auth rejects every email except its configured account and honors write freeze", async () => {
  const database = new GuardD1Database();
  const configured = {
    E2E_TEST_AUTH_SECRET: configuredE2ESecret,
    E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
  } as const;
  const wrongEmail = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": trustedTestIp,
        "x-migration-e2e-auth-secret": configured.E2E_TEST_AUTH_SECRET,
      },
      body: JSON.stringify(boundExistingAuthPayload("someone-else@example.com")),
    }),
    e2eEnv(database, configured),
  );
  assert.equal(wrongEmail.status, 403);
  assert.equal(database.prepareCalls, 0);

  const mutableProfilePayload = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": trustedTestIp,
        "x-migration-e2e-auth-secret": configured.E2E_TEST_AUTH_SECRET,
      },
      body: JSON.stringify({
        ...boundExistingAuthPayload(configured.E2E_TEST_AUTH_EMAIL),
        name: "must not be accepted",
        image: "/must-not-be-accepted.png",
      }),
    }),
    e2eEnv(database, configured),
  );
  assert.equal(mutableProfilePayload.status, 400);
  assert.equal(database.prepareCalls, 0);

  const frozen = await handleMigrationE2EAuthRequest(
    new Request("https://inspirlearning.com/api/migration/e2e-auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": trustedTestIp,
        "x-migration-e2e-auth-secret": configured.E2E_TEST_AUTH_SECRET,
      },
      body: JSON.stringify(boundExistingAuthPayload()),
    }),
    e2eEnv(database, { ...configured, APP_WRITE_FREEZE: "true" }),
  );
  assert.equal(frozen.status, 503);
  assert.equal(frozen.headers.get("retry-after"), "300");
  assert.deepEqual(await frozen.json(), {
    error: "The service is temporarily read-only while a migration is in progress.",
    code: "write_freeze_active",
    surface: "migration-e2e-auth",
  });
  assert.equal(database.prepareCalls, 0);
});

test("write freeze blocks migration cleanup mutations but keeps verification actions read-only", async () => {
  const mutationDatabase = new GuardD1Database();
  const frozenEnv = e2eEnv(mutationDatabase, {
    APP_WRITE_FREEZE: "true",
    E2E_TEST_AUTH_SECRET: configuredE2ESecret,
    E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
  });
  const cleanupPayloads = [
    boundExistingCleanupPayload("cleanup-existing-session"),
    {
      action: "cleanup-disposable",
      runId: configuredE2ERunId,
      candidateVersionId: configuredE2EVersionId,
      userId: "33333333-3333-4333-8333-333333333333",
    },
  ] as const;
  for (const payload of cleanupPayloads) {
    const response = await handleMigrationE2EAuthRequest(
      productionE2ERequest(payload),
      frozenEnv,
    );
    assert.equal(response.status, 503, payload.action);
    assert.deepEqual(await response.json(), {
      error: "The service is temporarily read-only while a migration is in progress.",
      code: "write_freeze_active",
      surface: "migration-e2e-auth",
    });
  }
  assert.equal(mutationDatabase.prepareCalls, 0);

  const verificationDatabase = new GuardD1Database();
  const verification = await handleMigrationE2EAuthRequest(
    productionE2ERequest(boundExistingCleanupPayload("verify-existing-session-cleanup")),
    e2eEnv(verificationDatabase, {
      APP_WRITE_FREEZE: "true",
      E2E_TEST_AUTH_SECRET: configuredE2ESecret,
      E2E_TEST_AUTH_EMAIL: configuredE2EEmail,
    }),
  );
  assert.equal(verification.status, 409);
  assert.ok(verificationDatabase.prepareCalls > 0);
});

test("native account runtime excludes Next and preserves migrated Google account linking", () => {
  const source = fs.readFileSync(path.resolve("lib/free-runtime/account-api.ts"), "utf8");
  const sessionSource = fs.readFileSync(path.resolve("lib/free-runtime/native-session.ts"), "utf8");
  assert.doesNotMatch(source, /next\/server|\.open-next|@opennextjs|nextCookies|refreshProfilePhoto/);
  assert.doesNotMatch(source, /from "better-auth/);
  assert.match(source, /googleAuthorizationEndpoint/);
  assert.match(source, /code_challenge_method", "S256"/);
  assert.equal((source.match(/insert into verification_tokens/gi) ?? []).length, 1);
  assert.match(
    source,
    /insert into verification_tokens \([\s\S]{0,260}identity\.markerToken/,
  );
  assert.doesNotMatch(source, /update verification_tokens/i);
  assert.match(source, /delete from verification_tokens where identifier = \?1/);
  assert.match(source, /parseNativeOAuthStateCookie/);
  assert.match(source, /constantTimeStringEqual\(clientId, expectedClientId\)/);
  assert.match(source, /crypto\.subtle\.verify/);
  assert.doesNotMatch(source, /pendingGoogleJwks/);
  assert.match(source, /Never retain an in-flight fetch promise across Worker requests/);
  assert.match(source, /googleTokenEndpoint,[\s\S]{0,500}AbortSignal\.timeout\(15_000\)/);
  assert.match(source, /googleJwksEndpoint,[\s\S]{0,200}AbortSignal\.timeout\(10_000\)/);
  assert.match(source, /claims\.email_verified !== true/);
  assert.match(source, /issuer !== "https:\/\/accounts\.google\.com"/);
  assert.match(source, /authorizedPartyMatches/);
  assert.match(source, /isStrictOAuthInitiationOrigin/);
  assert.match(source, /oauthInitiationRateLimitKey/);
  assert.match(source, /rate_limit_windows\.count < \?4/);
  assert.match(source, /PROFILE_IMAGES_R2_BUCKET/);
  assert.match(source, /handleAccountApiRequest/);
  assert.match(source, /isAuthenticationWrite/);
  assert.match(source, /prewarmAccountApi/);
  assert.match(source, /nativeAuthHmacHex\("native-account-prewarm", env\.AUTH_SECRET\)/);
  assert.match(source, /handleMigrationE2EAuthRequest/);
  assert.match(source, /x-migration-e2e-auth-secret/);
  assert.match(source, /on conflict\(email\) do nothing/);
  assert.match(source, /on conflict\(provider, provider_account_id\) do update set/);
  assert.doesNotMatch(
    source,
    /on conflict\(provider, provider_account_id\) do update set[\s\S]{0,500}user_id\s*=/,
  );
  assert.match(source, /insert into rate_limit_windows/);
  assert.match(source, /rate_limit_windows\.count < \?4/);
  assert.doesNotMatch(source, /recordFailedE2EAuthAttempt|failedE2EAuthRateLimitKey/);
  assert.doesNotMatch(source, /insert into admin_users|upsertE2EAdmin|E2E_TEST_AUTH_IS_ADMIN/);
  assert.match(source, /findOrCreateE2EAuthUser/);
  assert.match(source, /E2E_TEST_AUTH_REQUIRE_EXISTING/);
  assert.match(source, /E2E_TEST_AUTH_ALLOW_LOCAL_CREATE/);
  assert.match(source, /E2E_TEST_AUTH_REQUIRE_EXISTING === "0"/);
  assert.match(source, /isLocalE2EAuthRequest/);
  assert.match(source, /select id, name, email, image from users where email = \?1 limit 1/);
  assert.match(source, /on conflict\(email\) do nothing/);
  assert.doesNotMatch(
    source,
    /insert into users[\s\S]{0,600}on conflict\(email\) do update/,
  );
  assert.doesNotMatch(source, /MIGRATION_E2E_AUTH_SECRET|MIGRATION_E2E_AUTH_EMAIL/);

  const workerSource = fs.readFileSync(path.resolve("cloudflare-worker.ts"), "utf8");
  assert.match(workerSource, /await prewarmAccountApi\(workerEnv\)/);
  assert.doesNotMatch(source, /auth\.\$context|better-auth\/minimal/);
  assert.doesNotMatch(sessionSource, /pendingHmacKey|Promise<CryptoKey>/);
  assert.match(sessionSource, /Cache only the resolved key/);
});

test("the dormant Next migration-auth route cannot revive mutable test accounts", () => {
  const source = fs.readFileSync(
    path.resolve("app/api/migration/e2e-auth/route.ts"),
    "utf8",
  );
  assert.match(source, /status: 404/);
  assert.match(source, /private, no-cache, no-store/);
  assert.doesNotMatch(
    source,
    /insert\(users\)|addAdminUser|E2E_TEST_AUTH_IS_ADMIN|MIGRATION_E2E_AUTH|onConflictDoUpdate/,
  );
});

function oauthEnv(
  database: D1Database,
  overrides: Partial<NativeAuthEnv> = {},
): NativeAuthEnv {
  return {
    DB: database,
    AUTH_SECRET: testSecret,
    ADMIN_EMAILS: "",
    APP_URL: "https://inspirlearning.com",
    AUTH_URL: "https://inspirlearning.com/api/auth",
    BETTER_AUTH_URL: "https://inspirlearning.com/api/auth",
    AUTH_GOOGLE_ID: "google-client-id",
    AUTH_GOOGLE_SECRET: "google-client-secret",
    APP_WRITE_FREEZE: "0",
    APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
    ...overrides,
  };
}

function oauthInitiationRequest() {
  return new Request("https://inspirlearning.com/api/auth/sign-in/social", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": trustedTestIp,
      origin: "https://inspirlearning.com",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ provider: "google", callbackURL: "/chat" }),
  });
}

function e2eEnv(
  database: D1Database,
  overrides: Partial<MigrationE2EAuthEnv> = {},
): MigrationE2EAuthEnv {
  return {
    DB: database,
    AUTH_SECRET: testSecret,
    ADMIN_EMAILS: "",
    APP_WRITE_FREEZE: "0",
    APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
    E2E_TEST_MUTATION_RUN_ID: configuredE2ERunId,
    E2E_TEST_AUTH_EXPIRES_AT: configuredE2EExpiresAt,
    CF_VERSION_METADATA: { id: configuredE2EVersionId },
    ...overrides,
  };
}

function boundExistingAuthPayload(email = configuredE2EEmail) {
  return {
    action: "authenticate-existing",
    email,
    runId: configuredE2ERunId,
    candidateVersionId: configuredE2EVersionId,
    sessionPurpose: "production-playwright",
  } as const;
}

function boundExistingCleanupPayload(
  action: "cleanup-existing-session" | "verify-existing-session-cleanup",
) {
  return {
    action,
    runId: configuredE2ERunId,
    candidateVersionId: configuredE2EVersionId,
    sessionPurpose: "production-playwright",
  } as const;
}

function productionE2ERequest(payload: unknown) {
  return new Request("https://inspirlearning.com/api/migration/e2e-auth", {
    method: "POST",
    headers: {
      "cf-connecting-ip": trustedTestIp,
      "content-type": "application/json",
      "x-migration-e2e-auth-secret": configuredE2ESecret,
    },
    body: JSON.stringify(payload),
  });
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
}

function testBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeTestBase64UrlJson(value: string): unknown {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

class GuardD1Database implements D1Database {
  prepareCalls = 0;
  readonly statements: EmptyD1Statement[] = [];

  prepare(query: string) {
    this.prepareCalls += 1;
    const statement = new EmptyD1Statement(query);
    this.statements.push(statement);
    return statement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.all<T>()));
  }

  async exec() {
    return { count: 0, duration: 0 };
  }

  withSession() {
    return new EmptyD1Session();
  }

  async dump() {
    return new ArrayBuffer(0);
  }
}

class OAuthInitiationD1Database extends GuardD1Database {
  constructor(private readonly result: "allow" | "deny") {
    super();
  }

  prepare(query: string) {
    this.prepareCalls += 1;
    const statement = new OAuthInitiationD1Statement(query, this.result);
    this.statements.push(statement);
    return statement;
  }
}

class ThrowingOAuthLimiterD1Database extends GuardD1Database {
  prepare(query: string) {
    if (query.includes("insert into rate_limit_windows")) {
      throw new Error("simulated OAuth limiter failure");
    }
    return super.prepare(query);
  }
}

class AmbiguousGoogleEmailD1Database extends GuardD1Database {
  prepare(query: string) {
    this.prepareCalls += 1;
    const statement = new AmbiguousGoogleEmailD1Statement(query);
    this.statements.push(statement);
    return statement;
  }
}

class SuccessfulE2ED1Database extends GuardD1Database {
  prepare(query: string) {
    if (query.includes("rate_limit_windows")) {
      throw new Error("exact credentials must not consume the failed-attempt limiter");
    }
    this.prepareCalls += 1;
    const statement = new SuccessfulE2ED1Statement(query);
    this.statements.push(statement);
    return statement;
  }
}

type StoredExistingValidationSession = {
  id: string;
  token: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  ipAddress: string | null;
  userAgent: string;
};

class ExistingValidationSessionD1Database extends GuardD1Database {
  session: StoredExistingValidationSession | null = null;
  externalMarkerSessions = 0;
  injectMarkerCollisionAfterInsert = false;

  prepare(query: string) {
    this.prepareCalls += 1;
    const statement = new ExistingValidationSessionD1Statement(query, this);
    this.statements.push(statement);
    return statement;
  }
}

class SessionD1Database extends GuardD1Database {
  sessionRefreshUpdates = 0;
  readonly updatedAt: number;
  readonly expiresAt: number;

  constructor(input: { updatedAt: number; expiresAt: number }) {
    super();
    this.updatedAt = input.updatedAt;
    this.expiresAt = input.expiresAt;
  }

  prepare(query: string) {
    this.prepareCalls += 1;
    const statement = new SessionD1Statement(query, this);
    this.statements.push(statement);
    return statement;
  }
}

class LogoutD1Database extends GuardD1Database {
  deletedToken: unknown = null;

  constructor(private readonly changes: 0 | 1) {
    super();
  }

  prepare(query: string) {
    assert.equal(query, "delete from sessions where session_token = ?1");
    this.prepareCalls += 1;
    const statement = new LogoutD1Statement(query, this, this.changes);
    this.statements.push(statement);
    return statement;
  }
}

class EmptyD1Session implements D1DatabaseSession {
  prepare(query: string) {
    return new EmptyD1Statement(query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.all<T>()));
  }

  getBookmark() {
    return null;
  }
}

class EmptyD1Statement implements D1PreparedStatement {
  boundValues: unknown[] = [];

  constructor(readonly query: string) {}

  bind(...values: unknown[]) {
    this.boundValues = values;
    return this;
  }

  first<T = unknown>(_columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    return null;
  }

  async run<T = Record<string, unknown>>() {
    return emptyD1Result<T>();
  }

  async all<T = Record<string, unknown>>() {
    return emptyD1Result<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
    if (options?.columnNames) {
      const rows: [string[], ...T[]] = [[]];
      return rows;
    }
    const rows: T[] = [];
    return rows;
  }
}

class SuccessfulE2ED1Statement extends EmptyD1Statement {
  first<T = unknown>(_columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    if (!this.query.includes("insert into users")) return null;
    const email = this.boundValues[1];
    return {
      id: "e2e-user-id",
      name: "Inspir E2E",
      email: typeof email === "string" ? email : configuredE2EEmail,
      image: "/icon.png",
    };
  }

  async run<T = Record<string, unknown>>() {
    return emptyD1Result<T>(1);
  }
}

class ExistingValidationSessionD1Statement extends EmptyD1Statement {
  constructor(
    query: string,
    private readonly database: ExistingValidationSessionD1Database,
  ) {
    super(query);
  }

  first<T = unknown>(_columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    if (this.query.includes("from users where email = ?1")) {
      return {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Existing learner name",
        email: configuredE2EEmail,
        image: "https://images.example/existing-avatar.png",
      };
    }
    if (this.query.includes("insert into sessions") && this.query.includes("returning id")) {
      if (this.database.session) return null;
      const [id, token, userId, expiresAt, createdAt, ipAddress, userAgent] = this.boundValues;
      if (
        typeof id !== "string" ||
        typeof token !== "string" ||
        typeof userId !== "string" ||
        typeof expiresAt !== "number" ||
        typeof createdAt !== "number" ||
        (ipAddress !== null && typeof ipAddress !== "string") ||
        typeof userAgent !== "string"
      ) {
        throw new Error("Invalid deterministic session fixture binding.");
      }
      this.database.session = {
        id,
        token,
        userId,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
        ipAddress,
        userAgent,
      };
      if (this.database.injectMarkerCollisionAfterInsert) {
        this.database.externalMarkerSessions += 1;
      }
      return { id };
    }
    if (this.query.includes("from sessions where id = ?1 limit 1")) {
      const session = this.database.session;
      return session
        ? {
            id: session.id,
            session_token: session.token,
            user_id: session.userId,
            expires: session.expiresAt,
            created_at: session.createdAt,
            updated_at: session.updatedAt,
            ip_address: session.ipAddress,
            user_agent: session.userAgent,
          }
        : null;
    }
    if (this.query.includes("as id_rows") && this.query.includes("as marker_sessions")) {
      const session = this.database.session;
      if (!session) {
        return {
          id_rows: 0,
          exact_sessions: 0,
          marker_sessions: this.database.externalMarkerSessions,
        };
      }
      const [id, token, userId, userAgent] = this.boundValues;
      const exact = session.id === id &&
        session.token === token &&
        session.userId === userId &&
        session.userAgent === userAgent;
      return {
        id_rows: session.id === id ? 1 : 0,
        exact_sessions: exact ? 1 : 0,
        marker_sessions:
          this.database.externalMarkerSessions +
          (session.userId === userId && session.userAgent === userAgent ? 1 : 0),
      };
    }
    return null;
  }

  async run<T = Record<string, unknown>>() {
    if (this.query.includes("delete from sessions")) {
      const session = this.database.session;
      const [id, token, userId, userAgent] = this.boundValues;
      if (
        session &&
        session.id === id &&
        session.token === token &&
        session.userId === userId &&
        session.userAgent === userAgent
      ) {
        this.database.session = null;
        return emptyD1Result<T>(1);
      }
    }
    return emptyD1Result<T>();
  }
}

class OAuthInitiationD1Statement extends EmptyD1Statement {
  constructor(query: string, private readonly result: "allow" | "deny") {
    super(query);
  }

  first<T = unknown>(_columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    if (!this.query.includes("insert into rate_limit_windows") || this.result === "deny") {
      return null;
    }
    return { count: 1 };
  }
}

class AmbiguousGoogleEmailD1Statement extends EmptyD1Statement {
  first<T = unknown>(_columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    return null;
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  async all() {
    if (!this.query.includes("where lower(email) = ?1")) {
      return emptyD1Result<Record<string, unknown>>();
    }
    return {
      ...emptyD1Result<Record<string, unknown>>(),
      results: [
        { id: "legacy-upper", email: "Learner@example.com" },
        { id: "legacy-lower", email: "LEARNER@example.com" },
      ],
    };
  }
}

class SessionD1Statement extends EmptyD1Statement {
  constructor(query: string, private readonly database: SessionD1Database) {
    super(query);
  }

  first<T = unknown>(_columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    if (!this.query.includes("from sessions s")) return null;
    return {
      session_id: "session-row-id",
      session_token: testToken,
      user_id: "user-row-id",
      expires: this.database.expiresAt,
      session_created_at: this.database.updatedAt - 1_000,
      session_updated_at: this.database.updatedAt,
      ip_address: null,
      user_agent: "account-api-test",
      user_name: "Test Learner",
      user_email: "test@example.com",
      user_email_verified: 1,
      user_image: null,
      user_created_at: this.database.updatedAt - 2_000,
      user_updated_at: this.database.updatedAt,
    };
  }

  async run<T = Record<string, unknown>>() {
    if (this.query.includes("update sessions")) this.database.sessionRefreshUpdates += 1;
    return emptyD1Result<T>(1);
  }
}

class LogoutD1Statement extends EmptyD1Statement {
  constructor(
    query: string,
    private readonly database: LogoutD1Database,
    private readonly changes: 0 | 1,
  ) {
    super(query);
  }

  async run<T = Record<string, unknown>>() {
    this.database.deletedToken = this.boundValues[0];
    return emptyD1Result<T>(this.changes);
  }
}

function emptyD1Result<T>(changes = 0): D1Result<T> {
  return {
    success: true,
    meta: {
      served_by: "account-api-test",
      duration: 0,
      changes,
      last_row_id: 0,
      changed_db: false,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
    },
    results: [],
  };
}
