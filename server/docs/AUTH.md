# 登录与权限

这份文档说明登录、会话和管理员权限的行为，以及服务端实现的要点。

> **服务端已实现**（`server/routes/auth.mjs` 等）：下文”建议的服务端契约”就是当前 `server/` 的实际行为，由 `npm run test:api` 全量覆盖。开发模式（`npm run dev`）仍是浏览器 mock，仅用于界面验收。

## 角色与准入

边注采用邀请制，不开放匿名注册。

| 角色 | 可以做什么 | 不可做什么 |
| --- | --- | --- |
| `member` | 用邀请码注册、登录、生成/停用个人令牌、发布自己的记录、撤回或恢复自己的记录 | 进入 `/admin`、生成邀请码、查看成员列表、暂停他人、设定站点策略 |
| `admin` | 成员的全部权限；概览、生成/停用邀请码、暂停/恢复成员、设定容量与保留期等整体策略 | 逐条撤回或恢复他人的记录；读取被发布者刻意排除的原文；绕过快照内已完成的脱敏 |

公开只读地址 `/s/:id` 不需要登录；它只能读到已经发布、未撤回且未过保留期的快照，且无法通过它进入管理区。

管理员不介入单条记录的分发决策。记录的撤回与恢复归发布者本人；管理员只处理准入（邀请码与成员状态）和整体边界（容量、保留期、上传节奏）。

## 邀请码与首位管理员

边注采用邀请制，但账号由本人创建：管理员生成邀请码，用户打开 `/register?invite=…`，设置用户名与密码即可。**用户名就是显示名**，不再单独收集显示名。

服务端首次启动（数据库无用户）时创建管理员：用户名 `MARGIN_ADMIN_USERNAME`（默认 `admin`），密码取 `MARGIN_ADMIN_PASSWORD`；缺省时自动生成并只在启动日志出现一次。邀请码形态 `MGN-XXXX-XXXX`，名额与有效期由管理员在 `/admin/invites` 决定。

mock 开发模式另有两个一键填入账号（`admin`/`margin-admin`、`reader`/`reader-demo`）与可重复使用的演示邀请码 `MARGIN-DEMO-2026`；它们只存在于浏览器，部署构建不携带，服务端也没有这些账号。

## 当前行为（两种模式）

开发模式（mock，`npm run dev`）：

- **会话时长**：不勾选”保持登录”为 12 小时，勾选后为 7 天；会话写在浏览器 storage。
- **账号持久化**：通过邀请码注册的账号会写入本机 `margin-mock-accounts`，管理员成员页能看到。
- **失败锁定**：同一浏览器同一用户名连续失败 5 次锁定 30 秒。
- **本地数据**：令牌、记录、策略都只在本机 localStorage / IndexedDB。

部署模式（remote，`server/`）：

- **会话**：`HttpOnly; SameSite=Lax` Cookie（https 环境自动加 `Secure`），服务端 SQLite 存储会话；时长同样是 12 小时 / 7 天。
- **密码**：scrypt（N=16384, r=8, p=1）加盐哈希，常数时间比对；不存在的用户名也走一次完整比对，避免响应时间枚举。
- **失败锁定**：按 用户名+IP 连续失败 5 次锁定 30 秒（`MARGIN_LOGIN_LOCKOUT_MS` 可调），带 `Retry-After`，文案与前端倒计时一致。
- **注册**：邀请码核验（active / 未过期 / 未停用 / 名额未满）与消耗在同一事务内完成；拒绝重复用户名。
- **暂停即时生效**：暂停成员会删除其全部会话，下一次请求即 401。
- **CSRF**：带 Origin/Referer 的写请求必须同源；令牌（Bearer）请求不受影响。
- **审计**：登录失败、注册、邀请码生成/停用、成员暂停/恢复、令牌生成/停用、记录发布/撤回/恢复/删除、策略修改均写入 `audit` 表；日志不含密码与完整令牌。
- **个人令牌**：服务端只存 SHA-256 哈希；完整值只在创建响应里出现一次；`publish` 允许发布，`manage` 允许删除自己的记录；令牌不能登录网页。
- **路由守卫**：`/archive`、`/tokens`、`/admin*` 需要登录；`/admin*` 还要求 `role === 'admin'`；服务端对每个管理接口独立校验角色。

## 前端接口

认证适配器在 `src/auth/types.ts`：

