import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CLOUDFLARE_ACCOUNT_ID, cloudflareDir, resolveBackupDir } from "./migration-config";
import {
  CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME,
  CLOUDFLARE_TOKEN_DOMAIN,
  CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS,
  cloudflareApiTokenSourceLabel,
  readCloudflareApiToken,
} from "./cloudflare-api-token";

type Check = {
  name: string;
  status: "pass" | "fail";
  detail?: unknown;
};

type CloudflareApiResponse<T> = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
  result_info?: { total_pages?: number };
};

type TokenVerifyResult = {
  status?: string;
  not_before?: string | null;
  expires_on?: string | null;
};

type Zone = {
  id?: string;
  name?: string;
  status?: string;
  account?: { id?: string; name?: string };
};

type DnsRecord = {
  id?: string;
  name?: string;
  type?: string;
  content?: string;
  proxied?: boolean;
  ttl?: number;
};

const DOMAIN = CLOUDFLARE_TOKEN_DOMAIN;
const HOSTNAMES = new Set([DOMAIN, `www.${DOMAIN}`]);
const DNS_WRITE_PROBE_HOSTNAME = CLOUDFLARE_DNS_WRITE_PROBE_HOSTNAME;
const DNS_WRITE_PROBE_CHECK = "Cloudflare DNS records write/delete probe";
const requiredPermissions = CLOUDFLARE_TOKEN_REQUIRED_PERMISSIONS;
const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const outputPath = path.join(cfDir, "cloudflare-api-token-capability-report.json");
const credential = readCloudflareApiToken();
const checks: Check[] = [];

void main().catch((error) => {
  fail("Cloudflare API token capability verifier runtime", error instanceof Error ? error.message : String(error));
  writeReport();
  process.exitCode = 1;
});

async function main() {
  if (!credential.token) {
    fail("Cloudflare API token loaded", credential.error);
    writeReport();
    process.exitCode = 1;
    return;
  }

  pass("Cloudflare API token loaded", { credentialSource: cloudflareApiTokenSourceLabel(credential.source) });
  const userVerify = await request<TokenVerifyResult>("/user/tokens/verify");
  const accountVerify = await request<TokenVerifyResult>(`/accounts/${CLOUDFLARE_ACCOUNT_ID}/tokens/verify`);
  const tokenActive = tokenIsActive(userVerify) || tokenIsActive(accountVerify);
  if (tokenActive) {
    pass("Cloudflare API token active", {
      userVerify: tokenVerifySummary(userVerify),
      accountVerify: tokenVerifySummary(accountVerify),
    });
  } else {
    fail("Cloudflare API token active", {
      userVerify: tokenVerifySummary(userVerify),
      accountVerify: tokenVerifySummary(accountVerify),
    });
  }

  const zoneResponse = await request<Zone[]>("/zones", { name: DOMAIN, "account.id": CLOUDFLARE_ACCOUNT_ID, per_page: "50" });
  const zone = Array.isArray(zoneResponse.payload.result)
    ? zoneResponse.payload.result.find((candidate) => candidate.name === DOMAIN)
    : undefined;
  if (zoneResponse.ok && zone?.id) {
    pass("Cloudflare zone read", { zone: redactZone(zone) });
  } else {
    fail("Cloudflare zone read", {
      response: responseSummary(zoneResponse),
      expectedZone: DOMAIN,
    });
  }

  if (zone?.id) {
    const dnsResponse = await request<DnsRecord[]>(`/zones/${zone.id}/dns_records`, { per_page: "100" });
    if (dnsResponse.ok && Array.isArray(dnsResponse.payload.result)) {
      const records = dnsResponse.payload.result.filter((record) => record.name && HOSTNAMES.has(record.name));
      pass("Cloudflare DNS records read", { records: records.map(redactRecord) });
      await verifyDnsWriteDeleteProbe(zone.id);
    } else {
      fail("Cloudflare DNS records read", {
        response: responseSummary(dnsResponse),
        remediation:
          "Use a Cloudflare API token scoped to the Cloudflare account and inspirlearning.com zone with Zone:Read, DNS:Read, and DNS:Edit before DNS cutover.",
        requiredPermissions,
      });
      fail(DNS_WRITE_PROBE_CHECK, {
        skipped: true,
        reason: "DNS record read must pass before the write/delete probe can safely run.",
      });
    }
  }

  const ok = tokenActive && checks.every((check) => check.status === "pass");
  writeReport(ok);
  if (!ok) process.exitCode = 1;
}

function tokenIsActive(response: ApiResult<TokenVerifyResult>) {
  return response.ok && response.payload.result?.status === "active";
}

function tokenVerifySummary(response: ApiResult<TokenVerifyResult>) {
  const result = response.payload.result;
  return {
    ...responseSummary(response),
    tokenStatus: result?.status ?? null,
    notBefore: result?.not_before ?? null,
    expiresOn: result?.expires_on ?? null,
  };
}

type ApiResult<T> = {
  status: number;
  ok: boolean;
  payload: CloudflareApiResponse<T>;
};

