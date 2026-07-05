const forwardedRequestHeaderNames = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cookie",
  "host",
  "pragma",
  "purpose",
  "referer",
  "rsc",
  "user-agent",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-nextjs-data",
]);

const forwardedRequestHeaderPrefixes = ["next-router-", "sec-fetch-"];

export function buildForwardedRequestHeaders(
  source: Headers,
  internalHeaders: Iterable<readonly [string, string]>,
) {
  const headers = new Headers();

  source.forEach((value, name) => {
    const normalizedName = name.toLowerCase();
    if (shouldForwardRequestHeader(normalizedName)) {
      headers.set(normalizedName, value);
    }
  });

  for (const [name, value] of internalHeaders) {
    headers.set(name, value);
  }

  return headers;
}

function shouldForwardRequestHeader(name: string) {
  if (forwardedRequestHeaderNames.has(name)) return true;
  return forwardedRequestHeaderPrefixes.some((prefix) => name.startsWith(prefix));
}
