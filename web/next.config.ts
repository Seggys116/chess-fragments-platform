import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',

  // Disable type checking during build (we'll handle it separately)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Disable ESLint during build
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Increase API body size limit to 1GiB for agent uploads
  experimental: {
    // @ts-expect-error - bodySizeLimit is valid but not in types yet
    bodySizeLimit: '1gb',
    // @ts-expect-error - middlewareClientMaxBodySize is valid but not in types yet
    middlewareClientMaxBodySize: '1gb',
  },
};

export default nextConfig;
