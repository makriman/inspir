const truthyWriteFreezeValues = new Set(["1", "true", "yes", "on"]);
const defaultRetryAfterSeconds = 300;

export const writeFreezeErrorCode = "write_freeze_active";

export class WriteFreezeError extends Error {
  readonly code = writeFreezeErrorCode;
  readonly surface: string;

  constructor(surface = "app") {
    super(`Writes are temporarily paused for migration: ${surface}`);
    this.name = "WriteFreezeError";
    this.surface = surface;
  }
}

export function isWriteFreezeEnabled(env: Record<string, string | undefined> = process.env) {
  return truthyWriteFreezeValues.has((env.APP_WRITE_FREEZE ?? env.WRITE_FREEZE ?? "").trim().toLowerCase());
}

export function assertWritesAllowed(surface?: string) {
  if (isWriteFreezeEnabled()) throw new WriteFreezeError(surface);
}

export function writeFreezeResponse(surface?: string): Response | null {
  if (!isWriteFreezeEnabled()) return null;
  return Response.json(
    {
      error: "The service is temporarily read-only while a migration is in progress.",
      code: writeFreezeErrorCode,
      surface: surface ?? "app",
    },
    {
      status: 503,
      headers: {
        "Retry-After": String(writeFreezeRetryAfterSeconds()),
      },
    },
  );
}

function writeFreezeRetryAfterSeconds() {
  const value = Number(process.env.APP_WRITE_FREEZE_RETRY_AFTER_SECONDS ?? defaultRetryAfterSeconds);
  if (!Number.isFinite(value) || value <= 0) return defaultRetryAfterSeconds;
  return Math.floor(value);
}
