'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import {
  Archive,
  BookOpen,
  KeyRound,
  LogOut,
  RefreshCw,
  Settings2,
  Upload,
  Volume2,
} from 'lucide-react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeToggle } from '@/components/theme-toggle';
import { BASE_PATH } from '@/lib/constants';

type AdminArticle = {
  id: string;
  slug: string;
  externalId: string;
  uploaderId: string;
  status: string;
  version: number;
  updatedAt: string;
  title: string;
  category: string;
  generatedAt: string;
  audioStatus: string;
};
type Category = {
  slug: string;
  name: string;
  color: string;
  sortOrder: number;
  enabled: number;
};
type AdminUploader = {
  id: string;
  displayName: string;
  enabled: number;
  updatedAt: string;
  tokens: {
    id: string;
    name: string;
    tokenPrefix: string;
    tokenSecret: string | null;
    enabled: number;
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    categories: string[];
  }[];
  articleCount: number;
};
type TtsConfig = {
  adapterType: string;
  endpoint: string;
  displayName: string;
  enabled: boolean;
  hasAppId: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  vcn: string;
  speed: number;
  volume: number;
  pitch: number;
  lastTestStatus: string | null;
  lastTestAt: string | null;
};

type ModelContext = {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
};

export function AdminDashboard({
  csrfToken,
  overview,
  articles: initialArticles,
  categories,
  uploaders,
  tts,
}: {
  csrfToken: string;
  overview: {
    articleCounts: { total: number; published: number; archived: number };
    ttsCounts: { total: number; ready: number; failed: number };
  };
  articles: AdminArticle[];
  categories: Category[];
  uploaders: AdminUploader[];
  tts: TtsConfig;
}) {
  const [articles, setArticles] = useState(initialArticles);
  const [message, setMessage] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(tts.enabled);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(() => {
    // 从 URL hash 中读取初始 tab
    const hash = window.location.hash.slice(1);
    const validTabs = [
      'articles',
      'upload',
      'categories',
      'agents',
      'settings',
    ];
    return validTabs.includes(hash) ? hash : 'articles';
  });

  // 当 tab 切换时，更新 URL hash
  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  const call = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('x-csrf-token', csrfToken);
      const response = await fetch(`${BASE_PATH}/admin/api${path}`, {
        ...init,
        headers,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        [key: string]: unknown;
      };
      if (!response.ok) throw new Error(body.error ?? '操作失败');
      return body;
    },
    [csrfToken],
  );

  const archiveArticle = useCallback(
    async (articleId: string) => {
      await call(`/articles/${articleId}/archive`, { method: 'POST' });
      setArticles((current) =>
        current.map((article) =>
          article.id === articleId
            ? { ...article, status: 'archived' }
            : article,
        ),
      );
      setMessage('文章已删除。');
      return { articleId, status: 'archived' };
    },
    [call],
  );

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'archive_article',
          title: '撤下文章',
          description:
            '撤下管理后台中指定 ID 的文章，并同步停止公开正文和音频。',
          inputSchema: {
            type: 'object',
            properties: { articleId: { type: 'string', minLength: 1 } },
            required: ['articleId'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            const articleId =
              typeof input === 'object' &&
              input !== null &&
              'articleId' in input
                ? String((input as { articleId: unknown }).articleId)
                : '';
            if (!articleId) throw new Error('articleId is required');
            return archiveArticle(articleId);
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, [archiveArticle]);

  async function uploadArticle(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('正在解析、转存图片并净化文章…');
    try {
      const form = new FormData(event.currentTarget);
      const generatedAt = form.get('generatedAt');
      if (typeof generatedAt === 'string' && generatedAt) {
        form.set('generatedAt', new Date(generatedAt).toISOString());
      }
      await call('/articles', { method: 'POST', body: form });
      setMessage('文章版本已发布，语音任务将在后台异步处理。');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传失败');
    }
  }

  async function saveCategory(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await call('/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: form.get('slug'),
          name: form.get('name'),
          color: form.get('color'),
          sortOrder: Number(form.get('sortOrder')),
          enabled: form.get('enabled') === 'on',
        }),
      });
      setMessage('栏目配置已保存。');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function createUploadToken(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiresAt = form.get('expiresAt');
    try {
      const result = await call('/uploaders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploaderId: form.get('uploaderId'),
          displayName: form.get('displayName'),
          tokenName: form.get('tokenName'),
          categories: form.getAll('categories'),
          expiresAt:
            typeof expiresAt === 'string' && expiresAt
              ? new Date(expiresAt).toISOString()
              : undefined,
        }),
      });
      const token = result.token as { token?: string } | undefined;
      if (!token?.token) throw new Error('服务器没有返回令牌');
      setIssuedToken(token.token);
      setMessage('令牌签发成功。请立即复制；3秒后刷新页面。');
      event.currentTarget.reset();
      // 3秒后刷新页面，更新列表并清空令牌显示
      setTimeout(() => {
        setIssuedToken(null);
        window.location.reload();
      }, 3000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '令牌签发失败');
    }
  }

  async function setTokenEnabled(tokenId: string, enabled: boolean) {
    try {
      await call(`/upload-tokens/${tokenId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setMessage(enabled ? '令牌已启用。' : '令牌已撤销。');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '令牌状态更新失败');
    }
  }

  async function revokeToken(tokenId: string) {
    try {
      await call(`/upload-tokens/${tokenId}`, { method: 'DELETE' });
      setMessage('令牌已永久撤销，原令牌不能恢复使用。');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '令牌撤销失败');
    }
  }

  async function rotateUploadPassword(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await call('/settings/upload-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.get('password') }),
      });
      event.currentTarget.reset();
      setMessage('共享上传密码已轮换，旧密码立即失效。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '轮换失败');
    }
  }

  async function saveTts(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (name: string) => {
      const raw = form.get(name);
      const value = typeof raw === 'string' ? raw.trim() : '';
      return value || undefined;
    };
    try {
      await call('/settings/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: ttsEnabled,
          displayName: form.get('displayName'),
          appId: optional('appId'),
          apiKey: optional('apiKey'),
          apiSecret: optional('apiSecret'),
          vcn: form.get('vcn'),
          speed: Number(form.get('speed')),
          volume: Number(form.get('volume')),
          pitch: Number(form.get('pitch')),
        }),
      });
      setMessage(
        '讯飞配置已加密保存。凭据或声音改变后会保持停用，需要测试成功后再次保存启用。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function testTts() {
    if (
      !window.confirm(
        '测试会使用固定短句发起一次真实讯飞合成，可能产生费用。继续吗？',
      )
    )
      return;
    setMessage('正在测试讯飞连接…');
    try {
      await call('/settings/tts/test', { method: 'POST' });
      setMessage('讯飞连接和默认发音人测试成功。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '测试失败');
    }
  }

  async function logout() {
    await call('/logout', { method: 'POST' });
    window.location.assign(`${BASE_PATH}/admin/login`);
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span>Daily Knowledge</span>
          <h1>管理后台</h1>
        </div>
        <div className="admin-header-actions">
          <ThemeToggle />
          <Link href="/">查看公开站点</Link>
          <Button variant="outline" onClick={logout}>
            <LogOut />
            退出
          </Button>
        </div>
      </header>

      {message ? (
        <output className="admin-message" aria-live="polite">
          {message}
        </output>
      ) : null}

      <section className="overview-grid" aria-label="站点概览">
        <div>
          <BookOpen />
          <span>文章</span>
          <strong>{overview.articleCounts.total ?? 0}</strong>
          <small>{overview.articleCounts.published ?? 0} 篇公开</small>
        </div>
        <div>
          <Archive />
          <span>已撤下</span>
          <strong>{overview.articleCounts.archived ?? 0}</strong>
          <small>不会被智能体更新恢复</small>
        </div>
        <div>
          <Volume2 />
          <span>语音</span>
          <strong>{overview.ttsCounts.ready ?? 0}</strong>
          <small>{overview.ttsCounts.failed ?? 0} 个失败任务</small>
        </div>
      </section>

      <Tabs
        defaultValue="articles"
        value={activeTab}
        onValueChange={setActiveTab}
        className="admin-tabs"
      >
        <TabsList variant="line" aria-label="后台功能">
          <TabsTrigger value="articles">文章</TabsTrigger>
          <TabsTrigger value="upload">上传更新</TabsTrigger>
          <TabsTrigger value="categories">栏目</TabsTrigger>
          <TabsTrigger value="agents">智能体</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="articles" className="admin-panel">
          <div className="panel-heading">
            <div>
              <h2>文章</h2>
              <p>只能浏览、撤下或上传完整新版本，不提供正文编辑器。</p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文章</TableHead>
                <TableHead>栏目</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>语音</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.map((article) => (
                <TableRow key={article.id}>
                  <TableCell>
                    <Link
                      className="admin-article-link"
                      href={`/articles/${article.slug}`}
                    >
                      {article.title}
                    </Link>
                    <small>
                      {article.uploaderId} · {article.externalId}
                    </small>
                  </TableCell>
                  <TableCell>{article.category}</TableCell>
                  <TableCell>v{article.version}</TableCell>
                  <TableCell>
                    <span className="status-pill">{article.audioStatus}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`status-pill status-${article.status}`}>
                      {article.status === 'published' ? '公开' : '已撤下'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {article.status === 'published' ? (
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={<Button variant="destructive" size="sm" />}
                        >
                          撤下
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>撤下这篇文章？</AlertDialogTitle>
                            <AlertDialogDescription>
                              正文和音频将立即对匿名读者返回
                              404，智能体后续更新不会自动恢复公开。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogCancel
                              variant="destructive"
                              onClick={() => void archiveArticle(article.id)}
                            >
                              确认撤下
                            </AlertDialogCancel>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <span className="muted-text">上传更新时可重新公开</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="upload" className="admin-panel">
          <div className="panel-heading">
            <div>
              <h2>上传完整版本</h2>
              <p>HTML 会重新经过图片转存、净化、正文提取和版本切换。</p>
            </div>
            <Upload />
          </div>
          <form className="admin-form admin-form-grid" onSubmit={uploadArticle}>
            <label htmlFor="upload-uploader">
              上传者 ID
              <Input
                id="upload-uploader"
                name="uploaderId"
                placeholder="tech-agent"
                required
              />
            </label>
            <label htmlFor="upload-external-id">
              外部文章 ID
              <Input
                id="upload-external-id"
                name="externalId"
                placeholder="daily-tech-2026-09-07"
                required
              />
            </label>
            <label htmlFor="upload-title" className="form-wide">
              标题
              <Input id="upload-title" name="title" required />
            </label>
            <label htmlFor="upload-category">
              栏目
              <select id="upload-category" name="category" required>
                {categories
                  .filter((item) => item.enabled)
                  .map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label htmlFor="upload-generated-at">
              生成时间
              <Input
                id="upload-generated-at"
                name="generatedAt"
                type="datetime-local"
                required
              />
            </label>
            <label htmlFor="upload-summary" className="form-wide">
              摘要
              <Input id="upload-summary" name="summary" maxLength={300} />
            </label>
            <label htmlFor="upload-tags" className="form-wide">
              标签
              <Input id="upload-tags" name="tags" placeholder="AI, 芯片" />
            </label>
            <label htmlFor="upload-file" className="form-wide">
              HTML 文件
              <Input
                id="upload-file"
                name="file"
                type="file"
                accept="text/html,.html"
                required
              />
            </label>
            <label htmlFor="upload-republish" className="checkbox-line">
              <input id="upload-republish" name="republish" type="checkbox" />
              如果文章已撤下，本次更新后重新公开
            </label>
            <Button type="submit" size="lg">
              <Upload />
              上传并处理
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="categories" className="admin-panel">
          <div className="panel-heading">
            <div>
              <h2>栏目</h2>
              <p>
                相同 slug 会更新现有栏目；已被文章引用的栏目不做破坏性删除。
              </p>
            </div>
          </div>
          <div className="category-admin-list">
            {categories.map((category) => (
              <span key={category.slug}>
                <i style={{ background: category.color }} />
                {category.name}
                <small>{category.slug}</small>
              </span>
            ))}
          </div>
          <form className="admin-form admin-form-grid" onSubmit={saveCategory}>
            <label htmlFor="category-slug">
              Slug
              <Input
                id="category-slug"
                name="slug"
                pattern="[a-z0-9][a-z0-9-]*"
                required
              />
            </label>
            <label htmlFor="category-name">
              显示名
              <Input id="category-name" name="name" required />
            </label>
            <label htmlFor="category-color">
              颜色
              <Input
                id="category-color"
                name="color"
                type="color"
                defaultValue="#73fbd3"
                required
              />
            </label>
            <label htmlFor="category-order">
              顺序
              <Input
                id="category-order"
                name="sortOrder"
                type="number"
                defaultValue="100"
                min="0"
                required
              />
            </label>
            <label htmlFor="category-enabled" className="checkbox-line">
              <input
                id="category-enabled"
                name="enabled"
                type="checkbox"
                defaultChecked
              />
              接受上传并公开展示
            </label>
            <Button type="submit">保存栏目</Button>
          </form>
        </TabsContent>

        <TabsContent value="agents" className="admin-panel">
          <div className="panel-heading">
            <div>
              <h2>智能体与上传令牌</h2>
              <p>每个令牌绑定固定上传者和栏目；令牌明文只显示一次。</p>
            </div>
            <KeyRound />
          </div>

          {issuedToken ? (
            <section className="admin-form">
              <label htmlFor="issued-upload-token">
                新令牌（请立即保存）
                <Input
                  id="issued-upload-token"
                  value={issuedToken}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <small>
                该值不会再次显示；请保存到智能体机器的 Secret 或环境变量中。
              </small>
            </section>
          ) : null}

          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>上传者</TableHead>
                  <TableHead>令牌</TableHead>
                  <TableHead>栏目</TableHead>
                  <TableHead>文章数</TableHead>
                  <TableHead>最近使用</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(uploaders ?? []).flatMap((uploader) =>
                  uploader.tokens.length
                    ? uploader.tokens.map((token) => (
                        <TableRow key={token.id}>
                          <TableCell>
                            <div>{uploader.displayName}</div>
                            {uploader.displayName !== uploader.id && (
                              <small
                                style={{ color: 'var(--muted-foreground)' }}
                              >
                                {uploader.id}
                              </small>
                            )}
                          </TableCell>
                          <TableCell>
                            <div>{token.name}</div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                margin: '0.25rem 0',
                              }}
                            >
                              <code
                                style={{
                                  userSelect: 'all',
                                  cursor: 'pointer',
                                  fontSize: '0.85em',
                                }}
                              >
                                {token.tokenPrefix}…
                              </code>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const fullToken = token.tokenSecret
                                    ? `dk_live_${token.id}.${token.tokenSecret}`
                                    : `dk_live_${token.id}`;
                                  navigator.clipboard.writeText(fullToken);
                                }}
                              >
                                复制
                              </Button>
                            </div>
                            <small style={{ color: 'var(--muted-foreground)' }}>
                              {token.expiresAt
                                ? `到期：${new Date(token.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
                                : '长期有效'}
                            </small>
                          </TableCell>
                          <TableCell>{token.categories.join('、')}</TableCell>
                          <TableCell>{uploader.articleCount}</TableCell>
                          <TableCell>
                            {token.lastUsedAt
                              ? new Date(token.lastUsedAt).toLocaleString(
                                  'zh-CN',
                                  {
                                    timeZone: 'Asia/Shanghai',
                                  },
                                )
                              : '尚未使用'}
                          </TableCell>
                          <TableCell>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <Button
                                type="button"
                                size="sm"
                                variant={
                                  token.enabled ? 'destructive' : 'outline'
                                }
                                onClick={() =>
                                  void setTokenEnabled(token.id, !token.enabled)
                                }
                              >
                                {token.enabled ? '停用' : '启用'}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger
                                  render={
                                    <Button variant="destructive" size="sm" />
                                  }
                                >
                                  撤销
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      永久撤销这个令牌？
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      撤销后不能恢复；持有原令牌的智能体将立即无法上传。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>取消</AlertDialogCancel>
                                    <AlertDialogCancel
                                      variant="destructive"
                                      onClick={() => void revokeToken(token.id)}
                                    >
                                      确认撤销
                                    </AlertDialogCancel>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    : [
                        <TableRow key={`${uploader.id}-empty`}>
                          <TableCell>
                            <div>{uploader.displayName}</div>
                            {uploader.displayName !== uploader.id && (
                              <small
                                style={{ color: 'var(--muted-foreground)' }}
                              >
                                {uploader.id}
                              </small>
                            )}
                          </TableCell>
                          <TableCell colSpan={5}>尚未签发独立令牌</TableCell>
                        </TableRow>,
                      ],
                )}
              </TableBody>
            </Table>
          </div>

          <form
            className="admin-form admin-form-grid"
            onSubmit={createUploadToken}
          >
            <label htmlFor="agent-uploader-id">
              上传者 ID
              <Input
                id="agent-uploader-id"
                name="uploaderId"
                pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
                placeholder="technology-agent"
                required
              />
            </label>
            <label htmlFor="agent-display-name">
              显示名
              <Input
                id="agent-display-name"
                name="displayName"
                placeholder="科技日报智能体"
                required
              />
            </label>
            <label htmlFor="agent-token-name">
              令牌名称
              <Input
                id="agent-token-name"
                name="tokenName"
                placeholder="主发布令牌"
                required
              />
            </label>
            <label htmlFor="agent-token-expiry">
              过期时间（可选）
              <Input
                id="agent-token-expiry"
                name="expiresAt"
                type="datetime-local"
              />
            </label>
            <fieldset className="form-wide">
              <legend>允许发布的栏目</legend>
              <div className="category-admin-list">
                {categories
                  .filter((category) => category.enabled)
                  .map((category) => (
                    <label key={category.slug} className="checkbox-line">
                      <input
                        name="categories"
                        type="checkbox"
                        value={category.slug}
                      />
                      {category.name}
                    </label>
                  ))}
              </div>
            </fieldset>
            <Button type="submit">签发独立令牌</Button>
          </form>
        </TabsContent>

        <TabsContent value="settings" className="admin-panel settings-grid">
          <section>
            <div className="panel-heading">
              <div>
                <h2>共享上传密码</h2>
                <p>轮换后所有智能体的旧密码立即失效。</p>
              </div>
              <KeyRound />
            </div>
            <form className="admin-form" onSubmit={rotateUploadPassword}>
              <label htmlFor="upload-password">
                新密码
                <Input
                  id="upload-password"
                  name="password"
                  type="password"
                  minLength={16}
                  required
                />
              </label>
              <Button type="submit">轮换密码</Button>
            </form>
          </section>
          <section>
            <div className="panel-heading">
              <div>
                <h2>科大讯飞朗读</h2>
                <p>{tts.endpoint} · 凭据留空表示保持原值。</p>
              </div>
              <Settings2 />
            </div>
            <form className="admin-form admin-form-grid" onSubmit={saveTts}>
              <label htmlFor="tts-enabled" className="form-wide switch-line">
                <Switch
                  id="tts-enabled"
                  checked={ttsEnabled}
                  onCheckedChange={setTtsEnabled}
                />
                启用自动生成
              </label>
              <label htmlFor="tts-display-name" className="form-wide">
                显示名
                <Input
                  id="tts-display-name"
                  name="displayName"
                  defaultValue={tts.displayName}
                  required
                />
              </label>
              <label htmlFor="tts-app-id">
                APPID <small>{tts.hasAppId ? '已保存' : '未配置'}</small>
                <Input
                  id="tts-app-id"
                  name="appId"
                  type="password"
                  autoComplete="off"
                />
              </label>
              <label htmlFor="tts-api-key">
                APIKey <small>{tts.hasApiKey ? '已保存' : '未配置'}</small>
                <Input
                  id="tts-api-key"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                />
              </label>
              <label htmlFor="tts-api-secret" className="form-wide">
                APISecret{' '}
                <small>{tts.hasApiSecret ? '已保存' : '未配置'}</small>
                <Input
                  id="tts-api-secret"
                  name="apiSecret"
                  type="password"
                  autoComplete="off"
                />
              </label>
              <label htmlFor="tts-vcn">
                发音人 vcn
                <Input
                  id="tts-vcn"
                  name="vcn"
                  defaultValue={tts.vcn}
                  required
                />
              </label>
              <label htmlFor="tts-speed">
                语速 0–100
                <Input
                  id="tts-speed"
                  name="speed"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={tts.speed}
                  required
                />
              </label>
              <label htmlFor="tts-volume">
                音量 0–100
                <Input
                  id="tts-volume"
                  name="volume"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={tts.volume}
                  required
                />
              </label>
              <label htmlFor="tts-pitch">
                音高 0–100
                <Input
                  id="tts-pitch"
                  name="pitch"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={tts.pitch}
                  required
                />
              </label>
              <div className="form-actions">
                <Button type="submit">加密保存</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void testTts()}
                >
                  <RefreshCw />
                  真实连接测试
                </Button>
              </div>
            </form>
          </section>
        </TabsContent>
      </Tabs>
    </main>
  );
}
