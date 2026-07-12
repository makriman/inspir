const betterAuthCookiePrefix = "better-auth";
const sessionCookieNames = [
  `__Secure-${betterAuthCookiePrefix}.session_token`,
  `${betterAuthCookiePrefix}.session_token`,
] as const;

const bootstrapAdminEmails = new Set(["makridroid@gmail.com"]);
const sessionDurationMs = 30 * 24 * 60 * 60 * 1_000;
const sessionRefreshAgeMs = 24 * 60 * 60 * 1_000;
const writeFreezeValues = new Set(["1", "true", "yes", "on"]);
let cachedHmacKey: { secret: string; key: CryptoKey } | null = null;

export type NativeSessionEnv = Pick<CloudflareEnv, "DB" | "AUTH_SECRET" | "ADMIN_EMAILS"> & {
  APP_WRITE_FREEZE?: string;
  WRITE_FREEZE?: string;
};

export type NativeAuthenticatedSession = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    emailVerified: boolean;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  };
  refreshedSessionCookie: string | null;
};

type NativeSessionRow = {
  session_id: string | null;
  session_token: string;
  user_id: string;
  expires: number;
  session_created_at: number;
  session_updated_at: number;
  ip_address: string | null;
  user_agent: string | null;
  user_name: string | null;
  user_email: string;
  user_email_verified: number;
  user_image: string | null;
  user_created_at: number;
  user_updated_at: number;
};

export async function requireNativeSession(
  request: Request,
  env: NativeSessionEnv,
  options: { refresh?: boolean } = {},
): Promise<NativeAuthenticatedSession | null> {
  const token = await readVerifiedNativeSessionToken(request, env.AUTH_SECRET);
  if (!token) return null;

  const now = Date.now();
  const row = await env.DB.prepare(
    `select
       s.id as session_id,
       s.session_token,
       s.user_id,
       s.expires,
       s.created_at as session_created_at,
       s.updated_at as session_updated_at,
       s.ip_address,
       s.user_agent,
       u.name as user_name,
       u.email as user_email,
       u.email_verified as user_email_verified,
       u.image as user_image,
       u.created_at as user_created_at,
       u.updated_at as user_updated_at
     from sessions s
     inner join users u on u.id = s.user_id
     where s.session_token = ?1 and s.expires > ?2
     limit 1`,
  )
    .bind(token, now)
    .first<NativeSessionRow>();

  if (!row || !isNativeSessionRow(row)) return null;

  let expiresAtMs = row.expires;
  let updatedAtMs = row.session_updated_at;
  let refreshedSessionCookie: string | null = null;
  if (shouldRefreshNativeSession(updatedAtMs, now, env, options)) {
    expiresAtMs = now + sessionDurationMs;
    updatedAtMs = now;
    const result = await env.DB.prepare(
      `update sessions
       set expires = ?1, updated_at = ?2
       where session_token = ?3 and user_id = ?4 and expires > ?5`,
    )
      .bind(expiresAtMs, updatedAtMs, token, row.user_id, now)
      .run();
    if (result.meta.changes > 0) {
      refreshedSessionCookie = await buildNativeSessionCookie(token, env.AUTH_SECRET, request.url, expiresAtMs);
    } else {
      return null;
    }
  }

  return {
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email,
      emailVerified: row.user_email_verified === 1,
      image: row.user_image,
      createdAt: new Date(row.user_created_at),
      updatedAt: new Date(row.user_updated_at),
    },
    session: {
      id: row.session_id ?? row.session_token,
      token: row.session_token,
      userId: row.user_id,
      expiresAt: new Date(expiresAtMs),
      createdAt: new Date(row.session_created_at),
      updatedAt: new Date(updatedAtMs),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    },
    refreshedSessionCookie,
  };
}

export function shouldRefreshNativeSession(
  updatedAtMs: number,
  nowMs: number,
  env: Pick<NativeSessionEnv, "APP_WRITE_FREEZE" | "WRITE_FREEZE">,
  options: { refresh?: boolean } = {},
) {
  const freezeValue = env.APP_WRITE_FREEZE ?? env.WRITE_FREEZE ?? "";
  return (
    options.refresh !== false &&
    !writeFreezeValues.has(freezeValue.trim().toLowerCase()) &&
    nowMs - updatedAtMs >= sessionRefreshAgeMs
  );
}

export async function isNativeAdmin(
  session: NativeAuthenticatedSession,
  env: Pick<NativeSessionEnv, "DB" | "ADMIN_EMAILS">,
) {
  const email = normalizeEmail(session.user.email);
  if (!email) return false;
  if (bootstrapAdminEmails.has(email) || configuredAdminEmails(env.ADMIN_EMAILS).has(email)) return true;

  const row = await env.DB.prepare("select email from admin_users where email = ?1 limit 1")
    .bind(email)
    .first<{ email: string }>();
  return row?.email === email;
}

export function privateNoStoreHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("cache-control", "private, no-store, max-age=0, must-revalidate");
  headers.set("cdn-cache-control", "private, no-store");
  headers.set("cloudflare-cdn-cache-control", "private, no-store");
  headers.set("expires", "0");
  headers.set("pragma", "no-cache");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

