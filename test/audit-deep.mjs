// 深度自审：README 结构、React hooks 顺序、残留标识符
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

const readme = read('README.md');
const client = read('client.js');
const problems = [];
const notes = [];

// 1) README 标题重复
const heads = [...readme.matchAll(/^#{1,4} (.+)$/gm)].map((m) => m[1].trim());
const dups = heads.filter((h, i) => heads.indexOf(h) !== i);
if (dups.length > 0) problems.push(`README 标题重复：${dups.join(', ')}`);
notes.push(`README 标题 ${heads.length} 个`);

// 2) README 里出现 PowerShell 会吞掉的 CRLF 混排（GitHub 不受影响，仅记录）
const crlf = (readme.match(/\r\n/g) || []).length;
if (crlf > 0) notes.push(`README 含 ${crlf} 处 CRLF（GitHub 渲染无影响）`);

// 3) hooks 顺序：RecyclePanel 内不能在 hooks 之前出现条件返回
const start = client.indexOf('function RecyclePanel');
const end = client.indexOf('// ── 插件主体');
if (start < 0 || end < 0) {
  problems.push('无法定位 RecyclePanel 区间');
} else {
  const body = client.slice(start, end);
  const firstHook = body.search(/React\.use/);
  const firstReturn = body.search(/\breturn\b/);
  if (firstHook > 0 && firstReturn > 0 && firstReturn < firstHook) {
    problems.push('RecyclePanel 在首个 hook 之前就有 return/早退，可能违反 hooks 规则');
  }
}

// 4) 每个组件的 hooks 是否在 return 语句之后继续出现
for (const name of ['RecyclePanel', 'ConfirmOverlay', 'SettingsPanel', 'RecycleToast', 'RecycleMenuItem']) {
  const s = client.indexOf(`function ${name}`);
  if (s < 0) {
    problems.push(`找不到组件 ${name}`);
    continue;
  }
  const chunk = client.slice(s, s + 4000);
  const tail = chunk.slice(chunk.lastIndexOf('return h('));
  if (/React\.use/.test(tail)) problems.push(`${name} 在 return 之后仍有 hook 调用`);
}

// 5) 残留标识符
for (const dead of ['noticeInfo', 'dsr-banner', 'RecycleConfirmDialog', 'subscribePending', 'dsr-confirm-inline']) {
  if (client.includes(dead)) problems.push(`client.js 残留 ${dead}`);
}

// 6) 提示条（Toast）仍应保留
if (!client.includes('RecycleToast')) problems.push('RecycleToast 丢失，操作提示会消失');
if (!client.includes('subscribeNotice')) problems.push('subscribeNotice 丢失');

console.log('=== 问题 ===');
if (problems.length === 0) console.log('  无');
else for (const p of problems) console.log('  ✗', p);
console.log('=== 记录 ===');
for (const n of notes) console.log('  ·', n);
console.log(`\n结论: ${problems.length === 0 ? '通过' : `${problems.length} 个问题`}`);
process.exit(problems.length === 0 ? 0 : 1);
