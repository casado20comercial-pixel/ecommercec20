/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['mupdf'],
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
}

export default nextConfig
