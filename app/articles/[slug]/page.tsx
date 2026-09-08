import { ArrowLeft, CalendarDays, Clock3, Leaf } from 'lucide-react';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { ReadAloudButton } from '@/components/audio-player-provider';
import { getArticleBySlug } from '@/lib/articles';

export const dynamic = 'force-dynamic';

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) notFound();
  const tags = JSON.parse(article.tagsJson) as string[];

  return (
    <main className="article-page">
      <header className="article-topbar">
        <Link href="/" className="back-link">
          <ArrowLeft /> 返回时间树
        </Link>
        <span className="article-brand">
          <Leaf /> Daily Knowledge
        </span>
      </header>

      <article className="article-reading-shell">
        <header className="article-heading">
          <span className="article-category" style={{ color: article.color }}>
            {article.categoryName}
          </span>
          <h1>{article.title}</h1>
          {article.summary ? <p>{article.summary}</p> : null}
          <div className="article-byline">
            <span>
              <CalendarDays /> {article.contentDate}
            </span>
            <span>
              <Clock3 />{' '}
              {new Date(article.generatedAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Shanghai',
              })}
            </span>
            <span>{article.uploaderId}</span>
            <span>版本 {article.version}</span>
          </div>
          <div className="article-actions">
            <ReadAloudButton
              articleId={article.id}
              title={article.title}
              status={article.audioStatus ?? 'UNAVAILABLE'}
            />
            <div className="article-tags" aria-label="文章标签">
              {tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </header>
        <div
          className="article-content"
          dangerouslySetInnerHTML={{ __html: article.html }}
        />
      </article>
    </main>
  );
}
