import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

function runReaderProbe(script: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

test("curated translation readers fail closed while the active snapshot is absent", () => {
  const emptyWorkspace = mkdtempSync(
    path.join(os.tmpdir(), "inspir-absent-curated-snapshot-"),
  );
  try {
    const curatedModule = pathToFileURL(
      path.resolve("lib/i18n/curated-translations.ts"),
    ).href;
    const curated = runReaderProbe(`
      process.chdir(${JSON.stringify(emptyWorkspace)});
      const { getCuratedTranslationBundle } = await import(${JSON.stringify(curatedModule)});
      try {
        getCuratedTranslationBundle({
          namespace: "route:test",
          sourceHash: "${"a".repeat(64)}",
          sourceStrings: { title: "Start learning" },
        }, "Spanish");
        process.exitCode = 2;
      } catch (error) {
        if (!String(error).includes("refusing a partial snapshot")) process.exitCode = 3;
      }
    `);
    assert.equal(curated.status, 0, curated.stderr);

    symlinkSync(path.resolve("lib"), path.join(emptyWorkspace, "lib"), "dir");
    const siteModule = pathToFileURL(
      path.resolve("lib/i18n/site-translations.ts"),
    ).href;
    const site = runReaderProbe(`
      process.env.NEXT_PHASE = "phase-production-build";
      process.chdir(${JSON.stringify(emptyWorkspace)});
      const { getCachedSiteTranslationBundle } = await import(${JSON.stringify(siteModule)});
      try {
        await getCachedSiteTranslationBundle("Spanish", "route:home");
        process.exitCode = 2;
      } catch (error) {
        if (!String(error).includes("refusing a partial build snapshot")) process.exitCode = 3;
      }
    `);
    assert.equal(site.status, 0, site.stderr);
  } finally {
    rmSync(emptyWorkspace, { force: true, recursive: true });
  }
});
