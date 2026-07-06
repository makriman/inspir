export const revalidate = 86400;

export async function GET(request: Request) {
  const previewUrl = new URL("/inspir-social-preview.png", request.url);
  const preview = await fetch(previewUrl, {
    headers: {
      accept: "image/png",
    },
  });

  if (!preview.ok || !preview.body) {
    return new Response("Social preview image unavailable", {
      status: 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "Content-Type": preview.headers.get("content-type") ?? "image/png",
  });
  const contentLength = preview.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(preview.body, {
    headers,
  });
}
