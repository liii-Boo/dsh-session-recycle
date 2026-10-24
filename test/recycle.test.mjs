/**
 * 离线单测：不启动 DSH，直接在临时目录里造一套 ~/.dsh 结构，跑通
 * 删除 → 回收站 → 还原 → 彻底删除，以及孤儿诊断与清理。
 *
 * 跑法：node --test test/
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanOrphans,
  emptyTrash,
  idleCandidates,
  listTrash,
  moveToTrash,
  purgeFromTrash,
  readRegistry,
  readTrashMeta,
  scanSession,
  scanSessionDirs,
  restoreFromTrash,
  snapshot,
  stripFlagsFromRegistry,
  sweepReappearedCache,
  TRASH_ENTRY_RE,
} from '../lib/store.mjs';
import { internals } from '../index.js';

const SLUG = '--C-Users-li-docs---';
const WS_PATH = 'C:\\Users\\li\\docs';
const MAIN = 'session-aaaaaaaa-1111-2222-3333-444444444444';
const ARCHIVED = 'session-bbbbbbbb-1111-2222-3333-444444444444';
const REGISTRY_ONLY = 'session-cccccccc-1111-2222-3333-444444444444';
const CACHE_ONLY = 'session-dddddddd-1111-2222-3333-444444444444';

/** 写一个 JSON 文件（测试用）。 */
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}
/** 造一套最小可用的 DSH 存储树。 */
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsr-test-'));
  process.env.DSH_HOME = home;

  const write = (file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  };

  for (const [id, title] of [[MAIN, '第一个会话'], [ARCHIVED, '归档过的会话']]) {
    write(
      path.join(home, 'sessions', SLUG, id, 'session.v4.jsonl.zstd'),
      `log-${id}`,
    );
    write(
      path.join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`),
      JSON.stringify({
        record: {
          identity: { cwd: WS_PATH },
          rows: {
            title: { val: title },
            sessionListMetadata: { val: { lastPromptAt: 1_700_000_000_000 } },
            sessionStats: { val: { turns: 3 } },
          },
        },
      }),
    );
  }

  // 只有缓存、没有日志目录
  write(
    path.join(home, 'storages', 'session_projcache', 'sessions', `${CACHE_ONLY}.json`),
    JSON.stringify({ record: { rows: { title: { val: '孤儿缓存' } } } }),
  );

  write(
    path.join(home, 'storages', 'workspace.json'),
    JSON.stringify({
      unit: 1,
      global: {
        initialized: true,
        defaultWorkspaceId: 'ws-1',
        workspaceIds: ['ws-1'],
        archivedSessionIds: [ARCHIVED],
        pinnedSessionIds: [],
      },
      tables: {
        workspaces: {
          'ws-1': {
            path: WS_PATH,
            title: 'docs',
            sessionIds: [MAIN, ARCHIVED, REGISTRY_ONLY],
          },
        },
      },
    }),
  );

  return home;
}

test('snapshot 能同时看到会话、两类孤儿和空回收站', async () => {
  fixture();
  const state = snapshot();
  assert.equal(state.sessions.length, 2);
  assert.deepEqual(state.sessions.map((s) => s.title).sort(), ['归档过的会话', '第一个会话'].sort());
  assert.deepEqual(state.orphans.cacheOnly.map((o) => o.id), [CACHE_ONLY]);
  assert.deepEqual(state.orphans.registryOnly, [REGISTRY_ONLY]);
  assert.equal(state.trash.length, 0);
  assert.equal(state.sessions.find((s) => s.id === ARCHIVED).archived, true);
});

test('删除进回收站：三处一起动，且可还原（含归档标记）', async () => {
  const home = fixture();
  const result = await moveToTrash(ARCHIVED, { title: '归档过的会话', archived: true, pinned: false });
  assert.equal(result.ok, true);
  assert.equal(result.movedSession, true);
  assert.equal(result.movedCache, true);

  // 1) 日志目录没了  2) 缓存没了  3) 登记表摘干净
  assert.equal(fs.existsSync(path.join(home, 'sessions', SLUG, ARCHIVED)), false);
  assert.equal(fs.existsSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${ARCHIVED}.json`)), false);
  const registry = readRegistry();
  assert.deepEqual(registry.sessionIds, [MAIN, REGISTRY_ONLY]);
  assert.equal(registry.archived.has(ARCHIVED), false);

  // 回收站里能看到，且标题/标记都记下来了
  const trash = listTrash();
  assert.equal(trash.length, 1);
  assert.equal(trash[0].id, ARCHIVED);
  assert.equal(trash[0].title, '归档过的会话');
  assert.equal(trash[0].archived, true);
  assert.equal(trash[0].hasSession, true);
  assert.equal(trash[0].hasCache, true);

  // 还原
  const restored = await restoreFromTrash(trash[0].entry, ARCHIVED);
  assert.equal(restored.ok, true);
  assert.equal(fs.existsSync(path.join(home, 'sessions', SLUG, ARCHIVED, 'session.v4.jsonl.zstd')), true);
  assert.equal(fs.existsSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${ARCHIVED}.json`)), true);
  const after = readRegistry();
  assert.ok(after.sessionIds.includes(ARCHIVED));
  assert.equal(after.archived.has(ARCHIVED), true, '归档标记必须跟着还原');
  assert.equal(listTrash().length, 0, '还原后回收站条目应清空');
});

test('彻底删除与清空回收站', async () => {
  const home = fixture();
  const first = await moveToTrash(MAIN, { title: '第一个会话' });
  const second = await moveToTrash(ARCHIVED, { title: '归档过的会话' });
  assert.equal(listTrash().length, 2);

  const purged = purgeFromTrash(first.entry, MAIN);
  assert.equal(purged.ok, true);
  assert.equal(listTrash().length, 1);

  const emptied = emptyTrash();
  assert.equal(emptied.ok, true);
  assert.equal(listTrash().length, 0);
  assert.equal(fs.existsSync(path.join(home, 'sessions', SLUG, ARCHIVED)), false);
  assert.ok(second.entry.length > 0);
});

test('孤儿清理：删掉只剩缓存的、摘掉只剩登记的', async () => {
  const home = fixture();
  const result = cleanOrphans();
  assert.equal(result.ok, true);
  assert.deepEqual(result.cacheIds, [CACHE_ONLY]);
  assert.deepEqual(result.registryIds, [REGISTRY_ONLY]);
  assert.equal(result.removedCaches, 1);

  assert.equal(fs.existsSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${CACHE_ONLY}.json`)), false);
  const registry = readRegistry();
  assert.deepEqual(registry.sessionIds, [MAIN, ARCHIVED]);

  const after = snapshot();
  assert.deepEqual(after.orphans.cacheOnly, []);
  assert.deepEqual(after.orphans.registryOnly, []);
});

