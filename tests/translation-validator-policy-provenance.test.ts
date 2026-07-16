import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCurrentLongTailValidatorPolicy,
  calculateLongTailValidatorPolicySha256,
  createLongTailValidatorPolicyProvenance,
  LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS,
} from "../scripts/translation-validator-policy-provenance";

function temporaryPolicyRepository(t: test.TestContext) {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "inspir-validator-policy-"),
  );
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const [index, relativePath] of
    LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS.entries()) {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `export const fixture${index} = ${index};\n`, {
      mode: 0o600,
    });
  }
  return root;
}

test("validator policy provenance binds every exact dependency byte", (t) => {
  const root = temporaryPolicyRepository(t);
  const provenance = createLongTailValidatorPolicyProvenance(root);
  assert.deepEqual(
    provenance.files.map((file) => file.relativePath),
    LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS,
  );
  assert.equal(
    provenance.validatorPolicySha256,
    calculateLongTailValidatorPolicySha256(provenance.files),
  );
  assert.doesNotThrow(() =>
    assertCurrentLongTailValidatorPolicy(root, provenance)
  );

  const changed = path.join(
    root,
    LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS[1],
  );
  writeFileSync(changed, "export const changed = true;\n", { mode: 0o600 });
  assert.throws(
    () => assertCurrentLongTailValidatorPolicy(root, provenance),
    /changed after provenance creation/,
  );
});

test("validator policy digest has a fixed cross-language byte vector", () => {
  assert.equal(
    calculateLongTailValidatorPolicySha256([
      { relativePath: "a.ts", bytes: 0, sha256: "0".repeat(64) },
      { relativePath: "b.ts", bytes: 12, sha256: "f".repeat(64) },
    ]),
    "0508b761c20bc1d51e95bc0b11d558b09ac99e5f40ca85cf4ecbe577255177cf",
  );
});

test("validator policy provenance rejects symlinked dependencies", (t) => {
  const root = temporaryPolicyRepository(t);
  const relativePath = LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS[2];
  const dependency = path.join(root, relativePath);
  const replacement = path.join(root, "replacement.ts");
  writeFileSync(replacement, "export const replacement = true;\n", {
    mode: 0o600,
  });
  unlinkSync(dependency);
  symlinkSync(replacement, dependency);
  assert.throws(
    () => createLongTailValidatorPolicyProvenance(root),
    /symbolic link/,
  );
});

test("validator policy provenance rejects hardlinked dependencies", (t) => {
  const root = temporaryPolicyRepository(t);
  const relativePath = LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS[3];
  const dependency = path.join(root, relativePath);
  const replacement = path.join(root, "hardlink-source.ts");
  writeFileSync(replacement, "export const replacement = true;\n", {
    mode: 0o600,
  });
  unlinkSync(dependency);
  linkSync(replacement, dependency);
  assert.throws(
    () => createLongTailValidatorPolicyProvenance(root),
    /non-hardlinked/,
  );
});

test("validator policy provenance rejects a self-inconsistent manifest", (t) => {
  const root = temporaryPolicyRepository(t);
  const provenance = createLongTailValidatorPolicyProvenance(root);
  const stale = Object.freeze({
    ...provenance,
    validatorPolicySha256: "0".repeat(64),
  });
  assert.throws(
    () => assertCurrentLongTailValidatorPolicy(root, stale),
    /internally stale/,
  );
});
