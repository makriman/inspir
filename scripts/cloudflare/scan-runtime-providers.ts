import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, resolveBackupDir } from "./migration-config";
import { buildRepoSourceFingerprint, listRepoSourceFiles } from "./source-fingerprint";

type RuntimeProviderRule = {
  id: string;
  description: string;
  pattern: RegExp;
};

export type RuntimeProviderFinding = {
  rule: string;
  description: string;
  file: string;
  line: number;
  column: number;
  snippet: string;
};

export type RuntimeProviderScanReport = {
  createdAt: string;
  backupDir: string;
  ok: boolean;
  sourceFingerprint: {
    sha256: string;
    fileCount: number;
  };
  scannedFiles: string[];
  findings: RuntimeProviderFinding[];
};

const RUNTIME_SOURCE_PREFIXES = ["app/", "components/", "lib/"] as const;
const RUNTIME_SOURCE_FILES = [
  "cloudflare-worker.ts",
  "drizzle.config.ts",
  "middleware.ts",
  "next.config.ts",
  "open-next.config.ts",
  "wrangler.jsonc",
] as const;

const RETIRED_PROVIDER_ENV_NAMES = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_OIDC_TOKEN",
] as const;

const RULES: RuntimeProviderRule[] = [
  {
    id: "supabase-package",
    description: "Runtime source imports a Supabase package",
    pattern: /(?:from\s+["']|import\s*(?:\(\s*)?["']|require\(\s*["'])@supabase\//g,
  },
  {
    id: "postgres-package",
    description: "Runtime source imports postgres/pg database clients instead of D1 bindings",
    pattern: /(?:from\s+["']|import\s*(?:\(\s*)?["']|require\(\s*["'])(?:postgres|pg|pg-promise)(?=["'/])/g,
  },
  {
    id: "vercel-package",
    description: "Runtime source imports a Vercel package",
    pattern: /(?:from\s+["']|import\s*(?:\(\s*)?["']|require\(\s*["'])@vercel\//g,
  },
  {
    id: "pgvector-runtime",
    description: "Runtime source references pgvector instead of Cloudflare Vectorize",
    pattern: /\bpgvector\b/gi,
  },
  {
    id: "retired-provider-env",
    description: "Runtime source reads a retired Vercel/Supabase/Postgres environment variable",
    pattern: new RegExp(`\\b(?:process\\.env\\.|env\\.)(${RETIRED_PROVIDER_ENV_NAMES.join("|")})\\b`, "g"),
  },
  {
    id: "retired-provider-env-literal",
    description: "Runtime source contains a retired Vercel/Supabase/Postgres environment key literal",
    pattern: new RegExp(`["'](${RETIRED_PROVIDER_ENV_NAMES.join("|")})["']`, "g"),
  },
  {
    id: "vercel-header",
    description: "Runtime source references Vercel request or response headers",
    pattern: /\bx-vercel-[a-z0-9-]+\b/gi,
  },
  {
    id: "supabase-url",
    description: "Runtime source contains a Supabase project URL literal",
    pattern: /https:\/\/[a-z0-9-]+\.supabase\.co\b/gi,
  },
  {
    id: "postgres-url",
    description: "Runtime source contains a Postgres connection URL literal",
    pattern: /postgres(?:ql)?:\/\//gi,
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backupDir = resolveBackupDir();
  const report = buildRuntimeProviderScanReport(process.cwd(), backupDir);
  const reportPath = path.join(cloudflareDir(backupDir), "runtime-provider-scan-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(compactReport(report), null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function buildRuntimeProviderScanReport(cwd = process.cwd(), backupDir = resolveBackupDir()): RuntimeProviderScanReport {
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  const files = listRepoSourceFiles(cwd).filter(isRuntimeSourceFile);
  const findings = files.flatMap((file) => scanRuntimeProviderText(file, fs.readFileSync(path.join(cwd, file), "utf8")));

  return {
    createdAt: new Date().toISOString(),
    backupDir,
    ok: files.length > 0 && findings.length === 0,
    sourceFingerprint: {
      sha256: sourceFingerprint.sha256,
      fileCount: sourceFingerprint.fileCount,
    },
    scannedFiles: files,
    findings,
  };
}

export function scanRuntimeProviderText(file: string, content: string): RuntimeProviderFinding[] {
  const findings: RuntimeProviderFinding[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const index = match.index ?? 0;
      findings.push({
        rule: rule.id,
        description: rule.description,
        file,
        ...lineAndColumn(content, index),
        snippet: snippetAt(content, index, match[0]?.length ?? 0),
      });
    }
  }
  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
  );
}

function isRuntimeSourceFile(file: string) {
  return RUNTIME_SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix)) || (RUNTIME_SOURCE_FILES as readonly string[]).includes(file);
}

function lineAndColumn(content: string, index: number) {
  const prefix = content.slice(0, index);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)!.length + 1,
  };
}

function snippetAt(content: string, index: number, length: number) {
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  const nextLine = content.indexOf("\n", index);
  const lineEnd = nextLine === -1 ? content.length : nextLine;
  const line = content.slice(lineStart, lineEnd);
  const relativeStart = index - lineStart;
  const relativeEnd = relativeStart + length;
  const snippet = `${line.slice(0, relativeStart)}[MATCH]${line.slice(relativeEnd)}`.trim();
  return snippet.length <= 180 ? snippet : `${snippet.slice(0, 177)}...`;
}

function compactReport(report: RuntimeProviderScanReport) {
  return {
    createdAt: report.createdAt,
    backupDir: report.backupDir,
    ok: report.ok,
    sourceFingerprint: report.sourceFingerprint,
    scannedFiles: report.scannedFiles.length,
    findings: report.findings,
  };
}
