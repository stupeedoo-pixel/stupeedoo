import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker image small (see Dockerfile).
  output: "standalone",
  // Allow importing ../shared/caption-templates.json (shared with the worker).
  outputFileTracingRoot: path.join(__dirname, ".."),
  experimental: { externalDir: true },
  serverExternalPackages: ["@prisma/client", "bcryptjs", "ioredis"],
  images: { unoptimized: true },
};

export default nextConfig;
