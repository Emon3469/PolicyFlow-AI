import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required by the production Docker image (standalone server bundle).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
