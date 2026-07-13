import { supportedLanguages } from "@/lib/content/languages";
import { calculateAge, validateDateOfBirth } from "@/lib/profile/age";
import {
  isOversizedProfileImageUpload,
  prepareProfileImage,
} from "@/lib/profile/photo";
import {
  isValidProfileImageObjectKey,
  profileImageObjectKey,
  profileImageUserHash,
} from "@/lib/profile/photo-key";
import {
  appendNativeSessionRefresh,
  buildNativeSessionCookie,
  expireNativeAuthCookies,
  isNativeAdmin,
  nativeAuthHmacHex,
  privateNoStoreHeaders,
  readVerifiedNativeSessionToken,
  requireNativeSession,
  signNativeAuthValue,
  verifyNativeAuthValue,
  type NativeAuthenticatedSession,
  type NativeSessionEnv,
} from "@/lib/free-runtime/native-session";

export type NativeAuthEnv = NativeSessionEnv &
  Pick<
    CloudflareEnv,
    | "APP_URL"
    | "AUTH_URL"
    | "BETTER_AUTH_URL"
    | "AUTH_GOOGLE_ID"
    | "AUTH_GOOGLE_SECRET"
    | "APP_WRITE_FREEZE"
    | "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS"
  >;

export type AccountApiEnv = NativeAuthEnv &
  Pick<CloudflareEnv, "PROFILE_IMAGES_R2_BUCKET"> & {
    E2E_TEST_AUTH_SECRET?: string;
    E2E_TEST_AUTH_EMAIL?: string;
    E2E_TEST_AUTH_REQUIRE_EXISTING?: string;
    E2E_TEST_AUTH_ALLOW_LOCAL_CREATE?: string;
    E2E_TEST_MUTATION_RUN_ID?: string;
    E2E_TEST_AUTH_EXPIRES_AT?: string;
  };

export type MigrationE2EAuthEnv = NativeSessionEnv &
  Pick<AccountApiEnv, "APP_WRITE_FREEZE" | "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS"> & {
    E2E_TEST_AUTH_SECRET?: string;
    E2E_TEST_AUTH_EMAIL?: string;
    E2E_TEST_AUTH_REQUIRE_EXISTING?: string;
    E2E_TEST_AUTH_ALLOW_LOCAL_CREATE?: string;
    E2E_TEST_MUTATION_RUN_ID?: string;
    E2E_TEST_AUTH_EXPIRES_AT?: string;
    CF_VERSION_METADATA?: Pick<WorkerVersionMetadata, "id">;
  };

type ProfileRow = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  score: number;
  preferred_language: string;
  date_of_birth: string | null;
  created_at: number;
  profile_image_mime: string | null;
  profile_image_hash: string | null;
  profile_image_r2_key: string | null;
  profile_image_r2_etag: string | null;
  profile_image_size: number | null;
};

type ProfilePatch = {
  name?: string;
  preferredLanguage?: string;
  dateOfBirth?: string | null;
};

export const E2E_EXISTING_SESSION_PURPOSES = [
  "production-playwright",
  "production-outcome-soak",
] as const;

export type E2EExistingSessionPurpose =
  (typeof E2E_EXISTING_SESSION_PURPOSES)[number];

type E2EUnboundExistingAuthPayload = {
  action: "authenticate-existing";
  email?: string;
};

type E2EBoundExistingAuthPayload = {
  action: "authenticate-existing";
  email?: string;
  runId: string;
  candidateVersionId: string;
  sessionPurpose: E2EExistingSessionPurpose;
};

type E2EAuthPayload =
  | E2EUnboundExistingAuthPayload
  | E2EBoundExistingAuthPayload
  | {
      action: "cleanup-existing-session" | "verify-existing-session-cleanup";
      runId: string;
      candidateVersionId: string;
      sessionPurpose: E2EExistingSessionPurpose;
    }
  | { action: "create-disposable"; runId: string; candidateVersionId: string }
  | {
      action: "cleanup-disposable" | "verify-disposable-cleanup";
      runId: string;
      candidateVersionId: string;
      userId: string;
    };

type E2EAuthUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
};

type E2EAuthSession = {
  id: string;
  token: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  ipAddress: string | null;
  userAgent: string | null;
};

type ExistingValidationSessionIdentity = {
  candidateVersionId: string;
  runId: string;
  purpose: E2EExistingSessionPurpose;
  sessionId: string;
  sessionToken: string;
  userAgent: string;
};

type ExistingValidationSessionInventory = {
  idRows: number;
  exactSessions: number;
  markerSessions: number;
};

type NativeGoogleSignInPayload = {
  provider: "google";
  callbackURL?: string;
  disableRedirect?: boolean;
};

type NativeOAuthState = {
  callbackURL: string;
  clientId: string;
  codeVerifier: string;
  expiresAt: number;
  oauthState: string;
};

type OAuthRateLimitRow = {
  count: number;
};

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string;
  accessTokenExpiresAt: number | null;
  scope: string | null;
};

export type GoogleIdentity = {
  subject: string;
  email: string;
  name: string | null;
  image: string | null;
};

type GoogleAccountUserRow = {
  user_id: string;
};

type GoogleEmailUserRow = {
  id: string;
  email: string;
};

class GoogleAccountLinkConflictError extends Error {
  constructor() {
    super("The verified Google email matches more than one existing user.");
    this.name = "GoogleAccountLinkConflictError";
  }
}

type GoogleJwk = JsonWebKey & {
  kid: string;
  kty: "RSA";
  alg: "RS256";
  use?: "sig";
  n: string;
  e: string;
};

type CachedGoogleJwks = {
  expiresAt: number;
  keys: readonly GoogleJwk[];
};

let cachedGoogleJwks: CachedGoogleJwks | null = null;
const cachedGoogleVerificationKeys = new Map<string, { expiresAt: number; key: CryptoKey }>();

const profileJsonLimit = 16_384;
const authenticationBodyLimit = 32_768;
const googleTokenResponseLimit = 64 * 1_024;
const googleJwksResponseLimit = 128 * 1_024;
const e2eAuthBodyLimit = 8_192;
const e2eSessionDurationMs = 60 * 60 * 1_000;
const e2eCapabilityMaximumFutureMs = 2 * 60 * 60 * 1_000;
const e2eDisposableDomain = "inspirlearning.invalid";
const e2eDisposableInventoryLimit = 500;
const oauthInitiationWindowMs = 60 * 60 * 1_000;
const oauthInitiationLimit = 20;
const nativeSessionDurationMs = 30 * 24 * 60 * 60 * 1_000;
const oauthStateDurationMs = 5 * 60 * 1_000;
const oauthStateCookieDurationSeconds = 5 * 60;
const googleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleJwksEndpoint = "https://www.googleapis.com/oauth2/v3/certs";
const writeFreezeValues = new Set(["1", "true", "yes", "on"]);

export const E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES = [
  "users",
  "profile_photo_pointers",
  "accounts",
  "sessions",
  "verification_tokens",
  "rate_limit_windows",
  "admin_users",
  "product_events",
  "ops_events",
  "chats",
  "messages",
  "activity_runs",
  "ai_runs",
  "user_memory_settings",
  "user_memories",
  "chat_memory_summaries",
  "chat_memory_turns",
  "user_memory_profiles",
  "user_memory_summaries",
  "memory_synthesis_runs",
  "memory_source_feedback",
  "memory_events",
  "memory_vector_cleanup_outbox",
] as const;

export type E2EDisposableMutationInventoryName =
  (typeof E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES)[number];

export type E2EDisposableMutationInventory = Record<
  E2EDisposableMutationInventoryName,
  number
>;

export async function handleAccountApiRequest(
  request: Request,
  env: AccountApiEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return handleNativeAuthRequest(request, env);
  }
  if (pathname === "/api/migration/e2e-auth") return handleMigrationE2EAuthRequest(request, env);
  if (pathname === "/api/logout") return handleLogout(request, env);
  if (pathname === "/api/me") return handleProfile(request, env);
  if (pathname === "/api/me/photo") return handleProfilePhoto(request, env, ctx);
  return null;
}

export async function prewarmAccountApi(env: AccountApiEnv) {
  if (!env.AUTH_SECRET) return false;
  // Prime only the immutable Web Crypto key at isolate startup. This moves the
  // first import off the Free-plan request CPU path without retaining a
  // request-scoped promise or performing network/storage I/O.
  await nativeAuthHmacHex("native-account-prewarm", env.AUTH_SECRET);
  return authConfigurationAvailable(env);
}

export async function handleNativeAuthRequest(request: Request, env: NativeAuthEnv) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/auth/get-session") return handleNativeGetSession(request, env);
  if (pathname === "/api/auth/sign-out") return handleLogout(request, env);
  if (!authConfigurationAvailable(env)) return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503);
  if (isAuthenticationWrite(request) && isWriteFreezeEnabled(env)) {
    return writeFreezeResponse(env, "auth") ?? jsonResponse({ error: "Authentication is temporarily unavailable." }, 503);
  }

  try {
    if (pathname === "/api/auth/sign-in/social") return await handleNativeGoogleSignIn(request, env);
    if (pathname === "/api/auth/callback/google") return await handleNativeGoogleCallback(request, env);
    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "native_auth_request_failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503);
  }
}

async function handleNativeGetSession(request: Request, env: NativeAuthEnv) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!env.AUTH_SECRET) return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503);
  const disableRefresh = new URL(request.url).searchParams.get("disableRefresh") === "true";
  const session = await requireNativeSession(request, env, { refresh: !disableRefresh });
  if (!session) {
    const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
    return new Response("null", { status: 200, headers });
  }
  return jsonResponse(
    {
      session: session.session,
      user: session.user,
    },
    200,
    session,
  );
}

