import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Shared domain package is consumed as TypeScript source.
  transpilePackages: ['@agent-cafe/shared'],
  reactStrictMode: true,
  // `next build` writes a static site to out/; the café server serves it on its own port.
  output: 'export',
};

export default nextConfig;
