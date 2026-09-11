'use client';

/* 文章总览：一次看全部时期的文章（按日期倒序），支持按栏目 + 具体日期筛选。
   数据来自 /api/v1/timeline（服务端最多返回 240 条，故这里是「最近 240 篇」的流式视图）。
   与首页共用 lib/timeline 的 buildTimeline / flattenDay，保证两处口径一致。 */

export const dynamic = 'force-dynamic';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LayoutList } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import {
  buildTimeline,
  flattenDay,
  type CategoryOption,
  type TimelineApiItem,
  type TimelineDay,
} from '@/lib/timeline';

const ALL = 'all';

export default function ArchivePage() {
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [category, setCategory] = useState(ALL);
  const [date, setDate] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch('/Daily/api/v1/timeline', { signal: controller.signal }).then(
        (response) =>
          response.ok ? response.json() : Promise.reject(new Error('timeline')),
      ),
      fetch('/Daily/api/v1/categories', { signal: controller.signal }).then(
        (response) =>
          response.ok
            ? response.json()
            : Promise.reject(new Error('categories')),
      ),
    ])
      .then(([timeline, categoryData]) => {
        setDays(buildTimeline(timeline.items as TimelineApiItem[]));
        setCategories(
          (
            categoryData.categories as Array<{
              slug: string;
              name: string;
              color: string;
            }>
          ).map((item) => ({
            id: item.slug,
            label: item.name,
            color: item.color,
          })),
        );
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const articles = useMemo(
    () =>
      days.flatMap((day) =>
        date === ALL || day.date === date ? flattenDay(day, category) : [],
      ),
    [category, date, days],
  );

  const filtered = category !== ALL || date !== ALL;

  return (
    <main className="archive-page">
      <header className="article-topbar">
        <Link className="back-link" href="/">
          <ArrowLeft aria-hidden="true" /> 返回首页
        </Link>
        <div className="article-topbar-actions">
          <span className="article-brand">Daily Paper</span>
          <ThemeToggle />
        </div>
      </header>

      <section className="archive-shell">
        <div className="archive-heading">
          <div>
            <h1>
              <LayoutList aria-hidden="true" />
              文章总览
            </h1>
            <p>按日期倒序排列，可按栏目与日期筛选。</p>
          </div>
          <span className="archive-count" aria-live="polite">
            {loading ? '加载中…' : `共 ${articles.length} 篇`}
          </span>
        </div>

        <div className="archive-filters">
          <label className="archive-field">
            <span>栏目</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value={ALL}>全部栏目</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="archive-field">
            <span>日期</span>
            <select
              value={date}
              onChange={(event) => setDate(event.target.value)}
            >
              <option value={ALL}>全部日期</option>
              {days.map((day) => (
                <option key={day.date} value={day.date}>
                  {day.date}
                </option>
              ))}
            </select>
          </label>
          {filtered ? (
            <button
              type="button"
              className="archive-reset"
              onClick={() => {
                setCategory(ALL);
                setDate(ALL);
              }}
            >
              清除筛选
            </button>
          ) : null}
        </div>

        {articles.length > 0 ? (
          <div className="archive-grid">
            {articles.map((article) => (
              <Link
                className="archive-card"
                key={article.id}
                href={`/articles/${article.slug}`}
                style={{ '--card-color': article.color } as CSSProperties}
              >
                <span className="archive-card-category">
                  {article.categoryLabel}
                </span>
                <strong>{article.title}</strong>
                <p>{article.summary}</p>
                <span className="archive-card-meta">
                  <span>{article.date}</span>
                  <span>{article.time}</span>
                  <span>{article.uploader}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="archive-empty">
            {loading
              ? '正在加载…'
              : failed
                ? '数据加载失败，请刷新重试。'
                : '没有符合条件的文章。'}
          </p>
        )}
      </section>
    </main>
  );
}
