import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminLoginForm } from '@/components/admin-login-form';
import { ThemeToggle } from '@/components/theme-toggle';
import { getCurrentAdminSession, isAdminPasswordConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (await getCurrentAdminSession()) redirect('/admin');
  return (
    <main className="admin-login-page">
      <div className="login-theme-toggle">
        <ThemeToggle />
      </div>
      <section className="admin-login-card">
        <span className="admin-kicker">Daily Knowledge</span>
        <h1>管理后台</h1>
        <p>文章浏览、删除、完整文件更新，以及栏目与朗读服务配置。</p>
        <AdminLoginForm configured={isAdminPasswordConfigured()} />
        <Link className="login-back-link" href="/">
          ← 返回主页
        </Link>
      </section>
    </main>
  );
}
