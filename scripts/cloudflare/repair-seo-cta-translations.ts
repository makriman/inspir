import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getCuratedTranslationBundle } from "@/lib/i18n/curated-translations";
import { getCuratedMainAppTranslationBundle } from "@/lib/i18n/main-app-curated";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
} from "@/lib/i18n/site-source";
import { siteTranslationNamespace } from "@/lib/i18n/site-source-constants";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import { isTranslationBundleCompleteAndFluent } from "@/lib/i18n/translation-quality";
import {
  cloudflareDir,
  D1_DATABASE_NAME,
  resolveBackupDir,
  runWrangler,
} from "./migration-config";
import {
  MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
  planSiteTranslationSourceSync,
  writeTemporarySqlFile,
} from "./sync-site-translation-sources";

const seedPath = path.resolve(
  process.cwd(),
  "scripts/translation-seeds/seo-cta-try-public-modes.json",
);
const repairSqlPath = path.resolve(
  process.cwd(),
  "scripts/cloudflare/seo-cta-translation-repair.sql",
);
const model = "codex-curated-free-static-no-games-v4";
const curatedRepairModel = "codex-curated-free-static-no-games-v5";
const mainAppRepairModel = "codex-curated-free-static-no-games-main-app-v1";
const curatedRepairNamespaces = ["marketing-shell", "route:home"] as const;
const staticRepairNamespaces = [
  "marketing-site",
  "route:chat-public",
  "route:about",
  "route:media",
  "route:schools",
] as const;
const curatedRepairNamespaceNames = new Set<string>(curatedRepairNamespaces);
const staticRepairNamespaceNames = new Set<string>(staticRepairNamespaces);
const supportedLanguageNames = new Set<string>(supportedLanguages);
const maximumD1SqlStatementBytes = 100_000;
const mainAppPatchStatementTargetBytes = 90_000;
const startLearningKey = "site.02d279ce2f7b58c890";
const tryPublicModesKey = "site.fc4ad9c971ade5617d";
const retiredGameTranslationKeys = [
  "site.ee30b035ee17c34450",
  "site.5121f7306ecc75edb5",
  "site.df499d7c6f44a88703",
] as const;
const previousMarketingSiteHash = "ec84387ca93fbec6a68df90e756a5b64af6dc401b0fefbc4646866ee897b228b";
const expectedSourceHashes = {
  "marketing-site": "f14328ad17e645fbc8d904da8d2892fae56e9c7a41b54b8aa108c89eaf7611b0",
  "route:home": "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce",
  "route:about": "6aa44ee2349a660b840519a4fc03037976d4e26ee4ceb55d7d94e2959b211a99",
  "route:chat-public": "f5ef074ab3712ef9b40cb5fcbc794e9b7d42efd2089fc22400aeb280abce8689",
  "route:media": "8f437d1337e18df480b2aef7ced339482fa4b1d53653e29fa7b06ae881a77982",
  "route:schools": "2c3294f27d9887dd9fbb10d0ad2147c31960a75ace708d1b3fc750416e6adabe",
} as const;
const projectedBilledWritesPerRepairTranslationRow = 2;

type RepairNamespace = keyof typeof expectedSourceHashes;

export type CuratedNamespaceRepairRow = {
  namespace: (typeof curatedRepairNamespaces)[number];
  language: SupportedLanguage;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
};

export type MainAppRepairRow = {
  namespace: typeof mainAppTranslationNamespace;
  language: SupportedLanguage;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
};

export type MainAppRepairPlan = {
  sql: string;
  rows: number;
  resetStatements: number;
  patchStatements: number;
  logicalRowWrites: number;
  largestStatementBytes: number;
};

