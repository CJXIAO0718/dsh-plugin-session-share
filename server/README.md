# 边注 · MARGIN

把一段 DSH 会话发布成可读、可核查、可引用的原生快照。第二阶段：**前端 + 无依赖 Node 托管服务**（`server/`），认证、邀请码、令牌、快照存储与管理端均已接真实服务端。

和"把导出的 HTML 传到托管站"不同，托管接口接收的是插件在 DSH 本地生成的 `SnapshotDocument`。解析、脱敏、条目选择与推理模式都在离开 DSH 之前完成；托管端只校验、存储和分发 JSON。

前端支持两种运行模式，由构建期变量 `VITE_AUTH_MODE` 决定：

- **remote（部署构建，默认生产模式）**：登录、注册、邀请码、令牌、我的分享、管理端全部走 `server/` 的真实 API；演示账号、演示邀请码、一键填入与示例数据不会进入产物。
- **mock（开发模式，`npm run dev`）**：本地浏览器 localStorage 模拟，用于界面验收，与线上行为隔离。

管理员不管理单条记录的撤回，只设定整体策略：站点容量、每人配额、链接保留期、每人每分钟可发布的次数，以及邀请码与准入。记录由发布者自己撤回或恢复。

本应用位于插件仓库的 `server/`，以下 npm 命令均从本目录执行。生产部署与资源边界见 [部署文档](docs/HOSTING.md)，优化数据见 [资源评审](docs/RESOURCE-REVIEW.md)。要求 Node ≥ 24。

## 运行

```bash
npm install
npm run dev           # mock 模式开发服务器 http://127.0.0.1:4173
npm run build:deploy  # 生产构建（remote 模式）并移除演示数据 → dist/
npm start             # 启动托管服务（默认 127.0.0.1:8787，直出 dist/ + API）
npm test             # 61 项 API + 9 组资源/整合/自动清理测试（临时库、临时端口）
```

`npm start` 首次启动会创建管理员：用户名默认 `admin`，密码取 `MARGIN_ADMIN_PASSWORD`，缺省时自动生成并只在启动日志出现一次。常用环境变量见 [docs/HOSTING.md](docs/HOSTING.md)。

演示快照由插件生成：

```bash
npm run demo:build
```

它会调用同级的 `../lib/snapshot.js`，输出 `public/demo/spectral.json`。应用运行时不依赖插件；部署构建不会携带该文件（本地联调需要时用 `MARGIN_SEED_DEMO=1` 让服务端把它种入数据库）。

## 页面

| 路径 | 访问 | 内容 |
| --- | --- | --- |
| `/` | 公开 | 线上主页：产品介绍、GSAP 场景演示、示例记录、准入 |
| `/register` | 仅未登录 | 邀请码注册；用户名即显示名 |
| `/login` | 仅未登录 | 登录；mock 模式可一键填入演示账号 |
| `/s/demo-spectral` | 公开 | 阅读器：正文、旁注抽屉、轮次导航、快照下载 |
| `/archive` | 登录后 | 我的分享：发布列表、撤回/恢复、配额与策略 |
| `/tokens` | 登录后 | 连接与令牌：生成/停用个人令牌、连接 DSH 的教程 |
| `/connect` | 公开 | 插件接入教程：主机地址、令牌与发布步骤 |
| `/admin` | 管理员 | 概览：发布节奏、最近记录、策略与容量 |
| `/admin/invites` | 管理员 | 邀请码：生成、复制、停用 |
| `/admin/people` | 管理员 | 成员管理：搜索、暂停、恢复 |
| `/admin/settings` | 管理员 | 系统设置：容量、保留期、上传节奏、准入 |
| `/api` | 公开 | 托管 API 约定（技术参考，不进入首页导航） |

## 演示账号与邀请码（仅 mock 开发模式）

`npm run dev` 的登录页有"本地预览模式"：

- 管理员：`admin` / `margin-admin`
- 成员：`reader` / `reader-demo`

