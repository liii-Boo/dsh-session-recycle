import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// 执行真实浏览器 bundle；仅在测试沙箱中导出闭包函数，不修改发布入口。
const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  .replace('return module.exports;', 'Object.assign(module.exports, { refreshHostSessions, leaveDeletedView, isCurrentSession }); return module.exports;');
let client;
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load: (bundle) => {
    client = bundle.factory(() => ({ createElement() {} }));
  } } },
  setTimeout, clearTimeout, console,
});

test('还原后刷新宿主列表，并确认目标会话出现', async () => {
  let state = { byId: {} };
  let calls = 0;
  const ctx = { get: () => ({
    async refresh() { calls++; state = { byId: { restored: { id: 'restored' } } }; },
    list: { getSnapshot: () => state },
  }) };
  await client.refreshHostSessions(ctx, 'restored');
  assert.equal(calls, 1);
});

test('宿主复用旧请求时重试一次，避免把旧列表当还原完成', async () => {
  let calls = 0;
  const ctx = { get: () => ({
    async refresh() { calls++; },
    list: { getSnapshot: () => ({ byId: calls > 1 ? { restored: {} } : {} }) },
  }) };
  await client.refreshHostSessions(ctx, 'restored');
  assert.equal(calls, 2);
});

test('刷新后仍找不到会话时返回失败', async () => {
  const ctx = { get: () => ({ async refresh() {}, list: { getSnapshot: () => ({ byId: {} }) } }) };
  await assert.rejects(client.refreshHostSessions(ctx, 'missing'), /尚未包含/);
});

test('宿主刷新异常不能变成成功提示', async () => {
  const ctx = { get: () => ({ async refresh() { throw new Error('connection lost'); } }) };
  await assert.rejects(client.refreshHostSessions(ctx, 'restored'), /connection lost/);
});

test('删除当前会话前等待主视图释放，兼容异步切换', async () => {
  let current = true;
  const ctx = { get: (name) => name === 'uiWorkspace'
    ? { async clearMain() { await new Promise((resolve) => setTimeout(resolve, 20)); current = false; } }
    : name === 'sessions' ? { retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: current ? 1 : 0 } }) }) } : undefined };
  const result = await client.leaveDeletedView(ctx, true, 'workspace', 'current');
  assert.equal(result.ok, true);
  assert.equal(current, false);
});

test('切换调用返回但视图未离开时拒绝删除', async () => {
  const ctx = { get: (name) => name === 'uiWorkspace' ? { clearMain() {} }
    : name === 'sessions' ? { retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }) } : undefined };
  const result = await client.leaveDeletedView(ctx, true, null, 'current');
  assert.equal(result.ok, false);
  assert.match(result.reason, /尚未切换/);
});
