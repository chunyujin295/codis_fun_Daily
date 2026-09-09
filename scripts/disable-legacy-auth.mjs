#!/usr/bin/env node

import { getDb } from '../lib/db.ts';

async function disableLegacyAuth() {
  const db = getDb();
  
  console.log('=== 关闭旧共享密码认证 ===');
  
  // 检查是否有活跃的智能体仍在使用旧认证
  const legacyUsage = db.prepare(`
    SELECT COUNT(*) as count
    FROM upload_audits
    WHERE result = 'SUCCESS'
      AND created_at > datetime('now', '-7 days')
      AND uploader_id_claim IS NULL
  `).get();
  
  console.log(`最近7天内使用旧认证的成功上传: ${legacyUsage.count} 次`);
  
  if (legacyUsage.count > 0) {
    console.log('警告: 仍有智能体在使用旧认证，建议先完成迁移。');
    console.log('继续关闭旧认证？(y/N)');
    
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const answer = await new Promise(resolve => {
      rl.question('> ', resolve);
    });
    
    rl.close();
    
    if (answer.toLowerCase() !== 'y') {
      console.log('已取消操作');
      return;
    }
  }
  
  // 检查是否有活跃的独立令牌
  const activeTokens = db.prepare(`
    SELECT COUNT(*) as count
    FROM upload_tokens
    WHERE enabled = 1
  `).get();
  
  console.log(`活跃的独立令牌数量: ${activeTokens.count}`);
  
  if (activeTokens.count === 0) {
    console.log('警告: 没有活跃的独立令牌，关闭旧认证将导致无法上传。');
    console.log('已取消操作');
    return;
  }
  
  // 更新设置
  db.prepare(`
    INSERT INTO settings(key, value, updated_at)
    VALUES ('allow_legacy_upload_password', 'false', ?)
    ON CONFLICT(key) DO UPDATE SET value = 'false', updated_at = ?
  `).run(new Date().toISOString(), new Date().toISOString());
  
  console.log('✓ 已关闭旧共享密码认证');
  console.log('  设置 ALLOW_LEGACY_UPLOAD_PASSWORD=false 已写入数据库');
  console.log('  重启服务后生效');
  
  // 显示当前状态
  console.log('\n当前认证状态:');
  console.log(`  独立令牌认证: 启用 (${activeTokens.count} 个活跃令牌)`);
  console.log('  旧共享密码认证: 已禁用');
  
  console.log('\n迁移完成！所有智能体应使用独立令牌进行认证。');
}

async function checkMigrationStatus() {
  const db = getDb();
  
  console.log('=== 检查迁移状态 ===');
  
  // 检查所有上传者
  const uploaders = db.prepare(`
    SELECT u.id, u.display_name, u.enabled,
      COUNT(t.id) as token_count,
      SUM(CASE WHEN t.enabled = 1 THEN 1 ELSE 0 END) as active_tokens
    FROM uploaders u
    LEFT JOIN upload_tokens t ON u.id = t.uploader_id
    GROUP BY u.id
    ORDER BY u.id
  `).all();
  
  console.log(`找到 ${uploaders.length} 个上传者:`);
  
  for (const uploader of uploaders) {
    const status = uploader.enabled ? '启用' : '禁用';
    const tokenStatus = uploader.active_tokens > 0 ? '✓' : '✗';
    console.log(`  ${uploader.id} (${uploader.display_name}) - ${status} - 令牌: ${tokenStatus} (${uploader.active_tokens}/${uploader.token_count})`);
  }
  
  // 检查最近7天的上传情况
  const recentUploads = db.prepare(`
    SELECT 
      uploader_id_claim,
      COUNT(*) as count,
      MAX(created_at) as last_upload
    FROM upload_audits
    WHERE created_at > datetime('now', '-7 days')
    GROUP BY uploader_id_claim
  `).all();
  
  console.log(`\n最近7天的上传情况:`);
  
  for (const upload of recentUploads) {
    const uploader = upload.uploader_id_claim || '旧认证';
    const lastUpload = new Date(upload.last_upload).toLocaleString('zh-CN');
    console.log(`  ${uploader}: ${upload.count} 次上传, 最后: ${lastUpload}`);
  }
  
  // 检查是否有使用旧认证的上传
  const legacyUploads = recentUploads.filter(u => !u.uploader_id_claim);
  if (legacyUploads.length > 0) {
    console.log('\n警告: 仍有智能体在使用旧认证:');
    legacyUploads.forEach(upload => {
      console.log(`  ${upload.count} 次上传, 最后: ${new Date(upload.last_upload).toLocaleString('zh-CN')}`);
    });
  } else {
    console.log('\n✓ 没有智能体在使用旧认证');
  }
}

// 命令行接口
const command = process.argv[2];

switch (command) {
  case 'disable':
    disableLegacyAuth().catch(console.error);
    break;
  case 'status':
    checkMigrationStatus().catch(console.error);
    break;
  default:
    console.log('用法:');
    console.log('  node disable-legacy-auth.mjs disable  - 关闭旧共享密码认证');
    console.log('  node disable-legacy-auth.mjs status   - 检查迁移状态');
}