import { guestFingerprintKeyFromHeaders, requestIpFromHeaders } from "@/lib/guest-chat/safety";
import { consumeFixedWindowQuotaOrThrow, numberFromEnv } from "@/lib/utils/rate-limit";

const GAME_RESULT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GAME_RESULT_IP_LIMIT = 120;
const DEFAULT_GAME_RESULT_FINGERPRINT_LIMIT = 60;

export type GameResultQuota =
  | { ok: true }
  | { ok: false; bucket: "edge" | "ip" | "fingerprint"; retryAfterSeconds: number };

export async function consumeGameResultGuestQuota(request: Request): Promise<GameResultQuota> {
  // Cloudflare sets cf-connecting-ip at the trusted edge. Forwarded headers are
  // useful in local previews only and must not create spoofable production buckets.
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim() || null;
  if (!cloudflareIp && process.env.NODE_ENV === "production") {
    console.error("game_result_authoritative_ip_missing");
    return { ok: false, bucket: "edge", retryAfterSeconds: 60 };
  }
  const ip = cloudflareIp ?? (process.env.NODE_ENV === "production" ? null : requestIpFromHeaders(request.headers));
  try {
    if (ip) {
      const ipQuota = await consumeFixedWindowQuotaOrThrow(
        `game-results:ip:${await sha256Hex(`ip:${ip}`)}`,
        numberFromEnv("RATE_LIMIT_GAME_RESULT_IP_DAILY", DEFAULT_GAME_RESULT_IP_LIMIT),
        GAME_RESULT_QUOTA_WINDOW_MS,
      );
      if (!ipQuota.ok) {
        return { ok: false, bucket: "ip", retryAfterSeconds: ipQuota.retryAfterSeconds };
      }
    }

    const guestFingerprint = await guestFingerprintKeyFromHeaders(request.headers, ip);
    const fingerprintHash = guestFingerprint.slice(guestFingerprint.lastIndexOf(":") + 1);
    const fingerprintQuota = await consumeFixedWindowQuotaOrThrow(
      `game-results:fingerprint:${fingerprintHash}`,
      numberFromEnv("RATE_LIMIT_GAME_RESULT_FINGERPRINT_DAILY", DEFAULT_GAME_RESULT_FINGERPRINT_LIMIT),
      GAME_RESULT_QUOTA_WINDOW_MS,
    );
    if (!fingerprintQuota.ok) {
      return {
        ok: false,
        bucket: "fingerprint",
        retryAfterSeconds: fingerprintQuota.retryAfterSeconds,
      };
    }
    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "game_result_quota_unavailable",
        posture: "fail_closed",
        error: error instanceof Error ? error.message : "Unknown D1 quota failure",
      }),
    );
    return { ok: false, bucket: "edge", retryAfterSeconds: 60 };
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
