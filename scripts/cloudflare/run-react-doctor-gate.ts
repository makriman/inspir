import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

type ReactDoctorSummary = {
  errorCount?: number;
  warningCount?: number;
  totalDiagnosticCount?: number;
  score?: number;
  scoreLabel?: string;
};

type ReactDoctorReport = {
  ok?: boolean;
  version?: string;
  summary?: ReactDoctorSummary;
  diagnostics?: unknown[];
  error?: unknown;
};

type ReactDoctorGateResult = {
  ok: boolean;
  blockers: string[];
  summary: Required<Pick<ReactDoctorSummary, "errorCount" | "warningCount" | "totalDiagnosticCount" | "score">> & {
    scoreLabel?: string;
  };
};

const require = createRequire(import.meta.url);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runReactDoctorGate(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result.compact, null, 2));
  if (!result.gate.ok) process.exitCode = 1;
}

export function runReactDoctorGate(options: { reportPath?: string; outputDir?: string } = {}) {
  const backupDir = resolveBackupDir();
  const cfDir = cloudflareDir(backupDir);
  const reportPath = path.resolve(options.reportPath ?? path.join(cfDir, "react-doctor-report.json"));
  const outputDir = path.resolve(options.outputDir ?? path.join(cfDir, "react-doctor"));
  const reactDoctorCli = require.resolve("react-doctor");
  const command = process.execPath;
  const args = [reactDoctorCli, "--yes", "--json", "--output-dir", outputDir, "--blocking", "warning"];
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: commandEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? (result.error ? String(result.error) : "")}`;
  const report = parseReactDoctorReport(output);
  const gate = assessReactDoctorReport(report, result.status);
  const finishedAt = Date.now();

  fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  return {
    gate,
    report,
    compact: {
      createdAt: new Date(finishedAt).toISOString(),
      reportPath,
      outputDir,
      ok: gate.ok,
      cliStatus: result.status,
      durationMs: finishedAt - startedAt,
      summary: gate.summary,
      blockers: gate.blockers,
    },
  };
}

export function assessReactDoctorReport(report: ReactDoctorReport, cliStatus: number | null): ReactDoctorGateResult {
  const summary = {
    errorCount: numberValue(report.summary?.errorCount),
    warningCount: numberValue(report.summary?.warningCount),
    totalDiagnosticCount: numberValue(report.summary?.totalDiagnosticCount),
    score: numberValue(report.summary?.score),
    scoreLabel: report.summary?.scoreLabel,
  };
  const blockers: string[] = [];
  if (cliStatus !== 0) blockers.push(`React Doctor exited with status ${cliStatus ?? "unknown"}`);
  if (report.ok !== true) blockers.push("React Doctor report ok was not true");
  if (summary.errorCount !== 0) blockers.push(`React Doctor reported ${summary.errorCount} errors`);
  if (summary.warningCount !== 0) blockers.push(`React Doctor reported ${summary.warningCount} warnings`);
  if (summary.totalDiagnosticCount !== 0) blockers.push(`React Doctor reported ${summary.totalDiagnosticCount} diagnostics`);
  if (summary.score !== 100) blockers.push(`React Doctor score was ${summary.score}, expected 100`);
  return {
    ok: blockers.length === 0,
    blockers,
    summary,
  };
}

export function parseReactDoctorReport(output: string): ReactDoctorReport {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`React Doctor did not emit a JSON report:\n${output.slice(-4000)}`);
  }
  const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
  if (!isRecord(parsed)) throw new Error("React Doctor JSON report was not an object");
  return parsed as ReactDoctorReport;
}

function parseArgs(args: string[]) {
  return {
    reportPath: argValue(args, "--report"),
    outputDir: argValue(args, "--output-dir"),
  };
}

function argValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
