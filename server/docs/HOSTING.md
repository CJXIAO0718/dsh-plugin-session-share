# 部署边注 Server

本仓库同时包含 DSH 分享插件（根目录 `lib/`）和独立托管应用（`server/`）。插件仍然零运行时依赖、支持 Node ≥ 20；托管应用使用 Node ≥ 24 和内置 `node:sqlite`。前端在构建阶段生成，运行时只有一个 Node 进程，提供网页、API 和 SQLite 存储，不需要 Vite、npm、独立数据库服务或前端服务常驻。

## Docker Compose

在仓库根目录执行：

```bash
cp server/.env.example .env
# 编辑 .env：设置自己的域名和管理员密码；本地 HTTP 测试将 SECURE_COOKIES 设为 0。
docker compose -f compose.server.yml build
docker compose -f compose.server.yml up -d
docker compose -f compose.server.yml logs --tail=50 margin
```

默认只映射 `127.0.0.1:8787`。反向代理将 HTTPS 流量转发到此端口，保留 `Host`，设置 `X-Forwarded-Proto` 和 `X-Forwarded-For`。如需从其他机器访问，请在部署环境中显式调整端口绑定并配置访问规则。

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 9m;
    proxy_read_timeout 35s;
}
```

这里的 9 MiB 对应默认 8 MiB 快照加上传封装余量；提高应用快照上限时同步调整代理限制。只信任受控代理设置的转发头，不要直接把应用端口暴露给不可信网络。

镜像分为构建和运行两层，运行层只复制后端源码和 `dist/`，不包含 `node_modules`、演示快照、测试、实际数据库或环境文件。容器使用非 root 用户、只读根文件系统、持久数据卷、健康检查和日志轮转；默认资源边界为 1 CPU / 512 MiB / 64 个进程或线程。该配置是单实例起点，需要根据实际快照大小和并发量观察调整。

`margin-data` 卷保存 `/app/data/margin.db` 及 WAL/SHM 文件。更新镜像不会重置账号或快照。**不要执行 `down -v`**，那会删除持久数据卷。

验证状态：Compose 配置解析、Node 生产构建、API 与资源/清理测试通过；使用预构建前端的独立 Node 24 运行镜像已验证启动、持久数据目录权限、HTTPS 合成发布链路和实际清理定时器。本文件的完整多阶段 Dockerfile 尚未逐层构建验证。结果及限制见 [RESOURCE-REVIEW.md](RESOURCE-REVIEW.md)。

## 直接运行 Node

```bash
cd server
npm ci
npm run build:deploy
# 设置 MARGIN_ADMIN_PASSWORD、MARGIN_BASE_URL 等环境变量后：
node server/main.mjs
```

构建需要前端依赖，运行时后端只用 Node 内置模块。进程管理器直接执行 `node server/main.mjs`，可以省去常驻的 npm 启动进程；不要在生产使用 `npm run dev` 或 `vite preview`。生产构建固定 remote 模式，移除 `dist/demo`，并预先生成 Brotli/gzip 文件，服务端不做逐请求压缩。

开发时 `npm run dev` 使用浏览器 mock；默认使用文件系统事件监听，只有网络盘等特殊环境需要 `MARGIN_DEV_POLLING=1` 开启轮询。

## 配置与首次使用

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MARGIN_PORT` | `8787` | 直接运行的监听端口；Compose 中用于宿主机端口映射 |
| `MARGIN_HOST` | `127.0.0.1` | 镜像内固定 `0.0.0.0`，宿主机仍只绑定回环地址 |
| `MARGIN_DB_PATH` | 应用目录 `data/margin.db` | Compose 中为 `/app/data/margin.db` |
| `MARGIN_DIST_DIR` | 应用目录 `dist/` | 构建产物目录 |
| `MARGIN_BASE_URL` | 请求 Host 推导 | 生产设为外部 HTTPS 基地址 |
| `MARGIN_ADMIN_USERNAME` | `admin` | 首位管理员用户名 |
| `MARGIN_ADMIN_PASSWORD` | 随机生成 | 仅建号时生效，重启或修改环境变量不会改已有密码 |
| `MARGIN_SECURE_COOKIES` | 按 BASE_URL 推导 | HTTPS 自动启用；HTTP 测试使用 `0` |
| `MARGIN_SEED_INVITE_MAX_USES` | `0`，关闭 | 直接运行时可创建首批邀请码；默认不会创建 |
| `MARGIN_SEED_DEMO` | 关闭 | 仅本地开发；生产镜像无演示数据 |
| `MARGIN_LOGIN_LOCKOUT_MS` | `30000` | 登录失败锁定时间 |

