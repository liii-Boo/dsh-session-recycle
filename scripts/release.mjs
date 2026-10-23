// 用 GitHub API 创建 Release 并上传 tgz 附件
// 用法: node release.mjs <token> <owner/repo> <tag> <tgz路径> [bodyFile]
import fs from 'node:fs';
import path from 'node:path';

const [token, slug, tag, tgzPath, bodyFile] = process.argv.slice(2);
if (!token || !slug || !tag || !tgzPath) {
  console.error('参数不足: <token> <owner/repo> <tag> <tgz> [bodyFile]');
  process.exit(2);
}

const PROXY = process.env.HTTPS_PROXY || '';
const proxyAgent = (() => {
  if (!PROXY) return undefined;
  try {
    // Node 内置不提供 proxy agent；用 fetch 的 undici 无法直连代理，
    // 这里改用 node:http 手动 CONNECT 成本高，先尝试直连（registry 已证明可直连）。
    return undefined;
  } catch {
    return undefined;
  }
})();

const api = (p) => `https://api.github.com${p}`;
const headers = {
  'User-Agent': 'dsh-release-script',
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const body = bodyFile && fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '';

// 1) 建（或复用）Release
let release = null;
const existing = await fetch(api(`/repos/${slug}/releases/tags/${tag}`), { headers });
if (existing.status === 200) {
  release = await json(existing);
  console.log('Release 已存在，复用:', release.html_url);
} else {
  const created = await fetch(api(`/repos/${slug}/releases`), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `DSH 会话回收站 ${tag}`,
      body,
      draft: false,
      prerelease: false,
    }),
  });
  release = await json(created);
  if (created.status >= 300) {
    console.error('创建 Release 失败', created.status, release);
    process.exit(1);
  }
  console.log('Release 已创建:', release.html_url);
}

// 2) 上传附件
const fileName = path.basename(tgzPath);
const data = fs.readFileSync(tgzPath);
const uploadUrl = `${release.upload_url.split('{')[0]}?name=${encodeURIComponent(fileName)}`;
const upload = await fetch(uploadUrl, {
  method: 'POST',
  headers: {
    'User-Agent': headers['User-Agent'],
    Authorization: headers.Authorization,
    'content-type': 'application/gzip',
    'content-length': String(data.length),
  },
  body: data,
});
const uploaded = await json(upload);
if (upload.status >= 300) {
  console.error('上传附件失败', upload.status, uploaded);
  process.exit(1);
}
console.log('附件已上传:', uploaded.name, `${(uploaded.size / 1024).toFixed(1)} KB`);
console.log('下载地址:', uploaded.browser_download_url);
void proxyAgent;