type RepairReport = {
  createdAt: string;
  mode: "verify" | "remote";
  ok: boolean;
  database: string;
  backupPath?: string;
  translationCount: number;
  curatedTranslationRows: number;
  largestCuratedRepairStatementBytes: number;
  mainAppTranslationRows: number;
  mainAppRepairStatements: number;
  mainAppRepairLogicalRowWrites: number;
  largestMainAppRepairStatementBytes: number;
  manifestNamespacesVerified: number;
  sourceHashes: Record<RepairNamespace, string>;
  repairSqlSha256: string;
  sourceSyncSha256?: string;
  sourceSyncStatements?: number;
  sourceSyncLogicalRowWrites?: number;
  staticRepairRows?: number;
  projectedBilledRowWrites?: number;
  projectedBilledRowWriteLimit?: number;
  timeTravelVerified: boolean;
  productionVerification?: {
    expectedSiteNamespaces: number;
    siteNamespaces: number;
    expectedSiteRows: number;
    freshSiteRows: number;
    targetNamespaces: number;
    schoolValuesMatched: number;
    retiredGamePayloads: number;
    curatedRowsMatched: number;
    mainAppRowsMatched: number;
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = repairSeoCtaTranslations({
    remote: process.argv.includes("--remote"),
    confirmed: process.argv.includes("--confirm-production"),
    backupDir: resolveBackupDir(),
  });
  console.log(JSON.stringify(report, null, 2));
}

export function repairSeoCtaTranslations(options: {
  remote: boolean;
  confirmed: boolean;
  backupDir: string;
}): RepairReport {
  if (options.remote && !options.confirmed) {
    throw new Error("Remote SEO translation repair requires --confirm-production.");
  }

  const translations = loadAndValidateTranslationSeed();
  const curatedRepairRows = loadCuratedNamespaceRepairRows();
  const mainAppRepairRows = loadMainAppRepairRows();
  const mainAppRepairPlan = buildMainAppRepairPlan(mainAppRepairRows);
  const manifestNamespacesVerified = validateSiteSourceManifestFreshness();
  const sourceHashes = validateSourceContract();
  const repairSql = fs.readFileSync(repairSqlPath, "utf8");
  validateRepairSql(repairSql, translations, sourceHashes);
  const curatedRepairSql = buildCuratedNamespaceRepairSql(curatedRepairRows);
  const largestCuratedRepairStatementBytes = assertD1SqlStatementSize(curatedRepairSql);
  const completeRepairSql = buildAtomicSeoCtaRepairSql(
    curatedRepairSql,
    mainAppRepairPlan.sql,
    repairSql,
  );
  const common = {
    createdAt: new Date().toISOString(),
    database: D1_DATABASE_NAME,
    translationCount: translations.size,
    curatedTranslationRows: curatedRepairRows.length,
    largestCuratedRepairStatementBytes,
    mainAppTranslationRows: mainAppRepairRows.length,
    mainAppRepairStatements:
      mainAppRepairPlan.resetStatements + mainAppRepairPlan.patchStatements,
    mainAppRepairLogicalRowWrites: mainAppRepairPlan.logicalRowWrites,
    largestMainAppRepairStatementBytes: mainAppRepairPlan.largestStatementBytes,
    manifestNamespacesVerified,
    sourceHashes,
    repairSqlSha256: sha256(completeRepairSql),
  };

  if (!options.remote) {
    const report: RepairReport = {
      ...common,
      mode: "verify",
      ok: true,
      timeTravelVerified: false,
    };
    writeReport(report, options.backupDir);
    return report;
  }

  const cfDir = cloudflareDir(options.backupDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(cfDir, "d1-before-seo-cta-repair-" + timestamp + ".sql");
  const timeTravel = runWrangler([
    "d1",
    "time-travel",
    "info",
    D1_DATABASE_NAME,
    "--json",
  ]);
  const timeTravelVerified = /bookmark|timestamp|database/i.test(timeTravel);
  if (!timeTravelVerified) {
    throw new Error("Could not verify D1 Time Travel before translation repair.");
  }
  const staticRepairRows = validateRemoteRepairTargets(translations);

  const previousUmask = process.umask(0o077);
  try {
    runWrangler(
      [
        "d1",
        "export",
        D1_DATABASE_NAME,
        "--remote",
        "--output",
        backupPath,
        "--skip-confirmation",
        "--table",
        "app_translations",
        "--table",
        "app_translation_sources",
        "--table",
        "app_translation_source_strings",
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    );
  } finally {
    process.umask(previousUmask);
  }
  fs.chmodSync(backupPath, 0o600);

  const sourceSync = planSiteTranslationSourceSync("remote");
  const projectedBilledRowWrites = projectRepairBilledRowWrites(
    sourceSync.projectedBilledRowWrites,
    staticRepairRows,
    curatedRepairRows.length,
    mainAppRepairPlan.logicalRowWrites,
  );
  if (projectedBilledRowWrites > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES) {
    throw new Error(
      "Projected atomic translation repair writes exceed the Workers Free safety budget: " +
        projectedBilledRowWrites +
        " > " +
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES +
        ".",
    );
  }

  const atomicSqlPath = writeTemporarySqlFile(
    buildAtomicSeoCtaRepairSql(sourceSync.sql, completeRepairSql),
    "atomic-seo-cta-translation-repair.sql",
  );
  try {
    // D1 executes a remote SQL file atomically. Keeping source-hash changes and
    // payload repairs in one file prevents a failed second command from making
    // every affected translation appear stale.
    runWrangler(
      [
        "d1",
        "execute",
        D1_DATABASE_NAME,
        "--remote",
        "--file",
        atomicSqlPath,
        "--yes",
      ],
      { maxBuffer: 128 * 1024 * 1024 },
    );
  } finally {
    fs.rmSync(path.dirname(atomicSqlPath), { recursive: true, force: true });
  }

  const productionVerification = verifyRemoteRepair(
    translations,
    curatedRepairRows,
    mainAppRepairRows,
  );
  const report: RepairReport = {
    ...common,
    mode: "remote",
    ok: true,
    backupPath,
    sourceSyncSha256: sourceSync.sha256,
    sourceSyncStatements: sourceSync.statements,
    sourceSyncLogicalRowWrites: sourceSync.logicalRowWrites,
    staticRepairRows,
    projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    timeTravelVerified,
    productionVerification,
  };
  writeReport(report, options.backupDir);
  return report;
}

export function buildAtomicSeoCtaRepairSql(...sqlParts: readonly string[]) {
  const statements = sqlParts.map((sql) => sql.trim()).filter(Boolean);
  if (!statements.length) throw new Error("Atomic SEO translation repair SQL must not be empty.");
  const sql = statements.join("\n") + "\n";
  assertNoExplicitTransactionControl(sql);
  assertD1SqlStatementSize(sql);
  return sql;
}

export function loadCuratedNamespaceRepairRows(): CuratedNamespaceRepairRow[] {
  const rows: CuratedNamespaceRepairRow[] = [];
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);

  for (const namespace of curatedRepairNamespaces) {
    const source = getSiteTranslationSource(namespace);
    for (const language of targetLanguages) {
      const bundle = getCuratedTranslationBundle(source, language);
      if (!bundle || !isTranslationBundleCompleteAndFluent(source, bundle, language)) {
        throw new Error(`Curated ${namespace} translation is not render-ready for ${language}.`);
      }

      const payload: Record<string, string> = {};
      for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
        const value = bundle.strings[key];
        if (!isValidFieldTranslation(sourceText, value, language) || value !== value.normalize("NFC")) {
          throw new Error(`Curated ${namespace} translation is invalid for ${language}/${key}.`);
        }
        payload[key] = value;
      }
      rows.push({ namespace, language, sourceHash: source.sourceHash, payload });
    }
  }

  return rows;
}

export function loadMainAppRepairRows(): MainAppRepairRow[] {
  const rows: MainAppRepairRow[] = [];
  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  const sourceKeys = Object.keys(sourceStrings).sort();
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);

  for (const language of targetLanguages) {
    const bundle = getCuratedMainAppTranslationBundle(language);
    if (
      !bundle ||
      bundle.namespace !== mainAppTranslationNamespace ||
      bundle.language !== language ||
      bundle.sourceHash !== sourceHash
    ) {
      throw new Error(`Tracked main-app translation metadata is invalid for ${language}.`);
    }

    const bundleKeys = Object.keys(bundle.strings).sort();
    if (
      bundleKeys.length !== sourceKeys.length ||
      sourceKeys.some((key, index) => key !== bundleKeys[index])
    ) {
      throw new Error(`Tracked main-app translation is incomplete for ${language}.`);
    }

    const payload: Record<string, string> = {};
    for (const key of sourceKeys) {
      const sourceText = sourceStrings[key];
      const value = bundle.strings[key];
      if (!isValidFieldTranslation(sourceText, value, language) || value !== value.normalize("NFC")) {
        throw new Error(`Tracked main-app translation is invalid for ${language}/${key}.`);
      }
      payload[key] = value;
    }
    rows.push({
      namespace: mainAppTranslationNamespace,
      language,
      sourceHash,
      payload,
    });
  }

  return rows;
}

