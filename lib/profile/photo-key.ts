const profileImagePrefix = "profile-images/users";

export async function profileImageUserHash(userId: string) {
  const encoded = new TextEncoder().encode(userId);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function profileImageObjectKey(userId: string, hash: string) {
  const userHash = await profileImageUserHash(userId);
  // The final component is unique to this upload. Content-addressed keys made
  // two concurrent requests share an R2 object, so the losing request could
  // delete the object committed by the winner while cleaning up its D1 CAS
  // failure. Historical keys without this component remain valid below.
  return `${profileImagePrefix}/${userHash.slice(0, 2)}/${userHash}/${hash}/${crypto.randomUUID()}`;
}

export function isValidProfileImageObjectKey(key: string) {
  return (
    key.startsWith(`${profileImagePrefix}/`) &&
    !key.includes("..") &&
    !key.startsWith("/") &&
    new TextEncoder().encode(key).byteLength <= 1024
  );
}
