#!/usr/bin/env node

import { readdir, stat, unlink, rmdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { getDb, getDataRoot } from '../lib/db.ts';

const STAGING_EXTENSIONS = ['.tmp', '.temp', '.partial', '.download'];
const MEDIA_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'];
const MAX_STAGING_AGE_HOURS = 24; // 24小时以上的临时文件
const MAX_ORPHAN_AGE_DAYS = 7; // 7天以上的孤儿媒体

async function cleanupStagingFiles() {
  const dataRoot = getDataRoot();
  let cleanedCount = 0;
  let freedBytes = 0;

  async function scanDirectory(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (STAGING_EXTENSIONS.includes(ext)) {
            try {
              const fileStat = await stat(fullPath);
              const ageHours = (Date.now() - fileStat.mtimeMs) / (1000 * 60 * 60);
              
              if (ageHours > MAX_STAGING_AGE_HOURS) {
                await unlink(fullPath);
                cleanedCount++;
                freedBytes += fileStat.size;
                console.log(`已删除临时文件: ${fullPath} (${ageHours.toFixed(1)} 小时前)`);
              }
            } catch (error) {
              console.error(`无法删除临时文件 ${fullPath}:`, error.message);
            }
          }
        }
      }
    } catch (error) {
      console.error(`扫描目录 ${dir} 时出错:`, error.message);
    }
  }

  console.log('开始清理临时文件...');
  await scanDirectory(dataRoot);
  
  console.log(`临时文件清理完成: 删除 ${cleanedCount} 个文件, 释放 ${freedBytes} 字节`);
  return { cleanedCount, freedBytes };
}

async function cleanupOrphanMedia() {
  const db = getDb();
  const dataRoot = getDataRoot();
  let cleanedCount = 0;
  let freedBytes = 0;

  // 查找孤儿媒体（在media_blobs中但没有被任何文章版本引用的媒体）
  const orphanMedia = db.prepare(`
    SELECT m.hash, m.relative_path, m.byte_size
    FROM media_blobs m
    LEFT JOIN article_version_media avm ON m.hash = avm.media_hash
    WHERE avm.media_hash IS NULL
      AND m.created_at < datetime('now', '-${MAX_ORPHAN_AGE_DAYS} days')
  `).all();

  console.log(`找到 ${orphanMedia.length} 个孤儿媒体文件`);

  for (const media of orphanMedia) {
    try {
      const mediaPath = join(dataRoot, media.relative_path);
      await unlink(mediaPath);
      
      // 从数据库中删除记录
      db.prepare('DELETE FROM media_blobs WHERE hash = ?').run(media.hash);
      
      cleanedCount++;
      freedBytes += media.byte_size;
      console.log(`已删除孤儿媒体: ${media.relative_path} (${media.byte_size} 字节)`);
    } catch (error) {
      console.error(`无法删除孤儿媒体 ${media.relative_path}:`, error.message);
    }
  }

  // 清理空的媒体目录
  await cleanupEmptyMediaDirectories(dataRoot);
  
  console.log(`孤儿媒体清理完成: 删除 ${cleanedCount} 个文件, 释放 ${freedBytes} 字节`);
  return { cleanedCount, freedBytes };
}

async function cleanupEmptyMediaDirectories(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = join(dir, entry.name);
        await cleanupEmptyMediaDirectories(fullPath);
        
        // 检查目录是否为空
        const subEntries = await readdir(fullPath);
        if (subEntries.length === 0 && entry.name !== 'backups') {
          await rmdir(fullPath);
          console.log(`已删除空目录: ${fullPath}`);
        }
      }
    }
  } catch (error) {
    // 忽略权限错误
  }
}

async function cleanupFailedJobs() {
  const db = getDb();
  
  // 清理超过7天的失败TTS作业
  const result = db.prepare(`
    DELETE FROM tts_jobs 
    WHERE status = 'FAILED' 
      AND created_at < datetime('now', '-7 days')
  `).run();
  
  console.log(`已清理 ${result.changes} 个过期的失败TTS作业`);
  return result.changes;
}

async function cleanupExpiredIdempotencyRecords() {
  const db = getDb();
  
  // 清理超过30天的幂等性记录
  const result = db.prepare(`
    DELETE FROM idempotency_records 
    WHERE created_at < datetime('now', '-30 days')
  `).run();
  
  console.log(`已清理 ${result.changes} 个过期的幂等性记录`);
  return result.changes;
}

async function runFullCleanup() {
  console.log('=== 开始全面清理 ===');
  
  const startTime = Date.now();
  
  const stagingResult = await cleanupStagingFiles();
  const orphanResult = await cleanupOrphanMedia();
  const failedJobsCount = await cleanupFailedJobs();
  const idempotencyCount = await cleanupExpiredIdempotencyRecords();
  
  const totalTime = Date.now() - startTime;
  
  console.log('\n=== 清理完成 ===');
  console.log(`总耗时: ${totalTime}ms`);
  console.log(`临时文件: 删除 ${stagingResult.cleanedCount} 个, 释放 ${stagingResult.freedBytes} 字节`);
  console.log(`孤儿媒体: 删除 ${orphanResult.cleanedCount} 个, 释放 ${orphanResult.freedBytes} 字节`);
  console.log(`失败作业: 清理 ${failedJobsCount} 个`);
  console.log(`幂等记录: 清理 ${idempotencyCount} 个`);
  
  return {
    staging: stagingResult,
    orphanMedia: orphanResult,
    failedJobs: failedJobsCount,
    idempotencyRecords: idempotencyCount,
    totalTime,
  };
}

// 命令行接口
const command = process.argv[2];

switch (command) {
  case 'staging':
    cleanupStagingFiles().catch(console.error);
    break;
  case 'media':
    cleanupOrphanMedia().catch(console.error);
    break;
  case 'jobs':
    cleanupFailedJobs().catch(console.error);
    break;
  case 'idempotency':
    cleanupExpiredIdempotencyRecords().catch(console.error);
    break;
  case 'all':
    runFullCleanup().catch(console.error);
    break;
  default:
    console.log('用法:');
    console.log('  node cleanup.mjs staging     - 清理临时文件');
    console.log('  node cleanup.mjs media       - 清理孤儿媒体');
    console.log('  node cleanup.mjs jobs        - 清理失败的TTS作业');
    console.log('  node cleanup.mjs idempotency - 清理过期的幂等性记录');
    console.log('  node cleanup.mjs all         - 执行全面清理');
}