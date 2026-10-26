<script setup lang="ts">
import CodeBlock from '../components/CodeBlock.vue'

const clientContract = `export interface ShareReader {
  readonly mode: 'local' | 'remote'
  get(id: string): Promise<ShareSnapshot>
  snapshotJson(id: string): Promise<{ json: string; filename: string }>
  remove(id: string): Promise<void>
}

// The server only ever returns these two shapes.
interface ShareSnapshot {
  summary: ShareSummary
  document: SnapshotDocument
}`

const documentContract = `interface SnapshotDocument {
  schemaVersion: 1
  title: string
  source: ShareSource      // generator, sessionId, cwd, reasoning…
  counts: ShareCounts      // turns, messages, tools, redactions…
  turns: Turn[]            // messages + apparatus (context/reasoning/tool)
  internal: InternalEvents | null
  emptySelection: boolean
  warnings: string[]
}`

const createRequest = `POST /api/v1/shares
Authorization: Bearer mgn_tk_…
Content-Type: application/vnd.dsh.session-share+json

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
      "cwd": "%USERPROFILE%\\\\audio-lab",
      "reasoning": "full",
      "redacted": true
    },
    "counts": { "turns": 3, "userMessages": 3, "assistantMessages": 6,
                "contextMessages": 2, "toolCalls": 4, "redactions": 7 },
    "turns": [ /* messages + apparatus, already redacted */ ],
    "internal": { "count": 34, "events": [ /* type + count */ ] },
    "emptySelection": false,
    "warnings": []
  }
}`

const createResponse = `201 Created

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
    "snapshotBytes": 30412,
    "owner": { "id": "usr_…", "username": "zhouchi" }
  },
  "warnings": []
}`

const readResponse = `GET /api/v1/shares/7q2m9x4k8p3v6c1n
Accept: application/vnd.dsh.session-share+json

200 OK

{
  "share": {
    "id": "7q2m9x4k8p3v6c1n",
    "title": "…",
    "counts": { "…": "…" }
  },
  "document": {
    "schemaVersion": 1,
    "title": "…",
    "turns": [
      {
        "number": 1,
        "label": "第 01 轮",
        "messages": [{ "id": "m7", "role": "user", "name": "你", "markdown": "…" }],
        "apparatus": [{ "type": "tool", "id": "tool-0-1", "name": "inspect_audio" }],
        "reasoningOmitted": null
      }
    ],
    "internal": { "count": 34, "events": [] },
    "emptySelection": false,
    "warnings": []
  }
}`

const snapshotResponse = `GET /api/v1/shares/7q2m9x4k8p3v6c1n/snapshot

200 OK
Content-Type: application/vnd.dsh.session-share+json
Content-Disposition: attachment; filename="session-share-7q2m9x4k8p3v6c1n.json"
Cache-Control: no-store`

const errorShape = `{
  "error": {
    "code": "invalid_snapshot",
    "message": "这份快照不符合 dsh.session-share/v1。",
    "details": ["document.turns[0].messages[2].markdown 不是字符串"]
  }
}`

const endpoints = [
  { method: 'POST', path: '/api/v1/shares', purpose: '发布一份原生快照', auth: '个人令牌' },
  { method: 'GET', path: '/api/v1/shares/{id}', purpose: '读取摘要与原生文档', auth: '无 · unlisted' },
  { method: 'GET', path: '/api/v1/shares/{id}/snapshot', purpose: '下载原始 JSON 快照', auth: '无 · unlisted' },
  { method: 'DELETE', path: '/api/v1/shares/{id}', purpose: '删除文档与快照', auth: '个人令牌 · manage' },
]

const errors = [
  { status: '400', code: 'invalid_json', meaning: '请求体不是合法 JSON，或字段类型不对。' },
  { status: '401', code: 'unauthorized', meaning: '缺少或无效的个人令牌，不能发布。' },
  { status: '413', code: 'payload_too_large', meaning: '原生快照超过站点策略设置的大小上限。' },
  { status: '422', code: 'unsupported_schema', meaning: 'schema 不是 dsh.session-share/v1。' },
  { status: '422', code: 'invalid_snapshot', meaning: '文档结构不完整，拒绝入库。' },
  { status: '404', code: 'not_found', meaning: 'ID 不存在，或已过期、已删除。' },
  { status: '403', code: 'forbidden', meaning: '令牌没有 manage 权限，或不属于该记录。' },
  { status: '429', code: 'rate_limited', meaning: '发布次数超过站点策略的每分钟上限，按 Retry-After 重试。' },
]
</script>

