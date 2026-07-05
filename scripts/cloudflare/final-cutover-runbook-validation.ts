export type CutoverCommandStepForValidation = {
  id: string;
  mutates: boolean;
  requiredEnv?: Record<string, string>;
  requiredSecretEnv?: string[];
  command: string;
};

export type CutoverRunbookValidationReport = {
  ok: boolean;
  expectedOrder: string[];
  actualOrder: string[];
  optionalSteps: string[];
  mutatingSteps: string[];
  problems: string[];
};

const BASE_STEP_ORDER = [
  "refresh-final-backup",
  "import-d1",
  "import-vectorize",
  "validate-data",
  "dns-dry-run",
  "dns-apply",
  "deploy-worker",
  "post-cutover-validation",
  "retire-providers-preflight",
  "retire-providers-apply",
  "verify-credential-rotation",
] as const;

const OPTIONAL_STEPS = ["cleanup-duplicate-secrets"] as const;

const MUTATING_STEPS = new Set([
  "cleanup-duplicate-secrets",
  "import-d1",
  "import-vectorize",
  "dns-dry-run",
  "dns-apply",
  "deploy-worker",
  "retire-providers-apply",
  "verify-credential-rotation",
]);

export function validateFinalCutoverCommandSequence(
  steps: CutoverCommandStepForValidation[],
): CutoverRunbookValidationReport {
  const problems: string[] = [];
  const actualOrder = steps.map((step) => step.id);
  const expectedOrder = expectedOrderFor(actualOrder);

  if (actualOrder.join("\n") !== expectedOrder.join("\n")) {
    problems.push(`step order mismatch: expected ${expectedOrder.join(" -> ")}, got ${actualOrder.join(" -> ")}`);
  }

  for (const step of steps) {
    const expectedMutates = MUTATING_STEPS.has(step.id);
    if (step.mutates !== expectedMutates) {
      problems.push(`${step.id} mutates=${step.mutates}; expected ${expectedMutates}`);
    }
    if (step.mutates && !Object.keys(step.requiredEnv ?? {}).some((key) => key.startsWith("CONFIRM_"))) {
      problems.push(`${step.id} mutates production but has no explicit CONFIRM_* env gate`);
    }
    requireCommandEnvAssignments(problems, step);
  }

  requireCommandIncludes(steps, problems, "refresh-final-backup", [
    "pnpm cf:check:write-freeze",
    "pnpm cf:migration:backup -- --final",
    "pnpm cf:migration:prepare",
    "pnpm cf:migration:rehearse:d1:local",
    "pnpm cf:migration:rehearse:vectorize:local",
    "pnpm cf:verify:local",
    "pnpm cf:test:e2e:preview",
    "pnpm cf:evidence:verify",
  ]);
  requireCommandTextIncludes(steps, problems, "refresh-final-backup", [
    "Waiver path",
    "Write freeze externally enforced for inspirlearning.com",
    "CONFIRM_WRITE_FREEZE_PROBE_UNAVAILABLE",
    "CONFIRM_EXTERNAL_WRITE_FREEZE_ENFORCED",
    "WRITE_FREEZE_OPERATOR_EVIDENCE_FILE=",
    "pnpm cf:migration:backup -- --final",
  ]);
  requireEnv(steps, problems, "refresh-final-backup", [
    "CONFIRM_WRITE_FREEZE",
    "CONFIRM_FINAL_BACKUP",
    "CONFIRM_BACKUP_SOURCE_WRITES_FROZEN",
  ]);

  requireEnv(steps, problems, "import-d1", [
    "CONFIRM_WRITE_FREEZE",
    "CONFIRM_D1_IMPORT",
    "CONFIRM_D1_DATABASE_NAME",
    "CONFIRM_D1_DATABASE_ID",
    "CONFIRM_BACKUP_DIR",
  ]);
  requireCommandIncludes(steps, problems, "import-d1", ["pnpm cf:migration:import:d1"]);
  requireCommandExcludes(steps, problems, "import-d1", ["--skip-reset"]);

  requireEnv(steps, problems, "import-vectorize", [
    "CONFIRM_WRITE_FREEZE",
    "CONFIRM_VECTORIZE_IMPORT",
    "CONFIRM_VECTORIZE_RESET",
    "CONFIRM_VECTORIZE_INDEX",
    "CONFIRM_BACKUP_DIR",
  ]);
  requireCommandIncludes(steps, problems, "import-vectorize", ["pnpm cf:migration:import:vectorize -- --reset"]);

  requireCommandIncludes(steps, problems, "validate-data", [
    "pnpm cf:migration:validate:d1",
    "pnpm cf:preflight:production",
    "pnpm cf:status:migration",
    "pnpm cf:cutover:checklist",
    "pnpm cf:evidence:verify",
  ]);

  requireCommandIncludes(steps, problems, "dns-dry-run", [
    "pnpm cf:verify:cloudflare-token",
    "pnpm cf:dns:prepare-cutover",
  ]);
  requireCommandLineIncludesAll(steps, problems, "dns-dry-run", [
    "CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1",
    "pnpm cf:verify:cloudflare-token",
  ]);
  requireEnv(steps, problems, "dns-dry-run", ["CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE"]);
  requireCommandExcludes(steps, problems, "dns-dry-run", ["--apply"]);

  requireEnv(steps, problems, "dns-apply", [
    "CONFIRM_DNS_PLAN_FINGERPRINT",
    "CONFIRM_DNS_CUTOVER",
    "CONFIRM_WRITE_FREEZE",
    "CONFIRM_WORKER_CUSTOM_DOMAIN_DEPLOY",
    "CONFIRM_BACKUP_DIR",
  ]);
  requireCommandIncludes(steps, problems, "dns-apply", ["pnpm cf:dns:prepare-cutover -- --apply"]);

  requireEnv(steps, problems, "deploy-worker", ["CONFIRM_WRITE_FREEZE", "REQUIRE_LIVE_AI", "E2E_GOOGLE_IS_ADMIN"]);
  requireCommandIncludes(steps, problems, "deploy-worker", ["pnpm cf:deploy"]);

  requireEnv(steps, problems, "post-cutover-validation", ["REQUIRE_LIVE_AI", "E2E_GOOGLE_IS_ADMIN"]);
  requireCommandIncludes(steps, problems, "post-cutover-validation", [
    "pnpm cf:verify:dns-cutover",
    "pnpm cf:verify:production",
    "pnpm cf:test:e2e:production",
    "pnpm cf:migration:validate:d1:post-cutover",
    "pnpm cf:migration:validate:vectorize:post-cutover",
    "pnpm cf:status:migration",
    "pnpm cf:cutover:checklist",
    "pnpm cf:evidence:verify",
  ]);

  requireCommandIncludes(steps, problems, "retire-providers-preflight", [
    "pnpm cf:evidence:verify",
    "pnpm cf:preflight:retire-providers",
    "pnpm cf:retire-providers",
    "pnpm cf:status:migration",
    "pnpm cf:cutover:checklist",
  ]);
  requireCommandExcludes(steps, problems, "retire-providers-preflight", ["-- --apply"]);

  requireEnv(steps, problems, "retire-providers-apply", [
    "CONFIRM_PROVIDER_RETIREMENT",
    "CONFIRM_PROVIDER_HARD_DELETE",
    "CONFIRM_PROVIDER_RETIREMENT_PLAN_FINGERPRINT",
    "CONFIRM_BACKUP_DIR",
    "CONFIRM_VERCEL_PROJECT_ID",
    "CONFIRM_SUPABASE_PROJECT_REF",
  ]);
  requireCommandIncludes(steps, problems, "retire-providers-apply", [
    "pnpm cf:evidence:verify",
    "pnpm cf:retire-providers -- --apply",
  ]);

  requireEnv(steps, problems, "verify-credential-rotation", [
    "CONFIRM_CLOUDFLARE_MIGRATION_API_TOKEN_REVOKED",
    "CONFIRM_R2_MIGRATION_S3_KEY_REVOKED",
    "CONFIRM_VERCEL_ACCESS_REVOKED",
    "CONFIRM_SUPABASE_ACCESS_REVOKED",
    "CONFIRM_RETIRED_PROVIDER_ENV_UNSET",
    "CREDENTIAL_ROTATION_EVIDENCE_FILE",
  ]);
  requireCommandIncludes(steps, problems, "verify-credential-rotation", [
    "unset CLOUDFLARE_API_TOKEN CF_API_TOKEN CLOUDFLARE_API_TOKEN_FILE CF_API_TOKEN_FILE",
    "pnpm cf:verify:credential-rotation",
    "pnpm cf:evidence:verify",
  ]);

  if (actualOrder.includes("cleanup-duplicate-secrets")) {
    requireEnv(steps, problems, "cleanup-duplicate-secrets", [
      "CONFIRM_ENV_SECRET_CLEANUP",
      "CONFIRM_BACKUP_DIR",
      "CONFIRM_DUPLICATE_SECRET_KEYS",
      "CONFIRM_RETIRED_SUPABASE_SECRET_KEYS",
      "CONFIRM_SECRET_CLEANUP_KEYS",
    ]);
    requireCommandIncludes(steps, problems, "cleanup-duplicate-secrets", [
      "pnpm cf:cleanup:duplicate-secrets",
      "pnpm cf:preflight:production",
    ]);
  }

  return {
    ok: problems.length === 0,
    expectedOrder,
    actualOrder,
    optionalSteps: [...OPTIONAL_STEPS],
    mutatingSteps: actualOrder.filter((id) => MUTATING_STEPS.has(id)),
    problems,
  };
}

