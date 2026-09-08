import { describe, expect, it } from 'vitest';

import { processArticleHtml } from '@/lib/html';

describe('article HTML processing', () => {
  it('keeps semantic content while removing active content and inline styles', async () => {
    const result = await processArticleHtml(`
      <html>
        <head><style>body { display:none }</style></head>
        <body>
          <article>
            <h2 style="position:fixed">安全标题</h2>
            <p onclick="alert(1)">可朗读正文</p>
            <script>alert('xss')</script>
            <a href="javascript:alert(1)">危险链接</a>
          </article>
        </body>
      </html>
    `);
    expect(result.html).toContain('安全标题');
    expect(result.html).toContain('可朗读正文');
    expect(result.html).not.toMatch(
      /script|onclick|position:fixed|javascript:/i,
    );
    expect(result.extractedText).toContain('可朗读正文');
  });

  it('rejects non-https images before publication', async () => {
    await expect(
      processArticleHtml(
        '<article><p>正文</p><img src="http://example.com/a.png"></article>',
      ),
    ).rejects.toThrow('IMAGE_HTTPS_REQUIRED');
  });
});
