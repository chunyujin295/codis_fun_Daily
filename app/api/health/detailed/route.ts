import { NextResponse } from 'next/server';

import { getDb, getDataRoot } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HealthCheck = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: {
      status: 'ok' | 'error';
      message?: string;
    };
    filesystem: {
      status: 'ok' | 'error';
      message?: string;
    };
    ttsQueue: {
      status: 'ok' | 'warning' | 'error';
      queued: number;
      failed: number;
      backlog: number;
      message?: string;
    };
    uploadAudit: {
      status: 'ok' | 'warning' | 'error';
      recentFailures: number;
      message?: string;
    };
  };
};

export async function GET() {
  const health: HealthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: 'ok' },
      filesystem: { status: 'ok' },
      ttsQueue: { status: 'ok', queued: 0, failed: 0, backlog: 0 },
      uploadAudit: { status: 'ok', recentFailures: 0 },
    },
  };

  // 数据库检查
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    
    // 检查TTS作业积压
    const ttsStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM tts_jobs
    `).get() as { total: number; queued: number; failed: number };
    
    health.checks.ttsQueue.queued = ttsStats.queued || 0;
    health.checks.ttsQueue.failed = ttsStats.failed || 0;
    health.checks.ttsQueue.backlog = ttsStats.queued || 0;
    
    // 检查最近上传失败情况
    const recentFailures = db.prepare(`
      SELECT COUNT(*) as count
      FROM upload_audits
      WHERE result = 'FAILED' 
        AND created_at > datetime('now', '-1 hour')
    `).get() as { count: number };
    
    health.checks.uploadAudit.recentFailures = recentFailures.count;
    
    // 评估健康状态
    if (health.checks.ttsQueue.failed > 10) {
      health.checks.ttsQueue.status = 'error';
      health.checks.ttsQueue.message = `TTS作业失败数量过多: ${health.checks.ttsQueue.failed}`;
      health.status = 'degraded';
    } else if (health.checks.ttsQueue.queued > 50) {
      health.checks.ttsQueue.status = 'warning';
      health.checks.ttsQueue.message = `TTS作业积压: ${health.checks.ttsQueue.queued}`;
      if (health.status === 'healthy') health.status = 'degraded';
    }
    
    if (health.checks.uploadAudit.recentFailures > 5) {
      health.checks.uploadAudit.status = 'warning';
      health.checks.uploadAudit.message = `最近上传失败过多: ${health.checks.uploadAudit.recentFailures}`;
      if (health.status === 'healthy') health.status = 'degraded';
    }
    
  } catch (error) {
    health.checks.database.status = 'error';
    health.checks.database.message = error instanceof Error ? error.message : '数据库连接失败';
    health.status = 'unhealthy';
  }

  // 文件系统检查
  try {
    const fs = await import('node:fs/promises');
    const dataRoot = getDataRoot();
    await fs.access(dataRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    health.checks.filesystem.status = 'error';
    health.checks.filesystem.message = error instanceof Error ? error.message : '文件系统访问失败';
    health.status = 'unhealthy';
  }

  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  
  return NextResponse.json(health, {
    status: statusCode,
    headers: { 'Cache-Control': 'no-store' },
  });
}