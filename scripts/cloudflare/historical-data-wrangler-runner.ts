import {
  type RunCommandOptions,
  type WranglerRunner,
} from "./migration-config";

export const HISTORICAL_DATA_WRANGLER_FAILURE_MESSAGE =
  "Historical preservation Wrangler command failed." as const;

/**
 * Historical-data commands can return raw learner identifiers and payloads.
 * Keep successful output in memory for strict parsing, disable Wrangler's disk
 * log, remove the preservation HMAC secret from the child environment, and
 * collapse every runner failure to one non-data-dependent error. The wrapper
 * intentionally does not retain a cause, command, SQL, stdout, or stderr.
 */
export function createHistoricalDataWranglerRunner(
  runner: WranglerRunner,
): WranglerRunner {
  return (args: string[], options: RunCommandOptions = {}) => {
    const callerEnvironment = { ...(options.env ?? {}) };
    delete callerEnvironment.HISTORICAL_DATA_PRESERVATION_HMAC_SECRET;
    try {
      return runner(args, {
        ...options,
        env: {
          ...callerEnvironment,
          HISTORICAL_DATA_PRESERVATION_HMAC_SECRET: undefined,
          WRANGLER_LOG_SANITIZE: "true",
          WRANGLER_WRITE_LOGS: "false",
        },
      });
    } catch {
      throw new Error(HISTORICAL_DATA_WRANGLER_FAILURE_MESSAGE);
    }
  };
}
