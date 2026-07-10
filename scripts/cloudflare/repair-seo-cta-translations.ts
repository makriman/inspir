import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import {
  getAllSiteTranslationNamespaces,
  getSiteTranslationSource,
} from "@/lib/i18n/site-source";
import { siteTranslationNamespace } from "@/lib/i18n/site-source-constants";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
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
const model = "codex-curated-no-games-seo-repair-v3";
const startLearningKey = "site.02d279ce2f7b58c890";
const tryPublicModesKey = "site.fc4ad9c971ade5617d";
const retiredGameTranslationKeys = [
  "site.ee30b035ee17c34450",
  "site.5121f7306ecc75edb5",
  "site.df499d7c6f44a88703",
] as const;
const previousMarketingSiteHash = "ec84387ca93fbec6a68df90e756a5b64af6dc401b0fefbc4646866ee897b228b";
const expectedSourceHashes = {
  "marketing-site": "784fb3090db46f80d95db18611a9c8f6c784cccb397e2a0634e658734b6e5d39",
  "route:home": "fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce",
  "route:about": "6aa44ee2349a660b840519a4fc03037976d4e26ee4ceb55d7d94e2959b211a99",
  "route:media": "8f437d1337e18df480b2aef7ced339482fa4b1d53653e29fa7b06ae881a77982",
  "route:schools": "2c3294f27d9887dd9fbb10d0ad2147c31960a75ace708d1b3fc750416e6adabe",
} as const;
const maximumRepairTranslationRows = supportedLanguages.filter(
  (language) => language !== defaultLanguage,
).length * 4;
const projectedBilledWritesPerRepairTranslationRow = 2;

type RepairNamespace = keyof typeof expectedSourceHashes;

type RepairReport = {
  createdAt: string;
  mode: "verify" | "remote";
  ok: boolean;
  database: string;
  backupPath?: string;
  translationCount: number;
  manifestNamespacesVerified: number;
  sourceHashes: Record<RepairNamespace, string>;
  repairSqlSha256: string;
  sourceSyncSha256?: string;
  sourceSyncStatements?: number;
  sourceSyncLogicalRowWrites?: number;
  projectedBilledRowWrites?: number;
  projectedBilledRowWriteLimit?: number;
  timeTravelVerified: boolean;
  productionVerification?: {
    expectedSiteRows: number;
    freshSiteRows: number;
    targetNamespaces: number;
    schoolValuesMatched: number;
    retiredGamePayloads: number;
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
  const manifestNamespacesVerified = validateSiteSourceManifestFreshness();
  const sourceHashes = validateSourceContract();
  const repairSql = fs.readFileSync(repairSqlPath, "utf8");
  validateRepairSql(repairSql, translations, sourceHashes);
  const common = {
    createdAt: new Date().toISOString(),
    database: D1_DATABASE_NAME,
    translationCount: translations.size,
    manifestNamespacesVerified,
    sourceHashes,
    repairSqlSha256: sha256(repairSql),
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
  const projectedBilledRowWrites =
    sourceSync.projectedBilledRowWrites +
    maximumRepairTranslationRows * projectedBilledWritesPerRepairTranslationRow;
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
    buildAtomicSeoCtaRepairSql(sourceSync.sql, repairSql),
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

  const productionVerification = verifyRemoteRepair(translations);
  const report: RepairReport = {
    ...common,
    mode: "remote",
    ok: true,
    backupPath,
    sourceSyncSha256: sourceSync.sha256,
    sourceSyncStatements: sourceSync.statements,
    sourceSyncLogicalRowWrites: sourceSync.logicalRowWrites,
    projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    timeTravelVerified,
    productionVerification,
  };
  writeReport(report, options.backupDir);
  return report;
}

export function buildAtomicSeoCtaRepairSql(sourceSyncSql: string, repairSql: string) {
  const statements = [sourceSyncSql.trim(), repairSql.trim()].filter(Boolean);
  if (!statements.length) throw new Error("Atomic SEO translation repair SQL must not be empty.");
  return statements.join("\n") + "\n";
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
    "route:media": "",
    "route:schools": "",
  };

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

function verifyRemoteRepair(translations: ReadonlyMap<SupportedLanguage, string>) {
  const expectedSiteRows = Object.keys(siteSourceManifest)
    .filter((namespace) => namespace !== siteTranslationNamespace)
    .length * translations.size;
  const repairValues = Array.from(translations, ([language, value]) => {
    return "(" + sqlString(language) + ", " + sqlString(value) + ")";
  }).join(",");
  const verificationSql = [
    "SELECT COUNT(*) AS site_rows, SUM(t.source_hash = s.source_hash) AS fresh_rows",
    "FROM app_translations AS t JOIN app_translation_sources AS s USING (namespace);",
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
  const schoolValuesMatched = numeric(schools?.school_values_matched);
  const retiredGamePayloads = numeric(retired?.retired_game_payloads);

  if (numeric(site?.site_rows) !== expectedSiteRows || freshSiteRows !== expectedSiteRows) {
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

  return {
    expectedSiteRows,
    freshSiteRows,
    targetNamespaces: targets.length,
    schoolValuesMatched,
    retiredGamePayloads,
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
