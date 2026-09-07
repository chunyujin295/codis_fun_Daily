import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { ArticleError, submitArticle } from '@/lib/articles';
import { auditAdmin, requireAdminRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.html')) {
      return NextResponse.json(
        { error: '请选择 HTML 文件。' },
        { status: 422 },
      );
    }
    const stringField = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const input = {
      schemaVersion: '1',
      uploaderId: stringField('uploaderId'),
      externalId: stringField('externalId'),
      title: stringField('title'),
      summary: stringField('summary'),
      category: stringField('category'),
      generatedAt: stringField('generatedAt'),
      tags: stringField('tags')
        .split(/[,，]/)
        .map((value) => value.trim())
        .filter(Boolean),
      language: 'zh-CN',
      html: await file.text(),
    };
    const result = await submitArticle(input, `admin-${randomUUID()}`, {
      adminRepublish: form.get('republish') === 'on',
    });
    auditAdmin('ARTICLE_UPLOAD', 'article', result.article.id, {
      version: result.article.version,
      republished: form.get('republish') === 'on',
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof ArticleError ? error.code : 'UPLOAD_FAILED';
    const status = error instanceof ArticleError ? error.status : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