async function handleNativeGoogleSignIn(request: Request, env: NativeAuthEnv) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isStrictOAuthInitiationOrigin(request)) return jsonResponse({ error: "Forbidden" }, 403);

  const value = await readBoundedJson(request, authenticationBodyLimit);
  const payload = parseNativeGoogleSignInPayload(value);
  if (!payload) return jsonResponse({ error: "Invalid social sign-in request." }, 400);
  const callbackURL = normalizeOAuthCallbackURL(payload.callbackURL ?? "/chat", request, env);
  if (!callbackURL) return jsonResponse({ error: "Invalid callback URL." }, 400);
  const clientId = boundedString(env.AUTH_GOOGLE_ID, 1, 512);
  if (!clientId) return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503);
  const clientIp = trustedConnectingIp(request.headers.get("cf-connecting-ip"));
  if (!clientIp) {
    return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503);
  }

  const now = Date.now();
  const initiationAllowed = await consumeOAuthInitiationLimit(
    env.DB,
    env.AUTH_SECRET,
    clientIp,
    now,
  );
  if (!initiationAllowed) return oauthRateLimitResponse(now);

  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const stateData: NativeOAuthState = {
    callbackURL,
    clientId,
    codeVerifier,
    expiresAt: now + oauthStateDurationMs,
    oauthState: state,
  };
  const stateCookiePayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(stateData)),
  );

  const redirectURI = `${new URL(authBaseUrl(env)).origin}/api/auth/callback/google`;
  const authorizationURL = new URL(googleAuthorizationEndpoint);
  authorizationURL.searchParams.set("client_id", clientId);
  authorizationURL.searchParams.set("redirect_uri", redirectURI);
  authorizationURL.searchParams.set("response_type", "code");
  authorizationURL.searchParams.set("scope", "email profile openid");
  authorizationURL.searchParams.set("state", state);
  authorizationURL.searchParams.set("code_challenge", codeChallenge);
  authorizationURL.searchParams.set("code_challenge_method", "S256");
  authorizationURL.searchParams.set("access_type", "offline");
  authorizationURL.searchParams.set("prompt", "select_account");
  authorizationURL.searchParams.set("include_granted_scopes", "true");

  const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
  headers.append(
    "set-cookie",
    await buildNativeAuthCookie(
      request.url,
      "state",
      await signNativeAuthValue(stateCookiePayload, env.AUTH_SECRET),
      oauthStateCookieDurationSeconds,
    ),
  );
  if (!payload.disableRedirect) headers.set("location", authorizationURL.toString());
  return new Response(
    JSON.stringify({
      url: authorizationURL.toString(),
      redirect: !payload.disableRedirect,
    }),
    { status: 200, headers },
  );
}

async function consumeOAuthInitiationLimit(
  db: D1Database,
  secret: string,
  clientIp: string,
  now: number,
) {
  const key = await oauthInitiationRateLimitKey(secret, clientIp);
  const row = await db
    .prepare(
      `insert into rate_limit_windows ("key", count, reset_at, created_at, updated_at)
       values (?1, 1, ?2, ?3, ?3)
       on conflict ("key") do update set
         count = case when rate_limit_windows.reset_at <= ?3 then 1 else rate_limit_windows.count + 1 end,
         reset_at = case when rate_limit_windows.reset_at <= ?3 then excluded.reset_at else rate_limit_windows.reset_at end,
         updated_at = excluded.updated_at
       where rate_limit_windows.reset_at <= ?3 or rate_limit_windows.count < ?4
       returning count`,
    )
    .bind(key, now + oauthInitiationWindowMs, now, oauthInitiationLimit)
    .first<OAuthRateLimitRow>();
  if (!row) return false;
  if (!Number.isInteger(row.count) || row.count <= 0 || row.count > oauthInitiationLimit) {
    throw new Error("OAuth initiation limiter returned an invalid result.");
  }
  return true;
}

async function oauthInitiationRateLimitKey(secret: string, clientIp: string) {
  const digest = await nativeAuthHmacHex(`native-google-oauth-initiation:${clientIp}`, secret);
  return `native-google-oauth-initiation:${digest}`;
}

function oauthRateLimitResponse(now: number) {
  const retryAfterSeconds = Math.ceil(oauthInitiationWindowMs / 1_000);
  return new Response(
    JSON.stringify({ error: "Too many sign-in attempts. Please try again later." }),
    {
      status: 429,
      headers: privateNoStoreHeaders({
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfterSeconds),
        "x-ratelimit-limit": String(oauthInitiationLimit),
        "x-ratelimit-reset": String(Math.ceil((now + oauthInitiationWindowMs) / 1_000)),
      }),
    },
  );
}

async function handleNativeGoogleCallback(request: Request, env: NativeAuthEnv) {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const url = new URL(request.url);
  const state = boundedOAuthParameter(url.searchParams.get("state"), 16, 256);
  const fallbackURL = safeAuthFallbackURL(request, env);
  if (!state || !/^[A-Za-z0-9_-]+$/.test(state)) {
    return oauthRedirectResponse(fallbackURL, "invalid_state");
  }

  const signedState = readNativeAuthCookie(request, "state");
  const encodedStateData = signedState
    ? await verifyNativeAuthValue(signedState, env.AUTH_SECRET)
    : null;
  const stateData = encodedStateData
    ? parseNativeOAuthStateCookie(encodedStateData, state, env.AUTH_GOOGLE_ID)
    : null;
  if (!stateData) {
    return oauthRedirectResponse(fallbackURL, "invalid_state");
  }
  const callbackURL = normalizeOAuthCallbackURL(stateData.callbackURL, request, env) ?? fallbackURL;
  if (url.searchParams.has("error")) {
    return oauthRedirectResponse(callbackURL, "provider_error");
  }
  const code = boundedOAuthParameter(url.searchParams.get("code"), 1, 4_096);
  if (!code) return oauthRedirectResponse(callbackURL, "missing_code");

  try {
    const tokenSet = await exchangeGoogleAuthorizationCode(code, stateData.codeVerifier, env);
    const identity = await verifyGoogleIdentity(tokenSet.idToken, env.AUTH_GOOGLE_ID);
    if (!identity) return oauthRedirectResponse(callbackURL, "identity_verification_failed");
    const userId = await linkVerifiedGoogleIdentity(env.DB, identity, tokenSet);
    const session = await createNativeOAuthSession(request, env.DB, userId);
    const headers = privateNoStoreHeaders({ location: callbackURL });
    expireNativeOAuthStateCookies(headers);
    headers.append(
      "set-cookie",
      await buildNativeSessionCookie(session.token, env.AUTH_SECRET, request.url, session.expiresAt),
    );
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "native_google_callback_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return oauthRedirectResponse(
      callbackURL,
      error instanceof GoogleAccountLinkConflictError
        ? "unable_to_link_account"
        : "oauth_callback_failed",
    );
  }
}

function parseNativeGoogleSignInPayload(value: unknown): NativeGoogleSignInPayload | null {
  if (!isRecord(value) || value.provider !== "google") return null;
  if (value.callbackURL !== undefined && typeof value.callbackURL !== "string") return null;
  if (value.disableRedirect !== undefined && typeof value.disableRedirect !== "boolean") return null;
  return {
    provider: "google",
    ...(typeof value.callbackURL === "string" ? { callbackURL: value.callbackURL } : {}),
    ...(typeof value.disableRedirect === "boolean" ? { disableRedirect: value.disableRedirect } : {}),
  };
}

function parseNativeOAuthStateCookie(
  encodedStateData: string,
  expectedState: string,
  expectedClientId: string,
) {
  const value = parseBase64UrlJson(encodedStateData, 2_048);
  if (!isRecord(value)) return null;
  const callbackURL = boundedString(value.callbackURL, 1, 1_024);
  const clientId = boundedString(value.clientId, 1, 512);
  const codeVerifier = boundedString(value.codeVerifier, 43, 256);
  const expiresAt = finiteInteger(value.expiresAt);
  const oauthState = boundedString(value.oauthState, 16, 256);
  const now = Date.now();
  if (
    !callbackURL ||
    !clientId ||
    !constantTimeStringEqual(clientId, expectedClientId) ||
    !codeVerifier ||
    !/^[A-Za-z0-9._~-]+$/.test(codeVerifier) ||
    !expiresAt ||
    expiresAt < now ||
    expiresAt > now + oauthStateDurationMs ||
    !oauthState ||
    !constantTimeStringEqual(oauthState, expectedState)
  ) {
    return null;
  }
  return { callbackURL, clientId, codeVerifier, expiresAt, oauthState } satisfies NativeOAuthState;
}

function normalizeOAuthCallbackURL(value: string, request: Request, env: NativeAuthEnv) {
  if (!value || value.length > 1_024) return null;
  try {
    const requestURL = new URL(request.url);
    const callbackURL = new URL(value, requestURL.origin);
    if (callbackURL.protocol !== "https:" && callbackURL.protocol !== "http:") return null;
    const allowedOrigins = new Set([requestURL.origin, new URL(authBaseUrl(env)).origin]);
    if (requestURL.hostname === "localhost" || requestURL.hostname === "127.0.0.1") {
      for (const origin of trustedOrigins(authBaseUrl(env))) {
        const parsed = new URL(origin);
        if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
          allowedOrigins.add(parsed.origin);
        }
      }
    }
    if (!allowedOrigins.has(callbackURL.origin)) return null;
    if (callbackURL.pathname.startsWith("/api/auth/")) return null;
    const normalized = callbackURL.toString();
    return normalized.length <= 1_024 ? normalized : null;
  } catch {
    return null;
  }
}

function safeAuthFallbackURL(request: Request, env: NativeAuthEnv) {
  try {
    return new URL("/", new URL(authBaseUrl(env)).origin).toString();
  } catch {
    return new URL("/", request.url).toString();
  }
}

function oauthRedirectResponse(location: string, errorCode: string) {
  const url = new URL(location);
  url.searchParams.set("error", errorCode);
  const headers = privateNoStoreHeaders({ location: url.toString() });
  expireNativeOAuthStateCookies(headers);
  return new Response(null, { status: 302, headers });
}

function buildNativeAuthCookie(
  requestUrl: string,
  baseName: string,
  value: string,
  maxAgeSeconds: number,
) {
  const secure = new URL(requestUrl).protocol === "https:";
  const name = `${secure ? "__Secure-" : ""}better-auth.${baseName}`;
  const expiresAt = Date.now() + maxAgeSeconds * 1_000;
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function readNativeAuthCookie(request: Request, baseName: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader || cookieHeader.length > 16_384) return null;
  const names = [`__Secure-better-auth.${baseName}`, `better-auth.${baseName}`];
  for (const part of cookieHeader.split(";", 80)) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!names.includes(name)) continue;
    const encoded = part.slice(separator + 1).trim();
    if (!encoded || encoded.length > 4_096) return null;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return null;
}

function expireNativeOAuthStateCookies(headers: Headers) {
  for (const name of [
    "better-auth.state",
    "__Secure-better-auth.state",
    "better-auth.oauth_state",
    "__Secure-better-auth.oauth_state",
  ]) {
    headers.append(
      "set-cookie",
      `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${
        name.startsWith("__Secure-") ? "; Secure" : ""
      }`,
    );
  }
}

