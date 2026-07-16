import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readlinkSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE as PINNED_TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE,
  TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS,
  sha256CanonicalTranslationAuditJson,
  verifyAfrikaansTranslationSemanticAuditManifest,
  verifyTranslationSemanticAuditManifest,
} from "./verify-translation-semantic-audit";
import {
  assertCurrentLongTailReleaseRunRoot,
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
} from "./long-tail-nllb-execution-profile";

export const TRANSLATION_SEMANTIC_AUDIT_DEFAULT_RUN_DIRECTORY =
  "tmp/long-tail-translation-pipeline-v10" as const;
export const TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_OUTPUT_BASENAME =
  "semantic-audit-afrikaans-smoke.json" as const;
export const TRANSLATION_SEMANTIC_AUDIT_FULL_OUTPUT_BASENAME =
  "semantic-audit-full.json" as const;

const MAXIMUM_PYVENV_CONFIG_BYTES = 64 * 1024;

const ALLOWLISTED_PARENT_ENVIRONMENT_KEYS = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
] as const);

export const TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE =
  PINNED_TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE;

export const TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE_SHA256 =
  sha256CanonicalTranslationAuditJson(
    TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE,
  );

export type TranslationSemanticAuditScope = "afrikaans-smoke" | "full";

export type TranslationSemanticAuditInvocation = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  outputPath: string;
  scope: TranslationSemanticAuditScope;
  runRoot: string;
}>;

export function createTranslationSemanticAuditEnvironment(
  parentEnvironment: Partial<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: parentEnvironment.NODE_ENV ?? "production",
  };
  for (const key of ALLOWLISTED_PARENT_ENVIRONMENT_KEYS) {
    const value = parentEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    HF_DATASETS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    HF_HUB_OFFLINE: "1",
    MKL_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    PYTORCH_ENABLE_MPS_FALLBACK: "0",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONUTF8: "1",
    TOKENIZERS_PARALLELISM: "false",
    TRANSFORMERS_OFFLINE: "1",
    VECLIB_MAXIMUM_THREADS: "1",
  };
}

