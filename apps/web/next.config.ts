import type { NextConfig } from 'next';
const nextConfig: NextConfig = { output: 'standalone', poweredByHeader: false, async rewrites() { return [{ source: '/api/v1/:path*', destination: (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001') + '/api/v1/:path*' }]; }, async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] }]; } };
export default nextConfig;
