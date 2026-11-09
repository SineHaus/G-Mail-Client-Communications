import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here shows live, per-user data, so we use classic dynamic rendering
  // (`export const dynamic = "force-dynamic"`) instead of Cache Components.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
