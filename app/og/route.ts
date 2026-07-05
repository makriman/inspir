export const revalidate = 86400;

export async function GET(request: Request) {
  const assetUrl = new URL("/inspir-social-preview.png", request.url);
  const response = await fetch(assetUrl);
  if (!response.ok) return Response.redirect(assetUrl, 307);

  return new Response(response.body, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": response.headers.get("Content-Type") ?? "image/png",
    },
  });
}