async function request<T>(pathName: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<ApiResult<T>> {
  const search = new URLSearchParams(params);
  const suffix = search.size ? `?${search}` : "";
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${credential.token}`);
  headers.set("content-type", "application/json");
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathName}${suffix}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch((error) => ({
    success: false,
    errors: [{ message: error instanceof Error ? error.message : String(error) }],
  }))) as CloudflareApiResponse<T>;
  return {
    status: response.status,
    ok: response.ok && payload.success === true,
    payload,
  };
}

function responseSummary<T>(response: ApiResult<T>) {
  return {
    status: response.status,
    success: response.payload.success === true,
    errors: response.payload.errors ?? [],
  };
}

function redactZone(zone: Zone) {
  return {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    accountId: zone.account?.id,
    accountName: zone.account?.name,
  };
}

function redactRecord(record: DnsRecord) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    content: record.content,
    proxied: record.proxied,
    ttl: record.ttl,
  };
}

function cryptoRandomSuffix() {
  return crypto.randomBytes(8).toString("hex");
}

async function verifyDnsWriteDeleteProbe(zoneId: string) {
  if (process.env.CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE !== "1") {
    fail(DNS_WRITE_PROBE_CHECK, {
      confirmed: false,
      remediation:
        "Rerun with CONFIRM_CLOUDFLARE_DNS_WRITE_PROBE=1 to create and delete a temporary TXT record proving DNS edit access before cutover.",
      probeRecord: DNS_WRITE_PROBE_HOSTNAME,
    });
    return;
  }

  const content = `inspirlearning-migration-token-check-${Date.now()}-${cryptoRandomSuffix()}`;
  let created: DnsRecord | null = null;
  try {
    const create = await request<DnsRecord>(
      `/zones/${zoneId}/dns_records`,
      {},
      {
        method: "POST",
        body: JSON.stringify({
          type: "TXT",
          name: DNS_WRITE_PROBE_HOSTNAME,
          content,
          ttl: 60,
          comment: "Temporary Inspirlearning Cloudflare migration DNS token capability probe",
        }),
      },
    );

    if (!create.ok || !create.payload.result?.id) {
      fail(DNS_WRITE_PROBE_CHECK, {
        create: responseSummary(create),
        remediation:
          "Use a Cloudflare API token scoped to the Cloudflare account and inspirlearning.com zone with DNS:Edit before DNS cutover.",
        requiredPermissions,
      });
      return;
    }

    created = create.payload.result;
    const readBack = await request<DnsRecord>(`/zones/${zoneId}/dns_records/${created.id}`);
    const readBackRecord = readBack.payload.result;
    const readBackOk =
      readBack.ok &&
      readBackRecord?.id === created.id &&
      readBackRecord?.name === DNS_WRITE_PROBE_HOSTNAME &&
      readBackRecord?.type === "TXT" &&
      readBackRecord?.content === content;
    if (!readBackOk) {
      fail(DNS_WRITE_PROBE_CHECK, {
        create: responseSummary(create),
        readBack: responseSummary(readBack),
        record: redactRecord(created),
        remediation: "The token created a TXT probe record but could not read it back exactly; inspect DNS permissions before cutover.",
      });
      return;
    }

    const deleteResult = await request<unknown>(`/zones/${zoneId}/dns_records/${created.id}`, {}, { method: "DELETE" });
    if (!deleteResult.ok) {
      fail(DNS_WRITE_PROBE_CHECK, {
        create: responseSummary(create),
        delete: responseSummary(deleteResult),
        record: redactRecord(created),
        remediation: `Delete the temporary probe record ${DNS_WRITE_PROBE_HOSTNAME} manually, then rerun the verifier with DNS edit permissions.`,
      });
      created = null;
      return;
    }

    pass(DNS_WRITE_PROBE_CHECK, {
      confirmed: true,
      probeRecord: DNS_WRITE_PROBE_HOSTNAME,
      created: redactRecord(created),
      cleanup: "deleted",
    });
    created = null;
  } catch (error) {
    fail(DNS_WRITE_PROBE_CHECK, {
      error: error instanceof Error ? error.message : String(error),
      remediation:
        "Use a Cloudflare API token scoped to the Cloudflare account and inspirlearning.com zone with DNS:Edit before DNS cutover.",
      requiredPermissions,
    });
  } finally {
    if (created?.id) {
      const cleanup = await request<unknown>(`/zones/${zoneId}/dns_records/${created.id}`, {}, { method: "DELETE" }).catch((error) => ({
        status: 0,
        ok: false,
        payload: { success: false, errors: [{ message: error instanceof Error ? error.message : String(error) }] },
      }));
      if (!cleanup.ok) {
        fail("Cloudflare DNS write probe cleanup", {
          record: redactRecord(created),
          cleanup: responseSummary(cleanup),
          remediation: `Delete the temporary probe record ${DNS_WRITE_PROBE_HOSTNAME} manually before cutover.`,
        });
      }
    }
  }
}

function writeReport(forcedOk?: boolean) {
  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    createdAt: new Date().toISOString(),
    backupDir,
    domain: DOMAIN,
    accountId: CLOUDFLARE_ACCOUNT_ID,
    credentialSource: cloudflareApiTokenSourceLabel(credential.source),
    requiredPermissions,
    ok: forcedOk ?? failed.length === 0,
    failedChecks: failed.length,
    checks,
  };
  fs.mkdirSync(cfDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  return report.ok;
}

function pass(name: string, detail?: unknown) {
  checks.push({ name, status: "pass", detail });
}

function fail(name: string, detail?: unknown) {
  checks.push({ name, status: "fail", detail });
}
