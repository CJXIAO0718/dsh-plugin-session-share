// 管理员路由：概览、邀请码、成员、站点策略。全部要求管理员会话。
// 没有单条记录撤回/恢复端点 —— 记录状态归发布者（见 docs/AUTH.md）。
import { ApiError, readJsonBody, sendJson } from '../lib/http.mjs'
import { requireAdmin } from '../lib/auth-context.mjs'
import { newInviteCode } from '../lib/security.mjs'
import {
  loadSettings,
  persistSettings,
  recomputeExpiry,
  sanitizeSettings,
  isExpired,
} from '../lib/settings.mjs'
import { audit, nowIso } from '../lib/db.mjs'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function inviteFromRow(row) {
  return {
    code: row.code,
    note: row.note,
    role: row.role,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}

function adminShareFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner_username ?? row.owner_id,
    createdAt: row.created_at,
    status: isExpired(row.expires_at) ? 'revoked' : row.status,
    visibility: row.visibility,
    views: row.views,
    snapshotBytes: row.snapshot_bytes,
    redactions: row.redactions ?? 0,
    tools: row.tools ?? 0,
    url: `/s/${row.id}`,
  }
}

function userFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    shareCount: row.share_count ?? 0,
  }
}

const SHARE_USER_JOIN = `SELECT s.id, s.owner_id, s.title, s.created_at, s.status, s.visibility, s.expires_at, s.snapshot_bytes, s.views, s.redactions, s.tools, s.turns, s.user_messages, s.context_messages, s.assistant_messages, s.tool_calls, s.source_generator, s.source_session_id, s.demo, s.deleted_at, u.username AS owner_username FROM shares s LEFT JOIN users u ON u.id = s.owner_id`

