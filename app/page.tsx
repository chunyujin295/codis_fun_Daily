'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Settings2,
  Volume2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

type CategoryOption = { id: string; label: string; color: string };
type TimelineArticle = {
  slug: string;
  title: string;
  summary: string;
  time: string;
  uploader: string;
  tags: string[];
};
type TimelineBranch = {
  category: string;
  label: string;
  color: string;
  side: 'left' | 'right';
  articles: TimelineArticle[];
};
type TimelineDay = {
  date: string;
  label: string;
  kicker: string;
  branches: TimelineBranch[];
};

const initialCategories: CategoryOption[] = [
  { id: 'all', label: '全部', color: '#d9f99d' },
  { id: 'technology', label: '科技新闻', color: '#73fbd3' },
  { id: 'medical', label: '医疗', color: '#ff9db0' },
  { id: 'cryptography', label: '密码学', color: '#a78bfa' },
];

const initialDays: TimelineDay[] = [
  {
    date: '2026-09-07',
    label: '9 月 7 日 · 星期一',
    kicker: '今天',
    branches: [
      {
        category: 'technology',
        label: '科技新闻',
        color: '#73fbd3',
        side: 'left',
        articles: [
          {
            slug: 'edge-agents-collaboration',
            title: '端侧智能体迎来新的协作范式',
            summary:
              '从任务编排到设备间上下文交接，今天值得关注的五项技术进展。',
            time: '09:10',
            uploader: 'Tech Lobster',
            tags: ['AI', '端侧计算'],
          },
        ],
      },
      {
        category: 'medical',
        label: '医疗',
        color: '#ff9db0',
        side: 'right',
        articles: [
          {
            slug: 'screening-biomarkers',
            title: '早筛生物标志物研究进展速览',
            summary: '聚焦新发表队列研究的证据强度、适用人群与仍待验证的边界。',
            time: '08:42',
            uploader: 'Med Agent',
            tags: ['循证医学', '早筛'],
          },
        ],
      },
      {
        category: 'cryptography',
        label: '密码学',
        color: '#a78bfa',
        side: 'left',
        articles: [
          {
            slug: 'post-quantum-migration',
            title: '后量子密码迁移：本周行动清单',
            summary:
              '梳理资产盘点、混合证书链与密钥生命周期中最容易被忽略的环节。',
            time: '07:55',
            uploader: 'Cipher Agent',
            tags: ['PQC', '工程实践'],
          },
        ],
      },
    ],
  },
  {
    date: '2026-09-06',
    label: '9 月 6 日 · 星期日',
    kicker: '昨天',
    branches: [
      {
        category: 'technology',
        label: '科技新闻',
        color: '#73fbd3',
        side: 'right',
        articles: [
          {
            slug: 'open-model-inference',
            title: '开放模型推理成本继续下探',
            summary: '一份面向实际部署的吞吐、延迟与显存取舍记录。',
            time: '18:20',
            uploader: 'Tech Lobster',
            tags: ['推理', '开源'],
          },
        ],
      },
      {
        category: 'cryptography',
        label: '密码学',
        color: '#a78bfa',
        side: 'left',
        articles: [
          {
            slug: 'passkeys-deployment-notes',
            title: 'Passkey 部署中的恢复路径设计',
            summary: '安全性并不只在登录瞬间，恢复与迁移同样需要被建模。',
            time: '11:05',
            uploader: 'Cipher Agent',
            tags: ['Passkey', '身份'],
          },
        ],
      },
    ],
  },
];

type TimelineApiItem = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  categoryName: string;
  color: string;
  generatedAt: string;
  contentDate: string;
  uploaderId: string;
  tags: string[];
};

function buildTimeline(items: TimelineApiItem[]) {
  const dayMap = new Map<string, TimelineDay>();
  for (const item of items) {
    let day = dayMap.get(item.contentDate);
    if (!day) {
      const date = new Date(`${item.contentDate}T00:00:00+08:00`);
      day = {
        date: item.contentDate,
        label: new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        }).format(date),
        kicker: dayMap.size === 0 ? '最新' : '往日',
        branches: [],
      };
      dayMap.set(item.contentDate, day);
    }
    let branch = day.branches.find((entry) => entry.category === item.category);
    if (!branch) {
      branch = {
        category: item.category,
        label: item.categoryName,
        color: item.color,
        side: day.branches.length % 2 === 0 ? 'left' : 'right',
        articles: [],
      };
      day.branches.push(branch);
    }
    branch.articles.push({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      time: new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(item.generatedAt)),
      uploader: item.uploaderId,
      tags: item.tags,
    });
  }
  return [...dayMap.values()];
}

