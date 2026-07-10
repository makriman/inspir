export const privateAuthCacheControl = "private, no-store, max-age=0, must-revalidate";

/**
 * Better Auth responses can contain session state and OAuth redirects. Clone the
 * response so cache headers can be replaced even when the upstream Headers
 * object is immutable, while retaining the body, status, and Set-Cookie values.
 */
export function withPrivateAuthCache(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", privateAuthCacheControl);
  headers.set("CDN-Cache-Control", "private, no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "private, no-store");
  headers.set("Expires", "0");
  headers.set("Pragma", "no-cache");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
