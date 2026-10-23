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
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package', 'package.json'), 'utf8'));

const checks = [
  ['版本是 1.0.0', pkg.version === '1.0.0'],
  ['scanSession 已导出', store.includes('export function scanSession(')],
  ['记录 unreadable', store.includes('unreadable.push')],
  ['轮数严格 === 0', store.includes('session.turns === 0')],
  ['孤儿排除不可读目录', store.includes('unreadableIds.has(id)')],
  ['purge 清理空壳', store.includes('留空壳')],
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