```ts
interface AuthClient {
  readonly mode: 'mock' | 'remote'
  login(input: { username: string; password: string; remember: boolean }): Promise<AuthSession>
  register(input: {
    inviteCode: string
    username: string
    password: string
    remember: boolean
  }): Promise<AuthSession>
  me(): Promise<AuthSession | null>
  logout(): Promise<void>
}
```

`src/auth/useAuth.ts` 只依赖这个接口。接服务端时替换 `authClient` 的实现即可，路由守卫、登录页和管理页不需要改。

## 建议的服务端契约

下面是接真实服务端时的最小契约，字段与前端类型保持一致。所有响应使用 `application/json`，错误统一为 `{ error: { code, message, details? } }`。

### `POST /api/v1/auth/login`

请求：

```json
{ "username": "reader", "password": "…", "remember": true }
```

成功 `200`：

```json
{
  "user": {
    "id": "usr_…",
    "username": "reader",
    "name": "周迟",
    "role": "member",
    "status": "active",
    "createdAt": "2026-09-03T13:40:00.000Z",
    "lastSeenAt": "2026-10-26T00:00:00.000Z"
  },
  "expiresAt": "2026-11-02T00:00:00.000Z"
}
```

同时下发 `Secure; HttpOnly; SameSite=Lax` 的会话 Cookie。前端不把密码或 session token 写进 JS storage。

错误：`401 invalid_credentials`、`403 account_suspended`、`429 rate_limited`（带 `Retry-After`）、`400 invalid_json`。

### `POST /api/v1/auth/register`

请求（用户名同时作为显示名，不再单独提交名字）：

```json
{
  "inviteCode": "MGN-7Q2F-K9M4",
  "username": "zhouchi",
  "password": "…",
  "remember": true
}
```

成功 `200` 与登录响应相同，并下发会话 Cookie。

服务端必须：

- 在一个事务里核验并消耗邀请码名额（`active`、未过期、未停用、`usedCount < maxUses`）。
- 拒绝重复用户名；用户名只允许小写字母、数字、下划线、短横线，3–24 位。
- 记住 `name = username`，不要求额外显示名。
- 失败返回 `404 invalid_invite`、`410 invite_expired`、`409 invite_exhausted`、`403 invite_revoked`、`409 username_taken`、`400 invalid_input`。

### `GET /api/v1/auth/me`

返回 `200 { user, expiresAt }` 或 `401 unauthorized`。前端启动时调用一次。

### `POST /api/v1/auth/logout`

`204`，服务端销毁会话并清 Cookie。

### 个人令牌接口

