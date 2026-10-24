// 校验本地 tgz 或当前版本的线上附件；逐文件比较内容，不能靠注释判断新旧。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const input = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsr-verify-'));
const tgz = input ? path.resolve(input) : path.join(temp, 'release.tgz');
const hash = (data) => createHash('sha256').update(data).digest('hex');

function filesUnder(relative) {
  const absolute = path.join(root, relative);
  if (!fs.statSync(absolute).isDirectory()) return [relative.replaceAll('\\', '/')];
  return fs.readdirSync(absolute).flatMap((name) => filesUnder(path.join(relative, name)));
}

try {
  if (!input) {
    const name = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
    const url = `https://github.com/liii-Boo/dsh-session-recycle/releases/download/v${pkg.version}/${name}`;
    try {
      // curl 自动读取代理环境变量，不输出可能含凭据的代理地址。
      execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', [
        '--silent', '--show-error', '--location', '--fail', '--max-time', '120',
        '--output', tgz, url,
      ], { stdio: 'pipe' });
    } catch {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`下载 v${pkg.version} 失败：HTTP ${response.status}，请确认该版本已经发布`);
      fs.writeFileSync(tgz, Buffer.from(await response.arrayBuffer()));
    }
  }

  // 只从 tar 读内容，不把下载包解压到磁盘。
  const entries = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
    .trim().split(/\r?\n/).filter((entry) => !entry.endsWith('/'));
  if (new Set(entries).size !== entries.length) throw new Error('安装包包含重复文件');
  const expected = [...new Set(['package.json', 'README.md', 'LICENSE', ...pkg.files.flatMap(filesUnder)])].sort();
  const actual = entries.map((entry) => {
    if (!entry.startsWith('package/') || entry.split('/').includes('..')) throw new Error(`异常包内路径：${entry}`);
    return entry.slice('package/'.length);
  }).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('安装包文件清单与当前源码不一致');
  for (const name of expected) {
    const packed = execFileSync('tar', ['-xOf', tgz, `package/${name}`], { maxBuffer: 32 * 1024 * 1024 });
    if (hash(packed) !== hash(fs.readFileSync(path.join(root, name)))) throw new Error(`内容不一致：${name}`);
  }
  console.log(`${input ? '本地安装包' : '线上附件'} v${pkg.version}：${expected.length} 个文件与当前源码逐字节一致`);
  console.log(`SHA-256: ${hash(fs.readFileSync(tgz))}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