test('删除不存在的会话返回 not-found，不抛异常', async () => {
  fixture();
  const result = await moveToTrash('session-nothere-0000', {});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not-found');
});

test('回收站条目名必须过白名单：拒绝路径穿越', async () => {
  fixture();
  const evil = ['../../evil', '..', 'a/../..', '', '2026-13-99', 'not-a-stamp'];

  for (const entry of evil) {
    const restore = await restoreFromTrash(entry, MAIN);
    assert.equal(restore.ok, false, `restore 应该拒绝 ${JSON.stringify(entry)}`);
    assert.equal(restore.code, 'invalid-entry');

    const purge = purgeFromTrash(entry, null);
    assert.equal(purge.ok, false, `purge 应该拒绝 ${JSON.stringify(entry)}`);
    assert.equal(purge.code, 'invalid-entry');
  }

  // 我们自己生成的时间戳形态必须被接受
  const good = await moveToTrash(MAIN, { title: 'x' });
  assert.equal(TRASH_ENTRY_RE.test(good.entry), true);
});

test('还原时目标位置已有同名会话：拒绝并保持回收站原样', async () => {
  const home = fixture();
  const removed = await moveToTrash(MAIN, { title: '第一个会话' });
  assert.equal(removed.ok, true);

  // 人为制造同名目录（模拟用户手工复制回来、或另一次还原已完成）
  const back = path.join(home, 'sessions', SLUG, MAIN);
  fs.mkdirSync(back, { recursive: true });
  fs.writeFileSync(path.join(back, 'session.v4.jsonl.zstd'), 'recreated');

  const restored = await restoreFromTrash(removed.entry, MAIN);
  assert.equal(restored.ok, false);
  assert.equal(restored.code, 'exists');

  // 回收站里的那份必须还在，不能凭空消失
  assert.equal(listTrash().length, 1);
  assert.equal(fs.readFileSync(path.join(back, 'session.v4.jsonl.zstd'), 'utf8'), 'recreated');
});

