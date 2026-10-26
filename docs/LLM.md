# LLM.md — AI 代理可执行的部署指引

本文档供 AI Agent / LLM 按顺序执行部署任务。所有步骤顺序固定，每个阶段设明确的成功检查点，失败时直接在该点停止并返回可读原因。

**目标产物**：
- DSH 插件成功挂载，会话头部出现「分享为 HTML」；
- 边注 Server 健康运行，插件与 Server 联调通过，发布快照成功；
- 交付报告里记录每一步的实际输出。

**禁止行为：**
- 不要自行跳过阶段；
- 不要修改 `window.__ModuleLoader__.load({ id })` 或 `ctx.slots.register({ id })`；
- 不要手动直接写 `cordis.patch.yml` 裸行；
- 不要执行 `docker compose down -v`；
- 不要把 `.env`、管理员密码、完整令牌写进 git。

---

## 阶段 0：环境预检查

**闸门 0·1** — 确认工作目录

```powershell
# PowerShell 7+
Get-Location
Test-Path "lib/index.js"
Test-Path "lib/client.js"
Test-Path "install.ps1"
Test-Path "restore-if-broken.ps1"
Test-Path "如果DSH起不来-双击我.cmd"
Test-Path "compose.server.yml"
Test-Path "server/package.json"
Test-Path "server/server/main.mjs"
```

所有文件必须存在，不存在则停止，返回「仓库结构不完整」。

**闸门 0·2** — 确认 Node 版本

```bash
node -v
```

- 插件侧要求 ≥ 20；
- Server 侧要求 ≥ 24；
- 两者不满足任意一个，停止，返回 `node -v` 的实际输出。

**闸门 0·3** — 可选：确认 Docker 状态

```powershell
docker version --format '{{.Server.Version}}'
docker compose version
```

走 Docker 部署 Server 时必须通过；走 Node 直接运行时可跳。

---

## 阶段 1：部署插件（通过方式 C · 本地挂载）

目标：把插件条目正确写入 profile 的 `cordis.patch.yml`，备份自动生成，插件页面 phase 显示 active。

### 1.1 先做 WhatIf 预览

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WhatIf
```

输出必须看到：
- PluginDir 是当前仓库路径下含 `lib/index.js` 的绝对路径；
- ProfileDir 是 `$env:USERPROFILE\.dsh\profiles\desktop`（或显式传入的自定义路径）；
- 要写入的 patch 条目 id 为 `session-share-html`，name 字段是合法 `file:///` URL；
- 无报错、无红色异常文本。

**如果 WhatIf 不通过：**
- 不要继续执行正式安装，停在这一步，打印输出内容。

### 1.2 正式安装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

预期输出末尾出现：

```text
完成：插件已写入 profile 配置。
回滚：Copy-Item -LiteralPath "<...>.bak-<时间戳>" -Destination "<...>\cordis.patch.yml" -Force
```

检查 profile 目录，新生成的 `.bak-*` 文件至少 1 份。

> 脚本还会打印「桌面端 HMR 会自动重载，不需要重启」——那句话只覆盖配置层；**首次挂载新客户端插件仍然必须重启 DSH**，不要据此跳过下一步。

### 1.3 写入的条目长什么样（确认）

读 `<ProfileDir>\cordis.patch.yml`，它必须包含：

```yaml
- insert:
    - id: session-share-html
      name: 'file:///C:/.../dsh-plugin-session-share/lib/index.js'
      config: {}
```

- id 必须精确等于 `session-share-html`；
- 条目整体必须在顶层数组里，不能是裸行（裸行会被 DSH 丢弃）；
- name 必须是以 `file:///` 开头的合法 URL，路径部分绝对化、正斜杠、非 ASCII 已百分号编码。

**闸门 1·插件安装成功**

你现在可以告诉人类用户：「**完全关闭 DSH（含托盘图标，确认进程退出），然后重新启动 DSH**」。

> 插件首次挂载必须重启进程，热更新覆盖不到 `file://` 挂载的 client bundle。这里无法用脚本代替用户执行桌面端重启，必须由人做完后回来继续执行后面的步骤。

### 1.4 人类重启 DSH 后，验证插件状态

