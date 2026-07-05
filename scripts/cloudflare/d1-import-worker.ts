type Env = {
  DB: D1Database;
  MIGRATION_IMPORT_TOKEN: string;
};

type ImportStatement = {
  sql: string;
  params?: unknown[];
};

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return Response.json({ error: "not_found" }, { status: 404 });
    if (!(await timingSafeBearerEquals(request.headers.get("authorization"), env.MIGRATION_IMPORT_TOKEN))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { statements?: ImportStatement[] };
    const statements = body.statements ?? [];
    if (!statements.length || statements.length > 100) {
      return Response.json({ error: "invalid_statement_count" }, { status: 400 });
    }

    try {
      const prepared = statements.map((statement) => env.DB.prepare(statement.sql).bind(...(statement.params ?? [])));
      const results = await env.DB.batch(prepared);
      const serializedResults = results.map((result) => ({
        success: result.success,
        error: result.error,
        meta: result.meta,
      }));
      const failed = serializedResults.filter((result) => !result.success);
      if (failed.length) {
        return Response.json({ ok: false, error: "statement_failed", results: serializedResults }, { status: 500 });
      }
      return Response.json({ ok: true, results: serializedResults });
    } catch (error) {
      return Response.json(
        { ok: false, error: "batch_failed", message: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;

export async function timingSafeBearerEquals(auth: string | null, secret: string) {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(auth ?? "")),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${secret}`)),
  ]);

  return timingSafeDigestEquals(actualHash, expectedHash);
}

function timingSafeDigestEquals(left: ArrayBuffer, right: ArrayBuffer) {
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean;
  };

  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(left, right);
  }

  return timingSafeBytesEqual(new Uint8Array(left), new Uint8Array(right));
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array) {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
