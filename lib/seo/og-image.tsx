export function createOgImageResponse() {
  return new Response(null, {
    status: 308,
    headers: {
      location: "/inspir-social-preview.png",
      "cache-control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
