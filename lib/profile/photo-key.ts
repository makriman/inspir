import { createHash } from "node:crypto";

const profileImagePrefix = "profile-images/users";

export function profileImageUserHash(userId: string) {
  return createHash("sha256").update(userId).digest("hex");
}

export function profileImageObjectKey(userId: string, hash: string) {
  const userHash = profileImageUserHash(userId);
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
