import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Allow an isolated verification build while the development server is open.
  distDir: process.env.CNC_BUILD_DIR || ".next",
  async rewrites() {
    const proxy = process.env.API_PROXY_URL?.replace(/\/+$/, "");
    return proxy ? [{ source: "/api/:path*", destination: `${proxy}/api/:path*` }] : [];
  },
};

export default nextConfig;
