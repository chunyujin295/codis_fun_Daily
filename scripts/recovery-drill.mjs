#!/usr/bin/env node

import { readdir, stat, copyFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getDb, getDataRoot } from '../lib/db.ts';

const BACKUP_DIR = join(getDataRoot(), 'backups');
const RESTORE_DIR = join(getDataRoot(), 'restore-test');

async function listBackups() {
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    const files = await readdir(BACKUP_DIR);
    const backupFiles = files
      .filter(file => file.endsWith('.db') && !file.endsWith('.tmp'))
      .sort()
      .reverse();

    return backupFiles;
  } catch (error) {
    console.error('列出备份时出错:', error);
    return [];
  }
}

async function testBackupIntegrity(backupFile) {
  const backupPath = join(BACKUP_DIR, backupFile);
  
  try {
    console.log(`测试备份完整性: ${backupFile}`);
    
    // 创建测试目录
    await mkdir(RESTORE_DIR, { recursive: true });
    
    // 复制备份文件到测试目录
    const testDbPath = join(RESTORE_DIR, `test-${backupFile}`);
    await copyFile(backupPath, testDbPath);
    
    // 使用SQLite工具检查数据库完整性
    const { execSync } = await import('node:child_process');
    
    try {
      // 检查数据库完整性
      execSync(`sqlite3 "${testDbPath}" "PRAGMA integrity_check;"`, {
        stdio: 'pipe',
      });
      
      // 检查数据库结构
      const tables = execSync(`sqlite3 "${testDbPath}" ".tables"`, {
        stdio: 'pipe',
      }).toString().trim();
      
      console.log(`  数据库表: ${tables}`);
      
      // 检查文章数量
      const articleCount = execSync(`sqlite3 "${testDbPath}" "SELECT COUNT(*) FROM articles;"`, {
        stdio: 'pipe',
      }).toString().trim();
      
      console.log(`  文章数量: ${articleCount}`);
      
      // 检查媒体文件数量
      const mediaCount = execSync(`sqlite3 "${testDbPath}" "SELECT COUNT(*) FROM media_blobs;"`, {
        stdio: 'pipe',
      }).toString().trim();
      
      console.log(`  媒体文件数量: ${mediaCount}`);
      
      console.log(`  ✓ 备份完整性测试通过`);
      return true;
    } catch (error) {
      console.error(`  ✗ 备份完整性测试失败:`, error.message);
      return false;
    } finally {
      // 清理测试文件
      try {
        await unlink(testDbPath);
      } catch {}
    }
  } catch (error) {
    console.error(`测试备份 ${backupFile} 时出错:`, error.message);
    return false;
  }
}

async function testRestoreProcess(backupFile) {
  const backupPath = join(BACKUP_DIR, backupFile);
  
  try {
    console.log(`\n测试恢复流程: ${backupFile}`);
    
    // 创建测试目录
    await mkdir(RESTORE_DIR, { recursive: true });
    
    // 模拟恢复过程
    const testDbPath = join(RESTORE_DIR, `restore-test-${Date.now()}.db`);
    await copyFile(backupPath, testDbPath);
    
    console.log('  1. 复制备份文件 ✓');
    
    // 检查数据库是否可以正常打开
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(testDbPath);
    
    console.log('  2. 打开数据库 ✓');
    
    // 执行一些基本查询
    const articleCount = db.prepare('SELECT COUNT(*) as count FROM articles').get();
    console.log(`  3. 查询文章数量: ${articleCount.count} ✓`);
    
    // 检查数据库是否可以正常写入
    db.prepare('PRAGMA user_version = 999').run();
    const version = db.pragma('user_version', { simple: true });
    console.log(`  4. 写入测试 (版本号: ${version}) ✓`);
    
    db.close();
    
    console.log('  ✓ 恢复流程测试通过');
    return true;
  } catch (error) {
    console.error(`  ✗ 恢复流程测试失败:`, error.message);
    return false;
  } finally {
    // 清理测试文件
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(testDbPath);
    } catch {}
  }
}

async function runRecoveryDrill() {
  console.log('=== 开始恢复演练 ===\n');
  
  const backups = await listBackups();
  if (backups.length === 0) {
    console.log('没有找到备份文件');
    return;
  }
  
  console.log(`找到 ${backups.length} 个备份文件`);
  
  let passedTests = 0;
  let totalTests = 0;
  
  // 测试最新的3个备份
  const testBackups = backups.slice(0, 3);
  
  for (const backup of testBackups) {
    totalTests += 2;
    
    // 测试备份完整性
    const integrityPassed = await testBackupIntegrity(backup);
    if (integrityPassed) passedTests++;
    
    // 测试恢复流程
    const restorePassed = await testRestoreProcess(backup);
    if (restorePassed) passedTests++;
    
    console.log('');
  }
  
  // 清理测试目录
  try {
    const { rm } = await import('node:fs/promises');
    await rm(RESTORE_DIR, { recursive: true, force: true });
  } catch {}
  
  console.log('=== 恢复演练完成 ===');
  console.log(`测试结果: ${passedTests}/${totalTests} 通过`);
  
  if (passedTests === totalTests) {
    console.log('✓ 恢复演练成功');
  } else {
    console.log('✗ 恢复演练部分失败');
    process.exitCode = 1;
  }
}

// 命令行接口
const command = process.argv[2];

switch (command) {
  case 'list':
    listBackups().then(backups => {
      console.log('现有备份:');
      backups.forEach(backup => {
        console.log(`  ${backup}`);
      });
    });
    break;
  case 'test':
    runRecoveryDrill().catch(console.error);
    break;
  default:
    console.log('用法:');
    console.log('  node recovery-drill.mjs list   - 列出所有备份');
    console.log('  node recovery-drill.mjs test   - 执行恢复演练');
}