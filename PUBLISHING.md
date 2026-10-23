# 发布手记（维护者用）

这份文件不进 npm 包，只是仓库内的备忘。

## 当前状态

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/liii-Boo/dsh-session-recycle |
| 版本 | 1.0.0（tag `v1.0.0`） |
| Release | 已发布，附件 `liii-boo-dsh-session-recycle-1.0.0.tgz` |
| npm | **未发布**（`liii-Boo` 还没有 npm 账号，注册页当时打不开） |

## 这台机器上的 git 配置

git 装在 `D:\Git\cmd\git.exe`（不在 PATH 里，调用要写全路径）。
仓库内已配置（只作用于这个仓库，没动全局）：

```
http.proxy      = http://127.0.0.1:7890
https.proxy     = http://127.0.0.1:7890
http.sslBackend = openssl
```

前两条是因为系统代理只对浏览器生效、git 直连 GitHub 会超时；
第三条是因为走代理时 schannel 握手失败，换成 openssl 才能通。
**如果代理换了端口，改这两行即可。**

提交身份只写在本仓库：`liii-Boo <liii-Boo@users.noreply.github.com>`。

## 发版流程

```powershell
$git = "D:\Git\cmd\git.exe"
$d   = "C:\Users\li\Documents\deepseek-harness\default-workspace\plugins\dsh-session-recycle"
cd $d

# 1. 全量验证
node --test test/recycle.test.mjs test/routes.test.mjs   # 期望 28 通过
node test/audit.mjs .                                    # 结构自审
node test/audit-hooks.mjs .                              # hooks 顺序
node --check client.js
node --check lib/store.mjs

# 2. 提交并推送
& $git add -A
& $git commit -m "..."        # 中文多行建议写文件后 git commit -F，避免被当成路径
& $git push origin main

# 3. 移动 tag（对外仍是 1.0.0 这种单版本发布时）
& $git tag -d v1.0.0
& $git tag -a v1.0.0 -m "1.0.0"
& $git push -f origin v1.0.0

# 4. 打包并更新 Release 附件
Get-ChildItem *.tgz | Remove-Item -Force
npm pack
node scripts/release-update.mjs <token> "liii-Boo/dsh-session-recycle" "v1.0.0" "<tgz>" "scripts/release-body.md"
```

token 可以从 git 凭证里取，不必手抄：

```powershell
$req  = "protocol=https`nhost=github.com`n`n"
$resp = $req | & $git credential fill 2>$null
$tok  = ($resp | Where-Object { $_ -match '^password=' }) -replace '^password=',''
```

## 以后要发 npm

1. 打开 https://www.npmjs.com/signup 注册（用户名建议 `liii-Boo`）
2. 邮箱验证
3. `npm login`，然后 `npm publish`（`publishConfig.access = public` 已配好）

发布前的自检：`node test/lint-package.mjs .`（12 项，全过才能发）。

## 注意

- 修改 `package.json` 的 `name` 时，`cordis.patch.yml` 里的 `name` 和 `client.js` 的模块 id 必须同步改，否则插件加载不了（`test/lint-package.mjs` 会检查这一点）。
- `desktop` profile 由 Electron 独占，命令行 `dsh plugin --profile desktop add` 一定会被拒绝，桌面用户请在插件页安装。
