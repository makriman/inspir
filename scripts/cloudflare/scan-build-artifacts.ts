import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, createHash, resolveBackupDir } from "./migration-config";
import { CURRENT_RUNTIME_SECRET_ENV_KEYS } from "./sanitized-build-env";
import { scanSourceText, type SourceSecretFinding } from "./scan-source-secrets";
import { FORBIDDEN_ENV_AFTER_ROTATION, RETIRED_PROVIDER_ENV_KEYS } from "./retired-provider-env";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";

type EnvFallbackFinding = {
  rule: "retired-env-fallback" | "sensitive-env-fallback";
  description: string;
  file: string;
  mode: string;
  key: string;
  valueSha256?: string;
};

type ArtifactLiteralFinding = {
  rule: "supabase-url-literal" | "supabase-jwt-literal";
  description: string;
  file: string;
  line: number;
  column: number;
  redactedSnippet: string;
};

export type BuildArtifactSecretFinding = SourceSecretFinding | EnvFallbackFinding | ArtifactLiteralFinding;

export type BuildArtifactScanReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  sourceFingerprint: SourceFingerprint;
  artifactRoot: string;
  nextEnvFile: string | null;
  scannedFiles: number;
  skippedBinaryFiles: string[];
  findings: BuildArtifactSecretFinding[];
};

const DEFAULT_ARTIFACT_ROOT = ".open-next";
const NEXT_ENV_RELATIVE_PATH = ".open-next/cloudflare/next-env.mjs";
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const PRIVATE_KEY_BEGIN_MARKER = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
const ARTIFACT_LITERAL_RULES = [
  {
    id: "supabase-url-literal",
    description: "Supabase project URL literal in generated OpenNext artifact",
    pattern: /https:\/\/[a-z0-9-]+\.supabase\.co\b/gi,
  },
  {
    id: "supabase-jwt-literal",
    description: "JWT-like Supabase key literal in generated OpenNext artifact",
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
] as const;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backupDir = resolveBackupDir();
  const report = writeBuildArtifactScanReport(process.cwd(), backupDir);
  console.log(JSON.stringify(compactReport(report), null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function writeBuildArtifactScanReport(cwd = process.cwd(), backupDir = resolveBackupDir()) {
  const report = buildArtifactScanReport(cwd, backupDir);
  const reportPath = path.join(cloudflareDir(backupDir), "build-artifact-scan-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

export function buildArtifactScanReport(cwd = process.cwd(), backupDir = resolveBackupDir()): BuildArtifactScanReport {
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  const artifactRoot = path.join(cwd, DEFAULT_ARTIFACT_ROOT);
  const findings: BuildArtifactSecretFinding[] = [];
  const skippedBinaryFiles: string[] = [];
  let scannedFiles = 0;

  if (!fs.existsSync(artifactRoot)) {
    findings.push({
      rule: "sensitive-env-fallback",
      description: "OpenNext build output is missing",
      file: DEFAULT_ARTIFACT_ROOT,
      mode: "all",
      key: DEFAULT_ARTIFACT_ROOT,
    });
    return {
      createdAt: new Date().toISOString(),
      backupDir,
      ok: false,
      sourceFingerprint,
      artifactRoot: DEFAULT_ARTIFACT_ROOT,
      nextEnvFile: null,
      scannedFiles,
      skippedBinaryFiles,
      findings,
    };
  }

  for (const file of listFiles(artifactRoot)) {
    const relativePath = path.relative(cwd, file).split(path.sep).join("/");
    const stats = fs.statSync(file);
    if (stats.size > MAX_FILE_BYTES) {
      skippedBinaryFiles.push(relativePath);
      continue;
    }

    const content = fs.readFileSync(file);
    if (isLikelyBinary(content)) {
      skippedBinaryFiles.push(relativePath);
      continue;
    }

    scannedFiles += 1;
    const text = content.toString("utf8");
    findings.push(...scanSourceText(relativePath, text).filter((finding) => !isGeneratedPrivateKeyTemplateFinding(text, finding)));
    findings.push(...scanArtifactOnlyLiterals(relativePath, text));
  }

  const nextEnvPath = path.join(cwd, NEXT_ENV_RELATIVE_PATH);
  if (fs.existsSync(nextEnvPath)) {
    findings.push(...scanNextEnvFallbacks(fs.readFileSync(nextEnvPath, "utf8")));
  } else {
    findings.push({
      rule: "sensitive-env-fallback",
      description: "OpenNext env fallback file is missing from the build output",
      file: NEXT_ENV_RELATIVE_PATH,
      mode: "all",
      key: "next-env.mjs",
    });
  }

  return {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: findings.length === 0,
    sourceFingerprint,
    artifactRoot: DEFAULT_ARTIFACT_ROOT,
    nextEnvFile: fs.existsSync(nextEnvPath) ? NEXT_ENV_RELATIVE_PATH : null,
    scannedFiles,
    skippedBinaryFiles,
    findings: findings.sort((left, right) => findingSortKey(left).localeCompare(findingSortKey(right))),
  };
}

export function scanArtifactOnlyLiterals(file: string, content: string): ArtifactLiteralFinding[] {
  const findings: ArtifactLiteralFinding[] = [];
  for (const rule of ARTIFACT_LITERAL_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const matched = match[0] ?? "";
      const index = match.index ?? 0;
      findings.push({
        rule: rule.id,
        description: rule.description,
        file,
        ...lineAndColumn(content, index),
        redactedSnippet: redactedSnippet(content, index, matched.length),
      });
    }
  }
  return findings;
}

export function scanNextEnvFallbacks(content: string, file = NEXT_ENV_RELATIVE_PATH): EnvFallbackFinding[] {
  const findings: EnvFallbackFinding[] = [];
  const modes = [...content.matchAll(/^export const (\w+) = (.*);$/gm)];
  for (const match of modes) {
    const mode = match[1] ?? "unknown";
    const rawJson = match[2] ?? "{}";
    const values = parseObject(rawJson);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null || String(value).trim() === "") continue;
      if (isRetiredFallbackKey(key)) {
        findings.push({
          rule: "retired-env-fallback",
          description: "Retired provider environment key was compiled into the OpenNext env fallback",
          file,
          mode,
          key,
          valueSha256: hashValue(value),
        });
      } else if (isSensitiveFallbackKey(key)) {
        findings.push({
          rule: "sensitive-env-fallback",
          description: "Sensitive runtime secret was compiled into the OpenNext env fallback",
          file,
          mode,
          key,
          valueSha256: hashValue(value),
        });
      }
    }
  }
  return findings;
}

function listFiles(root: string) {
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    const stats = fs.statSync(current);
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
    } else if (stats.isFile()) {
      files.push(current);
    }
  }
  return files.sort();
}

