// 精确版：用括号配对截取组件函数体，再检查 hooks 顺序
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const client = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');

/** 从 `function Name(` 起，按括号配对切出函数体。 */
function extract(name) {
  const start = client.indexOf(`function ${name}(`);
  if (start < 0) {
    const alt = client.indexOf(`function ${name} (`);
    if (alt < 0) return null;
    return extractAt(alt);
  }
  return extractAt(start);
}

function extractAt(start) {
  const open = client.indexOf('{', client.indexOf(')', start));
  if (open < 0) return null;
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = open; i < client.length; i += 1) {
    const ch = client[i];
    if (inString !== null) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return client.slice(open, i + 1);
    }
  }
  return null;
}

const components = ['RecyclePanel', 'ConfirmOverlay', 'SettingsPanel', 'RecycleToast', 'RecycleMenuItem'];
const problems = [];

for (const name of components) {
  const body = extract(name);
  if (body === null) {
    problems.push(`${name}：无法截取函数体`);
    continue;
  }
  // 组件体里所有 hook 调用
  const hooks = [...body.matchAll(/React\.(use[A-Za-z]+)/g)].map((m) => m[1]);
  if (hooks.length === 0 && name !== 'RecycleMenuItem') continue;

  // 找第一个条件早退（if (...) return ...）与第一个 hook 的相对位置
  const hookIdx = body.search(/React\.use/);
  const guard = body.match(/\n\s*if \([^\n]*\)\s*return\b/);
  if (guard !== null) {
    const guardIdx = body.indexOf(guard[0]);
    if (hookIdx > 0 && guardIdx < hookIdx) {
      problems.push(`${name}：条件早退出现在首个 hook 之前（hooks 顺序风险）`);
    }
  }

  // return 之后不应再有 hook（排除 return 在 if/三元里的内联情况：只看最后一段）
  const lastReturn = body.search(/\n\s*return\b[^\n]*$/m);
  void lastReturn;
  console.log(`${name.padEnd(16)} hooks=${hooks.length} ${hooks.length ? `(${[...new Set(hooks)].join(', ')})` : ''}`);
}

console.log('\n=== 问题 ===');
if (problems.length === 0) console.log('  无');
else for (const p of problems) console.log('  ✗', p);
process.exit(problems.length === 0 ? 0 : 1);
