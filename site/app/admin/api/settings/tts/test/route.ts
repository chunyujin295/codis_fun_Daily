import { NextResponse, type NextRequest } from 'next/server';

import { auditAdmin, requireAdminRequest } from '@/lib/auth';
import { testXfyunProvider } from '@/lib/tts';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  try {
    const result = await testXfyunProvider();
    auditAdmin('TTS_CONFIG_TEST', 'tts-provider', 'xfyun-default', result);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /^[A-Z0-9_]+$/.test(message) ? message : 'XFYUN_TEST_FAILED';
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