export function registerAdminRoutes(router) {
  router.get('/api/v1/admin/overview', async (ctx) => {
    requireAdmin(ctx.req, ctx.db)
    const totals = ctx.db.prepare(`
      SELECT COUNT(*) AS shares,
        COALESCE(SUM(CASE WHEN status = 'published' AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END), 0) AS published,
        COALESCE(SUM(snapshot_bytes), 0) AS storageBytes, COALESCE(SUM(views), 0) AS views
      FROM shares WHERE deleted_at IS NULL
    `).get(nowIso())
    const users = ctx.db.prepare(`
      SELECT u.id, u.name, u.username, u.role, u.status, u.created_at, u.last_seen_at,
        (SELECT COUNT(*) FROM shares s WHERE s.owner_id = u.id AND s.deleted_at IS NULL) AS share_count
      FROM users u ORDER BY u.created_at ASC
    `).all()
    const recent = ctx.db.prepare(`${SHARE_USER_JOIN} WHERE s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 6`).all()
    const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
    const counts = new Map(ctx.db.prepare(`
      SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM shares
      WHERE deleted_at IS NULL AND created_at >= ? GROUP BY substr(created_at, 1, 10)
    `).all(since).map(row => [row.day, row.n]))
    const activity = []
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(Date.now() - offset * 86400000)
      const iso = day.toISOString().slice(0, 10)
      activity.push({ iso, label: WEEKDAY_LABELS[day.getDay()], count: counts.get(iso) ?? 0 })
    }
    sendJson(ctx.res, 200, { overview: {
      totals: { ...totals, revoked: totals.shares - totals.published, users: users.length,
        activeUsers: users.filter(row => row.status === 'active').length },
      activity, recent: recent.map(adminShareFromRow), users: users.map(userFromRow),
    } })
  })

  router.get('/api/v1/admin/invites', async (ctx) => {
    requireAdmin(ctx.req, ctx.db)
    const rows = ctx.db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all()
    sendJson(ctx.res, 200, { invites: rows.map(inviteFromRow) })
  })

  router.post('/api/v1/admin/invites', async (ctx) => {
    const { user } = requireAdmin(ctx.req, ctx.db)
    const body = await readJsonBody(ctx.req)
    const note = String(body.note ?? '').trim() || '未命名批次'
    const maxUses = Math.min(999, Math.max(1, Math.round(Number(body.maxUses) || 5)))
    const expiresInDays = Number(body.expiresInDays)
    let expiresAt = null
    if (Number.isFinite(expiresInDays) && expiresInDays > 0) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    }
    let code = newInviteCode()
    while (ctx.db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)) code = newInviteCode()
    ctx.db
      .prepare(
        'INSERT INTO invites (code, note, role, max_uses, used_count, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, 0, ?, ?, NULL)',
      )
      .run(code, note, 'member', maxUses, nowIso(), expiresAt)
    audit(ctx.db, user.username, 'invite.create', { code, maxUses })
    const row = ctx.db.prepare('SELECT * FROM invites WHERE code = ?').get(code)
    sendJson(ctx.res, 200, { invite: inviteFromRow(row) })
  })

  router.patch('/api/v1/admin/invites/:code', async (ctx) => {
    const { user } = requireAdmin(ctx.req, ctx.db)
    const code = ctx.params.code.toUpperCase()
    const row = ctx.db.prepare('SELECT * FROM invites WHERE code = ?').get(code)
    if (!row) throw new ApiError(404, 'not_found', '邀请码不存在。')
    const body = await readJsonBody(ctx.req)
    if (body.status === 'revoked' && !row.revoked_at) {
      ctx.db.prepare('UPDATE invites SET revoked_at = ? WHERE code = ?').run(nowIso(), code)
      audit(ctx.db, user.username, 'invite.revoke', { code })
    }
    const fresh = ctx.db.prepare('SELECT * FROM invites WHERE code = ?').get(code)
    sendJson(ctx.res, 200, { invite: inviteFromRow(fresh) })
  })

  router.get('/api/v1/admin/users', async (ctx) => {
    requireAdmin(ctx.req, ctx.db)
    const rows = ctx.db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM shares s WHERE s.owner_id = u.id AND s.deleted_at IS NULL) AS share_count
         FROM users u ORDER BY u.created_at ASC`,
      )
      .all()
    sendJson(ctx.res, 200, { users: rows.map(userFromRow) })
  })

  router.patch('/api/v1/admin/users/:id', async (ctx) => {
    const { user } = requireAdmin(ctx.req, ctx.db)
    const body = await readJsonBody(ctx.req)
    const status = body.status
    if (status !== 'active' && status !== 'suspended') {
      throw new ApiError(400, 'invalid_input', "status 只能是 'active' 或 'suspended'。")
    }
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id)
    if (!row) throw new ApiError(404, 'not_found', '成员不存在。')
    if (row.id === user.id && status === 'suspended') {
      throw new ApiError(400, 'invalid_input', '不能暂停自己的管理员账号。')
    }
    if (row.role === 'admin' && status === 'suspended' && row.id !== user.id) {
      const admins = ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get()
      if (admins.n <= 1) throw new ApiError(400, 'invalid_input', '站点至少要保留一位可登录的管理员。')
    }
    ctx.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, row.id)
    if (status === 'suspended') {
      // 暂停立即生效：清掉该成员全部会话。
      ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id)
    }
    audit(ctx.db, user.username, status === 'suspended' ? 'user.suspend' : 'user.activate', {
      target: row.username,
    })
    const rows = ctx.db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM shares s WHERE s.owner_id = u.id AND s.deleted_at IS NULL) AS share_count
         FROM users u ORDER BY u.created_at ASC`,
      )
      .all()
    sendJson(ctx.res, 200, { users: rows.map(userFromRow) })
  })

  router.get('/api/v1/admin/settings', async (ctx) => {
    requireAdmin(ctx.req, ctx.db)
    sendJson(ctx.res, 200, { settings: loadSettings(ctx.db) })
  })

  router.put('/api/v1/admin/settings', async (ctx) => {
    const { user } = requireAdmin(ctx.req, ctx.db)
    const body = await readJsonBody(ctx.req)
    const previous = loadSettings(ctx.db)
    const saved = persistSettings(ctx.db, sanitizeSettings(body, previous))
    if (saved.retentionDays !== previous.retentionDays) {
      recomputeExpiry(ctx.db)
    }
    audit(ctx.db, user.username, 'settings.save', {
      retentionDays: saved.retentionDays,
      userQuotaMb: saved.userQuotaMb,
      maxSnapshotMb: saved.maxSnapshotMb,
      uploadsPerMinute: saved.uploadsPerMinute,
    })
    sendJson(ctx.res, 200, { settings: saved })
  })
}
