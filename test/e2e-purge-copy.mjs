// 在真实数据的副本上验证「彻底删除」是否真的删掉文件
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REAL = path.join(os.homedir(), '.dsh');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsr-purge-'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

copyDir(path.join(REAL, 'trash'), path.join(TMP, 'trash'));
copyDir(path.join(REAL, 'sessions'), path.join(TMP, 'sessions'));
copyDir(path.join(REAL, 'storages'), path.join(TMP, 'storages'));
process.env.DSH_HOME = TMP;

const store = await import('../lib/store.mjs');

const before = store.listTrash();
console.log('副本回收站条目:', before.length);
if (before.length === 0) {
  console.log('副本里没有条目，跳过');
  process.exit(0);
}
const item = before[0];
const target = path.join(TMP, 'trash', item.entry, item.id);
console.log('目标目录:', target);
console.log('删除前存在:', fs.existsSync(target));

const result = store.purgeFromTrash(item.entry, item.id);
console.log('purgeFromTrash 返回:', JSON.stringify(result));
console.log('删除后存在:', fs.existsSync(target));
console.log('回收站条目数:', store.listTrash().length);

const ok = result.ok === true && !fs.existsSync(target) && store.listTrash().length === 0;
console.log('\n结论:', ok ? '✓ lib 层彻底删除正常' : '✗ lib 层彻底删除异常');
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
