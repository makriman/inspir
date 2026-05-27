const whiteLogo =
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685530709490x148832961625310340/INSPIRE%20LOGO%20Vertical%20-%20White.svg";

const colorLogo =
  "https://5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/cdn-cgi/image/w=,h=,f=auto,dpr=1,fit=contain/f1690007829310x218356692826717300/INSPIRE%20LOGO%20Vertical%20-%20Color.png";

export function InspirLogo({
  variant = "white",
  className = "",
}: {
  variant?: "white" | "color";
  className?: string;
}) {
  return (
    <img
      src={variant === "white" ? whiteLogo : colorLogo}
      alt="inspir"
      className={className}
      loading="eager"
    />
  );
}

export function InspirWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black lowercase leading-none tracking-normal ${className}`}>inspir</span>
  );
}
