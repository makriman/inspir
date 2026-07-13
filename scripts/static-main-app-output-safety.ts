import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

type TranslationOutputPaths = {
  workspaceRoot: string;
  sourceRoot: string;
  outputRoot: string;
};

/**
 * Keep generated translation writes inside the one tracked output directory or
 * an isolated OS-temporary subtree. This check runs before mkdir/rm so a typo
 * cannot delete the repository, its ancestors, or the curated authoring input.
 */
export function assertSafeStaticMainAppOutputRoot(paths: TranslationOutputPaths) {
  const workspaceRoot = canonicalizePotentialPath(paths.workspaceRoot);
  const sourceRoot = canonicalizePotentialPath(paths.sourceRoot);
  const outputRoot = canonicalizePotentialPath(paths.outputRoot);
  const trackedOutputRoot = canonicalizePotentialPath(
    join(workspaceRoot, "translations/static-main-app"),
  );
  const temporaryRoot = canonicalizePotentialPath(tmpdir());

  if (containsPath(outputRoot, workspaceRoot)) {
    throw new Error("Static main-app output must not be the workspace root or one of its ancestors.");
  }
  if (pathsOverlap(outputRoot, sourceRoot)) {
    throw new Error("Static main-app output must not overlap the curated source directory.");
  }
  if (outputRoot === trackedOutputRoot) return;
  if (containsPath(workspaceRoot, outputRoot)) {
    throw new Error(
      "Static main-app output inside the workspace must be translations/static-main-app.",
    );
  }
  if (outputRoot === temporaryRoot || !containsPath(temporaryRoot, outputRoot)) {
    throw new Error("Custom static main-app output must be an isolated OS-temporary subdirectory.");
  }
}

function canonicalizePotentialPath(value: string) {
  let current = resolve(value);
  const missingSegments: string[] = [];

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missingSegments.unshift(basename(current));
    current = parent;
  }

  const existingRoot = existsSync(current) ? realpathSync(current) : current;
  return resolve(existingRoot, ...missingSegments);
}

function pathsOverlap(left: string, right: string) {
  return containsPath(left, right) || containsPath(right, left);
}

function containsPath(parent: string, candidate: string) {
  const child = relative(parent, candidate);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}
