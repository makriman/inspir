import fs from "node:fs";
import path from "node:path";
import { languageUrlPrefixes, supportedLanguages } from "@/lib/content/languages";
import {
  CLOUDFLARE_ACCOUNT_ID,
  cloudflareDir,
  hasFlag,
  resolveBackupDir,
} from "./migration-config";
import {
  CLOUDFLARE_TOKEN_DOMAIN,
  cloudflareApiTokenSourceLabel,
  readCloudflareApiToken,
} from "./cloudflare-api-token";

type CloudflareApiError = {
  code?: number;
  message?: string;
};

type CloudflareApiResponse<T> = {
  success?: boolean;
  errors?: CloudflareApiError[];
  messages?: Array<{ message?: string }>;
  result?: T;
};

type ApiResult<T> = {
  status: number;
  ok: boolean;
  payload: CloudflareApiResponse<T>;
};

type Zone = {
  id?: string;
  name?: string;
  status?: string;
  account?: { id?: string; name?: string };
};

type RulesetRule = {
  id?: string;
  ref?: string;
  description?: string;
  expression?: string;
  action?: string;
  action_parameters?: unknown;
  enabled?: boolean;
  [key: string]: unknown;
};

type Ruleset = {
  id?: string;
  name?: string;
  description?: string;
  kind?: string;
  phase?: string;
  rules?: RulesetRule[];
};

type MarketingCacheRule = {
  ref: string;
  description: string;
  expression: string;
  action: "set_cache_settings";
  action_parameters: {
    cache: true;
    edge_ttl: { mode: "respect_origin" };
    browser_ttl: { mode: "respect_origin" };
    cache_key: {
      ignore_query_strings_order: true;
      cache_deception_armor: true;
      custom_key: {
        query_string: {
          exclude: ["*"];
        };
      };
    };
  };
  enabled: true;
};

const DOMAIN = CLOUDFLARE_TOKEN_DOMAIN;
const CACHE_RULES_PHASE = "http_request_cache_settings";
const RULE_REF = "inspir_marketing_html_edge_cache_v1";
const RULE_DESCRIPTION = "inspir marketing/blog cookieless HTML edge cache";
const RULESET_NAME = "inspir cache rules";
const RULESET_DESCRIPTION = "Cache public inspir marketing/blog HTML while respecting origin TTLs.";
const requiredPermissions = {
  accountId: CLOUDFLARE_ACCOUNT_ID,
  zone: DOMAIN,
  zonePermissions: ["Zone:Read", "Zone:Cache Rules:Edit"],
  accountPermissions: ["Account Rulesets:Edit", "Account Filter Lists:Edit"],
  proof:
    "The script reads inspirlearning.com, then creates or updates the zone http_request_cache_settings entry point ruleset.",
};

const marketingExactPaths = [
  "/",
  "/about",
  "/ai-learning-map",
  "/compare",
  "/for",
  "/learn",
  "/loading",
  "/media",
  "/mission",
  "/privacy",
  "/prompts",
  "/schools",
  "/subjects",
  "/terms",
  "/topics",
  "/trust",
] as const;

const marketingPathPrefixes = ["/blog/", "/compare/", "/for/", "/learn/", "/subjects/"] as const;
const rscQueryNames = ["_rsc", "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"];

const backupDir = resolveBackupDir();
const cfDir = cloudflareDir(backupDir);
const outputPath = path.join(cfDir, "marketing-cache-rule-report.json");
const credential = readCloudflareApiToken();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  writeReport({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    requiredPermissions,
  });
  process.exitCode = 1;
});

async function main() {
  const rule = buildMarketingCacheRule();

  if (hasFlag("--dry-run")) {
    writeReport({
      ok: true,
      dryRun: true,
      rule,
      requiredPermissions,
    });
    console.log(JSON.stringify({ ok: true, dryRun: true, outputPath, ruleRef: RULE_REF }, null, 2));
    return;
  }

  if (!credential.token) {
    console.error(credential.error);
    writeReport({
      ok: false,
      error: credential.error,
      rule,
      requiredPermissions,
    });
    process.exitCode = 1;
    return;
  }

  const zone = await resolveZone();
  if (!zone.id) {
    console.error(`Could not resolve Cloudflare zone for ${DOMAIN}.`);
    writeReport({
      ok: false,
      error: `Could not resolve Cloudflare zone for ${DOMAIN}.`,
      rule,
      requiredPermissions,
    });
    process.exitCode = 1;
    return;
  }

  const existingRuleset = await getRuleset(zone.id);
  const existingRules = existingRuleset?.rules ?? [];
  const updatedRules = upsertRule(existingRules, rule);
  const payload = {
    name: existingRuleset?.name ?? RULESET_NAME,
    description: existingRuleset?.description ?? RULESET_DESCRIPTION,
    kind: existingRuleset?.kind ?? "zone",
    phase: existingRuleset?.phase ?? CACHE_RULES_PHASE,
    rules: updatedRules,
  };
  const response = existingRuleset?.id
    ? await request<Ruleset>(`/zones/${zone.id}/rulesets/${existingRuleset.id}`, {}, { method: "PUT", body: JSON.stringify(payload) })
    : await request<Ruleset>(`/zones/${zone.id}/rulesets`, {}, { method: "POST", body: JSON.stringify(payload) });

  if (!response.ok || !response.payload.result?.id) {
    console.error(`Cloudflare cache rule ${existingRuleset?.id ? "update" : "create"} failed.`);
    writeReport({
      ok: false,
      operation: existingRuleset?.id ? "update" : "create",
      zone: redactZone(zone),
      requestPayload: payload,
      response: responseSummary(response),
      requiredPermissions,
    });
    process.exitCode = 1;
    return;
  }

  const installedRule = response.payload.result.rules?.find((candidate) => ruleMatches(candidate)) ?? rule;
  writeReport({
    ok: true,
    operation: existingRuleset?.id ? "update" : "create",
    zone: redactZone(zone),
    rulesetId: response.payload.result.id,
    rule: installedRule,
    requiredPermissions,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        operation: existingRuleset?.id ? "update" : "create",
        zone: zone.name,
        rulesetId: response.payload.result.id,
        ruleRef: RULE_REF,
        outputPath,
      },
      null,
      2,
    ),
  );
}

