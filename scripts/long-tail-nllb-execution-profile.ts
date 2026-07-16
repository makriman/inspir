import { createHash } from "node:crypto";
import { z } from "zod";

export const LONG_TAIL_TRANSLATION_PIPELINE_VERSION =
  "inspir-long-tail-local-nllb-v5" as const;
export const LONG_TAIL_NLLB_EXECUTION_PROFILE_KIND =
  "inspir-long-tail-local-nllb-execution-profile-v2" as const;

const executionEnvironment = Object.freeze({
  MKL_NUM_THREADS: "1",
  OMP_NUM_THREADS: "1",
  PYTORCH_ENABLE_MPS_FALLBACK: "0",
  VECLIB_MAXIMUM_THREADS: "1",
} as const);

const executionTorchThreads = Object.freeze({
  interopThreads: 1,
  intraopThreads: 1,
} as const);

const deterministicTerminalRescue = Object.freeze({
  device: "cpu",
  dtype: "float32",
  independentDecodes: 2,
  deterministicAlgorithms: true,
} as const);

const executionProfileMaterial = Object.freeze({
  schemaVersion: 2,
  kind: LONG_TAIL_NLLB_EXECUTION_PROFILE_KIND,
  pipelineVersion: LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
  environment: executionEnvironment,
  torch: executionTorchThreads,
  terminalRescue: deterministicTerminalRescue,
} as const);

function isJsonRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Execution-profile JSON cannot contain a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isJsonRecord(value)) {
    return "{" + Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",") + "}";
  }
  throw new Error("Execution-profile JSON contains an unsupported value.");
}

export const LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256 = createHash("sha256")
  .update(canonicalJson(executionProfileMaterial), "utf8")
  .digest("hex");

export const LONG_TAIL_NLLB_EXECUTION_PROFILE = Object.freeze({
  ...executionProfileMaterial,
  executionProfileSha256: LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
} as const);

export const longTailNllbExecutionProfileSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal(LONG_TAIL_NLLB_EXECUTION_PROFILE_KIND),
  pipelineVersion: z.literal(LONG_TAIL_TRANSLATION_PIPELINE_VERSION),
  environment: z.object({
    MKL_NUM_THREADS: z.literal(executionEnvironment.MKL_NUM_THREADS),
    OMP_NUM_THREADS: z.literal(executionEnvironment.OMP_NUM_THREADS),
    PYTORCH_ENABLE_MPS_FALLBACK: z.literal(
      executionEnvironment.PYTORCH_ENABLE_MPS_FALLBACK,
    ),
    VECLIB_MAXIMUM_THREADS: z.literal(
      executionEnvironment.VECLIB_MAXIMUM_THREADS,
    ),
  }).strict(),
  torch: z.object({
    interopThreads: z.literal(executionTorchThreads.interopThreads),
    intraopThreads: z.literal(executionTorchThreads.intraopThreads),
  }).strict(),
  terminalRescue: z.object({
    device: z.literal(deterministicTerminalRescue.device),
    dtype: z.literal(deterministicTerminalRescue.dtype),
    independentDecodes: z.literal(
      deterministicTerminalRescue.independentDecodes,
    ),
    deterministicAlgorithms: z.literal(
      deterministicTerminalRescue.deterministicAlgorithms,
    ),
  }).strict(),
  executionProfileSha256: z.literal(
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  ),
}).strict();

export type LongTailNllbExecutionProfile = Readonly<
  z.infer<typeof longTailNllbExecutionProfileSchema>
>;

export function parseLongTailNllbExecutionProfile(
  value: unknown,
): LongTailNllbExecutionProfile {
  const parsed = longTailNllbExecutionProfileSchema.parse(value);
  const { executionProfileSha256, ...material } = parsed;
  if (
    executionProfileSha256 !== LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256 ||
    createHash("sha256").update(canonicalJson(material), "utf8").digest("hex") !==
      executionProfileSha256 ||
    canonicalJson(parsed) !== canonicalJson(LONG_TAIL_NLLB_EXECUTION_PROFILE)
  ) {
    throw new Error("Long-tail NLLB execution profile is stale or tampered.");
  }
  return LONG_TAIL_NLLB_EXECUTION_PROFILE;
}

export function assertCurrentLongTailReleaseRunRoot(
  runRoot: string,
  label = "Long-tail translation run root",
): void {
  const normalized = runRoot.replaceAll("\\", "/");
  const components = normalized.split("/").filter(Boolean);
  const temporaryRootIndex = components.lastIndexOf("tmp");
  const runComponents = temporaryRootIndex === -1
    ? components
    : components.slice(temporaryRootIndex + 1);
  const hasObsoleteVersion = runComponents.some((component) => {
    for (const match of component.matchAll(/(?:^|[-_])v([0-9]+)(?=$|[-_])/g)) {
      const version = Number(match[1]);
      if (Number.isSafeInteger(version) && version < 10) return true;
    }
    return false;
  });
  if (hasObsoleteVersion) {
    throw new Error(
      `${label} uses obsolete pre-v10 evidence; start a fresh v10 root.`,
    );
  }
}
