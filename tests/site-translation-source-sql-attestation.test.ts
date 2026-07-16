import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertSameTemporarySqlFileAttestation,
  attestTemporarySqlFile,
  buildSiteTranslationSourceSyncPlan,
  executeSiteTranslationSourceSyncPlan,
  removeAttestedTemporarySqlFile,
  TemporarySqlFileIntegrityError,
  writeTemporarySqlFile,
} from "../scripts/cloudflare/sync-site-translation-sources";
import type { WranglerRunner } from "../scripts/cloudflare/migration-config";

const expectedSql = "SELECT 'exact ✓ bytes';\n";

test("temporary SQL is exclusively published as an exact durable private file", () => {
  const sqlPath = writeTemporarySqlFile(expectedSql, "attested.sql");
  try {
    const attestation = attestTemporarySqlFile(sqlPath, expectedSql);
    assert.equal(attestation.path, path.resolve(sqlPath));
    assert.equal(attestation.bytes, Buffer.byteLength(expectedSql, "utf8"));
    assert.equal(
      attestation.sha256,
      createHash("sha256").update(expectedSql, "utf8").digest("hex"),
    );
    assert.equal(attestation.file.mode, 0o600);
    assert.equal(attestation.file.links, 1);
    assert.equal(attestation.directory.mode, 0o700);
    assert.equal(fs.readFileSync(sqlPath, "utf8"), expectedSql);
  } finally {
    fs.rmSync(path.dirname(sqlPath), { recursive: true, force: true });
  }
});

test("temporary SQL attestation rejects byte, mode, link, and symlink drift", async (t) => {
  await t.test("bytes", () => {
    withTemporarySql((sqlPath) => {
      fs.writeFileSync(sqlPath, "SELECT 'different';\n", { mode: 0o600 });
      assert.throws(
        () => attestTemporarySqlFile(sqlPath, expectedSql),
        TemporarySqlFileIntegrityError,
      );
    });
  });

  await t.test("mode", () => {
    withTemporarySql((sqlPath) => {
      fs.chmodSync(sqlPath, 0o640);
      assert.throws(
        () => attestTemporarySqlFile(sqlPath, expectedSql),
        TemporarySqlFileIntegrityError,
      );
    });
  });

  await t.test("hard link", () => {
    withTemporarySql((sqlPath) => {
      fs.linkSync(sqlPath, path.join(path.dirname(sqlPath), "alias.sql"));
      assert.throws(
        () => attestTemporarySqlFile(sqlPath, expectedSql),
        TemporarySqlFileIntegrityError,
      );
    });
  });

  await t.test("symbolic link", () => {
    withTemporarySql((sqlPath) => {
      const heldPath = path.join(path.dirname(sqlPath), "held.sql");
      fs.renameSync(sqlPath, heldPath);
      fs.symlinkSync(heldPath, sqlPath);
      assert.throws(
        () => attestTemporarySqlFile(sqlPath, expectedSql),
        TemporarySqlFileIntegrityError,
      );
    });
  });
});

test("source sync attests the exact SQL immediately around Wrangler and cleans it", () => {
  const plan = sourceSyncPlan();
  let observedPath = "";
  let observedSql = "";
  const runner: WranglerRunner = (args) => {
    observedPath = requiredFileArgument(args);
    observedSql = fs.readFileSync(observedPath, "utf8");
    return "ok";
  };

  executeSiteTranslationSourceSyncPlan(plan, "local", runner);

  assert.equal(observedSql, plan.sql);
  assert.equal(fs.existsSync(observedPath), false);
  assert.equal(fs.existsSync(path.dirname(observedPath)), false);
});

test("source sync rejects a same-owner exact-byte inode replacement during Wrangler", () => {
  const plan = sourceSyncPlan();
  let observedPath = "";
  const runner: WranglerRunner = (args) => {
    observedPath = requiredFileArgument(args);
    const replacement = path.join(path.dirname(observedPath), "replacement.sql");
    fs.writeFileSync(replacement, plan.sql, { flag: "wx", mode: 0o600 });
    fs.renameSync(replacement, observedPath);
    return "ok";
  };

  try {
    assert.throws(
      () => executeSiteTranslationSourceSyncPlan(plan, "local", runner),
      (error) => {
        assert.ok(error instanceof TemporarySqlFileIntegrityError);
        assert.match(error.message, /changed while Wrangler could consume it/);
        return true;
      },
    );
    assert.notEqual(observedPath, "");
  } finally {
    if (observedPath) {
      fs.rmSync(path.dirname(observedPath), { recursive: true, force: true });
    }
  }
});

test("a stale pre-attestation cannot clean an exact-byte replacement", () => {
  const sqlPath = writeTemporarySqlFile(expectedSql, "attested.sql");
  const before = attestTemporarySqlFile(sqlPath, expectedSql);
  try {
    const replacement = path.join(path.dirname(sqlPath), "replacement.sql");
    fs.writeFileSync(replacement, expectedSql, { flag: "wx", mode: 0o600 });
    fs.renameSync(replacement, sqlPath);
    const after = attestTemporarySqlFile(sqlPath, expectedSql);

    assert.throws(
      () => assertSameTemporarySqlFileAttestation(before, after),
      TemporarySqlFileIntegrityError,
    );
    assert.throws(
      () => removeAttestedTemporarySqlFile(before, expectedSql),
      TemporarySqlFileIntegrityError,
    );
    assert.equal(fs.readFileSync(sqlPath, "utf8"), expectedSql);
  } finally {
    fs.rmSync(path.dirname(sqlPath), { recursive: true, force: true });
  }
});

test("source sync preserves a Wrangler transport error after post-read attestation", () => {
  const plan = sourceSyncPlan();
  const transportError = new Error("synthetic Wrangler transport loss");
  let observedPath = "";
  const runner: WranglerRunner = (args) => {
    observedPath = requiredFileArgument(args);
    assert.equal(fs.readFileSync(observedPath, "utf8"), plan.sql);
    throw transportError;
  };

  assert.throws(
    () => executeSiteTranslationSourceSyncPlan(plan, "local", runner),
    (error) => error === transportError,
  );
  assert.equal(fs.existsSync(observedPath), false);
  assert.equal(fs.existsSync(path.dirname(observedPath)), false);
});

test("temporary SQL filenames cannot escape their private directory", () => {
  for (const filename of ["", ".", "..", "../escape.sql", `bad\0name.sql`]) {
    assert.throws(
      () => writeTemporarySqlFile(expectedSql, filename),
      TemporarySqlFileIntegrityError,
    );
  }
});

function withTemporarySql(run: (sqlPath: string) => void) {
  const sqlPath = writeTemporarySqlFile(expectedSql, "attested.sql");
  try {
    run(sqlPath);
  } finally {
    fs.rmSync(path.dirname(sqlPath), { recursive: true, force: true });
  }
}

function sourceSyncPlan() {
  return buildSiteTranslationSourceSyncPlan(
    [
      [
        "route:test",
        {
          sourceHash: "a".repeat(64),
          sourceStrings: { "test.key": "Exact source" },
        },
      ],
    ],
    { sources: {}, sourceStrings: {} },
    123,
  );
}

function requiredFileArgument(args: string[]) {
  const fileIndex = args.indexOf("--file");
  const file = args[fileIndex + 1];
  assert.notEqual(fileIndex, -1);
  assert.equal(typeof file, "string");
  assert.ok(file);
  return file;
}
