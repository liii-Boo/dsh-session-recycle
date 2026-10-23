/**
 * 宿主半边：把会话回收站的能力暴露成 loopback HTTP 路由，供浏览器半边调用。
 *
 * 为什么用 HTTP 路由而不是 Typert Remote：本插件的方法都是「命令 + 无返回值语义」，
 * 不需要 wire schema，路由实现最短、出错面最小。
 *
 * 鉴权走宿主正门：`connection.requestRejection(req)`（Host/Origin 围栏 + 浏览器登录态），
 * 再叠加本插件自己的回环 + Host + Sec-Fetch-Site 检查。
 *
 * 删除顺序（顺序错了会留下半截日志或幽灵行）：
 *   1. 走宿主的 `workspaceRegistry.stopSessionActivity`（jobs/subagent/schedule 都挂在这条通道上，
 *      只 cancel 一轮 turn 停不住它们）
 *   2. 等 `session/disposed` 级联落地，再把 runtime 从宿主上 detach
 *   3. 文件系统搬家：日志目录 + 投影缓存 → ~/.dsh/trash/
 *   4. 复查缓存有没有被 dispose 的回写重新写出来，有就再搬一次
 *   5. 登记表摘除（走服务，文件层兜底）+ 广播 api-session/removed
 */

import path from 'node:path';

import {
  cleanOrphans,
  emptyTrash,
  findSessionDir,
  idleCandidates,
  listTrash,
  locations,
  moveToTrash,
  purgeFromTrash,
  readProjMeta,
  readRegistry,
  readmitToRegistry,
  readTrashMeta,
  restoreFromTrash,
  snapshot,
  stripFlagsFromRegistry,
  stripFromRegistry,
  sweepReappearedCache,
  TRASH_ENTRY_RE,
} from './lib/store.mjs';

/** 路由前缀。 */
const ROUTE_PREFIX = '/dsh-session-recycle';

/**
 * 会话 id 形态校验。
 *
 * 不能只认 `session-<uuid>`：宿主用 `encodeSegment()` 生成目录名，
 * 子代理会话的 id 是**裸 uuid**，特殊字符会被编码成 `~XXXX`。
 * 这里只做“安全”判断：允许字母数字与 `._-~`，且不允许 `..` 与路径分隔符，
 * 这样既兜住真实形态，又挡住了路径穿越。
 */
const SESSION_ID_RE = /^(?!.*\.\.)[A-Za-z0-9._~-]{6,200}$/;

/** 停手等待的步长与上限。 */
const QUIESCE_STEP_MS = 100;
const QUIESCE_MAX_STEPS = 40;

/** 单次批量删除的上限：只防手滑传进来一个巨大数组，也避免单次请求跑太久。 */
const BATCH_LIMIT = 200;