<template>
  <div class="api-page">
    <header class="api-hero">
      <p class="api-kicker">托管接口 / CONTRACT · V1</p>
      <h1>同一段会话，<br />换一个地址。</h1>
      <p class="api-lede">
        边注与 DSH 插件共用一份 <code>SnapshotDocument</code>。插件在本地完成解析、脱敏与选择，
        托管服务只校验、存储与分发；<strong>没有 HTML 中转，也没有手工上传</strong>。
      </p>
      <div class="api-meta">
        <span><b>BASE</b> /api/v1</span>
        <span><b>FORMAT</b> native JSON</span>
        <span><b>AUTH</b> 个人令牌 mgn_tk_…</span>
        <span><b>LIMIT</b> 站点策略设置</span>
      </div>
      <p class="api-status"><span />当前状态：原生快照与本地阅读器已实现；托管服务尚未接入。</p>
    </header>

    <div class="api-layout">
      <nav class="api-toc" aria-label="接口目录">
        <span class="api-toc-title">目录</span>
        <a href="#contract">原生边界</a>
        <a href="#endpoints">端点总览</a>
        <a href="#create">发布快照</a>
        <a href="#read">读取与下载</a>
        <a href="#manage">管理与删除</a>
        <a href="#errors">错误与限制</a>
        <a href="#principles">快照原则</a>
        <a class="api-toc-file" href="/api/openapi.yaml" target="_blank" rel="noreferrer">OpenAPI 文件 ↗</a>
      </nav>

      <div class="api-content">
        <section id="contract" class="api-section">
          <div class="api-section-head">
            <span class="api-index">01</span>
            <h2>先确定原生边界</h2>
          </div>
          <p>
            服务端不接收 HTML，不解析 DOM，也不重新渲染会话。它接收的是插件从事件流派生出的
            <code>SnapshotDocument</code>：消息保留 Markdown 源文，上下文保留原文，推理与工具各带截断元数据。
            阅读器只消费这份文档。
          </p>
          <div class="api-flow" aria-label="数据流">
            <div><span class="mono">PLUGIN</span><strong>在本地生成快照</strong><small>解析、脱敏、选择、推理模式都在 DSH 侧决定</small></div>
            <span class="api-flow-arrow" aria-hidden="true">→</span>
            <div><span class="mono">API</span><strong>校验并托管</strong><small>只接受 v1 文档；不接收 HTML 与原始事件</small></div>
            <span class="api-flow-arrow" aria-hidden="true">→</span>
            <div><span class="mono">READER</span><strong>按文档渲染</strong><small>本地与远程适配器返回同一个形状</small></div>
          </div>
          <CodeBlock label="typescript · 阅读器边界" :code="clientContract" />
          <CodeBlock label="typescript · 快照文档" :code="documentContract" />
        </section>

        <section id="endpoints" class="api-section">
          <div class="api-section-head">
            <span class="api-index">02</span>
            <h2>端点总览</h2>
          </div>
          <p>四个端点覆盖发布、阅读、导出与删除。没有更新端点：快照一旦入库就不可变，改标题也重新发布一份。</p>
          <div class="api-endpoints" role="table" aria-label="端点列表">
            <div class="api-endpoint api-endpoint-head" role="row">
              <span role="columnheader">方法</span>
              <span role="columnheader">路径</span>
              <span role="columnheader">用途</span>
              <span role="columnheader">鉴权</span>
            </div>
            <div v-for="endpoint in endpoints" :key="`${endpoint.method} ${endpoint.path}`" class="api-endpoint" role="row">
              <span class="api-method" :class="`is-${endpoint.method.toLowerCase()}`" role="cell">{{ endpoint.method }}</span>
              <code role="cell">{{ endpoint.path }}</code>
              <span role="cell">{{ endpoint.purpose }}</span>
              <span class="api-auth" role="cell">{{ endpoint.auth }}</span>
            </div>
          </div>
        </section>

        <section id="create" class="api-section">
          <div class="api-section-head">
            <span class="api-index">03</span>
            <h2>发布快照</h2>
          </div>
          <p>
            插件用个人令牌调用 <code>POST /api/v1/shares</code>。请求体必须是完整的
            <code>dsh.session-share/v1</code> 文档；服务端校验失败返回 422，不会存下一份打不开的页面。
            所有者由令牌推断，响应里没有一次性管理凭据；管理凭据就是令牌本身。
          </p>
          <CodeBlock label="request · 个人令牌" :code="createRequest" />
          <CodeBlock label="response · 201" :code="createResponse" />
          <div class="api-note">
            <strong>脱敏发生在快照之前。</strong>
            插件先做默认脱敏，再序列化文档；服务端只校验结构，不重新替换内容。若服务端再脱敏一次，
            会改变证据与计数，反而不可信。
          </div>
        </section>

        <section id="read" class="api-section">
          <div class="api-section-head">
            <span class="api-index">04</span>
            <h2>读取与下载</h2>
          </div>
          <p>
            公开读取不需要 token，但 ID 必须不可枚举。响应同时包含 <code>share</code>（摘要与计数）和
            <code>document</code>（阅读器用的原生文档），两者来自同一份入库快照。
          </p>
          <CodeBlock label="response · 200" :code="readResponse" />
          <p>
            <code>/snapshot</code> 返回可携带的原始 JSON，用于备份、迁移或在另一台边注实例上重新发布。
            它必须带 <code>Content-Disposition: attachment</code> 与 <code>X-Content-Type-Options: nosniff</code>。
          </p>
          <CodeBlock label="snapshot · headers" :code="snapshotResponse" />
          <div class="api-note">
            <strong>读取参数不存在。</strong> <code>pick</code>、<code>reasoning</code>、主题都在插件发布时固化。
            要另一份视图，就在 DSH 里重新发布，再创建一个新的 ID。
          </div>
        </section>

        <section id="manage" class="api-section">
          <div class="api-section-head">
            <span class="api-index">05</span>
            <h2>管理与删除</h2>
          </div>
          <p>
            发布与删除都由个人令牌授权。令牌在边注的「连接与令牌」里生成，可以单独停用；
            服务端只存哈希，完整值只在生成时返回一次。插件把它放在 <code>Authorization: Bearer …</code>，
            不放进 URL、日志或 Referer。
          </p>
          <div class="api-actions-list">
            <div><code>DELETE /api/v1/shares/{id}</code><span>同时删除文档与原始 JSON；返回 204，重复删除返回 404。</span></div>
            <div><code>manage</code><span>令牌必须带 <code>manage</code> 权限，且属于记录所有者；停用令牌不会删除已发布记录。</span></div>
          </div>
          <div class="api-note">
            <strong>没有公共目录，也没有管理员逐条撤回。</strong> 托管的是“一份可读的快照”，
            记录由发布者撤回或恢复；管理员只设定容量、保留期与上传节奏。
          </div>
        </section>

        <section id="errors" class="api-section">
          <div class="api-section-head">
            <span class="api-index">06</span>
            <h2>错误与限制</h2>
          </div>
          <p>错误响应统一为 <code>{ error: { code, message, details? } }</code>。插件按 <code>code</code> 分支，不解析文案。</p>
          <CodeBlock label="error · 422" :code="errorShape" />
          <div class="api-error-table">
            <div class="api-error-row api-error-head"><span>状态</span><span>code</span><span>含义</span></div>
            <div v-for="error in errors" :key="error.code" class="api-error-row">
              <span class="mono">{{ error.status }}</span>
              <code>{{ error.code }}</code>
              <span>{{ error.meaning }}</span>
            </div>
          </div>
          <div class="api-limits">
            <div><b>策略上限</b><span>单份快照、每人配额与站点总容量由管理员设置；服务端拒绝而不截断。</span></div>
            <div><b>上传节奏</b><span>按个人令牌的发布次数限流，一份快照只占 1 次；返回 Retry-After。</span></div>
            <div><b>不可枚举</b><span>服务端 ID 至少 16 个 base32 字符；不使用自增序号。</span></div>
            <div><b>no-store</b><span>文档与快照响应不进入共享缓存；需要 ETag 时用私有一致性标记。</span></div>
          </div>
        </section>

        <section id="principles" class="api-section">
          <div class="api-section-head">
            <span class="api-index">07</span>
            <h2>快照原则</h2>
          </div>
          <ol class="api-principles">
            <li><strong>原生，不是导出。</strong>消息、上下文、推理与工具都以结构字段保存，不以 HTML 作为中间层。</li>
            <li><strong>插件负责语义。</strong>什么算用户语音、什么进旁注、脱敏多少处，由插件在本地决定并计数。</li>
            <li><strong>证据不被改写。</strong>截断、脱敏、省略、选择比例都作为元数据保留，不补全、不推断。</li>
            <li><strong>不可变。</strong>没有 PATCH；一份存档对应一次发布，新增内容就新增存档。</li>
            <li><strong>最小暴露。</strong>unlisted、无目录、无搜索、无公开列表；删除即删除文档与快照。</li>
          </ol>
          <p class="api-closing">
            这份约定先从本地链路长出来：插件导出原生快照，本地适配器直接消费它。
            远程实现只需要替换 <code>src/api/localClient.ts</code> 的读取部分，阅读器与解析器不动。
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
