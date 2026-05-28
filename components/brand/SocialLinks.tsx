import Image from "next/image";

const links = [
  {
    href: "https://twitter.com/inspiruk",
    label: "X/Twitter",
    src: "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1694709492880x974141361661668400/square-x-twitter.svg",
  },
  {
    href: "https://www.facebook.com/inspir.uk",
    label: "Facebook",
    src: "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1694709816309x372598100040034400/square-facebook.svg",
  },
  {
    href: "https://instagram.com/inspir.uk",
    label: "Instagram",
    src: "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1694710121808x613355999373041900/square-instagram.svg",
  },
  {
    href: "https://www.linkedin.com/company/inspiruk/",
    label: "LinkedIn",
    src: "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1694713638432x340367580954421300/linkedin.svg",
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
    <div className={`bubble-social-links ${compact ? "bubble-social-links-compact" : ""} ${className}`}>
      {links.map(({ href, label, src }) => (
        <a
          key={href}
          href={href}
          aria-label={label}
          target="_blank"
          rel="noreferrer"
          className="bubble-social-link"
        >
          <Image src={src} alt="" width={36} height={38} unoptimized />
        </a>
      ))}
    </div>
  );
}
