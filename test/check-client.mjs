import fs from 'node:fs';

const p = process.argv[2];
const src = fs.readFileSync(p, 'utf8');
const stat = fs.statSync(p);
console.log('文件时间:', stat.mtime.toISOString(), '大小:', stat.size);
for (const key of ['kind: "purge"', 'kind: "empty"', 'request.kind', 'confirm.purgeTitle', 'ConfirmForm', 'openConfirm']) {
  console.log(`  ${key} => ${src.includes(key)}`);
}
console.log('window.confirm 调用次数:', (src.match(/window\.confirm\(/g) || []).length);
console.log('purge 处理分支:', /kind === "purge"/.test(src));