function expectedOrderFor(actualOrder: string[]) {
  const withOptional: string[] = [...BASE_STEP_ORDER];
  if (actualOrder.includes("cleanup-duplicate-secrets")) {
    withOptional.splice(withOptional.indexOf("dns-dry-run"), 0, "cleanup-duplicate-secrets");
  }
  return withOptional;
}

function stepById(steps: CutoverCommandStepForValidation[], id: string) {
  return steps.find((step) => step.id === id);
}

function requireEnv(
  steps: CutoverCommandStepForValidation[],
  problems: string[],
  id: string,
  keys: string[],
) {
  const step = stepById(steps, id);
  if (!step) return;
  const env = step.requiredEnv ?? {};
  for (const key of keys) {
    if (!Object.hasOwn(env, key)) problems.push(`${id} is missing required env gate ${key}`);
  }
}

function requireCommandIncludes(
  steps: CutoverCommandStepForValidation[],
  problems: string[],
  id: string,
  snippets: string[],
) {
  const step = stepById(steps, id);
  if (!step) {
    problems.push(`missing step ${id}`);
    return;
  }
  const command = executableCommandText(step.command);
  for (const snippet of snippets) {
    if (!command.includes(snippet)) problems.push(`${id} command is missing ${snippet}`);
  }
}

