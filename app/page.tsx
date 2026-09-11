'use client';

import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

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
  { id: 'all', label: '全部', color: '#b65f42' },
  { id: 'technology', label: '科技新闻', color: '#52718a' },
  { id: 'medical', label: '医疗', color: '#a75d65' },
  { id: 'cryptography', label: '密码学', color: '#756a91' },
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
        color: '#52718a',
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
        color: '#a75d65',
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
        color: '#756a91',
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
        color: '#52718a',
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
        color: '#756a91',
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

function flattenTracks(days: TimelineDay[], activeCategory: string) {
  return days.flatMap((day) =>
    day.branches.flatMap((branch) =>
      activeCategory === 'all' || branch.category === activeCategory
        ? branch.articles.map((article) => ({
            ...article,
            id: `${day.date}-${branch.category}-${article.slug}`,
            date: day.date,
            dateLabel: day.label,
            category: branch.category,
            categoryLabel: branch.label,
            color: branch.color,
          }))
        : [],
    ),
  );
}

export default function Home() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState('all');
  const [timelineDays, setTimelineDays] = useState<TimelineDay[]>(initialDays);
  const [availableCategories, setAvailableCategories] =
    useState<CategoryOption[]>(initialCategories);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const lastWheelAt = useRef(0);
  const coverFlowStageRef = useRef<HTMLButtonElement | null>(null);
  const dragStartX = useRef<number | null>(null);
  const dragged = useRef(false);

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

  const visibleTracks = useMemo(
    () => flattenTracks(timelineDays, activeCategory),
    [activeCategory, timelineDays],
  );
  const activeIndex = Math.min(
    selectedTrackIndex,
    Math.max(visibleTracks.length - 1, 0),
  );
  const activeTrack = visibleTracks[activeIndex];

  useEffect(() => {
    const stage = coverFlowStageRef.current;
    if (!stage || visibleTracks.length === 0) return;

    function handleStageWheel(event: globalThis.WheelEvent) {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const movement = horizontal ? event.deltaX : event.deltaY;
      if (Math.abs(movement) < 2) return;

      const direction = movement > 0 ? 1 : -1;
      const atBoundary =
        (direction < 0 && activeIndex === 0) ||
        (direction > 0 && activeIndex === visibleTracks.length - 1);

      if (!horizontal && atBoundary) {
        lastWheelAt.current = 0;
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      if (now - lastWheelAt.current < 360) return;
      lastWheelAt.current = now;
      setSelectedTrackIndex((current) =>
        Math.max(0, Math.min(current + direction, visibleTracks.length - 1)),
      );
    }

    stage.addEventListener('wheel', handleStageWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleStageWheel);
  }, [activeIndex, visibleTracks.length]);

  function chooseTrack(index: number) {
    setSelectedTrackIndex(
      Math.max(0, Math.min(index, visibleTracks.length - 1)),
    );
  }

  function moveTrack(delta: number) {
    chooseTrack(activeIndex + delta);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTrack(1);
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTrack(-1);
    }
    if (event.key === 'Home') {
      event.preventDefault();
      chooseTrack(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      chooseTrack(visibleTracks.length - 1);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragStartX.current = event.clientX;
    dragged.current = false;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (dragStartX.current === null) return;
    const movement = event.clientX - dragStartX.current;
    setDragOffset(Math.max(-180, Math.min(180, movement)));
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (dragStartX.current === null) return;
    const movement = event.clientX - dragStartX.current;
    dragStartX.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDragging(false);
    setDragOffset(0);
    if (Math.abs(movement) < 42) return;
    dragged.current = true;
    moveTrack(movement > 0 ? -1 : 1);
  }

  function handleStageClick(event: MouseEvent<HTMLButtonElement>) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientX - bounds.left;
    if (position < bounds.width * 0.38) moveTrack(-1);
    if (position > bounds.width * 0.62) moveTrack(1);
    if (
      position >= bounds.width * 0.38 &&
      position <= bounds.width * 0.62 &&
      activeTrack
    ) {
      router.push(`/articles/${activeTrack.slug}`);
    }
  }

  function chooseCategory(categoryId: string) {
    setActiveCategory(categoryId);
    setSelectedTrackIndex(0);
  }

  const pageStyle = {
    '--active-color': activeTrack?.color ?? '#b65f42',
  } as CSSProperties;

  return (
    <main className="site-shell" style={pageStyle}>
      <a className="skip-link" href="#timeline">
        跳到文章
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
          <strong>Daily Knowledge</strong>
        </Link>

        <div className="header-actions">
          <ThemeToggle />
          <Link className="admin-link" href="/admin/login">
            <Settings2 aria-hidden="true" />
            管理
          </Link>
        </div>
      </header>

      <h1 className="sr-only">Daily Knowledge 每日更新</h1>

      <div className="filter-shell">
        <nav className="category-filter" aria-label="栏目筛选">
          {availableCategories.map((category) => {
            const active = activeCategory === category.id;
            return (
              <Button
                key={category.id}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => chooseCategory(category.id)}
                className="category-chip"
                style={{ '--chip-color': category.color } as CSSProperties}
              >
                <span className="chip-dot" aria-hidden="true" />
                {category.label}
              </Button>
            );
          })}
        </nav>
      </div>

      <section id="timeline" className="coverflow-section" aria-label="文章">
        {activeTrack ? (
          <>
            <button
              ref={coverFlowStageRef}
              type="button"
              className={`coverflow-stage ${isDragging ? 'is-dragging' : ''}`}
              style={
                {
                  '--drag-offset': `${dragOffset}px`,
                } as CSSProperties
              }
              onClick={handleStageClick}
              onKeyDown={handleKeyDown}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => {
                dragStartX.current = null;
                setIsDragging(false);
                setDragOffset(0);
              }}
              aria-label={`当前为第 ${activeIndex + 1} 篇：${activeTrack.title}。使用左右方向键切换。`}
            >
              <span className="coverflow-floor" aria-hidden="true" />
              {visibleTracks.map((track, index) => {
                const offset = index - activeIndex;
                const distance = Math.abs(offset);
                const side =
                  offset === 0
                    ? 'is-active'
                    : offset < 0
                      ? 'is-left'
                      : 'is-right';
                const hidden = distance > 3 ? 'is-hidden' : '';
                const visibleDistance = Math.min(distance, 4);
                return (
                  <span
                    className={`cover-card ${side} ${hidden}`}
                    key={track.id}
                    style={
                      {
                        '--distance': visibleDistance,
                        '--cover-color': track.color,
                        zIndex: visibleTracks.length - distance,
                      } as CSSProperties
                    }
                    aria-hidden={offset !== 0}
                  >
                    <span className="cover-paper">
                      <span className="cover-topline">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <span>{track.categoryLabel}</span>
                      </span>
                      <span className="cover-copy">
                        <strong>{track.title}</strong>
                        <span className="cover-summary">{track.summary}</span>
                      </span>
                      <span className="cover-rule" />
                      <span className="cover-bottomline">
                        <span>{track.date}</span>
                        <span>{track.uploader}</span>
                      </span>
                    </span>
                    <span className="cover-reflection" aria-hidden="true" />
                  </span>
                );
              })}
            </button>

            <div className="coverflow-controls" aria-label="切换文章">
              <button
                type="button"
                onClick={() => moveTrack(-1)}
                disabled={activeIndex === 0}
                aria-label="上一篇"
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <span
                className="kinetic-widget"
                key={activeTrack.id}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </span>
              <button
                type="button"
                onClick={() => moveTrack(1)}
                disabled={activeIndex === visibleTracks.length - 1}
                aria-label="下一篇"
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>

            <span className="sr-only" aria-live="polite">
              {activeTrack.title}
            </span>
          </>
        ) : (
          <div className="timeline-empty">
            <button type="button" onClick={() => chooseCategory('all')}>
              查看全部
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
