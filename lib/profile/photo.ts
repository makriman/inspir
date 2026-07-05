import { createHash } from "node:crypto";

export const maxProfileImageBytes = 1_000_000;

const supportedProfileImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedProfileImage =
  | {
      success: true;
      hash: string;
      mimeType: string;
      byteLength: number;
    }
  | {
      success: false;
      error: string;
    };

export function prepareProfileImage(bytes: Uint8Array, providedMimeType?: string | null): PreparedProfileImage {
  if (bytes.length === 0) {
    return { success: false, error: "Choose an image file." };
  }

  if (bytes.length > maxProfileImageBytes) {
    return { success: false, error: "Choose an image under 1 MB." };
  }

  const detectedMimeType = detectImageMimeType(bytes);
  const mimeType = detectedMimeType ?? normalizeMimeType(providedMimeType);
  if (!mimeType || !supportedProfileImageTypes.has(mimeType)) {
    return { success: false, error: "Use a JPG, PNG, or WebP image." };
  }

  const buffer = Buffer.from(bytes);
  return {
    success: true,
    hash: createHash("sha256").update(buffer).digest("hex"),
    mimeType,
    byteLength: bytes.length,
  };
}

function normalizeMimeType(mimeType?: string | null) {
  return mimeType?.split(";")[0]?.trim().toLowerCase() || null;
}

function detectImageMimeType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