export function buildMainAppRepairPlan(rows: readonly MainAppRepairRow[]): MainAppRepairPlan {
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const expectedLanguages = new Set<SupportedLanguage>(targetLanguages);
  if (rows.length !== expectedLanguages.size) {
    throw new Error(
      `Expected ${expectedLanguages.size} main-app translation rows, received ${rows.length}.`,
    );
  }

  const sourceStrings = getMainAppSourceStrings();
  const sourceHash = getMainAppSourceHash(sourceStrings);
  const sourceKeys = Object.keys(sourceStrings).sort();
  const seenLanguages = new Set<SupportedLanguage>();
  const statements = [buildMainAppCardinalityGuardSql(targetLanguages)];
  let resetStatements = 0;
  let patchStatements = 0;

  for (const row of rows) {
    if (
      row.namespace !== mainAppTranslationNamespace ||
      !expectedLanguages.has(row.language) ||
      row.sourceHash !== sourceHash
    ) {
      throw new Error(`Unexpected main-app translation row ${row.namespace}/${row.language}.`);
    }
    if (seenLanguages.has(row.language)) {
      throw new Error(`Duplicate main-app translation row for ${row.language}.`);
    }
    seenLanguages.add(row.language);

    const payloadKeys = Object.keys(row.payload).sort();
    if (
      payloadKeys.length !== sourceKeys.length ||
      sourceKeys.some((key, index) => key !== payloadKeys[index])
    ) {
      throw new Error(`Incomplete main-app translation payload for ${row.language}.`);
    }
    for (const key of sourceKeys) {
      const value = row.payload[key];
      if (
        !isValidFieldTranslation(sourceStrings[key], value, row.language) ||
        value !== value.normalize("NFC")
      ) {
        throw new Error(`Invalid main-app translation payload for ${row.language}/${key}.`);
      }
    }

    statements.push(buildMainAppResetStatement(row));
    resetStatements += 1;
    const patchSql = buildMainAppPatchStatements(row, sourceKeys);
    statements.push(...patchSql);
    patchStatements += patchSql.length;
  }

  if (seenLanguages.size !== expectedLanguages.size) {
    throw new Error(
      `Main-app translation row set is incomplete: ${seenLanguages.size}/${expectedLanguages.size}.`,
    );
  }

  const sql = statements.join("\n\n");
  return {
    sql,
    rows: rows.length,
    resetStatements,
    patchStatements,
    logicalRowWrites: resetStatements + patchStatements,
    largestStatementBytes: assertD1SqlStatementSize(sql),
  };
}

function buildMainAppCardinalityGuardSql(languages: readonly SupportedLanguage[]) {
  const allowedLanguages = languages.map(sqlString).join(", ");
  return [
    "SELECT CASE",
    `  WHEN COUNT(*) = ${languages.length}`,
    `    AND SUM(CASE WHEN language IN (${allowedLanguages}) THEN 1 ELSE 0 END) = ${languages.length}`,
    "  THEN json('{}')",
    "  ELSE json('main-app-cardinality-guard-failed')",
    "END AS main_app_cardinality_guard",
    "FROM app_translations",
    `WHERE namespace = ${sqlString(mainAppTranslationNamespace)};`,
  ].join("\n");
}

function buildMainAppResetStatement(row: MainAppRepairRow) {
  const now = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
  return [
    "UPDATE app_translations",
    "SET",
    "  payload = json('{}'),",
    `  source_hash = ${sqlString(row.sourceHash)},`,
    `  model = ${sqlString(mainAppRepairModel)},`,
    `  updated_at = ${now}`,
    `WHERE namespace = ${sqlString(mainAppTranslationNamespace)}`,
    `  AND language = ${sqlString(row.language)};`,
  ].join("\n");
}

function buildMainAppPatchStatements(
  row: MainAppRepairRow,
  sourceKeys: readonly string[],
) {
  const statements: string[] = [];
  const emptyStatement = buildMainAppPatchStatement(row.language, "{}");
  const fixedStatementBytes =
    Buffer.byteLength(emptyStatement, "utf8") - Buffer.byteLength(sqlString("{}"), "utf8");
  let fragments: string[] = [];
  let encodedFragmentBytes = 0;

  const flush = () => {
    if (!fragments.length) return;
    const chunkJson = `{${fragments.join(",")}}`;
    const statement = buildMainAppPatchStatement(row.language, chunkJson);
    const bytes = Buffer.byteLength(statement, "utf8");
    if (bytes > mainAppPatchStatementTargetBytes) {
      throw new Error(
        `Main-app patch statement exceeds the ${mainAppPatchStatementTargetBytes}-byte target: ` +
          `${row.language} is ${bytes} bytes.`,
      );
    }
    statements.push(statement);
    fragments = [];
    encodedFragmentBytes = 0;
  };

  for (const key of sourceKeys) {
    const fragment = `${JSON.stringify(key)}:${JSON.stringify(row.payload[key])}`;
    const encodedBytes = Buffer.byteLength(fragment.replaceAll("'", "''"), "utf8");
    const commaBytes = fragments.length ? 1 : 0;
    const candidateStatementBytes =
      fixedStatementBytes +
      4 +
      encodedFragmentBytes +
      commaBytes +
      encodedBytes;
    if (candidateStatementBytes > mainAppPatchStatementTargetBytes && fragments.length) {
      flush();
    }

    const singleFragmentStatementBytes = fixedStatementBytes + 4 + encodedBytes;
    if (singleFragmentStatementBytes > mainAppPatchStatementTargetBytes) {
      throw new Error(
        `Main-app translation entry exceeds the D1 patch target for ${row.language}/${key}.`,
      );
    }
    if (fragments.length) encodedFragmentBytes += 1;
    fragments.push(fragment);
    encodedFragmentBytes += encodedBytes;
  }
  flush();
  return statements;
}

