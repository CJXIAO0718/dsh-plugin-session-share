// 产品层：我的分享（列表、撤回/恢复）与当前策略。
import { ApiError, readJsonBody, sendJson } from '../lib/http.mjs'
import { requireUser } from '../lib/auth-context.mjs'
import { isExpired, loadSettings } from '../lib/settings.mjs'
import { audit } from '../lib/db.mjs'

function myShareFromRow(row, ctx) {
  const expired = isExpired(row.expires_at)
  return {
    id: row.id,
    title: row.title,
    owner: row.owner_username ?? row.owner_id,
    createdAt: row.created_at,
    status: row.status,
    visibility: row.visibility,
    views: row.views,
    snapshotBytes: row.snapshot_bytes,
    redactions: row.redactions ?? 0,
    tools: row.tools ?? 0,
    url: `/s/${row.id}`,
    expiresAt: row.expires_at,
    expired,
    canOpen: row.status === 'published' && !expired,
    demo: row.demo === 1 || undefined,
  }
}

export function registerMeRoutes(router) {
  router.get('/api/v1/me/shares', async (ctx) => {
    const { user } = requireUser(ctx.req, ctx.db)
    const rows = ctx.db
      .prepare(
        `SELECT s.id, s.owner_id, s.title, s.created_at, s.status, s.visibility, s.expires_at, s.snapshot_bytes, s.views, s.redactions, s.tools, s.turns, s.user_messages, s.context_messages, s.assistant_messages, s.tool_calls, s.source_generator, s.source_session_id, s.demo, s.deleted_at, u.username AS owner_username FROM shares s
         LEFT JOIN users u ON u.id = s.owner_id
         WHERE s.owner_id = ? AND s.deleted_at IS NULL
         ORDER BY s.created_at DESC`,
      )
      .all(user.id)
    sendJson(ctx.res, 200, { shares: rows.map((row) => myShareFromRow(row, ctx)) })
  })

  router.patch('/api/v1/me/shares/:id', async (ctx) => {
    const { user } = requireUser(ctx.req, ctx.db)
    const body = await readJsonBody(ctx.req)
    const status = body.status
    if (status !== 'published' && status !== 'revoked') {
      throw new ApiError(400, 'invalid_input', "status 只能是 'published' 或 'revoked'。")
    }
    const row = ctx.db
      .prepare('SELECT id, owner_id FROM shares WHERE id = ? AND owner_id = ? AND deleted_at IS NULL')
      .get(ctx.params.id, user.id)
    if (!row) throw new ApiError(404, 'not_found', '没有找到这份会话存档。')
    ctx.db.prepare('UPDATE shares SET status = ? WHERE id = ?').run(status, row.id)
    audit(ctx.db, user.username, status === 'revoked' ? 'share.revoke' : 'share.restore', { id: row.id })
    const fresh = ctx.db
      .prepare(
        'SELECT s.id, s.owner_id, s.title, s.created_at, s.status, s.visibility, s.expires_at, s.snapshot_bytes, s.views, s.redactions, s.tools, s.turns, s.user_messages, s.context_messages, s.assistant_messages, s.tool_calls, s.source_generator, s.source_session_id, s.demo, s.deleted_at, u.username AS owner_username FROM shares s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = ?',
      )
      .get(row.id)
    sendJson(ctx.res, 200, { share: myShareFromRow(fresh, ctx) })
  })

  router.get('/api/v1/me/policy', async (ctx) => {
    requireUser(ctx.req, ctx.db)
    const settings = loadSettings(ctx.db)
    sendJson(ctx.res, 200, {
      settings: {
        storageQuotaGb: settings.storageQuotaGb,
        userQuotaMb: settings.userQuotaMb,
        maxSnapshotMb: settings.maxSnapshotMb,
        retentionDays: settings.retentionDays,
        uploadsPerMinute: settings.uploadsPerMinute,
        inviteOnly: settings.inviteOnly,
        updatedAt: settings.updatedAt,
      },
    })
  })
}
