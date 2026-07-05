import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { clearUserProfilePhoto, getUserPhotoById, updateUserProfilePhoto } from "@/lib/db/queries";
import { prepareProfileImage } from "@/lib/profile/photo";
import { deleteProfileImageObject, getProfileImageObject, putProfileImageObject } from "@/lib/profile/photo-store";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserPhotoById(session.user.id);
  if (!user?.profileImageMime) {
    return NextResponse.json({ error: "No cached photo" }, { status: 404 });
  }

  if (user.profileImageR2Key) {
    const object = await getProfileImageObject(user.profileImageR2Key);
    if (object?.body) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-type", user.profileImageMime);
      headers.set("cache-control", "private, max-age=3600");
      if (object.httpEtag) headers.set("etag", object.httpEtag);
      return new Response(object.body, { headers });
    }
  }

  if (!user.profileImageData) {
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

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const prepared = prepareProfileImage(bytes, photo.type);
  if (!prepared.success) {
    return NextResponse.json({ error: prepared.error }, { status: 400 });
  }

  const previous = await getUserPhotoById(session.user.id);
  const object = await putProfileImageObject({
    userId: session.user.id,
    bytes,
    mimeType: prepared.mimeType,
    hash: prepared.hash,
  });
  let user: Awaited<ReturnType<typeof updateUserProfilePhoto>>;
  try {
    user = await updateUserProfilePhoto(session.user.id, {
      profileImageMime: prepared.mimeType,
      profileImageHash: prepared.hash,
      profileImageR2Key: object.key,
      profileImageR2Etag: object.etag,
      profileImageSize: object.size,
    });
  } catch (error) {
    await deleteProfileImageObject(object.key).catch((deleteError) =>
      console.warn("profile_photo_new_r2_orphan_delete_failed", {
        userId: session.user.id,
        error: deleteError instanceof Error ? deleteError.message : String(deleteError),
      }),
    );
    throw error;
  }
  if (previous?.profileImageR2Key && previous.profileImageR2Key !== object.key) {
    await deleteProfileImageObject(previous.profileImageR2Key).catch((error) =>
      console.warn("profile_photo_previous_r2_delete_failed", {
        userId: session.user.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return NextResponse.json({ profileImageHash: user?.profileImageHash ?? null });
}

export async function DELETE() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("profile-photo");
  if (freeze) return freeze;

  const previous = await getUserPhotoById(session.user.id);
  await clearUserProfilePhoto(session.user.id);
  if (previous?.profileImageR2Key) {
    await deleteProfileImageObject(previous.profileImageR2Key).catch((error) =>
      console.warn("profile_photo_r2_delete_failed", {
        userId: session.user.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return NextResponse.json({ profileImageHash: null });
}