/** 请求体上限与读取超时。 */
const BODY_LIMIT = 1_000_000;
const BODY_TIMEOUT_MS = 15_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带 HTTP 状态码的失败。 */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const normalized = address.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function isLocalHostHeader(host) {
  if (typeof host !== 'string' || host === '') return false;
  // IPv6 带方括号时直接取括号里的地址；否则按冒号切出主机名（端口在后面）
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  const name = (bracketed !== null ? bracketed[1] : host.split(':')[0]).toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

/**
 * 请求围栏。先问宿主的 connection 服务（它同时做 Host/Origin 反 DNS 重绑定与登录态校验），
 * 再叠加本插件自己的三项本地检查 —— 任意一项不过就 403。
 * @returns 通过返回 true；否则已写好响应并返回 false。
 */
function guard(ctx, req, res) {
  try {
    const connection = ctx.get('connection');
    if (connection !== void 0 && typeof connection.requestRejection === 'function') {
      const rejection = connection.requestRejection(req);
      if (rejection !== void 0) {
        res.statusCode = rejection;
        res.end();
        return false;
      }
    }
  } catch {
    /* 服务异常时退回下面的本地检查，失败方向仍然是拒绝 */
  }
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'loopback only' });
    return false;
  }
  const host = req.headers.host;
  if (!isLocalHostHeader(host)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'unexpected host' });
    return false;
  }
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== '' && site !== 'same-origin' && site !== 'none') {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'cross-site request' });
    return false;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== host) {
      sendJson(res, 403, { ok: false, code: 'forbidden', error: 'cross-origin request' });
      return false;
    }
  }
  return true;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** 读请求体：超限立即 413，超时 408，绝不把连接挂在那里。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== null) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new HttpError(408, 'timeout', 'body read timeout')), BODY_TIMEOUT_MS);
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.destroy();
        finish(new HttpError(413, 'too-large', `body exceeds ${BODY_LIMIT} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (error) => finish(error));
    req.on('aborted', () => finish(new HttpError(400, 'aborted', 'request aborted')));
  });
}

/** 写操作串行化：两条并发请求同时改 workspace.json 会互相覆盖（读-改-写竞态）。 */
let mutationChain = Promise.resolve();

function serialize(task) {
  const run = mutationChain.then(task, task);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}

/** 统一的 POST + JSON 处理骨架。 */
function postRoute(handler) {
  return async (req, res, ctx) => {
    if (!guard(ctx, req, res)) return;
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' });
      return;
    }
    let body = {};
    try {
      const raw = await readBody(req);
      if (raw.trim() !== '') body = JSON.parse(raw);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const code = error instanceof HttpError ? error.code : 'invalid';
      sendJson(res, status, { ok: false, code, error: error instanceof HttpError ? error.message : 'malformed JSON body' });
      return;
    }
    try {
      sendJson(res, 200, await handler(body));
    } catch (error) {
      sendJson(res, 500, { ok: false, code: 'internal', error: String(error?.message ?? error) });
    }
  };
}

/** 会改文件系统的接口：校验 -> 串行 -> 执行。 */
function postMutation(handler) {
  return postRoute((body) => serialize(() => handler(body)));
}

/**
 * 把会话停稳。
 *
 * 顺序：宿主的 stop 通道 -> 等 dispose 级联 -> detach runtime -> 留一点时间让投影缓存落盘。
 * 返回的 notes 会一路带到客户端，失败不再静默。
 */
async function quiesce(ctx, sessionId) {
  const notes = [];
  const registry = ctx.get('workspaceRegistry');
  const sessions = ctx.get('sessions');
  const agents = ctx.get('agents');

  let live;
  try {
    live = sessions?.get?.(sessionId);
  } catch {
    live = void 0;
  }
  if (live === void 0) return { live: false, notes };

  try {
    if (typeof registry?.stopSessionActivity === 'function') {
      // jobs / subagent / schedule 都挂在 workspace/session-stop 上，比 cancel 一轮 turn 彻底
      await registry.stopSessionActivity(sessionId);
      notes.push('stop-dispatched');
    } else {
      void Promise.resolve(ctx.get('sessionController')?.cancel?.({ sessionId })).catch(() => {});
      notes.push('cancel-fallback');
    }
  } catch (error) {
    notes.push(`stop-failed: ${String(error?.message ?? error)}`);
  }

  for (let step = 0; step < QUIESCE_MAX_STEPS; step += 1) {
    const stillLive = (() => {
      try {
        return sessions?.get?.(sessionId) !== void 0;
      } catch {
        return false;
      }
    })();
    const running = agents?.get?.(sessionId)?.status === 'running';
    if (!stillLive) {
      notes.push('disposed');
      break;
    }
    if (!running && step > 2) break;
    await sleep(QUIESCE_STEP_MS);
  }

  try {
    const entry = sessions?.liveEntryFor?.(live);
    if (entry !== void 0) {
      sessions.detachEntered(entry);
      notes.push('detached');
    }
  } catch (error) {
    notes.push(`detach-failed: ${String(error?.message ?? error)}`);
  }

  // 给 dispose 触发的投影缓存落盘一个窗口（sweepReappearedCache 还会兜底复查）
  await sleep(120);
  return { live: true, notes };
}

/**
 * 读归档/置顶标记：优先问宿主服务（内存权威），拿不到再退回文件。
 *
 * 直接读文件的问题是：宿主可能还没把内存里的变更落盘，读到的就是旧值，
 * 还原时会把标记恢复错。
 */
function readSessionFlags(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry');
  if (registry !== void 0) {
    try {
      const archived = registry.archivedSessionIds;
      const pinned = registry.pinnedSessionIds;
      if (Array.isArray(archived) && Array.isArray(pinned)) {
        return { archived: archived.includes(sessionId), pinned: pinned.includes(sessionId), source: 'service' };
      }
    } catch {
      /* 服务没提供这两个 getter 时退回文件 */
    }
  }
  const file = readRegistry();
  return { archived: file.archived.has(sessionId), pinned: file.pinned.has(sessionId), source: 'file' };
}

/** 会话所属工作区 id：先问服务，再按路径匹配登记表。 */
async function resolveWorkspaceId(ctx, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return null;
  const registry = ctx.get('workspaceRegistry');
  if (registry !== void 0 && typeof registry.resolveByPath === 'function') {
    try {
      const entity = await registry.resolveByPath(cwd);
      const id = entity?.id;
      if (typeof id === 'string' && id !== '') return id;
    } catch {
      /* 落到文件匹配 */
    }
  }
  const file = readRegistry();
  const needle = cwd.toLowerCase();
  const hit = file.workspaces.find((workspace) => typeof workspace.path === 'string' && workspace.path.toLowerCase() === needle);
  if (hit !== undefined) return hit.id;
  // 兜底：只有一个工作区时，客户端切换视图用它就够了
  return file.workspaces.length === 1 ? file.workspaces[0].id : null;
}

/** 删除后清理登记：服务优先，文件层兜底。每步结果都收进返回值，不再吞掉。 */
async function forget(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry');
  const result = { detached: false, unarchived: false, unpinned: false, stripped: false, event: false };
  for (const [key, method] of [['detached', 'detachSession'], ['unarchived', 'unarchiveSession'], ['unpinned', 'unpinSession']]) {
    try {
      if (typeof registry?.[method] === 'function') {
        await registry[method](sessionId);
        result[key] = true;
      }
    } catch {
      /* 单步失败不影响其余，最终由 warnings 表达 */
    }
  }
  // 文件层摘除只在服务不可用或服务调用失败时做兜底：
  // 注册表以内存为权威，插件直接读-改-写会覆盖宿主此刻的其它改动。
  const serviceDetached = result.detached === true;
  if (!serviceDetached) {
    try {
      result.stripped = stripFromRegistry([sessionId]);
    } catch {
      result.stripped = false;
    }
  } else if (result.unarchived !== true || result.unpinned !== true) {
    // detach 成功但标记没清干净：只摘标记，不动归属，避免留下看不见的孤儿登记
    try {
      result.flagsStripped = stripFlagsFromRegistry([sessionId]);
    } catch {
      result.flagsStripped = false;
    }
  }
  try {
    ctx.emit('api-session/removed', sessionId);
    result.event = true;
  } catch {
    result.event = false;
  }
  return result;
}

/** 还原目标目录：优先问持久化服务（权威），其次用删除时记录的绝对路径。 */
function resolveRestoreTarget(ctx, sessionId, meta) {
  const persistence = ctx.get('sessionPersistence');
  const cwd = typeof meta?.cwd === 'string' && meta.cwd !== '' ? meta.cwd : null;
  if (persistence !== void 0 && typeof persistence.locate === 'function' && cwd !== null) {
    try {
      const located = persistence.locate({ id: sessionId, cwd });
      if (typeof located?.path === 'string' && located.path !== '') {
        return { dir: path.dirname(located.path), source: 'persistence' };
      }
    } catch {
      /* 落到下面用记录值 */
    }
  }
  if (typeof meta?.sessionDir === 'string' && meta.sessionDir !== '') {
    return { dir: meta.sessionDir, source: 'meta' };
  }
  return null;
}

/**
 * 还原后的登记：走 workspaceRegistry（内存权威），文件层只做兜底。
 *
 * 为什么不能只改 workspace.json：注册表把整份状态放在内存里（`domain.global.get()`），
 * 宿主下一次任何工作区操作都会把内存快照整文件写回，直接改文件会被覆盖。
 */
async function admitRestored(ctx, sessionId, meta) {
  const warnings = [];
  const registry = ctx.get('workspaceRegistry');
  const flags = { [sessionId]: { archived: meta?.archived === true, pinned: meta?.pinned === true } };

  if (registry === void 0) {
    const registryUpdated = readmitToRegistry([sessionId], flags, { preferPath: typeof meta?.cwd === 'string' ? meta.cwd : null });
    warnings.push('workspaceRegistry 不可用，已直接写登记表（可能被宿主下一次写入覆盖）');
    return { viaService: false, registered: registryUpdated, warnings };
  }

  let entity;
  const cwd = typeof meta?.cwd === 'string' && meta.cwd !== '' ? meta.cwd : null;
  if (cwd !== null && typeof registry.resolveByPath === 'function') {
    try {
      entity = await registry.resolveByPath(cwd);
    } catch (error) {
      warnings.push(`解析工作区失败：${String(error?.message ?? error)}`);
    }
  }
  if (entity === void 0 || entity === null) {
    warnings.push('未能定位所属工作区，会话已还原但会出现在未分组里');
    return { viaService: true, registered: false, warnings };
  }
  try {
    // attachSession 会校验会话 cwd 与该工作区路径一致，正是我们需要的把关
    await entity.attachSession(sessionId);
  } catch (error) {
    warnings.push(`重新登记失败：${String(error?.message ?? error)}`);
    return { viaService: true, registered: false, warnings };
  }
  try {
    if (meta?.archived === true && typeof registry.archiveSession === 'function') {
      await registry.archiveSession(sessionId);
    } else if (meta?.pinned === true && typeof registry.pinSession === 'function') {
      await registry.pinSession(sessionId);
    }
  } catch (error) {
    warnings.push(`恢复标记失败：${String(error?.message ?? error)}`);
  }
  return { viaService: true, registered: true, warnings };
}

/** 插件名（与 package.json 的 name 一致）。 */
export const name = '@liii-boo/dsh-session-recycle';

/**
 * 注册路由。
 * @param webServer - 宿主 web 服务（提供 register）。
 * @param fiber - 用来挂 effect 的上下文。
 * @param ctx - 插件上下文（取 sessions / agents / workspaceRegistry / connection）。
 */
function registerRoutes(webServer, fiber, ctx) {
  /** 注册一个 exact 路由。 */
  const route = (suffix, handler) => fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}${suffix}`,
    handler: (req, res) => handler(req, res, ctx),
  }));

  /** 面板数据：会话、孤儿、回收站、扫描是否降级。 */
  route('/state', postRoute(async () => {
    const state = snapshot();
    const { home, sessions, trash, registry, proj } = locations();
    return { ok: true, platform: process.platform, ...state, locations: { home, sessions, trash, registry, proj } };
  }));

  /** 删除一个会话（进回收站）。 */
  route('/delete', postMutation(async (body) => {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!SESSION_ID_RE.test(sessionId)) return { ok: false, code: 'invalid', error: 'sessionId 形态不合法' };

    // 这里只为了拿 slug 回显：读不到目录不该让整个删除请求 500，扫不到就留空
    let located = null;
    try {
      located = findSessionDir(sessionId);
    } catch {
      located = null;
    }
    const meta = readProjMeta(sessionId);
    const flags = readSessionFlags(ctx, sessionId);
    const quiesced = await quiesce(ctx, sessionId);
    const hasRegistry = ctx.get('workspaceRegistry') !== void 0;
    const result = await moveToTrash(sessionId, {
      title: meta.title,
      cwd: meta.cwd,
      archived: flags.archived,
      pinned: flags.pinned,
      // 宿主在线时交给 forget() 走服务摘除，避免文件层写入覆盖宿主的并发修改
      stripRegistry: !hasRegistry,
    });
    if (result.ok !== true) return { ...result, quiesced: quiesced.notes };

    // 没 live 过的会话不会有 dispose 回写，复查一次就够
    const swept = await sweepReappearedCache(result.entry, sessionId, quiesced.live === true ? 3 : 1);
    const forgotten = await forget(ctx, sessionId);

    const warnings = [];
    if (swept.swept > 0) warnings.push(`投影缓存被重新写出 ${swept.swept} 次，已再次搬入回收站`);
    if (forgotten.detached !== true && forgotten.stripped !== true) {
      warnings.push('登记表未能同步移除，界面可能残留该会话；请刷新或切一次工作区');
    }

    return {
      ok: true,
      removed: true,
      entry: result.entry,
      movedSession: result.movedSession,
      movedCache: result.movedCache,
      slug: located?.slug ?? null,
      // 客户端用它把主视图切到该工作区的新会话（删掉的正是当前会话时）
      workspaceId: await resolveWorkspaceId(ctx, meta.cwd),
      quiesced: quiesced.notes,
      forgotten,
      warnings,
    };
  }));

  /** 批量删除：逐条走同一条流水线，单条失败不影响其余。 */
  route('/delete-many', postMutation(async (body) => {
    const requested = Array.isArray(body.sessionIds) ? body.sessionIds : [];
    const ids = [...new Set(requested.filter((id) => typeof id === 'string' && SESSION_ID_RE.test(id)))];
    if (ids.length === 0) return { ok: false, code: 'invalid', error: 'sessionIds 为空或不合法' };
    if (ids.length > BATCH_LIMIT) return { ok: false, code: 'too-many', error: `一次最多 ${BATCH_LIMIT} 个` };

    const hasRegistry = ctx.get('workspaceRegistry') !== void 0;
    const results = [];
    const warnings = [];
    for (const sessionId of ids) {
      const meta = readProjMeta(sessionId);
      const flags = readSessionFlags(ctx, sessionId);
      const quiesced = await quiesce(ctx, sessionId);
      const result = await moveToTrash(sessionId, {
        title: meta.title,
        cwd: meta.cwd,
        archived: flags.archived,
        pinned: flags.pinned,
        stripRegistry: !hasRegistry,
      });
      if (result.ok === true) {
        // 批量场景下每条都要等：非 live 的会话只复查一轮，避免几百条时请求超时
        await sweepReappearedCache(result.entry, sessionId, quiesced.live === true ? 3 : 1);
        const forgotten = await forget(ctx, sessionId);
        if (forgotten.detached !== true && forgotten.stripped !== true) {
          warnings.push(`${sessionId}：登记表未同步移除`);
        }
      } else {
        warnings.push(`${sessionId}：${result.error ?? result.code}`);
      }
      results.push({
        sessionId,
        ok: result.ok === true,
        code: result.code ?? null,
        error: result.error ?? null,
        quiesced: quiesced.notes,
      });
    }
    const deleted = results.filter((item) => item.ok).length;
    // 批量里可能包含当前会话：给客户端一个可切换的工作区 id
    const firstCwd = readProjMeta(ids[0]).cwd;
    const workspaceId = await resolveWorkspaceId(ctx, firstCwd);
    return { ok: true, deleted, failed: results.length - deleted, results, warnings, workspaceId };
  }));

  /** 还原。 */
  route('/restore', postMutation(async (body) => {
    const entry = typeof body.entry === 'string' ? body.entry.trim() : '';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!TRASH_ENTRY_RE.test(entry) || !SESSION_ID_RE.test(sessionId)) {
      return { ok: false, code: 'invalid', error: 'entry / sessionId 不合法' };
    }
    const entryMeta = readTrashMeta(entry, sessionId);
    if (entryMeta.ok !== true) return entryMeta;

    const target = resolveRestoreTarget(ctx, sessionId, entryMeta.meta);
    if (target === null) {
      return { ok: false, code: 'no-target', error: '无法确定还原目录（条目缺少路径记录，宿主也未提供定位）' };
    }

    // 注意：不要 emit `api-session/added` —— 该事件负载是会话 summary 对象，
    // 传字符串 id 会让客户端 sessions.handleSessionAdded 拿到错误类型。
    const result = await restoreFromTrash(entry, sessionId, {
      sessionDir: target.dir,
      onRestored: (id, meta) => admitRestored(ctx, id, meta),
    });
    if (result.ok !== true) return result;
    return {
      ok: true,
      id: result.id,
      target: result.target,
      targetSource: target.source,
      admission: result.admission,
      warnings: result.admission?.warnings ?? [],
    };
  }));

  /** 永久删除（单条或整个条目）。 */
  route('/purge', postMutation(async (body) => {
    const entry = typeof body.entry === 'string' ? body.entry.trim() : '';
    if (!TRASH_ENTRY_RE.test(entry)) return { ok: false, code: 'invalid', error: 'entry 不合法' };
    if (body.all === true) return purgeFromTrash(entry, null);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!SESSION_ID_RE.test(sessionId)) return { ok: false, code: 'invalid', error: 'sessionId 不合法' };
    return purgeFromTrash(entry, sessionId);
  }));

  /** 清空回收站（部分失败会如实上报）。 */
  route('/empty-trash', postMutation(async () => emptyTrash()));

  /** 清理孤儿缓存 / 孤儿登记。 */
  route('/clean-orphans', postMutation(async (body) => {
    const ids = Array.isArray(body.sessionIds)
      ? body.sessionIds.filter((id) => typeof id === 'string' && SESSION_ID_RE.test(id))
      : null;
    return cleanOrphans(ids);
  }));

  /** 闲置候选：按天数 + 是否只看空会话，返回可批量删的 id 列表。 */
  route('/idle-candidates', postRoute(async (body) => {
    const days = Number(body.days);
    const emptyOnly = body.emptyOnly !== false;
    if (!Number.isFinite(days) || days < 0) return { ok: false, code: 'invalid', error: 'days 必须是非负数' };
    // 不限空会话又给 0 天，等于「把所有会话都选中」——太容易误点，直接拒绝
    if (!emptyOnly && days === 0) {
      return { ok: false, code: 'invalid', error: '不限空会话时必须填一个大于 0 的天数' };
    }
    return { ok: true, candidates: idleCandidates(days, emptyOnly) };
  }));

  /** 回收站条目（面板刷新用）。 */
  route('/trash', postRoute(async () => ({ ok: true, trash: listTrash() })));
}

/**
 * 插件入口。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  const webServer = ctx.get('webServer');
  if (webServer !== void 0) {
    registerRoutes(webServer, ctx, ctx);
    return;
  }
  // 纯终端 profile 没有 web 表面：等它出现再注册，而不是一直等一个不会来的服务。
  ctx.inject(['webServer'], (sub) => registerRoutes(sub.webServer, sub, ctx));
}

/** 供离线测试使用（只有测试会碰这个出口）。 */
export const internals = {
  isLoopbackAddress,
  isLocalHostHeader,
  snapshot,
};