function buildMainAppPatchStatement(language: SupportedLanguage, chunkJson: string) {
  return [
    "UPDATE app_translations",
    `SET payload = json_patch(payload, json(${sqlString(chunkJson)}))`,
    `WHERE namespace = ${sqlString(mainAppTranslationNamespace)}`,
    `  AND language = ${sqlString(language)};`,
  ].join("\n");
}

export function buildCuratedNamespaceRepairSql(rows: readonly CuratedNamespaceRepairRow[]) {
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const expectedIdentifiers = new Set(
    curatedRepairNamespaces.flatMap((namespace) =>
      targetLanguages.map((language) => curatedRepairIdentifier(namespace, language)),
    ),
  );
  const expectedRows = expectedIdentifiers.size;
  if (rows.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} curated translation rows, received ${rows.length}.`);
  }

  const seenIdentifiers = new Set<string>();
  const statements = rows.map((row) => {
    const identifier = curatedRepairIdentifier(row.namespace, row.language);
    if (!expectedIdentifiers.has(identifier)) {
      throw new Error(`Unexpected curated translation row ${row.namespace}/${row.language}.`);
    }
    if (seenIdentifiers.has(identifier)) {
      throw new Error(`Duplicate curated translation row ${row.namespace}/${row.language}.`);
    }
    seenIdentifiers.add(identifier);

    const source = getSiteTranslationSource(row.namespace);
    if (row.sourceHash !== source.sourceHash) {
      throw new Error(`Stale curated translation source hash for ${row.namespace}/${row.language}.`);
    }
    const sourceKeys = Object.keys(source.sourceStrings).sort();
    const payloadKeys = Object.keys(row.payload).sort();
    if (
      payloadKeys.length !== sourceKeys.length ||
      sourceKeys.some((key, index) => key !== payloadKeys[index])
    ) {
      throw new Error(`Incomplete curated translation payload for ${row.namespace}/${row.language}.`);
    }
    for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
      const value = row.payload[key];
      if (!isValidFieldTranslation(sourceText, value, row.language) || value !== value.normalize("NFC")) {
        throw new Error(`Invalid curated translation payload for ${row.namespace}/${row.language}/${key}.`);
      }
    }

    const now = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
    const statement = [
      "INSERT INTO app_translations",
      "  (namespace, language, source_hash, payload, model, created_at, updated_at)",
      "VALUES",
      `  (${sqlString(row.namespace)}, ${sqlString(row.language)}, ${sqlString(row.sourceHash)},`,
      `   json(${sqlString(JSON.stringify(row.payload))}), ${sqlString(curatedRepairModel)}, ${now}, ${now})`,
      "ON CONFLICT(namespace, language) DO UPDATE SET",
      "  source_hash = excluded.source_hash,",
      "  payload = excluded.payload,",
      "  model = excluded.model,",
      "  updated_at = excluded.updated_at;",
    ].join("\n");
    const bytes = Buffer.byteLength(statement, "utf8");
    if (bytes > maximumD1SqlStatementBytes) {
      throw new Error(
        `Curated translation SQL exceeds the D1 ${maximumD1SqlStatementBytes}-byte statement limit: ` +
          `${row.namespace}/${row.language} is ${bytes} bytes.`,
      );
    }
    return statement;
  });
  if (seenIdentifiers.size !== expectedIdentifiers.size) {
    throw new Error(
      `Curated translation row set is incomplete: ${seenIdentifiers.size}/${expectedIdentifiers.size}.`,
    );
  }
  return statements.join("\n\n");
}

export function largestSqlStatementBytes(sql: string) {
  return Math.max(
    0,
    ...splitSqlStatements(sql).map((statement) => Buffer.byteLength(statement, "utf8")),
  );
}

export function assertD1SqlStatementSize(sql: string) {
  const largest = largestSqlStatementBytes(sql);
  if (largest > maximumD1SqlStatementBytes) {
    throw new Error(
      `SQL exceeds the D1 ${maximumD1SqlStatementBytes}-byte statement limit: ` +
        `${largest} bytes.`,
    );
  }
  return largest;
}

export function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let statementStart = 0;
  let quote: "'" | '"' | "`" | "]" | undefined;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (quote !== "]" && next === quote) {
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (character === "-" && next === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") {
      quote = "]";
      continue;
    }
    if (character !== ";") continue;

    const statement = sql.slice(statementStart, index + 1).trim();
    if (statement) statements.push(statement);
    statementStart = index + 1;
  }

  if (quote || inBlockComment) {
    throw new Error("SQL statement parsing failed because a quote or block comment is unterminated.");
  }

  const trailingStatement = sql.slice(statementStart).trim();
  if (trailingStatement) statements.push(trailingStatement);
  return statements;
}

export function projectRepairBilledRowWrites(
  sourceSyncProjectedWrites: number,
  staticRepairRows: number,
  curatedRepairRows: number,
  mainAppRepairRowWrites: number,
) {
  const counts = [
    sourceSyncProjectedWrites,
    staticRepairRows,
    curatedRepairRows,
    mainAppRepairRowWrites,
  ];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Projected D1 repair write inputs must be non-negative safe integers.");
  }
  return (
    sourceSyncProjectedWrites +
    (staticRepairRows + curatedRepairRows + mainAppRepairRowWrites) *
      projectedBilledWritesPerRepairTranslationRow
  );
}

type StaticRepairTargetCount = {
  namespace: string;
  rows: number;
  unsupportedLanguages: number;
};