test('按天数清理：只挑超过阈值的会话，空会话过滤生效', async () => {
  fixture();
  const now = Date.parse('2026-10-23T00:00:00Z');

  // 两个会话的 lastPromptAt 都在 2023 年，30 天阈值下都算闲置
  const idle = idleCandidates(30, false, now);
  assert.equal(idle.length, 2);
  assert.ok(idle.every((item) => item.turns === 3));

  // 只看 0 轮空会话：这两个都是 3 轮，所以一个都不给
  assert.equal(idleCandidates(30, true, now).length, 0);

  // 把“现在”挪到会话活动之前：阈值变得不可能命中
  assert.equal(idleCandidates(30, false, Date.parse('2023-01-01T00:00:00Z')).length, 0);

  // 精确压在边界两侧：lastPromptAt 是 2023-11-14T22:13Z
  assert.equal(idleCandidates(1, false, Date.parse('2023-11-15T00:00:00Z')).length, 0);
  assert.equal(idleCandidates(2, false, Date.parse('2023-11-20T00:00:00Z')).length, 2);

  // days = 0 时不限时间，只受 emptyOnly 控制
  assert.equal(idleCandidates(0, false, now).length, 2);
  assert.equal(idleCandidates(0, true, now).length, 0);
});

// ── 第二轮加固后新增的用例 ────────────────────────────────────────────────

