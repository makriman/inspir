import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertD1SqlStatementSize,
  buildAtomicSeoCtaRepairSql,
  buildCuratedNamespaceRepairSql,
  buildMainAppRepairPlan,
  buildRemoteRepairVerificationSql,
  largestSqlStatementBytes,
  loadAndValidateTranslationSeed,
  loadCuratedNamespaceRepairRows,
  loadMainAppRepairRows,
  projectRepairBilledRowWrites,
  repairSeoCtaTranslations,
  splitSqlStatements,
  validateCuratedRepairTargetCounts,
  validateMainAppRepairTargetCounts,
  validateStaticRepairTargetCounts,
  validateSiteSourceManifestFreshness,
  verifyMainAppRepairResultRows,
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
    assert.equal(report.curatedTranslationRows, 138);
    assert.equal(report.mainAppTranslationRows, 69);
    assert.equal(report.mainAppRepairLogicalRowWrites, report.mainAppRepairStatements);
    assert.ok(report.mainAppRepairStatements > 138);
    assert.ok(report.largestMainAppRepairStatementBytes <= 90_000);
    assert.ok(report.largestCuratedRepairStatementBytes > 0);
    assert.ok(report.largestCuratedRepairStatementBytes <= 100_000);
    assert.equal(report.manifestNamespacesVerified, 125);
    assert.equal(report.sourceHashes["marketing-site"], "f14328ad17e645fbc8d904da8d2892fae56e9c7a41b54b8aa108c89eaf7611b0");
    assert.equal(report.sourceHashes["route:chat-public"], "f5ef074ab3712ef9b40cb5fcbc794e9b7d42efd2089fc22400aeb280abce8689");
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

test("SEO repair mirrors render-ready shell and home bundles exactly into D1", () => {
  const rows = loadCuratedNamespaceRepairRows();
  assert.equal(rows.length, 138);
  assert.equal(rows.filter((row) => row.namespace === "marketing-shell").length, 69);
  assert.equal(rows.filter((row) => row.namespace === "route:home").length, 69);
  assert.equal(
    rows.find((row) => row.namespace === "marketing-shell" && row.language === "Arabic")?.payload[
      "site.d0d9118568f5027bc1"
    ],
    "اختر اللغة لهذه الزيارة.",
  );

  const sql = buildCuratedNamespaceRepairSql(rows);
  assert.equal(sql.match(/^INSERT INTO app_translations$/gm)?.length, 138);
  assert.match(sql, /codex-curated-free-static-no-games-v5/);
  assert.ok(largestSqlStatementBytes(sql) <= 100_000);
  assert.doesNotMatch(sql, /DROP TABLE|CREATE TABLE|DELETE FROM/);
});

test("curated repair SQL rejects duplicate, stale, and incomplete UPSERT rows", () => {
  const rows = loadCuratedNamespaceRepairRows();
  const first = rows[0];
  assert.ok(first);

  const duplicateRows = [...rows];
  duplicateRows[1] = first;
  assert.throws(
    () => buildCuratedNamespaceRepairSql(duplicateRows),
    /Duplicate curated translation row/,
  );

  const staleRows = [...rows];
  staleRows[0] = { ...first, sourceHash: "stale" };
  assert.throws(
    () => buildCuratedNamespaceRepairSql(staleRows),
    /Stale curated translation source hash/,
  );

  const omittedKey = Object.keys(first.payload)[0];
  assert.ok(omittedKey);
  const incompleteRows = [...rows];
  incompleteRows[0] = {
    ...first,
    payload: Object.fromEntries(
      Object.entries(first.payload).filter(([key]) => key !== omittedKey),
    ),
  };
  assert.throws(
    () => buildCuratedNamespaceRepairSql(incompleteRows),
    /Incomplete curated translation payload/,
  );
});