function buildMarketingCacheRule(): MarketingCacheRule {
  return {
    ref: RULE_REF,
    description: RULE_DESCRIPTION,
    expression: buildMarketingCacheExpression(),
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "respect_origin" },
      browser_ttl: { mode: "respect_origin" },
      cache_key: {
        ignore_query_strings_order: true,
        cache_deception_armor: true,
        custom_key: {
          query_string: {
            exclude: ["*"],
          },
        },
      },
    },
    enabled: true,
  };
}

function buildMarketingCacheExpression() {
  const localePrefixes = supportedLanguages
    .map((language) => languageUrlPrefixes[language])
    .filter((prefix) => prefix.length > 0)
    .sort();
  const exactPaths = quoteSet([...marketingExactPaths, ...localePrefixes.map((prefix) => `/${prefix}`)]);
  const pathPrefixes = [
    ...marketingPathPrefixes,
    ...localePrefixes.map((prefix) => `/${prefix}/`),
  ].map((prefix) => `starts_with(http.request.uri.path, ${quoteExpressionString(prefix)})`);
  const requestClauses = [
    `(http.host in ${quoteSet([DOMAIN, `www.${DOMAIN}`])})`,
    `(http.request.method in {"GET" "HEAD"})`,
    `(not http.cookie contains "=")`,
    `(not any(http.request.headers["rsc"][*] eq "1"))`,
    ...rscQueryNames.map((name) => `(not http.request.uri.query contains ${quoteExpressionString(`${name}=`)})`),
    `(not http.request.uri.path contains ".")`,
    `(not http.request.uri.path contains "/api")`,
    `(not http.request.uri.path contains "/_next")`,
    `(not http.request.uri.path contains "/admin")`,
    `(not http.request.uri.path contains "/onboarding")`,
    `(not http.request.uri.path contains "/chat")`,
    `(not http.request.uri.path contains "/reset_pw")`,
    `(http.request.uri.path in ${exactPaths} or ${pathPrefixes.join(" or ")})`,
  ];

  return requestClauses.join(" and ");
}

function upsertRule(existingRules: RulesetRule[], rule: MarketingCacheRule) {
  const ruleIndex = existingRules.findIndex((candidate) => ruleMatches(candidate));
  if (ruleIndex === -1) return [...existingRules, rule];

  return existingRules.map((candidate, index) =>
    index === ruleIndex
      ? {
          ...candidate,
          ...rule,
        }
      : candidate,
  );
}

function ruleMatches(rule: RulesetRule) {
  return rule.ref === RULE_REF || rule.description === RULE_DESCRIPTION;
}

async function resolveZone() {
  const response = await request<Zone[]>("/zones", { name: DOMAIN, "account.id": CLOUDFLARE_ACCOUNT_ID, per_page: "50" });
  if (!response.ok || !Array.isArray(response.payload.result)) {
    throw new Error(`Cloudflare zone lookup failed: ${JSON.stringify(responseSummary(response))}`);
  }

  return response.payload.result.find((zone) => zone.name === DOMAIN) ?? {};
}

async function getRuleset(zoneId: string) {
  const response = await request<Ruleset>(`/zones/${zoneId}/rulesets/phases/${CACHE_RULES_PHASE}/entrypoint`);
  if (response.ok) return response.payload.result;
  const notFound = response.status === 404 || response.payload.errors?.some((error) => error.code === 10000 || error.code === 1003);
  if (notFound) return null;
  throw new Error(`Cloudflare cache ruleset lookup failed: ${JSON.stringify(responseSummary(response))}`);
}

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
    messages: response.payload.messages ?? [],
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

function writeReport(report: Record<string, unknown>) {
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        credentialSource: cloudflareApiTokenSourceLabel(credential.source),
        ...report,
      },
      null,
      2,
    )}\n`,
  );
}

function quoteSet(values: readonly string[]) {
  return `{${values.map((value) => quoteExpressionString(value)).join(" ")}}`;
}

function quoteExpressionString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
