import type { Config } from "tailwindcss";

const tokenColor = (name: string) => `oklch(from var(--${name}) l c h / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: tokenColor("background"),
        foreground: tokenColor("foreground"),
        card: {
          DEFAULT: tokenColor("card"),
          foreground: tokenColor("card-foreground"),
        },
        popover: {
          DEFAULT: tokenColor("popover"),
          foreground: tokenColor("popover-foreground"),
        },
        primary: {
          DEFAULT: tokenColor("primary"),
          foreground: tokenColor("primary-foreground"),
        },
        secondary: {
          DEFAULT: tokenColor("secondary"),
          foreground: tokenColor("secondary-foreground"),
        },
        muted: {
          DEFAULT: tokenColor("muted"),
          foreground: tokenColor("muted-foreground"),
        },
        accent: {
          DEFAULT: tokenColor("accent"),
          foreground: tokenColor("accent-foreground"),
        },
        destructive: tokenColor("destructive"),
        border: tokenColor("border"),
        input: tokenColor("input"),
        ring: tokenColor("ring"),
        sidebar: {
          DEFAULT: tokenColor("sidebar"),
          foreground: tokenColor("sidebar-foreground"),
          primary: tokenColor("sidebar-primary"),
          "primary-foreground": tokenColor("sidebar-primary-foreground"),
          accent: tokenColor("sidebar-accent"),
          "accent-foreground": tokenColor("sidebar-accent-foreground"),
          border: tokenColor("sidebar-border"),
          ring: tokenColor("sidebar-ring"),
        },
      },
      fontFamily: {
        sans: ["var(--font-default)", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
};

export default config;
