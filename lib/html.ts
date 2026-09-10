import { createHash, randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { promises as fs } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';

import {
  ARTICLE_MAX_IMAGE_BYTES,
  ARTICLE_MAX_IMAGES,
  BASE_PATH,
  IMAGE_MAX_BYTES,
} from '@/lib/constants';
import { sha256 } from '@/lib/crypto';
import { getDataRoot } from '@/lib/db';

export type StoredMedia = {
  hash: string;
  relativePath: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  sourceHost: string;
  position: number;
  dataUri?: string;
};

export type ProcessedHtml = {
  html: string;
  extractedText: string;
  sanitizedHash: string;
  media: StoredMedia[];
};

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

function isPublicAddress(address: string, family: number) {
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  if (family === 6) return !blockedAddresses.check(address, 'ipv6');
  return false;
}

async function resolvePublicHost(hostname: string) {
  if (isIP(hostname)) throw new Error('IMAGE_IP_LITERAL_BLOCKED');
  const addresses = await dns.lookup(hostname, {
    all: true,
    order: 'verbatim',
  });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicAddress(entry.address, entry.family))
  ) {
    throw new Error('IMAGE_DNS_NOT_PUBLIC');
  }
  return addresses[0];
}

async function downloadImage(
  urlValue: string,
  redirectCount = 0,
): Promise<Buffer> {
  const url = new URL(urlValue);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('IMAGE_PROTOCOL_NOT_SUPPORTED');
  }
  if (url.username || url.password || url.port !== '') {
    throw new Error('IMAGE_URL_NOT_ALLOWED');
  }
  if (redirectCount > 3) throw new Error('IMAGE_REDIRECT_LIMIT');

  const target = await resolvePublicHost(url.hostname);
  const isHttps = url.protocol === 'https:';
  const port = isHttps ? 443 : 80;
  const requestModule = isHttps ? httpsRequest : httpRequest;
  return new Promise<Buffer>((resolve, reject) => {
    const req = requestModule(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        servername: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg',
          'Accept-Encoding': 'identity',
          'User-Agent': 'DailyKnowledgeImageFetcher/1.0',
        },
        agent: false,
        lookup: ((
          _hostname: string,
          options: unknown,
          callback: (...args: unknown[]) => void,
        ) => {
          const wantsAll =
            typeof options === 'object' &&
            options !== null &&
            'all' in options &&
            Boolean((options as { all?: boolean }).all);
          if (wantsAll) {
            callback(null, [target]);
          } else {
            callback(null, target.address, target.family);
          }
        }) as never,
      },
      async (response) => {
        const remoteAddress = response.socket.remoteAddress;
        const remoteFamily = remoteAddress ? isIP(remoteAddress) : 0;
        if (
          !remoteAddress ||
          !remoteFamily ||
          !isPublicAddress(remoteAddress, remoteFamily)
        ) {
          response.resume();
          reject(new Error('IMAGE_PEER_NOT_PUBLIC'));
          return;
        }

        if (
          response.statusCode &&
          [301, 302, 303, 307, 308].includes(response.statusCode)
        ) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new Error('IMAGE_REDIRECT_INVALID'));
            return;
          }
          try {
            resolve(
              await downloadImage(
                new URL(location, url).toString(),
                redirectCount + 1,
              ),
            );
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error('IMAGE_HTTP_STATUS'));
          return;
        }
        const contentEncoding = response.headers['content-encoding'];
        if (contentEncoding && contentEncoding !== 'identity') {
          response.resume();
          reject(new Error('IMAGE_CONTENT_ENCODING'));
          return;
        }
        const declaredLength = Number(response.headers['content-length'] ?? 0);
        if (declaredLength > IMAGE_MAX_BYTES) {
          response.resume();
          reject(new Error('IMAGE_TOO_LARGE'));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        try {
          for await (const chunk of response) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buffer.length;
            if (total > IMAGE_MAX_BYTES) {
              response.destroy();
              reject(new Error('IMAGE_TOO_LARGE'));
              return;
            }
            chunks.push(buffer);
          }
          resolve(Buffer.concat(chunks));
        } catch (error) {
          reject(error);
        }
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error('IMAGE_FETCH_TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

async function storeImage(
  sourceUrl: string,
  position: number,
): Promise<StoredMedia> {
  const source = new URL(sourceUrl);
  const input = await downloadImage(sourceUrl);
  const image = sharp(input, {
    failOn: 'error',
    limitInputPixels: 25_000_000,
    animated: false,
  });
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > 8192 ||
    metadata.height > 8192 ||
    metadata.width * metadata.height > 25_000_000 ||
    metadata.format === 'svg' ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new Error('IMAGE_DIMENSIONS_OR_FORMAT');
  }

  const output = await image
    .rotate()
    .webp({ quality: 86, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const hash = sha256(output.data);
  const base64Data = output.data.toString('base64');
  const dataUri = `data:image/webp;base64,${base64Data}`;

  return {
    hash,
    relativePath: '',
    mimeType: 'image/webp',
    byteSize: output.data.length,
    width: output.info.width,
    height: output.info.height,
    sourceHost: source.hostname,
    position,
    dataUri,
  };
}

function extractReadableText(html: string) {
  const $ = load(html);
  $('pre, code, nav, footer, form, script, style, svg, canvas').remove();
  const parts: string[] = [];
  $('h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,th,td').each(
    (_index, element) => {
      const value = $(element).text().replace(/\s+/g, ' ').trim();
      if (value) parts.push(value);
    },
  );
  return parts.join('\n').normalize('NFC');
}

export async function processArticleHtml(
  rawHtml: string,
): Promise<ProcessedHtml> {
  const $ = load(rawHtml);
  $(
    'script,style,iframe,object,embed,form,meta,link,base,svg,canvas,picture,source,video,audio',
  ).remove();
  $('[style],[onload],[onclick],[onerror]').each((_index, element) => {
    $(element)
      .removeAttr('style')
      .removeAttr('onload')
      .removeAttr('onclick')
      .removeAttr('onerror');
  });

  const images = $('img').toArray();
  if (images.length > ARTICLE_MAX_IMAGES) throw new Error('TOO_MANY_IMAGES');
  const media: StoredMedia[] = [];
  let totalImageBytes = 0;

  for (let index = 0; index < images.length; index += 1) {
    const element = images[index];
    const source = $(element).attr('src')?.trim();
    if (!source) {
      $(element).remove();
      continue;
    }
    if (source.startsWith('data:')) continue;
    if (!source.startsWith('http')) throw new Error('IMAGE_HTTPS_REQUIRED');
    const stored = await storeImage(source, index);
    totalImageBytes += stored.byteSize;
    if (totalImageBytes > ARTICLE_MAX_IMAGE_BYTES) {
      throw new Error('ARTICLE_IMAGES_TOO_LARGE');
    }
    media.push(stored);
    $(element)
      .attr('src', stored.dataUri ?? source)
      .attr('width', String(stored.width))
      .attr('height', String(stored.height))
      .removeAttr('srcset');
  }

  const contentRoot = $('article').first().length
    ? $('article').first()
    : $('main').first().length
      ? $('main').first()
      : $('body');
  const candidate = contentRoot.html() ?? '';
  const html = sanitizeHtml(candidate, {
    allowedTags: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'strong',
      'em',
      'b',
      'i',
      's',
      'del',
      'mark',
      'small',
      'sub',
      'sup',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'figure',
      'figcaption',
      'img',
      'a',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      code: ['class'],
    },
    allowedSchemes: ['https', 'http', 'data'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => {
        const href = attributes.href ?? '';
        const safeHref =
          href.startsWith('https://') ||
          href.startsWith('http://') ||
          href.startsWith(`${BASE_PATH}/`)
            ? href
            : '#';
        return {
          tagName: 'a',
          attribs: {
            href: safeHref,
            rel: 'noopener noreferrer nofollow',
            ...((safeHref.startsWith('https://') || safeHref.startsWith('http://'))
              ? { target: '_blank' }
              : {}),
          },
        };
      },
      img: (_tagName, attributes) => ({
        tagName: 'img',
        attribs: {
          src: attributes.src ?? '',
          alt: attributes.alt ?? '',
          width: attributes.width ?? '',
          height: attributes.height ?? '',
          loading: 'lazy',
        },
      }),
    },
  });
  const extractedText = extractReadableText(html);
  if (!extractedText) throw new Error('NO_READABLE_TEXT');

  return {
    html,
    extractedText,
    sanitizedHash: createHash('sha256').update(html).digest('hex'),
    media,
  };
}