管理员登录 `/login`，在 `/admin/invites` 创建邀请码；成员注册后在 `/tokens` 生成个人令牌，再到 DSH 插件「连接设置」填写主机地址与令牌。发布时插件在本机整理、脱敏，再上传结构化快照。网页登录、阅读 `/s/:id`、管理页面和插件发布 API 都由同一服务提供。

默认策略：链接可访问 1 天，每人每分钟 8 次发布，每人 200 MiB，全站 5 GiB，单份快照最大 8 MiB。管理员可以在站点设置里调整。

## 资源边界与数据维护

- 个人列表只读取元数据；管理概览使用 SQL 汇总，最近记录限制 6 条。现有列表仍返回所有元数据，超大用户量时需要进一步加入分页。
- 快照保存紧凑 JSON，旧库无需转换；旧快照仍可读取和下载。既有快照不会自动重写。
- 同时最多读取 4 个请求体；密码计算最多并发 2 个，超限返回 `503` 和 `Retry-After`，不建立无限等待队列。密码 scrypt 参数和已有哈希格式保持一致。
- 登录和发布限流最多记录 10,000 个键，按过期时间惰性清理；满载时拒绝新键，不靠驱逐有效记录绕开限流。
- 最多 128 个连接，请求和空闲连接有超时；静态文件流在客户端断开时释放。静态资源支持 ETag/304、HEAD 和预压缩协商；API 保持 `no-store`。
- 启动时以及每分钟删除至多 1,000 条过期登录会话，同时清理到期满 7 天的快照。每轮最多 25 份、通常不超过 16 MiB；单份超过该大小时单独处理，避免永远无法清理。只选择元数据，不把正文加载进内存。
- 快照到期后立即不可读，再保留 7 天后永久删除并释放配额。未到期和没有到期时间的快照不参与清理。不会自动删除账号、邀请码或审计历史；清理批次会留下数量和字节数审计。

单实例 SQLite 模式不能让多个容器共同写同一个库，也不要把 SQLite 放在网络文件系统。删除快照后的空闲页会被 SQLite 后续写入复用，数据库文件可能不会立即缩小。

## 备份、更新与回退

运行中不要只复制主 `.db` 文件，WAL 可能仍有未合并写入。简单可审查的备份方式是停止该服务后，复制整个数据卷，再恢复启动；也可以另行使用 SQLite 在线备份工具。新版本启动时会清理已经到期满 7 天的记录，因此升级前先备份；已自动清理的内容无法通过延长保留期恢复。服务不会每轮执行 VACUUM，空闲页优先供后续写入复用。

更新前记录旧镜像标识并备份数据卷，构建新镜像后执行 `docker compose -f compose.server.yml up -d`。数据库变更只有 `CREATE INDEX IF NOT EXISTS`，没有表重建或内容重写。回退旧镜像时继续挂载原卷即可；不要把恢复旧备份与镜像回退混为一谈。

服务收到 SIGTERM/SIGINT 后停止接收新连接，最多等待 10 秒，再关闭剩余连接和数据库；Compose 提供 15 秒退出宽限期。

## 验证

```bash
cd server
npm run build:deploy
npm test
```

API 测试使用临时端口和临时库。资源测试覆盖限流内存边界、旧密码哈希兼容、异步密码计算、请求体并发和中断释放、静态压缩/304/HEAD、过期会话清理，以及真实插件发布处理函数 → HTTP 服务 → 公开读取/下载。另有 4 组快照清理测试覆盖 7 天边界、永久记录保护、行数与字节限制、失败回滚、配额与审计、启动集成。DSH 运行环境由测试桩提供，未宣称真实桌面端联调完成。
