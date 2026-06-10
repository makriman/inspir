import Image from "next/image";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";
import { breadcrumbJsonLd, webPageJsonLd } from "@/lib/seo/json-ld";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { legalEnglishControlsNotice } from "@/lib/i18n/site-source";

function isHeading(block: string) {
  if (block.length > 90) return false;
  if (block.includes("\n")) return false;
  return !/[.!?]$/.test(block);
}

function slugifyHeading(block: string, index: number) {
  const slug = block
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "section"}-${index}`;
}

export function ContentPage({
  title,
  blocks,
  description,
  eyebrow = "Public record",
  images,
  path,
  relatedLinks = [
    { href: "/mission", label: "Mission" },
    { href: "/schools", label: "Schools" },
    { href: "/blog", label: "Learning guides" },
  ],
}: {
  title: string;
  blocks: readonly string[];
  description?: string;
  eyebrow?: string;
  images?: readonly string[];
  path?: string;
  relatedLinks?: readonly { href: string; label: string }[];
}) {
  const filtered = blocks.filter((block) => block.trim() && block.trim() !== title);
  const blockCounts = new Map<string, number>();
  const entries = filtered.map((block, index) => ({
    block,
    id: isHeading(block) ? slugifyHeading(block, index) : undefined,
    isHeading: isHeading(block),
    key: (() => {
      const count = blockCounts.get(block) ?? 0;
      blockCounts.set(block, count + 1);
      return `${block.slice(0, 64)}-${count}`;
    })(),
  }));
  const headings = entries.filter((entry) => entry.isHeading).slice(0, 8);
  const showLegalNotice = path === "/terms" || path === "/privacy";
  const jsonLd =
    path && description
      ? [
          breadcrumbJsonLd([
            { name: "Home", url: "/" },
            { name: title, url: path },
          ]),
          webPageJsonLd({ path, name: title, description }),
        ]
      : [];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <article className="content-page">
        <header className="content-page-header">
          <span>{eyebrow}</span>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
          {showLegalNotice ? <p className="content-page-legal-notice">{legalEnglishControlsNotice}</p> : null}
        </header>
        <div className="content-page-layout">
          <aside className="content-page-rail" aria-label={`${title} page navigation`}>
            {headings.length > 0 ? (
              <nav className="content-page-index" aria-label={`${title} sections`}>
                <span>On this page</span>
                {headings.map((entry) => (
                  <a key={entry.id} href={`#${entry.id}`}>
                    {entry.block}
                  </a>
                ))}
              </nav>
            ) : null}
            <div className="content-page-related">
              <span>Explore next</span>
              {relatedLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </div>
          </aside>

          <div className="content-page-body">
            {entries.map((entry, index) => {
              const image = images?.[index % images.length];
              const showImage = images && index > 0 && index % 4 === 0 && image;
              return (
                <section
                  key={entry.key}
                  id={entry.id}
                  className={`content-page-block ${entry.isHeading ? "is-heading" : ""}`}
                >
                  {showImage ? (
                    <Image
                      src={image.startsWith("//") ? `https:${image}` : image}
                      alt=""
                      width={1200}
                      height={675}
                      loading="lazy"
                    />
                  ) : null}
                  {entry.isHeading ? <h2>{entry.block}</h2> : <p>{entry.block}</p>}
                </section>
              );
            })}
          </div>
        </div>
      </article>
      <MarketingFooter />
    </main>
  );
}
