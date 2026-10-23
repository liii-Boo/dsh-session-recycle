## DSH 会话回收站 1.0.0

给 DeepSeek Harness 的会话补上删除能力：右键删除进回收站，可还原。

**侧栏入口**

<img src="https://raw.githubusercontent.com/liii-Boo/dsh-session-recycle/main/docs/sidebar.png" width="300" alt="侧栏入口" />

**会话页签：批量删除与按天数清理**

![会话页签](https://raw.githubusercontent.com/liii-Boo/dsh-session-recycle/main/docs/panel.png)

**「彻底删除」确认**

![确认对话框](https://raw.githubusercontent.com/liii-Boo/dsh-session-recycle/main/docs/dialog.png)

### 三种安装方式

**1. 从本页附件安装（推荐，不需要 npm 账号）**

下载下面的 `liii-boo-dsh-session-recycle-1.0.0.tgz`，然后在终端里：

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

装完**重启 DSH**，然后到「设置 → 会话回收站」看面板；也可以在设置里打开侧栏入口。

### 这个版本能做什么

- 会话右键菜单：「删除会话」→ 居中确认框 → 进 `~/.dsh/trash`
- 侧栏入口（设置里可开关）：点进去就是完整面板
- 面板三个页签：会话（批量删除、按天数清理空会话）、回收站（还原 / 彻底删除 / 清空）、孤儿缓存（诊断 + 清理）
- 删除时三处一起处理：日志目录、`workspace.json` 登记、投影缓存，不留幽灵行
- 还原通过 `workspaceRegistry` 服务登记，并恢复归档/置顶标记
- 子代理会话（目录名是裸 uuid）同样能识别、删除、还原

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

- **39 个测试全过**：30 个存储层单测 + 9 个路由层测试（含删除→回收站→彻底删除的完整链路）
- 路由层测试会真实驱动 `delete → state → purge`，断言文件从磁盘消失
- 在 Windows + DSH Desktop `0.2.1-rc.2` 上实测：右键删除、批量删除、回收站还原、彻底删除、侧栏入口、子代理会话删除与还原
- 修复：读不到会话目录时不再误判孤儿（降级并拒绝清理）；轮数未知不再当成 0 轮；还原失败会回滚；不勾空会话时必须给天数
- 归档/置顶标记改从宿主服务读取；只留在归档集合里的孤儿登记也能被诊断；批量删除分批发送并显示进度

完整说明见 [README](https://github.com/liii-Boo/dsh-session-recycle#readme)。
