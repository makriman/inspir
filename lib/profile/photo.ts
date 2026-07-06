export const maxProfileImageBytes = 1_000_000;
export const maxProfileImageUploadRequestBytes = maxProfileImageBytes + 64_000;

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

export async function prepareProfileImage(bytes: Uint8Array, _providedMimeType?: string | null): Promise<PreparedProfileImage> {
  void _providedMimeType;
  if (bytes.length === 0) {
    return { success: false, error: "Choose an image file." };
  }

  if (bytes.length > maxProfileImageBytes) {
    return { success: false, error: "Choose an image under 1 MB." };
  }

  const detectedMimeType = detectImageMimeType(bytes);
  const mimeType = detectedMimeType;
  if (!mimeType || !supportedProfileImageTypes.has(mimeType)) {
    return { success: false, error: "Use a JPG, PNG, or WebP image." };
  }

  return {
    success: true,
    hash: await sha256Hex(bytes),
    mimeType,
    byteLength: bytes.length,
  };
}

export function isOversizedProfileImageUpload(contentLength: string | null) {
  if (!contentLength) return false;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > maxProfileImageUploadRequestBytes;
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

async function sha256Hex(bytes: Uint8Array) {
  const digestSource = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestSource).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
