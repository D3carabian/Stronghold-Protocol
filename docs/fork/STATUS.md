# 当前状态

已完成基础部署（2026-10-12，America/Chicago）。

## 已上线

- 正式服：https://play.d3carab1an.com ，临时用户名 owner。
- 测试服：https://test-play.d3carab1an.com ，临时用户名 tester。
- 两边使用不同临时访问密码，凭据单独保存在本机私人文件，未提交到 Git。
- 基线：上游 v0.2.4；部署镜像 `stronghold:b7b9525568bf644c070c5a21563b92c452f522c0`。
- 资源包：`v0.2.4-0ec5781b8ac0`，来自完整 Release；SHA-256 见 `ops/assets.lock.json`。
- 两套独立 Compose 项目，仅本机端口，HTTPS，认证覆盖 HTTP/WS，拒绝其他 Origin 的浏览器 WebSocket。
- 空闲发布工具、候选健康检查、失败恢复与上一版参数保留已准备；新连接维护门禁实测不会断开原连接。
- 上游更新候选工具已准备；CI 已启用。没有定时自动合并和生产无人值守部署。

## 验收证据

本地 `npm run ci`：5,971 项测试，5,932 通过，39 跳过，0 失败；setup、smoke、lint、imports、typecheck 均通过。
该次完整检查开始于维护开关加入之前；之后维护开关及文档定向检查 32/32 通过，GitHub 同提交 CI 对最终代码重新验证。
`npm run golden`：287 个场景结果一致。Python 运维工具测试 5/5 通过。lint 0 error（上游现有 warnings 保留）。
GitHub Fork operations checks 运行 38210534637 成功，包含镜像构建及 Compose 配置检查。
GitHub CI 运行 38210534629 全部成功：Ubuntu/Windows × Node.js 22/24，以及 lint/imports/typecheck。

真实外网验收：两域名匿名 `/`、`/ws`、`/healthz`、资源请求均 401；正确凭据正常，跨环境凭据被拒；
HTTPS WebSocket 握手和 hello 成功；跨站 Origin 被拒；创建测试服双人房间，正式服无法加入；测试房间已清理。
音频 Range 请求返回 206 和正确 MIME；清单中 12,564 条资源引用通过完整性检查。
测试服有人时尝试部署被拒绝，原有对局与连接继续运行，维护文件自动撤销。
Chrome 通过 SSH 测试隧道进入实际单人对局、策略选择及 3D 棋盘；测试对局已主动退出。
Mac Safari 通过相同隧道成功加载并进入大厅；这不代表已测试 Safari 的公网 Basic Auth、完整对局或手机触摸。

## 待完成

邮箱验证＋邀请码已在本页下方的同日后续更新中上线。
后台、随机控制、战绩、机制修复：未实现，按 [ROADMAP.md](ROADMAP.md) 开发。
真机 iPhone/iPad Safari 验收与 Windows 客户端提取：尚未进行，操作步骤已写入 [MOBILE.md](MOBILE.md) 和 [ASSETS.md](ASSETS.md)。
服务器自动快照仍未开启；未来数据库另需备份。

Tailscale 访问规则由所有者在另一处调整；本次未改动该策略，收尾通过公网备用 SSH 完成。

## 邮箱准入上线（同日后续更新）

本节覆盖上方基础部署时的认证与镜像状态。

- 两环境现在均采用邮箱验证码＋邀请码，已替换共享 Basic Auth；首次加入消耗邀请，回访只需邮箱验证码。
- 运行镜像均为 `stronghold:dcc49fbcc81bc5a6a32339771af460f8cc77608a`，玩法与资源仍为 v0.2.4。
- 发信域名 `mail.d3carab1an.com` 的 Resend 验证已通过。测试邮件成功发送，所有者亲自完成验证码登录；
  浏览器实际显示已连接游戏服务器。正式服使用同一已验证发信域名与适配器，未另发第二封测试邮件。
- 所有者已预先加入两边管理员名单，仍须邮箱验证码；正式与测试账号、Cookie、密钥、数据库分离。
- 测试服最后一次升级后，原账号和登录状态保留。正式服、测试服公网登录页 200，匿名游戏资源及健康接口 401，
  匿名 WebSocket 401，外站 Origin 403，伪造转发 IP/健康头无法绕过。
- 已生成正式服 3 个、测试服 1 个单次邀请，有效期 7 天；明文只保存于所有者本机私有文件，不在仓库中。
- 操作说明见 [AUTH.md](AUTH.md)；新版代理模板为 `ops/Caddyfile.auth.example`。旧门禁配置私下保留供旧版恢复。
- 数据库采用独立持久目录；发布前自动本机一致性备份，仍未设置定时异地备份。
- Tailscale SSH 已恢复并验证，本次通过私有地址部署；未改 Tailscale 策略。

认证版本的本地完整检查：5,983 tests / 5,944 pass / 39 skip / 0 fail，所有 CI 步骤通过。
最终客户端会话过期修正另通过 354 项客户端检查，并重跑 smoke/lint/imports/typecheck。
认证与维护定向检查 11/11，运维工具 9/9；287 个 golden 场景一致，无玩法基线变化。
390px Chromium 登录页布局、语言切换通过；不是 iPhone/iPad Safari 真机验收。

发现并修复了 SQLite 备份连接未显式关闭的问题：首次空库候选正常，有库时 root 所有的 WAL/SHM 导致候选启动失败。
候选检查阻止了这次升级，线上未被替换；修复显式关闭连接、生成无 sidecar 的备份后，携带账号/会话的升级成功。
回归测试持有连接引用，确认备份返回时连接已关闭、无目标 WAL/SHM，并验证失败升级恢复原数据。

## 网页图标更新

游戏页和登录页已统一采用所有者提供的活动 logo，经 imagegen 清理为正方形；图标与提示词见 [BRANDING.md](BRANDING.md)。
正式服、测试服的图标版本镜像为 `stronghold:d4d4c18000f0b69131b69aafa927cefcd1108fd2`。
浏览器图标、Apple 主屏幕图标与 Web App manifest 已更新。新图标无需登录即可读取，游戏资源仍受登录保护。
两环境线上 PNG 的内容均与本地文件完全一致，登录页引用与 manifest 已检查。发布时两边均无在线对局。