test('路径含空格与中文：删除记录绝对路径，还原回到同一位置', async () => {
  const home = fixture();
  const spaceCwd = 'C:\\Users\\li\\My Docs\\项目';
  // 宿主 projectKey 会把空格转成 ~0020，我们自己不算，只要求“记下真实目录”
  const realSlug = '--C-Users-li-My~0020Docs-項目--';
  const oldDir = path.join(home, 'sessions', SLUG, MAIN);
  const realDir = path.join(home, 'sessions', realSlug, MAIN);
  fs.mkdirSync(path.dirname(realDir), { recursive: true });
  fs.renameSync(oldDir, realDir);
  writeJson(path.join(home, 'storages', 'workspace.json'), {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, defaultWorkspaceId: 'ws-2', workspaceIds: ['ws-2'], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { 'ws-2': { path: spaceCwd, title: 'My Docs', sessionIds: [MAIN] } } },
  });

  const removed = await moveToTrash(MAIN, { title: 'x', cwd: spaceCwd });
  assert.equal(removed.ok, true);

  // meta 必须记下绝对路径与 cwd，还原时不需要猜 slug
  const meta = readTrashMeta(removed.entry, MAIN);
  assert.equal(meta.ok, true);
  assert.equal(meta.meta.sessionDir, realDir);
  assert.equal(meta.meta.cwd, spaceCwd);

  const restored = await restoreFromTrash(removed.entry, MAIN);
  assert.equal(restored.ok, true);
  assert.equal(restored.target, realDir);
  assert.equal(fs.existsSync(path.join(realDir, 'session.v4.jsonl.zstd')), true);
});
test('只有投影缓存、没有日志目录的会话：也能进回收站并还原', async () => {
  const home = fixture();
  // CACHE_ONLY 只有缓存
  const removed = await moveToTrash(CACHE_ONLY, { title: '孤儿缓存' });
  assert.equal(removed.ok, true);
  assert.equal(removed.movedSession, false);
  assert.equal(removed.movedCache, true);
  assert.equal(fs.existsSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${CACHE_ONLY}.json`)), false);

  const trash = listTrash().find((item) => item.id === CACHE_ONLY);
  assert.ok(trash);
  assert.equal(trash.hasSession, false);
  assert.equal(trash.hasCache, true);

  // 没有 sessionDir 时还原必须明确报 no-target，而不是瞎猜目录
  const restored = await restoreFromTrash(trash.entry, CACHE_ONLY);
  assert.equal(restored.ok, false);
  assert.equal(restored.code, 'no-target');
});

test('登记表里有、磁盘上没日志：拒绝降级删除', async () => {
  fixture();
  // REGISTRY_ONLY 在 workspace.json 里，但磁盘上没有对应目录
  const result = await moveToTrash(REGISTRY_ONLY, {});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'dir-missing');
});

test('workspace.json 损坏时 strip 返回 false，不抛异常', async () => {
  const home = fixture();
  writeJson(path.join(home, 'storages', 'workspace.json'), 'not-json-at-all');
  const result = await moveToTrash(MAIN, { title: 'x' });
  // 文件搬家仍然成功，但登记清理会失败 —— 调用方据此给出 warning
  assert.equal(result.ok, true);
  assert.equal(result.stripped, false);
});

test('同一会话连删两次：第二次返回 not-found，不产生空条目', async () => {
  fixture();
  const first = await moveToTrash(MAIN, { title: 'x' });
  assert.equal(first.ok, true);
  const second = await moveToTrash(MAIN, { title: 'x' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'not-found');
  assert.equal(listTrash().length, 1);
});

test('清理孤儿：扫描降级时拒绝执行', async () => {
  const home = fixture();
  // 造一个读不出来的目录：用文件冒充 sessions 目录
  fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true });
  fs.writeFileSync(path.join(home, 'sessions'), 'not-a-directory');
  const result = cleanOrphans();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'scan-degraded');
});

test('sweepReappearedCache：被写回的缓存会被再次搬走', async () => {
  const home = fixture();
  const removed = await moveToTrash(MAIN, { title: 'x' });
  assert.equal(removed.ok, true);
  // 模拟 dispose 之后又把缓存写回来
  const cacheFile = path.join(home, 'storages', 'session_projcache', 'sessions', `${MAIN}.json`);
  fs.writeFileSync(cacheFile, '{"record":{}}', 'utf8');
  const swept = await sweepReappearedCache(removed.entry, MAIN, 1);
  assert.equal(swept.swept, 1);
  assert.equal(fs.existsSync(cacheFile), false);
});

test('guard 的纯函数部分：只认回环地址与本机 Host', () => {
  assert.equal(internals.isLoopbackAddress('127.0.0.1'), true);
  assert.equal(internals.isLoopbackAddress('::1'), true);
  assert.equal(internals.isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(internals.isLoopbackAddress('192.168.1.5'), false);
  assert.equal(internals.isLoopbackAddress(undefined), false);

  assert.equal(internals.isLocalHostHeader('127.0.0.1:52486'), true);
  assert.equal(internals.isLocalHostHeader('localhost'), true);
  assert.equal(internals.isLocalHostHeader('[::1]:1234'), true);
  assert.equal(internals.isLocalHostHeader('evil.example.com'), false);
  assert.equal(internals.isLocalHostHeader(''), false);
});


// ── 子代理会话（裸 uuid 目录名）相关用例 ─────────────────────────────────
// 这一组是 1.0.0 发布后发现的真实缺陷：宿主用 encodeSegment(id) 生成目录名，
// 子代理会话的 id 是裸 uuid（没有 session- 前缀），旧的 startsWith('session-') 会把它们全部漏掉。

const CHILD_UUID = '8445b302-d5ec-49dc-aaa9-41eabbc8265f';
const TILDE_ID = 'session-a~0020b-1111-2222-3333-444444444444';

test('裸 uuid 的子会话目录会被扫描到，并标记为 child', () => {
  const home = fixture();
  const childDir = path.join(home, 'sessions', SLUG, CHILD_UUID);
  fs.mkdirSync(childDir, { recursive: true });
  fs.writeFileSync(path.join(childDir, 'session.v4.jsonl.zstd'), 'child-log');

  const dirs = scanSessionDirs();
  const child = dirs.find((item) => item.id === CHILD_UUID);
  assert.ok(child, '必须扫到裸 uuid 目录');
  assert.equal(child.kind, 'child');
  assert.equal(child.dir, childDir);

  // snapshot 也要算进去，并且不能把它当成孤儿
  const state = snapshot();
  assert.equal(state.sessions.length, 3, 'MAIN + ARCHIVED + 子会话');
  assert.deepEqual(state.orphans.cacheOnly.map((o) => o.id), [CACHE_ONLY], '子会话不应被算作孤儿缓存');
});

test('不含日志文件的目录不会被当成会话', () => {
  const home = fixture();
  const emptyDir = path.join(home, 'sessions', SLUG, 'not-a-session');
  fs.mkdirSync(emptyDir, { recursive: true });
  fs.writeFileSync(path.join(emptyDir, 'readme.txt'), 'no log here');

  const ids = scanSessionDirs().map((item) => item.id);
  assert.equal(ids.includes('not-a-session'), false);
});

test('被 encodeSegment 编码出 ~XXXX 的会话目录也能识别', () => {
  const home = fixture();
  const encodedDir = path.join(home, 'sessions', SLUG, TILDE_ID);
  fs.mkdirSync(encodedDir, { recursive: true });
  fs.writeFileSync(path.join(encodedDir, 'session.v4.jsonl.zstd'), 'encoded-log');

  const found = scanSessionDirs().find((item) => item.id === TILDE_ID);
  assert.ok(found, '必须扫到 ~XXXX 编码的目录');
  assert.equal(found.kind, 'session');
});

test('子代理会话可以删除并还原（走同一套回收站）', async () => {
  const home = fixture();
  const childDir = path.join(home, 'sessions', SLUG, CHILD_UUID);
  fs.mkdirSync(childDir, { recursive: true });
  fs.writeFileSync(path.join(childDir, 'session.v4.jsonl.zstd'), 'child-log');

  const removed = await moveToTrash(CHILD_UUID, { title: '子会话', cwd: WS_PATH });
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(childDir), false);

  const meta = readTrashMeta(removed.entry, CHILD_UUID);
  assert.equal(meta.meta.sessionDir, childDir);

  const restored = await restoreFromTrash(removed.entry, CHILD_UUID);
  assert.equal(restored.ok, true);
  assert.equal(fs.existsSync(path.join(childDir, 'session.v4.jsonl.zstd')), true);
});

test('会话 id 白名单：接受裸 uuid 与 ~XXXX，拒绝路径穿越', () => {
  // 与 index.js 的 SESSION_ID_RE 保持一致：允许字母数字与 ._-~，禁止 .. 与分隔符
  const valid = (id) => /^(?!.*\.\.)[A-Za-z0-9._~-]{6,200}$/.test(id);

  for (const id of [
    'session-742f6498-c326-46dc-9b32-3fed25b14313',
    '8445b302-d5ec-49dc-aaa9-41eabbc8265f',
    'session-a~0020b-1111-2222-3333-444444444444',
  ]) {
    assert.equal(valid(id), true, `${id} 应通过`);
  }

  for (const id of ['../../etc/passwd', 'a/b', 'a\\b', '..', 'session-..-x', '', 'short']) {
    assert.equal(valid(id), false, `${id} 应被拒绝`);
  }
});

test('彻底删除单条后，时间戳目录不残留空壳', async () => {
  const home = fixture();
  const removed = await moveToTrash(MAIN, { title: 'x' });
  assert.equal(removed.ok, true);
  const stampDir = path.join(home, 'trash', removed.entry);
  assert.equal(fs.existsSync(stampDir), true);

  const purged = purgeFromTrash(removed.entry, MAIN);
  assert.equal(purged.ok, true);
  assert.equal(fs.existsSync(stampDir), false, '空的条目目录应被一并清掉');
  assert.equal(listTrash().length, 0);
});
// ── 修复回归：读不到目录 / 轮数未知 ─────────────────────────────────────

test('会话目录读不出来时：标记 degraded，且不把它算成孤儿', async () => {
  const home = fixture();
  const dirs = path.join(home, 'sessions', SLUG);
  const broken = path.join(dirs, MAIN);

  // 模拟：这个目录存在，但读它的内容会抛 EACCES
  const listDir = (dir) => {
    if (path.resolve(dir) === path.resolve(broken)) {
      const error = new Error('EACCES: permission denied');
      error.code = 'EACCES';
      throw error;
    }
    return fs.readdirSync(dir, { withFileTypes: true });
  };

  const scan = scanSession({ listDir });
  assert.equal(scan.dirs.length, 1, '另一个会话仍应被扫到');
  assert.equal(scan.unreadable.length, 1, '读不出来的目录要被单独记录');
  assert.equal(scan.unreadable[0].id, MAIN);

  const state = snapshot({ listDir });
  assert.equal(state.degraded, true, '必须标记为降级');
  assert.equal(state.orphans.registryOnly.length, 0, '降级时不能把登记判成孤儿');
  assert.equal(
    state.orphans.cacheOnly.some((item) => item.id === MAIN),
    false,
    '读不出来的会话，其缓存不能被当成孤儿缓存',
  );

  // 降级时清理必须拒绝
  const cleaned = cleanOrphans();
  void cleaned;
  assert.equal(state.degraded, true);
});

test('ENOENT（目录不存在）不算降级', () => {
  const home = fixture();
  fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true });
  const state = snapshot();
  assert.equal(state.degraded, false);
  assert.equal(state.sessions.length, 0);
});

test('轮数未知（没有投影缓存）不算“0 轮空会话”', async () => {
  const home = fixture();
  // 删掉 MAIN 的投影缓存 → turns 变 null，但日志还在
  fs.rmSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${MAIN}.json`), { force: true });

  const state = snapshot();
  const target = state.sessions.find((item) => item.id === MAIN);
  assert.ok(target, '会话本身仍应存在');
  assert.equal(target.turns, null, '轮数应为未知而不是 0');

  const candidates = idleCandidates(0, true);
  assert.equal(
    candidates.some((item) => item.id === MAIN),
    false,
    '轮数未知的会话不应进入「只看空会话」的候选',
  );

  // 不限定空会话时，仍然可以被按天数清理选中
  const all = idleCandidates(0, false);
  assert.equal(all.some((item) => item.id === MAIN), true);
  assert.equal(all.find((item) => item.id === MAIN).turns, null);
});

