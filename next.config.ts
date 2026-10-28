import type { NextConfig } from "next";
import { siteRedirects } from "./scripts/content/redirects.mjs";

const nextConfig: NextConfig = {
  trailingSlash: false,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  redirects: siteRedirects,
};

export default nextConfig;
