const links = [
  {
    href: "https://twitter.com/inspiruk",
    label: "X/Twitter",
    mark: "X",
  },
  {
    href: "https://www.facebook.com/inspir.uk",
    label: "Facebook",
    mark: "f",
  },
  {
    href: "https://instagram.com/inspir.uk",
    label: "Instagram",
    mark: "ig",
  },
  {
    href: "https://www.linkedin.com/company/inspiruk/",
    label: "LinkedIn",
    mark: "in",
  },
];

export function SocialLinks({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`social-links ${compact ? "is-compact" : ""} ${className}`}>
      {links.map(({ href, label, mark }) => (
        <a
          key={href}
          href={href}
          aria-label={label}
          title={label}
          target="_blank"
          rel="noreferrer"
          className="social-link"
        >
          <span aria-hidden="true">{mark}</span>
        </a>
      ))}
    </div>
  );
}
