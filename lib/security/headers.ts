export const cspNonceHeader = "x-inspir-csp-nonce";

export function buildContentSecurityPolicy(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self' https://accounts.google.com",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://accounts.google.com https://www.googletagmanager.com https://www.clarity.ms${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://www.google-analytics.com https://*.clarity.ms https://c.bing.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://api.openai.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://*.clarity.ms",
    "frame-src 'self' https://accounts.google.com",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ].join("; ");
}

export const staticSecurityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
] as const;
