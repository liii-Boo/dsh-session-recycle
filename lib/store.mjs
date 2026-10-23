/**
 * 会话存储原语：只读写文件系统，不依赖 cordis，可以脱离 DSH 单独测试。
 *
 * DSH 的“一个会话”散落在三处，任何删除/恢复都必须同时处理，否则侧栏会出现
 * 幽灵行、掉进“未分组”，或者标题/轮数变成空白：
 *
 *   1. ~/.dsh/sessions/<工作区slug>/session-<uuid>/session.v4.jsonl.zstd  会话日志本体
 *   2. ~/.dsh/storages/workspace.json                                     归属登记（tables.workspaces[].sessionIds）
 *                                                                           以及归档/置顶集合（global.archivedSessionIds / pinnedSessionIds）
 *   3. ~/.dsh/storages/session_projcache/sessions/session-<uuid>.json     投影缓存（标题、轮数、最后提问时间）
 *
 * 删除 = 移进 ~/.dsh/trash/<时间戳>/<sessionId>/（session/ + <id>.json + meta.json），
 * 因此删除永远可逆；purge 才是真删。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** DSH 主目录：优先 DSH_HOME，其次 ~/.dsh。 */
export function dshHome() {
  const raw = process.env.DSH_HOME;
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return path.join(os.homedir(), '.dsh');
}

/** 全部相关路径。每次调用都重新读 DSH_HOME，便于测试时切换临时目录。 */
export function locations() {
  const home = dshHome();
  return {
    home,
    sessions: path.join(home, 'sessions'),
    trash: path.join(home, 'trash'),
    registry: path.join(home, 'storages', 'workspace.json'),
    proj: path.join(home, 'storages', 'session_projcache', 'sessions'),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 时间戳目录名（回收站条目名）：2026-10-23T06-12-33-123Z，同毫秒撞车时加 -2、-3 */
function stampNow() {
  const base = new Date().toISOString().replace(/[:.]/g, '-');
  const { trash } = locations();
  let candidate = base;
  let counter = 1;
  while (fs.existsSync(path.join(trash, candidate))) {
    counter += 1;
    candidate = `${base}-${counter}`;
    if (counter > 999) break;
  }
  return candidate;
}

/**
 * 回收站条目名的合法形态。凡是从客户端传进来的 `entry` 都必须先过这一关：
 * 它会被拼进路径，不校验就等于把 `../..` 交给调用方（路径穿越）。
 */
export const TRASH_ENTRY_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z(-\d+)?$/;

/**
 * 搬目录/搬文件，对 Windows 的文件占用做重试。
 *
 * 宿主可能还没关掉 jsonl 的写句柄（detach 之后到真正释放之间有窗口），
 * 这时 rename 会拿到 EBUSY / EPERM；重试几轮通常就过了。
 */
async function renameWithRetry(from, to, attempts = 10, delayMs = 150) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      const code = error?.code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTEMPTY') break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/** 目录体积与最近修改时间 */
function measure(dir) {
  let bytes = 0;
  let mtime = 0;
  let stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        bytes += stat.size;
        mtime = Math.max(mtime, stat.mtimeMs);
      } catch {
        /* 单个文件读不到不影响整体统计 */
      }
    }
  }
  return { bytes, mtime };
}

// ── workspace.json ──────────────────────────────────────────────────────────

/** 读出登记表（结构不合法时返回空骨架，不抛错）。 */
export function readRegistry() {
  const { registry } = locations();
  const doc = readJson(registry);
  if (doc === null || typeof doc !== 'object') {
    return { doc: null, workspaces: [], sessionIds: [], archived: new Set(), pinned: new Set() };
  }
  const tables = doc.tables?.workspaces ?? {};
  const workspaces = Object.entries(tables).map(([id, workspace]) => ({
    id,
    path: typeof workspace?.path === 'string' ? workspace.path : '',
    title: typeof workspace?.title === 'string' ? workspace.title : '',
    sessionIds: Array.isArray(workspace?.sessionIds) ? [...workspace.sessionIds] : [],
  }));
  return {
    doc,
    workspaces,
    sessionIds: workspaces.flatMap((workspace) => workspace.sessionIds),
    archived: new Set(Array.isArray(doc.global?.archivedSessionIds) ? doc.global.archivedSessionIds : []),
    pinned: new Set(Array.isArray(doc.global?.pinnedSessionIds) ? doc.global.pinnedSessionIds : []),
  };
}

