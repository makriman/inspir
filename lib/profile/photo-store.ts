import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isValidProfileImageObjectKey, profileImageObjectKey, profileImageUserHash } from "@/lib/profile/photo-key";
import { getRuntimeCloudflareEnv } from "@/lib/runtime/cloudflare";

const privateProfileImageCacheControl = "private, max-age=3600";

export type StoredProfileImageObject = {
  key: string;
  etag: string | null;
  size: number;
};

export async function putProfileImageObject(input: {
  userId: string;
  bytes: Uint8Array;
  mimeType: string;
  hash: string;
}) {
  const key = profileImageObjectKey(input.userId, input.hash);
  const body = new Uint8Array(input.bytes);
  const object = await getProfileImagesBucket().put(key, body, {
    httpMetadata: {
      contentType: input.mimeType,
      cacheControl: privateProfileImageCacheControl,
    },
    customMetadata: {
      kind: "profile-image",
      userHash: profileImageUserHash(input.userId),
      sha256: input.hash,
    },
    sha256: input.hash,
    storageClass: "Standard",
  });

  return {
    key,
    etag: object?.httpEtag ?? object?.etag ?? null,
    size: input.bytes.byteLength,
  } satisfies StoredProfileImageObject;
}

export async function getProfileImageObject(key: string) {
  if (!isValidProfileImageObjectKey(key)) return null;
  return getProfileImagesBucket().get(key);
}

export async function deleteProfileImageObject(key: string | null | undefined) {
  if (!key || !isValidProfileImageObjectKey(key)) return;
  await getProfileImagesBucket().delete(key);
}

function getProfileImagesBucket() {
  const runtimeBucket = getRuntimeCloudflareEnv()?.PROFILE_IMAGES_R2_BUCKET;
  if (runtimeBucket) return runtimeBucket;
  return getCloudflareContext().env.PROFILE_IMAGES_R2_BUCKET;
}
