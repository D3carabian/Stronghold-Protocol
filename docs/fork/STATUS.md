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

邮箱验证＋邀请码：方案已确定，等待邮件服务后开发和接入，当前未实现。
后台、随机控制、战绩、机制修复：未实现，按 [ROADMAP.md](ROADMAP.md) 开发。
真机 iPhone/iPad Safari 验收与 Windows 客户端提取：尚未进行，操作步骤已写入 [MOBILE.md](MOBILE.md) 和 [ASSETS.md](ASSETS.md)。
服务器自动快照仍未开启；未来数据库另需备份。

Tailscale 访问规则由所有者在另一处调整；本次未改动该策略，收尾通过公网备用 SSH 完成。
