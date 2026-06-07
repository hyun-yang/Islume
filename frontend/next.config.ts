import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/matching/:path*",
        destination: "http://localhost:8001/:path*",
      },
      {
        source: "/api/orchestrator/:path*",
        destination: "http://localhost:8003/:path*",
      },
      {
        source: "/api/gateway/:path*",
        destination: "http://localhost:8002/:path*",
      },
      {
        source: "/api/wallet/:path*",
        destination: "http://localhost:8004/:path*",
      },
      {
        source: "/api/visit/:path*",
        destination: "http://localhost:8005/:path*",
      },
    ];
  },
};

export default nextConfig;