/** 读-改-写登记表；没有任何变化时不落盘，返回 false。 */
export function mutateRegistry(mutator) {
  const { registry } = locations();
  const doc = readJson(registry);
  if (doc === null || typeof doc !== 'object') return false;
  const before = JSON.stringify(doc);
  mutator(doc);
  if (JSON.stringify(doc) === before) return false;
  writeJsonAtomic(registry, doc);
  return true;
}

/** 把会话彻底从登记表摘掉（归属 + 归档/置顶）。 */
export function stripFromRegistry(ids) {
  const set = new Set(ids);
  return mutateRegistry((doc) => {
    const global = doc.global ?? (doc.global = {});
    if (Array.isArray(global.archivedSessionIds)) {
      global.archivedSessionIds = global.archivedSessionIds.filter((id) => !set.has(id));
    }
    if (Array.isArray(global.pinnedSessionIds)) {
      global.pinnedSessionIds = global.pinnedSessionIds.filter((id) => !set.has(id));
    }
    for (const workspace of Object.values(doc.tables?.workspaces ?? {})) {
      if (Array.isArray(workspace.sessionIds)) {
        workspace.sessionIds = workspace.sessionIds.filter((id) => !set.has(id));
      }
    }
  });
}


/**
 * 只摘掉归档 / 置顶标记，不动归属。
 *
 * 用途：`workspaceRegistry.detachSession` 成功、但 `unarchiveSession` / `unpinSession`
 * 失败时，id 会留在 `archivedSessionIds` 里成为一条看不见的孤儿登记。
 */
export function stripFlagsFromRegistry(ids) {
  const set = new Set(ids);
  return mutateRegistry((doc) => {
    const global = doc.global ?? (doc.global = {});
    if (Array.isArray(global.archivedSessionIds)) {
      global.archivedSessionIds = global.archivedSessionIds.filter((id) => !set.has(id));
    }
    if (Array.isArray(global.pinnedSessionIds)) {
      global.pinnedSessionIds = global.pinnedSessionIds.filter((id) => !set.has(id));
    }
  });
}

/**
 * 把会话重新登记到某个工作区，并还原归档 / 置顶标记。
 *
 * **这是离线兜底**：宿主在线时应优先走 `workspaceRegistry`（`resolveByPath` + `attachSession`
 * + `archiveSession`/`pinSession`），因为注册表以**内存快照**为权威，直接改文件会被宿主
 * 下一次写入整文件覆盖。只有服务不可用（纯文件场景、单测）才用这里。
 *
 * 工作区匹配只按 **path 精确比较**，不按目录名反推 —— 宿主的 projectKey 会对空格等
 * 不安全字符做 `~XXXX` 转义，自己算 slug 必然对不上。
 *
 * @param ids - 会话 id 列表。
 * @param flags - { [id]: { archived, pinned } }。
 * @param options - { preferPath }：优先登记到 path 与它相同的工作区。
 */
export function readmitToRegistry(ids, flags = {}, options = {}) {
  const preferPath = typeof options.preferPath === 'string' && options.preferPath !== '' ? options.preferPath : null;
  return mutateRegistry((doc) => {
    const workspaces = Object.values(doc.tables?.workspaces ?? {});
    if (workspaces.length === 0) return;
    const samePath = preferPath === null
      ? void 0
      : workspaces.find((workspace) => typeof workspace.path === 'string'
        && workspace.path.replace(/[\\/]+$/, '').toLowerCase() === preferPath.replace(/[\\/]+$/, '').toLowerCase());
    const target = samePath ?? workspaces[0];
    if (!Array.isArray(target.sessionIds)) target.sessionIds = [];
    for (const id of ids) if (!target.sessionIds.includes(id)) target.sessionIds.push(id);

    const global = doc.global ?? (doc.global = {});
    const archived = new Set(Array.isArray(global.archivedSessionIds) ? global.archivedSessionIds : []);
    const pinned = new Set(Array.isArray(global.pinnedSessionIds) ? global.pinnedSessionIds : []);
    for (const id of ids) {
      const flag = flags[id] ?? {};
      if (flag.archived === true) {
        archived.add(id);
        pinned.delete(id);
      }
      if (flag.pinned === true) {
        pinned.add(id);
        archived.delete(id);
      }
    }
    global.archivedSessionIds = [...archived];
    global.pinnedSessionIds = [...pinned];
  });
}
// ── 会话与缓存扫描 ──────────────────────────────────────────────────────────