function parseObject(rawJson: string) {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isRetiredFallbackKey(key: string) {
  return (
    (RETIRED_PROVIDER_ENV_KEYS as readonly string[]).includes(key) ||
    (FORBIDDEN_ENV_AFTER_ROTATION as readonly string[]).includes(key) ||
    /^(?:NEXT_PUBLIC_)?SUPABASE_/i.test(key) ||
    /^(?:VERCEL|TURBO)_/i.test(key)
  );
}

function isSensitiveFallbackKey(key: string) {
  if ((CURRENT_RUNTIME_SECRET_ENV_KEYS as readonly string[]).includes(key)) return true;
  if (/SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY/i.test(key)) return key !== "CLOUDFLARE_ACCOUNT_ID";
  return false;
}

function hashValue(value: unknown) {
  return createHash().update(String(value)).digest("hex");
}

function isLikelyBinary(content: Buffer) {
  return content.includes(0);
}

function isGeneratedPrivateKeyTemplateFinding(content: string, finding: SourceSecretFinding) {
  if (finding.rule !== "private-key") return false;
  const line = lineAt(content, finding.line);
  return (
    (line.includes(`indexOf("${PRIVATE_KEY_BEGIN_MARKER}")`) && line.includes("PKCS#8 formatted string")) ||
    (line.includes("-----BEGIN ${") && line.includes("-----END ${"))
  );
}

function lineAt(content: string, lineNumber: number) {
  const lines = content.split("\n");
  return lines[lineNumber - 1] ?? "";
}

function lineAndColumn(content: string, index: number) {
  const prefix = content.slice(0, index);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)!.length + 1,
  };
}

function redactedSnippet(content: string, index: number, length: number) {
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  const nextLine = content.indexOf("\n", index);
  const lineEnd = nextLine === -1 ? content.length : nextLine;
  const line = content.slice(lineStart, lineEnd);
  const matchedSpan = { start: index - lineStart, end: index - lineStart + length };
  const spans = [matchedSpan];
  for (const rule of ARTIFACT_LITERAL_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of line.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + (match[0]?.length ?? 0) });
    }
  }
  const redacted = redactLineSpans(line, spans);
  return redacted.length <= 160 ? redacted : `${redacted.slice(0, 157)}...`;
}

function redactLineSpans(line: string, spans: Array<{ start: number; end: number }>) {
  const normalized = spans
    .filter((span) => span.end > span.start)
    .sort((left, right) => right.start - left.start);
  let redacted = line;
  for (const span of normalized) {
    const value = redacted.slice(span.start, span.end);
    if (value.startsWith("[REDACTED:")) continue;
    redacted = `${redacted.slice(0, span.start)}[REDACTED:${createHash().update(value).digest("hex").slice(0, 12)}]${redacted.slice(span.end)}`;
  }
  return redacted;
}

function findingSortKey(finding: BuildArtifactSecretFinding) {
  if ("line" in finding) return `${finding.file}:${finding.line}:${finding.column}:${finding.rule}`;
  return `${finding.file}:${finding.mode}:${finding.key}:${finding.rule}`;
}

function compactReport(report: BuildArtifactScanReport) {
  return {
    createdAt: report.createdAt,
    backupDir: report.backupDir,
    ok: report.ok,
    sourceFingerprint: {
      sha256: report.sourceFingerprint.sha256,
      fileCount: report.sourceFingerprint.fileCount,
    },
    artifactRoot: report.artifactRoot,
    nextEnvFile: report.nextEnvFile,
    scannedFiles: report.scannedFiles,
    skippedBinaryFiles: report.skippedBinaryFiles.length,
    findings: report.findings.map((finding) =>
      "line" in finding
        ? {
            rule: finding.rule,
            file: finding.file,
            line: finding.line,
            column: finding.column,
            redactedSnippet: finding.redactedSnippet,
          }
        : {
            rule: finding.rule,
            file: finding.file,
            mode: finding.mode,
            key: finding.key,
            valueSha256: finding.valueSha256,
          },
    ),
  };
}
