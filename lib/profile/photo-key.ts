const profileImagePrefix = "profile-images/users";

export async function profileImageUserHash(userId: string) {
  const encoded = new TextEncoder().encode(userId);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function profileImageObjectKey(userId: string, hash: string) {
  const userHash = await profileImageUserHash(userId);
  return `${profileImagePrefix}/${userHash.slice(0, 2)}/${userHash}/${hash}`;
}

export function isValidProfileImageObjectKey(key: string) {
  return (
    key.startsWith(`${profileImagePrefix}/`) &&
    !key.includes("..") &&
    !key.startsWith("/") &&
    new TextEncoder().encode(key).byteLength <= 1024
  );
}