个人令牌用于把本地 DSH 接到托管服务，不能用于登录网页。建议端点（都需要用户会话）：

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/tokens` | 当前账号的令牌列表，只返回前后缀、权限、时间与状态 |
| `POST` | `/api/v1/tokens` | `{ name, scopes: ["publish" \| "manage"], expiresInDays }`；完整令牌只在响应里返回一次 |
| `DELETE` | `/api/v1/tokens/{id}` | 停用令牌；不删除已发布的记录 |

服务端只保存令牌哈希；`publish` 允许发布，`manage` 允许撤回/删除自己的记录。令牌停用后，新的发布请求立即被拒绝。

### 管理员接口

当前管理员页面通过 `src/api/adminClient.ts` 的 `AdminClient` 取数：

| 方法 | 建议端点 | 说明 |
| --- | --- | --- |
| `overview()` | `GET /api/v1/admin/overview` | 计数、7 日发布、最近发布、成员状态、容量 |
| `listInvites()` | `GET /api/v1/admin/invites` | 邀请码、名额、到期与状态 |
| `createInvite(input)` | `POST /api/v1/admin/invites` | `{ note, maxUses, expiresInDays }`；返回新邀请码 |
| `revokeInvite(code)` | `PATCH /api/v1/admin/invites/{code}` | `{ "status": "revoked" }`；已创建的账号不受影响 |
| `listUsers()` | `GET /api/v1/admin/users` | 成员与状态 |
| `setUserStatus(id, status)` | `PATCH /api/v1/admin/users/{id}` | `{ "status": "active" \| "suspended" }` |
| `getSettings()` | `GET /api/v1/admin/settings` | 容量、保留期、上传节奏、准入 |
| `saveSettings(next)` | `PUT /api/v1/admin/settings` | 保存整体策略 |

这些接口都必须要求管理员会话。普通成员访问返回 `403 forbidden`，未登录返回 `401 unauthorized`。

**没有管理员撤回/恢复单条快照的端点。** 快照状态归发布者；管理员若需要处理滥用，应暂停成员（`setUserStatus`），而不是逐条改写记录状态。

## 上线前的安全清单

1. **密码哈希**：Argon2id 或 bcrypt，cost 参数按服务器实测调整；绝不存明文，也不把哈希返回前端。
2. **会话 Cookie**：`Secure`、`HttpOnly`、`SameSite=Lax`；生产环境必须 HTTPS。不要用 localStorage 存可伪造的角色。
3. **限流**：按账号 + IP 双维度限流；连续失败锁定；登录响应保持相近耗时，避免枚举账号。`Retry-After` 与前端倒计时一致。
4. **CSRF**：写操作校验 `Origin`/`Referer`，或使用 double-submit token；不要只依赖 SameSite。
5. **邀请制**：注册由邀请码发起；核验名额、过期与停用状态必须在同一事务内完成，成功后立即消耗名额；账号暂停立即让所有会话失效。
6. **个人令牌**：只存哈希；只在创建时返回完整值；支持单独停用；令牌不能登录网页，也不能读取他人记录。
7. **权限检查**：管理员接口在服务端每请求校验角色，不信任前端隐藏菜单；公开快照读取只返回未撤回且未过期的数据；管理员没有推进单条快照状态的接口。
8. **审计**：记录登录失败、邀请码生成/停用/注册、成员暂停/恢复、令牌生成/停用、记录撤回/恢复；日志不写入密码、临时密码、完整令牌或快照正文。
9. **管理员加固**：建议管理员启用 TOTP 二次验证；高风险操作（批量生成邀请码、删除成员）二次确认。
10. **部署前删除 mock**：`DEMO_ACCOUNTS`、`DEMO_INVITE`、“本地预览模式”提示和一键填入按钮不能出现在生产构建里；至少用构建期开关移除。
11. **依赖与构建**：锁定依赖版本，生产构建只输出静态资源；不在前端 bundle 里放服务端密钥。

## 替换步骤（历史记录）

以下步骤已全部完成，留作实现说明：

1. `src/auth/remoteAuth.ts` 实现 `AuthClient`（含 `register`），同源 `/api/v1/auth/*`，`credentials: 'include'`。
2. `src/auth/useAuth.ts` 按 `VITE_AUTH_MODE` 选择 mock / remote 适配器，两者按需加载。
3. `src/api/remoteAdminClient.ts` 实现邀请码、成员与站点策略接口；管理页沿用现有查询与操作。
4. `src/account/tokens.ts` / `src/account/myShares.ts` 在 remote 模式改走 `/api/v1/tokens` 与 `/api/v1/me/shares`，界面不变。
5. 路由守卫保留 `requiresAuth`/`requiresAdmin`，`ensureAuth()` 的数据源换成服务端 `me()`。
6. 部署构建（`.env.production`）固定 `VITE_AUTH_MODE=remote`：演示凭据、演示邀请码、"本地预览模式"面板与示例数据经树摇与门控移出产物（构建后已验证包内无 `MARGIN-DEMO-2026` / `margin-admin` / `reader-demo` / "本地预览模式"）。

## 前端测试清单

- 未登录访问 `/archive` → `/login?redirect=/archive`；登录后回到 `/archive`。
- 未登录访问 `/admin` → `/login?redirect=/admin`；成员登录后访问 `/admin` → `/archive`。
- 使用邀请码注册：不填显示名也能创建；创建后用户名即显示名，刷新后仍能登录。
- 邀请码过期、名额用尽、停用后注册失败，并显示对应原因。
- 错误密码提示剩余次数；第 5 次锁定 30 秒，倒计时结束可重试。
- 勾选/取消“保持登录”，刷新后会话分别保留/消失。
- 管理员可生成邀请码、停用邀请码、暂停/恢复成员、保存站点策略；成员页没有“代发临时密码”。
- 管理员界面没有单条记录的撤回/恢复按钮；个人页可以撤回并恢复自己的记录。
- 生成令牌后只显示一次完整值；列表只显示前后缀；停用后状态变为“已停用”。
- 暂停账号无法登录；已登录成员被暂停后下一次启动失效。
- Esc、遮罩点击和“取消”都能关闭管理员确认框，焦点回到触发按钮。
- 登录页键盘可达：用户名 → 密码 → 显示密码 → 保持登录 → 提交；错误信息有 `role="alert"`。
