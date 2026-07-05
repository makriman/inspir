import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, createHash, resolveBackupDir } from "./migration-config";
import { buildRepoSourceFingerprint, listRepoSourceFiles } from "./source-fingerprint";

type SecretRule = {
  id: string;
  description: string;
  pattern: RegExp;
};

export type SourceSecretFinding = {
  rule: string;
  description: string;
  file: string;
  line: number;
  column: number;
  redactedSnippet: string;
};

export type SourceSecretScanReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  sourceFingerprint: {
    sha256: string;
    fileCount: number;
  };
  scannedFiles: number;
  skippedBinaryFiles: string[];
  findings: SourceSecretFinding[];
};

const SECRET_RULES: SecretRule[] = [
  {
    id: "cloudflare-api-token",
    description: "Cloudflare API token literal",
    pattern: /cfat_[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "cloudflare-ai-gateway-token",
    description: "Cloudflare AI Gateway token literal",
    pattern: /cfut_[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "openai-api-key",
    description: "OpenAI API key literal",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "r2-or-s3-secret-access-key",
    description: "R2/S3 secret access key assignment",
    pattern: /\b(?:R2_|AWS_)?(?:SECRET_ACCESS_KEY|Secret Access Key)\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{32,}/g,
  },
  {
    id: "r2-or-s3-access-key-id",
    description: "R2/S3 access key ID assignment",
    pattern: /\b(?:R2_|AWS_)?(?:ACCESS_KEY_ID|Access Key ID)\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "private-key",
    description: "Private key block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY-----/g,
  },
];

const MAX_SNIPPET_LENGTH = 160;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backupDir = resolveBackupDir();
  const report = buildSourceSecretScanReport(process.cwd(), backupDir);
  const reportPath = path.join(cloudflareDir(backupDir), "source-secret-scan-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(compactReport(report), null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function buildSourceSecretScanReport(cwd = process.cwd(), backupDir = resolveBackupDir()): SourceSecretScanReport {
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  const files = listRepoSourceFiles(cwd);
  const findings: SourceSecretFinding[] = [];
  const skippedBinaryFiles: string[] = [];

  for (const file of files) {
    const absolutePath = path.join(cwd, file);
    const content = fs.readFileSync(absolutePath);
    if (isLikelyBinary(content)) {
      skippedBinaryFiles.push(file);
      continue;
    }
    findings.push(...scanSourceText(file, content.toString("utf8")));
  }

  return {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: findings.length === 0,
    sourceFingerprint: {
      sha256: sourceFingerprint.sha256,
      fileCount: sourceFingerprint.fileCount,
    },
    scannedFiles: files.length - skippedBinaryFiles.length,
    skippedBinaryFiles,
    findings,
  };
}

export function scanSourceText(file: string, content: string): SourceSecretFinding[] {
  const findings: SourceSecretFinding[] = [];
  for (const rule of SECRET_RULES) {
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
  return findings.sort((left, right) => `${left.file}:${left.line}:${left.column}:${left.rule}`.localeCompare(`${right.file}:${right.line}:${right.column}:${right.rule}`));
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
  const relativeStart = index - lineStart;
  const relativeEnd = relativeStart + length;
  const redacted = `${line.slice(0, relativeStart)}[REDACTED:${createHash().update(line.slice(relativeStart, relativeEnd)).digest("hex").slice(0, 12)}]${line.slice(relativeEnd)}`;
  return redacted.length <= MAX_SNIPPET_LENGTH ? redacted : `${redacted.slice(0, MAX_SNIPPET_LENGTH - 3)}...`;
}

function isLikelyBinary(content: Buffer) {
  return content.includes(0);
}

function compactReport(report: SourceSecretScanReport) {
  return {
    createdAt: report.createdAt,
    backupDir: report.backupDir,
    ok: report.ok,
    sourceFingerprint: report.sourceFingerprint,
    scannedFiles: report.scannedFiles,
    skippedBinaryFiles: report.skippedBinaryFiles.length,
    findings: report.findings.map((finding) => ({
      rule: finding.rule,
      file: finding.file,
      line: finding.line,
      column: finding.column,
      redactedSnippet: finding.redactedSnippet,
    })),
  };
}
