// 用 GitHub API 更新（或创建）Release 并替换附件
import fs from 'node:fs';
import path from 'node:path';

const [token, slug, tag, tgzPath, bodyFile] = process.argv.slice(2);
const api = (p) => `https://api.github.com${p}`;
const headers = {
  'User-Agent': 'dsh-release-script',
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};
const body = bodyFile && fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '';

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
  release = await j(found);
  console.log('已有 Release:', release.html_url, `(id=${release.id})`);
  // 删掉旧附件
  for (const asset of release.assets ?? []) {
    const del = await fetch(api(`/repos/${slug}/releases/assets/${asset.id}`), {
      method: 'DELETE',
      headers,
    });
    console.log(`  删除旧附件 ${asset.name}: HTTP ${del.status}`);
  }
  // 更新正文
  const patched = await fetch(api(`/repos/${slug}/releases/${release.id}`), {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `DSH 会话回收站 ${tag}`, body }),
  });
  release = await j(patched);
  console.log('Release 正文已更新');
} else {
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
}

// 2) 上传新附件
const fileName = path.basename(tgzPath);
const data = fs.readFileSync(tgzPath);
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
