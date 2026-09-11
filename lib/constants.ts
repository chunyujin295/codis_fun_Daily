export const BASE_PATH = '/Daily';
export const SITE_TIME_ZONE = 'Asia/Shanghai';
export const ADMIN_COOKIE_NAME =
  process.env.NODE_ENV === 'production'
    ? '__Secure-daily_admin_session'
    : 'daily_admin_session';

// 智能体上传的文章 HTML（含 base64 内嵌图片）大小上限。
// 2026-09-11 起从 2 MB 提升到 10 MB：站点将逐步扩充为通用文章站，不再限于每日早报。
// 改动时需同步 scripts/push-article.mjs、agent-kit/push-article.mjs 与 docs/、agent-kit/README.md 中的表述。
export const ARTICLE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ARTICLE_MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const ARTICLE_MAX_IMAGES = 20;
export const XFYUN_SEGMENT_MAX_BYTES = 7600;
// 智能体上传的朗读音频（MP3）大小上限。20MB 约等于 128kbps 下 20 分钟，足够日常口播。
// 注意：这些是**应用层**上限；前置 nginx 默认 client_max_body_size 只有 1 MiB，会先一步 413，
// 部署时需在 /Daily 上把 client_max_body_size 调到 ≥ 音频/HTML 上限（见 docs/部署文档.md）。
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;

// 元数据 summary 硬上限。首页卡片只会显示摘要的前几行，超长会在卡片里溢出，
// 因此限制在 100 字以内。改动时需同步 agent-kit/README.md、docs/ 下各提示词与模板。
export const SUMMARY_MAX_LENGTH = 100;

// 栏目 slug 的合法字符：小写字母/数字开头，其后可含小写字母、数字、连字符。
//
// 连字符**必须**写成 \-，这不是风格问题：HTML 的 pattern 属性现在按 RegExp 的 'v'
// 标志编译，v 模式下字符类里未转义的尾部 "-" 会让整个 pattern 编译失败；而按规范
// 编译失败的 pattern 会被浏览器**静默忽略**，客户端校验就完全失效了（本项目曾因此
// 让非法 slug 直接打到服务端，只返回一个无字段名的 INVALID_CATEGORY）。
//
// 客户端 pattern 属性与服务端 Zod 正则共用这一份，避免两边规则漂移。
export const CATEGORY_SLUG_PATTERN = '[a-z0-9][a-z0-9\\-]*';
