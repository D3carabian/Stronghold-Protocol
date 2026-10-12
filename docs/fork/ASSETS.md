# 资源导入与 Windows 后续流程

## 当前使用 Release 资源

`ops/assets.lock.json` 锁定上游正式版本、完整包地址和 GitHub 提供的 SHA-256。仅导入资源与资源清单，不执行
Release 包里的程序、不复制其 node_modules、不混入更新包。代码始终来自本 fork。

```sh
gh release download v0.2.4 -R sganggs/Stronghold-Protocol -p 'Stronghold-Protocol-v0.2.4.zip' -D .local/downloads
python3 ops/asset_bundle.py import-release .local/downloads/Stronghold-Protocol-v0.2.4.zip .local/assets/BUNDLE_ID
python3 ops/asset_bundle.py validate .local/assets/BUNDLE_ID
```

工具核对归档哈希、应用版本、路径安全和清单中的每个资源引用。失败不会替换已有目录。
目录包含 `public/assets/`、`public/fonts/`、`data/assets.json`、`data/local-assets.json` 和来源元数据。
部署时整套目录只读挂载，不能只换图片不换清单。更新要创建新目录，先在测试服验证。

## 以后从另一台 Windows 电脑导入

在有完整明日方舟客户端资源的 Windows 电脑安装 Git、Node.js 22/24、Python 3.11/3.12。
克隆本 fork，切换到与准备部署的代码相同的提交，执行 `npm ci`。在 PowerShell 中：

```powershell
.\ops\export_windows_assets.ps1 -GameDirectory 'D:\实际客户端路径\StreamingAssets\AB\Windows' -OutputDirectory 'D:\StrongholdExports'
```

脚本调用上游自动提取工具，检查资源完整性，并生成资源 ZIP 及 `.lock.json`；不会把游戏账号或完整客户端上传。
路径必须替换成你的真实路径，并先在客户端完成所需资源下载。脚本已准备，尚未在你的 Windows 电脑执行验证。
不要修改全局 PowerShell 执行策略；如果系统拦截脚本，可检查脚本后只在当前进程允许执行。

把 ZIP 和对应 `.lock.json` 通过你信任的私有传输方式带到开发电脑，或用 Windows 自己的 SSH 密钥传到服务器。
不要复制本机 PEM 到聊天，也不要把资源提交到公开 GitHub。然后运行：

```sh
python3 ops/asset_bundle.py import-release CUSTOM.zip .local/assets/CUSTOM_ID --lock CUSTOM.zip.lock.json
python3 ops/asset_bundle.py validate .local/assets/CUSTOM_ID
rsync -a .local/assets/CUSTOM_ID/ my-lightsail:/tmp/stronghold-assets-CUSTOM_ID/
```

在服务器校验后移入 `/srv/stronghold/assets/CUSTOM_ID`，使用发布工具先切测试服。
如果只需替换本地额外素材，仍从完整资源基线导出整套目录；不要覆盖线上资源目录。

客户端版本改变或上游提取器改变时再重新导出。后台自动检测客户端变动可以后续在 Windows 上设置，
本阶段没有在那台电脑创建定时任务。素材仍受原权利人的限制，保留 NOTICE，不公开发布资源包。

## 手机与 iPad

浏览器使用的是导出的网页资源，不需要 iPhone/iPad 安装或提取原游戏。
相同素材可服务电脑和移动端。手机适配的关键还包括 WebGL、纹理内存、触摸和浏览器音频限制，
见 [MOBILE.md](MOBILE.md)。更多资源不等于更好的移动端性能。