test("main-app repair rebuilds all 69 payloads exactly with bounded JSON patches", () => {
  const rows = loadMainAppRepairRows();
  const plan = buildMainAppRepairPlan(rows);
  assert.equal(rows.length, 69);
  assert.equal(plan.rows, 69);
  assert.equal(plan.resetStatements, 69);
  assert.ok(plan.patchStatements > plan.resetStatements);
  assert.equal(plan.logicalRowWrites, plan.resetStatements + plan.patchStatements);
  assert.ok(plan.largestStatementBytes > 0);
  assert.ok(plan.largestStatementBytes <= 90_000);
  assert.equal(
    splitSqlStatements(plan.sql).length,
    1 + plan.resetStatements + plan.patchStatements,
  );
  assert.match(plan.sql, /main_app_cardinality_guard/);
  assert.match(plan.sql, /payload = json\('\{\}'\)/);
  assert.match(plan.sql, /json_patch\(payload, json\(/);
  assert.match(plan.sql, /codex-curated-free-static-no-games-main-app-v1/);
  assert.doesNotMatch(plan.sql, /INSERT INTO|DELETE FROM|DROP TABLE|CREATE TABLE/);
  assert.ok(rows.every((row) => Buffer.byteLength(JSON.stringify(row.payload), "utf8") > 100_000));

  const sqlStatements = splitSqlStatements(plan.sql);
  const reconstructedRows: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const languagePredicate = `AND language = '${row.language}';`;
    const patchStatements = sqlStatements.filter(
      (statement) => statement.includes("json_patch(payload") && statement.endsWith(languagePredicate),
    );
    assert.ok(patchStatements.length >= 2);

    const reconstructed: Record<string, string> = {};
    for (const statement of patchStatements) {
      const prefix = "SET payload = json_patch(payload, json(";
      const start = statement.indexOf(prefix);
      const end = statement.lastIndexOf("))\nWHERE");
      assert.ok(start >= 0 && end > start);
      const sqlLiteral = statement.slice(start + prefix.length, end);
      assert.ok(sqlLiteral.startsWith("'") && sqlLiteral.endsWith("'"));
      const chunk: unknown = JSON.parse(sqlLiteral.slice(1, -1).replaceAll("''", "'"));
      assert.equal(typeof chunk, "object");
      assert.ok(chunk && !Array.isArray(chunk));
      for (const [key, value] of Object.entries(chunk)) {
        assert.equal(typeof value, "string");
        reconstructed[key] = value;
      }
    }
    assert.equal(JSON.stringify(reconstructed), JSON.stringify(row.payload));
    reconstructedRows.push({
      namespace: row.namespace,
      language: row.language,
      payload: JSON.stringify(reconstructed),
      source_hash: row.sourceHash,
      model: "codex-curated-free-static-no-games-main-app-v1",
    });
  }
  assert.equal(verifyMainAppRepairResultRows(reconstructedRows, rows), 69);

  const firstActual = reconstructedRows[0];
  const firstExpected = rows[0];
  assert.ok(firstActual);
  assert.ok(firstExpected);
  const reorderedPayload = Object.fromEntries(Object.entries(firstExpected.payload).reverse());
  assert.notEqual(JSON.stringify(reorderedPayload), firstActual.payload);
  assert.throws(
    () =>
      verifyMainAppRepairResultRows(
        [{ ...firstActual, payload: JSON.stringify(reorderedPayload) }],
        [firstExpected],
      ),
    /byte equality/,
  );
});

test("main-app repair rejects duplicate, stale, and incomplete tracked rows", () => {
  const rows = loadMainAppRepairRows();
  const first = rows[0];
  assert.ok(first);

  const duplicateRows = [...rows];
  duplicateRows[1] = first;
  assert.throws(() => buildMainAppRepairPlan(duplicateRows), /Duplicate main-app translation row/);

  const staleRows = [...rows];
  staleRows[0] = { ...first, sourceHash: "stale" };
  assert.throws(() => buildMainAppRepairPlan(staleRows), /Unexpected main-app translation row/);

  const omittedKey = Object.keys(first.payload)[0];
  assert.ok(omittedKey);
  const incompleteRows = [...rows];
  incompleteRows[0] = {
    ...first,
    payload: Object.fromEntries(
      Object.entries(first.payload).filter(([key]) => key !== omittedKey),
    ),
  };
  assert.throws(() => buildMainAppRepairPlan(incompleteRows), /Incomplete main-app translation payload/);
});

test("D1 statement sizing parses SQL literals and enforces the 100000-byte limit", () => {
  const statements = splitSqlStatements(
    "SELECT 'literal;value'; -- comment;\nSELECT \"identifier;value\"; /* block;comment */ SELECT [key;value];",
  );
  assert.equal(statements.length, 3);
  assert.match(statements[0] ?? "", /literal;value/);
  assert.match(statements[1] ?? "", /identifier;value/);
  assert.match(statements[2] ?? "", /key;value/);

  const exactLimit = `SELECT '${"x".repeat(99_990)}';`;
  const aboveLimit = `SELECT '${"x".repeat(99_991)}';`;
  assert.equal(Buffer.byteLength(exactLimit, "utf8"), 100_000);
  assert.equal(assertD1SqlStatementSize(exactLimit), 100_000);
  assert.throws(() => assertD1SqlStatementSize(aboveLimit), /100000-byte statement limit/);
  assert.throws(
    () => buildAtomicSeoCtaRepairSql("-- D1 owns rollback\nBEGIN TRANSACTION;", "SELECT 1;"),
    /Wrangler file rollback/,
  );
  assert.throws(() => splitSqlStatements("SELECT 'unterminated;"), /unterminated/);
});

test("SEO CTA repair verifies every extracted namespace against the generated manifest", () => {
  assert.equal(validateSiteSourceManifestFreshness(), 125);
});

test("remote translation verification excludes the source-only marketing namespace", () => {
  const sql = buildRemoteRepairVerificationSql(loadAndValidateTranslationSeed());
  assert.match(sql, /WITH expected_namespaces\(namespace\) AS \(VALUES/);
  assert.match(sql, /allowed_languages\(language\) AS \(VALUES/);
  assert.match(sql, /COUNT\(DISTINCT t\.namespace\) AS site_namespaces/);
  assert.match(sql, /AS unexpected_namespaces/);
  assert.match(sql, /AS unsupported_languages/);
  assert.match(sql, /WHERE t\.namespace <> 'marketing-site';/);
});

test("production translation cardinality rejects missing or unsupported repair targets", () => {
  const valid = [
    { namespace: "route:chat-public", rows: 69, unsupportedLanguages: 0 },
    { namespace: "route:about", rows: 69, unsupportedLanguages: 0 },
    { namespace: "route:media", rows: 69, unsupportedLanguages: 0 },
    { namespace: "route:schools", rows: 69, unsupportedLanguages: 0 },
  ];
  assert.equal(validateStaticRepairTargetCounts(valid, 69), 276);
  assert.equal(
    validateStaticRepairTargetCounts(
      [{ namespace: "marketing-site", rows: 69, unsupportedLanguages: 0 }, ...valid],
      69,
    ),
    345,
  );
  assert.throws(
    () =>
      validateStaticRepairTargetCounts(
        valid.map((row) => (row.namespace === "route:media" ? { ...row, rows: 68 } : row)),
        69,
      ),
    /route:media: 68 rows/,
  );
  assert.throws(
    () =>
      validateStaticRepairTargetCounts(
        valid.map((row) =>
          row.namespace === "route:schools" ? { ...row, unsupportedLanguages: 1 } : row,
        ),
        69,
      ),
    /unsupported languages/,
  );
  assert.throws(
    () => validateStaticRepairTargetCounts([...valid, valid[0]!], 69),
    /Duplicate production translation cardinality row/,
  );
  assert.throws(
    () =>
      validateStaticRepairTargetCounts(
        [...valid, { namespace: "route:retired-game", rows: 69, unsupportedLanguages: 0 }],
        69,
      ),
    /Unexpected production translation namespace/,
  );
});

test("curated UPSERT targets allow missing supported rows but reject extras", () => {
  assert.equal(
    validateCuratedRepairTargetCounts(
      [
        { namespace: "marketing-shell", rows: 68, unsupportedLanguages: 0 },
        { namespace: "route:home", rows: 0, unsupportedLanguages: 0 },
      ],
      69,
    ),
    68,
  );
  assert.throws(
    () =>
      validateCuratedRepairTargetCounts(
        [{ namespace: "marketing-shell", rows: 70, unsupportedLanguages: 1 }],
        69,
      ),
    /Invalid curated production translation cardinality/,
  );
  assert.throws(
    () =>
      validateCuratedRepairTargetCounts(
        [{ namespace: "route:home", rows: 69, unsupportedLanguages: 1 }],
        69,
      ),
    /unsupported languages/,
  );
});

test("main-app repair preflight requires exactly 69 supported existing rows", () => {
  assert.equal(
    validateMainAppRepairTargetCounts(
      [{ namespace: "main-app", rows: 69, unsupportedLanguages: 0 }],
      69,
    ),
    69,
  );
  assert.throws(() => validateMainAppRepairTargetCounts([], 69), /missing or duplicated/);
  assert.throws(
    () =>
      validateMainAppRepairTargetCounts(
        [{ namespace: "main-app", rows: 68, unsupportedLanguages: 0 }],
        69,
      ),
    /68 rows/,
  );
  assert.throws(
    () =>
      validateMainAppRepairTargetCounts(
        [{ namespace: "main-app", rows: 69, unsupportedLanguages: 1 }],
        69,
      ),
    /unsupported languages/,
  );
});

test("projected repair writes include static, curated, and chunked main-app writes", () => {
  assert.equal(projectRepairBilledRowWrites(1_000, 276, 138, 300), 2_428);
  assert.equal(projectRepairBilledRowWrites(1_000, 345, 138, 300), 2_566);
  assert.throws(
    () => projectRepairBilledRowWrites(0, -1, 138, 300),
    /non-negative safe integers/,
  );
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
  assert.ok(assertD1SqlStatementSize(plan.sql) < 100_000);
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
