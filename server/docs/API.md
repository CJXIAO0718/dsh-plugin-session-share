# 边注托管 API · v1

边注（MARGIN）把一份 DSH 会话当作**一份原生文档**托管，而不是一张导出的 HTML 页面。

```
DSH 插件                          托管 API                         阅读器
事件流 ──► SnapshotDocument ──► 校验 / 存储 / 分发 ──► 只读渲染
          （脱敏已发生）          （不再解释语义）
```

托管服务已接入：`server/routes/shares.mjs` 实现发布、读取、下载与删除。生产前端通过 remote 适配器访问同源 API。

- Base URL：`/api/v1`
- 媒体类型：`application/vnd.dsh.session-share+json`
- 快照 schema：`dsh.session-share/v1`
- 最大快照：由站点策略 `maxSnapshotMb` 决定（默认 8 MiB）
- 发布限流：由站点策略 `uploadsPerMinute` 决定（默认每人每分钟 8 次发布，一份快照只占 1 次）

## 为什么没有 HTML / 上传

- 插件在 DSH 本地完成事件解析、上下文归类、推理模式、条目选择与默认脱敏。**脱敏先于出网**。
- 托管服务只接受结构化快照，拒绝 HTML，也拒绝原始事件流；它不重新渲染，不重新脱敏，不猜语义。
- 阅读器消费同一份 `SnapshotDocument`，本地适配器与远程适配器返回同样的形状。
- 没有“上传文件”步骤。发布由插件在会话里发起。

## 身份与凭据

本文件定义**共享快照 API**。发布会话由个人访问令牌授权，令牌在边注网页的「连接与令牌」里生成，由 DSH 插件持有。产品层的邀请码注册、成员与管理员界面见 [AUTH.md](AUTH.md)；管理员只设定整体策略，不逐条撤回记录。

| 凭据 | 谁持有 | 用途 | 存储 |
| --- | --- | --- | --- |
| 个人令牌 `mgn_tk_…` | 账号本人，填入 DSH 插件 | 发布新快照；有 `manage` 权限时撤回/删除自己的快照 | 服务端只存哈希；插件保存在本机浏览器 |
| 分享 ID | 分享链接 | 公开只读读取 | 不可枚举，随机生成 |

- 令牌不进入分享链接、日志或 Referer；客户端使用 `Authorization: Bearer …`。
- 公开 API 不提供账号空间、目录、搜索或跨快照列表。个人分享列表与管理员视图属于产品层接口。
- 令牌可以单独停用；停用后新的发布请求立即被拒绝，但已发布的记录不受影响。
- 记录归发布者管理：撤回与恢复由本人操作，管理员没有单条快照的状态接口。

## 端点

### 1. 发布快照

```http
POST /api/v1/shares
Authorization: Bearer mgn_tk_…
Content-Type: application/vnd.dsh.session-share+json
```

请求体：

```json
{
  "schema": "dsh.session-share/v1",
  "document": {
    "schemaVersion": 1,
    "title": "采样率之外：一次鼓组重采样的频谱体检",
    "source": {
      "generator": "DSH session share",
      "pluginVersion": "0.1.0",
      "sessionId": "session-fe32c8c1",
      "generatedAt": "2026-10-25 23:14 UTC",
      "generatedAtIso": "2026-10-25T15:14:00.000Z",
      "cwd": "%USERPROFILE%\\audio-lab",
      "reasoning": "full",
      "redacted": true
    },
    "counts": {
      "turns": 3,
      "userMessages": 3,
      "contextMessages": 2,
      "assistantMessages": 6,
      "toolCalls": 4,
      "collapsedBlocks": 18,
      "redactions": 7,
      "badLines": 0,
      "events": 34,
      "picked": 9,
      "totalEntries": 9
    },
    "turns": [],
    "internal": { "count": 34, "events": [], "note": null },
    "emptySelection": false,
    "warnings": []
  }
}
```

响应 `201 Created`：

```json
{
  "share": {
    "id": "7q2m9x4k8p3v6c1n",
    "url": "https://s.example/s/7q2m9x4k8p3v6c1n",
    "title": "采样率之外：一次鼓组重采样的频谱体检",
    "createdAt": "2026-10-25T15:14:06.000Z",
    "source": {
      "generator": "DSH session share",
      "sessionId": "session-fe32c8c1"
    },
    "counts": {
      "turns": 3,
      "userMessages": 3,
      "contextMessages": 2,
      "assistantMessages": 6,
      "toolCalls": 4,
      "redactions": 7
    },
    "visibility": "unlisted",
    "expiresAt": null,
    "snapshotBytes": 30412,
    "owner": { "id": "usr_…", "username": "zhouchi" }
  },
  "warnings": []
}
```

约束：

- `schema` 必须是 `dsh.session-share/v1`。
- `document.schemaVersion` 必须是 `1`。
- 服务端计算实际字节数；超过站点策略 `maxSnapshotMb` 返回 `413`。
- 服务端不修改 `document`，不重写 `title`，不补全缺字段。
- 发布成功后才生成 `id`；`snapshotBytes` 为规范化 JSON 的字节数。
- `owner` 由令牌推断，客户端不能指定所有者。
- 没有一次性 `manageToken`：管理凭据就是令牌本身。

### 2. 读取快照

```http
GET /api/v1/shares/{id}
Accept: application/vnd.dsh.session-share+json
```

响应 `200 OK`：

