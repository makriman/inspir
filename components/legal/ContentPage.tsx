import { MarketingFooter, MarketingHeader } from "@/components/marketing/MarketingShell";

function isHeading(block: string) {
  if (block.length > 90) return false;
  if (block.includes("\n")) return false;
  return !/[.!?]$/.test(block);
}

export function ContentPage({
  title,
  blocks,
  images,
}: {
  title: string;
  blocks: readonly string[];
  images?: readonly string[];
}) {
  const filtered = blocks.filter((block) => block.trim() && block.trim() !== title);

  return (
    <main className="marketing-site">
      <MarketingHeader />
      <article className="content-page">
        <header className="content-page-header">
          <span>Public record</span>
          <h1>{title}</h1>
        </header>
        <div className="content-page-body">
          {filtered.map((block, index) => {
            const image = images?.[index % images.length];
            const showImage = images && index > 0 && index % 4 === 0 && image;
            return (
              <section
                key={`${block.slice(0, 24)}-${index}`}
                className={`content-page-block ${isHeading(block) ? "is-heading" : ""}`}
              >
                {showImage ? (
                  <img
                    src={image.startsWith("//") ? `https:${image}` : image}
                    alt=""
                    loading="lazy"
                  />
                ) : null}
                {isHeading(block) ? (
                  <h2>{block}</h2>
                ) : (
                  <p>{block}</p>
                )}
              </section>
            );
          })}
        </div>
      </article>
      <MarketingFooter />
    </main>
  );
}
