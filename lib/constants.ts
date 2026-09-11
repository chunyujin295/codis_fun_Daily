export const BASE_PATH = '/Daily';
export const SITE_TIME_ZONE = 'Asia/Shanghai';
export const ADMIN_COOKIE_NAME =
  process.env.NODE_ENV === 'production'
    ? '__Secure-daily_admin_session'
    : 'daily_admin_session';

export const ARTICLE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ARTICLE_MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const ARTICLE_MAX_IMAGES = 20;
export const XFYUN_SEGMENT_MAX_BYTES = 7600;

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
