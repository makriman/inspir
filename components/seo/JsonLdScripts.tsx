import { localizeMarketingStructuredData, localizeMarketingStructuredDataForLanguage } from "@/lib/i18n/metadata";
import { serializeJsonLd } from "@/lib/seo/json-ld";
import type { SupportedLanguage } from "@/lib/content/languages";

type JsonLdScriptsProps = {
  items: ReadonlyArray<unknown>;
  path?: string;
  language?: SupportedLanguage;
  nonce?: string;
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

export async function JsonLdScripts({ items, path, language, nonce }: JsonLdScriptsProps) {
  const pathname = path ?? "/";
  const localizedItems = language
    ? await localizeMarketingStructuredDataForLanguage(items, language, pathname)
    : await localizeMarketingStructuredData(items, pathname);

  return localizedItems.map((entry) => (
    <script key={jsonLdKey(entry)} type="application/ld+json" nonce={nonce} suppressHydrationWarning>
      {serializeJsonLd(entry)}
    </script>
  ));
}
