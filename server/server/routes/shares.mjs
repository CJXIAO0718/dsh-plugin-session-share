// 快照端点：发布（令牌）、公开读取、原始下载、删除。契约见 docs/API.md。
import {
  ApiError,
  SNAPSHOT_TYPE,
  absoluteShareUrl,
  notFound,
  readBody,
  sendJson,
} from '../lib/http.mjs'
import { bearerToken, sessionUser, tokenScopes } from '../lib/auth-context.mjs'
import { newShareId, SlidingWindow } from '../lib/security.mjs'
import { validateShareBundle } from '../lib/validate.mjs'
import { expiryFor, isExpired, loadSettings } from '../lib/settings.mjs'
import { audit, nowIso } from '../lib/db.mjs'


function summaryFromRow(row, ctx, { withOwner = false } = {}) {
  const summary = {
    id: row.id,
    url: absoluteShareUrl(ctx.req, row.id, ctx.config),
    title: row.title,
    createdAt: row.created_at,
    source: {
      generator: row.source_generator ?? null,
      sessionId: row.source_session_id ?? null,
    },
    counts: {
      turns: row.turns ?? 0,
      userMessages: row.user_messages ?? 0,
      contextMessages: row.context_messages ?? 0,
      assistantMessages: row.assistant_messages ?? 0,
      toolCalls: row.tool_calls ?? 0,
      redactions: row.redactions ?? null,
    },
    visibility: row.visibility,
    expiresAt: row.expires_at,
    snapshotBytes: row.snapshot_bytes,
  }
  if (withOwner) summary.owner = { id: row.owner_id, username: row.owner_username ?? row.owner_id }
  if (row.demo) summary.demo = true
  return summary
}

function liveShare(ctx, id) {
  if (!/^[a-z0-9-]{4,32}$/.test(id)) return null
  const row = ctx.db
    .prepare(
      `SELECT s.*, u.username AS owner_username FROM shares s
       LEFT JOIN users u ON u.id = s.owner_id
       WHERE s.id = ? AND s.deleted_at IS NULL`,
    )
    .get(id)
  if (!row) return null
  if (row.status !== 'published') return null
  if (isExpired(row.expires_at)) return null
  return row
}

function userBytesUsed(db, userId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(snapshot_bytes), 0) AS total FROM shares WHERE owner_id = ? AND deleted_at IS NULL')
    .get(userId)
  return row.total
}

function siteBytesUsed(db) {
  const row = db
    .prepare('SELECT COALESCE(SUM(snapshot_bytes), 0) AS total FROM shares WHERE deleted_at IS NULL')
    .get()
  return row.total
}

