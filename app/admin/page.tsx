import { AdminDashboard } from '@/components/admin-dashboard';
import { getAdminArticles, getCategories, getOverview } from '@/lib/articles';
import { getAdminUploaders, requireAdminPage } from '@/lib/auth';
import { getTtsAdminConfig } from '@/lib/tts';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await requireAdminPage();
  return (
    <AdminDashboard
      csrfToken={session.csrfToken}
      overview={getOverview()}
      articles={getAdminArticles()}
      categories={getCategories()}
      uploaders={getAdminUploaders()}
      tts={getTtsAdminConfig()}
    />
  );
}