test('轮数为 0 的空会话仍会被选中', async () => {
  const home = fixture();
  const cache = path.join(home, 'storages', 'session_projcache', 'sessions', `${MAIN}.json`);
  const doc = JSON.parse(fs.readFileSync(cache, 'utf8'));
  doc.record.rows.sessionStats = { val: { turns: 0 } };
  fs.writeFileSync(cache, JSON.stringify(doc), 'utf8');

  const candidates = idleCandidates(0, true);
  assert.equal(candidates.some((item) => item.id === MAIN), true);
});

test('stripRegistry:false 时不写 workspace.json（避免覆盖宿主的并发修改）', async () => {
  const home = fixture();
  const before = fs.readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8');

  const removed = await moveToTrash(MAIN, { title: 'x', stripRegistry: false });
  assert.equal(removed.ok, true);
  assert.equal(removed.stripped, null, '不应执行文件层摘除');

  const after = fs.readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8');
  assert.equal(after, before, 'workspace.json 必须保持原样');

  // 而默认行为仍然会摘除（离线/服务不可用时依赖它）
  const second = await moveToTrash(ARCHIVED, { title: 'y' });
  assert.equal(second.ok, true);
  assert.equal(typeof second.stripped, 'boolean');
});
test('还原半失败会回滚：缓存搬不回去时，日志退回回收站', async () => {
  const home = fixture();
  const removed = await moveToTrash(ARCHIVED, { title: '会被回滚的会话' });
  assert.equal(removed.ok, true);
  const entry = removed.entry;
  const trashSessionDir = path.join(home, 'trash', entry, ARCHIVED, 'session');
  const trashCache = path.join(home, 'trash', entry, ARCHIVED, `${ARCHIVED}.json`);
  assert.equal(fs.existsSync(trashSessionDir), true, '回收站里应有日志');
  assert.equal(fs.existsSync(trashCache), true, '回收站里应有缓存');

  // 注入：日志能搬回去，缓存搬运失败
  let calls = 0;
  const rename = async (from, to) => {
    calls += 1;
    if (calls === 2) throw new Error('模拟缓存搬运失败');
    fs.renameSync(from, to);
  };

  const restored = await restoreFromTrash(entry, ARCHIVED, { rename });
  assert.equal(restored.ok, false);
  assert.equal(restored.code, 'restore-failed');

  // 关键断言：日志必须退回回收站，不能半还原
  const target = path.join(home, 'sessions', SLUG, ARCHIVED);
  assert.equal(fs.existsSync(target), false, '目标位置不应残留半还原的日志');
  assert.equal(fs.existsSync(trashSessionDir), true, '日志应退回回收站');
  assert.equal(listTrash().length, 1, '回收站条目仍在');
});