人类确认 DSH 已启动后，你检查下列项：

1. 打开 DSH 桌面端设置 → 插件页面，找 id = `session-share-html`；
2. 确认 phase 是 `active`，不是 `error` / `loading` / `disabled`；
3. 打开任意已有会话，对话头部出现文字「**分享为 HTML**」；
4. 点分享按钮 →「预览」能正常渲染出页面；
5. 点「下载」保存 `.html` 文件，断网后双击打开，内容与预览一致，页面里没有外链 JS/CSS/字体引用。

闸门 1 全部通过 → 阶段 1 结束。

---

## 阶段 2：部署边注 Server（Docker Compose）

目标：容器健康，日志不含 Error，管理员首次建号成功，首页可正常打开。

### 2.1 复制环境变量文件

```powershell
if (!(Test-Path -LiteralPath ".env")) {
    Copy-Item -LiteralPath "server\.env.example" -Destination ".env"
}
Test-Path -LiteralPath ".env"
```

已有 `.env` 时保留配置，不直接覆盖；不要把真实环境文件内容打印或附入报告。

### 2.2 修改环境变量（示例：本地 HTTP 测试）

编辑根目录 `.env` 文件，至少设：

```dotenv
MARGIN_PORT=8787
MARGIN_BASE_URL=http://127.0.0.1:8787
MARGIN_ADMIN_USERNAME=admin
MARGIN_ADMIN_PASSWORD=margin-admin-pass-2026
MARGIN_SECURE_COOKIES=0
```

> 生产环境请替换真实域名和管理员强密码，并把 `MARGIN_SECURE_COOKIES` 改回 `1`。当前步骤先本地 HTTP 验证，方便联调。

**闸门 2·env 存在**：`Test-Path .env` 返回 `true`。

### 2.3 构建并启动容器

```bash
docker compose -f compose.server.yml build
docker compose -f compose.server.yml up -d
docker compose -f compose.server.yml logs --tail=80 margin
```

- `docker compose ps` 中 STATUS 列在启动约 40 秒后（`start-period` 10s + 首次 `interval` 30s）应显示 `healthy`；
- 启动日志里应出现 `[margin] 首位管理员已创建: admin / <password>`（首次建号时打印；之后重复启动不再打印）；
- 日志不出现 `error` / `fatal` / `panic` 关键词（大小写不敏感）。

### 2.4 第一次手动 API 探测

```powershell
curl.exe -s -o - -w "`nHTTP %{http_code}`n" http://127.0.0.1:8787/api/v1/auth/me
```

预期 `HTTP 401`，响应体是 `{"error":{"code":"unauthorized",...}}`（未登录，这是预期行为，不是故障）；如果连接被拒或返回 404，说明服务没完全拉起。

**重试策略**：每 3 秒探测一次，最多 5 次；5 次都失败，读取 `docker compose logs --tail=200 margin`，先移除初始管理员密码、完整令牌等凭据，再报告相关错误并停止部署。

闸门 2 通过 → 阶段 2 结束。

---

## 阶段 3：API 功能测试（自动化路径，无需浏览器人工点）

用 6 个步骤测全链路：

### 3.1 管理员登录

```javascript
// 用 Node 内置 fetch
// POST /api/v1/auth/login
const res = await fetch("http://127.0.0.1:8787/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: "admin",
    password: "margin-admin-pass-2026",
    remember: true
  })
});
const data = await res.json();
const adminCookie = res.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
// 200 OK；响应体形如 { user: { id, username, role }, expiresAt, persistent }
// 且响应头带 Set-Cookie: margin_session=…（HttpOnly; SameSite=Lax）
```

拿到有效 Cookie 后继续（后续请求带上同一 Cookie）。

### 3.2 管理员生成邀请码

```javascript
// POST /api/v1/admin/invites
// body: { note: "测试批次", maxUses: 5 }
const resInvite = await fetch("http://127.0.0.1:8787/api/v1/admin/invites", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: adminCookie },
  body: JSON.stringify({ note: "LLM 自动测试批次", maxUses: 5 })
});
const invite = (await resInvite.json()).invite;
const inviteCode = invite.code;
// 200 OK；invite.code 形如 MGN-XXXX-XXXX
```