export function validateStaticRepairTargetCounts(
  rows: readonly StaticRepairTargetCount[],
  expectedLanguageCount: number,
) {
  if (!Number.isSafeInteger(expectedLanguageCount) || expectedLanguageCount <= 0) {
    throw new Error("Expected translation language count must be a positive safe integer.");
  }
  const counts = new Map<string, StaticRepairTargetCount>();
  for (const row of rows) {
    if (!staticRepairNamespaceNames.has(row.namespace)) {
      throw new Error(`Unexpected production translation namespace ${row.namespace}.`);
    }
    if (counts.has(row.namespace)) {
      throw new Error(`Duplicate production translation cardinality row for ${row.namespace}.`);
    }
    if (
      !Number.isSafeInteger(row.rows) ||
      row.rows < 0 ||
      !Number.isSafeInteger(row.unsupportedLanguages) ||
      row.unsupportedLanguages < 0
    ) {
      throw new Error(`Invalid production translation cardinality for ${row.namespace}.`);
    }
    counts.set(row.namespace, row);
  }
  let totalRows = 0;
  for (const namespace of staticRepairNamespaces) {
    const row = counts.get(namespace) ?? {
      namespace,
      rows: 0,
      unsupportedLanguages: 0,
    };
    const allowedCount =
      namespace === "marketing-site"
        ? row.rows === 0 || row.rows === expectedLanguageCount
        : row.rows === expectedLanguageCount;
    if (!allowedCount || row.unsupportedLanguages !== 0) {
      throw new Error(
        `Unexpected production translation cardinality for ${namespace}: ` +
          `${row.rows} rows, ${row.unsupportedLanguages} unsupported languages.`,
      );
    }
    totalRows += row.rows;
  }
  return totalRows;
}

export function validateCuratedRepairTargetCounts(
  rows: readonly StaticRepairTargetCount[],
  expectedLanguageCount: number,
) {
  if (!Number.isSafeInteger(expectedLanguageCount) || expectedLanguageCount <= 0) {
    throw new Error("Expected translation language count must be a positive safe integer.");
  }
  const counts = new Map<string, StaticRepairTargetCount>();
  for (const row of rows) {
    if (!curatedRepairNamespaceNames.has(row.namespace)) {
      throw new Error(`Unexpected curated production translation namespace ${row.namespace}.`);
    }
    if (counts.has(row.namespace)) {
      throw new Error(`Duplicate curated production cardinality row for ${row.namespace}.`);
    }
    if (
      !Number.isSafeInteger(row.rows) ||
      row.rows < 0 ||
      row.rows > expectedLanguageCount ||
      !Number.isSafeInteger(row.unsupportedLanguages) ||
      row.unsupportedLanguages < 0
    ) {
      throw new Error(`Invalid curated production translation cardinality for ${row.namespace}.`);
    }
    if (row.unsupportedLanguages !== 0) {
      throw new Error(
        `Unexpected curated production translation languages for ${row.namespace}: ` +
          `${row.unsupportedLanguages} unsupported languages.`,
      );
    }
    counts.set(row.namespace, row);
  }
  return curatedRepairNamespaces.reduce(
    (total, namespace) => total + (counts.get(namespace)?.rows ?? 0),
    0,
  );
}

export function validateMainAppRepairTargetCounts(
  rows: readonly StaticRepairTargetCount[],
  expectedLanguageCount: number,
) {
  if (!Number.isSafeInteger(expectedLanguageCount) || expectedLanguageCount <= 0) {
    throw new Error("Expected translation language count must be a positive safe integer.");
  }
  if (rows.length !== 1 || rows[0]?.namespace !== mainAppTranslationNamespace) {
    throw new Error("Production main-app translation cardinality row is missing or duplicated.");
  }
  const row = rows[0];
  if (
    row.rows !== expectedLanguageCount ||
    row.unsupportedLanguages !== 0 ||
    !Number.isSafeInteger(row.rows) ||
    !Number.isSafeInteger(row.unsupportedLanguages)
  ) {
    throw new Error(
      "Unexpected production main-app translation cardinality: " +
        `${row.rows} rows, ${row.unsupportedLanguages} unsupported languages.`,
    );
  }
  return row.rows;
}

function validateRemoteRepairTargets(
  translations: ReadonlyMap<SupportedLanguage, string>,
) {
  const allowedLanguages = Array.from(translations.keys(), (language) => `(${sqlString(language)})`).join(",");
  const namespaces = [
    ...staticRepairNamespaces,
    ...curatedRepairNamespaces,
    mainAppTranslationNamespace,
  ]
    .map(sqlString)
    .join(",");
  const sql = [
    `WITH allowed_languages(language) AS (VALUES ${allowedLanguages})`,
    "SELECT target.namespace, COUNT(*) AS rows,",
    "  SUM(CASE WHEN allowed_languages.language IS NULL THEN 1 ELSE 0 END) AS unsupported_languages",
    "FROM app_translations AS target",
    "LEFT JOIN allowed_languages ON allowed_languages.language = target.language",
    `WHERE target.namespace IN (${namespaces})`,
    "GROUP BY target.namespace ORDER BY target.namespace;",
  ].join("\n");
  const output = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  const rows = d1ResultRows(output).map((row) => ({
    namespace: typeof row.namespace === "string" ? row.namespace : "",
    rows: numeric(row.rows),
    unsupportedLanguages: numeric(row.unsupported_languages),
  }));
  const staticRows = rows.filter((row) => staticRepairNamespaceNames.has(row.namespace));
  const curatedRows = rows.filter((row) => curatedRepairNamespaceNames.has(row.namespace));
  const mainAppRows = rows.filter((row) => row.namespace === mainAppTranslationNamespace);
  if (staticRows.length + curatedRows.length + mainAppRows.length !== rows.length) {
    throw new Error("Remote translation cardinality returned an unexpected namespace.");
  }
  validateCuratedRepairTargetCounts(curatedRows, translations.size);
  validateMainAppRepairTargetCounts(mainAppRows, translations.size);
  return validateStaticRepairTargetCounts(staticRows, translations.size);
}

