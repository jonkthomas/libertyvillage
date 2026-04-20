import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: false,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async redirects() {
    return [
      {
        source: "/guide/moving-guide",
        destination: "/blog/moving-to-liberty-village-2026-essential-guide",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