/**
 * 扫描磁盘上的会话目录：[{ id, dir, slug, kind, bytes, mtime }]
 *
 * **判定方式：目录里有没有会话日志文件**，而不是看目录名前缀。
 *
 * 之前用 `name.startsWith('session-')` 是错的：宿主的 `sessionDir()` 会对 id 做
 * `encodeSegment()`，普通会话是 `session-<uuid>`，而**子代理会话的 id 是裸 uuid**
 * （形如 `8445b302-d5ec-…`），特殊字符还会被编码成 `~XXXX`。按前缀过滤会把它们
 * 整个漏掉 —— 表现为"侧栏里看不见、插件也数不到，但磁盘上确实占着空间"，
 * 而且它们的缓存会被误判成孤儿。
 *
 * 只有 `ENOENT`（目录还没建）才允许当作“没有会话”；
 * 其他错误（权限、占用、IO）必须抛出去 —— 把读不到当成不存在，
 * 会让上层把整片会话判成孤儿、进而误删登记。
 */
export function scanSessionDirs(options = {}) {
  return scanSession(options).dirs;
}

/**
 * 扫描并区分「读不到的目录」。
 *
 * 关键：**读不到 ≠ 不存在**。某个会话目录因为权限或占用读不出来时，如果当成
 * “这里没有会话”，它的投影缓存就会被判成孤儿、进而被清理掉——原始聊天日志还在，
 * 但登记和缓存没了，会话表现为消失。所以这类目录必须单独收集，让上层置 degraded
 * 并拒绝执行清理。
 *
 * @param options - { listDir } 注入目录读取函数，便于测试模拟 EACCES。
 * @returns { dirs, unreadable: [{ dir, error }] }
 */
export function scanSession(options = {}) {
  const listDir = typeof options.listDir === 'function' ? options.listDir : defaultListDir;
  const { sessions } = locations();
  const dirs = [];
  const unreadable = [];
  let spaces;
  try {
    spaces = fs.readdirSync(sessions, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { dirs, unreadable };
    throw error;
  }
  for (const space of spaces) {
    if (!space.isDirectory()) continue;
    const spaceDir = path.join(sessions, space.name);
    let entries;
    try {
      entries = fs.readdirSync(spaceDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(spaceDir, entry.name);
      let kind;
      try {
        kind = classifySessionDir(dir, entry.name, listDir);
      } catch (error) {
        // 读不出来：记下来，不当作“不存在”
        unreadable.push({ id: entry.name, dir, error: String(error?.message ?? error) });
        continue;
      }
      if (kind === null) continue;
      const { bytes, mtime } = measure(dir);
      dirs.push({ id: entry.name, dir, slug: space.name, kind, bytes, mtime });
    }
  }
  return { dirs, unreadable };
}

/** 默认的目录读取函数。 */
function defaultListDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true });
}

/** 会话日志文件名：session.v4.jsonl.zstd / session.v4.jsonl 等（版本与压缩可变）。 */
const SESSION_LOG_RE = /^session\.v\d+\.jsonl(\.zstd|\.gz)?$/;

/**
 * 判断一个目录是不是会话目录，返回类型。
 *
 * 判据是**目录内容**而不是名字：
 *   - 子代理会话的目录名是裸 uuid，没有 `session-` 前缀
 *   - id 里的特殊字符会被 encodeSegment 编码成 `~XXXX`
 * 所以只认“里面有会话日志文件”这一条。
 *
 * @returns `"session"` 普通会话 / `"child"` 形似 uuid 的会话 / `null` 不是会话目录
 */
