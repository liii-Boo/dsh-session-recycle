# 发布手记（维护者用）

当前工作版本为 **1.0.2**，修复还原目标目录校验与孤儿清理的成功判断（1.0.1 的后续修复）。
本地打包不代表已经发布。公开版本以 [Releases](https://github.com/liii-Boo/dsh-session-recycle/releases) 为准。

## 发版流程

1. 运行验证和打包：

```powershell
npm test
npm run audit
node --check client.js
node --check index.js
npm pack
npm run verify:release -- .\liii-boo-dsh-session-recycle-1.0.2.tgz
```

2. 审阅改动，合并修复分支并推送；确认 `package.json` 版本与待发布 tag 一致。
3. 为已验证提交创建新 tag，不移动或强推已有 tag：

```powershell
git tag -a v1.0.2 -m "1.0.2"
git push origin v1.0.2
```

4. 在 GitHub 创建 `v1.0.2` Release，上传本次校验过的 tgz，正文参考 `scripts/release-body.md`。
   旧版本和旧附件保留。若使用 `scripts/release-update.mjs`，已有同名 Release 会被拒绝，不能覆盖。
5. 发布后运行 `npm run verify:release`，下载当前 package 版本的附件并逐文件比对源码。
   未发布前请传本地 tgz 路径；404 表示附件不存在，不能视为验证通过。

## 注意

- npm 发布需要维护者自己的 npm 账号；本流程只涉及 GitHub Release。
- 不把访问令牌写进命令参数、源码、发布说明或日志。脚本从 `GITHUB_TOKEN` 环境变量读取。
- `desktop` profile 由 Electron 管理，请通过应用插件页安装。
- `package.json` 的包名、`cordis.patch.yml` 和 `client.js` 模块 id 必须一致。
- 修改后端代码需要重新加载插件或重启宿主；加载修复版之后，每次还原会话无需重启。
- 运行时释放目前依赖 DSH `0.2.1-rc.2` 的内部生命周期 effect；升级宿主后应重新进行删除、还原、打开的真实界面验收。
