// 发布前一致性自检：包名在三处（package.json / cordis.patch.yml / client 模块 id / index 的 name）必须一致
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const patch = fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8');
const client = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');
const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');

const checks = [
  ['package.json name 符合 scope 规范', /^@[a-z0-9-]+\/[a-z0-9-]+$/.test(pkg.name), pkg.name],
  ['cordis.patch.yml 的 name 与包名一致', patch.includes(`name: '${pkg.name}'`), ''],
  ['client 模块 id 与包名一致', client.includes(`id: "${pkg.name}"`), ''],
  ['index 的 export name 与包名一致', index.includes(`export const name = '${pkg.name}'`), ''],
  ['dsh.bundle.patch 指向的文件存在', fs.existsSync(path.join(dir, pkg.dsh?.bundle?.patch ?? '')), ''],
  ['client 入口存在', fs.existsSync(path.join(dir, 'client.js')), ''],
  ['LICENSE 存在', fs.existsSync(path.join(dir, 'LICENSE')), ''],
  ['files 白名单含 LICENSE', Array.isArray(pkg.files) && pkg.files.includes('LICENSE'), ''],
  ['react 未声明为 peer（应由宿主提供）', !(pkg.peerDependencies ?? {}).react, ''],
  ['publishConfig.access = public', pkg.publishConfig?.access === 'public', ''],
  ['repository 已填', typeof pkg.repository?.url === 'string' && pkg.repository.url.includes('github.com'), ''],
  ['engines.node 已声明', typeof pkg.engines?.node === 'string', ''],
];

let failed = 0;
for (const [label, ok, extra] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` (${extra})` : ''}`);
}
console.log(failed === 0 ? '\n全部通过，可以发布。' : `\n${failed} 项未通过。`);
process.exit(failed === 0 ? 0 : 1);
