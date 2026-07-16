import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readAndValidateProductionTrustBoundaryAcceptance,
  type ProductionTrustBoundaryAcceptanceHandle,
} from "./production-trust-boundary-acceptance";

type TrustBoundCommand = Readonly<
  | {
      executable: "tsx";
      script: string;
      fixedArgs?: readonly string[];
    }
  | {
      executable: "wrangler";
      fixedArgs: readonly string[];
    }
>;

export const TRUST_BOUND_PRODUCTION_COMMANDS = Object.freeze({
  "cf:preview:remote": {
    executable: "tsx",
    script: "scripts/cloudflare/run-sanitized-build.ts",
    fixedArgs: ["wrangler-preview", "--remote"],
  },
  "cf:prepare:deploy": {
    executable: "tsx",
    script: "scripts/cloudflare/worker-deploy-preparation.ts",
  },
  "cf:deploy": {
    executable: "tsx",
    script: "scripts/cloudflare/run-sanitized-build.ts",
    fixedArgs: ["worker-activate-candidate"],
  },
  "cf:upload-candidate": {
    executable: "tsx",
    script: "scripts/cloudflare/run-sanitized-build.ts",
    fixedArgs: ["worker-upload-candidate"],
  },
  "cf:stage-candidate": {
    executable: "tsx",
    script: "scripts/cloudflare/run-sanitized-build.ts",
    fixedArgs: ["worker-stage-candidate"],
  },
  "cf:verify:candidate-override": {
    executable: "tsx",
    script: "scripts/cloudflare/worker-candidate-version-override-smoke.ts",
  },
  "cf:activate-candidate": {
    executable: "tsx",
    script: "scripts/cloudflare/run-sanitized-build.ts",
    fixedArgs: ["worker-activate-candidate"],
  },
  "cf:deploy:www-redirect": {
    executable: "wrangler",
    fixedArgs: ["deploy", "--config", "wrangler.www-redirect.jsonc"],
  },
  "cf:upload": {
    executable: "tsx",
    script: "scripts/cloudflare/run-sanitized-build.ts",
    fixedArgs: ["worker-upload-candidate"],
  },
  "cf:check:write-freeze": {
    executable: "tsx",
    script: "scripts/cloudflare/check-write-freeze-readiness.ts",
  },
  "cf:sync:topic-seeds": {
    executable: "tsx",
    script: "scripts/cloudflare/run-production-release-operation.ts",
    fixedArgs: ["sync-topic-seeds"],
  },
  "cf:r2:retire-cache-build": {
    executable: "tsx",
    script: "scripts/cloudflare/retire-next-cache-build.ts",
  },
  "cf:sync:site-translation-sources": {
    executable: "tsx",
    script: "scripts/cloudflare/run-production-release-operation.ts",
    fixedArgs: ["sync-site-translation-sources"],
  },
  "cf:d1:repair-seo-translations": {
    executable: "tsx",
    script: "scripts/cloudflare/repair-seo-cta-translations.ts",
  },
  "cf:d1:reconcile-staged-translations": {
    executable: "tsx",
    script: "scripts/cloudflare/reconcile-staged-translation-fallback.ts",
  },
  "cf:check:d1-migration-budget": {
    executable: "tsx",
    script: "scripts/cloudflare/check-d1-runtime-migration-budget.ts",
  },
  "cf:apply:d1-runtime-migrations": {
    executable: "tsx",
    script: "scripts/cloudflare/run-production-release-operation.ts",
    fixedArgs: ["apply-d1-runtime-migrations"],
  },
  "cf:apply:d1-runtime-migration-0017": {
    executable: "tsx",
    script: "scripts/cloudflare/run-production-release-operation.ts",
    fixedArgs: ["apply-d1-runtime-migration-0017"],
  },
  "cf:rollback": {
    executable: "tsx",
    script: "scripts/cloudflare/run-production-release-operation.ts",
    fixedArgs: ["rollback"],
  },
  "cf:resolve:production-maintenance": {
    executable: "tsx",
    script: "scripts/cloudflare/resolve-production-maintenance.ts",
  },
  "cf:verify:d1-runtime-migrations": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-d1-runtime-migrations.ts",
  },
  "cf:verify:d1-runtime-migration-0017": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-d1-runtime-migration-0017.ts",
  },
  "cf:verify:historical-data-preservation": {
    executable: "tsx",
    script: "scripts/cloudflare/run-historical-data-preservation.ts",
  },
  "cf:verify:historical-data-fresh-0016-preservation": {
    executable: "tsx",
    script: "scripts/cloudflare/run-historical-data-preservation.ts",
    fixedArgs: ["--verify-preservation", "--fresh-0016-cutover-baseline"],
  },
  "cf:verify:historical-data-continuity": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-historical-data-continuity.ts",
  },
  "cf:cutover:historical-data-fresh-0016": {
    executable: "tsx",
    script: "scripts/cloudflare/run-historical-data-fresh-0016-cutover.ts",
  },
  "cf:preflight:deploy": {
    executable: "tsx",
    script: "scripts/cloudflare/deploy-preflight.ts",
  },
  "cf:verify:cloudflare-token": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-cloudflare-api-token.ts",
  },
  "cf:verify:vectorize-readiness": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-vectorize-readiness.ts",
  },
  "cf:verify:production": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-production.ts",
  },
  "cf:verify:authenticated-production": {
    executable: "tsx",
    script: "scripts/cloudflare/run-authenticated-production-validation.ts",
  },
  "cf:verify:worker-outcomes": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-production-worker-outcomes.ts",
  },
  "cf:verify:background-outcomes": {
    executable: "tsx",
    script: "scripts/cloudflare/verify-production-background-outcomes.ts",
  },
  "cf:test:e2e:production": {
    executable: "tsx",
    script: "scripts/cloudflare/run-production-playwright.ts",
  },
} satisfies Readonly<Record<string, TrustBoundCommand>>);

