// 一次性自检：i18n 键是否齐全、有没有残留乱码
import fs from 'node:fs';

const file = process.argv[2];
const s = fs.readFileSync(file, 'utf8');

const zhStart = s.indexOf('const zh = {');
const enStart = s.indexOf('const en = {');
const zhBlock = s.slice(zhStart, enStart);

const used = [...s.matchAll(/\bt\("([a-zA-Z][\w.]*)"/g)].map((m) => m[1]);
const uniq = [...new Set(used)].filter((k) => k !== 't');
const missingZh = uniq.filter((k) => !zhBlock.includes(`"${k}"`));

const mojibake = (s.match(/路|锛|鈥|瀹|鏄|缂|鍥/g) || []).length;
const windowConfirm = (s.match(/window\.confirm/g) || []).length;

console.log('i18n 使用键数 :', uniq.length);
console.log('zh 缺失      :', missingZh.length === 0 ? '（无）' : missingZh.join(', '));
console.log('乱码字符     :', mojibake);
console.log('window.confirm:', windowConfirm);
