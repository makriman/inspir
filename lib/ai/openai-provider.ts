import { readRuntimeEnv } from "@/lib/runtime/cloudflare";

const cloudflareGatewayHost = "gateway.ai.cloudflare.com";

export type OpenAiProviderSettings = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

export function hasOpenAiRuntimeCredentials() {
  return Boolean(readOpenAiApiKey(readOpenAiBaseURL()));
}

export function openAiProviderSettings(): OpenAiProviderSettings {
  const baseURL = readOpenAiBaseURL();
  const gatewayToken = readRuntimeEnv("CLOUDFLARE_AI_GATEWAY_TOKEN");
  const apiKey = readOpenAiApiKey(baseURL);
  const headers = cloudflareGatewayHeaders(baseURL, gatewayToken);

  return {
    apiKey,
    baseURL,
    headers: Object.keys(headers).length ? headers : undefined,
  };
}

function readOpenAiBaseURL() {
  return readRuntimeEnv("CLOUDFLARE_AI_GATEWAY_BASE_URL") ?? readRuntimeEnv("OPENAI_BASE_URL");
}

function readOpenAiApiKey(baseURL: string | undefined) {
  const gatewayToken = readRuntimeEnv("CLOUDFLARE_AI_GATEWAY_TOKEN");
  if (gatewayToken && baseURL && isCloudflareGatewayBaseUrl(baseURL)) return gatewayToken;
  return readRuntimeEnv("OPENAI_API_KEY");
}

function cloudflareGatewayHeaders(baseURL: string | undefined, gatewayToken: string | undefined) {
  const headers: Record<string, string> = {};
  if (!baseURL || !isCloudflareGatewayBaseUrl(baseURL)) return headers;

  if (gatewayToken) headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;

  const byokAlias = readRuntimeEnv("CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS");
  if (byokAlias) headers["cf-aig-byok-alias"] = byokAlias;

  return headers;
}

function isCloudflareGatewayBaseUrl(baseURL: string) {
  try {
    return new URL(baseURL).hostname === cloudflareGatewayHost;
  } catch {
    return false;
  }
}
