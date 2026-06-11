import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getUserPhotoById } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserPhotoById(session.user.id);
  if (!user?.profileImageData || !user.profileImageMime) {
    return NextResponse.json({ error: "No cached photo" }, { status: 404 });
  }

  const bytes = Buffer.from(user.profileImageData, "base64");
  return new Response(bytes, {
    headers: {
      "content-type": user.profileImageMime,
      "cache-control": "private, max-age=3600",
    },
  });
}
