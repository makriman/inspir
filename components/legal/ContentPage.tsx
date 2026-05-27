import Link from "next/link";
import { InspirWordmark } from "@/components/brand/InspirLogo";

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
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 bg-[#050505] px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" aria-label="inspir home">
            <InspirWordmark className="text-3xl" />
          </Link>
          <nav className="flex items-center gap-5 text-sm font-bold text-white/80">
            <Link href="/tnc" className="hover:text-white">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link href="/mission" className="hover:text-white">
              Mission
            </Link>
          </nav>
        </div>
      </header>
      <article className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-8 text-4xl font-black tracking-normal md:text-6xl">{title}</h1>
        <div className="space-y-7 text-base font-semibold leading-8 text-white/86 md:text-lg">
          {filtered.map((block, index) => {
            const image = images?.[index % images.length];
            const showImage = images && index > 0 && index % 4 === 0 && image;
            return (
              <section key={`${block.slice(0, 24)}-${index}`} className="space-y-5">
                {showImage ? (
                  <img
                    src={image.startsWith("//") ? `https:${image}` : image}
                    alt=""
                    className="my-8 aspect-[16/9] w-full rounded-[8px] object-cover"
                  />
                ) : null}
                {isHeading(block) ? (
                  <h2 className="pt-2 text-2xl font-black text-white">{block}</h2>
                ) : (
                  <p className="whitespace-pre-line">{block}</p>
                )}
              </section>
            );
          })}
        </div>
      </article>
    </main>
  );
}
