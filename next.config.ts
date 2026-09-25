import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the postgres driver must stay server-side and unbundled
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