```json
{
  "share": {
    "id": "7q2m9x4k8p3v6c1n",
    "url": "https://s.example/s/7q2m9x4k8p3v6c1n",
    "title": "采样率之外：一次鼓组重采样的频谱体检",
    "createdAt": "2026-10-25T15:14:06.000Z",
    "source": { "generator": "DSH session share", "sessionId": "session-fe32c8c1" },
    "counts": { "turns": 3, "userMessages": 3, "toolCalls": 4, "redactions": 7 },
    "visibility": "unlisted",
    "expiresAt": null,
    "snapshotBytes": 30412
  },
  "document": {
    "schemaVersion": 1,
    "title": "…",
    "source": { "…": "…" },
    "counts": { "…": "…" },
    "turns": [],
    "internal": null,
    "emptySelection": false,
    "warnings": []
  }
}
```

- 不需要 token；ID 不可枚举，`visibility` 固定为 `unlisted`。
- 响应头：`Cache-Control: private, no-store`，`X-Content-Type-Options: nosniff`。
- 不存在、过期或已删除统一返回 `404 not_found`，不区分原因。

### 3. 下载原始快照

```http
GET /api/v1/shares/{id}/snapshot
```

响应为完整 bundle，可直接保存或重新发布：

```json
{
  "schema": "dsh.session-share/v1",
  "document": { "schemaVersion": 1, "…": "…" }
}
```

响应头：

```http
Content-Type: application/vnd.dsh.session-share+json
Content-Disposition: attachment; filename="session-share-7q2m9x4k8p3v6c1n.json"
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

### 4. 删除快照

```http
DELETE /api/v1/shares/{id}
Authorization: Bearer mgn_tk_…
```

- `204 No Content` 删除成功。
- `403 forbidden`：令牌没有 `manage` 权限，或不属于该记录。
- `404 not_found`：已被删除，或从未存在。
- 删除文档与原始 JSON，不保留 tombstone 内容。

## 数据模型

### SnapshotDocument

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 文档版本，当前只接受 1 |
| `title` | string | 会话标题，非空 |
| `source` | ShareSource | 生成器、会话、工作目录、推理模式、脱敏标记 |
| `counts` | ShareCounts | 所有计数，必须与文档内容一致 |
| `turns` | Turn[] | 有顺序的轮次 |
| `internal` | InternalEvents \| null | 内部事件只保留类型与计数 |
| `emptySelection` | boolean | 发布时是否没有选择任何消息 |
| `warnings` | string[] | 发布端可读警告，不阻断渲染 |

### Turn

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 稳定 ID |
| `number` | number | 从 1 开始的轮次 |
| `label` | string | 例如 `第 01 轮` |
| `messages` | Message[] | 用户与助手消息 |
| `apparatus` | Apparatus[] | 上下文、推理、工具旁注 |
| `reasoningOmitted` | `{count}` \| null | 计数模式省略的推理段数 |

### Message / Apparatus

- `Message`：`{ id, role: 'user'|'assistant', name, markdown }`。`markdown` 是源文，不由服务端渲染。
- `Context`：`{ id, type:'context', index, chars, reason, text }`，`text` 保留原文。
- `Reasoning`：`{ id, type:'reasoning', index, chars, markdown }`。
- `Tool`：`{ id, type:'tool', index, name, summary, meta, error, args, result, argsTruncated, resultTruncated, noResult }`。
  - `argsTruncated` / `resultTruncated`：`{ shown, original }` 或 `null`。
  - `noResult` 为真时，`result` 为空，`note` 由阅读器按约定文案展示。

## 错误

统一响应：

```json
{
  "error": {
    "code": "invalid_snapshot",
    "message": "这份快照不符合 dsh.session-share/v1。",
    "details": ["document.turns[0].messages[2].markdown 不是字符串"]
  }
}
```

| 状态 | code | 含义 |
| --- | --- | --- |
| 400 | `invalid_json` | 请求体不是合法 JSON，或字段类型不对 |
| 401 | `unauthorized` | 缺少或无效的个人令牌 |
| 403 | `forbidden` | 令牌没有 `manage` 权限，或不属于该记录 |
| 404 | `not_found` | ID 不存在，或已过期、已删除 |
| 413 | `payload_too_large` | 快照超过站点策略设置的大小上限 |
| 422 | `unsupported_schema` | schema 不是 `dsh.session-share/v1` |
| 422 | `invalid_snapshot` | 文档结构不完整或计数不一致 |
| 429 | `rate_limited` | 发布次数超过站点策略的每分钟上限，按 `Retry-After` 重试 |

服务端必须拒绝而不是截断：不做“看起来差不多”的修复，不把 HTML 当快照，不把原始事件流当快照。

## 版本与兼容

- URL 主版本：`/api/v1`。
- 文档版本：`schemaVersion: 1`；增加字段属于向后兼容，删除或改变语义必须升 `v2`。
- 服务端必须在写入前校验；读取时不得重新解释旧文档。
- `GET /shares/{id}` 的 `document` 必须与入库时字节级语义一致；再次下载的 bundle 可以重新发布。

## 本地适配器

`src/api/localClient.ts` 已经实现同一份形状：

- 用 IndexedDB 存 `{ summary, document, json }`。
- 读取 demo 时从 `/demo/spectral.json` 载入，并用 `src/parser/parseSnapshot.ts` 校验。
- 删除只影响当前浏览器。
- 远程实现只需替换 `get`、`snapshotJson`、`remove`，阅读器与解析器不动。

## OpenAPI

机器可读文件位于 [`public/api/openapi.yaml`](../public/api/openapi.yaml)。页面内入口：`/api/openapi.yaml`。
