import { createOgImageResponse } from "@/lib/seo/og-image";

export const runtime = "edge";
export const revalidate = 86400;

export function GET(request: Request) {
  return createOgImageResponse(request);
}
