import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the postgres driver must stay server-side and unbundled
  serverExternalPackages: ["postgres"],
  // the dev badge covers canvas controls; build errors still open the overlay
  devIndicators: false,
};

export default nextConfig;