注册页可使用演示邀请码 `MARGIN-DEMO-2026`（可重复使用）。这些凭据只存在于浏览器 mock 中；部署构建（`VITE_AUTH_MODE=remote`）不携带它们，服务端也没有这些账号——已用测试验证（`margin-admin` 登录 401、`MARGIN-DEMO-2026` 注册 404）。失败 5 次会锁定 30 秒（mock 与服务端行为一致）。

## 契约与文档

- [docs/API.md](docs/API.md)：快照端点、错误码、`SnapshotDocument` 字段、版本兼容
- [docs/AUTH.md](docs/AUTH.md)：登录、角色、路由守卫、mock 行为、服务端认证契约与安全清单
- [docs/HOSTING.md](docs/HOSTING.md)：构建、静态部署、SPA 回退、服务端拓扑、上线检查
- [public/api/openapi.yaml](public/api/openapi.yaml)：OpenAPI 3.1 定义

快照端点：

```text
POST   /api/v1/shares
GET    /api/v1/shares/{id}
GET    /api/v1/shares/{id}/snapshot
DELETE /api/v1/shares/{id}
```

发布与删除都用个人访问令牌（`Authorization: Bearer mgn_tk_…`）；令牌由账号在「连接与令牌」里生成，可单独停用。快照不可变，不提供更新接口。

## 目录

```text
src/
  config.ts       构建期模式（mock | remote）与 API 基址
  api/            分享/管理适配器（localClient / remoteShareClient / mockAdminClient / remoteAdminClient）
  auth/           认证适配器（mockAuth / remoteAuth）、邀请码与守卫
  account/        个人分享与令牌（两种模式共用接口）
  admin/          管理端数据、站点策略与类型
  components/     顶栏、账户标签、邀请码/令牌生成器、接入教程、mock 演示面板等
  composables/    主题、toast
  markdown/       Markdown + KaTeX + 代码高亮
  parser/         原生快照解析与类型
  styles/         设计令牌与页面样式
  views/          Home / Login / Register / Archive / Tokens / Reader / Connect / Admin / API
server/
  main.mjs        入口：路由分发、CSRF、静态托管、SPA 回退、首启引导
  lib/            db(SQLite) / security(scrypt、限流) / validate(快照校验) / settings / http / static
  routes/         auth / tokens / shares / me(我的分享与策略) / admin
  test/api-test.mjs  全量 API 集成测试
docs/
  API.md
  AUTH.md
  HOSTING.md
public/
  api/openapi.yaml
  demo/spectral.json   （不进入部署产物）
scripts/
  demo-events.mjs
  build-demo.mjs
  build-deploy.mjs
```

## 设计取向

主页用产品场景而不是接口说明：右侧用 GSAP 演示对话、旁注、脱敏到地址的形成过程，读者可以逐步查看或重放。阅读器不是聊天记录皮肤：正文与旁注分层，轮次、上下文、推理和工具证据都能回到同一份快照。个人页把分享与令牌分开；管理员界面沿用“登记处”的档案语言，但只处理邀请、成员与整体策略。支持明暗主题、移动端重排、KaTeX、GFM 表格和代码高亮；动效遵守 `prefers-reduced-motion`。

## 当前边界

- 部署构建已接真实服务端：登录/注册/邀请码/成员/令牌/站点策略/快照存储与撤回都由 `server/`（SQLite）落盘；管理员凭据由部署方通过环境变量设定。
- `npm run dev` 仍是浏览器 mock，用于界面验收；两种模式由 `VITE_AUTH_MODE` 切换，互不共享数据。
- 发布链路已按契约打通：DSH 插件 → `POST /api/v1/shares`（Bearer 个人令牌）→ 公开只读 `/s/:id`；尚未在真实 DSH 运行时做端到端联调（接口契约与插件实现一致，已用同形请求验证）。
- 服务端为单进程无依赖实现（`node:sqlite`）；多实例横向扩容、异地备份、邮件通知不在当前范围。

原始插件：[CJXIAO0718/dsh-plugin-session-share](https://github.com/CJXIAO0718/dsh-plugin-session-share)
