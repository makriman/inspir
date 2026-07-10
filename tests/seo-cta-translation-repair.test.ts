import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAtomicSeoCtaRepairSql,
  loadAndValidateTranslationSeed,
  repairSeoCtaTranslations,
  validateSiteSourceManifestFreshness,
} from "../scripts/cloudflare/repair-seo-cta-translations";
import {
  assertSourceSyncWriteBudget,
  buildSiteTranslationSourceSyncPlan,
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  parseD1SourceSnapshotResultSets,
  syncSiteTranslationSources,
} from "../scripts/cloudflare/sync-site-translation-sources";

test("SEO CTA repair seed covers and validates every target language", () => {
  const translations = loadAndValidateTranslationSeed();
  assert.equal(translations.size, 69);
  assert.equal(translations.get("Arabic"), "جرّب الأوضاع العامة");
  assert.equal(translations.get("Danish"), "Prøv de læringsformer, der er åbne for alle");
  assert.equal(
    translations.get("Greek"),
    "Δοκιμάστε τους τρόπους μάθησης που είναι διαθέσιμοι σε όλους",
  );
  assert.equal(translations.get("Gujarati"), "સાર્વજનિક મોડ્સ અજમાવી જુઓ");
  assert.equal(translations.get("Hindi"), "सार्वजनिक मोड आज़माएं");
  assert.equal(translations.get("Malayalam"), "പൊതു മോഡുകൾ പരീക്ഷിക്കുക");
  assert.equal(translations.get("Spanish"), "Prueba los modos públicos");
  assert.equal(
    translations.get("Swahili"),
    "Jaribu njia za kujifunza zinazopatikana kwa wote",
  );
  assert.equal(translations.get("Yoruba"), "Gbìyànjú àwọn ipò tó ṣí sí gbogbo ènìyàn");
  assert.equal(translations.get("Zulu"), "Zama izimodi ezivulekele wonke umuntu");
});

