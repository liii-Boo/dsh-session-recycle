## DSH 会话回收站 1.0.0

给 DeepSeek Harness 的会话补上删除能力：右键删除进回收站，可还原。

### 三种安装方式

**1. 从本页附件安装（推荐，不需要 npm 账号）**

下载下面的 `liii-boo-dsh-session-recycle-1.0.0.tgz`，然后在你自己的终端里：

```powershell
dsh plugin --profile <你的 profile> add <tgz 的绝对路径>
```

**2. 直接用 git 装**

```powershell
dsh plugin --profile <你的 profile> add https://github.com/liii-Boo/dsh-session-recycle
```

**3. 桌面版（Electron）**

`desktop` profile 由应用独占，命令行会被拒绝：
`profile "desktop" is managed exclusively by the Electron application`。
请在 **设置 → 插件** 里安装，或让 agent 帮你完成「pnpm 安装 + 写入 `dsh.profile.bundles`」。

装完**重启 DSH**，然后到「设置 → 会话回收站」看面板。

### 这个版本能做什么

- 会话右键菜单：「删除会话」→ 二次确认 → 进 `~/.dsh/trash`
- 侧栏入口（设置里可开关）：点进去就是完整面板
- 面板三个页签：会话（批量删除、按天数清理空会话）、回收站（还原/彻底删除/清空）、孤儿缓存（诊断+清理）
- 删除时三处一起处理：日志目录、`workspace.json` 登记、投影缓存，不留幽灵行
- 还原通过 `workspaceRegistry` 服务登记，并恢复归档/置顶标记

### 重要提醒

**删除 = 移进回收站，可还原；只有「彻底删除 / 清空」才真正释放磁盘。**
第一次使用前建议备份 `~/.dsh/sessions` 和 `~/.dsh/storages`。

### 环境要求

| 项 | 要求 |
|---|---|
| DSH | `0.2.0-rc.1` ~ `0.2.1-rc.2`（在 `0.2.1-rc.2` 上开发验证） |
| Node | `>=22.19`（仅开发/测试需要） |
| 平台 | Windows / macOS / Linux |

### 验证情况

- 16 个离线单测通过（回收站往返、标记还原、路径白名单、还原冲突、扫描降级、缓存回写清扫等）
- 发布一致性自检 12 项通过
- 在 Windows + DSH Desktop `0.2.1-rc.2` 上实测：右键删除、批量删除、回收站还原、侧栏入口开关

完整说明见 [README](https://github.com/liii-Boo/dsh-session-recycle#readme)。
