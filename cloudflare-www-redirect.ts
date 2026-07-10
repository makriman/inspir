export function canonicalWwwRedirect(request: Request) {
  const destination = new URL(request.url);
  destination.protocol = "https:";
  destination.hostname = "inspirlearning.com";
  destination.port = "";

  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      Location: destination.toString(),
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "X-Inspir-Delivery": "www-redirect-worker",
    },
  });
}

export default {
  fetch(request) {
    return canonicalWwwRedirect(request);
  },
} satisfies ExportedHandler;
