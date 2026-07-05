import assert from "node:assert/strict";
import test from "node:test";
import { createHash, stableStringify } from "../scripts/cloudflare/migration-config";
import { exactMetadataProblems, remoteVectorRowProblems } from "../scripts/cloudflare/vectorize-remote-validation";

test("remote vector validation requires exact metadata parity", () => {
  assert.deepEqual(
    exactMetadataProblems(
      { namespace: "user_memories", rowId: "m1", userId: "u1", stale: "remote-only" },
      { namespace: "user_memories", rowId: "m1", userId: "u1" },
    ),
    ["metadata.stale unexpected"],
  );
});

test("remote vector validation rejects missing and mismatched metadata", () => {
  assert.deepEqual(
    exactMetadataProblems(
      { namespace: "user_memories", rowId: "wrong" },
      { namespace: "user_memories", rowId: "m1", userId: "u1" },
    ),
    ["metadata.userId missing", "metadata.rowId mismatch"],
  );
});

test("remote vector validation accepts matching row values and metadata", () => {
  const values = Array.from({ length: 512 }, (_, index) => index / 512);
  const expected = {
    namespace: "chat_memory_turns",
    valuesSha256: sha256Stable(values),
    metadata: { namespace: "chat_memory_turns", rowId: "turn1", userId: "u1", chatId: "c1" },
  };

  assert.deepEqual(
    remoteVectorRowProblems(
      {
        namespace: "chat_memory_turns",
        values,
        metadata: { namespace: "chat_memory_turns", rowId: "turn1", userId: "u1", chatId: "c1" },
      },
      expected,
    ),
    [],
  );
});

function sha256Stable(value: unknown) {
  return createHash().update(stableStringify(value)).digest("hex");
}
