import { createHash, stableStringify } from "./migration-config";

export const HISTORICAL_DATA_CONTINUITY_POLICY = {
  kind: "inspir-historical-data-continuity-policy-v1",
  policyId: "seo-translation-repair-rollover-2026-07-13",
  reason: "d1-release-budget-blocked-before-preservation-query",
  predecessor: {
    gitCommit: "054ecb541cacec420f09e535ed4b5e79c46d1dfe",
    sourceSha256: "ecafef85eedc234608d5034801a24167339abc2a2026ca425a2d6c056277382f",
    sourceFileCount: 1_453,
    baselineCreatedAt: "2026-07-13T01:10:08.863Z",
    baselineUtcDay: "2026-07-13",
    baselineOperationId:
      "historical-data-preservation-baseline:e803542b1792d8bedab03e87f17cdf7360f46ed0612f9e34b7ea02b976cdae98",
    baselineSha256: "5cc8984ace1500cf97039b49b357c1aaaac4bf04956c13b52ee9a2322567e427",
    ledgerFileName: "d1-release-budget-ledger-2026-07-13.json",
    ledgerSha256: "db7ecd759f5b3971a3b46d1ea73ccedd7ea48877875e07209470e353262aae89",
    candidateVersionId: "73a5299f-fd1f-47df-84a1-adf4bae573ce",
    repairRunId: "5cde8cb4-87d5-4bc9-8f05-cc93ade2e446",
  },
  budgetBlock: {
    observedRowsRead: 1_636_381,
    existingReservedRowsRead: 2_947_525,
    requestedVerificationRowsRead: 750_000,
    projectedRowsRead: 5_333_906,
    safeRowsReadLimit: 4_000_000,
    d1SnapshotQueryExecuted: false,
  },
  successor: {
    requiredUtcDay: "2026-07-14",
    maximumGapMs: 24 * 60 * 60 * 1_000,
  },
  archiveRelativeDirectory:
    "cloudflare/historical-data-continuity/seo-translation-repair-rollover-2026-07-13",
  archiveManifestFileName: "archive-manifest.json",
  archivedBaselineFileName: "predecessor-baseline.json",
  archivedLedgerFileName: "predecessor-ledger.json",
  continuityReportRelativePath: "cloudflare/historical-data-preservation-continuity.json",
} as const;

export type HistoricalDataContinuityPolicy = typeof HISTORICAL_DATA_CONTINUITY_POLICY;

export const HISTORICAL_DATA_CONTINUITY_POLICY_SHA256 = createHash()
  .update(stableStringify(HISTORICAL_DATA_CONTINUITY_POLICY))
  .digest("hex");
