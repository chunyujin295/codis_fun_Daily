/* 首页封面卡片与「文章总览」页共用的时间线数据模型 + 纯函数。
   数据来源：GET /api/v1/timeline（服务端按 content_date DESC 排序，最多 240 条）。

   注意：`buildTimeline` 只会为「确实有文章」的日期生成 TimelineDay，
   所以按 day 索引翻页天然就是「跳过没有文章的日期」。 */

export type CategoryOption = { id: string; label: string; color: string };

export type TimelineArticle = {
  slug: string;
  title: string;
  summary: string;
  time: string;
  uploader: string;
  tags: string[];
};

export type TimelineBranch = {
  category: string;
  label: string;
  color: string;
  side: 'left' | 'right';
  articles: TimelineArticle[];
};

export type TimelineDay = {
  date: string;
  label: string;
  kicker: string;
  branches: TimelineBranch[];
};

export type TimelineApiItem = {
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

/** 卡片流里的一条：文章本身 + 它所属的日期与栏目信息。 */
export type TimelineTrack = TimelineArticle & {
  id: string;
  date: string;
  dateLabel: string;
  category: string;
  categoryLabel: string;
  color: string;
};

const TIME_ZONE = 'Asia/Shanghai';

/** 「9.11 周五」——尽量短，日期控件里只占一小段。 */
export function formatDayLabel(contentDate: string) {
  const parts = contentDate.split('-');
  if (parts.length !== 3) return contentDate;
  const [, month, day] = parts;
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    weekday: 'short',
  }).format(new Date(`${contentDate}T00:00:00+08:00`));
  return `${Number(month)}.${Number(day)} ${weekday}`;
}

export function formatTime(generatedAt: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(generatedAt));
}

export function buildTimeline(items: TimelineApiItem[]): TimelineDay[] {
  const dayMap = new Map<string, TimelineDay>();
  for (const item of items) {
    let day = dayMap.get(item.contentDate);
    if (!day) {
      day = {
        date: item.contentDate,
        label: formatDayLabel(item.contentDate),
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
      time: formatTime(item.generatedAt),
      uploader: item.uploaderId,
      tags: item.tags,
    });
  }
  return [...dayMap.values()];
}

/** 把某一天按栏目筛选后拍平成卡片序列；day 为 undefined（没有文章）时返回空数组。 */
export function flattenDay(
  day: TimelineDay | undefined,
  activeCategory: string,
): TimelineTrack[] {
  if (!day) return [];
  return day.branches.flatMap((branch) =>
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
  );
}

/** 这一天在指定栏目下有多少篇文章（'all' 表示不限栏目）。仅供本模块的 dayHasCategory 使用。 */
function countDayArticles(day: TimelineDay, categoryId: string) {
  return day.branches.reduce(
    (total, branch) =>
      categoryId === 'all' || branch.category === categoryId
        ? total + branch.articles.length
        : total,
    0,
  );
}

/** 这一天在指定栏目下是否有文章。切栏目时用它避开「切过去也是空」的日期。 */
export function dayHasCategory(day: TimelineDay, categoryId: string) {
  return countDayArticles(day, categoryId) > 0;
}
