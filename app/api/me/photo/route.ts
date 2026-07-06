import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { clearUserProfilePhoto, getUserPhotoById, updateUserProfilePhoto } from "@/lib/db/queries";
import { isOversizedProfileImageUpload, prepareProfileImage } from "@/lib/profile/photo";
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

  if (!user.profileImageR2Key) {
    return NextResponse.json({ error: "No cached photo" }, { status: 404 });
  }
  return NextResponse.json({ error: "Cached photo is unavailable" }, { status: 404 });
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("profile-photo");
  if (freeze) return freeze;

  if (isOversizedProfileImageUpload(request.headers.get("content-length"))) {
    return NextResponse.json({ error: "Choose an image under 1 MB." }, { status: 413 });
  }

  const formData = await request.formData().catch(() => null);
  const photo = formData?.get("photo");
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  }

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const prepared = await prepareProfileImage(bytes, photo.type);
  if (!prepared.success) {
    return NextResponse.json({ error: prepared.error }, { status: 400 });
  }

  const previous = await getUserPhotoById(session.user.id);
  const { object, user } = await withProfilePhotoWriteRetry(async () => {
    const nextObject = await putProfileImageObject({
      userId: session.user.id,
      bytes,
      mimeType: prepared.mimeType,
      hash: prepared.hash,
    });
    try {
      const nextUser = await updateUserProfilePhoto(session.user.id, {
        profileImageMime: prepared.mimeType,
        profileImageHash: prepared.hash,
        profileImageR2Key: nextObject.key,
        profileImageR2Etag: nextObject.etag,
        profileImageSize: nextObject.size,
      });
      return { object: nextObject, user: nextUser };
    } catch (error) {
      await deleteProfileImageObject(nextObject.key).catch((deleteError) =>
        console.warn("profile_photo_new_r2_orphan_delete_failed", {
          userId: session.user.id,
          error: deleteError instanceof Error ? deleteError.message : String(deleteError),
        }),
      );
      throw error;
    }
  });
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

async function withProfilePhotoWriteRetry<T>(write: () => Promise<T>) {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      console.warn("profile_photo_write_retry", {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, 125 * attempt));
    }
  }
  throw lastError;
}