拿到有效邀请码字符串，记为 `inviteCode`。

### 3.3 普通成员用邀请码注册

```javascript
// POST /api/v1/auth/register
const res2 = await fetch("http://127.0.0.1:8787/api/v1/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inviteCode: inviteCode,
    username: "tester",
    password: "tester-strong-2026",
    remember: true
  })
});
// 200 OK；响应体 { user, expiresAt, persistent }，并带成员自己的 Set-Cookie
const memberCookie = res2.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
```

成员用户名需满足 3–24 位小写字母、数字、下划线或短横线。

### 3.4 成员生成个人令牌

```javascript
// POST /api/v1/tokens（带成员 Cookie）
// body: { name: "LLM 自动测试令牌", scopes: ["publish", "manage"] }
const resTok = await fetch("http://127.0.0.1:8787/api/v1/tokens", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: memberCookie },
  body: JSON.stringify({ name: "LLM 自动测试令牌", scopes: ["publish", "manage"] })
});
const { token, secret } = await resTok.json();
// 200 OK；secret 就是完整令牌，只在这个响应里出现一次，形如 mgn_tk_…
const personalToken = secret;
```

- `scopes` 至少一项，可选 `publish` / `manage`；
- `secret` 非空、前缀必须是 `mgn_tk_`；
- 服务端只存哈希，后续接口查不到明文；**不要把 `secret` 写进任何文件或报告**。

### 3.5 成员用令牌发布最小快照

```javascript
// POST /api/v1/shares
// Authorization: Bearer <personalToken>
const minimalSnapshot = {
  schema: "dsh.session-share/v1",
  document: {
    schemaVersion: 1,
    title: "LLM 自动测试最小快照",
    source: {
      generator: "DSH session share",
      pluginVersion: "0.1.0",
      sessionId: "session-auto-test-001",
      generatedAt: "2026-10-26T00:00:00.000Z",
      generatedAtIso: "2026-10-26T00:00:00.000Z",
      cwd: "/tmp/work",
      reasoning: "count",
      redacted: true
    },
    counts: {
      turns: 1,
      userMessages: 1,
      contextMessages: 0,
      assistantMessages: 1,
      toolCalls: 0,
      collapsedBlocks: 0,
      redactions: 0,
      badLines: 0,
      events: 2,
      picked: 2,
      totalEntries: 2
    },
    turns: [
      {
        id: "turn-1",
        number: 1,
        label: "第 01 轮",
        messages: [
          { id: "m1", role: "user", markdown: "这是一条自动测试的用户消息。" },
          { id: "m2", role: "assistant", markdown: "这是自动测试的助手回复。" }
        ],
        apparatus: [],
        reasoningOmitted: null
      }
    ],
    internal: null,
    emptySelection: false,
    warnings: []
  }
};
const res4 = await fetch("http://127.0.0.1:8787/api/v1/shares", {
  method: "POST",
  headers: {
    "content-type": "application/vnd.dsh.session-share+json",
    authorization: `Bearer ${personalToken}`
  },
  body: JSON.stringify(minimalSnapshot)
});
const published = await res4.json();
// 201 Created；published.share.id 与 published.share.url（指向 /s/:id）
const shareId = published.share.id;
```

### 3.6 匿名读取公开快照

```javascript
// GET /api/v1/shares/:shareId，不带 Authorization
// 必须 200 OK；share.title 等于「LLM 自动测试最小快照」
```

**闸门 3·全链路 API 通**：3.1~3.6 全部 2xx，没有 4xx/5xx。

---

## 阶段 4：插件本地 CLI 自检

目标：确认离线 CLI 零依赖、能正常读取夹具并产出可打开的 HTML。

```bash
node tools/render-session.mjs \
  --log test/fixtures/session-sample.events.jsonl \
  --out test/out-auto-check.html
```

预期输出一行 JSON 到 stdout（仓库夹具实测，数值随夹具版本可能小幅变化）：

```json
{"out":"...","bytes":31022,"stats":{"events":96,"redact":true,"reasoning":"omit","userMessages":9,"contextMessages":5,"assistantMessages":9,"toolCalls":6,"turns":4,"picked":12,"totalEntries":12,"redacted":60,"badLines":0}}
```