export function classifySessionDir(dir, name, listDir = defaultListDir) {
  let entries;
  try {
    entries = listDir(dir);
  } catch (error) {
    // 只有“目录不存在”可以静默；权限/占用必须抛出去，交给上层置 degraded
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let hasLog = false;
  for (const entry of entries) {
    if (entry.isFile() && SESSION_LOG_RE.test(entry.name)) {
      hasLog = true;
      break;
    }
  }
  if (!hasLog) return null;
  return name.startsWith('session-') ? 'session' : 'child';
}

/** 投影缓存里的元数据：标题 / 最后提问时间 / 轮数 / 工作目录。 */
export function readProjMeta(id) {
  const { proj } = locations();
  const file = path.join(proj, `${id}.json`);
  const doc = readJson(file);
  if (doc === null) {
    return {
      hasCache: fs.existsSync(file),
      title: null,
      lastAt: null,
      turns: null,
      cwd: null,
    };
  }
  const rows = doc.record?.rows ?? {};
  return {
    hasCache: true,
    title: typeof rows.title?.val === 'string' ? rows.title.val : null,
    lastAt: typeof rows.sessionListMetadata?.val?.lastPromptAt === 'number' ? rows.sessionListMetadata.val.lastPromptAt : null,
    turns: typeof rows.sessionStats?.val?.turns === 'number' ? rows.sessionStats.val.turns : null,
    cwd: typeof doc.record?.identity?.cwd === 'string' ? doc.record.identity.cwd : null,
  };
}

/** 按 id 找会话目录（跨工作区）。 */
export function findSessionDir(id) {
  return scanSessionDirs().find((session) => session.id === id) ?? null;
}

/**
 * 全量快照：会话列表 + 两类孤儿 + 回收站。
 * 孤儿分两类，处理方式不同：
 *   - cacheOnly：只有投影缓存、日志目录没了 → 删缓存文件即可
 *   - registryOnly：登记表里有、磁盘上没日志 → 从登记表摘掉即可
 */
export function snapshot(options = {}) {
  const registry = readRegistry();
  let dirs = [];
  let unreadable = [];
  let degraded = false;
  let degradedError = null;
  try {
    const scan = scanSession(options);
    dirs = scan.dirs;
    unreadable = scan.unreadable;
    if (unreadable.length > 0) {
      // 有会话目录读不出来：不能把它当成“没有会话”，否则它的缓存会被判成孤儿删掉
      degraded = true;
      degradedError = `有 ${unreadable.length} 个会话目录读不出来：${unreadable[0].error}`;
    }
  } catch (error) {
    // 扫描失败时绝不能把“读不到”当成“不存在”：那会让 cleanOrphans 摘掉整片登记。
    degraded = true;
    degradedError = String(error?.message ?? error);
  }
  const byId = new Map();
  for (const dir of dirs) {
    const meta = readProjMeta(dir.id);
    byId.set(dir.id, {
      id: dir.id,
      slug: dir.slug,
      dir: dir.dir,
      // kind 用来在界面上区分普通会话与子代理会话（后者目录名是裸 uuid）
      kind: dir.kind ?? 'session',
      dirExists: true,
      bytes: dir.bytes,
      mtime: dir.mtime,
      ...meta,
    });
  }
  const cacheOnly = [];
  const { proj } = locations();
  let cacheFiles = [];
  try {
    cacheFiles = fs.readdirSync(proj);
  } catch {
    cacheFiles = [];
  }
  const unreadableIds = new Set(unreadable.map((item) => item.id));
  for (const file of cacheFiles) {
    // 不能只看 `session-` 前缀：子代理会话的缓存文件名是裸 uuid（`8445b302-….json`），
    // 漏掉这一条会让它们的缓存被误判成孤儿、进而被清理掉。
    if (!file.endsWith('.json')) continue;
    const id = file.slice(0, -'.json'.length);
    if (id === '' || !/[A-Za-z0-9]/.test(id)) continue;
    if (byId.has(id)) continue;
    // 目录读不出来的会话：缓存不算孤儿（日志还在，只是这一刻读不到）
    if (unreadableIds.has(id)) continue;
    const meta = readProjMeta(id);
    cacheOnly.push({ id, bytes: 0, ...meta });
  }
  // 孤儿登记还包括「只留在归档/置顶集合里」的 id：那类会话在界面上看不见，
  // 如果只统计 workspaces[].sessionIds 就会漏掉。
  const registeredButMissing = degraded
    ? []
    : [...new Set([
      ...registry.sessionIds,
      ...registry.archived,
      ...registry.pinned,
    ])].filter((id) => !byId.has(id));

  const sessions = [...byId.values()]
    .map((session) => ({
      ...session,
      archived: registry.archived.has(session.id),
      pinned: registry.pinned.has(session.id),
      registered: registry.sessionIds.includes(session.id),
    }))
    .sort((a, b) => (b.lastAt ?? b.mtime ?? 0) - (a.lastAt ?? a.mtime ?? 0));

  return {
    home: locations().home,
    degraded,
    degradedError,
    unreadable,
    sessions,
    orphans: { cacheOnly, registryOnly: [...new Set(registeredButMissing)] },
    trash: listTrash(),
  };
}

// ── 回收站 ──────────────────────────────────────────────────────────────────

/** 回收站条目：[{ entry, id, title, removedAt, bytes, slug, archived, pinned, hasSession, hasCache }] */
export function listTrash() {
  const { trash } = locations();
  const entries = [];
  let stamps = [];
  try {
    stamps = fs.readdirSync(trash, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name);
  } catch {
    return entries;
  }
  for (const stamp of stamps) {
    const stampDir = path.join(trash, stamp);
    let items = [];
    try {
      items = fs.readdirSync(stampDir, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name);
    } catch {
      continue;
    }
    for (const id of items) {
      const dir = path.join(stampDir, id);
      const meta = readJson(path.join(dir, 'meta.json')) ?? {};
      const { bytes } = measure(dir);
      entries.push({
        entry: stamp,
        id,
        title: typeof meta.title === 'string' ? meta.title : null,
        removedAt: typeof meta.removedAt === 'string' ? meta.removedAt : null,
        slug: typeof meta.wsSlug === 'string' ? meta.wsSlug : null,
        archived: meta.archived === true,
        pinned: meta.pinned === true,
        bytes,
        hasSession: fs.existsSync(path.join(dir, 'session')),
        hasCache: fs.existsSync(path.join(dir, `${id}.json`)),
      });
    }
  }
  return entries.sort((a, b) => String(b.removedAt ?? b.entry).localeCompare(String(a.removedAt ?? a.entry)));
}

/**
 * 删除（进回收站）。
 * @param id - 会话 id（目录名，session-<uuid>）。
 * @param extra - { title, archived, pinned }，会写进 meta.json 供还原时使用。
 */
export async function moveToTrash(id, extra = {}) {
  const L = locations();
  let scan;
  try {
    scan = scanSession();
  } catch (error) {
    return { ok: false, removed: false, code: 'scan-degraded', error: `扫描会话目录失败：${String(error?.message ?? error)}` };
  }
  // 目标目录读不出来时，不能当成“不存在”去只搬缓存——那会把日志留在磁盘上却报告已删除
  if (scan.unreadable.some((item) => item.id === id)) {
    return {
      ok: false,
      removed: false,
      code: 'dir-unreadable',
      error: `会话 ${id} 的目录读不出来（可能被占用或权限不足），未做任何改动`,
    };
  }
  const located = scan.dirs.find((item) => item.id === id) ?? null;
  const cacheFile = path.join(L.proj, `${id}.json`);
  const hasCache = fs.existsSync(cacheFile);
  const registry = readRegistry();
  const knownToLedger = registry.sessionIds.includes(id) || registry.archived.has(id) || registry.pinned.has(id);
  if (located === null) {
    if (knownToLedger) {
      // 登记表说它在，磁盘上却扫不到：多半是权限或占用，绝不当成“已删除”继续搬缓存
      return {
        ok: false,
        removed: false,
        code: 'dir-missing',
        error: `登记表里有 ${id}，但磁盘上找不到日志目录；未做任何改动`,
      };
    }
    if (!hasCache) {
      return { ok: false, removed: false, code: 'not-found', error: `找不到会话 ${id}` };
    }
  }
  const entry = stampNow();
  const dest = path.join(L.trash, entry, id);
  const sessionStash = path.join(dest, 'session');
  const cacheStash = path.join(dest, `${id}.json`);
  let movedSession = false;
  let movedCache = false;
  try {
    fs.mkdirSync(dest, { recursive: true });
    // meta.json 先写：还原完全依赖它（标题、slug、归档/置顶标记），
    // 先写才能在后面任何一步失败时把已搬的部分退回去。
    const meta = {
      id,
      title: typeof extra.title === 'string' ? extra.title : null,
      wsSlug: located?.slug ?? null,
      // 绝对路径：还原时直接用，不再重算 slug（宿主的 projectKey 有 ~XXXX 转义，自己算会错）
      sessionDir: located?.dir ?? null,
      // 会话的工作目录：还原时用它向 workspaceRegistry 解析工作区
      cwd: typeof extra.cwd === 'string' ? extra.cwd : null,
      archived: extra.archived === true,
      pinned: extra.pinned === true,
      removedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    if (located !== null) {
      await renameWithRetry(located.dir, sessionStash);
      movedSession = true;
    }
    if (hasCache) {
      await renameWithRetry(cacheFile, cacheStash);
      movedCache = true;
    }
  } catch (error) {
    // 回滚：宁可保持原样，也不要留下“日志搬走了但缓存还在”的半成品
    try {
      if (movedCache) fs.renameSync(cacheStash, cacheFile);
      if (movedSession && located !== null) fs.renameSync(sessionStash, located.dir);
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      /* 回滚失败时保留现场，错误信息里带上 entry 便于人工处理 */
    }
    return {
      ok: false,
      removed: false,
      code: 'move-failed',
      error: String(error),
      entry,
      partial: { movedSession, movedCache },
    };
  }
  // 文件层摘除登记只是兜底：宿主在线时应由 workspaceRegistry 服务完成，
  // 否则插件的「读-改-写」可能覆盖宿主在同一时刻写入的其它变更（如新建工作区）。
  // 调用方通过 extra.stripRegistry === false 关掉它。
  const stripped = extra.stripRegistry === false ? null : stripFromRegistry([id]);
  return { ok: true, removed: true, entry, id, stripped, movedSession, movedCache };
}

/**
 * 从回收站还原一个会话：文件搬回去 + 重新登记 + 还原归档/置顶标记。
 * @param entry - 回收站条目名（时间戳目录）。
 * @param id - 会话 id。
 */
/**
 * 从回收站还原文件。
 *
 * 目标目录由宿主提供（`sessionPersistence.locate({ id, cwd })` → dirname），或直接用
 * 删除时记录在 `meta.sessionDir` 的绝对路径。**不自己算 slug**：宿主 projectKey 会给空格等
 * 不安全字符做 `~XXXX` 转义，自己算必然落到宿主永远找不到的目录名。
 *
 * @param entry - 回收站条目名。
 * @param id - 会话 id。
 * @param options - { sessionDir?, onRestored? }
 *   - sessionDir：权威目标目录（宿主在线时必须由宿主给）
 *   - onRestored(id, meta, target)：文件搬完后的回调，宿主用它走 workspaceRegistry 登记
 * @returns { ok, id, target, restoredFiles, meta, admission } 或 { ok:false, code, error }
 */
export async function restoreFromTrash(entry, id, options = {}) {
  const L = locations();
  if (!TRASH_ENTRY_RE.test(String(entry))) return { ok: false, code: 'invalid-entry', error: '回收站条目名不合法' };
  const src = path.join(L.trash, entry, id);
  if (!fs.existsSync(src)) return { ok: false, code: 'not-found', error: `回收站里没有 ${entry}/${id}` };
  const meta = readJson(path.join(src, 'meta.json')) ?? {};

  const explicit = typeof options.sessionDir === 'string' && options.sessionDir !== '' ? options.sessionDir : null;
  const recorded = typeof meta.sessionDir === 'string' && meta.sessionDir !== '' ? meta.sessionDir : null;
  const target = explicit ?? recorded;
  if (target === null) {
    return { ok: false, code: 'no-target', error: '缺少目标目录：旧条目没有记录 sessionDir，且宿主未提供定位' };
  }
  if (path.basename(target) !== id) {
    return { ok: false, code: 'invalid-target', error: `目标目录名与会话 id 不一致：${target}` };
  }
  if (fs.existsSync(target)) {
    return { ok: false, code: 'exists', error: '目标位置已经存在同名会话，未做任何改动' };
  }

  const stash = path.join(src, 'session');
  const cacheStash = path.join(src, `${id}.json`);
  const cacheTarget = path.join(L.proj, `${id}.json`);
  // 可注入的搬运函数：测试用来模拟「日志搬回去了、缓存失败」这种半失败
  const move = typeof options.rename === 'function' ? options.rename : renameWithRetry;
  let movedSession = false;
  let conflictBackup = null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(stash)) {
      await move(stash, target);
      movedSession = true;
    }
    if (fs.existsSync(cacheStash)) {
      fs.mkdirSync(L.proj, { recursive: true });
      if (fs.existsSync(cacheTarget)) {
        // 旧缓存留个备份；还原成功后由下面清掉，避免长期堆积 .conflict-* 文件
        conflictBackup = `${cacheTarget}.conflict-${Date.now()}`;
        fs.renameSync(cacheTarget, conflictBackup);
      }
      await move(cacheStash, cacheTarget);
    }
  } catch (error) {
    // 回滚：日志已经搬回去了但缓存失败时，把日志退回回收站，保持“要么都回去，要么都不动”
    try {
      if (movedSession && fs.existsSync(target)) await move(target, stash);
      if (conflictBackup !== null && fs.existsSync(conflictBackup) && !fs.existsSync(cacheTarget)) {
        fs.renameSync(conflictBackup, cacheTarget);
      }
    } catch {
      /* 回滚失败时保留现场，错误信息里带上 entry 便于人工处理 */
    }
    return { ok: false, code: 'restore-failed', error: String(error), entry };
  }

  const restoredFiles = fs.existsSync(target);
  let admission;
  if (typeof options.onRestored === 'function') {
    admission = await options.onRestored(id, meta, target);
  } else {
    // 离线兜底：服务不可用时才直接改登记表，并明确标出这一点
    const registryUpdated = readmitToRegistry(
      [id],
      { [id]: { archived: meta.archived === true, pinned: meta.pinned === true } },
      { preferPath: typeof meta.cwd === 'string' ? meta.cwd : null },
    );
    admission = { viaService: false, registryUpdated };
  }
  if (conflictBackup !== null) {
    try {
      fs.rmSync(conflictBackup, { force: true });
    } catch {
      /* 备份清不掉不影响还原结果 */
    }
  }
  removeTrashItem(entry, id);
  return { ok: true, id, target, restoredFiles, meta, admission };
}
/** 读回收站条目的 meta（还原时宿主需要先用它拿 cwd / sessionDir）。 */
export function readTrashMeta(entry, id) {
  if (!TRASH_ENTRY_RE.test(String(entry))) return { ok: false, code: 'invalid-entry', error: '回收站条目名不合法' };
  const { trash } = locations();
  const file = path.join(trash, entry, id, 'meta.json');
  const meta = readJson(file);
  if (meta === null) return { ok: false, code: 'not-found', error: `回收站里没有 ${entry}/${id}` };
  return { ok: true, meta };
}

