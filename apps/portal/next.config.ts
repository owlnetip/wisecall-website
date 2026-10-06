import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  experimental: {
    // Chat photos are up to 2 MB. The server-action default is 1 MB.
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
  turbopack: {
    root: appRoot,
  },
  // Allow loading the dev server over 127.0.0.1 (not just localhost) so HMR /
  // React-refresh can connect and the page actually hydrates.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
