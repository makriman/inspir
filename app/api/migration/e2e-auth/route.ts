export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const hiddenHeaders = {
  "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "cdn-cache-control": "private, no-store",
  "cloudflare-cdn-cache-control": "private, no-store",
  pragma: "no-cache",
} as const;

// Production owns this migration-only endpoint in the native Cloudflare
// Worker. Keep the dormant Next route permanently hidden so a future rollback
// cannot revive the retired profile-mutating test-auth implementation.
export function POST() {
  return Response.json({ error: "Not found" }, { status: 404, headers: hiddenHeaders });
}
