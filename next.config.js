/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: process.env.AXEIN_DESKTOP === '1' || process.env.AXEIN_DEPLOYMENT_MODE === 'saas' ? 'standalone' : undefined,
  experimental: {
    serverComponentsExternalPackages: ['pdfkit', 'fontkit'],
  },
};

module.exports = nextConfig;
