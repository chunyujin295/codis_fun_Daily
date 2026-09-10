import type { Metadata } from 'next';

import './globals.css';

import { AudioPlayerProvider } from '@/components/audio-player-provider';

export const metadata: Metadata = {
  title: 'Daily Knowledge · 每日知识年轮',
  description: '沿时间树浏览每日整理的科技、医疗与密码学文章。',
  icons: {
    icon: '/Daily/icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('daily-knowledge-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <AudioPlayerProvider>{children}</AudioPlayerProvider>
      </body>
    </html>
  );
}
