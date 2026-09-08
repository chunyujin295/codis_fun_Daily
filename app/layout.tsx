import type { Metadata } from 'next';

import './globals.css';

import { AudioPlayerProvider } from '@/components/audio-player-provider';

export const metadata: Metadata = {
  title: 'Daily Knowledge · 每日知识年轮',
  description: '沿时间树浏览每日整理的科技、医疗与密码学文章。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>
        <AudioPlayerProvider>{children}</AudioPlayerProvider>
      </body>
    </html>
  );
}