/**
 * 把“又被写回来”的投影缓存再次搬进回收站。
 *
 * 宿主 detach 会话时会异步 flush 投影缓存（`session/disposed` → flushSoft → put），
 * 于是可能出现：我们刚把 `<id>.json` 搬走，它紧接着又写出一份。这里在删除后复查几轮，
 * 把新出现的那份也搬走，避免留下幽灵缓存。
 *
 * @returns { swept: 搬了几次 }
 */
export async function sweepReappearedCache(entry, id, rounds = 3) {
  if (!TRASH_ENTRY_RE.test(String(entry))) return { swept: 0 };
  const L = locations();
  const cacheFile = path.join(L.proj, `${id}.json`);
  let swept = 0;
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!fs.existsSync(cacheFile)) continue;
    try {
      await renameWithRetry(cacheFile, path.join(L.trash, entry, id, `${id}.rewritten-${round}.json`));
      swept += 1;
    } catch {
      /* 搬不动就留给孤儿诊断，别把删除本身判失败 */
    }
  }
  return { swept };
}

/** 删掉回收站里的一项（只动回收站）。 */
function removeTrashItem(entry, id) {
  const L = locations();
  const dir = path.join(L.trash, entry, id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略：调用方会重新列一次回收站 */
  }
  try {
    const rest = fs.readdirSync(path.join(L.trash, entry));
    if (rest.length === 0) fs.rmdirSync(path.join(L.trash, entry));
  } catch {
    /* 条目目录已不存在 */
  }
}

