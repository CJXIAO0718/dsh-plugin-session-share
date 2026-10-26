// 个人令牌路由：列表（只见前后缀）、生成（明文只返回一次）、停用。
import { ApiError, readJsonBody, sendJson } from '../lib/http.mjs'
import { requireUser } from '../lib/auth-context.mjs'
import { newTokenId, newTokenSecret, sha256 } from '../lib/security.mjs'
import { audit, nowIso } from '../lib/db.mjs'

function publicToken(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    suffix: row.suffix,
    scopes: JSON.parse(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}

export function registerTokenRoutes(router) {
  router.get('/api/v1/tokens', async (ctx) => {
    const { user } = requireUser(ctx.req, ctx.db)
    const rows = ctx.db
      .prepare('SELECT * FROM tokens WHERE owner_id = ? ORDER BY created_at DESC')
      .all(user.id)
    sendJson(ctx.res, 200, { tokens: rows.map(publicToken) })
  })

  router.post('/api/v1/tokens', async (ctx) => {
    const { user } = requireUser(ctx.req, ctx.db)
    const body = await readJsonBody(ctx.req)
    const name = String(body.name ?? '').trim() || '未命名令牌'
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((scope) => scope === 'publish' || scope === 'manage')
      : []
    if (!scopes.length) throw new ApiError(400, 'invalid_input', '至少选择一项权限。')
    const expiresInDays = Number(body.expiresInDays)
    const expiresAt =
      Number.isFinite(expiresInDays) && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null

    const secret = newTokenSecret()
    const id = newTokenId()
    const createdAt = nowIso()
    ctx.db
      .prepare(
        'INSERT INTO tokens (id, owner_id, name, prefix, suffix, hash, scopes, created_at, last_used_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)',
      )
      .run(id, user.id, name, secret.slice(0, 14), secret.slice(-4), sha256(secret), JSON.stringify(scopes), createdAt, expiresAt)
    audit(ctx.db, user.username, 'token.create', { id, name, scopes })
    const row = ctx.db.prepare('SELECT * FROM tokens WHERE id = ?').get(id)
    sendJson(ctx.res, 200, { token: publicToken(row), secret })
  })

  router.delete('/api/v1/tokens/:id', async (ctx) => {
    const { user } = requireUser(ctx.req, ctx.db)
    const row = ctx.db.prepare('SELECT * FROM tokens WHERE id = ? AND owner_id = ?').get(ctx.params.id, user.id)
    if (!row) throw new ApiError(404, 'not_found', '没有找到这枚令牌。')
    if (!row.revoked_at) {
      ctx.db.prepare('UPDATE tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id)
      audit(ctx.db, user.username, 'token.revoke', { id: row.id })
    }
    ctx.res.statusCode = 204
    ctx.res.end()
  })
}
