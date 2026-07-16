import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { hasTimingSafeEqual } from "../lib/free-runtime/timing-safe-equal";

const subtle = crypto.subtle;
if (!hasTimingSafeEqual(subtle)) {
  Object.defineProperty(subtle, "timingSafeEqual", {
    configurable: true,
    value(
      left: ArrayBuffer | ArrayBufferView,
      right: ArrayBuffer | ArrayBufferView,
    ) {
      const leftBytes = bufferView(left);
      const rightBytes = bufferView(right);
      return leftBytes.byteLength === rightBytes.byteLength &&
        nodeTimingSafeEqual(leftBytes, rightBytes);
    },
  });
}

function bufferView(value: ArrayBuffer | ArrayBufferView) {
  return ArrayBuffer.isView(value)
    ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    : Buffer.from(value);
}