/** 从回收站永久删除：id 为 null 时清空整个条目。 */
export function purgeFromTrash(entry, id = null) {
  const L = locations();
  if (!TRASH_ENTRY_RE.test(String(entry))) return { ok: false, code: 'invalid-entry', error: '回收站条目名不合法' };
  const target = id === null ? path.join(L.trash, entry) : path.join(L.trash, entry, id);
  if (!fs.existsSync(target)) return { ok: false, code: 'not-found', error: `回收站里没有 ${target}` };
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    return { ok: false, code: 'purge-failed', error: String(error) };
  }
  // 单条删除后，时间戳目录可能空了：顺手清掉，别在回收站里留空壳
  if (id !== null) {
    try {
      const stampDir = path.join(L.trash, entry);
      if (fs.existsSync(stampDir) && fs.readdirSync(stampDir).length === 0) fs.rmdirSync(stampDir);
    } catch {
      /* 清理失败不影响删除结果 */
    }
  }
  return { ok: true, purged: id ?? entry };
}

/** 清空回收站。 */
export function emptyTrash() {
  const L = locations();
  if (!fs.existsSync(L.trash)) return { ok: true, purged: 0, failed: [] };
  let purged = 0;
  const failed = [];
  for (const stamp of fs.readdirSync(L.trash, { withFileTypes: true })) {
    if (!stamp.isDirectory()) continue;
    try {
      fs.rmSync(path.join(L.trash, stamp.name), { recursive: true, force: true });
      purged += 1;
    } catch (error) {
      // 部分目录被占用时不能报“已清空”
      failed.push({ entry: stamp.name, error: String(error?.message ?? error) });
    }
  }
  // 部分失败时不要报“已清空”：客户端把 ok:false 当失败显示，error 必须能读
  return {
    ok: failed.length === 0,
    purged,
    failed,
    ...(failed.length > 0 ? { code: 'partial', error: `${failed.length} 个条目未能删除（可能被占用）` } : {}),
  };
}

