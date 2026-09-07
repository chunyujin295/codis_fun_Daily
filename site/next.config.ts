import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: '/Daily',
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3', 'sharp', 'ws'],
  outputFileTracingIncludes: {
    '/*': ['node_modules/better-sqlite3/**/*', 'node_modules/sharp/**/*'],
  },
  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';
    const contentSecurityPolicy = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "media-src 'self'",
      `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