function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function pkceChallenge(codeVerifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function exchangeGoogleAuthorizationCode(
  code: string,
  codeVerifier: string,
  env: NativeAuthEnv,
): Promise<GoogleTokenSet> {
  const redirectURI = `${new URL(authBaseUrl(env)).origin}/api/auth/callback/google`;
  const body = new URLSearchParams({
    code,
    client_id: env.AUTH_GOOGLE_ID,
    client_secret: env.AUTH_GOOGLE_SECRET,
    redirect_uri: redirectURI,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const value = await readBoundedResponseJson(response, googleTokenResponseLimit);
  if (!response.ok || !isRecord(value)) throw new Error("Google token exchange failed.");
  const accessToken = boundedString(value.access_token, 1, 8_192);
  const idToken = boundedString(value.id_token, 1, 24_000);
  const refreshToken = optionalBoundedString(value.refresh_token, 8_192);
  const scope = optionalBoundedString(value.scope, 4_096);
  const expiresIn = finiteInteger(value.expires_in);
  if (!accessToken || !idToken) throw new Error("Google token response was incomplete.");
  return {
    accessToken,
    refreshToken,
    idToken,
    accessTokenExpiresAt:
      expiresIn && expiresIn > 0 && expiresIn <= 86_400
        ? Date.now() + expiresIn * 1_000
        : null,
    scope,
  };
}

async function verifyGoogleIdentity(idToken: string, clientId: string): Promise<GoogleIdentity | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
  const header = parseBase64UrlJson(encodedHeader, 4_096);
  const claims = parseBase64UrlJson(encodedPayload, 32_768);
  const signature = decodeBase64Url(encodedSignature, 1_024);
  if (!isRecord(header) || !isRecord(claims) || !signature) return null;
  const kid = boundedString(header.kid, 1, 256);
  if (header.alg !== "RS256" || !kid) return null;

  const key = await getGoogleVerificationKey(kid);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) return null;

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const issuer = claims.iss;
  const audience = claims.aud;
  const authorizedParty = claims.azp;
  const expiresAt = finiteInteger(claims.exp);
  const issuedAt = finiteInteger(claims.iat);
  const notBefore = claims.nbf === undefined ? null : finiteInteger(claims.nbf);
  const audienceMatches =
    audience === clientId ||
    (Array.isArray(audience) &&
      audience.length > 0 &&
      audience.length <= 10 &&
      audience.every((value) => typeof value === "string") &&
      audience.includes(clientId));
  const authorizedPartyMatches =
    authorizedParty === undefined
      ? !Array.isArray(audience) || audience.length === 1
      : authorizedParty === clientId;
  if (
    (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") ||
    !audienceMatches ||
    !authorizedPartyMatches ||
    !expiresAt ||
    expiresAt < nowSeconds - 60 ||
    !issuedAt ||
    issuedAt > nowSeconds + 300 ||
    nowSeconds - issuedAt > 3_900 ||
    (notBefore !== null && (!notBefore || notBefore > nowSeconds + 300)) ||
    claims.email_verified !== true
  ) {
    return null;
  }

  const subject = boundedString(claims.sub, 1, 255);
  const email = normalizeE2EEmail(claims.email);
  if (!subject || !email) return null;
  return {
    subject,
    email,
    name: optionalBoundedString(claims.name, 200),
    image: normalizeGoogleImage(claims.picture),
  };
}

async function getGoogleVerificationKey(kid: string) {
  const cached = cachedGoogleVerificationKeys.get(kid);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  let jwks = await getGoogleJwks(false);
  let jwk = jwks.keys.find((candidate) => candidate.kid === kid);
  if (!jwk) {
    jwks = await getGoogleJwks(true);
    jwk = jwks.keys.find((candidate) => candidate.kid === kid);
  }
  if (!jwk) throw new Error("Google signing key was not found.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (cachedGoogleVerificationKeys.size >= 16) cachedGoogleVerificationKeys.clear();
  cachedGoogleVerificationKeys.set(kid, { expiresAt: jwks.expiresAt, key });
  return key;
}

async function getGoogleJwks(forceRefresh: boolean) {
  const now = Date.now();
  if (!forceRefresh && cachedGoogleJwks && cachedGoogleJwks.expiresAt > now) {
    return cachedGoogleJwks;
  }

  // Never retain an in-flight fetch promise across Worker requests. Cloudflare
  // I/O objects are request-scoped and sharing one can trigger error 1101:
  // "Cannot perform I/O on behalf of a different request." Concurrent cold
  // callbacks may fetch the tiny public JWKS independently; only resolved,
  // bounded key data is cached in the isolate.
  const result = await fetchGoogleJwks();
  cachedGoogleJwks = result;
  if (forceRefresh) cachedGoogleVerificationKeys.clear();
  return result;
}

async function fetchGoogleJwks(): Promise<CachedGoogleJwks> {
  const response = await fetch(googleJwksEndpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const value = await readBoundedResponseJson(response, googleJwksResponseLimit);
  if (!response.ok || !isRecord(value) || !Array.isArray(value.keys)) {
    throw new Error("Google signing keys were unavailable.");
  }
  const keys = value.keys.filter(isGoogleJwk).slice(0, 16);
  if (keys.length === 0) throw new Error("Google signing keys were invalid.");
  const maxAge = cacheControlMaxAge(response.headers.get("cache-control"));
  return {
    keys,
    expiresAt: Date.now() + Math.min(Math.max(maxAge, 300), 86_400) * 1_000,
  };
}

function isGoogleJwk(value: unknown): value is GoogleJwk {
  return (
    isRecord(value) &&
    value.kty === "RSA" &&
    value.alg === "RS256" &&
    (value.use === undefined || value.use === "sig") &&
    Boolean(boundedString(value.kid, 1, 256)) &&
    Boolean(boundedString(value.n, 32, 2_048)) &&
    Boolean(boundedString(value.e, 1, 32))
  );
}

function cacheControlMaxAge(value: string | null) {
  const match = value?.match(/(?:^|,)\s*max-age=(\d+)/i);
  const parsed = match?.[1] ? Number(match[1]) : 3_600;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3_600;
}

function parseBase64UrlJson(value: string, maxBytes: number): unknown {
  const bytes = decodeBase64Url(value, maxBytes);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string, maxBytes: number) {
  if (!value || value.length > Math.ceil((maxBytes * 4) / 3) + 4 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    if (binary.length > maxBytes) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function readBoundedResponseJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) return null;
  }
  if (!response.body) return null;
  const bytes = await readBoundedBytes(response.body, maxBytes);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function normalizeGoogleImage(value: unknown) {
  const image = boundedString(value, 1, 2_048);
  if (!image) return null;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function linkVerifiedGoogleIdentity(
  db: D1Database,
  identity: GoogleIdentity,
  tokenSet: GoogleTokenSet,
) {
  let accountUser = await findGoogleAccountUser(db, identity.subject);
  let emailUser = accountUser ? null : await findUniqueGoogleEmailUser(db, identity.email);

  if (!accountUser && !emailUser) {
    const now = Date.now();
    await db
      .prepare(
        `insert into users (
           id, name, email, email_verified, email_verified_at, image,
           preferred_language, created_at, updated_at
         ) values (?1, ?2, ?3, 1, ?4, ?5, 'English', ?4, ?4)
         on conflict(email) do nothing`,
      )
      .bind(crypto.randomUUID(), identity.name, identity.email, now, identity.image)
      .run();
    emailUser = await findUniqueGoogleEmailUser(db, identity.email);
  }

  const proposedUserId = accountUser?.user_id ?? emailUser?.id;
  if (!proposedUserId) throw new Error("Verified Google identity could not be linked to a user.");
  await upsertGoogleAccount(db, proposedUserId, identity.subject, tokenSet);
  accountUser = await findGoogleAccountUser(db, identity.subject);
  if (!accountUser) throw new Error("Google account link was not persisted.");

  const userId = accountUser.user_id;
  const emailOwner = await findGoogleExactEmailUser(db, identity.email);
  const canUpdateEmail = !emailOwner || emailOwner.id === userId;
  await db
    .prepare(
      `update users set
         name = coalesce(?1, name),
         email = case when ?2 = 1 then ?3 else email end,
         email_verified = 1,
         email_verified_at = ?4,
         image = coalesce(?5, image),
         updated_at = ?4
       where id = ?6`,
    )
    .bind(
      identity.name,
      canUpdateEmail ? 1 : 0,
      identity.email,
      Date.now(),
      identity.image,
      userId,
    )
    .run();
  return userId;
}

async function findGoogleAccountUser(db: D1Database, subject: string) {
  return db
    .prepare(
      `select a.user_id
       from accounts a
       where a.provider = 'google' and a.provider_account_id = ?1
       limit 1`,
    )
    .bind(subject)
    .first<GoogleAccountUserRow>();
}

export async function findUniqueGoogleEmailUser(db: D1Database, email: string) {
  const exact = await findGoogleExactEmailUser(db, email);
  if (exact) return exact;
  const matches = await db
    .prepare(
      `select id, email
       from users
       where lower(email) = ?1
       order by id
       limit 2`,
    )
    .bind(email.toLowerCase())
    .all<GoogleEmailUserRow>();
  if (matches.results.length > 1) {
    console.error(JSON.stringify({ event: "native_google_casefold_email_conflict" }));
    throw new GoogleAccountLinkConflictError();
  }
  return matches.results[0] ?? null;
}

async function findGoogleExactEmailUser(db: D1Database, email: string) {
  return db
    .prepare(
      `select id, email
       from users
       where email = ?1
       limit 1`,
    )
    .bind(email)
    .first<GoogleEmailUserRow>();
}

async function upsertGoogleAccount(
  db: D1Database,
  userId: string,
  subject: string,
  tokenSet: GoogleTokenSet,
) {
  const now = Date.now();
  await db
    .prepare(
      `insert into accounts (
         id, user_id, type, provider, provider_account_id,
         refresh_token, access_token, access_token_expires_at,
         id_token, scope, created_at, updated_at
       ) values (?1, ?2, 'oauth', 'google', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       on conflict(provider, provider_account_id) do update set
         refresh_token = coalesce(excluded.refresh_token, accounts.refresh_token),
         access_token = excluded.access_token,
         access_token_expires_at = excluded.access_token_expires_at,
         id_token = excluded.id_token,
         scope = excluded.scope,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      subject,
      tokenSet.refreshToken,
      tokenSet.accessToken,
      tokenSet.accessTokenExpiresAt,
      tokenSet.idToken,
      tokenSet.scope,
      now,
    )
    .run();
}

export async function createNativeOAuthSession(
  request: Request,
  db: D1Database,
  userId: string,
) {
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(),
    token: randomBase64Url(32),
    userId,
    expiresAt: now + nativeSessionDurationMs,
    createdAt: now,
    updatedAt: now,
    ipAddress: trustedConnectingIp(request.headers.get("cf-connecting-ip")),
    userAgent: optionalBoundedString(request.headers.get("user-agent"), 512),
  };
  await db
    .prepare(
      `insert into sessions (
         id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent
       ) values (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)`,
    )
    .bind(
      session.id,
      session.token,
      session.userId,
      session.expiresAt,
      session.createdAt,
      session.ipAddress,
      session.userAgent,
    )
    .run();
  return session;
}

export async function handleMigrationE2EAuthRequest(request: Request, env: MigrationE2EAuthEnv) {
  const configuredSecret = boundedE2ESecret(env.E2E_TEST_AUTH_SECRET);
  const configuredEmail = normalizeE2EEmail(env.E2E_TEST_AUTH_EMAIL);
  if (!configuredSecret || !configuredEmail) return hiddenE2EAuthResponse();

  const clientIp = trustedConnectingIp(request.headers.get("cf-connecting-ip"));
  if (!clientIp) return hiddenE2EAuthResponse();

  const providedSecret = boundedProvidedE2ESecret(
    request.headers.get("x-migration-e2e-auth-secret"),
  );
  if (!constantTimeStringEqual(providedSecret ?? "", configuredSecret)) {
    return hiddenE2EAuthResponse();
  }
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!env.AUTH_SECRET) return jsonResponse({ error: "Authentication is temporarily unavailable." }, 503);

  const payload = await readE2EAuthPayload(request);
  if (!payload) return jsonResponse({ ok: false, error: "Invalid test authentication request." }, 400);
  if (isE2EAuthMutationAction(payload.action)) {
    const freeze = writeFreezeResponse(env, "migration-e2e-auth");
    if (freeze) return freeze;
  }
  const localRequest = isLocalE2EAuthRequest(request);
  const boundPayload = isBoundE2EAuthPayload(payload) ? payload : null;
  const configuredRunId = exactUuid(env.E2E_TEST_MUTATION_RUN_ID);
  const activeVersionId = exactUuid(env.CF_VERSION_METADATA?.id);
  const now = Date.now();
  const capabilityExpiresAt = exactE2ECapabilityExpiry(env.E2E_TEST_AUTH_EXPIRES_AT, now);
  if (
    boundPayload &&
    (
      !configuredRunId ||
      !activeVersionId ||
      boundPayload.runId !== configuredRunId ||
      (
        !isE2EAuthCleanupAction(boundPayload.action) &&
        boundPayload.candidateVersionId !== activeVersionId
      )
    )
  ) {
    return hiddenE2EAuthResponse();
  }
  if (!localRequest && (!boundPayload || capabilityExpiresAt === null)) {
    return hiddenE2EAuthResponse();
  }
  if (
    !localRequest &&
    isE2EAuthMintAction(payload.action) &&
    (capabilityExpiresAt === null || capabilityExpiresAt <= now)
  ) {
    return hiddenE2EAuthResponse();
  }
  const runtimeVersionProof = boundPayload && activeVersionId
    ? { runtimeVersionId: activeVersionId }
    : {};

  if (
    payload.action === "cleanup-existing-session" ||
    payload.action === "verify-existing-session-cleanup"
  ) {
    const user = await findE2EAuthUser(env.DB, configuredEmail);
    if (!user) {
      return jsonResponse(
        { ok: false, error: "The configured validation account does not exist." },
        409,
      );
    }
    const identity = await existingValidationSessionIdentity(
      configuredSecret,
      payload.candidateVersionId,
      payload.runId,
      user.id,
      payload.sessionPurpose,
    );
    const before = await loadExistingValidationSessionInventory(env.DB, identity, user.id);
    if (!existingValidationSessionTargetIsOwned(before)) {
      return jsonResponse(
        { ok: false, error: "Existing-account validation session ownership is ambiguous." },
        409,
      );
    }
    if (payload.action === "cleanup-existing-session" && before.exactSessions === 1) {
      await deleteExistingValidationSession(env.DB, identity, user.id);
    }
    const after = payload.action === "cleanup-existing-session"
      ? await loadExistingValidationSessionInventory(env.DB, identity, user.id)
      : before;
    const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
    if (payload.action === "cleanup-existing-session") expireNativeAuthCookies(headers, request);
    return new Response(JSON.stringify({
      ok: existingValidationSessionInventoryIsZero(after),
      ...runtimeVersionProof,
      session: await publicExistingValidationSession(identity, user.id, configuredSecret),
      before,
      after,
    }), { status: 200, headers });
  }

  if (payload.action === "authenticate-existing") {
    const requestedEmail = payload.email ?? configuredEmail;
    if (requestedEmail !== configuredEmail) {
      return jsonResponse(
        { ok: false, error: "The test authentication route is limited to its configured account." },
        403,
      );
    }

    const allowLocalUserCreation =
      env.E2E_TEST_AUTH_REQUIRE_EXISTING === "0" &&
      env.E2E_TEST_AUTH_ALLOW_LOCAL_CREATE === "1" &&
      localRequest;
    const user = await findOrCreateE2EAuthUser(env.DB, configuredEmail, allowLocalUserCreation);
    if (!user) {
      return jsonResponse(
        { ok: false, error: "The configured validation account does not exist." },
        409,
      );
    }

    const validationIdentity = boundPayload && boundPayload.action === "authenticate-existing"
      ? await existingValidationSessionIdentity(
          configuredSecret,
          boundPayload.candidateVersionId,
          boundPayload.runId,
          user.id,
          boundPayload.sessionPurpose,
        )
      : null;
    const session = validationIdentity
      ? await createExistingValidationSession(
          request,
          env.DB,
          user.id,
          clientIp,
          validationIdentity,
          Math.min(
            now + e2eSessionDurationMs,
            capabilityExpiresAt ?? now + e2eSessionDurationMs,
          ),
        )
      : await createE2EAuthSession(request, env.DB, user.id, clientIp);
    if (!session) {
      return jsonResponse(
        { ok: false, error: "Existing-account validation session ownership is ambiguous." },
        409,
      );
    }
    const sessionView = e2eNativeSession(user, session);
    const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
    headers.append(
      "set-cookie",
      await buildNativeSessionCookie(session.token, env.AUTH_SECRET, request.url, session.expiresAt),
    );
    return new Response(
      JSON.stringify({
        ok: true,
        ...runtimeVersionProof,
        user: validationIdentity
          ? {
              email: user.email,
              isAdmin: await isNativeAdmin(sessionView, env),
            }
          : {
              id: user.id,
              email: user.email,
              image: user.image,
              isAdmin: await isNativeAdmin(sessionView, env),
            },
        ...(validationIdentity
          ? {
              validationSession: await publicExistingValidationSession(
                validationIdentity,
                user.id,
                configuredSecret,
              ),
            }
          : {}),
      }),
      { status: 200, headers },
    );
  }

  if (!configuredRunId) return hiddenE2EAuthResponse();
  const identity = await disposableMutationIdentity(payload.candidateVersionId, configuredRunId);
  if ("userId" in payload && payload.userId !== identity.userId) {
    return hiddenE2EAuthResponse();
  }

  if (payload.action === "verify-disposable-cleanup") {
    const { inventory } = await loadDisposableMutationInventory(env, identity);
    return jsonResponse({
      ok: inventoryTotal(inventory) === 0,
      ...runtimeVersionProof,
      identity: publicDisposableIdentity(identity),
      inventory,
    }, 200);
  }

  if (payload.action === "cleanup-disposable") {
    if (!await authorizedDisposableCleanup(request, env, identity, configuredSecret)) {
      return unauthorizedResponse();
    }
    const beforeSnapshot = await loadDisposableMutationInventory(env, identity);
    const before = beforeSnapshot.inventory;
    assertDisposableInventoryBounded(before);
    const beforeTotal = inventoryTotal(before);
    if (beforeTotal !== 0 && beforeSnapshot.cleanupMarkerCount !== 1) {
      return jsonResponse(
        { ok: false, error: "Disposable validation cleanup ownership marker is missing." },
        409,
      );
    }
    if (before.profile_photo_pointers !== 0) {
      return jsonResponse(
        { ok: false, error: "Disposable validation profile-photo residue requires external cleanup." },
        409,
      );
    }
    if (beforeTotal !== 0) await cleanupDisposableMutationUser(env, identity);
    const { inventory: after } = await loadDisposableMutationInventory(env, identity);
    const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
    expireNativeAuthCookies(headers, request);
    return new Response(JSON.stringify({
      ok: inventoryTotal(after) === 0,
      ...runtimeVersionProof,
      identity: publicDisposableIdentity(identity),
      before,
      after,
    }), { status: 200, headers });
  }

  const { inventory: before } = await loadDisposableMutationInventory(env, identity);
  if (inventoryTotal(before) !== 0) {
    return jsonResponse(
      { ok: false, error: "Disposable validation identity collision or residue detected." },
      409,
    );
  }
  let created: { user: E2EAuthUser; session: E2EAuthSession } | null = null;
  try {
    created = await createDisposableMutationUser(
      request,
      env,
      identity,
      clientIp,
      Math.min(
        now + e2eSessionDurationMs,
        capabilityExpiresAt ?? now + e2eSessionDurationMs,
      ),
    );
  } catch {
    // A uniqueness failure means a concurrent validator claimed this exact
    // candidate/run identity. Never reuse or repair that graph here.
  }
  if (!created) {
    return jsonResponse(
      { ok: false, error: "Disposable validation identity collision or residue detected." },
      409,
    );
  }
  const { inventory: after } = await loadDisposableMutationInventory(env, identity);
  if (!isExpectedDisposableCreationInventory(after)) {
    await cleanupDisposableMutationUser(env, identity);
    const { inventory: cleaned } = await loadDisposableMutationInventory(env, identity);
    if (inventoryTotal(cleaned) !== 0) {
      throw new Error("Incomplete disposable validation account could not be cleaned.");
    }
    return jsonResponse({ ok: false, error: "Disposable validation account creation is incomplete." }, 500);
  }
  const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
  headers.append(
    "set-cookie",
    await buildNativeSessionCookie(
      created.session.token,
      env.AUTH_SECRET,
      request.url,
      created.session.expiresAt,
    ),
  );
  return new Response(
    JSON.stringify({
      ok: true,
      ...runtimeVersionProof,
      identity: publicDisposableIdentity(identity),
      before,
      after,
      user: {
        id: created.user.id,
        email: created.user.email,
        image: created.user.image,
        isAdmin: false,
      },
    }),
    { status: 200, headers },
  );
}

type DisposableMutationIdentity = {
  candidateVersionId: string;
  runId: string;
  userId: string;
  email: string;
  markerToken: string;
  quotaKeys: readonly string[];
};

type DisposableMutationInventoryRow = Record<string, unknown>;

export const E2E_DISPOSABLE_MUTATION_INVENTORY_SQL = `select
  (select count(*) from users where id = ?1 and email = ?2) as users,
  (select count(*) from users where id = ?1 and email = ?2 and (
    profile_image_mime is not null or profile_image_hash is not null or
    profile_image_r2_key is not null or profile_image_r2_etag is not null or
    profile_image_size is not null
  )) as profile_photo_pointers,
  (select count(*) from accounts where user_id = ?1) as accounts,
  (select count(*) from sessions where user_id = ?1) as sessions,
  (select count(*) from verification_tokens where identifier = ?2) as verification_tokens,
  (select count(*) from verification_tokens where identifier = ?2 and token = ?9) as cleanup_marker,
  (select count(*) from rate_limit_windows where "key" in (?3, ?4, ?5, ?6, ?7, ?8)) as rate_limit_windows,
  (select count(*) from admin_users where email = ?2 or added_by_user_id = ?1) as admin_users,
  (select count(*) from product_events where user_id = ?1) as product_events,
  (select count(*) from ops_events where user_id = ?1) as ops_events,
  (select count(*) from chats where user_id = ?1) as chats,
  (select count(*) from messages where chat_id in (select id from chats where user_id = ?1)) as messages,
  (select count(*) from activity_runs where chat_id in (select id from chats where user_id = ?1)) as activity_runs,
  (select count(*) from ai_runs where chat_id in (select id from chats where user_id = ?1)) as ai_runs,
  (select count(*) from user_memory_settings where user_id = ?1) as user_memory_settings,
  (select count(*) from user_memories where user_id = ?1) as user_memories,
  (select count(*) from chat_memory_summaries where user_id = ?1) as chat_memory_summaries,
  (select count(*) from chat_memory_turns where user_id = ?1) as chat_memory_turns,
  (select count(*) from user_memory_profiles where user_id = ?1) as user_memory_profiles,
  (select count(*) from user_memory_summaries where user_id = ?1) as user_memory_summaries,
  (select count(*) from memory_synthesis_runs where user_id = ?1) as memory_synthesis_runs,
  (select count(*) from memory_source_feedback where user_id = ?1) as memory_source_feedback,
  (select count(*) from memory_events where user_id = ?1) as memory_events,
  (select count(*) from memory_vector_cleanup_outbox where owner_user_id = ?1) as memory_vector_cleanup_outbox`;

async function disposableMutationIdentity(
  candidateVersionId: string,
  runId: string,
): Promise<DisposableMutationIdentity> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`inspir-disposable-mutation-v1\0${candidateVersionId}\0${runId}`),
  ));
  const uuidBytes = digest.slice(0, 16);
  uuidBytes[6] = ((uuidBytes[6] ?? 0) & 0x0f) | 0x40;
  uuidBytes[8] = ((uuidBytes[8] ?? 0) & 0x3f) | 0x80;
  const uuidHex = bytesToHex(uuidBytes);
  const userId = `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`;
  const runSlug = runId.replaceAll("-", "");
  const candidateSlug = candidateVersionId.replaceAll("-", "").slice(0, 12);
  const email = `e2e-${candidateSlug}-${runSlug}@${e2eDisposableDomain}`;
  return {
    candidateVersionId,
    runId,
    userId,
    email,
    markerToken: `inspir-disposable-mutation-v1:${bytesToHex(digest)}`,
    quotaKeys: [],
  };
}

async function identityWithRuntimeQuotaKeys(
  identity: DisposableMutationIdentity,
  authSecret: string,
) {
  const analyticsHash = (await nativeAuthHmacHex(
    `signed-analytics\0${identity.userId}`,
    authSecret,
  )).slice(0, 32);
  return {
    ...identity,
    quotaKeys: [
      `chat:user:${identity.userId}`,
      `activity:quiz:${identity.userId}`,
      `activity:flashcards:${identity.userId}`,
      `memory:create:${identity.userId}`,
      `memory:update:${identity.userId}`,
      `analytics:signed:${analyticsHash}`,
    ],
  } satisfies DisposableMutationIdentity;
}

async function loadDisposableMutationInventory(
  env: MigrationE2EAuthEnv,
  baseIdentity: DisposableMutationIdentity,
) {
  if (!env.AUTH_SECRET) throw new Error("Disposable mutation inventory requires auth configuration.");
  const identity = await identityWithRuntimeQuotaKeys(baseIdentity, env.AUTH_SECRET);
  const row = await env.DB.prepare(E2E_DISPOSABLE_MUTATION_INVENTORY_SQL)
    .bind(identity.userId, identity.email, ...identity.quotaKeys, identity.markerToken)
    .first<DisposableMutationInventoryRow>();
  if (!row) throw new Error("Disposable mutation inventory was unavailable.");
  const inventory: Partial<E2EDisposableMutationInventory> = {};
  for (const name of E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES) {
    const count = nonNegativeSafeInteger(row[name]);
    if (count === null) throw new Error(`Disposable mutation inventory ${name} is invalid.`);
    inventory[name] = count;
  }
  assertCompleteDisposableInventory(inventory);
  const cleanupMarkerCount = nonNegativeSafeInteger(row.cleanup_marker);
  if (cleanupMarkerCount === null || cleanupMarkerCount > 1) {
    throw new Error("Disposable mutation cleanup marker inventory is invalid.");
  }
  return { inventory, cleanupMarkerCount };
}

async function createDisposableMutationUser(
  request: Request,
  env: MigrationE2EAuthEnv,
  identity: DisposableMutationIdentity,
  clientIp: string,
  expiresAt: number,
) {
  const now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  const session: E2EAuthSession = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    userId: identity.userId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: clientIp,
    userAgent: optionalBoundedString(request.headers.get("user-agent"), 512),
  };
  const markerId = crypto.randomUUID();
  const results = await env.DB.batch<E2EAuthUser>([
    env.DB.prepare(
      `insert into users (
         id, name, email, email_verified, email_verified_at, image, score,
         preferred_language, created_at, updated_at
       ) values (?1, 'Inspir mutation validation', ?2, 1, ?3, null, 0, 'English', ?3, ?3)
       returning id, name, email, image`,
    ).bind(identity.userId, identity.email, now),
    env.DB.prepare(
      `insert into user_memory_settings (
         user_id, enabled, saved_memory_enabled, chat_history_enabled,
         dreaming_enabled, capture_scope, retrieval_mode, created_at, updated_at
       ) values (?1, 1, 1, 1, 0, 'minimal', 'need_based', ?2, ?2)`,
    ).bind(identity.userId, now),
    env.DB.prepare(
      `insert into sessions (
         id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent
       ) values (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)`,
    ).bind(
      session.id,
      session.token,
      session.userId,
      session.expiresAt,
      session.createdAt,
      session.ipAddress,
      session.userAgent,
    ),
    env.DB.prepare(
      `insert into verification_tokens (
         id, identifier, token, expires, created_at, updated_at
       ) values (?1, ?2, ?3, ?4, ?5, ?5)`,
    ).bind(
      markerId,
      identity.email,
      identity.markerToken,
      session.expiresAt,
      now,
    ),
  ]);
  const user = results[0]?.results[0];
  if (
    !user ||
    user.id !== identity.userId ||
    user.email !== identity.email ||
    user.name !== "Inspir mutation validation" ||
    user.image !== null
  ) {
    return null;
  }
  return { user, session };
}

async function cleanupDisposableMutationUser(
  env: MigrationE2EAuthEnv,
  baseIdentity: DisposableMutationIdentity,
) {
  if (!env.AUTH_SECRET) throw new Error("Disposable mutation cleanup requires auth configuration.");
  const identity = await identityWithRuntimeQuotaKeys(baseIdentity, env.AUTH_SECRET);
  const userId = identity.userId;
  const markerGuard =
    "exists (select 1 from verification_tokens where identifier = ?2 and token = ?3)";
  await env.DB.batch([
    env.DB.prepare(`delete from memory_source_feedback where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from memory_events where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from memory_synthesis_runs where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from user_memory_profiles where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from user_memory_summaries where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from chat_memory_summaries where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from chat_memory_turns where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from user_memories where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(
      `delete from activity_runs
       where chat_id in (select id from chats where user_id = ?1) and ${markerGuard}`,
    ).bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(
      `delete from ai_runs
       where chat_id in (select id from chats where user_id = ?1) and ${markerGuard}`,
    ).bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(
      `delete from messages
       where chat_id in (select id from chats where user_id = ?1) and ${markerGuard}`,
    ).bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from product_events where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from ops_events where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(
      `delete from admin_users
       where (email = ?1 or added_by_user_id = ?2)
         and exists (select 1 from verification_tokens where identifier = ?1 and token = ?3)`,
    ).bind(identity.email, userId, identity.markerToken),
    env.DB.prepare(`delete from user_memory_settings where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(
      `delete from rate_limit_windows
       where "key" in (?1, ?2, ?3, ?4, ?5, ?6)
         and exists (select 1 from verification_tokens where identifier = ?7 and token = ?8)`,
    ).bind(...identity.quotaKeys, identity.email, identity.markerToken),
    env.DB.prepare(`delete from chats where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
  ]);

  // The Vectorize cleanup outbox is an operational durability record, not
  // disposable account data. Its owner-scoped rows are removed only by the
  // runtime drain after delayed Vectorize absence verification. Keep the
  // identity and its cleanup marker alive so an authenticated or HMAC-bound
  // retry remains possible while that external cleanup is still pending.
  const afterOwnedDataCleanup = (await loadDisposableMutationInventory(env, identity)).inventory;
  if (!disposableIdentityCanBeFinalized(afterOwnedDataCleanup)) return;

  await env.DB.batch([
    env.DB.prepare(`delete from accounts where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(`delete from sessions where user_id = ?1 and ${markerGuard}`)
      .bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(
      `delete from users
       where id = ?1 and email = ?2
         and exists (select 1 from verification_tokens where identifier = ?2 and token = ?3)`,
    ).bind(userId, identity.email, identity.markerToken),
    env.DB.prepare(
      `delete from verification_tokens
       where identifier = ?1 and token <> ?2
         and exists (select 1 from verification_tokens where identifier = ?1 and token = ?2)`,
    ).bind(identity.email, identity.markerToken),
    env.DB.prepare("delete from verification_tokens where identifier = ?1 and token = ?2")
      .bind(identity.email, identity.markerToken),
  ]);
}

const disposableIdentityControlRows = new Set<E2EDisposableMutationInventoryName>([
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
]);

function disposableIdentityCanBeFinalized(inventory: E2EDisposableMutationInventory) {
  return E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES.every((name) => (
    disposableIdentityControlRows.has(name) || inventory[name] === 0
  ));
}

async function authorizedDisposableCleanup(
  request: Request,
  env: MigrationE2EAuthEnv,
  identity: DisposableMutationIdentity,
  capabilitySecret: string,
) {
  const session = await requireNativeSession(request, env, { refresh: false });
  if (session?.user.id === identity.userId && session.user.email === identity.email) return true;
  const providedProof = request.headers.get("x-migration-e2e-cleanup-proof") ?? "";
  const expectedProof = await nativeAuthHmacHex(
    `disposable-cleanup-v1\0${identity.candidateVersionId}\0${identity.runId}\0${identity.userId}`,
    capabilitySecret,
  );
  return constantTimeStringEqual(providedProof, expectedProof);
}

function publicDisposableIdentity(identity: DisposableMutationIdentity) {
  return {
    candidateVersionId: identity.candidateVersionId,
    runId: identity.runId,
    userId: identity.userId,
    email: identity.email,
  };
}

function inventoryTotal(inventory: E2EDisposableMutationInventory) {
  return E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES.reduce(
    (total, name) => total + inventory[name],
    0,
  );
}

function assertDisposableInventoryBounded(inventory: E2EDisposableMutationInventory) {
  if (inventoryTotal(inventory) > e2eDisposableInventoryLimit) {
    throw new Error("Disposable mutation inventory exceeds its cleanup safety bound.");
  }
}

function isExpectedDisposableCreationInventory(inventory: E2EDisposableMutationInventory) {
  return E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES.every((name) => {
    const expected = name === "users" ||
      name === "sessions" ||
      name === "verification_tokens" ||
      name === "user_memory_settings"
      ? 1
      : 0;
    return inventory[name] === expected;
  });
}

function assertCompleteDisposableInventory(
  inventory: Partial<E2EDisposableMutationInventory>,
): asserts inventory is E2EDisposableMutationInventory {
  for (const name of E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES) {
    if (inventory[name] === undefined) {
      throw new Error(`Disposable mutation inventory omitted ${name}.`);
    }
  }
}

async function findOrCreateE2EAuthUser(
  db: D1Database,
  email: string,
  allowLocalUserCreation: boolean,
) {
  const existing = await findE2EAuthUser(db, email);
  if (existing) return existing;
  if (!allowLocalUserCreation) return null;

  const now = Date.now();
  const inserted = await db
    .prepare(
      `insert into users (
         id, name, email, email_verified, email_verified_at, image,
         preferred_language, created_at, updated_at
       ) values (?1, 'Inspir E2E', ?2, 1, ?3, '/icon.png', 'English', ?3, ?3)
       on conflict(email) do nothing
       returning id, name, email, image`,
    )
    .bind(crypto.randomUUID(), email, now)
    .first<E2EAuthUser>();
  if (inserted) return inserted;

  // A concurrent validator may have inserted the configured local-only user
  // after the initial read. Re-select it without mutating any profile fields.
  return findE2EAuthUser(db, email);
}

async function findE2EAuthUser(db: D1Database, email: string) {
  return db
    .prepare("select id, name, email, image from users where email = ?1 limit 1")
    .bind(email)
    .first<E2EAuthUser>();
}

async function createE2EAuthSession(
  request: Request,
  db: D1Database,
  userId: string,
  clientIp: string,
) {
  const now = Date.now();
  const session: E2EAuthSession = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    userId,
    expiresAt: now + e2eSessionDurationMs,
    createdAt: now,
    updatedAt: now,
    ipAddress: clientIp,
    userAgent: request.headers.get("user-agent"),
  };
  await db
    .prepare(
      `insert into sessions (
         id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent
       ) values (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)`,
    )
    .bind(
      session.id,
      session.token,
      session.userId,
      session.expiresAt,
      session.createdAt,
      session.ipAddress,
      session.userAgent,
    )
    .run();
  return session;
}

async function existingValidationSessionIdentity(
  capabilitySecret: string,
  candidateVersionId: string,
  runId: string,
  userId: string,
  purpose: E2EExistingSessionPurpose,
): Promise<ExistingValidationSessionIdentity> {
  const binding = `${candidateVersionId}\0${runId}\0${purpose}\0${userId}`;
  const sessionDigest = await nativeAuthHmacHex(
    `existing-validation-session-v1\0session\0${binding}`,
    capabilitySecret,
  );
  const markerDigest = await nativeAuthHmacHex(
    `existing-validation-session-v1\0marker\0${binding}`,
    capabilitySecret,
  );
  const uuidHex = sessionDigest.slice(0, 32).split("");
  uuidHex[12] = "4";
  uuidHex[16] = ((Number.parseInt(uuidHex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const normalized = uuidHex.join("");
  return {
    candidateVersionId,
    runId,
    purpose,
    sessionId: `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`,
    sessionToken: `e2e_${sessionDigest}`,
    // The ownership marker is a separate HMAC and is not returned by this
    // capability response. Pre/post inventory checks detect a collision, and
    // cleanup still removes only the independently HMAC-bound id+token row.
    userAgent: `inspir-existing-validation-v1:${markerDigest}`,
  };
}

async function createExistingValidationSession(
  request: Request,
  db: D1Database,
  userId: string,
  clientIp: string,
  identity: ExistingValidationSessionIdentity,
  expiresAt: number,
): Promise<E2EAuthSession | null> {
  const now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  const before = await loadExistingValidationSessionInventory(db, identity, userId);
  if (!existingValidationSessionInventoryIsZero(before)) {
    if (!existingValidationSessionInventoryIsOwned(before) || before.exactSessions !== 1) {
      return null;
    }
    return readExistingValidationSession(db, identity, userId, now, expiresAt);
  }
  const session: E2EAuthSession = {
    id: identity.sessionId,
    token: identity.sessionToken,
    userId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: clientIp,
    userAgent: identity.userAgent,
  };
  const inserted = await db
    .prepare(
      `insert into sessions (
         id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent
       ) values (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)
       on conflict(id) do nothing
       returning id`,
    )
    .bind(
      session.id,
      session.token,
      session.userId,
      session.expiresAt,
      session.createdAt,
      session.ipAddress,
      session.userAgent,
    )
    .first<{ id: string }>();
  const after = await loadExistingValidationSessionInventory(db, identity, userId);
  if (
    !existingValidationSessionInventoryIsOwned(after) ||
    after.idRows !== 1 ||
    after.exactSessions !== 1 ||
    after.markerSessions !== 1
  ) {
    if (after.exactSessions === 1) {
      await deleteExistingValidationSession(db, identity, userId);
      const rolledBack = await loadExistingValidationSessionInventory(db, identity, userId);
      if (rolledBack.idRows !== 0 || rolledBack.exactSessions !== 0) {
        throw new Error("Ambiguous existing-account validation session could not be rolled back.");
      }
    }
    return null;
  }
  if (inserted?.id === session.id) return session;
  return readExistingValidationSession(db, identity, userId, now, expiresAt);
}

async function readExistingValidationSession(
  db: D1Database,
  identity: ExistingValidationSessionIdentity,
  userId: string,
  now: number,
  maximumExpiresAt: number,
): Promise<E2EAuthSession | null> {
  const existing = await db
    .prepare(
      `select id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent
       from sessions where id = ?1 limit 1`,
    )
    .bind(identity.sessionId)
    .first<Record<string, unknown>>();
  if (
    !existing ||
    existing.id !== identity.sessionId ||
    existing.session_token !== identity.sessionToken ||
    existing.user_id !== userId ||
    existing.user_agent !== identity.userAgent ||
    !isPositiveSafeInteger(existing.expires) ||
    existing.expires <= now ||
    existing.expires > maximumExpiresAt ||
    !isNonNegativeSafeInteger(existing.created_at) ||
    !isNonNegativeSafeInteger(existing.updated_at) ||
    (existing.ip_address !== null && typeof existing.ip_address !== "string")
  ) {
    return null;
  }
  return {
    id: identity.sessionId,
    token: identity.sessionToken,
    userId,
    expiresAt: existing.expires,
    createdAt: existing.created_at,
    updatedAt: existing.updated_at,
    ipAddress: existing.ip_address,
    userAgent: identity.userAgent,
  };
}

async function loadExistingValidationSessionInventory(
  db: D1Database,
  identity: ExistingValidationSessionIdentity,
  userId: string,
): Promise<ExistingValidationSessionInventory> {
  const row = await db
    .prepare(
      `select
         (select count(*) from sessions where id = ?1) as id_rows,
         (select count(*) from sessions
          where id = ?1 and session_token = ?2 and user_id = ?3 and user_agent = ?4) as exact_sessions,
         (select count(*) from sessions where user_id = ?3 and user_agent = ?4) as marker_sessions`,
    )
    .bind(identity.sessionId, identity.sessionToken, userId, identity.userAgent)
    .first<Record<string, unknown>>();
  if (!row) throw new Error("Existing-account validation session inventory was unavailable.");
  const idRows = nonNegativeSafeInteger(row.id_rows);
  const exactSessions = nonNegativeSafeInteger(row.exact_sessions);
  const markerSessions = nonNegativeSafeInteger(row.marker_sessions);
  if (idRows === null || exactSessions === null || markerSessions === null) {
    throw new Error("Existing-account validation session inventory is invalid.");
  }
  return { idRows, exactSessions, markerSessions };
}

async function deleteExistingValidationSession(
  db: D1Database,
  identity: ExistingValidationSessionIdentity,
  userId: string,
) {
  await db
    .prepare(
      `delete from sessions
       where id = ?1 and session_token = ?2 and user_id = ?3 and user_agent = ?4`,
    )
    .bind(identity.sessionId, identity.sessionToken, userId, identity.userAgent)
    .run();
}

function existingValidationSessionInventoryIsOwned(
  inventory: ExistingValidationSessionInventory,
) {
  return inventory.exactSessions <= 1 &&
    inventory.idRows === inventory.exactSessions &&
    inventory.markerSessions === inventory.exactSessions;
}

function existingValidationSessionTargetIsOwned(
  inventory: ExistingValidationSessionInventory,
) {
  return inventory.exactSessions <= 1 && inventory.idRows === inventory.exactSessions;
}

function existingValidationSessionInventoryIsZero(
  inventory: ExistingValidationSessionInventory,
) {
  return inventory.idRows === 0 &&
    inventory.exactSessions === 0 &&
    inventory.markerSessions === 0;
}

async function publicExistingValidationSession(
  identity: ExistingValidationSessionIdentity,
  userId: string,
  capabilitySecret: string,
) {
  const binding = `${identity.candidateVersionId}\0${identity.runId}\0${identity.purpose}`;
  return {
    candidateVersionId: identity.candidateVersionId,
    runId: identity.runId,
    purpose: identity.purpose,
    userRef: await nativeAuthHmacHex(
      `existing-validation-public-v1\0user\0${binding}\0${userId}`,
      capabilitySecret,
    ),
    sessionRef: await nativeAuthHmacHex(
      `existing-validation-public-v1\0session\0${binding}\0${identity.sessionId}`,
      capabilitySecret,
    ),
  };
}

function e2eNativeSession(user: E2EAuthUser, session: E2EAuthSession): NativeAuthenticatedSession {
  return {
    user: {
      ...user,
      emailVerified: true,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
    },
    session: {
      id: session.id,
      token: session.token,
      userId: session.userId,
      expiresAt: new Date(session.expiresAt),
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    },
    refreshedSessionCookie: null,
  };
}

async function readE2EAuthPayload(request: Request): Promise<E2EAuthPayload | null> {
  if (!request.body) return { action: "authenticate-existing" };
  const value = await readBoundedJson(request, e2eAuthBodyLimit);
  if (!isRecord(value)) return null;
  const action = value.action ?? "authenticate-existing";
  if (action === "authenticate-existing") {
    if (
      Object.keys(value).some(
        (key) => !["action", "email", "runId", "candidateVersionId", "sessionPurpose"].includes(key),
      )
    ) {
      return null;
    }
    const email = value.email === undefined ? undefined : normalizeE2EEmail(value.email);
    if (value.email !== undefined && !email) return null;
    const hasBinding = value.runId !== undefined ||
      value.candidateVersionId !== undefined ||
      value.sessionPurpose !== undefined;
    if (!hasBinding) return email ? { action, email } : { action };
    const runId = exactUuid(value.runId);
    const candidateVersionId = exactUuid(value.candidateVersionId);
    const sessionPurpose = exactExistingSessionPurpose(value.sessionPurpose);
    if (!runId || !candidateVersionId || !sessionPurpose) return null;
    return {
      action,
      ...(email ? { email } : {}),
      runId,
      candidateVersionId,
      sessionPurpose,
    };
  }
  if (action === "create-disposable") {
    if (Object.keys(value).some((key) => !["action", "runId", "candidateVersionId"].includes(key))) {
      return null;
    }
    const runId = exactUuid(value.runId);
    const candidateVersionId = exactUuid(value.candidateVersionId);
    return runId && candidateVersionId ? { action, runId, candidateVersionId } : null;
  }
  if (action === "cleanup-disposable" || action === "verify-disposable-cleanup") {
    if (
      Object.keys(value).some(
        (key) => !["action", "runId", "candidateVersionId", "userId"].includes(key),
      )
    ) {
      return null;
    }
    const runId = exactUuid(value.runId);
    const candidateVersionId = exactUuid(value.candidateVersionId);
    const userId = exactUuid(value.userId);
    return runId && candidateVersionId && userId
      ? { action, runId, candidateVersionId, userId }
      : null;
  }
  if (action === "cleanup-existing-session" || action === "verify-existing-session-cleanup") {
    if (
      Object.keys(value).some(
        (key) => !["action", "runId", "candidateVersionId", "sessionPurpose"].includes(key),
      )
    ) {
      return null;
    }
    const runId = exactUuid(value.runId);
    const candidateVersionId = exactUuid(value.candidateVersionId);
    const sessionPurpose = exactExistingSessionPurpose(value.sessionPurpose);
    return runId && candidateVersionId && sessionPurpose
      ? { action, runId, candidateVersionId, sessionPurpose }
      : null;
  }
  return null;
}

function isBoundE2EAuthPayload(
  payload: E2EAuthPayload,
): payload is Exclude<E2EAuthPayload, E2EUnboundExistingAuthPayload> | E2EBoundExistingAuthPayload {
  return payload.action !== "authenticate-existing" || "runId" in payload;
}

function isE2EAuthMintAction(action: E2EAuthPayload["action"]) {
  return action === "authenticate-existing" || action === "create-disposable";
}

function isE2EAuthCleanupAction(action: E2EAuthPayload["action"]) {
  return action === "cleanup-existing-session" ||
    action === "verify-existing-session-cleanup" ||
    action === "cleanup-disposable" ||
    action === "verify-disposable-cleanup";
}

function isE2EAuthMutationAction(action: E2EAuthPayload["action"]) {
  return isE2EAuthMintAction(action) ||
    action === "cleanup-existing-session" ||
    action === "cleanup-disposable";
}

function exactExistingSessionPurpose(value: unknown): E2EExistingSessionPurpose | null {
  return E2E_EXISTING_SESSION_PURPOSES.find((purpose) => purpose === value) ?? null;
}

function exactE2ECapabilityExpiry(value: string | null | undefined, now: number) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const expiresAt = Number(value);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0 ||
    expiresAt > now + e2eCapabilityMaximumFutureMs
  ) {
    return null;
  }
  return expiresAt;
}

function exactUuid(value: unknown) {
  if (
    typeof value !== "string" ||
    value !== value.toLowerCase() ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) {
    return null;
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown) {
  return isNonNegativeSafeInteger(value) ? value : null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function boundedE2ESecret(value: string | null | undefined) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return null;
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength < 32 || byteLength > 512) return null;
  return value;
}

function boundedProvidedE2ESecret(value: string | null) {
  if (value === null || value.length > 512) return null;
  return new TextEncoder().encode(value).byteLength <= 512 ? value : null;
}

function isLocalE2EAuthRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function trustedConnectingIp(value: string | null) {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 64) return null;
  const ipv4Parts = candidate.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return ipv4Parts.map((part) => String(Number(part))).join(".");
  }
  if (!candidate.includes(":") || !/^[0-9a-f:.]+$/i.test(candidate)) return null;
  try {
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

function normalizeE2EEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !normalized.includes("@")) return null;
  return normalized;
}

function hiddenE2EAuthResponse() {
  return new Response(null, { status: 404, headers: privateNoStoreHeaders() });
}

export async function handleLogout(request: Request, env: NativeAuthEnv) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isAllowedSameOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, 403);
  const freeze = writeFreezeResponse(env, "auth");
  if (freeze) return freeze;

  const token = await readVerifiedNativeSessionToken(request, env.AUTH_SECRET);
  let sessionCleanup = "not-present";
  if (token) {
    const result = await env.DB
      .prepare("delete from sessions where session_token = ?1")
      .bind(token)
      .run();
    const changes = result.meta.changes;
    if (!Number.isSafeInteger(changes) || changes < 0 || changes > 1) {
      throw new Error("Native logout returned an invalid session deletion count.");
    }
    sessionCleanup = changes === 1 ? "deleted" : "absent";
  }
  const headers = privateNoStoreHeaders();
  headers.set("x-inspir-session-cleanup", sessionCleanup);
  expireNativeAuthCookies(headers, request);
  return new Response(null, { status: 204, headers });
}

async function handleProfile(request: Request, env: AccountApiEnv) {
  if (request.method !== "GET" && request.method !== "PATCH") return methodNotAllowed("GET, PATCH");
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();

  if (request.method === "PATCH") {
    if (!isAllowedSameOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, 403, session);
    const freeze = writeFreezeResponse(env, "profile", session);
    if (freeze) return freeze;
    const patch = await readProfilePatch(request);
    if (!patch) return jsonResponse({ error: "Invalid profile update" }, 400, session);
    await updateProfile(env.DB, session.user.id, patch);
  }

  const user = await getProfile(env.DB, session.user.id);
  if (!user) return unauthorizedResponse();
  return jsonResponse({ user: await serializeProfile(user, session, env) }, 200, session);
}

async function handleProfilePhoto(request: Request, env: AccountApiEnv, ctx: ExecutionContext) {
  if (request.method !== "GET" && request.method !== "PATCH" && request.method !== "DELETE") {
    return methodNotAllowed("GET, PATCH, DELETE");
  }
  const session = await requireNativeSession(request, env);
  if (!session) return unauthorizedResponse();

  if (request.method === "GET") return getProfilePhoto(env, session);
  if (!isAllowedSameOrigin(request, env)) return jsonResponse({ error: "Forbidden" }, 403, session);
  const freeze = writeFreezeResponse(env, "profile-photo", session);
  if (freeze) return freeze;
  if (request.method === "DELETE") return deleteProfilePhoto(env, session, ctx);
  return putProfilePhoto(request, env, session, ctx);
}

async function getProfilePhoto(env: AccountApiEnv, session: NativeAuthenticatedSession) {
  const row = await getProfile(env.DB, session.user.id);
  if (!row?.profile_image_mime || !row.profile_image_r2_key || !isValidProfileImageObjectKey(row.profile_image_r2_key)) {
    return jsonResponse({ error: "No cached photo" }, 404, session);
  }

  const object = await env.PROFILE_IMAGES_R2_BUCKET.get(row.profile_image_r2_key);
  if (!object?.body) return jsonResponse({ error: "Cached photo is unavailable" }, 404, session);
  const headers = privateNoStoreHeaders({
    "content-type": row.profile_image_mime,
    "cache-control": "private, max-age=3600",
  });
  object.writeHttpMetadata(headers);
  headers.set("content-type", row.profile_image_mime);
  headers.set("cache-control", "private, max-age=3600");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  appendNativeSessionRefresh(headers, session);
  return new Response(object.body, { status: 200, headers });
}

async function putProfilePhoto(
  request: Request,
  env: AccountApiEnv,
  session: NativeAuthenticatedSession,
  ctx: ExecutionContext,
) {
  if (isOversizedProfileImageUpload(request.headers.get("content-length"))) {
    return jsonResponse({ error: "Choose an image under 1 MB." }, 413, session);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return jsonResponse({ error: "Upload length is required." }, 411, session);
  }
  const formData = await request.formData().catch(() => null);
  const photo = formData?.get("photo");
  if (!(photo instanceof File)) return jsonResponse({ error: "Choose an image file." }, 400, session);
  if (photo.size > 1_000_000) return jsonResponse({ error: "Choose an image under 1 MB." }, 413, session);

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const prepared = await prepareProfileImage(bytes, photo.type);
  if (!prepared.success) return jsonResponse({ error: prepared.error }, 400, session);

  const mutationDb = env.DB.withSession("first-primary");
  const previous = await getProfile(mutationDb, session.user.id);
  const previousKey = previous?.profile_image_r2_key ?? null;
  const userHash = await profileImageUserHash(session.user.id);
  const { key, object } = await putUniqueProfileImageObject(env, {
    userId: session.user.id,
    userHash,
    bytes,
    mimeType: prepared.mimeType,
    hash: prepared.hash,
  });

  let updateResult: D1Result;
  try {
    updateResult = await mutationDb.prepare(
      `update users
       set profile_image_mime = ?1,
           profile_image_hash = ?2,
           profile_image_r2_key = ?3,
           profile_image_r2_etag = ?4,
           profile_image_size = ?5,
           updated_at = ?6
       where id = ?7
         and profile_image_r2_key is ?8`,
    )
      .bind(
        prepared.mimeType,
        prepared.hash,
        key,
        object.httpEtag ?? object.etag ?? null,
        bytes.byteLength,
        Date.now(),
        session.user.id,
        previousKey,
      )
      .run();
  } catch (error) {
    const pointer = await readProfilePhotoPointerForReconciliation(
      env.DB,
      session.user.id,
      "upload",
    );
    if (pointer.known && pointer.key === key) {
      scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
      return jsonResponse({ profileImageHash: prepared.hash }, 200, session);
    }
    if (!pointer.known) {
      // The D1 mutation may have committed even though its result was lost.
      // Retaining this request's unique object is safer than deleting a
      // possibly committed photo. A later successful replacement can collect
      // it through the normal previous-object cleanup path.
      throw error;
    }
    await deleteUncommittedProfileImageObject(env, key);
    if (pointer.key !== previousKey) {
      // Whether this write committed briefly or lost the CAS, the previously
      // observed object is no longer current at reconciliation time.
      scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
      return profilePhotoConflictResponse(session);
    }
    throw error;
  }

  if (updateResult.meta.changes === 0) {
    await deleteUncommittedProfileImageObject(env, key);
    return profilePhotoConflictResponse(session);
  }
  if (updateResult.meta.changes !== 1) {
    console.error(
      JSON.stringify({
        event: "profile_photo_upload_invalid_d1_change_count",
        changes: updateResult.meta.changes,
      }),
    );
    const pointer = await readProfilePhotoPointerForReconciliation(
      env.DB,
      session.user.id,
      "upload",
    );
    if (pointer.known && pointer.key === key) {
      scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
      return jsonResponse({ profileImageHash: prepared.hash }, 200, session);
    }
    if (pointer.known) {
      await deleteUncommittedProfileImageObject(env, key);
      if (pointer.key !== previousKey) {
        scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
        return profilePhotoConflictResponse(session);
      }
    }
    throw new Error("Profile photo update returned an invalid D1 change count.");
  }
  scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
  return jsonResponse({ profileImageHash: prepared.hash }, 200, session);
}

async function deleteProfilePhoto(
  env: AccountApiEnv,
  session: NativeAuthenticatedSession,
  ctx: ExecutionContext,
) {
  const mutationDb = env.DB.withSession("first-primary");
  const previous = await getProfile(mutationDb, session.user.id);
  const previousKey = previous?.profile_image_r2_key ?? null;
  let updateResult: D1Result;
  try {
    updateResult = await mutationDb.prepare(
      `update users
       set profile_image_mime = null,
           profile_image_hash = null,
           profile_image_r2_key = null,
           profile_image_r2_etag = null,
           profile_image_size = null,
           updated_at = ?1
       where id = ?2
         and profile_image_r2_key is ?3`,
    )
      .bind(Date.now(), session.user.id, previousKey)
      .run();
  } catch (error) {
    const pointer = await readProfilePhotoPointerForReconciliation(
      env.DB,
      session.user.id,
      "delete",
    );
    if (!pointer.known) throw error;
    if (pointer.key === null) {
      scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
      return jsonResponse({ profileImageHash: null }, 200, session);
    }
    if (pointer.key !== previousKey) {
      scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
      return profilePhotoConflictResponse(session);
    }
    throw error;
  }

  if (updateResult.meta.changes === 0) return profilePhotoConflictResponse(session);
  if (updateResult.meta.changes !== 1) {
    console.error(
      JSON.stringify({
        event: "profile_photo_delete_invalid_d1_change_count",
        changes: updateResult.meta.changes,
      }),
    );
    const pointer = await readProfilePhotoPointerForReconciliation(
      env.DB,
      session.user.id,
      "delete",
    );
    if (pointer.known && pointer.key === null) {
      scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
      return jsonResponse({ profileImageHash: null }, 200, session);
    }
    if (pointer.known && pointer.key !== previousKey) {
      scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
      return profilePhotoConflictResponse(session);
    }
    throw new Error("Profile photo delete returned an invalid D1 change count.");
  }
  scheduleObsoleteProfileImageDelete(env, ctx, previousKey);
  return jsonResponse({ profileImageHash: null }, 200, session);
}

async function putUniqueProfileImageObject(
  env: AccountApiEnv,
  input: {
    userId: string;
    userHash: string;
    bytes: Uint8Array;
    mimeType: string;
    hash: string;
  },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const key = await profileImageObjectKey(input.userId, input.hash);
    const object = await env.PROFILE_IMAGES_R2_BUCKET.put(key, input.bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: input.mimeType, cacheControl: "private, max-age=3600" },
      customMetadata: { kind: "profile-image", userHash: input.userHash, sha256: input.hash },
      sha256: input.hash,
      storageClass: "Standard",
    });
    if (object) return { key, object };
  }
  throw new Error("Unable to allocate a unique profile image object key.");
}

async function deleteUncommittedProfileImageObject(env: AccountApiEnv, key: string) {
  try {
    await env.PROFILE_IMAGES_R2_BUCKET.delete(key);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "profile_photo_uncommitted_r2_delete_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    throw error;
  }
}

function scheduleObsoleteProfileImageDelete(
  env: AccountApiEnv,
  ctx: ExecutionContext,
  key: string | null,
) {
  if (!key || !isValidProfileImageObjectKey(key)) return;
  ctx.waitUntil(
    env.PROFILE_IMAGES_R2_BUCKET.delete(key).catch((error) => {
      console.error(
        JSON.stringify({
          event: "profile_photo_obsolete_r2_delete_failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }),
  );
}

async function readProfilePhotoPointerForReconciliation(
  db: D1Database,
  userId: string,
  operation: "upload" | "delete",
): Promise<{ known: true; key: string | null } | { known: false }> {
  try {
    // A new primary-anchored session avoids treating a stale replica read as
    // proof that an ambiguously failed mutation did not commit.
    const current = await getProfile(db.withSession("first-primary"), userId);
    return { known: true, key: current?.profile_image_r2_key ?? null };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "profile_photo_d1_reconciliation_failed",
        operation,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return { known: false };
  }
}

function profilePhotoConflictResponse(session: NativeAuthenticatedSession) {
  return jsonResponse(
    {
      error: "Your profile photo changed while this request was processing. Please try again.",
      code: "profile_photo_conflict",
    },
    409,
    session,
  );
}

async function getProfile(
  db: Pick<D1Database, "prepare"> | Pick<D1DatabaseSession, "prepare">,
  userId: string,
) {
  return db
    .prepare(
      `select
         id, name, email, image, score, preferred_language, date_of_birth, created_at,
         profile_image_mime, profile_image_hash, profile_image_r2_key,
         profile_image_r2_etag, profile_image_size
       from users where id = ?1 limit 1`,
    )
    .bind(userId)
    .first<ProfileRow>();
}

async function updateProfile(db: D1Database, userId: string, patch: ProfilePatch) {
  const setName = patch.name !== undefined;
  const setLanguage = patch.preferredLanguage !== undefined;
  const setDateOfBirth = patch.dateOfBirth !== undefined;
  await db
    .prepare(
      `update users set
         name = case when ?1 = 1 then ?2 else name end,
         preferred_language = case when ?3 = 1 then ?4 else preferred_language end,
         date_of_birth = case when ?5 = 1 then ?6 else date_of_birth end,
         date_of_birth_source = case when ?5 = 1 then case when ?6 is null then null else 'user' end else date_of_birth_source end,
         updated_at = ?7
       where id = ?8`,
    )
    .bind(
      setName ? 1 : 0,
      patch.name ?? null,
      setLanguage ? 1 : 0,
      patch.preferredLanguage ?? null,
      setDateOfBirth ? 1 : 0,
      patch.dateOfBirth ?? null,
      Date.now(),
      userId,
    )
    .run();
}

async function readProfilePatch(request: Request): Promise<ProfilePatch | null> {
  const value = await readBoundedJson(request, profileJsonLimit);
  if (!isRecord(value)) return null;
  const patch: ProfilePatch = {};

  if ("name" in value) {
    if (typeof value.name !== "string") return null;
    const name = value.name.trim();
    if (!name || name.length > 120) return null;
    patch.name = name;
  }
  if ("preferredLanguage" in value) {
    if (typeof value.preferredLanguage !== "string" || !isSupportedLanguage(value.preferredLanguage)) return null;
    patch.preferredLanguage = value.preferredLanguage;
  }
  if ("dateOfBirth" in value) {
    if (value.dateOfBirth === null || value.dateOfBirth === "") {
      patch.dateOfBirth = null;
    } else {
      const validated = validateDateOfBirth(value.dateOfBirth);
      if (!validated.success) return null;
      patch.dateOfBirth = validated.value;
    }
  }
  if (Object.keys(patch).length === 0) return null;
  return patch;
}

async function serializeProfile(row: ProfileRow, session: NativeAuthenticatedSession, env: AccountApiEnv) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image,
    score: row.score,
    preferredLanguage: row.preferred_language,
    dateOfBirth: row.date_of_birth,
    createdAt: new Date(row.created_at),
    profileImageHash:
      row.profile_image_hash && row.profile_image_r2_key && row.profile_image_mime
        ? row.profile_image_hash
        : null,
    age: calculateAge(row.date_of_birth),
    isAdmin: await isNativeAdmin(session, env),
  };
}

function writeFreezeResponse(
  env: Pick<AccountApiEnv, "APP_WRITE_FREEZE" | "APP_WRITE_FREEZE_RETRY_AFTER_SECONDS">,
  surface: string,
  session?: NativeAuthenticatedSession,
) {
  if (!isWriteFreezeEnabled(env)) return null;
  const retryAfter = boundedPositiveInteger(env.APP_WRITE_FREEZE_RETRY_AFTER_SECONDS, 300, 3_600);
  const headers = privateNoStoreHeaders({
    "content-type": "application/json; charset=utf-8",
    "retry-after": String(retryAfter),
  });
  if (session) appendNativeSessionRefresh(headers, session);
  return new Response(
    JSON.stringify({
      error: "The service is temporarily read-only while a migration is in progress.",
      code: "write_freeze_active",
      surface,
    }),
    {
      status: 503,
      headers,
    },
  );
}

function isWriteFreezeEnabled(env: Pick<AccountApiEnv, "APP_WRITE_FREEZE">) {
  return writeFreezeValues.has(env.APP_WRITE_FREEZE.trim().toLowerCase());
}

function isAuthenticationWrite(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return true;
  return new URL(request.url).pathname.startsWith("/api/auth/callback/");
}

async function readBoundedBytes(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function authConfigurationAvailable(env: NativeAuthEnv) {
  return Boolean(env.AUTH_SECRET && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET && authBaseUrl(env));
}

function authBaseUrl(env: NativeAuthEnv) {
  return env.BETTER_AUTH_URL || env.AUTH_URL || env.APP_URL;
}

function trustedOrigins(baseUrl: string) {
  const origins = new Set([
    "https://inspirlearning.com",
    "https://www.inspirlearning.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
  ]);
  try {
    origins.add(new URL(baseUrl).origin);
  } catch {
    // The native handler rejects an invalid base URL; the canonical origins stay bounded.
  }
  return [...origins];
}

function isAllowedSameOrigin(request: Request, env: NativeAuthEnv) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set<string>();
  for (const value of [request.url, env.APP_URL, env.AUTH_URL, env.BETTER_AUTH_URL]) {
    try {
      allowed.add(new URL(value).origin);
    } catch {
      // Ignore malformed optional origins and fail closed if nothing matches.
    }
  }
  return allowed.has(origin);
}

function isStrictOAuthInitiationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    if (origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function jsonResponse(
  body: Readonly<Record<string, unknown>>,
  status: number,
  session?: NativeAuthenticatedSession,
) {
  const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
  if (session) appendNativeSessionRefresh(headers, session);
  return new Response(JSON.stringify(body), { status, headers });
}

function unauthorizedResponse() {
  const headers = privateNoStoreHeaders({ "content-type": "application/json; charset=utf-8" });
  expireNativeAuthCookies(headers);
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
}

function methodNotAllowed(allow: string) {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: privateNoStoreHeaders({
      allow,
      "content-type": "application/json; charset=utf-8",
    }),
  });
}

function isSupportedLanguage(value: string): value is (typeof supportedLanguages)[number] {
  return supportedLanguages.some((language) => language === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedPositiveInteger(value: string, fallback: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function boundedString(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) return null;
  return value;
}

function optionalBoundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function boundedOAuthParameter(value: string | null, minimum: number, maximum: number) {
  if (!value || value.length < minimum || value.length > maximum || !/^[\x21-\x7e]+$/.test(value)) {
    return null;
  }
  return value;
}

function finiteInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function constantTimeStringEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
