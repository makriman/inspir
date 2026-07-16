import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";

export const LONG_TAIL_VALIDATOR_POLICY_KIND =
  "inspir-long-tail-validator-policy-v1" as const;

export const LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS = Object.freeze([
  "lib/content/languages.ts",
  "lib/i18n/translation-candidate-quality.ts",
  "lib/i18n/translation-field-validation.ts",
  "lib/i18n/translation-quality.ts",
  "lib/i18n/translation-types.ts",
  "lib/i18n/translation-validation.ts",
  "scripts/translation-validator-policy-provenance.ts",
] as const);

export type LongTailValidatorPolicyFile = Readonly<{
  relativePath: string;
  bytes: number;
  sha256: string;
}>;

export type LongTailValidatorPolicyProvenance = Readonly<{
  kind: typeof LONG_TAIL_VALIDATOR_POLICY_KIND;
  files: readonly LongTailValidatorPolicyFile[];
  validatorPolicySha256: string;
}>;

type StableFileIdentity = Readonly<{
  device: number;
  inode: number;
  mode: number;
  links: number;
  owner: number;
  bytes: number;
  modifiedMilliseconds: number;
  changedMilliseconds: number;
}>;

function stableFileIdentity(
  metadata: Stats,
  file: string,
): StableFileIdentity {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(
      `Validator policy dependency must be a regular non-symlink, non-hardlinked file: ${file}`,
    );
  }
  if (
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error(
      `Validator policy dependency must be owned by the current user: ${file}`,
    );
  }
  return Object.freeze({
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
    links: metadata.nlink,
    owner: metadata.uid,
    bytes: metadata.size,
    modifiedMilliseconds: metadata.mtimeMs,
    changedMilliseconds: metadata.ctimeMs,
  });
}

function sameFileIdentity(
  first: StableFileIdentity,
  second: StableFileIdentity,
) {
  return (
    first.device === second.device &&
    first.inode === second.inode &&
    first.mode === second.mode &&
    first.links === second.links &&
    first.owner === second.owner &&
    first.bytes === second.bytes &&
    first.modifiedMilliseconds === second.modifiedMilliseconds &&
    first.changedMilliseconds === second.changedMilliseconds
  );
}

function resolvePolicyDependency(repoRoot: string, relativePath: string) {
  if (
    !relativePath ||
    relativePath.includes("\u0000") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`Unsafe validator policy dependency path: ${relativePath}`);
  }
  const root = realpathSync(path.resolve(repoRoot));
  const dependency = path.resolve(root, relativePath);
  if (!dependency.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Validator policy dependency escaped the repository: ${relativePath}`,
    );
  }
  if (realpathSync(dependency) !== dependency) {
    throw new Error(
      `Validator policy dependency resolves through a symbolic link: ${relativePath}`,
    );
  }
  return dependency;
}

function readPolicyDependency(repoRoot: string, relativePath: string) {
  const dependency = resolvePolicyDependency(repoRoot, relativePath);
  const pathBefore = stableFileIdentity(lstatSync(dependency), dependency);
  const descriptor = openSync(
    dependency,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  let bytes: Buffer;
  let descriptorBefore: StableFileIdentity;
  let descriptorAfter: StableFileIdentity;
  try {
    descriptorBefore = stableFileIdentity(fstatSync(descriptor), dependency);
    bytes = readFileSync(descriptor);
    descriptorAfter = stableFileIdentity(fstatSync(descriptor), dependency);
  } finally {
    closeSync(descriptor);
  }
  const pathAfter = stableFileIdentity(lstatSync(dependency), dependency);
  if (
    !sameFileIdentity(pathBefore, descriptorBefore) ||
    !sameFileIdentity(descriptorBefore, descriptorAfter) ||
    !sameFileIdentity(descriptorAfter, pathAfter) ||
    bytes.byteLength !== descriptorAfter.bytes
  ) {
    throw new Error(
      `Validator policy dependency changed while it was hashed: ${relativePath}`,
    );
  }
  return Object.freeze({
    relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

export function calculateLongTailValidatorPolicySha256(
  files: readonly LongTailValidatorPolicyFile[],
) {
  const digest = createHash("sha256");
  digest.update(`${LONG_TAIL_VALIDATOR_POLICY_KIND}\u0000`, "utf8");
  for (const file of files) {
    digest.update(file.relativePath, "utf8");
    digest.update("\u0000", "utf8");
    digest.update(String(file.bytes), "utf8");
    digest.update("\u0000", "utf8");
    digest.update(file.sha256, "utf8");
    digest.update("\u0000", "utf8");
  }
  return digest.digest("hex");
}

export function createLongTailValidatorPolicyProvenance(
  repoRoot: string,
): LongTailValidatorPolicyProvenance {
  const files = Object.freeze(
    LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS.map((relativePath) =>
      readPolicyDependency(repoRoot, relativePath)
    ),
  );
  return Object.freeze({
    kind: LONG_TAIL_VALIDATOR_POLICY_KIND,
    files,
    validatorPolicySha256: calculateLongTailValidatorPolicySha256(files),
  });
}

export function assertCurrentLongTailValidatorPolicy(
  repoRoot: string,
  expected: LongTailValidatorPolicyProvenance,
) {
  if (expected.kind !== LONG_TAIL_VALIDATOR_POLICY_KIND) {
    throw new Error("Validator policy provenance kind is unsupported.");
  }
  if (
    expected.files.length !==
    LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS.length
  ) {
    throw new Error("Validator policy provenance file count is invalid.");
  }
  for (const [index, relativePath] of
    LONG_TAIL_VALIDATOR_POLICY_RELATIVE_PATHS.entries()) {
    if (expected.files[index]?.relativePath !== relativePath) {
      throw new Error("Validator policy provenance file order is invalid.");
    }
  }
  if (
    calculateLongTailValidatorPolicySha256(expected.files) !==
    expected.validatorPolicySha256
  ) {
    throw new Error("Validator policy provenance digest is internally stale.");
  }
  const current = createLongTailValidatorPolicyProvenance(repoRoot);
  if (
    current.validatorPolicySha256 !== expected.validatorPolicySha256 ||
    current.files.some((file, index) => {
      const recorded = expected.files[index];
      return (
        !recorded ||
        file.relativePath !== recorded.relativePath ||
        file.bytes !== recorded.bytes ||
        file.sha256 !== recorded.sha256
      );
    })
  ) {
    throw new Error(
      "Validator policy dependencies changed after provenance creation.",
    );
  }
}
