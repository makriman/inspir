import { isWriteFreezeEnabled, writeFreezeErrorCode } from "@/lib/migration/write-freeze";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const writeFreezeActive = isWriteFreezeEnabled();
  return Response.json(
    {
      ok: writeFreezeActive,
      writeFreezeActive,
      code: writeFreezeActive ? writeFreezeErrorCode : "write_freeze_inactive",
    },
    {
      status: writeFreezeActive ? 200 : 409,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
