import { createHash, stableStringify } from "./migration-config";

export type ProviderLookupResult = {
  ok?: boolean;
  found: boolean | null;
  detail?: unknown;
};

export type ProviderIdentity = {
  vercel: ProviderLookupResult;
  supabase: ProviderLookupResult;
};

export type ProviderCommandResult = {
  ok: boolean;
  provider?: string;
  status?: number | null;
};

export type ProviderRetirementCommandPlan = {
  provider?: string;
  command?: string;
  args?: unknown[];
};

export type ProviderRetirementRunEvidence = {
  results?: ProviderCommandResult[];
  postDeleteIdentity?: ProviderIdentity;
  retirementSafety?: {
    ok?: boolean;
    blockers?: string[];
  };
};

export type ProviderRetirementDryRunEvidence = {
  ok?: boolean;
  createdAt?: string;
  apply?: boolean;
  dryRun?: boolean;
  backupDir?: string;
  planFingerprint?: string;
  targets?: unknown;
  commands?: ProviderRetirementCommandPlan[];
};

const requiredDeletionProviders = ["vercel", "supabase"] as const;

export const PROVIDER_RETIREMENT_DRY_RUN_PLAN = "cloudflare/provider-retirement-dry-run-plan.json";
export const PROVIDER_RETIREMENT_RUN_REPORT = "cloudflare/provider-retirement-run.json";

export function providersAbsent(identity: ProviderIdentity) {
  const blockers: string[] = [];
  if (identity.vercel.found === true) blockers.push("Live Vercel project is still present");
  if (identity.vercel.found === null) blockers.push("Live Vercel project absence was not verified");
  if (identity.supabase.found === true) blockers.push("Live Supabase project is still present");
  if (identity.supabase.found === null) blockers.push("Live Supabase project absence was not verified");
  return { ok: blockers.length === 0, blockers };
}

export function providerRetirementRunSucceeded(
  results: ProviderCommandResult[],
  postDeleteIdentity: ProviderIdentity,
) {
  const blockers: string[] = [];
  if (!results.length) blockers.push("No provider deletion commands were recorded");
  const recordedProviders = new Set(results.map((result) => result.provider).filter((provider): provider is string => Boolean(provider)));
  for (const provider of requiredDeletionProviders) {
    if (!recordedProviders.has(provider)) blockers.push(`${provider} deletion command was not recorded`);
  }
  for (const result of results) {
    if (!result.ok) blockers.push(`${result.provider ?? "provider"} deletion command failed`);
  }

  const absence = providersAbsent(postDeleteIdentity);
  blockers.push(...absence.blockers);

  return { ok: blockers.length === 0, blockers };
}

export function providerRetirementRunEvidenceBlockers(
  report: ProviderRetirementRunEvidence | null | undefined,
  relativePath = "cloudflare/provider-retirement-run.json",
) {
  if (!report) return [];

  const recomputed = providerRetirementRunSucceeded(
    report.results ?? [],
    report.postDeleteIdentity ?? { vercel: { found: null }, supabase: { found: null } },
  );
  const blockers: string[] = [];

  if (report.retirementSafety?.ok !== true) {
    blockers.push(`${relativePath} has no clean retirementSafety proof`);
  }

  for (const blocker of report.retirementSafety?.blockers ?? []) {
    blockers.push(`${relativePath}: recorded retirementSafety blocker: ${blocker}`);
  }

  blockers.push(...recomputed.blockers.map((blocker) => `${relativePath}: ${blocker}`));
  return blockers;
}

export function providerRetirementPlanFingerprint(input: {
  backupDir: string;
  targets: unknown;
  commands: ProviderRetirementCommandPlan[];
}) {
  const commands = input.commands.map((command) => ({
    provider: command.provider ?? "",
    command: command.command ?? "",
    args: Array.isArray(command.args) ? command.args : [],
  }));
  return createHash()
    .update(stableStringify({ backupDir: input.backupDir, targets: input.targets, commands }))
    .digest("hex");
}

export function providerRetirementDryRunEvidenceBlockers(
  report: ProviderRetirementDryRunEvidence | null | undefined,
  expected: {
    backupDir: string;
    targets: unknown;
    commands: ProviderRetirementCommandPlan[];
    planFingerprint: string;
  },
  relativePath = "cloudflare/provider-retirement-run.json",
) {
  const blockers: string[] = [];
  if (!report) return [`${relativePath} dry-run deletion plan is missing`];
  if (report.ok !== true) blockers.push(`${relativePath} is not a clean dry-run deletion plan`);
  if (report.apply !== false) blockers.push(`${relativePath} was not generated in non-apply mode`);
  if (report.dryRun !== true) blockers.push(`${relativePath} is not a dry-run deletion plan`);
  if (report.backupDir !== expected.backupDir) blockers.push(`${relativePath} was generated for a different backup directory`);
  if (!report.planFingerprint) blockers.push(`${relativePath} is missing planFingerprint`);
  else if (report.planFingerprint !== expected.planFingerprint) blockers.push(`${relativePath} planFingerprint does not match the current deletion plan`);

  const reportFingerprint =
    report.backupDir && report.targets && Array.isArray(report.commands)
      ? providerRetirementPlanFingerprint({
          backupDir: report.backupDir,
          targets: report.targets,
          commands: report.commands,
        })
      : "";
  if (reportFingerprint && report.planFingerprint && reportFingerprint !== report.planFingerprint) {
    blockers.push(`${relativePath} planFingerprint does not match the recorded dry-run targets and commands`);
  }

  return blockers;
}

export function redactProviderProcessOutput(output: string) {
  return output
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replaceAll(/cfat_[A-Za-z0-9_-]+/g, "[REDACTED_CLOUDFLARE_TOKEN]")
    .replaceAll(/(?<=token[=:]\s*)[A-Za-z0-9._~+/=-]{16,}/gi, "[REDACTED_TOKEN]")
    .replaceAll(/(?<=secret[=:]\s*)[A-Za-z0-9._~+/=-]{16,}/gi, "[REDACTED_SECRET]")
    .slice(0, 2000);
}