export function validateSiteSourceManifestFreshness() {
  const extractedNamespaces = [
    siteTranslationNamespace,
    ...getAllSiteTranslationNamespaces({ mode: "extract" }),
  ].sort();
  const manifestNamespaces = Object.keys(siteSourceManifest).sort();
  if (
    extractedNamespaces.length !== manifestNamespaces.length ||
    extractedNamespaces.some((namespace, index) => namespace !== manifestNamespaces[index])
  ) {
    throw new Error("Generated site translation manifest namespace set is stale.");
  }

  for (const namespace of extractedNamespaces) {
    const manifestSource = getSiteTranslationSource(namespace);
    const extractedSource = getSiteTranslationSource(namespace, { mode: "extract" });
    if (manifestSource.sourceHash !== extractedSource.sourceHash) {
      throw new Error(
        "Generated site translation manifest is stale for " +
          namespace +
          ": " +
          manifestSource.sourceHash +
          " != " +
          extractedSource.sourceHash +
          ".",
      );
    }
  }
  return extractedNamespaces.length;
}

export function loadAndValidateTranslationSeed() {
  const parsed: unknown = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("SEO CTA translation seed must be an object.");
  }

  const translations = new Map<SupportedLanguage, string>();
  const targetLanguages = supportedLanguages.filter((language) => language !== defaultLanguage);
  const expected = new Set<string>(targetLanguages);
  const extra = Object.keys(parsed).filter((language) => !expected.has(language));
  if (extra.length) {
    throw new Error("Unexpected SEO CTA translation languages: " + extra.join(", "));
  }

  for (const language of targetLanguages) {
    const value = parsed[language];
    if (typeof value !== "string" || value !== value.normalize("NFC")) {
      throw new Error("Missing or non-NFC SEO CTA translation for " + language + ".");
    }
    if (!isValidFieldTranslation("Try public modes", value, language)) {
      throw new Error("SEO CTA translation failed field validation for " + language + ".");
    }
    translations.set(language, value);
  }
  return translations;
}

function validateSourceContract(): Record<RepairNamespace, string> {
  const marketingSite = getSiteTranslationSource("marketing-site");
  if (marketingSite.sourceHash !== expectedSourceHashes["marketing-site"]) {
    throw new Error("Translation source hash drift for marketing-site: " + marketingSite.sourceHash);
  }
  for (const key of retiredGameTranslationKeys) {
    if (key in marketingSite.sourceStrings) {
      throw new Error("Retired game translation key remains in marketing-site: " + key);
    }
  }

  const contracts: ReadonlyArray<{
    namespace: RepairNamespace;
    key: string;
    sourceText: string;
  }> = [
    { namespace: "route:home", key: startLearningKey, sourceText: "Start learning" },
    { namespace: "route:about", key: startLearningKey, sourceText: "Start learning" },
    { namespace: "route:media", key: startLearningKey, sourceText: "Start learning" },
    { namespace: "route:schools", key: tryPublicModesKey, sourceText: "Try public modes" },
  ];
  const hashes: Record<RepairNamespace, string> = {
    "marketing-site": marketingSite.sourceHash,
    "route:home": "",
    "route:about": "",
    "route:chat-public": "",
    "route:media": "",
    "route:schools": "",
  };

  const publicChat = getSiteTranslationSource("route:chat-public");
  if (publicChat.sourceHash !== expectedSourceHashes["route:chat-public"]) {
    throw new Error("Translation source hash drift for route:chat-public: " + publicChat.sourceHash);
  }
  hashes["route:chat-public"] = publicChat.sourceHash;

  for (const contract of contracts) {
    const source = getSiteTranslationSource(contract.namespace);
    if (source.sourceHash !== expectedSourceHashes[contract.namespace]) {
      throw new Error(
        "Translation source hash drift for " + contract.namespace + ": " + source.sourceHash,
      );
    }
    if (source.sourceStrings[contract.key] !== contract.sourceText) {
      throw new Error("Translation source key drift for " + contract.namespace + ".");
    }
    hashes[contract.namespace] = source.sourceHash;
  }
  return hashes;
}

function validateRepairSql(
  sql: string,
  translations: ReadonlyMap<SupportedLanguage, string>,
  sourceHashes: Record<RepairNamespace, string>,
) {
  for (const hash of Object.values(sourceHashes)) {
    if (!sql.includes(hash)) {
      throw new Error("SEO CTA repair SQL is missing source hash " + hash + ".");
    }
  }
  if (!sql.includes(startLearningKey) || !sql.includes(tryPublicModesKey) || !sql.includes(model)) {
    throw new Error("SEO CTA repair SQL is missing its required keys or provenance.");
  }
  if (!sql.includes(previousMarketingSiteHash)) {
    throw new Error("SEO CTA repair SQL is missing the previous marketing-site source hash.");
  }
  for (const key of retiredGameTranslationKeys) {
    if (!sql.includes(key)) {
      throw new Error("SEO CTA repair SQL is missing retired game translation key " + key + ".");
    }
  }
  for (const [language, value] of translations) {
    const row = "(" + sqlString(language) + ", " + sqlString(value) + ")";
    if (!sql.includes(row)) {
      throw new Error("SEO CTA repair SQL does not match the seed for " + language + ".");
    }
  }
}

