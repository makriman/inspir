import path from "node:path";

export const WRITE_FREEZE_READINESS_REPORT = "cloudflare/write-freeze-readiness-report.json";
const DEFAULT_WRITE_FREEZE_STATUS_URL = "https://inspirlearning.com/api/migration/write-freeze";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WriteFreezeProbe = {
  required: boolean;
  attempted: boolean;
  ok: boolean | null;
  url?: string;
  status?: number;
  writeFreezeActive?: boolean;
  versionId?: string;
  code?: string;
  error?: string;
};

export type WriteFreezeReadinessReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  url?: string;
  endpointContractOk: boolean;
  writeFreezeActive: boolean | null;
  versionId: string | null;
  probe: WriteFreezeProbe;
  problems: string[];
};

export async function buildWriteFreezeReadinessReport(
  backupDir: string,
  options: { env?: EnvMap; fetchImpl?: FetchLike } = {},
): Promise<WriteFreezeReadinessReport> {
  const env = options.env ?? process.env;
  const probe = await probeWriteFreezeStatus(env, options.fetchImpl ?? fetch);
  const endpointContractOk =
    probe.required === true &&
    probe.attempted === true &&
    (probe.status === 200 || probe.status === 409) &&
    typeof probe.writeFreezeActive === "boolean" &&
    typeof probe.versionId === "string" &&
    isWorkerVersionId(probe.versionId) &&
    (probe.code === "write_freeze_active" || probe.code === "write_freeze_inactive");
  const problems = endpointContractOk
    ? []
    : [
        "write-freeze status endpoint is not reachable with the expected exact-version JSON contract",
      ];

  return {
    createdAt: new Date().toISOString(),
    backupDir: path.resolve(backupDir),
    ok: endpointContractOk,
    url: probe.url,
    endpointContractOk,
    writeFreezeActive: typeof probe.writeFreezeActive === "boolean" ? probe.writeFreezeActive : null,
    versionId: typeof probe.versionId === "string" ? probe.versionId : null,
    probe,
    problems,
  };
}

async function probeWriteFreezeStatus(
  env: EnvMap,
  fetchImpl: FetchLike,
): Promise<WriteFreezeProbe> {
  const url = (env.MIGRATION_WRITE_FREEZE_STATUS_URL ?? DEFAULT_WRITE_FREEZE_STATUS_URL).trim();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", "cache-control": "no-store" },
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = parseJson(await response.text());
    const writeFreezeActive = parsed.writeFreezeActive === true;
    const code = typeof parsed.code === "string" ? parsed.code : undefined;
    const versionId = typeof parsed.versionId === "string" ? parsed.versionId : undefined;
    return {
      required: true,
      attempted: true,
      ok:
        response.ok &&
        writeFreezeActive &&
        code === "write_freeze_active" &&
        versionId !== undefined &&
        isWorkerVersionId(versionId),
      url,
      status: response.status,
      writeFreezeActive,
      code,
      versionId,
    };
  } catch (error) {
    return {
      required: true,
      attempted: true,
      ok: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isWorkerVersionId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
