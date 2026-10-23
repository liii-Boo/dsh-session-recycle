// 项目自审：死代码、Markdown 结构、链接有效性、版本一致性
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(dir, p));

const client = read('client.js');
const index = read('index.js');
const store = read('lib/store.mjs');
const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));

const problems = [];
const notes = [];

// 1) 死标识符
for (const name of ['noticeInfo', 'dsr-banner', 'RecycleConfirmDialog', 'subscribePending', 'readPending', 'dsr-confirm-inline', 'dsr-overlay']) {
  if (client.includes(name)) problems.push(`client.js 仍引用已废弃的 ${name}`);
}

// 2) store 导出的函数是否被 index/test 使用（未使用 = 可能死代码）
const exported = [...store.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
const consumers = index + read('test/recycle.test.mjs') + read('test/routes.test.mjs');
for (const name of exported) {
  if (!consumers.includes(name)) notes.push(`store 导出 ${name} 未被 index/测试引用`);
}

// 3) Markdown：标题前应有空行（否则 GitHub 会把上一行吞进标题）
const lines = readme.split('\n');
for (let i = 1; i < lines.length; i += 1) {
  if (/^#{1,4} /.test(lines[i]) && lines[i - 1].trim() !== '' && !/^#{1,4} /.test(lines[i - 1])) {
    problems.push(`README 第 ${i + 1} 行的标题前缺少空行：${lines[i].slice(0, 40)}`);
  }
}

// 4) README 引用的本地图片必须存在（同时检查 Markdown 与 HTML 两种写法）
const imageRefs = [
  ...[...readme.matchAll(/!\[[^\]]*\]\((?!https?:)([^)]+)\)/g)].map((m) => m[1]),
  ...[...readme.matchAll(/<img[^>]+src="(?!https?:)([^"]+)"/g)].map((m) => m[1]),
];
for (const rel of imageRefs) {
  if (!exists(rel)) problems.push(`README 引用了不存在的图片：${rel}`);
}
if (imageRefs.length > 0) notes.push(`README 引用本地图片 ${imageRefs.length} 张`);

// 5) package.json 关键字段
for (const key of ['name', 'version', 'license', 'description', 'repository', 'engines']) {
  if (pkg[key] === undefined) problems.push(`package.json 缺少 ${key}`);
}
if (!Array.isArray(pkg.files) || !pkg.files.includes('LICENSE')) problems.push('files 白名单缺 LICENSE');
if (pkg.peerDependencies?.react) problems.push('react 不应作为 peerDependencies');
if (pkg.version !== '1.0.0') notes.push(`当前版本 ${pkg.version}（tag 需同步）`);

// 6) 必需文件
for (const f of ['index.js', 'client.js', 'cordis.patch.yml', 'lib/store.mjs', 'LICENSE', 'README.md', '.gitignore']) {
  if (!exists(f)) problems.push(`缺少必需文件 ${f}`);
}

// 7) 客户端只能用 react 与 ui-primitives
const requires = [...client.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
const allowed = new Set(['react', '@deepseek-ai/dsh-client-ui-primitives']);
for (const r of new Set(requires)) {
  if (!allowed.has(r)) problems.push(`client.js require 了非白名单模块：${r}`);
}

// 8) 事件契约：不能真的 emit api-session/added（注释里提到不算）
if (/emit\(\s*['"]api-session\/added['"]/.test(index)) {
  problems.push('index.js 仍在 emit api-session/added（负载类型不对）');
}

console.log('=== 问题 ===');
if (problems.length === 0) console.log('  无');
else for (const p of problems) console.log('  ✗', p);

console.log('=== 提示 ===');
if (notes.length === 0) console.log('  无');
else for (const n of notes) console.log('  ·', n);

console.log(`\n结论: ${problems.length === 0 ? '通过' : `${problems.length} 个问题`}`);
process.exit(problems.length === 0 ? 0 : 1);
