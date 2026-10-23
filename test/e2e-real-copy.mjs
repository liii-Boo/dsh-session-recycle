// 用真实 ~/.dsh 的副本跑一遍完整流程：扫描 -> 删除子会话 -> 还原 -> 一致性核对
// 全程只动临时副本，不碰真实数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REAL = path.join(os.homedir(), '.dsh');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsr-e2e-'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

copyDir(path.join(REAL, 'sessions'), path.join(TMP, 'sessions'));
copyDir(path.join(REAL, 'storages'), path.join(TMP, 'storages'));
process.env.DSH_HOME = TMP;

const store = await import('../lib/store.mjs');

const before = store.snapshot();
console.log('== 副本初始状态 ==');
console.log('  会话:', before.sessions.length, '| 孤儿缓存:', before.orphans.cacheOnly.length, '| 回收站:', before.trash.length);
const child = before.sessions.find((s) => s.kind === 'child');
if (child === undefined) {
  console.log('副本里没有子会话，跳过端到端测试');
  process.exit(0);
}
console.log('  目标子会话:', child.id, `${(child.bytes / 1024).toFixed(0)}KB`);

// 1) 删除
const removed = await store.moveToTrash(child.id, {
  title: child.title,
  cwd: child.cwd ?? undefined,
  archived: child.archived,
  pinned: child.pinned,
});
console.log('== 删除 ==', removed.ok === true ? 'OK' : `FAIL(${removed.code})`);
if (removed.ok !== true) process.exit(1);

const afterDelete = store.snapshot();
console.log('  删除后: 会话', afterDelete.sessions.length, '| 回收站', afterDelete.trash.length, '| 孤儿缓存', afterDelete.orphans.cacheOnly.length);
if (afterDelete.sessions.some((s) => s.id === child.id)) {
  console.log('  ✗ 会话仍在列表里');
  process.exit(1);
}
if (afterDelete.trash.length !== 1) {
  console.log('  ✗ 回收站条目数不对');
  process.exit(1);
}

// 2) 还原
const entry = afterDelete.trash[0];
const restored = await store.restoreFromTrash(entry.entry, child.id);
console.log('== 还原 ==', restored.ok === true ? 'OK' : `FAIL(${restored.code})`);
if (restored.ok !== true) process.exit(1);

const afterRestore = store.snapshot();
const back = afterRestore.sessions.find((s) => s.id === child.id);
console.log('  还原后: 会话', afterRestore.sessions.length, '| 回收站', afterRestore.trash.length);
console.log('  子会话回来了:', back !== undefined, '| kind =', back?.kind);

// 3) 一致性
const ok =
  afterRestore.sessions.length === before.sessions.length &&
  afterRestore.trash.length === 0 &&
  back !== undefined &&
  fs.existsSync(path.join(back.dir, 'session.v4.jsonl.zstd'));
console.log('== 一致性 ==', ok ? '通过（往返无损）' : '失败');
console.log('  临时目录:', TMP);
process.exit(ok ? 0 : 1);
