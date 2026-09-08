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
