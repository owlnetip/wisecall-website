import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: appRoot,
  },
  // Allow loading the dev server over 127.0.0.1 (not just localhost) so HMR /
  // React-refresh can connect and the page actually hydrates.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
