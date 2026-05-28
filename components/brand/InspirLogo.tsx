import Image from "next/image";

const logoSrc = "/inspir-logo-white.svg";

export function InspirLogo({
  variant = "white",
  className = "",
}: {
  variant?: "white" | "color";
  className?: string;
}) {
  return (
    <Image
      src={logoSrc}
      alt="inspir"
      width={128}
      height={72}
      className={className}
      data-variant={variant}
      priority
      unoptimized
    />
  );
}

export function InspirWordmark({ className = "" }: { className?: string }) {
  return <InspirLogo className={className} />;
}
