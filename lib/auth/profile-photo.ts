import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { deleteProfileImageObject, putProfileImageObject } from "@/lib/profile/photo-store";

const MAX_PROFILE_IMAGE_BYTES = 512_000;

export async function refreshProfilePhoto(userId: string | undefined, imageUrl: string | null | undefined) {
  if (!userId || !imageUrl) return;

  try {
    const response = await fetch(imageUrl, {
      headers: { "user-agent": "inspir-profile-photo-cache" },
      cache: "no-store",
    });
    if (!response.ok) return;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_PROFILE_IMAGE_BYTES) return;

    const hash = createHash("sha256").update(bytes).digest("hex");
    const mimeType = contentType.split(";")[0] ?? "image/jpeg";
    const [existing] = await db
      .select({
        profileImageHash: users.profileImageHash,
        profileImageR2Key: users.profileImageR2Key,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing?.profileImageHash === hash && existing.profileImageR2Key) {
      await db
        .update(users)
        .set({
          image: imageUrl,
          profilePictureUrl: imageUrl,
          profilePictureDownloadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      return;
    }

    const object = await putProfileImageObject({
      userId,
      bytes,
      mimeType,
      hash,
    });

    try {
      await db
        .update(users)
        .set({
          image: imageUrl,
          profilePictureUrl: imageUrl,
          profileImageData: null,
          profileImageMime: mimeType,
          profileImageHash: hash,
          profileImageR2Key: object.key,
          profileImageR2Etag: object.etag,
          profileImageSize: object.size,
          profilePictureDownloadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } catch (error) {
      await deleteProfileImageObject(object.key).catch(() => undefined);
      throw error;
    }
    if (existing?.profileImageR2Key && existing.profileImageR2Key !== object.key) {
      await deleteProfileImageObject(existing.profileImageR2Key).catch(() => undefined);
    }
  } catch {
    // Profile photos are a nice-to-have cache; login should never fail because of it.
  }
}
