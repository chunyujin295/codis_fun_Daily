import { NextResponse, type NextRequest } from 'next/server';

import { auditAdmin, requireAdminRequest } from '@/lib/auth';
import { saveTtsConfig } from '@/lib/tts';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  try {
    const config = saveTtsConfig(await request.json());
    auditAdmin('TTS_CONFIG_UPDATE', 'tts-provider', 'xfyun-default', {
      enabled: config.enabled,
      vcn: config.vcn,
    });
    return NextResponse.json({ config });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TTS_CONFIG_FAILED';
    return NextResponse.json({ error: code }, { status: 422 });
  }
}
