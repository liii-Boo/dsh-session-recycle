// 用 GitHub API 创建新版本 Release；拒绝覆盖已有版本或附件。
import fs from 'node:fs';
import path from 'node:path';

const [slug, tag, tgzPath, bodyFile] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!token || !/^[\w.-]+\/[\w.-]+$/.test(slug ?? '') || tag !== `v${pkg.version}` || !tgzPath || !bodyFile) {
  throw new Error('用法：设置 GITHUB_TOKEN 后，node scripts/release-update.mjs <owner/repo> <v当前版本> <tgz> <正文文件>');
}
const data = fs.readFileSync(tgzPath);
const api = (p) => `https://api.github.com${p}`;
const headers = {
  'User-Agent': 'dsh-release-script',
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};
const body = fs.readFileSync(bodyFile, 'utf8');

async function j(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// 1) 找已有 Release
const found = await fetch(api(`/repos/${slug}/releases/tags/${tag}`), { headers });
let release;
if (found.status === 200) {
  throw new Error(`${tag} 已有 Release；请递增版本并使用新 tag，不覆盖旧附件`);
} else if (found.status === 404) {
  const created = await fetch(api(`/repos/${slug}/releases`), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: `DSH 会话回收站 ${tag}`, body, draft: false, prerelease: false }),
  });
  release = await j(created);
  if (created.status >= 300) {
    console.error('创建失败', created.status, release);
    process.exit(1);
  }
  console.log('Release 已创建:', release.html_url);
} else {
  throw new Error(`读取 Release 失败：HTTP ${found.status}，未执行发布`);
}

// 2) 上传新附件
const fileName = path.basename(tgzPath);
const upload = await fetch(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(fileName)}`, {
  method: 'POST',
  headers: {
    'User-Agent': headers['User-Agent'],
    Authorization: headers.Authorization,
    'content-type': 'application/gzip',
    'content-length': String(data.length),
  },
  body: data,
});
const uploaded = await j(upload);
if (upload.status >= 300) {
  console.error('上传失败', upload.status, uploaded);
  process.exit(1);
}
console.log('附件已上传:', uploaded.name, `${(uploaded.size / 1024).toFixed(1)} KB`);
console.log('下载地址:', uploaded.browser_download_url);
