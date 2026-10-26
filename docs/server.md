# 边注 Server

服务源码位于 [`server/`](../server/README.md)，前端和 API 在同一 Node 进程中运行，SQLite 保存账号、令牌与会话快照。它不随 DSH 插件 npm 包发布；部署方从本仓库单独构建。

- [部署、配置、数据卷、备份和回退](../server/docs/HOSTING.md)
- [资源优化与验证边界](../server/docs/RESOURCE-REVIEW.md)
- [快照 API](../server/docs/API.md)
- [认证、成员与令牌](../server/docs/AUTH.md)

仓库根目录启动：`docker compose -f compose.server.yml up -d --build`。默认绑定宿主机 `127.0.0.1:8787`；生产环境先按部署文档配置 `.env` 和 HTTPS 反向代理。