/**
 * 清理孤儿：日志已不在的缓存文件、以及登记表里指向不存在会话的 id。
 * @param ids - 要清理的 id；省略表示全部孤儿。
 */export function cleanOrphans(ids = null) {
  const state = snapshot();
  // 扫描降级时 snapshot 的 registryOnly 是空的、sessions 也不全，此时清理会误删登记
  if (state.degraded === true) {
    return {
      ok: false,
      code: 'scan-degraded',
      error: `磁盘扫描失败，拒绝清理（可能是权限或占用）：${state.degradedError}`,
    };
  }
  const wanted = ids === null ? null : new Set(ids);
  const cacheIds = state.orphans.cacheOnly
    .map((orphan) => orphan.id)
    .filter((id) => wanted === null || wanted.has(id));
  const registryIds = state.orphans.registryOnly.filter((id) => wanted === null || wanted.has(id));

  const L = locations();
  let removedCaches = 0;
  for (const id of cacheIds) {
    try {
      fs.rmSync(path.join(L.proj, `${id}.json`), { force: true });
      removedCaches += 1;
    } catch {
      /* 已不存在 */
    }
  }
  const strippedEntries = registryIds.length > 0 ? stripFromRegistry(registryIds) : false;
  return { ok: true, removedCaches, cacheIds, registryIds, registryUpdated: strippedEntries };
}

