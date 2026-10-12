# 部署与回滚

> 邮箱认证启用后的实际入口见 [STATUS.md](STATUS.md)，账号、邀请、数据库备份及认证回滚见 [AUTH.md](AUTH.md)。
> 以下 Basic Auth 配置保留作旧版恢复参考；不要在认证镜像回滚前移除旧版所需的保护。

## 环境

正式服为 `https://play.d3carab1an.com`，测试服为 `https://test-play.d3carab1an.com`。两者暂时都为 DNS only，
由 Caddy 提供 HTTPS。它们分别连接 `127.0.0.1:3100`、`127.0.0.1:3101`，容器项目分别是
`stronghold-production`、`stronghold-staging`。容器仅运行一个 Node 进程，房间互不共享，资源目录只读。
正式服限 1 CPU / 1536 MB，测试服限 0.5 CPU / 1024 MB；共用宿主机不等于故障完全隔离。

通过 Tailscale 使用 `ssh my-lightsail` 管理。服务器 `/opt/stronghold/ops/` 保存部署工具，
`/opt/stronghold/env/` 保存当前和上一版的非敏感部署参数；`/srv/stronghold/assets/` 保存不可变资源包；
`/srv/stronghold/control/<environment>/maintenance` 是发布门禁文件。访问密码哈希在 Caddy 专用配置中，
不在仓库；本机的私人访问说明单独保存。测试服和正式服使用不同密码。

如果 Tailscale 策略修改后私有 SSH 被拒，使用 `ssh my-lightsail-public` 排查；它仍要求当前公网 IP 在
Lightsail 白名单内。只给 `tag:ci` 授权不会同时给个人电脑授权，维护 CI 策略时需保留管理员设备规则。
不要通过关闭认证或直接开放游戏容器端口来排查。

## 初次构建与候选发布

服务器开发 checkout 在 `/opt/stronghold/repository`。从已审核的提交构建（镜像不含游戏美术），
并将该提交的 `ops/` 安装到 `/opt/stronghold/ops/`：

```sh
cd /opt/stronghold/repository
sudo docker build -f ops/Dockerfile --build-arg REVISION="$(git rev-parse HEAD)" -t "stronghold:$(git rev-parse HEAD)" .
sudo python3 /opt/stronghold/ops/deploy.py staging stronghold:COMMIT_SHA /srv/stronghold/assets/BUNDLE_ID
```

工具先在仅本机的临时端口启动候选实例，验证健康和素材基线版本，然后创建维护文件拒绝新 WebSocket。
当前实例的 sockets、rooms、matches、humans 必须全部为 0，否则退出并恢复连接入口，不强制踢人。
确认空闲后启动新实例，验证成功才更新 `.env`，并保存 `.previous.env`。启动或验证失败自动恢复旧配置。
首次部署前必须先安装访问门禁，或者只验证本机端口；不得将未保护的游戏临时暴露到公网。

这是“空闲时拒绝忙碌发布”，不是完整的对局排空功能：后台保存中的单人对局也算忙碌。
提醒玩家退出游戏后再重试。维护文件允许已连接的人继续游戏；不会因重载 Caddy 而断开旧连接。
升级 Caddy 本身不使用该工具，需另选空闲时间。

## 晋级正式服

测试服完整游玩、资源和真机检查通过后，用同一个镜像和同一个资源包：

```sh
sudo python3 /opt/stronghold/ops/deploy.py production stronghold:COMMIT_SHA /srv/stronghold/assets/BUNDLE_ID
```

不要在服务器源码目录直接 `git pull` 后重启，也不要用 `latest` 自动替换正式服。
目前没有后台自动发布进程或定时更新；准备更新用 `python3 ops/prepare_update.py`，手动检查并提交。

## 回滚

读取 `/opt/stronghold/env/production.previous.env` 的 `GAME_IMAGE` 和 `ASSET_DIR`，把它们传给同一发布工具。
回滚也必须空闲。保留最近几个镜像和资源包，确认不再被任一环境引用前不要清理。
未来数据库迁移必须另有备份和兼容方案；此工具不能回滚未来的数据库。

## 排错

```sh
sudo docker compose -p stronghold-production --env-file /opt/stronghold/env/production.env -f /opt/stronghold/ops/compose.yml ps
sudo docker compose -p stronghold-production --env-file /opt/stronghold/env/production.env -f /opt/stronghold/ops/compose.yml logs --tail=100
curl -fsS http://127.0.0.1:3100/healthz
sudo journalctl -u caddy -n 50 --no-pager
```

断电或终止发布可能遗留 maintenance 文件。先核对运行版本、容器健康和 `.env`，确认无部署进程后删除该
环境的 maintenance 文件恢复新连接。不要随意删目录。镜像有自动重启策略；日志限制为 3 × 10 MB。

公网未登录的 `/`、`/ws`、`/healthz`、资源地址都应返回 401；正确凭据的 `/healthz` 应返回 200。
测试服密码不能用于正式服。浏览器 Basic Auth 是临时方案，不具备单用户撤销或邮箱验证能力。
完整外网验收命令：`node ops/smoke_live.mjs /path/to/private/access.json`；JSON 包含 production/staging 的
url、user、password，必须存放在 Git 之外。检查会创建并删除一个测试服双人大厅，不会启动正式服对局。