export function appendNativeSessionRefresh(headers: Headers, session: NativeAuthenticatedSession) {
  if (session.refreshedSessionCookie) headers.append("set-cookie", session.refreshedSessionCookie);
}

export async function readVerifiedNativeSessionToken(request: Request, secret: string) {
  if (!secret) return null;
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader || cookieHeader.length > 16_384) return null;
  const cookies = parseCookieHeader(cookieHeader);
  for (const name of sessionCookieNames) {
    const signedValue = cookies.get(name);
    if (!signedValue || signedValue.length > 2_048) continue;

    const token = await verifyNativeAuthValue(signedValue, secret);
    if (token && isBoundedSessionToken(token)) return token;
  }
  return null;
}

export async function buildNativeSessionCookie(
  token: string,
  secret: string,
  requestUrl: string,
  expiresAtMs: number,
) {
  const secure = new URL(requestUrl).protocol === "https:";
  const name = `${secure ? "__Secure-" : ""}${betterAuthCookiePrefix}.session_token`;
  const signedValue = await signNativeAuthValue(token, secret);
  return [
    `${name}=${encodeURIComponent(signedValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1_000))}`,
    `Expires=${new Date(expiresAtMs).toUTCString()}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export async function signNativeAuthValue(value: string, secret: string) {
  return `${value}.${await makeBetterAuthSignature(value, secret)}`;
}

export async function verifyNativeAuthValue(signedValue: string, secret: string) {
  if (!secret || signedValue.length > 4_096) return null;
  const separatorIndex = signedValue.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === signedValue.length - 1) return null;
  const value = signedValue.slice(0, separatorIndex);
  const signature = signedValue.slice(separatorIndex + 1);
  if (!value || signature.length > 256) return null;
  const expected = await makeBetterAuthSignature(value, secret);
  return constantTimeStringEqual(signature, expected) ? value : null;
}

export async function nativeAuthHmacHex(value: string, secret: string) {
  const signature = await makeNativeAuthHmac(value, secret);
  let hex = "";
  for (const byte of signature) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export async function nativeAuthHmacBytes(value: string, secret: string) {
  return makeNativeAuthHmac(value, secret);
}

export function expireNativeAuthCookies(headers: Headers, request?: Request) {
  const baseNames = [
    "session_token",
    "session_data",
    "account_data",
    "dont_remember",
    "state",
    "oauth_state",
  ] as const;
  const names = new Set<string>();
  for (const securePrefix of ["", "__Secure-"] as const) {
    for (const baseName of baseNames) {
      names.add(`${securePrefix}${betterAuthCookiePrefix}.${baseName}`);
    }
  }
  const cookieHeader = request?.headers.get("cookie");
  if (cookieHeader && cookieHeader.length <= 16_384) {
    for (const name of parseCookieHeader(cookieHeader).keys()) {
      if (
        /^(?:__Secure-)?better-auth\.(?:session_token|session_data(?:\.\d+)?|account_data(?:\.\d+)?|dont_remember|state|oauth_state)$/.test(
          name,
        )
      ) {
        names.add(name);
      }
    }
  }
  for (const name of names) expireCookie(headers, name);
}

function expireCookie(headers: Headers, name: string) {
  headers.append(
    "set-cookie",
    `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${
      name.startsWith("__Secure-") ? "; Secure" : ""
    }`,
  );
}

function parseCookieHeader(header: string) {
  const cookies = new Map<string, string>();
  for (const part of header.split(";", 80)) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    const encodedValue = part.slice(separatorIndex + 1).trim();
    if (!name || !encodedValue) continue;
    try {
      cookies.set(name, decodeURIComponent(encodedValue));
    } catch {
      cookies.set(name, encodedValue);
    }
  }
  return cookies;
}

function isBoundedSessionToken(token: string) {
  return token.length >= 16 && token.length <= 512 && /^[A-Za-z0-9_-]+$/.test(token);
}

async function makeBetterAuthSignature(value: string, secret: string) {
  return bytesToBase64(await makeNativeAuthHmac(value, secret));
}

async function makeNativeAuthHmac(value: string, secret: string) {
  const key = await nativeAuthHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

async function nativeAuthHmacKey(secret: string) {
  if (cachedHmacKey?.secret === secret) return cachedHmacKey.key;
  // Cache only the resolved key. A promise created by one Worker invocation
  // must never be shared with a concurrent request context.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedHmacKey = { secret, key };
  return key;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

function configuredAdminEmails(value: string | undefined) {
  const emails = new Set<string>();
  for (const candidate of (value ?? "").split(",", 100)) {
    const normalized = normalizeEmail(candidate);
    if (normalized) emails.add(normalized);
  }
  return emails;
}

function normalizeEmail(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.includes("@") ? normalized : null;
}

function isNativeSessionRow(row: NativeSessionRow) {
  return (
    typeof row.session_token === "string" &&
    typeof row.user_id === "string" &&
    typeof row.user_email === "string" &&
    (row.user_email_verified === 0 || row.user_email_verified === 1) &&
    Number.isFinite(row.expires) &&
    Number.isFinite(row.session_created_at) &&
    Number.isFinite(row.session_updated_at) &&
    Number.isFinite(row.user_created_at) &&
    Number.isFinite(row.user_updated_at)
  );
}
