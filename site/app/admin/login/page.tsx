import { redirect } from 'next/navigation';

import { AdminLoginForm } from '@/components/admin-login-form';
import { getCurrentAdminSession, isAdminPasswordConfigured } from '@/lib/auth';
import { BASE_PATH } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (await getCurrentAdminSession()) redirect(`${BASE_PATH}/admin`);
  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <span className="admin-kicker">Daily Knowledge</span>
        <h1>管理后台</h1>
        <p>文章浏览、撤下、完整文件更新，以及栏目与朗读服务配置。</p>
        <AdminLoginForm configured={isAdminPasswordConfigured()} />
      </section>
    </main>
  );
}
