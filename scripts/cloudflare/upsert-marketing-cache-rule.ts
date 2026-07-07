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
  action_parameters:
    | {
        cache: true;
        edge_ttl: { mode: "respect_origin" };
        browser_ttl: { mode: "respect_origin" };
      }
    | {
        cache: false;
      };
  enabled: true;
};

const DOMAIN = CLOUDFLARE_TOKEN_DOMAIN;
const CACHE_RULES_PHASE = "http_request_cache_settings";
const RULE_REF = "inspir_marketing_html_edge_cache_v1";
const RULE_DESCRIPTION = "inspir marketing/blog cookieless HTML edge cache";
const BYPASS_RULE_REF = `${RULE_REF}_cookie-bypass`;
const BYPASS_RULE_DESCRIPTION = `${RULE_DESCRIPTION} (cookie bypass)`;
const RULESET_NAME = "inspir cache rules";
const RULESET_DESCRIPTION = "Cache public inspir marketing/blog HTML while respecting origin TTLs.";
const MAX_EXPRESSION_LENGTH = 4096;
const EXPRESSION_LENGTH_MARGIN = 96;
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
  "/blog",
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
const authCookieNames = ["better-auth.session_token", "__Secure-better-auth.session_token"] as const;

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
  const rules = buildMarketingCacheRules();

  if (hasFlag("--dry-run")) {
    writeReport({
      ok: true,
      dryRun: true,
      rules,
      requiredPermissions,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          outputPath,
          ruleRef: RULE_REF,
          ruleRefs: rules.map((rule) => rule.ref),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!credential.token) {
    console.error(credential.error);
    writeReport({
      ok: false,
      error: credential.error,
      rules,
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
      rules,
      requiredPermissions,
    });
    process.exitCode = 1;
    return;
  }

  const existingRuleset = await getRuleset(zone.id);
  const existingRules = existingRuleset?.rules ?? [];
  const updatedRules = upsertRules(existingRules, rules);
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

  const installedRules = response.payload.result.rules?.filter((candidate) => managedRuleMatches(candidate)) ?? rules;
  writeReport({
    ok: true,
    operation: existingRuleset?.id ? "update" : "create",
    zone: redactZone(zone),
    rulesetId: response.payload.result.id,
    rules: installedRules,
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
        ruleRefs: installedRules.map((rule) => rule.ref),
        outputPath,
      },
      null,
      2,
    ),
  );
}

function buildMarketingCacheRules(): MarketingCacheRule[] {
  const localePrefixes = supportedLanguages
    .map((language) => languageUrlPrefixes[language])
    .filter((prefix) => prefix.length > 0)
    .sort();
  const commonClauses = buildCommonRequestClauses();
  const englishPrefixClauses = marketingPathPrefixes.map((prefix) => buildPathPrefixClause(prefix));
  const localizedRootPaths = localePrefixes.map((prefix) => `/${prefix}`);
  const localizedPathPrefixes = localePrefixes.map((prefix) => `/${prefix}/`);

  return [
    buildMarketingCacheRule("english", "English marketing/blog pages", [
      ...commonClauses,
      `(http.request.uri.path in ${quoteSet(marketingExactPaths)} or ${englishPrefixClauses.join(" or ")})`,
    ]),
    buildMarketingCacheRule("localized-roots", "localized marketing roots", [
      ...commonClauses,
      `(http.request.uri.path in ${quoteSet(localizedRootPaths)})`,
    ]),
    ...chunkPathPrefixes(localizedPathPrefixes, commonClauses).map((prefixes, index) =>
      buildMarketingCacheRule(`localized-paths-${index + 1}`, `localized marketing paths ${index + 1}`, [
        ...commonClauses,
        `(${prefixes.map((prefix) => buildPathPrefixClause(prefix)).join(" or ")})`,
      ]),
    ),
    buildCookieBypassRule(),
  ];
}

function buildCommonRequestClauses() {
  return [
    `(http.host in ${quoteSet([DOMAIN, `www.${DOMAIN}`])})`,
    `(http.request.method in {"GET" "HEAD"})`,
    `(not (${buildCookieContainsClauses(authCookieNames).join(" or ")}))`,
    `(not any(http.request.headers["rsc"][*] eq "1"))`,
    ...rscQueryNames.map((name) => `(not http.request.uri.query contains ${quoteExpressionString(`${name}=`)})`),
    `(not http.request.uri.path contains ".")`,
    `(not http.request.uri.path contains "/api")`,
    `(not http.request.uri.path contains "/_next")`,
    `(not http.request.uri.path contains "/admin")`,
    `(not http.request.uri.path contains "/onboarding")`,
    `(not http.request.uri.path contains "/chat")`,
    `(not http.request.uri.path contains "/reset_pw")`,
  ];
}

function buildMarketingCacheRule(refSuffix: string, label: string, clauses: string[]): MarketingCacheRule {
  const expression = clauses.join(" and ");
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(
      `Cloudflare cache rule expression ${refSuffix} is ${expression.length} characters; maximum is ${MAX_EXPRESSION_LENGTH}.`,
    );
  }

  return {
    ref: `${RULE_REF}_${refSuffix}`,
    description: `${RULE_DESCRIPTION} (${label})`,
    expression,
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "respect_origin" },
      browser_ttl: { mode: "respect_origin" },
    },
    enabled: true,
  };
}

function buildCookieBypassRule(): MarketingCacheRule {
  return {
    ref: BYPASS_RULE_REF,
    description: BYPASS_RULE_DESCRIPTION,
    expression: [
      `(http.host in ${quoteSet([DOMAIN, `www.${DOMAIN}`])})`,
      `(http.request.method in {"GET" "HEAD"})`,
      `(${buildCookieContainsClauses(authCookieNames).join(" or ")})`,
    ].join(" and "),
    action: "set_cache_settings",
    action_parameters: {
      cache: false,
    },
    enabled: true,
  };
}

function chunkPathPrefixes(pathPrefixes: readonly string[], commonClauses: readonly string[]) {
  const chunks: string[][] = [];
  let currentChunk: string[] = [];

  for (const prefix of pathPrefixes) {
    const nextChunk = [...currentChunk, prefix];
    const nextExpression = [
      ...commonClauses,
      `(${nextChunk.map((candidate) => buildPathPrefixClause(candidate)).join(" or ")})`,
    ].join(" and ");

    if (currentChunk.length > 0 && nextExpression.length > MAX_EXPRESSION_LENGTH - EXPRESSION_LENGTH_MARGIN) {
      chunks.push(currentChunk);
      currentChunk = [prefix];
    } else {
      currentChunk = nextChunk;
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}

function buildPathPrefixClause(prefix: string) {
  return `starts_with(http.request.uri.path, ${quoteExpressionString(prefix)})`;
}

function buildCookieContainsClauses(cookieNames: readonly string[]) {
  return cookieNames.map((name) => `http.cookie contains ${quoteExpressionString(name)}`);
}

function upsertRules(existingRules: RulesetRule[], rules: MarketingCacheRule[]) {
  return [...existingRules.filter((candidate) => !managedRuleMatches(candidate)), ...rules];
}

function managedRuleMatches(rule: RulesetRule) {
  return (
    rule.ref === RULE_REF ||
    (typeof rule.ref === "string" && rule.ref.startsWith(`${RULE_REF}_`)) ||
    rule.ref === BYPASS_RULE_REF ||
    rule.description === RULE_DESCRIPTION ||
    (typeof rule.description === "string" && rule.description.startsWith(`${RULE_DESCRIPTION} (`)) ||
    rule.description === BYPASS_RULE_DESCRIPTION
  );
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
