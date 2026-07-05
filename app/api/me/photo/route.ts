import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { clearUserProfilePhoto, getUserPhotoById, updateUserProfilePhoto } from "@/lib/db/queries";
import { prepareProfileImage } from "@/lib/profile/photo";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

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

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("profile-photo");
  if (freeze) return freeze;

  const formData = await request.formData().catch(() => null);
  const photo = formData?.get("photo");
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  }

  const prepared = prepareProfileImage(new Uint8Array(await photo.arrayBuffer()), photo.type);
  if (!prepared.success) {
    return NextResponse.json({ error: prepared.error }, { status: 400 });
  }

  const user = await updateUserProfilePhoto(session.user.id, {
    profileImageData: prepared.base64,
    profileImageMime: prepared.mimeType,
    profileImageHash: prepared.hash,
  });

  return NextResponse.json({ profileImageHash: user?.profileImageHash ?? null });
}

export async function DELETE() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("profile-photo");
  if (freeze) return freeze;

  await clearUserProfilePhoto(session.user.id);
  return NextResponse.json({ profileImageHash: null });
}
