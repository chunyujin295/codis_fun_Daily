#!/usr/bin/env node

import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getDb, getDataRoot } from '../lib/db.ts';

const BACKUP_DIR = join(getDataRoot(), 'backups');
const MAX_BACKUPS = 7; // 保留最近7天的备份

async function createBackup() {
  const db = getDb();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const backupFile = join(BACKUP_DIR, `daily-knowledge-${timestamp}.db`);
  const tempFile = join(BACKUP_DIR, `daily-knowledge-${timestamp}.tmp`);

  try {
    // 确保备份目录存在
    await mkdir(BACKUP_DIR, { recursive: true });

    // 使用SQLite的备份API进行一致性备份
    console.log(`开始备份数据库到: ${backupFile}`);
    
    // 使用VACUUM INTO命令进行一致性备份
    db.exec(`VACUUM INTO '${backupFile}'`);
    
    // 验证备份文件
    const backupStat = await stat(backupFile);
    console.log(`备份完成，文件大小: ${backupStat.size} 字节`);

    // 创建备份元数据
    const metadata = {
      timestamp: now.toISOString(),
      filename: basename(backupFile),
      size: backupStat.size,
      version: db.pragma('user_version', { simple: true }),
    };
    
    await writeFile(
      join(BACKUP_DIR, `${basename(backupFile)}.meta.json`),
      JSON.stringify(metadata, null, 2)
    );

    // 清理旧备份
    await cleanupOldBackups();

    console.log('备份成功完成');
    return backupFile;
  } catch (error) {
    // 清理临时文件
    try {
      await stat(tempFile).then(() => import('node:fs/promises').then(fs => fs.unlink(tempFile))).catch(() => {});
    } catch {}
    
    console.error('备份失败:', error);
    throw error;
  }
}

async function cleanupOldBackups() {
  try {
    const fs = await import('node:fs/promises');
    const files = await fs.readdir(BACKUP_DIR);
    const backupFiles = files
      .filter(file => file.startsWith('daily-knowledge-') && file.endsWith('.db'))
      .sort()
      .reverse();

    // 保留最近的MAX_BACKUPS个备份
    if (backupFiles.length > MAX_BACKUPS) {
      const filesToDelete = backupFiles.slice(MAX_BACKUPS);
      for (const file of filesToDelete) {
        const filePath = join(BACKUP_DIR, file);
        const metaPath = `${filePath}.meta.json`;
        
        await fs.unlink(filePath).catch(() => {});
        await fs.unlink(metaPath).catch(() => {});
        
        console.log(`已删除旧备份: ${file}`);
      }
    }
  } catch (error) {
    console.error('清理旧备份时出错:', error);
  }
}

async function listBackups() {
  try {
    const fs = await import('node:fs/promises');
    await mkdir(BACKUP_DIR, { recursive: true });
    const files = await fs.readdir(BACKUP_DIR);
    const backups = files
      .filter(file => file.endsWith('.meta.json'))
      .map(async file => {
        const content = await fs.readFile(join(BACKUP_DIR, file), 'utf8');
        return JSON.parse(content);
      });

    const results = await Promise.all(backups);
    return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (error) {
    console.error('列出备份时出错:', error);
    return [];
  }
}

// 命令行接口
const command = process.argv[2];

switch (command) {
  case 'create':
    createBackup().catch(console.error);
    break;
  case 'list':
    listBackups().then(backups => {
      console.log('现有备份:');
      backups.forEach(backup => {
        console.log(`  ${backup.filename} - ${backup.timestamp} (${backup.size} bytes)`);
      });
    });
    break;
  default:
    console.log('用法:');
    console.log('  node backup.mjs create  - 创建新备份');
    console.log('  node backup.mjs list    - 列出所有备份');
}