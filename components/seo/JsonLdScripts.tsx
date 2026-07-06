import { headers } from "next/headers";
import { localizeMarketingStructuredData } from "@/lib/i18n/metadata";
import { serializeJsonLd } from "@/lib/seo/json-ld";
import { cspNonceHeader } from "@/lib/security/headers";

type JsonLdScriptsProps = {
  items: ReadonlyArray<unknown>;
  path?: string;
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

export async function JsonLdScripts({ items, path, nonce }: JsonLdScriptsProps) {
  const pathname = path ?? "/";
  const scriptNonce = nonce ?? (await headers()).get(cspNonceHeader) ?? undefined;
  const localizedItems = await localizeMarketingStructuredData(items, pathname);

  return localizedItems.map((entry) => (
    <script key={jsonLdKey(entry)} type="application/ld+json" nonce={scriptNonce}>
      {serializeJsonLd(entry)}
    </script>
  ));
}
