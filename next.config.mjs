/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  swcMinify: true,
  env: {
    NODE_ENV: process.env.NODE_ENV,
  },
  experimental: {
    instrumentationHook: false
  }
};

export default nextConfig; 