/**
 * 闲置候选：最后活动早于 N 天的会话，可选只保留 0 轮的空会话。
 *
 * 「最后活动」优先取投影缓存里的 lastPromptAt，取不到才用日志文件的 mtime ——
 * mtime 会被任何一次写入刷新（包括归档这类操作），lastPromptAt 才是真正“没人说话”的时间。
 *
 * @param days - 天数，0 表示“只看空会话，不限时间”。
 * @param emptyOnly - 是否只保留 0 轮的空会话。
 * @param now - 注入当前时间，便于测试。
 * @returns 候选列表：[{ id, title, turns, lastAt, bytes }]
 */
export function idleCandidates(days, emptyOnly = true, now = Date.now()) {
  const count = Number(days);
  const safeDays = Number.isFinite(count) && count > 0 ? count : 0;
  const cutoff = now - safeDays * 86_400_000;
  return snapshot()
    .sessions
    .filter((session) => safeDays === 0 || (session.lastAt ?? session.mtime ?? 0) < cutoff)
    // 轮数未知（没有投影缓存）不等于 0 轮：无法证明是空会话，就不能进“只清空会话”的候选
    .filter((session) => (emptyOnly ? session.turns === 0 : true))
    .map((session) => ({
      id: session.id,
      title: session.title,
      turns: session.turns ?? null,
      lastAt: session.lastAt ?? session.mtime ?? null,
      bytes: session.bytes,
    }));
}