- `stats.redacted` > 0（夹具约 60，脱敏生效）；
- `bytes` > 10000（夹具约 31 KB，不是空文件）；
- 打开生成的 HTML，能看到 4 个轮次、消息正文与折叠的上下文灰卡。

---

## 阶段 5：交付报告模板

部署全部通过后，输出如下结构化报告：

```markdown
## 部署交付报告

### 时间戳
YYYY-MM-DD HH:MM UTC+8

### 环境快照
- Node 版本: `node -v`
- Docker 版本: xxx
- 仓库根目录路径: xxx
- DSH profile 目录: xxx

### 阶段 1 插件
- install.ps1 WhatIf: 通过 / 失败
- 正式安装: 通过 / 失败
- 备份文件列表: xxx
- 插件页面 phase: `active` / 其它
- 头部「分享为 HTML」按钮: 可见 / 未出现
- 预览/下载 HTML: 正常 / 异常

### 阶段 2 Server
- .env 配置: 已写入
- compose build: 通过
- compose up -d: 通过
- containers healthy: 是 / 否
- 启动日志管理员初始化: 成功 / 失败

### 阶段 3 API 全链路
- 管理员登录: 200 / 其它
- 生成邀请码: 200 / 其它，code = MGN-…
- 成员注册: 200 / 其它
- 生成令牌: 200 / 其它，token 前缀 mgn_tk_…
- 发布最小快照: 201 / 其它，share.id = xxx
- 匿名公开读取快照: 200 / 其它，标题核对通过

### 阶段 4 CLI 自检
-  stdout JSON: 正常输出
-  `stats.redacted`: N 次 > 0
-  生成文件字节数: xxx KB

### 最终状态
✅ 部署全部通过，可继续后面的联调。

> 请勿在交付报告里贴完整管理员密码或完整令牌。
```

---

## 快速参考路由表

| 方法 | 路径 | 说明 | 是否需要 Bearer |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | 管理员 / 成员登录 | 否 |
| POST | `/api/v1/auth/register` | 邀请码注册 | 否 |
| GET | `/api/v1/auth/me` | 当前会话状态 | 否（Cookie） |
| POST | `/api/v1/auth/logout` | 登出 | 否（Cookie） |
| GET | `/api/v1/tokens` | 我的令牌列表 | 是（Cookie） |
| POST | `/api/v1/tokens` | 生成令牌 | 是（Cookie） |
| DELETE | `/api/v1/tokens/:id` | 停用令牌 | 是（Cookie） |
| POST | `/api/v1/shares` | 发布快照 | **是（Bearer）** |
| GET | `/api/v1/shares/:id` | 读取快照元信息 + 文档 | 否 |
| GET | `/api/v1/shares/:id/snapshot` | 下载原始 snapshot JSON | 否 |
| DELETE | `/api/v1/shares/:id` | 删除自己的快照 | Bearer 或发布者 Cookie |
| GET | `/api/v1/me/shares` | 我的分享列表 | 是（Cookie） |
| PATCH | `/api/v1/me/shares/:id` | 撤回/恢复 | 是（Cookie） |
| GET | `/api/v1/me/policy` | 当前站点策略 | 是（Cookie） |
| GET | `/api/v1/admin/overview` | 管理员概览 | 是（Cookie + admin 角色） |
| GET | `/api/v1/admin/invites` | 邀请码列表 | 是（Cookie + admin 角色） |
| POST | `/api/v1/admin/invites` | 生成邀请码 | 是（Cookie + admin 角色） |
| PATCH | `/api/v1/admin/invites/:code` | 停用邀请码 | 是（Cookie + admin 角色） |
| GET | `/api/v1/admin/users` | 成员列表 | 是（Cookie + admin 角色） |
| PATCH | `/api/v1/admin/users/:id` | 暂停/恢复成员 | 是（Cookie + admin 角色） |
| GET | `/api/v1/admin/settings` | 读取站点策略 | 是（Cookie + admin 角色） |
| PUT | `/api/v1/admin/settings` | 写入站点策略 | 是（Cookie + admin 角色） |
