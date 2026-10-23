/**
 * 浏览器半边：右键「删除会话」+ 侧栏回收站页面 + 设置页开关与面板。
 *
 * 形态必须是 loader 要求的惰性 CJS 工厂：不能用 ESM / JSX，
 * 能 require 的包只有 react 与 ui-primitives。
 *
 * 侧栏入口的机制（与宿主公开契约一致，不是私有 API）：
 *   - 往 `main` 插槽注册一个带 `key` 的页面组件
 *   - 往 `sidebar.panellist` 注册一个同 `id` 的行
 *   - 点行时宿主机按 id↔key 切到那个页面
 *   - 想让它消失就注销这两个注册（createGate 的 setVisible）
 */
window.__ModuleLoader__.load({
	id: "@liii-boo/dsh-session-recycle",
	factory(require) {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const h = React.createElement;
		const Fragment = React.Fragment;

		const PKG = "@liii-boo/dsh-session-recycle";
		const NS = PKG;
		const ROUTE = "/dsh-session-recycle";
		/** 侧栏行的 id，同时也是 main 页面的 key：宿主靠这两个相等来切换。 */
		const PANEL_ID = "dsh-session-recycle";
		/** 侧栏开关在浏览器里的存储键。 */
		const SIDEBAR_KEY = `${PKG}:sidebar`;		/** 「按天数清理」的默认值。 */
		const DEFAULT_DAYS = 7;

		const zh = {
			"menu.delete": "删除会话",
			"sidebar.label": "会话回收站",
			"settings.title": "会话回收站",
			"settings.sidebar.label": "侧栏入口",
			"settings.sidebar.hint": "在侧栏显示回收站入口。设置里的入口不变。",
			"settings.sidebar.show": "显示",
			"settings.sidebar.hide": "不显示",
			"tab.sessions": "会话",
			"tab.trash": "回收站",
			"tab.orphans": "孤儿缓存",
			"delete.title": "删除这个会话？",
			"delete.titleMany": "删除选中的 {n} 个会话？",
			"delete.desc": "会话会移入回收站，随时可以还原；只有清空回收站才是真删。",
			"delete.descMany": "{n} 个会话会一起移入回收站，随时可以还原。",
			"delete.confirm": "删除",
			"delete.cancel": "取消",
			"delete.pending": "正在移入回收站…",
			"delete.progress": "已处理 {done} / {total}",
			"delete.stuckHint": "已删除。视图没能自动切换，请手动点一下别的会话。",
			"delete.failed": "删除失败：{message}",
			"delete.done": "已移入回收站",
			"delete.doneMany": "已移入回收站 {n} 个",
			"delete.partial": "{ok} 个成功，{failed} 个失败",
			"sessions.selectAll": "全选",
			"sessions.clear": "清空选择",
			"sessions.selected": "已选 {n}",
			"sessions.deleteSelected": "删除所选",
			"sessions.byDays": "按天数清理",
			"sessions.daysLabel": "天前未活动",
			"sessions.emptyOnly": "只看 0 轮的空会话",
			"sessions.preview": "选中符合条件的",
			"sessions.matched": "命中 {n} 个",
			"sessions.needDays": "不勾「只看 0 轮的空会话」时，天数必须大于 0，否则会把所有会话都选中。",
			"sessions.none": "没有符合条件的会话。",
			"sessions.turns": "{n} 轮",
			"sessions.turnsUnknown": "轮数未知",
			"state.degraded": "有会话目录读不出来（{message}），孤儿清理已停用，避免误删。",
			"sessions.lastAt": "最后活动 {time}",
			"trash.empty": "回收站是空的。删除的会话会出现在这里。",
			"trash.restore": "还原",
			"trash.purge": "彻底删除",
			"trash.emptyAll": "清空回收站",
			"trash.confirmPurge": "彻底删除后无法恢复，确定？",
			"trash.confirmEmpty": "清空回收站后无法恢复，确定？",
			"confirm.purgeTitle": "彻底删除这个会话？",
			"confirm.purgeDesc": "日志、投影缓存会从回收站里删掉，无法恢复。",
			"confirm.purgeTarget": "只删回收站里的这一条，不影响其它会话。",
			"confirm.purgePending": "正在彻底删除…",
			"confirm.purged": "已彻底删除",
			"confirm.emptyTitle": "清空回收站？",
			"confirm.emptyDesc": "回收站里的所有条目都会被删除，无法恢复。",
			"confirm.emptyTarget": "清空后磁盘空间才会真正释放。",
			"confirm.emptyPending": "正在清空…",
			"confirm.emptied": "已清空 {n} 个条目",
			"confirm.partialFailed": "{n} 个条目未能删除（可能被占用），已保留",
			"trash.removedAt": "删除于 {time}",
			"orphans.none": "没有发现孤儿，三处数据一致。",
			"orphans.cacheOnly": "只有缓存、日志已丢失（{n}）",
			"orphans.registryOnly": "登记表里有、磁盘上没有日志（{n}）",
			"orphans.clean": "清理",
			"orphans.cleanAll": "一键清理全部",
			"orphans.done": "已清理 {cache} 个缓存、{registry} 条登记",
			"orphans.hint": "这些是历史删除或异常退出留下的残留：日志没了缓存还在，或登记表指向不存在的会话。清理它们不会动任何现存会话。",
			"action.failed": "操作失败：{message}",
			"state.loading": "正在读取…",
			"state.refresh": "刷新",
			"hint.refresh": "还原后如果侧栏没变，切一次工作区或按 F5 刷新。",
			"unknown": "(未命名)",
			"close": "关闭"
		};

		const en = {
			"menu.delete": "Delete session",
			"sidebar.label": "Session recycle bin",
			"settings.title": "Session recycle bin",
			"settings.sidebar.label": "Sidebar entry",
			"settings.sidebar.hint": "Show the recycle bin in the sidebar. The settings entry stays either way.",
			"settings.sidebar.show": "Show",
			"settings.sidebar.hide": "Hide",
			"tab.sessions": "Sessions",
			"tab.trash": "Recycle bin",
			"tab.orphans": "Orphan caches",
			"delete.title": "Delete this session?",
			"delete.titleMany": "Delete {n} selected sessions?",
			"delete.desc": "The session moves to the recycle bin and can be restored at any time; only emptying the bin deletes it for good.",
			"delete.descMany": "{n} sessions move to the recycle bin together and can be restored at any time.",
			"delete.confirm": "Delete",
			"delete.cancel": "Cancel",
			"delete.pending": "Moving to the recycle bin…",
			"delete.progress": "{done} / {total} processed",
			"delete.stuckHint": "Deleted. The view could not switch automatically — pick another session manually.",
			"delete.failed": "Delete failed: {message}",
			"delete.done": "Moved to the recycle bin",
			"delete.doneMany": "Moved {n} sessions to the recycle bin",
			"delete.partial": "{ok} succeeded, {failed} failed",
			"sessions.selectAll": "Select all",
			"sessions.clear": "Clear selection",
			"sessions.selected": "{n} selected",
			"sessions.deleteSelected": "Delete selected",
			"sessions.byDays": "Clean up by age",
			"sessions.daysLabel": "days without activity",
			"sessions.emptyOnly": "Only empty sessions (0 turns)",
			"sessions.preview": "Select matching",
			"sessions.matched": "{n} matched",
			"sessions.needDays": "With “only empty sessions” unchecked, the day count must be greater than 0 — otherwise every session would be selected.",
			"sessions.none": "No session matches.",
			"sessions.turns": "{n} turns",
			"sessions.turnsUnknown": "turns unknown",
			"state.degraded": "Some session folders can't be read ({message}); orphan cleanup is disabled to avoid deleting the wrong thing.",
			"sessions.lastAt": "Last active {time}",
			"trash.empty": "The recycle bin is empty. Deleted sessions show up here.",
			"trash.restore": "Restore",
			"trash.purge": "Delete forever",
			"trash.emptyAll": "Empty bin",
			"trash.confirmPurge": "Deleting forever cannot be undone. Continue?",
			"trash.confirmEmpty": "Emptying the bin cannot be undone. Continue?",
			"confirm.purgeTitle": "Delete this session forever?",
			"confirm.purgeDesc": "The log and projection cache are removed from the bin; this cannot be undone.",
			"confirm.purgeTarget": "Only this entry in the bin is removed.",
			"confirm.purgePending": "Deleting forever…",
			"confirm.purged": "Deleted forever",
			"confirm.emptyTitle": "Empty the recycle bin?",
			"confirm.emptyDesc": "Every entry in the bin is removed; this cannot be undone.",
			"confirm.emptyTarget": "Disk space is only reclaimed after this step.",
			"confirm.emptyPending": "Emptying…",
			"confirm.emptied": "Emptied {n} entries",
			"confirm.partialFailed": "{n} entries could not be removed (maybe in use) and were kept",
			"trash.removedAt": "Deleted {time}",
			"orphans.none": "No orphans found — all three stores agree.",
			"orphans.cacheOnly": "Cache without a log directory ({n})",
			"orphans.registryOnly": "Ledger entry without a log directory ({n})",
			"orphans.clean": "Clean",
			"orphans.cleanAll": "Clean all",
			"orphans.done": "Cleaned {cache} caches and {registry} ledger entries",
			"orphans.hint": "Leftovers from earlier deletions or crashed runs: a cache without its log, or a ledger entry pointing at a session that no longer exists. Cleaning them never touches a live session.",
			"action.failed": "Action failed: {message}",
			"state.loading": "Loading…",
			"state.refresh": "Refresh",
			"hint.refresh": "If the sidebar does not update after restoring, switch workspace once or press F5.",
			"unknown": "(untitled)",
			"close": "Close"
		};

		const STYLE = `
.dsr-panel { position:relative; display:flex; flex-direction:column; gap:12px; font-size:13px; }
.dsr-page { height:100%; overflow:auto; padding:16px 18px; box-sizing:border-box; }
.dsr-tabs { display:flex; gap:8px; border-bottom:1px solid var(--dsh-color-border,#e5e5e5); align-items:center; }
.dsr-tab { padding:6px 10px; cursor:pointer; border:none; background:transparent; color:inherit; font:inherit; opacity:.65; border-bottom:2px solid transparent; }
.dsr-tab[data-active="true"] { opacity:1; border-bottom-color:var(--dsh-color-accent,#4d6bfe); }
.dsr-list { display:flex; flex-direction:column; gap:6px; }
.dsr-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--dsh-color-border,#e5e5e5); border-radius:8px; }
.dsr-row-check { display:flex; align-items:center; padding-right:2px; }
.dsr-row-main { flex:1; min-width:0; }
.dsr-title { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-sub { opacity:.6; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsr-actions { display:flex; gap:6px; flex-shrink:0; }
.dsr-empty { opacity:.6; padding:14px 4px; }
.dsr-status { opacity:.75; }
.dsr-error { color:#d04a4a; }
.dsr-danger { color:#d04a4a; }
.dsr-hint { opacity:.55; font-size:12px; line-height:1.5; }
.dsr-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.dsr-spacer { flex:1; }
.dsr-days { width:56px; padding:4px 6px; border-radius:6px; border:1px solid var(--dsh-color-border,#e5e5e5); background:transparent; color:inherit; font:inherit; }
.dsr-check { display:flex; gap:6px; align-items:center; opacity:.8; }
.dsr-card { display:flex; align-items:center; gap:12px; padding:12px; border:1px solid var(--dsh-color-border,#e5e5e5); border-radius:10px; }
.dsr-card-main { flex:1; min-width:0; }
.dsr-seg { display:flex; border:1px solid var(--dsh-color-border,#e5e5e5); border-radius:8px; overflow:hidden; }
.dsr-seg button { padding:6px 14px; border:none; background:transparent; color:inherit; font:inherit; cursor:pointer; opacity:.6; }
.dsr-seg button[data-active="true"] { opacity:1; font-weight:600; background:color-mix(in srgb, currentColor 10%, transparent); }
/* 面板内遮罩：视口固定定位，保证对话框始终居中可见 */
.dsr-scrim { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; background:rgba(15,18,26,.38); }
/* 挂到 body 的遮罩：给右键菜单那条路径用，不受任何容器裁剪 */
.dsr-scrim-body { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; background:rgba(15,18,26,.38); }
.dsr-dialog { width:min(400px,100%); background:var(--dsh-color-surface,#fff); color:inherit; border:1px solid var(--dsh-color-border,#e5e5e5); border-radius:14px; padding:20px 22px 16px; box-shadow:0 24px 60px rgba(0,0,0,.26); display:flex; flex-direction:column; gap:8px; }
.dsr-dialog-h { font-size:15px; font-weight:600; line-height:1.4; }
.dsr-dialog-p { font-size:13px; line-height:1.6; opacity:.7; }
.dsr-dialog-target { font-size:12px; line-height:1.5; opacity:.55; word-break:break-all; }
.dsr-dialog-foot { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
.dsr-btn { padding:6px 14px; border-radius:8px; border:1px solid var(--dsh-color-border,#d8dbe2); background:transparent; color:inherit; font:inherit; cursor:pointer; }
.dsr-btn:hover:not(:disabled) { background:color-mix(in srgb, currentColor 8%, transparent); }
.dsr-btn:disabled { opacity:.5; cursor:default; }
.dsr-btn-danger { color:#d04a4a; border-color:color-mix(in srgb, #d04a4a 45%, transparent); }
`;

		// ── 小工具 ──────────────────────────────────────────────────────────

		function readSidebarPref() {
			try {
				return window.localStorage.getItem(SIDEBAR_KEY) !== "off";
			} catch {
				return true;
			}
		}

		function writeSidebarPref(visible) {
			try {
				window.localStorage.setItem(SIDEBAR_KEY, visible ? "on" : "off");
			} catch {
				/* 无痕模式写不进去也不影响本次会话 */
			}
		}

		/** 侧栏开关的状态仓库：设置页的分段控件与注册逻辑都读它，切换后组件要重渲染。 */
		let sidebarPref = readSidebarPref();
		const sidebarPrefListeners = new Set();

		function subscribeSidebarPref(listener) {
			sidebarPrefListeners.add(listener);
			return () => {
				sidebarPrefListeners.delete(listener);
			};
		}

		function readSidebarPrefState() {
			return sidebarPref;
		}

		/** 由 apply() 注入：真正切换插槽注册的那一步。 */
		let applySidebarVisibility = () => {};

		/**
		 * 一个“要不要挂这块 UI”的开关：显隐通过注册/注销实现，
		 * 因为插槽没有“隐藏但保留”的语义。
		 */
		function createGate(register, initiallyVisible) {
			let ready = false;
			let wanted = initiallyVisible;
			let removed = false;
			let dispose = null;
			const apply = () => {
				if (!ready) return;
				const shouldShow = wanted && !removed;
				if (shouldShow && dispose === null) {
					try {
						dispose = register() ?? null;
					} catch (error) {
						// 注册失败不能把异常抛进插槽回调，也不能留下半个注册（register 内部已回滚）
						dispose = null;
						console.warn(`${PKG}: 侧栏入口注册失败`, error);
					}
					return;
				}
				if (!shouldShow && dispose !== null) {
					const stop = dispose;
					dispose = null;
					stop();
				}
			};
			return {
				available: () => {
					ready = true;
					apply();
				},
				setVisible: (visible) => {
					wanted = visible;
					apply();
				},
				visible: () => dispose !== null,
				retire: () => {
					removed = true;
					apply();
				}
			};
		}

		/** 顶部提示条。 */
		let notice = null;
		let noticeSeq = 0;
		const noticeListeners = new Set();

		function subscribeNotice(listener) {
			noticeListeners.add(listener);
			return () => {
				noticeListeners.delete(listener);
			};
		}

		function readNotice() {
			return notice;
		}

		function showNotice(text) {
			noticeSeq += 1;
			notice = { seq: noticeSeq, text };
			for (const listener of [...noticeListeners]) listener();
		}

		function clearNotice() {
			notice = null;
			for (const listener of [...noticeListeners]) listener();
		}

		/**
		 * 挂到 document.body 的确认框（原生 DOM）。
		 *
		 * 右键菜单那条路径不能用面板里的 React 遮罩：菜单本身在一个被
		 * `transform` + `overflow:hidden` 裁剪的容器里，绝对定位的遮罩只会露出一条。
		 * 挂到 body 上就与任何容器无关，样式仍复用全局注入的 .dsr-* 类。
		 *
		 * @param options - { title, desc, target, confirmLabel, cancelLabel, onConfirm }
		 *   onConfirm(done, fail)：done(结果文本) 关闭并提示；fail(错误) 留在框内显示。
		 */
		function bodyConfirm(options) {
			const scrim = document.createElement("div");
			scrim.className = "dsr-scrim-body";

			const card = document.createElement("div");
			card.className = "dsr-dialog";
			card.setAttribute("role", "dialog");
			card.setAttribute("aria-modal", "true");

			const head = document.createElement("div");
			head.className = "dsr-dialog-h";
			head.textContent = options.title;
			card.appendChild(head);

			const desc = document.createElement("div");
			desc.className = "dsr-dialog-p";
			desc.textContent = options.desc;
			card.appendChild(desc);

			if (options.target) {
				const target = document.createElement("div");
				target.className = "dsr-dialog-target";
				target.textContent = options.target;
				card.appendChild(target);
			}

			const status = document.createElement("div");
			status.className = "dsr-status";
			status.setAttribute("role", "status");
			status.style.display = "none";
			card.appendChild(status);

			const foot = document.createElement("div");
			foot.className = "dsr-dialog-foot";

			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "dsr-btn";
			cancel.textContent = options.cancelLabel;
			foot.appendChild(cancel);

			const ok = document.createElement("button");
			ok.type = "button";
			ok.className = "dsr-btn dsr-btn-danger";
			ok.textContent = options.confirmLabel;
			foot.appendChild(ok);

			card.appendChild(foot);
			scrim.appendChild(card);

			const dispose = () => {
				scrim.remove();
				document.removeEventListener("keydown", onKey);
			};
			const onKey = (event) => {
				if (event.key === "Escape") dispose();
			};

			cancel.addEventListener("click", dispose);
			scrim.addEventListener("click", (event) => {
				if (event.target === scrim) dispose();
			});
			document.addEventListener("keydown", onKey);

			ok.addEventListener("click", () => {
				ok.disabled = true;
				cancel.disabled = true;
				status.textContent = options.pendingText ?? "";
				status.style.display = options.pendingText ? "block" : "none";
				options.onConfirm(
					(text) => {
						dispose();
						if (typeof text === "string" && text !== "") showNotice(text);
						bumpData();
					},
					(message) => {
						ok.disabled = false;
						cancel.disabled = false;
						status.className = "dsr-error";
						status.style.display = "block";
						status.textContent = message;
					},
				);
			});

			document.body.appendChild(scrim);
			ok.focus();
		}

		/**
		 * 数据版本总线：任何一次写操作成功后自增，所有挂着面板的界面据此重新拉取。
		 *
		 * 存在的理由：确认弹窗挂在 `shell.overlay`，和面板是两个组件树上的邻居，
		 * 弹窗删完没法直接调用面板的 refresh —— 早期版本因此表现为“删了但回收站不刷新，
		 * 要手动点一下刷新”。
		 */
		let dataRevision = 0;
		const dataListeners = new Set();

		function subscribeData(listener) {
			dataListeners.add(listener);
			return () => {
				dataListeners.delete(listener);
			};
		}

		function readDataRevision() {
			return dataRevision;
		}

		function bumpData() {
			dataRevision += 1;
			for (const listener of [...dataListeners]) listener();
		}

		/** 调用宿主路由；HTTP 200 但 body.ok === false 也算失败。 */
		async function call(path, payload) {
			const response = await fetch(`${ROUTE}${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload ?? {})
			});
			let body = null;
			try {
				body = await response.json();
			} catch {
				body = null;
			}
			if (body === null || typeof body !== "object") throw new Error(`HTTP ${response.status}`);
			if (body.ok !== true) throw new Error(body.error || body.code || `HTTP ${response.status}`);
			return body;
		}

		function fmtBytes(bytes) {
			if (typeof bytes !== "number" || bytes <= 0) return "—";
			const units = ["B", "KB", "MB", "GB"];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
		}

		function fmtTime(value) {
			if (value === null || value === void 0 || value === "") return "—";
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return String(value);
			const pad = (n) => String(n).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}

		function shortId(id) {
			return String(id).replace(/^session-/, "").slice(0, 8);
		}

		function titleOf(session, t) {
			return typeof session.title === "string" && session.title !== "" ? session.title : t("unknown");
		}

		// ── 右键菜单项 ──────────────────────────────────────────────────────

		/**
		 * 删掉「当前正在看的会话」后，把主视图切走。
		 *
		 * 宿主没有删除语义，删完没有任何组件负责导航，页面会停在已不存在的会话上。
		 * 这里主动调宿主「新会话」用的同一个接口：`uiWorkspace.startSession(workspaceId)`。
		 *
		 * @param wasCurrent - 删除前该会话是否为主视图（删完就查不到了，必须提前记下）
		 * @param workspaceId - 宿主返回的工作区 id
		 */
		function leaveDeletedView(ctx, wasCurrent, workspaceId) {
			if (wasCurrent !== true) return false;
			const uiWorkspace = ctx?.get?.('uiWorkspace');
			if (uiWorkspace === void 0) return false;
			try {
				if (typeof workspaceId === 'string' && workspaceId !== '' && typeof uiWorkspace.startSession === 'function') {
					uiWorkspace.startSession(workspaceId);
					return true;
				}
				if (typeof workspaceId === 'string' && workspaceId !== '' && typeof uiWorkspace.openWorkspace === 'function') {
					uiWorkspace.openWorkspace(workspaceId);
					return true;
				}
				return false;
			} catch (error) {
				console.warn(`${PKG}: 删除后切走视图失败`, error);
				return false;
			}
			return false;
		}

		/** 插槽没给 hook 时的空实现：hooks 必须无条件调用，不能按条件跳过。 */
		const NOOP_HOOK = () => void 0;

		/**
		 * 判断某个会话是不是「当前主视图正在显示的那个」。
		 *
		 * 删掉正在看的会话会让主界面停在已经不存在的会话上（宿主没有删除语义，
		 * 也就没有相应的“切走”逻辑），所以删之前要先记下这一状态，删完再据此切走。
		 *
		 * 检测手段按可靠性递减：uiSession 的 current store → 页面上是否出现该 id。
		 * 拿不准时按「不是当前会话」处理，避免误触发切换。
		 */
		function isCurrentSession(ctx, sessionId) {
			try {
				const uiSession = ctx.get("uiSession");
				const store = uiSession?.current;
				const snapshot = typeof store?.getSnapshot === "function"
					? store.getSnapshot()
					: (store?.value ?? null);
				const activeId = snapshot?.key ?? snapshot?.sessionId ?? snapshot?.id;
				if (typeof activeId === "string" && activeId !== "") return activeId === sessionId;
			} catch {
				/* 服务形状变了就退回 DOM 判断 */
			}
			try {
				// 主视图顶部会显示会话 id；侧栏显示的是标题，不会命中
				return typeof document !== "undefined" && document.body.innerText.includes(sessionId);
			} catch {
				return false;
			}
		}

		/** 会话行右键菜单：删除会话（进回收站）。 */
		function RecycleMenuItem(props) {
			const { sessionId, displayTitle, t } = props;
			const useMenuOpenState = typeof props.useMenuOpenState === "function" ? props.useMenuOpenState : NOOP_HOOK;
			const menuState = useMenuOpenState();
			const closeMenu = Array.isArray(menuState) && typeof menuState[1] === "function" ? menuState[1] : void 0;
			if (typeof sessionId !== "string" || sessionId === "") return null;
			return h(primitives.MenuItemButton, {
				icon: h(primitives.IconTrashOutlineRegular),
				danger: true,
				onSelect: () => {
					closeMenu?.(false);
					// 删除前先记下：这个会话是不是当前主视图（删完就查不到了）
					const wasCurrent = isCurrentSession(pluginCtx, sessionId);
					// 用挂到 body 的确认框：菜单容器有 transform + overflow:hidden，
					// 在它内部渲染浮层会被裁掉。
					bodyConfirm({
						title: t("delete.title"),
						desc: t("delete.desc"),
						target: typeof displayTitle === "string" && displayTitle !== "" ? displayTitle : sessionId,
						confirmLabel: t("delete.confirm"),
						cancelLabel: t("delete.cancel"),
						pendingText: t("delete.pending"),
						onConfirm: (done, fail) => {
							void (async () => {
								try {
									const body = await call("/delete", { sessionId });
									const warnings = Array.isArray(body.warnings) ? body.warnings : [];
									done(warnings.length > 0 ? `${t("delete.done")} · ${warnings[0]}` : t("delete.done"));
									// 删的是当前会话：把主视图切到该工作区的新会话
									if (wasCurrent && !leaveDeletedView(pluginCtx, wasCurrent, body.workspaceId)) showNotice(t("delete.stuckHint"));
								} catch (reason) {
									fail(t("delete.failed", { message: reason instanceof Error ? reason.message : String(reason) }));
								}
							})();
						}
					});
				}
			}, t("menu.delete"));
		}

		/**
		 * 面板内的确认层。
		 *
		 * 早期版本把确认弹窗注册到 `shell.overlay` 插槽并依赖 primitives.Modal，
		 * 但在 DSH Desktop 上那个组件没有挂载出来 —— 表现为"点彻底删除完全没反应"。
		 * 现在改成在面板自己的组件树里渲染一个覆盖层：不跨插槽，不依赖 Modal 的 props 约定。
		 */
		function ConfirmOverlay({ request, t, onClose }) {
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			const [progress, setProgress] = React.useState(null);
			const kind = request.kind ?? "delete";
			const sessionIds = Array.isArray(request.sessionIds) ? request.sessionIds : [];
			const many = sessionIds.length > 1;

			const titles = {
				delete: many ? t("delete.titleMany", { n: sessionIds.length }) : t("delete.title"),
				purge: t("confirm.purgeTitle"),
				empty: t("confirm.emptyTitle")
			};
			const descriptions = {
				delete: many ? t("delete.descMany", { n: sessionIds.length }) : t("delete.desc"),
				purge: t("confirm.purgeDesc"),
				empty: t("confirm.emptyDesc")
			};
			const pendingText = {
				delete: t("delete.pending"),
				purge: t("confirm.purgePending"),
				empty: t("confirm.emptyPending")
			};

			const close = () => {
				if (busy) return;
				onClose();
			};

			const confirm = () => {
				if (busy) return;
				// 删除前先记下：这批里是否有当前主视图的会话（删完就查不到了）
				const wasCurrent = kind === "delete" && sessionIds.some((id) => isCurrentSession(pluginCtx, id));
				setBusy(true);
				setError(null);
				void (async () => {
					try {
						if (kind === "empty") {
							const body = await call("/empty-trash", {});
							const failed = Array.isArray(body.failed) ? body.failed : [];
							onClose();
							bumpData();
							showNotice(failed.length === 0
								? t("confirm.emptied", { n: body.purged ?? 0 })
								: t("confirm.partialFailed", { n: failed.length }));
							return;
						}
						if (kind === "purge") {
							const payload = { entry: request.entry };
							if (request.all === true) payload.all = true;
							else payload.sessionId = request.sessionId;
							await call("/purge", payload);
							onClose();
							bumpData();
							showNotice(t("confirm.purged"));
							return;
						}
						if (many) {
							// 分批发送：每条都要停手 + 复查缓存，一次几百条会让单个请求跑几分钟
							const CHUNK = 25;
							let deleted = 0;
							let failed = 0;
							let workspaceId = null;
							const allWarnings = [];
							for (let offset = 0; offset < sessionIds.length; offset += CHUNK) {
								const slice = sessionIds.slice(offset, offset + CHUNK);
								const body = await call("/delete-many", { sessionIds: slice });
								deleted += body.deleted ?? 0;
								failed += body.failed ?? 0;
								if (typeof body.workspaceId === "string") workspaceId = body.workspaceId;
								if (Array.isArray(body.warnings)) allWarnings.push(...body.warnings);
								setProgress({ done: Math.min(offset + slice.length, sessionIds.length), total: sessionIds.length });
							}
							onClose();
							bumpData();
							showNotice(failed > 0
								? t("delete.partial", { ok: deleted, failed })
								: (allWarnings.length > 0 ? `${t("delete.doneMany", { n: deleted })} · ${allWarnings[0]}` : t("delete.doneMany", { n: deleted })));
							if (wasCurrent && !leaveDeletedView(pluginCtx, wasCurrent, workspaceId)) showNotice(t("delete.stuckHint"));
							return;
						}
						const body = await call("/delete", { sessionId: sessionIds[0] });
						const list = Array.isArray(body.warnings) ? body.warnings : [];
						onClose();
						bumpData();
						showNotice(list.length > 0 ? `${t("delete.done")} · ${list[0]}` : t("delete.done"));
						if (wasCurrent && !leaveDeletedView(pluginCtx, wasCurrent, body.workspaceId)) showNotice(t("delete.stuckHint"));
					} catch (reason) {
						setError(reason instanceof Error ? reason.message : String(reason));
						setBusy(false);
					}
				})();
			};

			const target = kind === "delete"
				? (many ? sessionIds.map(shortId).join(", ") : `${request.title ?? ""} · ${shortId(sessionIds[0])}`)
				: (kind === "purge" ? t("confirm.purgeTarget") : t("confirm.emptyTarget"));

			return h("div", {
				className: "dsr-scrim",
				role: "dialog",
				"aria-modal": "true",
				onClick: (event) => {
					if (event.target === event.currentTarget) close();
				}
			}, h("div", { className: "dsr-dialog" },
				h("div", { className: "dsr-dialog-h" }, titles[kind] ?? titles.delete),
				h("div", { className: "dsr-dialog-p" }, descriptions[kind] ?? descriptions.delete),
				h("div", { className: "dsr-dialog-target" }, target),
				busy && h("div", { className: "dsr-status", role: "status" }, pendingText[kind] ?? pendingText.delete),
				progress !== null && h("div", { className: "dsr-status", role: "status" },
					t("delete.progress", { done: progress.done, total: progress.total })),
				error !== null && h("div", { className: "dsr-error", role: "alert" },
					t("delete.failed", { message: error })),
				h("div", { className: "dsr-dialog-foot" },
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: close }, t("delete.cancel")),
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: confirm },
						h("span", { className: "dsr-danger" }, t("delete.confirm"))))));
		}


function RecycleToast() {
			const current = React.useSyncExternalStore(subscribeNotice, readNotice, readNotice);
			if (current === null) return null;
			return h(primitives.Toast, {
				key: current.seq,
				text: current.text,
				icon: h(primitives.IconCheckOutlineRegular, {}),
				onDone: clearNotice
			});
		}

		// ── 面板本体（设置页与侧栏页面共用） ────────────────────────────────

		/**
		 * 面板本体：设置页与侧栏页面共用同一份实现。
		 * @param props - { t, surface: "settings" | "sidebar", sidebarVisible, onToggleSidebar }
		 */
		function RecyclePanel(props) {
			const t = props.t ?? fallbackT;
			const [state, setState] = React.useState(null);
			const [loading, setLoading] = React.useState(true);
			const [error, setError] = React.useState(null);
			const [tab, setTab] = React.useState("trash");
			const [busy, setBusy] = React.useState(false);
			const [selected, setSelected] = React.useState(() => new Set());
			const [days, setDays] = React.useState(String(DEFAULT_DAYS));
			const [emptyOnly, setEmptyOnly] = React.useState(true);
			// 确认层直接在本组件内渲染：shell.overlay 在 Desktop 上没挂载出来，
			// 之前因此表现为「点彻底删除完全没反应」。
			const [confirmRequest, setConfirmRequest] = React.useState(null);
			const openConfirm = React.useCallback((request) => setConfirmRequest(request), []);
			const closeConfirm = React.useCallback(() => setConfirmRequest(null), []);


			/** 请求代次：旧响应晚到时直接丢弃，否则会把刚删掉的会话又画回来。 */
			const refreshSeq = React.useRef(0);

			const refresh = React.useCallback(() => {
				refreshSeq.current += 1;
				const mine = refreshSeq.current;
				setLoading(true);
				setError(null);
				void (async () => {
					try {
						const body = await call("/state", {});
						if (mine !== refreshSeq.current) return; // 已有更新的请求在跑，丢弃本次结果
						setState(body);
						// 已经不存在的会话要从选中集合里摘掉，否则「删除所选」会带着失效 id
						const alive = new Set((body.sessions ?? []).map((session) => session.id));
						setSelected((previous) => {
							const next = new Set([...previous].filter((id) => alive.has(id)));
							return next.size === previous.size ? previous : next;
						});
					} catch (reason) {
						setError(reason instanceof Error ? reason.message : String(reason));
					} finally {
						setLoading(false);
					}
				})();
			}, []);

			// 任何界面完成写操作后都会 bump，这里跟着重拉：弹窗与面板是两个组件，靠这条总线同步。
			const revision = React.useSyncExternalStore(subscribeData, readDataRevision, readDataRevision);

			React.useEffect(() => {
				refresh();
			}, [refresh, revision]);

			const run = React.useCallback((action) => {
				setBusy(true);
				void (async () => {
					try {
						await action();
						bumpData();
					} catch (reason) {
						setError(reason instanceof Error ? reason.message : String(reason));
					} finally {
						setBusy(false);
					}
				})();
			}, []);

			const sessions = state?.sessions ?? [];
			const trash = state?.trash ?? [];
			const cacheOnly = state?.orphans?.cacheOnly ?? [];
			const registryOnly = state?.orphans?.registryOnly ?? [];

			// 会话选择
			const toggleOne = (id) => {
				setSelected((previous) => {
					const next = new Set(previous);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};
			const selectMatching = () => {
				// 不勾「只看空会话」又给 0 天 = 全选，容易误删；先在客户端拦下来
				const dayCount = Number(days);
				if (!emptyOnly && !(dayCount > 0)) {
					setError(t("sessions.needDays"));
					return;
				}
				setBusy(true);
				void (async () => {
					try {
						const body = await call("/idle-candidates", { days: Number.isFinite(dayCount) ? Math.max(0, dayCount) : 0, emptyOnly });
						const candidates = body.candidates ?? [];
						// 用函数式更新：请求期间用户可能又勾/取消了几条，不能拿点击时的快照覆盖掉
						setSelected((previous) => {
							const next = new Set(previous);
							for (const candidate of candidates) next.add(candidate.id);
							return next;
						});
						showNotice(t("sessions.matched", { n: candidates.length }));
					} catch (reason) {
						setError(reason instanceof Error ? reason.message : String(reason));
					} finally {
						setBusy(false);
					}
				})();
			};

			const restore = (item) => run(async () => {
				await call("/restore", { entry: item.entry, sessionId: item.id });
				showNotice(t("hint.refresh"));
			});
			const purge = (item) => {
				openConfirm({ kind: "purge", entry: item.entry, sessionId: item.id, title: item.title });
			};
			const emptyAll = () => {
				openConfirm({ kind: "empty" });
			};
			const cleanOrphan = (id) => run(() => call("/clean-orphans", { sessionIds: [id] }));
			const cleanAll = () => run(async () => {
				const body = await call("/clean-orphans", {});
				showNotice(t("orphans.done", { cache: body.removedCaches ?? 0, registry: (body.registryIds ?? []).length }));
			});

			const sessionList = sessions.length === 0
				? h("div", { className: "dsr-empty" }, t("sessions.none"))
				: h("div", { className: "dsr-list" }, sessions.map((session) => h("div", { className: "dsr-row", key: session.id },
					h("div", { className: "dsr-row-check" },
						h("input", {
							type: "checkbox",
							checked: selected.has(session.id),
							onChange: () => toggleOne(session.id)
						})),
					h("div", { className: "dsr-row-main" },
						h("div", { className: "dsr-title" },
							titleOf(session, t),
							session.archived && h("span", { className: "dsr-sub" }, " · 归档"),
							session.pinned && h("span", { className: "dsr-sub" }, " · 置顶")),
						h("div", { className: "dsr-sub" },
							`${shortId(session.id)} · ${session.turns === null || session.turns === void 0 ? t("sessions.turnsUnknown") : t("sessions.turns", { n: session.turns })} · ${fmtBytes(session.bytes)} · ${t("sessions.lastAt", { time: fmtTime(session.lastAt ?? session.mtime) })}`)))));

			const sessionsTab = h(Fragment, null,
				h("div", { className: "dsr-toolbar" },
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => setSelected(new Set(sessions.map((s) => s.id))) }, t("sessions.selectAll")),
					h(primitives.Button, { variant: "outline", disabled: busy || selected.size === 0, onClick: () => setSelected(new Set()) }, t("sessions.clear")),
					h("span", { className: "dsr-sub" }, t("sessions.selected", { n: selected.size }))),
				h("div", { className: "dsr-toolbar" },
					h("span", { className: "dsr-sub" }, t("sessions.byDays")),
					h("input", {
						className: "dsr-days",
						type: "number",
						min: "0",
						value: days,
						onChange: (event) => setDays(event.target.value)
					}),
					h("span", { className: "dsr-sub" }, t("sessions.daysLabel")),
					h("label", { className: "dsr-check" },
						h("input", { type: "checkbox", checked: emptyOnly, onChange: () => setEmptyOnly(!emptyOnly) }),
						t("sessions.emptyOnly")),
					h(primitives.Button, { variant: "outline", disabled: busy, onClick: selectMatching },
						t("sessions.preview"))),
				sessionList,
				h("div", { className: "dsr-toolbar" },
					h(primitives.Button, {
						variant: "outline",
						disabled: busy || selected.size === 0,
						onClick: () => openConfirm({ sessionIds: [...selected], title: "" })
					}, h("span", { className: "dsr-danger" }, `${t("sessions.deleteSelected")} (${selected.size})`))),
				h("div", { className: "dsr-hint" }, t("delete.desc")));

			const trashList = trash.length === 0
				? h("div", { className: "dsr-empty" }, t("trash.empty"))
				: h("div", { className: "dsr-list" }, trash.map((item) => h("div", { className: "dsr-row", key: `${item.entry}/${item.id}` },
					h("div", { className: "dsr-row-main" },
						h("div", { className: "dsr-title" }, item.title ?? t("unknown")),
						h("div", { className: "dsr-sub" },
							`${shortId(item.id)} · ${fmtBytes(item.bytes)} · ${t("trash.removedAt", { time: fmtTime(item.removedAt) })}`)),
					h("div", { className: "dsr-actions" },
						h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => restore(item) }, t("trash.restore")),
						h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => purge(item) },
							h("span", { className: "dsr-danger" }, t("trash.purge")))))));

			const orphansTab = cacheOnly.length === 0 && registryOnly.length === 0
				? h("div", { className: "dsr-empty" }, t("orphans.none"))
				: h(Fragment, null,
					h("div", { className: "dsr-hint" }, t("orphans.hint")),
					cacheOnly.length > 0 && h("div", { key: "cache-block" },
						h("div", { className: "dsr-sub" }, t("orphans.cacheOnly", { n: cacheOnly.length })),
						h("div", { className: "dsr-list" }, cacheOnly.map((item) => h("div", { className: "dsr-row", key: `c-${item.id}` },
							h("div", { className: "dsr-row-main" },
								h("div", { className: "dsr-title" }, item.title ?? t("unknown")),
								h("div", { className: "dsr-sub" }, shortId(item.id))),
							h("div", { className: "dsr-actions" },
								h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => cleanOrphan(item.id) }, t("orphans.clean"))))))),
					registryOnly.length > 0 && h("div", { key: "registry-block" },
						h("div", { className: "dsr-sub" }, t("orphans.registryOnly", { n: registryOnly.length })),
						h("div", { className: "dsr-list" }, registryOnly.map((id) => h("div", { className: "dsr-row", key: `r-${id}` },
							h("div", { className: "dsr-row-main" },
								h("div", { className: "dsr-title" }, shortId(id)),
								h("div", { className: "dsr-sub" }, id)),
							h("div", { className: "dsr-actions" },
								h(primitives.Button, { variant: "outline", disabled: busy, onClick: () => cleanOrphan(id) }, t("orphans.clean"))))))));

			const sidebarCard = props.surface === "settings"
				? h("div", { className: "dsr-card" },
					h("div", { className: "dsr-card-main" },
						h("div", { className: "dsr-title" }, t("settings.sidebar.label")),
						h("div", { className: "dsr-sub" }, t("settings.sidebar.hint"))),
					h("div", { className: "dsr-seg" },
						h("button", {
							type: "button",
							"data-active": String(props.sidebarVisible !== true),
							onClick: () => props.onToggleSidebar?.(false)
						}, t("settings.sidebar.hide")),
						h("button", {
							type: "button",
							"data-active": String(props.sidebarVisible === true),
							onClick: () => props.onToggleSidebar?.(true)
						}, t("settings.sidebar.show"))))
				: null;

			return h("div", { className: "dsr-panel" },
				sidebarCard,
				h("div", { className: "dsr-tabs" },
					h("button", { className: "dsr-tab", "data-active": String(tab === "sessions"), onClick: () => setTab("sessions") },
						`${t("tab.sessions")} (${sessions.length})`),
					h("button", { className: "dsr-tab", "data-active": String(tab === "trash"), onClick: () => setTab("trash") },
						`${t("tab.trash")} (${trash.length})`),
					h("button", { className: "dsr-tab", "data-active": String(tab === "orphans"), onClick: () => setTab("orphans") },
						`${t("tab.orphans")} (${cacheOnly.length + registryOnly.length})`),
					h("div", { className: "dsr-spacer" }),
					h(primitives.Button, { variant: "outline", disabled: busy || loading, onClick: () => refresh() }, t("state.refresh"))),

				loading && h("div", { className: "dsr-status" }, t("state.loading")),
				state?.degraded === true && h("div", { className: "dsr-error", role: "alert" },
					t("state.degraded", { message: state.degradedError ?? "" })),
				error !== null && h("div", { className: "dsr-error", role: "alert" }, t("action.failed", { message: error })),

				tab === "sessions" && sessionsTab,
				tab === "trash" && h(Fragment, null,
					trashList,
					trash.length > 0 && h("div", { className: "dsr-toolbar" },
						h(primitives.Button, { variant: "outline", disabled: busy, onClick: emptyAll },
							h("span", { className: "dsr-danger" }, t("trash.emptyAll"))))),
				tab === "orphans" && h(Fragment, null,
					orphansTab,
					(cacheOnly.length > 0 || registryOnly.length > 0) && h("div", { className: "dsr-toolbar" },
						h(primitives.Button, { variant: "outline", disabled: busy, onClick: cleanAll }, t("orphans.cleanAll")))),

				state !== null && h("div", { className: "dsr-hint" }, state.locations?.trash ?? ""),
				// 遮罩放在面板内部最外层：绝对定位铺满面板，居中显示对话框
				confirmRequest !== null && h(ConfirmOverlay, { request: confirmRequest, t, onClose: closeConfirm }));
		}

		// ── 插件主体 ────────────────────────────────────────────────────────

		/** 由 apply() 注入的兜底翻译函数：插槽万一没给 `t` 也不至于白屏报错。 */
		let fallbackT = (key) => key;

		/** 由 apply() 注入的插件上下文，用于查询「当前会话」。 */
		let pluginCtx = null;

		/** 设置页容器：把侧栏开关的实时状态喂给面板。 */
		function SettingsPanel(props = {}) {
			const visible = React.useSyncExternalStore(subscribeSidebarPref, readSidebarPrefState, readSidebarPrefState);
			return h(RecyclePanel, {
				t: props.t ?? fallbackT,
				surface: "settings",
				sidebarVisible: visible,
				onToggleSidebar: (next) => {
					sidebarPref = next;
					writeSidebarPref(next);
					applySidebarVisibility(next);
					for (const listener of [...sidebarPrefListeners]) listener();
				}
			});
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			const t = (key, params) => {
				const bound = ctx.locale.bind(NS)(key);
				if (params === void 0) return bound;
				return String(bound).replace(/\{(\w+)\}/g, (match, name) => (params[name] === void 0 ? match : String(params[name])));
			};
			fallbackT = t;
			pluginCtx = ctx;

			ctx.effect(() => {
				const style = document.createElement("style");
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => style.remove();
			}, `${PKG}: style`);

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PKG}: dictionaries`);

			/** 侧栏入口的当前状态（默认显示），设置页的分段开关改它。 */
			const sidebarGate = createGate(() => {
				// 两个注册必须同生共死：第二个失败时把第一个退掉，否则会留下半个入口
				let offPage = null;
				let offRow = null;
				try {
					offPage = ctx.slots.register({
						name: "main",
						key: PANEL_ID,
						locale: NS,
						inject: () => ({ t })
					}, (owner = {}) => h("div", { className: "dsr-page" },
						h(RecyclePanel, { t: owner.t ?? t, surface: "sidebar" })));
					offRow = ctx.slots.register({
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 3,
						label: () => ctx.locale.bind(NS)("sidebar.label"),
						locale: NS
					}, (owner = {}) => h(primitives.IconTrashOutlineRegular, { size: owner.size ?? 16 }));
				} catch (error) {
					if (typeof offRow === "function") offRow();
					if (typeof offPage === "function") offPage();
					throw error;
				}
				return () => {
					if (typeof offRow === "function") offRow();
					if (typeof offPage === "function") offPage();
				};
			}, sidebarPref);

			// 宿主是否提供 sidebar.panellist：提供才谈得上挂行。
			ctx.slots.inject("sidebar.panellist", () => {
				sidebarGate.available();
			});

			/** 布局服务：关掉侧栏入口时如果正停在本页，需要把主区切回默认页，否则会留一个空页。 */
			let layout;
			ctx.inject(["layout"], (scoped) => {
				layout = scoped.layout;
			});

			applySidebarVisibility = (visible) => {
				writeSidebarPref(visible);
				sidebarGate.setVisible(visible);
				if (visible) return;
				try {
					if (layout?.panelInfo?.getSnapshot?.().activePanelId === PANEL_ID) layout.selectPanel(null);
				} catch {
					/* 切不回去也不影响开关本身 */
				}
				// 关掉当前正开着的面板时把侧栏切回默认页面由宿主决定，这里只保证下一次点击有效。
			};

			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "session-recycle-toast",
					order: 63,
					locale: NS
				}, RecycleToast);
			});

			ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
				yield ctx.slots.register({
					name: "sidebar.workspaces.session.menu.item",
					id: "session-recycle-delete",
					order: 605,
					locale: NS
				}, RecycleMenuItem);
			});

			ctx.slots.inject("settings.section", function* () {
				sidebarGate.available();
				return ctx.slots.register({
					name: "settings.section",
					id: "session-recycle",
					order: 31,
					label: () => ctx.locale.bind(NS)("settings.title"),
					locale: NS
				}, SettingsPanel);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.zh = zh;
		exports.en = en;
		return module.exports;
	}
});
