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
      // 301s for renamed/removed slugs surfaced as 404s in Search Console.
      // Destinations chosen by the linking anchor's topical context.
      {
        source: "/best/transit",
        destination: "/guide/transit-guide",
        permanent: true,
      },
      {
        source: "/guide/parks-green-spaces",
        destination: "/guide/things-to-do",
        permanent: true,
      },
      {
        source: "/guide/neighbourhood-boundaries",
        destination: "/vs/ossington",
        permanent: true,
      },
      {
        source: "/guide/weather-seasons",
        destination: "/guide/winter-survival",
        permanent: true,
      },
      {
        source: "/blog/liberty-village-running-routes-martin-goodman-trail",
        destination: "/guide/fitness-guide",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
