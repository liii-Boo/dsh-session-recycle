# 发布清单（GitHub + npm）

这份文件不进 npm 包（`files` 白名单里没有它），只作为仓库内的发布手记。

## 0. 前提：本机没有 git

`git` 不在 PATH 上（`git ls-remote` 报 `'git' 不是内部或外部命令`）。三条路选一条：

| 方案 | 命令 | 说明 |
|---|---|---|
| A. 装 Git（推荐） | `winget install --id Git.Git -e` | 装完重开终端，`git --version` 有输出即可 |
| B. GitHub Desktop | 图形界面 Add local repository | 不用命令行，但要先装 app |
| C. 网页上传 | 仓库页 → Add file → Upload files | 最省事，适合只发一次；后续改版麻烦 |

## 1. 本地准备（提交前）

```powershell
$d = "C:\Users\li\Documents\deepseek-harness\default-workspace\plugins\@liii-boo/dsh-session-recycle"
cd $d
npm test                      # 必须 8/8 通过
npm pack --dry-run            # 确认 7 个文件、含 LICENSE
node --check client.js        # 浏览器半边语法
node -e "import('./index.js').then(m=>console.log(Object.keys(m)))"   # 宿主半边可载入
```

`.gitignore` 已排除 `node_modules/`、`*.tgz`、日志。

## 2. 建仓库并推送

仓库名建议与包名一致：`@liii-boo/dsh-session-recycle`。

```powershell
cd $d
git init -b main
git add -A
git commit -m "feat: 会话回收站插件 v0.2.2"
git remote add origin https://github.com/liii-Boo/@liii-boo/dsh-session-recycle.git
git push -u origin main
```

推送后确认：仓库首页能看到 `README.md` 渲染、右侧 License 显示 MIT。

## 3. 打 Release（附 tgz，别人不用 npm 也能装）

```powershell
cd $d
npm pack                       # 产出 @liii-boo/dsh-session-recycle-0.2.2.tgz
```

GitHub → Releases → Draft a new release → tag `v0.2.2` → 上传 tgz → 发布。
安装方式写进 Release 说明：

```powershell
# 从 tgz 安装
dsh plugin --profile <profile> add <tgz 的绝对路径>
```

## 4. 发 npm（可选，但只有发了 npm 才能 `add @liii-boo/dsh-session-recycle`）

```powershell
npm login                      # 需要 npm 账号
npm publish                    # package.json 里 publishConfig.access = public
```

注意点：

- 包名 `@liii-boo/dsh-session-recycle` 若已被占用，`npm publish` 会报 403；先用 `npm view @liii-boo/dsh-session-recycle version` 探一下。
- 桌面版 profile 由应用独占，`dsh plugin --profile desktop add` 会被拒绝，发布说明里要写清"桌面版请用插件页安装"。

## 5. 让别人搜得到（可选）

- 给 `awesome-dsh-plugin` 提 PR 加一行；
- 装过 `dshmarket`（插件市场）的 profile 里，市场索引可以直接收录。

## 6. 发布前必须写进 README 的话

- 这是社区插件，不是 DeepSeek 官方产品；
- 删除 = 移入 `~/.dsh/trash/`，**不自动过期**，`彻底删除`/`清空` 才真正释放磁盘；
- 备份提醒：插件直接操作 `~/.dsh/sessions`、`~/.dsh/storages/workspace.json`，第一次用前建议整目录备份一次。