function requireCommandTextIncludes(
  steps: CutoverCommandStepForValidation[],
  problems: string[],
  id: string,
  snippets: string[],
) {
  const step = stepById(steps, id);
  if (!step) {
    problems.push(`missing step ${id}`);
    return;
  }
  for (const snippet of snippets) {
    if (!step.command.includes(snippet)) problems.push(`${id} command text is missing ${snippet}`);
  }
}

function requireCommandExcludes(
  steps: CutoverCommandStepForValidation[],
  problems: string[],
  id: string,
  snippets: string[],
) {
  const step = stepById(steps, id);
  if (!step) return;
  const command = executableCommandText(step.command);
  for (const snippet of snippets) {
    if (command.includes(snippet)) problems.push(`${id} command must not include ${snippet}`);
  }
}

function requireCommandLineIncludesAll(
  steps: CutoverCommandStepForValidation[],
  problems: string[],
  id: string,
  snippets: string[],
) {
  const step = stepById(steps, id);
  if (!step) {
    problems.push(`missing step ${id}`);
    return;
  }
  const line = executableCommandText(step.command)
    .split("\n")
    .find((candidate) => snippets.every((snippet) => candidate.includes(snippet)));
  if (!line) problems.push(`${id} command is missing ${snippets.join(" and ")} on the same line`);
}

function requireCommandEnvAssignments(problems: string[], step: CutoverCommandStepForValidation) {
  const env = step.requiredEnv ?? {};
  if (!Object.keys(env).length) return;
  const command = executableCommandText(step.command);
  for (const key of Object.keys(env)) {
    const assignmentPattern = new RegExp(`(^|[\\s\\n])${escapeRegExp(key)}=`);
    if (!assignmentPattern.test(command)) {
      problems.push(`${step.id} command is missing required env assignment ${key}=`);
    }
  }
}

function executableCommandText(command: string) {
  return command
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