export function registerShareRoutes(router) {
  const uploadWindow = new SlidingWindow(60_000)
  router.post('/api/v1/shares', async (ctx) => {
    const { token, user } = bearerToken(ctx.req, ctx.db)
    if (!tokenScopes(token).includes('publish')) {
      throw new ApiError(403, 'forbidden', '这枚令牌没有发布权限。')
    }

    const settings = loadSettings(ctx.db)
    const maxBytes = settings.maxSnapshotMb * 1024 * 1024
    // 发布节奏：按发布次数在 60 秒窗口内累计；一份快照无论包含多少条消息，都只占 1 次。
    const used = uploadWindow.current(user.id)
    if (used + 1 > settings.uploadsPerMinute) {
      const retryAfter = uploadWindow.retryAfterSeconds(user.id)
      throw new ApiError(429, 'rate_limited', '发布过于频繁，已超过每分钟允许的发布次数，请稍后再试。', null, {
        'Retry-After': String(retryAfter),
      })
    }

    const raw = (await readBody(ctx.req, maxBytes + 1024)).toString('utf8')

    const { parsedBundle, document, warnings } = validateShareBundle(raw)

    // 入库保存规范化 JSON，snapshotBytes 按其字节数计。
    const canonical = JSON.stringify(parsedBundle)
    const bytes = Buffer.byteLength(canonical, 'utf8')
    // Other uploads may finish while this request is awaiting its body.
    if (uploadWindow.current(user.id) >= settings.uploadsPerMinute) {
      throw new ApiError(429, 'rate_limited', '发布过于频繁，请稍后再试。', null, {
        'Retry-After': String(uploadWindow.retryAfterSeconds(user.id)),
      })
    }
    if (bytes > maxBytes) {
      throw new ApiError(413, 'payload_too_large', `这份快照超过 ${settings.maxSnapshotMb} MB 的大小上限。`, [
        `当前快照约 ${(bytes / (1024 * 1024)).toFixed(1)} MB。`,
      ])
    }

    // 配额：先个人后全站。
    if (userBytesUsed(ctx.db, user.id) + bytes > settings.userQuotaMb * 1024 * 1024) {
      throw new ApiError(413, 'quota_exceeded', '个人配额已用满，无法发布新记录。', [
        `配额为 ${settings.userQuotaMb} MB。`,
      ])
    }
    if (siteBytesUsed(ctx.db) + bytes > settings.storageQuotaGb * 1024 * 1024 * 1024) {
      throw new ApiError(413, 'quota_exceeded', '站点容量已用满，无法发布新记录。')
    }

    const counts = document.counts
    let id = newShareId()
    while (ctx.db.prepare('SELECT 1 FROM shares WHERE id = ?').get(id)) id = newShareId()
    const createdAt = nowIso()
    const expiresAt = expiryFor(createdAt, settings.retentionDays)

    ctx.db
      .prepare(
        `INSERT INTO shares (
          id, owner_id, title, created_at, status, visibility, expires_at, snapshot_bytes,
          redactions, tools, turns, user_messages, context_messages, assistant_messages, tool_calls,
          source_generator, source_session_id, json, demo
        ) VALUES (?, ?, ?, ?, 'published', 'unlisted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        id,
        user.id,
        document.title,
        createdAt,
        expiresAt,
        bytes,
        counts.redactions ?? null,
        counts.toolCalls ?? 0,
        counts.turns ?? 0,
        counts.userMessages ?? 0,
        counts.contextMessages ?? 0,
        counts.assistantMessages ?? 0,
        counts.toolCalls ?? 0,
        document.source?.generator ?? null,
        document.source?.sessionId ?? null,
        canonical,
      )
    uploadWindow.add(user.id)
    audit(ctx.db, user.username, 'share.publish', { id, bytes })

    const row = ctx.db
      .prepare(
        `SELECT s.id, s.owner_id, s.title, s.created_at, s.status, s.visibility, s.expires_at, s.snapshot_bytes, s.views, s.redactions, s.tools, s.turns, s.user_messages, s.context_messages, s.assistant_messages, s.tool_calls, s.source_generator, s.source_session_id, s.demo, s.deleted_at, u.username AS owner_username FROM shares s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = ?`,
      )
      .get(id)
    sendJson(ctx.res, 201, {
      share: summaryFromRow(row, ctx, { withOwner: true }),
      warnings,
    })
  })

  router.get('/api/v1/shares/:id', async (ctx) => {
    const row = liveShare(ctx, ctx.params.id)
    if (!row) return notFound(ctx.res)
    ctx.db.prepare('UPDATE shares SET views = views + 1 WHERE id = ?').run(row.id)
    const bundle = JSON.parse(row.json)
    sendJson(ctx.res, 200, {
      share: summaryFromRow(row, ctx),
      document: bundle.document,
    })
  })

  router.get('/api/v1/shares/:id/snapshot', async (ctx) => {
    const row = liveShare(ctx, ctx.params.id)
    if (!row) return notFound(ctx.res)
    ctx.res.statusCode = 200
    ctx.res.setHeader('Content-Type', SNAPSHOT_TYPE)
    ctx.res.setHeader('Content-Disposition', `attachment; filename="session-share-${row.id}.json"`)
    ctx.res.setHeader('Cache-Control', 'no-store')
    ctx.res.setHeader('X-Content-Type-Options', 'nosniff')
    ctx.res.end(row.json)
  })

  router.delete('/api/v1/shares/:id', async (ctx) => {
    const id = ctx.params.id
    if (!/^[a-z0-9-]{4,32}$/.test(id)) return notFound(ctx.res)
    const row = ctx.db.prepare('SELECT id, owner_id FROM shares WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!row) return notFound(ctx.res)

    const authHeader = ctx.req.headers.authorization
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      const { token, user } = bearerToken(ctx.req, ctx.db)
      if (!tokenScopes(token).includes('manage')) {
        throw new ApiError(403, 'forbidden', '这枚令牌没有管理权限。')
      }
      if (row.owner_id !== user.id) {
        throw new ApiError(403, 'forbidden', '只能删除自己发布的记录。')
      }
      audit(ctx.db, user.username, 'share.delete', { id })
    } else {
      // 产品层：发布者本人已登录时，阅读页可以直接删除自己的记录。
      const context = sessionUser(ctx.req, ctx.db)
      if (!context || context.user.id !== row.owner_id) {
        throw new ApiError(401, 'unauthorized', '删除记录需要个人令牌或发布者登录。')
      }
      audit(ctx.db, context.user.username, 'share.delete', { id })
    }

    ctx.db.prepare('DELETE FROM shares WHERE id = ?').run(id)
    ctx.res.statusCode = 204
    ctx.res.end()
  })
}
