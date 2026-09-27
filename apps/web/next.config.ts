import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Shared domain package is consumed as TypeScript source.
  transpilePackages: ['@agent-cafe/shared'],
  reactStrictMode: true,
};

export default nextConfig;
