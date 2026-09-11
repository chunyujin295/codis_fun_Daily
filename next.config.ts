import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  basePath: '/Daily',
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3', 'sharp', 'ws'],
  outputFileTracingIncludes: {
    '/*': ['node_modules/better-sqlite3/**/*', 'node_modules/sharp/**/*'],
  },
  outputFileTracingExcludes: {
    '/*': ['./data/**/*', './coverage/**/*', './docs/**/*', './tests/**/*'],
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

    /* 首页与「文章总览」是静态预渲染页，默认响应头是 s-maxage=31536000（一年）。
       而 `export const dynamic = 'force-dynamic'` 写在 'use client' 文件里并不生效
       （构建产物仍标为 ○ Static），于是部署新版后老访客会长期命中旧 HTML，
       连带引用旧 hash 的 CSS/JS —— 表现为"改了样式看不到"。
       这里显式下发 no-cache：浏览器仍可缓存，但每次使用前必须回源验证。
       注意必须独立成规则：挂到下面的 '/:path*' 上会把 /_next/static/** 的强缓存一起废掉。 */
    const noCacheHtml = {
      headers: [
        { key: 'Cache-Control', value: 'no-cache, must-revalidate' },
      ],
    };

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
      { source: '/', ...noCacheHtml },
      { source: '/archive', ...noCacheHtml },
    ];
  },
};

export default nextConfig;
