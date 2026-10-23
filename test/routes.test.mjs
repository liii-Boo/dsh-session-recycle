/**
 * 路由层测试：伪造一个 cordis 上下文与 HTTP 请求/响应，直接驱动 index.js 注册的路由处理器。
 *
 * 这样能覆盖「浏览器发请求 → guard → 处理器 → 文件操作 → 响应」整条链路，
 * 只剩浏览器端的事件绑定没法在这里测。
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SLUG = '--C-Users-li-docs---';
const WS_PATH = 'C:\\Users\\li\\docs';
const MAIN = 'session-aaaaaaaa-1111-2222-3333-444444444444';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

/** 造一套最小的 DSH 存储树。 */
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsr-route-'));
  process.env.DSH_HOME = home;
  const dir = path.join(home, 'sessions', SLUG, MAIN);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), 'log');
  writeJson(path.join(home, 'storages', 'session_projcache', 'sessions', `${MAIN}.json`), {
    record: {
      identity: { cwd: WS_PATH },
      rows: { title: { val: '会话' }, sessionStats: { val: { turns: 2 } } },
    },
  });
  writeJson(path.join(home, 'storages', 'workspace.json'), {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, defaultWorkspaceId: 'ws-1', workspaceIds: ['ws-1'], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { 'ws-1': { path: WS_PATH, title: 'docs', sessionIds: [MAIN] } } },
  });
  return home;
}

/** 伪造 req：POST + 本地回环 + 正确的 Host。 */
function fakeReq(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = { host: '127.0.0.1:51175', 'content-type': 'application/json' };
  req.socket = { remoteAddress: '127.0.0.1' };
  req.destroy = () => {};
  // 数据在下一个 tick 推出，处理器开始监听后才触发
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body ?? {})));
    req.emit('end');
  });
  return req;
}

/** 伪造 res：收集状态码与 JSON 响应。 */
function fakeRes() {
  const res = {
    statusCode: 0,
    headers: null,
    payload: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.payload = payload ? JSON.parse(payload) : null;
      return this;
    },
  };
  return res;
}

/** 启动插件并取回路由表。 */
async function boot() {
  const { apply } = await import('../index.js');
  const routes = new Map();
  const ctx = {
    get: () => void 0,
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    inject: () => {},
    emit: () => {},
    logger: { warn: () => {} },
  };
  const webServer = {
    register: (route) => {
      routes.set(route.path, route.handler);
      return () => {};
    },
  };
  ctx.get = (name) => (name === 'webServer' ? webServer : void 0);
  apply(ctx);
  return routes;
}

/** 调用一个路由。 */
async function call(routes, routePath, body) {
  const handler = routes.get(`/dsh-session-recycle${routePath}`);
  assert.ok(handler, `路由 ${routePath} 未注册`);
  const res = fakeRes();
  await handler(fakeReq(body), res);
  return res;
}

test('GET 以外的方法返回 405', async () => {
  fixture();
  const routes = await boot();
  const handler = routes.get('/dsh-session-recycle/state');
  const res = fakeRes();
  const req = fakeReq({});
  req.method = 'GET';
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.payload.code, 'method');
});

test('非回环来源被拒绝', async () => {
  fixture();
  const routes = await boot();
  const handler = routes.get('/dsh-session-recycle/state');
  const res = fakeRes();
  const req = fakeReq({});
  req.socket = { remoteAddress: '10.0.0.5' };
  await handler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'forbidden');
});

test('Host 头不是本机时被拒绝', async () => {
  fixture();
  const routes = await boot();
  const res = await call(routes, '/state', {});
  void res;
  const handler = routes.get('/dsh-session-recycle/state');
  const badRes = fakeRes();
  const req = fakeReq({});
  req.headers.host = 'evil.example.com';
  await handler(req, badRes);
  assert.equal(badRes.statusCode, 403);
});

test('state 返回会话与回收站', async () => {
  fixture();
  const routes = await boot();
  const res = await call(routes, '/state', {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.sessions.length, 1);
  assert.equal(res.payload.trash.length, 0);
});

test('完整链路：delete -> state 里进回收站 -> purge -> 文件真的没了', async () => {
  const home = fixture();
  const routes = await boot();

  const del = await call(routes, '/delete', { sessionId: MAIN });
  assert.equal(del.statusCode, 200, JSON.stringify(del.payload));
  assert.equal(del.payload.ok, true);
  const entry = del.payload.entry;
  assert.equal(del.payload.workspaceId, 'ws-1', '删除应返回所属工作区 id，供界面切换');
  assert.equal(fs.existsSync(path.join(home, 'sessions', SLUG, MAIN)), false);

  const listed = await call(routes, '/state', {});
  assert.equal(listed.payload.trash.length, 1);
  assert.equal(listed.payload.sessions.length, 0);

  const purged = await call(routes, '/purge', { entry, sessionId: MAIN });
  assert.equal(purged.statusCode, 200, JSON.stringify(purged.payload));
  assert.equal(purged.payload.ok, true);

  const itemDir = path.join(home, 'trash', entry, MAIN);
  assert.equal(fs.existsSync(itemDir), false, '彻底删除后目录必须消失');

  const after = await call(routes, '/state', {});
  assert.equal(after.payload.trash.length, 0);
});

test('还原：restore 之后会话回到原处', async () => {
  const home = fixture();
  const routes = await boot();
  const del = await call(routes, '/delete', { sessionId: MAIN });
  const entry = del.payload.entry;

  const restored = await call(routes, '/restore', { entry, sessionId: MAIN });
  assert.equal(restored.statusCode, 200, JSON.stringify(restored.payload));
  assert.equal(restored.payload.ok, true);
  assert.equal(fs.existsSync(path.join(home, 'sessions', SLUG, MAIN, 'session.v4.jsonl.zstd')), true);
});

test('非法 sessionId 与 entry 被拒绝', async () => {
  fixture();
  const routes = await boot();
  const bad1 = await call(routes, '/delete', { sessionId: '../../etc/passwd' });
  assert.equal(bad1.payload.ok, false);
  assert.equal(bad1.payload.code, 'invalid');

  const bad2 = await call(routes, '/purge', { entry: '../..', sessionId: MAIN });
  assert.equal(bad2.payload.ok, false);
  assert.equal(bad2.payload.code, 'invalid');
});

test('idle-candidates：不限空会话且天数为 0 时拒绝（避免一次全选）', async () => {
  fixture();
  const routes = await boot();

  const rejected = await call(routes, '/idle-candidates', { days: 0, emptyOnly: false });
  assert.equal(rejected.payload.ok, false);
  assert.equal(rejected.payload.code, 'invalid');

  // 只看空会话时 0 天是合法用法
  const allowed = await call(routes, '/idle-candidates', { days: 0, emptyOnly: true });
  assert.equal(allowed.payload.ok, true);

  // 给了天数就允许
  const withDays = await call(routes, '/idle-candidates', { days: 7, emptyOnly: false });
  assert.equal(withDays.payload.ok, true);
});