export function buildRemoteRepairVerificationSql(
  translations: ReadonlyMap<SupportedLanguage, string>,
) {
  const expectedNamespaces = getPublishedSiteTranslationNamespaces();
  const expectedNamespaceValues = expectedNamespaces
    .map((namespace) => `(${sqlString(namespace)})`)
    .join(",");
  const allowedLanguageValues = Array.from(
    translations.keys(),
    (language) => `(${sqlString(language)})`,
  ).join(",");
  const repairValues = Array.from(translations, ([language, value]) => {
    return "(" + sqlString(language) + ", " + sqlString(value) + ")";
  }).join(",");
  return [
    `WITH expected_namespaces(namespace) AS (VALUES ${expectedNamespaceValues}),`,
    `allowed_languages(language) AS (VALUES ${allowedLanguageValues})`,
    "SELECT COUNT(*) AS site_rows, COUNT(DISTINCT t.namespace) AS site_namespaces,",
    "  SUM(t.source_hash = s.source_hash) AS fresh_rows,",
    "  SUM(CASE WHEN expected_namespaces.namespace IS NULL THEN 1 ELSE 0 END) AS unexpected_namespaces,",
    "  SUM(CASE WHEN allowed_languages.language IS NULL THEN 1 ELSE 0 END) AS unsupported_languages",
    "FROM app_translations AS t JOIN app_translation_sources AS s USING (namespace)",
    "LEFT JOIN expected_namespaces ON expected_namespaces.namespace = t.namespace",
    "LEFT JOIN allowed_languages ON allowed_languages.language = t.language",
    `WHERE t.namespace <> ${sqlString(siteTranslationNamespace)};`,
    "SELECT t.namespace, COUNT(*) AS rows, COUNT(DISTINCT t.language) AS languages,",
    "  SUM(t.source_hash = s.source_hash) AS fresh_rows,",
    "  SUM(CASE WHEN NOT EXISTS (",
    "    SELECT 1 FROM app_translation_source_strings AS ss",
    "    WHERE ss.namespace = t.namespace AND (",
    "      COALESCE(json_type(t.payload, '$.\"' || ss.source_key || '\"'), '') <> 'text'",
    "      OR COALESCE(TRIM(CAST(json_extract(t.payload, '$.\"' || ss.source_key || '\"') AS TEXT)), '') = ''",
    "    )",
    "  ) THEN 1 ELSE 0 END) AS complete_rows",
    "FROM app_translations AS t JOIN app_translation_sources AS s USING (namespace)",
    "WHERE t.namespace IN ('route:about', 'route:media', 'route:schools')",
    "GROUP BY t.namespace ORDER BY t.namespace;",
    "SELECT target.namespace, SUM(CASE WHEN",
    "  json_extract(target.payload, '$.\"" + startLearningKey + "\"') IS",
    "  json_extract(home.payload, '$.\"" + startLearningKey + "\"')",
    "  THEN 0 ELSE 1 END) AS mismatches",
    "FROM app_translations AS target",
    "JOIN app_translations AS home ON home.namespace = 'route:home' AND home.language = target.language",
    "WHERE target.namespace IN ('route:about', 'route:media')",
    "GROUP BY target.namespace ORDER BY target.namespace;",
    "SELECT namespace, model, COUNT(*) AS rows FROM app_translations",
    "WHERE namespace IN ('route:about', 'route:media', 'route:schools')",
    "GROUP BY namespace, model ORDER BY namespace, model;",
    "WITH repair_values(language, value) AS (VALUES " + repairValues + ")",
    "SELECT COUNT(*) AS school_values_matched",
    "FROM app_translations AS target",
    "JOIN repair_values ON repair_values.language = target.language",
    "WHERE target.namespace = 'route:schools'",
    "  AND json_extract(target.payload, '$.\"" + tryPublicModesKey + "\"') = repair_values.value;",
    "SELECT COUNT(*) AS retired_game_payloads FROM app_translations",
    "WHERE namespace = 'marketing-site' AND (",
    ...retiredGameTranslationKeys.flatMap((key, index) => [
      (index === 0 ? "  " : "  OR ") + "json_type(payload, '$.\"" + key + "\"') IS NOT NULL",
    ]),
    ");",
  ].join("\n");
}

function verifyRemoteRepair(
  translations: ReadonlyMap<SupportedLanguage, string>,
  curatedRepairRows: readonly CuratedNamespaceRepairRow[],
  mainAppRepairRows: readonly MainAppRepairRow[],
) {
  const expectedSiteNamespaces = getPublishedSiteTranslationNamespaces().length;
  const expectedSiteRows = expectedSiteNamespaces * translations.size;
  const verificationSql = buildRemoteRepairVerificationSql(translations);
  const output = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    verificationSql,
  ], { maxBuffer: 64 * 1024 * 1024 });
  const rows = d1ResultRows(output);
  const site = rows.find((row) => "site_rows" in row);
  const targets = rows.filter((row) => typeof row.namespace === "string" && "complete_rows" in row);
  const mismatches = rows.filter((row) => typeof row.namespace === "string" && "mismatches" in row);
  const models = rows.filter((row) => typeof row.namespace === "string" && "model" in row);
  const schools = rows.find((row) => "school_values_matched" in row);
  const retired = rows.find((row) => "retired_game_payloads" in row);
  const freshSiteRows = numeric(site?.fresh_rows);
  const siteNamespaces = numeric(site?.site_namespaces);
  const unexpectedNamespaces = numeric(site?.unexpected_namespaces);
  const unsupportedLanguages = numeric(site?.unsupported_languages);
  const schoolValuesMatched = numeric(schools?.school_values_matched);
  const retiredGamePayloads = numeric(retired?.retired_game_payloads);

  if (
    numeric(site?.site_rows) !== expectedSiteRows ||
    siteNamespaces !== expectedSiteNamespaces ||
    freshSiteRows !== expectedSiteRows ||
    unexpectedNamespaces !== 0 ||
    unsupportedLanguages !== 0
  ) {
    throw new Error("Site translation freshness verification failed.");
  }
  if (
    targets.length !== 3 ||
    targets.some((row) =>
      [row.rows, row.languages, row.fresh_rows, row.complete_rows].some(
        (value) => numeric(value) !== translations.size,
      ),
    )
  ) {
    throw new Error("Target translation completeness verification failed.");
  }
  if (mismatches.length !== 2 || mismatches.some((row) => numeric(row.mismatches) !== 0)) {
    throw new Error("Start learning translation verification failed.");
  }
  if (
    models.length !== 3 ||
    models.some((row) => row.model !== model || numeric(row.rows) !== translations.size)
  ) {
    throw new Error("Translation repair provenance verification failed.");
  }
  if (schoolValuesMatched !== translations.size) {
    throw new Error("Try public modes translation verification failed.");
  }
  if (retiredGamePayloads !== 0) {
    throw new Error("Retired game translation payload verification failed.");
  }

  const curatedOutput = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    "SELECT namespace, language, payload, source_hash, model FROM app_translations " +
      "WHERE namespace IN ('marketing-shell', 'route:home') ORDER BY namespace, language;",
  ], { maxBuffer: 64 * 1024 * 1024 });
  const actualCuratedRows = d1ResultRows(curatedOutput);
  if (actualCuratedRows.length !== curatedRepairRows.length) {
    throw new Error(
      `Curated translation row cardinality failed: ${actualCuratedRows.length}/${curatedRepairRows.length}.`,
    );
  }
  const expectedCuratedRows = new Map<string, CuratedNamespaceRepairRow>(
    curatedRepairRows.map((row) => [`${row.namespace}\u0000${row.language}`, row] as const),
  );
  let curatedRowsMatched = 0;
  for (const actual of actualCuratedRows) {
    if (typeof actual.namespace !== "string" || typeof actual.language !== "string") continue;
    const expected = expectedCuratedRows.get(`${actual.namespace}\u0000${actual.language}`);
    if (!expected) continue;
    if (
      actual.source_hash !== expected.sourceHash ||
      actual.model !== curatedRepairModel ||
      typeof actual.payload !== "string"
    ) {
      throw new Error(`Curated translation metadata verification failed for ${actual.namespace}/${actual.language}.`);
    }
    const payload: unknown = JSON.parse(actual.payload);
    if (!isStringRecord(payload) || !sameStringRecord(payload, expected.payload)) {
      throw new Error(`Curated translation payload verification failed for ${actual.namespace}/${actual.language}.`);
    }
    curatedRowsMatched += 1;
  }
  if (curatedRowsMatched !== curatedRepairRows.length) {
    throw new Error(
      `Curated translation row verification failed: ${curatedRowsMatched}/${curatedRepairRows.length}.`,
    );
  }

  const mainAppOutput = runWrangler(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      "SELECT namespace, language, payload, source_hash, model FROM app_translations " +
        `WHERE namespace = ${sqlString(mainAppTranslationNamespace)} ORDER BY language;`,
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  const mainAppRowsMatched = verifyMainAppRepairResultRows(
    d1ResultRows(mainAppOutput),
    mainAppRepairRows,
  );

  return {
    expectedSiteNamespaces,
    siteNamespaces,
    expectedSiteRows,
    freshSiteRows,
    targetNamespaces: targets.length,
    schoolValuesMatched,
    retiredGamePayloads,
    curatedRowsMatched,
    mainAppRowsMatched,
  };
}

