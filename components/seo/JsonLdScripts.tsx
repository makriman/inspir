import { localizeMarketingStructuredData } from "@/lib/i18n/metadata";
import { getRequestPathname } from "@/lib/i18n/request-locale";
import { serializeJsonLd } from "@/lib/seo/json-ld";

type JsonLdScriptsProps = {
  items: ReadonlyArray<unknown>;
  path?: string;
};

function jsonLdKey(entry: unknown) {
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const identity = record["@id"] ?? record.url ?? record.name ?? record["@type"];

    if (typeof identity === "string" && identity.length > 0) return identity;
    if (Array.isArray(identity)) return identity.join(":");
  }

  return serializeJsonLd(entry);
}

export async function JsonLdScripts({ items, path }: JsonLdScriptsProps) {
  const pathname = path ?? (await getRequestPathname());
  const localizedItems = await localizeMarketingStructuredData(items, pathname);

  return localizedItems.map((entry) => (
    <script key={jsonLdKey(entry)} type="application/ld+json">
      {serializeJsonLd(entry)}
    </script>
  ));
}