function assertNoSymlinkComponents(target: string, label: string): void {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) throw new Error(`${label} does not exist: ${current}`);
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link component: ${current}`);
    }
  }
}

function exactDirectory(target: string, label: string): string {
  const absolute = path.resolve(target);
  assertNoSymlinkComponents(absolute, label);
  const metadata = lstatSync(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  if (realpathSync(absolute) !== absolute) {
    throw new Error(`${label} resolves through a symbolic link.`);
  }
  return absolute;
}

function exactExecutable(target: string, label: string): string {
  const absolute = path.resolve(target);
  assertNoSymlinkComponents(path.dirname(absolute), `${label} parent`);
  const venvRoot = path.resolve(path.dirname(absolute), "..");
  exactFile(path.join(venvRoot, "pyvenv.cfg"), "Pinned semantic-audit venv marker");
  const trustedSystemRoots = [
    "/bin",
    "/usr",
    "/System",
    "/Library/Developer/CommandLineTools",
  ].map((entry) => path.resolve(entry));
  const allowed = (candidate: string) =>
    candidate === venvRoot ||
    candidate.startsWith(`${venvRoot}${path.sep}`) ||
    trustedSystemRoots.some((root) =>
      candidate === root || candidate.startsWith(`${root}${path.sep}`)
    );
  let cursor = absolute;
  const visited = new Set<string>();
  for (let depth = 0; depth < 16; depth += 1) {
    if (!allowed(cursor) || visited.has(cursor)) {
      throw new Error(`${label} has an untrusted or cyclic symbolic-link chain.`);
    }
    visited.add(cursor);
    assertNoSymlinkComponents(path.dirname(cursor), `${label} chain parent`);
    const before = lstatSync(cursor);
    if (!before.isSymbolicLink()) {
      if (!before.isFile() || before.nlink !== 1) {
        throw new Error(`${label} must resolve to a single-link regular file.`);
      }
      accessSync(cursor, fsConstants.X_OK);
      if (realpathSync(absolute) !== cursor) {
        throw new Error(`${label} symbolic-link chain changed during validation.`);
      }
      return absolute;
    }
    const linkText = readlinkSync(cursor, "utf8");
    if (!linkText || linkText.includes("\u0000")) {
      throw new Error(`${label} contains an invalid symbolic link.`);
    }
    const after = lstatSync(cursor);
    if (
      !after.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(`${label} symbolic-link chain changed during validation.`);
    }
    cursor = path.resolve(path.dirname(cursor), linkText);
  }
  throw new Error(`${label} symbolic-link chain is too deep.`);
}

function exactFile(target: string, label: string): string {
  const absolute = path.resolve(target);
  assertNoSymlinkComponents(absolute, label);
  const metadata = lstatSync(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`${label} must be a single-link regular file.`);
  }
  return absolute;
}

export type TranslationSemanticAuditStableReadFaultPoint =
  | "after-open-before-read"
  | "after-read-before-final-identity";

export function readStableBoundedTranslationSemanticAuditFile(
  input: Readonly<{
    file: string;
    maximumBytes: number;
    label?: string;
    raceHook?: (
      point: TranslationSemanticAuditStableReadFaultPoint,
    ) => void;
  }>,
): Buffer {
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 0) {
    throw new Error("Stable semantic-audit file byte bound is invalid.");
  }
  const label = input.label ?? "Stable semantic-audit file";
  const file = path.resolve(input.file);
  assertNoSymlinkComponents(file, label);
  const pathBefore = lstatSync(file, { bigint: true });
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== BigInt(1) ||
    pathBefore.size > BigInt(input.maximumBytes)
  ) {
    throw new Error(`${label} must be a bounded single-link regular file.`);
  }
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== BigInt(1) ||
      before.size > BigInt(input.maximumBytes) ||
      !sameStableFileIdentity(pathBefore, before)
    ) {
      throw new Error(`${label} changed while it was opened.`);
    }
    input.raceHook?.("after-open-before-read");
    const expectedBytes = Number(before.size);
    const bytes = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        expectedBytes - offset,
        null,
      );
      if (count === 0) throw new Error(`${label} was truncated while read.`);
      offset += count;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw new Error(`${label} grew while it was read.`);
    }
    input.raceHook?.("after-read-before-final-identity");
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    assertNoSymlinkComponents(file, label);
    if (
      !sameStableFileIdentity(before, after) ||
      !sameStableFileIdentity(after, pathAfter) ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error(`${label} changed while it was read.`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function sameStableFileIdentity(
  first: BigIntStats,
  second: BigIntStats,
): boolean {
  return first.isFile() && second.isFile() &&
    first.nlink === BigInt(1) && second.nlink === BigInt(1) &&
    first.dev === second.dev && first.ino === second.ino &&
    first.size === second.size && first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs && first.mode === second.mode &&
    first.uid === second.uid;
}

export function createTranslationSemanticAuditInvocation(input: {
  workspaceRoot: string;
  runRoot: string;
  scope: TranslationSemanticAuditScope;
  parentEnvironment?: Partial<NodeJS.ProcessEnv>;
  homeDirectory?: string;
}): TranslationSemanticAuditInvocation {
  const workspaceRoot = exactDirectory(input.workspaceRoot, "Workspace root");
  const runRoot = exactDirectory(input.runRoot, "Translation run root");
  const temporaryRoot = path.join(workspaceRoot, "tmp");
  if (!runRoot.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error("Translation run root must remain under workspace tmp/.");
  }
  assertCurrentLongTailReleaseRunRoot(runRoot, "Translation run root");
  const home = input.homeDirectory ?? os.homedir();
  const python = exactExecutable(
    path.join(workspaceRoot, "tmp/nllb-venv/bin/python"),
    "Pinned semantic-audit Python",
  );
  const virtualEnvironment = path.resolve(path.dirname(python), "..");
  if (
    realpathSync(python) !==
      TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE.pythonExecutableRealPath
  ) {
    throw new Error("Pinned semantic-audit Python executable drifted.");
  }
  const pyvenvConfig = exactFile(
    path.join(virtualEnvironment, "pyvenv.cfg"),
    "Pinned semantic-audit venv marker",
  );
  const pyvenvConfigSha256 = createHash("sha256")
    .update(readStableBoundedTranslationSemanticAuditFile({
      file: pyvenvConfig,
      maximumBytes: MAXIMUM_PYVENV_CONFIG_BYTES,
      label: "Pinned semantic-audit venv marker",
    }))
    .digest("hex");
  if (
    pyvenvConfigSha256 !==
      TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE.pythonVenvConfigSha256
  ) {
    throw new Error("Pinned semantic-audit pyvenv.cfg drifted.");
  }
  const implementation = exactFile(
    path.join(workspaceRoot, "scripts/audit-translation-semantics.py"),
    "Semantic-audit implementation",
  );
  const fasttext = exactFile(
    path.join(home, ".cache/inspirlearning/fasttext/lid.176.bin"),
    "Pinned fastText model",
  );
  const labse = exactDirectory(
    path.join(
      home,
      ".cache/inspirlearning/sentence-transformers/models--sentence-transformers--LaBSE/snapshots/836121a0533e5664b21c7aacc5d22951f2b8b25b",
    ),
    "Pinned LaBSE model",
  );
  const madlad = exactDirectory(
    path.join(home, ".cache/inspirlearning/madlad400-3b-mt-ct2-int8"),
    "Pinned MADLAD model",
  );
  const outputBasename = input.scope === "full"
    ? TRANSLATION_SEMANTIC_AUDIT_FULL_OUTPUT_BASENAME
    : TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_OUTPUT_BASENAME;
  const outputPath = path.join(runRoot, outputBasename);
  const args = Object.freeze([
    implementation,
    "--root",
    workspaceRoot,
    "--scope",
    input.scope,
    "--master-worklist",
    path.join(runRoot, "worklist.json"),
    "--curated-root",
    path.join(workspaceRoot, "translations/curated"),
    "--static-main-app-root",
    path.join(workspaceRoot, "translations/static-main-app"),
    "--candidate-root",
    path.join(runRoot, "candidates"),
    "--pack-worklist-root",
    path.join(runRoot, "worklists"),
    "--output",
    outputPath,
    "--fasttext-model",
    fasttext,
    "--fasttext-sha256",
    TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.fasttextSha256,
    "--labse-model",
    labse,
    "--labse-tree-sha256",
    TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.labseTreeSha256,
    "--madlad-model",
    madlad,
    "--madlad-tree-sha256",
    TRANSLATION_SEMANTIC_AUDIT_MODEL_DIGESTS.madladTreeSha256,
    "--execution-profile-sha256",
    TRANSLATION_SEMANTIC_AUDIT_EXECUTION_PROFILE_SHA256,
    "--generator-execution-profile-sha256",
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  ]);
  return Object.freeze({
    command: python,
    args,
    cwd: workspaceRoot,
    env: {
      ...createTranslationSemanticAuditEnvironment(input.parentEnvironment),
      HOME: home,
      VIRTUAL_ENV: virtualEnvironment,
    },
    outputPath,
    scope: input.scope,
    runRoot,
  });
}

export function runTranslationSemanticAudit(input: {
  workspaceRoot: string;
  runRoot: string;
  scope: TranslationSemanticAuditScope;
  parentEnvironment?: Partial<NodeJS.ProcessEnv>;
  homeDirectory?: string;
}): void {
  const invocation = createTranslationSemanticAuditInvocation(input);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error("Could not start the pinned offline semantic audit.");
  }
  if (result.status !== 0) {
    throw new Error(
      `Offline semantic audit failed with status ${result.status ?? "signal"}.`,
    );
  }
  if (!existsSync(invocation.outputPath)) {
    throw new Error("Offline semantic audit exited without its immutable output.");
  }
  if (invocation.scope === "full") {
    verifyTranslationSemanticAuditManifest({
      workspaceRoot: invocation.cwd,
      runRoot: invocation.runRoot,
    });
  } else {
    verifyAfrikaansTranslationSemanticAuditManifest({
      workspaceRoot: invocation.cwd,
      runRoot: invocation.runRoot,
    });
  }
}

function parseCli(argv: readonly string[]): Readonly<{
  scope: TranslationSemanticAuditScope;
  runDirectory: string;
}> {
  let scope: TranslationSemanticAuditScope | null = null;
  let runDirectory: string = TRANSLATION_SEMANTIC_AUDIT_DEFAULT_RUN_DIRECTORY;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scope") {
      const value = argv[index + 1];
      if (value !== "afrikaans-smoke" && value !== "full") {
        throw new Error("--scope must be afrikaans-smoke or full.");
      }
      scope = value;
      index += 1;
    } else if (argument === "--run-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--run-dir requires a path.");
      runDirectory = value;
      index += 1;
    } else {
      throw new Error(`Unsupported semantic-audit option: ${argument ?? ""}`);
    }
  }
  if (!scope) throw new Error("--scope is required.");
  return Object.freeze({ scope, runDirectory });
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--help")) {
      if (argv.length !== 1) {
        throw new Error("--help cannot be combined with semantic-audit options.");
      }
      console.log(
        "Usage: pnpm translations:audit-semantic --scope afrikaans-smoke|full [--run-dir tmp/long-tail-translation-pipeline-v10]",
      );
    } else {
      const options = parseCli(argv);
      const workspaceRoot = process.cwd();
      runTranslationSemanticAudit({
        workspaceRoot,
        runRoot: path.resolve(workspaceRoot, options.runDirectory),
        scope: options.scope,
      });
    }
  } catch (error) {
    console.error(
      `[translations:semantic-audit] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
