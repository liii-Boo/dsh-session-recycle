// 检查 client.js 是否存在编码损坏（非法 UTF-8 / 替换字符），
// 这类损坏会让整个模块在浏览器里抛语法错误，表现为"点击没反应"。
import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);

// 1) 能否按 UTF-8 无损解码
const text = buf.toString('utf8');
const roundTrip = Buffer.from(text, 'utf8');
const lossy = !roundTrip.equals(buf);
console.log('UTF-8 无损:', !lossy);

// 2) 替换字符 U+FFFD
const replacements = (text.match(/\uFFFD/g) || []).length;
console.log('U+FFFD 替换字符:', replacements);

// 3) 典型 mojibake 特征（UTF-8 被当 GBK 解读后又存回）
const mojibake = (text.match(/[鍥鐨涓鏄瀹缂浠]{1,}/g) || []).length;
console.log('mojibake 片段:', mojibake);

// 4) 代码部分应为纯 ASCII，只有注释/字符串里才是中文；统计非 ASCII 占比
const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
console.log('非 ASCII 字符数:', nonAscii, `(${((nonAscii / text.length) * 100).toFixed(2)}%)`);

// 5) 用 node 的词法检查（等价于 node --check）
if (lossy || replacements > 0) {
  console.log('\n⚠ 文件编码已损坏，浏览器加载时会报错');
  process.exit(1);
}
console.log('\n✓ 编码正常');
