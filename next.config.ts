import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the desktop build (scripts/build-desktop.mjs) ships a self-contained server
  ...(process.env.KASKAD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // the postgres driver must stay server-side and unbundled
  serverExternalPackages: ["postgres"],
  // the dev badge covers canvas controls; build errors still open the overlay
  devIndicators: false,
};

export default nextConfig;