export type TrustBoundProductionCommandName =
  keyof typeof TRUST_BOUND_PRODUCTION_COMMANDS;

type CommandResult = Readonly<{
  status: number | null;
  error?: Error;
}>;

type TrustBoundCommandDependencies = Readonly<{
  readAcceptance: (input: Readonly<{
    cwd: string;
    backupDirectory: string;
  }>) => ProductionTrustBoundaryAcceptanceHandle;
  run: (input: Readonly<{
    executable: string;
    args: readonly string[];
    cwd: string;
  }>) => CommandResult;
}>;

export type RunTrustBoundProductionCommandOptions = Readonly<{
  cwd?: string;
  backupDirectory?: string;
  dependencies?: Partial<TrustBoundCommandDependencies>;
}>;

const defaultDependencies: TrustBoundCommandDependencies = {
  readAcceptance: ({ cwd, backupDirectory }) =>
    readAndValidateProductionTrustBoundaryAcceptance({
      cwd,
      backupDirectory,
    }),
  run: ({ executable, args, cwd }) => {
    const result = spawnSync(executable, [...args], {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    return {
      status: result.status,
      error: result.error,
    };
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const name = parseTrustBoundProductionCommandName(process.argv[2]);
    const status = runTrustBoundProductionCommand(
      name,
      process.argv.slice(3),
    );
    process.exitCode = status;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function runTrustBoundProductionCommand(
  name: TrustBoundProductionCommandName,
  passthroughArgs: readonly string[] = [],
  options: RunTrustBoundProductionCommandOptions = {},
) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const argumentBackupDirectory = backupDirectoryFromArguments(
    passthroughArgs,
    cwd,
  );
  const optionBackupDirectory = options.backupDirectory
    ? path.resolve(options.backupDirectory)
    : undefined;
  if (
    argumentBackupDirectory &&
    optionBackupDirectory &&
    argumentBackupDirectory !== optionBackupDirectory
  ) {
    throw new Error(
      "Trust-bound production command backup argument does not match its acceptance directory.",
    );
  }
  const backupDirectory =
    argumentBackupDirectory ??
    optionBackupDirectory ??
    path.join(cwd, "tmp", "cloudflare-reports");
  const dependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const command = TRUST_BOUND_PRODUCTION_COMMANDS[name];
  if (!command) {
    throw new Error("Unsupported trust-bound production command.");
  }

  // This must remain the first dependency call. No child process, network read,
  // D1 access, upload, staging, activation, or production probe is allowed first.
  dependencies.readAcceptance({ cwd, backupDirectory });

  const invocation = commandInvocation(command, cwd, passthroughArgs);
  const result = dependencies.run({ ...invocation, cwd });
  if (result.error) throw result.error;
  if (!Number.isInteger(result.status) || result.status === null) {
    throw new Error("Trust-bound production command did not return an exit status.");
  }
  return result.status;
}

function backupDirectoryFromArguments(args: readonly string[], cwd: string) {
  let backupDirectory: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--backup") continue;
    if (backupDirectory !== undefined) {
      throw new Error(
        "Trust-bound production command accepts at most one --backup directory.",
      );
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(
        "Trust-bound production command --backup requires one directory path.",
      );
    }
    backupDirectory = path.resolve(cwd, value);
    index += 1;
  }
  return backupDirectory;
}

export function parseTrustBoundProductionCommandName(
  value: string | undefined,
): TrustBoundProductionCommandName {
  if (
    !value ||
    !Object.prototype.hasOwnProperty.call(TRUST_BOUND_PRODUCTION_COMMANDS, value)
  ) {
    throw new Error(
      `Usage: run-trust-bound-production-command.ts ${Object.keys(
        TRUST_BOUND_PRODUCTION_COMMANDS,
      ).join("|")} [...args]`,
    );
  }
  return value as TrustBoundProductionCommandName;
}

function commandInvocation(
  command: TrustBoundCommand,
  cwd: string,
  passthroughArgs: readonly string[],
) {
  if (command.executable === "wrangler") {
    return {
      executable: path.resolve(cwd, "node_modules", ".bin", "wrangler"),
      args: [...command.fixedArgs, ...passthroughArgs],
    };
  }
  return {
    executable: process.execPath,
    args: [
      "--import",
      "tsx",
      path.resolve(cwd, command.script),
      ...(command.fixedArgs ?? []),
      ...passthroughArgs,
    ],
  };
}