export function verifyMainAppRepairResultRows(
  actualRows: readonly Record<string, unknown>[],
  expectedRows: readonly MainAppRepairRow[],
) {
  if (actualRows.length !== expectedRows.length) {
    throw new Error(
      `Main-app translation row cardinality failed: ${actualRows.length}/${expectedRows.length}.`,
    );
  }

  const expectedByLanguage = new Map<SupportedLanguage, MainAppRepairRow>(
    expectedRows.map((row) => [row.language, row]),
  );
  let matched = 0;
  for (const actual of actualRows) {
    const language = isSupportedLanguageValue(actual.language) ? actual.language : null;
    const expected = language ? expectedByLanguage.get(language) : undefined;
    if (!language || !expected) {
      throw new Error("Main-app translation verification found an unexpected or duplicate language.");
    }
    if (
      actual.namespace !== mainAppTranslationNamespace ||
      actual.source_hash !== expected.sourceHash ||
      actual.model !== mainAppRepairModel ||
      typeof actual.payload !== "string"
    ) {
      throw new Error(`Main-app translation metadata verification failed for ${language}.`);
    }
    const expectedPayload = JSON.stringify(expected.payload);
    if (actual.payload !== expectedPayload) {
      throw new Error(`Main-app translation byte equality verification failed for ${language}.`);
    }
    expectedByLanguage.delete(language);
    matched += 1;
  }

  if (expectedByLanguage.size !== 0 || matched !== expectedRows.length) {
    throw new Error(`Main-app translation row verification failed: ${matched}/${expectedRows.length}.`);
  }
  return matched;
}

function getPublishedSiteTranslationNamespaces() {
  return Object.keys(siteSourceManifest)
    .filter((namespace) => namespace !== siteTranslationNamespace)
    .sort();
}

function curatedRepairIdentifier(
  namespace: CuratedNamespaceRepairRow["namespace"],
  language: SupportedLanguage,
) {
  return `${namespace}\u0000${language}`;
}

function assertNoExplicitTransactionControl(sql: string) {
  const transactionStatement = splitSqlStatements(sql).find((statement) =>
    /^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END(?:\s+TRANSACTION)?|ROLLBACK)\b/i.test(
      stripLeadingSqlComments(statement),
    ),
  );
  if (transactionStatement) {
    throw new Error(
      "Atomic D1 repair SQL must rely on Wrangler file rollback and not contain transaction control.",
    );
  }
}

function stripLeadingSqlComments(statement: string) {
  let remainder = statement.trimStart();
  while (remainder.startsWith("--") || remainder.startsWith("/*")) {
    if (remainder.startsWith("--")) {
      const newline = remainder.indexOf("\n");
      if (newline === -1) return "";
      remainder = remainder.slice(newline + 1).trimStart();
      continue;
    }
    const end = remainder.indexOf("*/", 2);
    if (end === -1) return remainder;
    remainder = remainder.slice(end + 2).trimStart();
  }
  return remainder;
}

function d1ResultRows(output: string) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler D1 verification did not return an array.");
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of parsed) {
    if (!isRecord(entry) || entry.success !== true || !Array.isArray(entry.results)) continue;
    for (const result of entry.results) {
      if (isRecord(result)) rows.push(result);
    }
  }
  return rows;
}

function parseJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw new Error("Could not parse Wrangler JSON output.");
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function writeReport(report: RepairReport, backupDir: string) {
  fs.writeFileSync(
    path.join(cloudflareDir(backupDir), "seo-cta-translation-repair-" + report.mode + ".json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}

function sqlString(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function numeric(value: unknown) {
  return typeof value === "number" ? value : Number(value);
}

function isSupportedLanguageValue(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && supportedLanguageNames.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function sameStringRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
) {
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => actual[key] === expected[key])
  );
}
