import {
  buildLanguageSitemapXml,
  languageFromSitemapFileSlug,
  sitemapFileSlugForLanguage,
  sitemapLanguages,
} from "@/lib/seo/sitemap";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return sitemapLanguages().map((language) => ({
    locale: `${sitemapFileSlugForLanguage(language)}.xml`,
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const language = languageFromSitemapFileSlug(locale);

  if (!language) {
    return new Response("Unknown sitemap language", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response(buildLanguageSitemapXml(language), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