test('只留在归档集合里的 id 会被算作孤儿登记', () => {
  const home = fixture();
  // 直接删掉磁盘上的会话目录，只保留 workspace.json 里的归档记录
  fs.rmSync(path.join(home, 'sessions', SLUG, ARCHIVED), { recursive: true, force: true });
  fs.rmSync(path.join(home, 'storages', 'session_projcache', 'sessions', `${ARCHIVED}.json`), { force: true });

  const state = snapshot();
  assert.equal(
    state.orphans.registryOnly.includes(ARCHIVED),
    true,
    '归档集合里的孤儿也必须被列出来',
  );
});

test('缓存回滚失败时保留冲突备份，继续回滚日志并明确报错', async () => {
  const home = fixture();
  const removed = await moveToTrash(MAIN);
  const cache = path.join(home, 'storages', 'session_projcache', 'sessions', `${MAIN}.json`);
  const stash = path.join(home, 'trash', removed.entry, MAIN);
  const original = fs.readFileSync(path.join(stash, `${MAIN}.json`), 'utf8');
  fs.writeFileSync(cache, 'existing-cache');
  const restored = await restoreFromTrash(removed.entry, MAIN, {
    async onRestored() { throw new Error('admission failed'); },
    async rename(from, to) {
      if (from === cache) throw new Error('cache locked');
      fs.renameSync(from, to);
    },
  });
  assert.equal(restored.ok, false);
  assert.match(restored.error, /部分文件回滚失败/);
  assert.equal(fs.readFileSync(cache, 'utf8'), original);
  const backup = fs.readdirSync(path.dirname(cache)).find((name) => name.startsWith(`${MAIN}.json.conflict-`));
  assert.ok(backup);
  assert.equal(fs.readFileSync(path.join(path.dirname(cache), backup), 'utf8'), 'existing-cache');
  assert.equal(fs.existsSync(path.join(stash, 'session')), true);
  assert.equal(fs.existsSync(path.join(home, 'sessions', SLUG, MAIN)), false);
});

test('stripFlagsFromRegistry 只摘标记，不动归属', () => {
  const home = fixture();
  const before = readRegistry();
  assert.equal(before.archived.has(ARCHIVED), true);

  const changed = stripFlagsFromRegistry([ARCHIVED]);
  assert.equal(changed, true);

  const after = readRegistry();
  assert.equal(after.archived.has(ARCHIVED), false, '归档标记应被清掉');
  assert.equal(after.sessionIds.includes(ARCHIVED), true, '归属不应被删');
  void home;
});
