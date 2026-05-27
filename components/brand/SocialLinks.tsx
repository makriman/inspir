const links = [
  { href: "https://twitter.com/inspiruk", label: "X/Twitter", mark: "X" },
  { href: "https://www.facebook.com/inspir.uk", label: "Facebook", mark: "f" },
  { href: "https://instagram.com/inspir.uk", label: "Instagram", mark: "ig" },
  { href: "https://www.linkedin.com/company/inspiruk/", label: "LinkedIn", mark: "in" },
];

export function SocialLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-4">
      {links.map(({ href, label, mark }) => (
        <a
          key={href}
          href={href}
          aria-label={label}
          target="_blank"
          rel="noreferrer"
          className={`grid place-items-center rounded-full border border-white/20 text-white transition hover:border-white/60 hover:bg-white/10 ${
            compact ? "h-8 w-8" : "h-10 w-10"
          }`}
        >
          <span className="text-xs font-black uppercase leading-none">{mark}</span>
        </a>
      ))}
    </div>
  );
}
