// 下载线上附件并校验修复是否在里面
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = `https://github.com/liii-Boo/dsh-session-recycle/releases/download/v1.0.0/liii-boo-dsh-session-recycle-1.0.0.tgz?cb=${Date.now()}`;
const tgz = path.join(os.tmpdir(), `dsr-verify-${Date.now()}.tgz`);

const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(tgz, buf);
console.log('下载:', buf.length, '字节', 'HTTP', res.status);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsr-verify-'));
execFileSync('tar', ['-xzf', tgz, '-C', dir]);

const store = fs.readFileSync(path.join(dir, 'package', 'lib', 'store.mjs'), 'utf8');
const host = fs.readFileSync(path.join(dir, 'package', 'index.js'), 'utf8');
const client = fs.readFileSync(path.join(dir, 'package', 'client.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package', 'package.json'), 'utf8'));

const checks = [
  ['版本是 1.0.0', pkg.version === '1.0.0'],
  ['scanSession 已导出', store.includes('export function scanSession(')],
  ['记录 unreadable', store.includes('unreadable.push')],
  ['轮数严格 === 0', store.includes('session.turns === 0')],
  ['孤儿排除不可读目录', store.includes('unreadableIds.has(id)')],
  ['purge 清理空壳', store.includes('留空壳')],
  ['stripRegistry 可关闭', store.includes('extra.stripRegistry === false')],
  ['还原失败回滚', store.includes('要么都回去，要么都不动')],
  ['冲突备份会清理', store.includes('conflictBackup')],
  ['服务摘除成功则不写文件', host.includes('serviceDetached')],
  ['不限空会话必须给天数', host.includes('days === 0')],
  ['批量上限 200', host.includes('const BATCH_LIMIT = 200')],
  ['测试脚本跑两个文件', String(pkg.scripts?.test ?? '').includes('routes.test.mjs')],
  // 第二轮（Claude 跟进）修复
  ['标记从宿主服务读', host.includes('readSessionFlags')],
  ['detach 成功但标记失败时只摘标记', host.includes('stripFlagsFromRegistry')],
  ['归档集合里的孤儿纳入诊断', store.includes('...registry.archived,')],
  ['批量分批发送', client.includes('const CHUNK = 25')],
  ['批量进度提示', client.includes('delete.progress')],
  // 第三轮：当前会话保护
  ['识别当前会话', client.includes('function isCurrentSession')],
  ['删完自动切走视图', client.includes('function leaveDeletedView')],
  ['删除返回 workspaceId', host.includes('workspaceId: await resolveWorkspaceId')],
  ['切换失败有提示', client.includes('delete.stuckHint')],
];

let bad = 0;
for (const [label, ok] of checks) {
  if (!ok) bad += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}
console.log(bad === 0 ? '\n线上包是最新修复版' : `\n${bad} 项不符`);

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(tgz, { force: true });
process.exit(bad === 0 ? 0 : 1);
