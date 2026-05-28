import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
