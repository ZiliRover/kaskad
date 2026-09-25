import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the postgres driver must stay server-side and unbundled
  serverExternalPackages: ["postgres"],
  // the dev badge would sit on top of the sidebar hints
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
