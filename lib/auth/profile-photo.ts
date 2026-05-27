import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

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
    const [existing] = await db
      .select({
        profileImageHash: users.profileImageHash,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing?.profileImageHash === hash) {
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

    await db
      .update(users)
      .set({
        image: imageUrl,
        profilePictureUrl: imageUrl,
        profileImageData: bytes.toString("base64"),
        profileImageMime: contentType.split(";")[0],
        profileImageHash: hash,
        profilePictureDownloadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } catch {
    // Profile photos are a nice-to-have cache; login should never fail because of it.
  }
}