export default function Home() {
  const [activeCategory, setActiveCategory] = useState('all');
  const [timelineDays, setTimelineDays] = useState<TimelineDay[]>(initialDays);
  const [availableCategories, setAvailableCategories] =
    useState<CategoryOption[]>(initialCategories);

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
        const built = buildTimeline(timeline.items as TimelineApiItem[]);
        if (built.length > 0) setTimelineDays(built);
        setAvailableCategories([
          initialCategories[0],
          ...(
            categoryData.categories as Array<{
              slug: string;
              name: string;
              color: string;
            }>
          ).map((category) => ({
            id: category.slug,
            label: category.name,
            color: category.color,
          })),
        ]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const visibleDays = useMemo(
    () =>
      timelineDays
        .map((day) => ({
          ...day,
          branches: day.branches.filter(
            (branch) =>
              activeCategory === 'all' || branch.category === activeCategory,
          ),
        }))
        .filter((day) => day.branches.length > 0),
    [activeCategory, timelineDays],
  );

  return (
    <main className="site-shell">
      <a className="skip-link" href="#timeline">
        跳到文章列表
      </a>

      <header className="site-header">
        <Link className="brand" href="/" aria-label="Daily Knowledge 首页">
          <Image
            className="brand-mark"
            src="/Daily/icon.png"
            alt=""
            width={18}
            height={18}
          />
          <span>
            <strong>Daily Knowledge</strong>
            <small>知识索引</small>
          </span>
        </Link>

        <div className="header-status" aria-label="站点状态">
          <span className="status-dot" />
          {timelineDays[0]?.branches.length ?? 0} 个栏目已更新
        </div>

        <div className="header-actions">
          <ThemeToggle />
          <Link className="admin-link" href="/admin/login">
            <Settings2 aria-hidden="true" />
            管理
          </Link>
        </div>
      </header>

      <section className="timeline-intro" aria-labelledby="timeline-title">
        <div>
          <p className="eyebrow">{timelineDays[0]?.date ?? '每日更新'}</p>
          <h1 id="timeline-title">每日更新</h1>
        </div>
        <p className="intro-copy">按日期浏览文章，也可以选择栏目筛选。</p>
      </section>

      <nav className="category-filter" aria-label="栏目筛选">
        {availableCategories.map((category) => {
          const active = activeCategory === category.id;
          return (
            <Button
              key={category.id}
              type="button"
              variant={active ? 'default' : 'outline'}
              aria-pressed={active}
              onClick={() => setActiveCategory(category.id)}
              className="category-chip"
              style={{ '--chip-color': category.color } as CSSProperties}
            >
              <span className="chip-dot" aria-hidden="true" />
              {category.label}
            </Button>
          );
        })}
        <span className="filter-date">
          <CalendarDays size={16} aria-hidden="true" />
          北京时间
        </span>
      </nav>

      <ol id="timeline" className="timeline-tree" aria-label="文章时间线">
        {visibleDays.map((day) => (
          <li key={day.date} className="timeline-day">
            <div className="date-node">
              <span>{day.kicker}</span>
              <time dateTime={day.date}>{day.label}</time>
              <small>
                {day.branches.reduce(
                  (count, branch) => count + branch.articles.length,
                  0,
                )}{' '}
                篇
              </small>
            </div>

            <div className="branch-list">
              {day.branches.map((branch) => (
                <section
                  key={`${day.date}-${branch.category}`}
                  className={`timeline-branch branch-${branch.side}`}
                  style={{ '--branch-color': branch.color } as CSSProperties}
                  aria-labelledby={`${day.date}-${branch.category}`}
                >
                  <h2 id={`${day.date}-${branch.category}`}>
                    <span aria-hidden="true" />
                    {branch.label}
                  </h2>
                  {branch.articles.map((article) => (
                    <article className="article-leaf" key={article.slug}>
                      <div className="leaf-meta">
                        <span>
                          <Clock3 size={14} aria-hidden="true" />
                          {article.time}
                        </span>
                        <span>{article.uploader}</span>
                      </div>
                      <h3>{article.title}</h3>
                      <p>{article.summary}</p>
                      <div className="leaf-footer">
                        <div className="tag-list" aria-label="文章标签">
                          {article.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                        <Link
                          className="read-link"
                          href={`/articles/${article.slug}`}
                        >
                          查看
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      </div>
                      <div className="audio-hint" aria-label="朗读状态：生成中">
                        <Volume2 size={15} aria-hidden="true" />
                        音频生成中
                      </div>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <footer className="site-footer">
        <span>已显示全部文章</span>
      </footer>
    </main>
  );
}
