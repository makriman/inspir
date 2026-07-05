import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import {
  DNS_PUBLIC_CUTOVER_REPORT,
  type DnsCutoverCheck,
} from "./dns-cutover-evidence";
import { cloudflareDir, resolveBackupDir } from "./migration-config";

const DOMAIN = "inspirlearning.com";
const HOSTNAMES = [DOMAIN, `www.${DOMAIN}`] as const;
const backupDir = resolveBackupDir();
const checks: DnsCutoverCheck[] = [];

void main().catch((error) => {
  fail("public DNS verifier runtime", error instanceof Error ? error.message : String(error));
  writeReport();
  process.exitCode = 1;
});

async function main() {
  if (process.env.CONFIRM_MANUAL_DNS_CUTOVER === "1") {
    pass("manual DNS cutover confirmed", {
      confirmation: "CONFIRM_MANUAL_DNS_CUTOVER",
      mode: "operator-managed-dns",
    });
  } else {
    fail("manual DNS cutover confirmed", {
      expected: "CONFIRM_MANUAL_DNS_CUTOVER=1",
    });
  }

  await checkPublicNameservers();
  for (const hostname of HOSTNAMES) {
    await checkDnsResolution(hostname);
    await checkHttpEdge(hostname);
  }

  const ok = writeReport();
  if (!ok) process.exitCode = 1;
}

async function checkPublicNameservers() {
  try {
    const nameservers = await dns.resolveNs(DOMAIN);
    const cloudflareNameservers = nameservers.filter((name) => name.toLowerCase().endsWith(".ns.cloudflare.com"));
    if (cloudflareNameservers.length >= 2) {
      pass("public nameservers use Cloudflare", { nameservers });
    } else {
      fail("public nameservers use Cloudflare", { nameservers });
    }
  } catch (error) {
    fail("public nameservers use Cloudflare", error instanceof Error ? error.message : String(error));
  }
}

async function checkDnsResolution(hostname: string) {
  const result: { a?: string[]; aaaa?: string[]; cname?: string[] } = {};
  try {
    result.a = await dns.resolve4(hostname);
  } catch {
    result.a = [];
  }
  try {
    result.aaaa = await dns.resolve6(hostname);
  } catch {
    result.aaaa = [];
  }
  try {
    result.cname = await dns.resolveCname(hostname);
  } catch {
    result.cname = [];
  }

  const flattened = [...(result.a ?? []), ...(result.aaaa ?? []), ...(result.cname ?? [])];
  if (flattened.length) pass(`public DNS resolves ${hostname}`, result);
  else fail(`public DNS resolves ${hostname}`, result);

  const vercelTargets = flattened.filter((value) => value.toLowerCase().includes("vercel"));
  if (vercelTargets.length) fail(`public DNS target is not Vercel for ${hostname}`, { vercelTargets, result });
  else pass(`public DNS target is not Vercel for ${hostname}`, result);
}

async function checkHttpEdge(hostname: string) {
  const url = `https://${hostname}/`;
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const headers = Object.fromEntries([...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    const server = headers.server ?? "";
    const vercelHeaders = Object.keys(headers).filter((header) => header.startsWith("x-vercel"));
    const cloudflareEdge = server.toLowerCase().includes("cloudflare") || Boolean(headers["cf-ray"]);

    if (response.status >= 200 && response.status < 400) pass(`HTTP status ${hostname}`, { status: response.status, url });
    else fail(`HTTP status ${hostname}`, { status: response.status, url });

    if (cloudflareEdge) pass(`HTTP served through Cloudflare ${hostname}`, { server, cfRay: headers["cf-ray"] ?? null });
    else fail(`HTTP served through Cloudflare ${hostname}`, { server, cfRay: headers["cf-ray"] ?? null });

    if (!vercelHeaders.length) pass(`HTTP not served by Vercel ${hostname}`, { server });
    else fail(`HTTP not served by Vercel ${hostname}`, { server, vercelHeaders });
  } catch (error) {
    fail(`HTTP served through Cloudflare ${hostname}`, error instanceof Error ? error.message : String(error));
  }
}

function writeReport() {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    domain: DOMAIN,
    mode: "manual-public-dns",
    ok: failed.length === 0,
    failedChecks: failed.length,
    checks,
  };
  fs.writeFileSync(path.join(cloudflareDir(backupDir), path.basename(DNS_PUBLIC_CUTOVER_REPORT)), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}
