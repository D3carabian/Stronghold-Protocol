# 邮箱验证码与邀请准入

本 fork 可用 `AUTH_ENABLED=1` 开启邮箱登录；未开启时保留上游本机运行方式。上线状态以 [STATUS.md](STATUS.md)
为准。邮件供应商为 Resend，发信地址使用已验证的专用子域名。邀请码决定首次加入资格，验证码证明邮箱控制权。
已有玩家以后登录不需要再次消耗邀请。管理员也必须验证邮箱，没有浏览器管理员密码或隐藏绕过入口。

## 玩家体验

访问 `/` 自动进入 `/auth/login`。首次填写邮箱、邀请码，随后输入邮件中的六位验证码。
验证码 10 分钟有效，最多猜测 5 次，只能使用一次；重新发信使旧验证码失效。邀请在成功验证时才被消耗。
邮箱登录记住 14 天，Cookie 仅限当前主机、HttpOnly、Secure、SameSite=Lax。正式和测试环境不共享身份或登录。
测试服只接受 tester/admin 角色，邀请命令在测试服默认创建 tester。被禁用的用户无法重新登录。
账户入口在标题页和设置中；退出登录撤销当前会话，并断开该会话打开的游戏连接。

HTTP 资源与 `/ws` 都要求登录。浏览器 WebSocket 和所有认证 POST 检查精确 Origin；游戏重连令牌绑定内部
账号，不能拿另一个账号的令牌接管其玩家。已有连接每次消息和最长 15 秒定时检查账号/会话是否仍有效。
服务器独立健康令牌用于部署；不能通过伪造转发 IP 绕过鉴权。身份认证不改动玩法、种子或战斗模拟。

## 配置

Node.js 至少 22.13（内置 SQLite）；部署使用 Dockerfile 固定的 Node 22 镜像。
真实值只保存到主机 root 所有、权限 600 的文件，如 `/etc/stronghold/staging.auth.env`。
文件是原始 `NAME=value`，不加 shell 引号，不包含多行值。禁止提交 Git、放入镜像、粘贴到聊天或前端。

```dotenv
AUTH_ENABLED=1
AUTH_ENVIRONMENT=staging
AUTH_PUBLIC_URL=https://test-play.example.com
AUTH_DATABASE_PATH=/var/lib/stronghold-auth/auth.db
AUTH_SECRET=REPLACE_WITH_32_RANDOM_BYTES_BASE64URL
AUTH_HEALTH_TOKEN=REPLACE_WITH_DIFFERENT_32_RANDOM_BYTES_BASE64URL
RESEND_API_KEY=REPLACE_WITH_SENDING_ONLY_KEY
AUTH_MAIL_FROM=Stronghold Protocol <login@mail.example.com>
```

`AUTH_SECRET` 与 `AUTH_HEALTH_TOKEN` 每个环境各自生成并长期保存。前者用于 HMAC；贸然更换会使邀请码、验证码
和登录全部失效。发信密钥用 Resend 的 Sending access，并限制发件域名。DNS 的 DKIM 公钥不是 API key。
没有邮件服务时请求失败关闭；不会将验证码打印到日志或允许跳过邮箱验证。

限流持久保存在数据库：同邮箱 60 秒一次、每小时 5 次；同 IP 发信请求每小时 12 次、验证每 10 分钟 40 次。
正式服每天最多 75 封、测试服 15 封，UTC 零点更新；失败投递也消耗预算，给供应商免费额度保留余量。
未知/无资格邮箱获得与有效请求相同形状的回复，不发送邮件；响应耗时仍可能不同，不声称抵抗所有时序枚举。

## 部署和管理

首次部署传入私有配置；后续同一环境部署自动保留认证配置及状态目录，不允许用旧镜像静默关闭认证。

```sh
sudo python3 /opt/stronghold/ops/deploy.py staging IMAGE ASSET_DIR --auth-config /etc/stronghold/staging.auth.env
```

部署工具先把线上数据库一致性备份到候选独立目录；候选绝不直接打开线上数据库。发布时开启维护门禁，
检查游戏和进行中的邮件请求均为空闲，再备份数据库并更新服务。失败时停止新进程、恢复数据库，再恢复旧镜像。
认证 POST 和新 WebSocket 在维护期间返回 503；玩家稍后重试。首次真实邮件和浏览器验收通过前保留原门禁。
启用邮箱认证的环境必须同时使用 `compose.yml` 和 `compose.auth.yml`。下面使用的容器名由环境确定：

```sh
# 仅通过已有 SSH 运维通道执行；输出只给管理员，邀请码只显示一次。
sudo docker exec stronghold-staging-game-1 node tools/auth-admin.mjs grant-admin --email OWNER_EMAIL
sudo docker exec stronghold-staging-game-1 node tools/auth-admin.mjs invite --email FRIEND_EMAIL --days 7
sudo docker exec stronghold-staging-game-1 node tools/auth-admin.mjs invites
sudo docker exec stronghold-staging-game-1 node tools/auth-admin.mjs revoke-invite INVITE_ID
sudo docker exec stronghold-staging-game-1 node tools/auth-admin.mjs users
sudo docker exec stronghold-staging-game-1 node tools/auth-admin.mjs disable-user --email FRIEND_EMAIL
```

`invite` 默认单次、7 天；可设置 `--uses 1..100`、`--days 1..90`，不填邮箱则允许持码者加入。
正式服将容器名换为 `stronghold-production-game-1`，默认 player。`grant-admin` 仅用于所有者/明确授权管理员，
不是普通用户解禁命令。当前管理通过 SSH 命令进行；图形后台、房间观战和历史战绩仍未实现。

## 备份与恢复

身份数据目录 `/srv/stronghold/auth/ENV`，容器 uid 1000 可写，目录 700、数据库 600。
库只存邀请码/验证码/会话的 HMAC 摘要，不存其明文；邮箱属于私人数据。过期登录清除，挑战保留最多约一天，
审计保留 90 天。需要一并备份私有环境文件，否则数据库中的 HMAC 无法继续使用。

```sh
sudo python3 /opt/stronghold/ops/auth_backup.py /srv/stronghold/auth/staging/auth.db /opt/stronghold/backups/staging-MANUAL.db
```

该命令使用 SQLite 在线备份，覆盖 WAL 内的已提交事务并校验完整性；不会覆盖已有备份。
每次部署前自动备份是本机恢复点，不等于异地备份；当前没有定时异地数据库备份。
手工恢复必须先确认没有游戏，开启维护门禁，停止对应容器，再恢复匹配版本的数据库和环境配置。
停止所有写入者后清理旧 `auth.db-wal`、`auth.db-shm`，恢复 `auth.db` 权限 600、所有者 1000:1000；
启动匹配镜像、检查带健康令牌的状态，成功后移除门禁。不要把正式服数据库复制到公网测试服。
若要退回不支持认证的旧镜像，必须先恢复该域名原来的 Basic Auth，再恢复先前 Compose 配置；不能裸露游戏。

## 验证

定向检查 `node --test test/auth.test.js test/auth-http.test.js test/http-maintenance.test.js`；
`python3 -m unittest discover -s ops -p 'test_*.py'` 验证运维工具；i18n 检查包含独立登录页。
完整检查仍为 `npm run ci` 和 `npm run golden`。真实邮件只向所有者授权的地址发送。
浏览器验收应覆盖首次邀请、回访登录、登出、移动窄屏、跨环境隔离；真实 iPhone/iPad Safari 仍需设备验收。
