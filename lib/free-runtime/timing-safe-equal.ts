export type TimingSafeSubtleCrypto = Pick<SubtleCrypto, "digest"> & {
  timingSafeEqual(
    left: ArrayBuffer | ArrayBufferView,
    right: ArrayBuffer | ArrayBufferView,
  ): boolean;
};

export type TimingSafeDigestSubtleCrypto = Pick<SubtleCrypto, "digest"> & {
  timingSafeEqual?: TimingSafeSubtleCrypto["timingSafeEqual"];
};

export function hasTimingSafeEqual(
  subtle: TimingSafeDigestSubtleCrypto,
): subtle is TimingSafeSubtleCrypto {
  return "timingSafeEqual" in subtle && typeof subtle.timingSafeEqual === "function";
}

export function timingSafeFixedBytesEqual(
  left: Uint8Array,
  right: Uint8Array,
  subtle: TimingSafeDigestSubtleCrypto = crypto.subtle,
) {
  return left.byteLength === right.byteLength &&
    hasTimingSafeEqual(subtle) &&
    subtle.timingSafeEqual(left, right);
}

export async function timingSafeDigestEqual(
  left: string,
  right: string,
  subtle: TimingSafeDigestSubtleCrypto = crypto.subtle,
) {
  if (!hasTimingSafeEqual(subtle)) return false;
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    subtle.digest("SHA-256", encoder.encode(left)),
    subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return subtle.timingSafeEqual(leftDigest, rightDigest);
}