test("SEO CTA repair verifies final source hashes and SQL without touching D1", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-seo-cta-verify-"));
  try {
    const report = repairSeoCtaTranslations({
      remote: false,
      confirmed: false,
      backupDir,
    });
    assert.equal(report.ok, true);
    assert.equal(report.mode, "verify");
    assert.equal(report.translationCount, 69);
    assert.equal(report.manifestNamespacesVerified, 125);
    assert.equal(report.sourceHashes["marketing-site"], "784fb3090db46f80d95db18611a9c8f6c784cccb397e2a0634e658734b6e5d39");
    assert.equal(report.sourceHashes["route:about"], "6aa44ee2349a660b840519a4fc03037976d4e26ee4ceb55d7d94e2959b211a99");
    assert.match(report.repairSqlSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      fs.existsSync(path.join(backupDir, "cloudflare/seo-cta-translation-repair-verify.json")),
      true,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("SEO CTA repair verifies every extracted namespace against the generated manifest", () => {
  assert.equal(validateSiteSourceManifestFreshness(), 125);
});

test("SEO CTA repair refuses an unconfirmed production mutation", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-seo-cta-confirm-"));
  try {
    assert.throws(
      () => repairSeoCtaTranslations({ remote: true, confirmed: false, backupDir }),
      /requires --confirm-production/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("site translation source sync plans only changed rows without rebuilding tables", () => {
  const desired = [
    [
      "alpha",
      { sourceHash: "alpha-new", sourceStrings: { keep: "new", added: "added" } },
    ],
    ["beta", { sourceHash: "beta", sourceStrings: { first: "value" } }],
  ] satisfies Parameters<typeof buildSiteTranslationSourceSyncPlan>[0];
  const current = {
    sources: { alpha: "alpha-old", obsolete: "obsolete" },
    sourceStrings: {
      alpha: { keep: "old", removed: "remove me" },
      obsolete: { old: "value" },
    },
  };

  const plan = buildSiteTranslationSourceSyncPlan(desired, current, 123);
  assert.equal(plan.statements, 7);
  assert.equal(plan.logicalRowWrites, 8);
  assert.equal(plan.projectedBilledRowWrites, 16);
  assert.doesNotMatch(plan.sql, /DROP TABLE|CREATE TABLE/);
  assert.match(plan.sql, /ON CONFLICT\(namespace\) DO UPDATE/);
  assert.match(plan.sql, /ON CONFLICT\(namespace, source_key\) DO UPDATE/);
  assert.match(
    plan.sql,
    /DELETE FROM app_translation_source_strings WHERE namespace = 'alpha' AND source_key = 'removed';/,
  );
  assert.match(plan.sql, /DELETE FROM app_translation_sources WHERE namespace = 'obsolete';/);

  const currentAfter = {
    sources: { alpha: "alpha-new", beta: "beta" },
    sourceStrings: {
      alpha: { keep: "new", added: "added" },
      beta: { first: "value" },
    },
  };
  const noOp = buildSiteTranslationSourceSyncPlan(desired, currentAfter, 456);
  assert.equal(noOp.statements, 0);
  assert.equal(noOp.logicalRowWrites, 0);
  assert.equal(noOp.projectedBilledRowWrites, 0);
  assert.equal(noOp.sql, "");
});

test("site translation source sync fails closed above its Workers Free write budget", () => {
  const plan = buildSiteTranslationSourceSyncPlan([]);
  assert.throws(
    () =>
      assertSourceSyncWriteBudget({
        ...plan,
        projectedBilledRowWrites: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES + 1,
      }),
    /Workers Free safety budget/,
  );
});

test("a cold source-manifest sync fits the reserved Workers Free write budget", () => {
  const plan = buildSiteTranslationSourceSyncPlan();
  assert.ok(plan.rows > 0);
  assert.ok(plan.sourceStringCount > 0);
  assert.equal(plan.statements, plan.rows + plan.sourceStringCount);
  assert.equal(plan.logicalRowWrites, plan.statements);
  assert.equal(plan.projectedBilledRowWrites, plan.logicalRowWrites * 2);
  assert.ok(plan.projectedBilledRowWrites < MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES);
  assert.doesNotMatch(plan.sql, /DROP TABLE|CREATE TABLE/);
});

test("standalone remote source synchronization requires explicit production confirmation", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-source-sync-confirm-"));
  try {
    assert.throws(
      () => syncSiteTranslationSources("remote", backupDir),
      /requires --confirm-production/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("source synchronization fails closed on partial or malformed D1 snapshots", () => {
  const good = JSON.stringify([
    { success: true, results: [{ namespace: "marketing-site", source_hash: "hash" }] },
    {
      success: true,
      results: [{ namespace: "marketing-site", source_key: "site.key", source_text: "Source" }],
    },
  ]);
  assert.equal(parseD1SourceSnapshotResultSets(good).length, 2);

  for (const invalid of [
    JSON.stringify([{ success: true, results: [] }]),
    JSON.stringify([{ success: true, results: [] }, { success: false, results: [] }]),
    JSON.stringify([{ success: true, results: [] }, { success: true }]),
    JSON.stringify([{ success: true, results: [] }, { success: true, results: [null] }]),
  ]) {
    assert.throws(
      () => parseD1SourceSnapshotResultSets(invalid),
      /expected 2|unsuccessful|no row array|malformed/,
    );
  }
});

test("SEO source synchronization and payload repair compose into one SQL file", () => {
  const sql = buildAtomicSeoCtaRepairSql(
    "PRAGMA foreign_keys = ON;\nSELECT 1;",
    "UPDATE example SET value = 1;",
  );
  assert.equal(
    sql,
    "PRAGMA foreign_keys = ON;\nSELECT 1;\nUPDATE example SET value = 1;\n",
  );
  assert.throws(() => buildAtomicSeoCtaRepairSql("", ""), /must not be empty/);
});
