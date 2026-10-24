/**
 * DSH 0.2.1-rc.2 没有按 id 释放 Agent 的公开入口。
 * scope.dispose() 只释放插件作用域，不会关闭 writer 或摘除 Agent/Session。
 * 这里严格匹配宿主拥有该 scope 的完整生命周期 effect；结构不符就拒绝删除。
 */
export async function disposeAgentRuntime(agent) {
  const effectKey = Symbol.for('cordis.effect');
  const scopeMeta = agent.scope?.rawDispose?.[effectKey];
  const owner = agent.ctx?.fiber?.parent?.fiber;
  const effects = owner?._disposables;
  if (scopeMeta === undefined || typeof effects?.[Symbol.iterator] !== 'function') {
    throw new Error('当前宿主不支持安全释放会话运行时');
  }
  const matches = [...effects].filter((dispose) => {
    const meta = dispose?.[effectKey];
    return typeof dispose === 'function'
      && meta?.label === `agentLoop.scope(${agent.id})`
      && meta.children?.includes(scopeMeta);
  });
  if (matches.length !== 1) throw new Error('无法唯一确定该会话的运行时生命周期');
  await matches[0]();
}
