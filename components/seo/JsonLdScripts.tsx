import { serializeJsonLd } from "@/lib/seo/json-ld";

type JsonLdScriptsProps = {
  items: ReadonlyArray<unknown>;
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

export function JsonLdScripts({ items }: JsonLdScriptsProps) {
  return items.map((entry) => (
    <script key={jsonLdKey(entry)} type="application/ld+json">
      {serializeJsonLd(entry)}
    </script>
  ));
}
