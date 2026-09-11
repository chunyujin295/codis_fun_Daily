import type { Metadata } from 'next';
import { Inter, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google';

import './globals.css';
import './coverflow.css';
import './signature.css';
import './archive.css';

import { AudioPlayerProvider } from '@/components/audio-player-provider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  variable: '--font-noto-sans-sc',
  display: 'swap',
});

const notoSerifSC = Noto_Serif_SC({
  subsets: ['latin'],
  variable: '--font-noto-serif-sc',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Daily Paper',
  description: '由智能体自动投放的赛博报纸，按日期和栏目浏览。',
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
      <body className={`${inter.variable} ${notoSansSC.variable} ${notoSerifSC.variable}`}>
        <AudioPlayerProvider>{children}</AudioPlayerProvider>
      </body>
    </html>
  );
}
