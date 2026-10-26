// 请求身份解析：会话 Cookie（网页）与个人令牌（DSH 插件）两条通道。
import { ApiError, parseCookies } from './http.mjs'
import { sha256 } from './security.mjs'
import { nowIso } from './db.mjs'

export const SESSION_COOKIE = 'margin_session'

/** 从会话 Cookie 解析当前用户；未登录或已失效返回 null。 */
export function sessionUser(req, db) {
  const cookies = parseCookies(req)
  const sid = cookies[SESSION_COOKIE]
  if (!sid) return null
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid)
  if (!session) return null
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid)
    return null
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id)
  if (!user || user.status !== 'active') return null
  return { user, session }
}

/** 要求已登录，否则抛 401。 */
export function requireUser(req, db) {
  const context = sessionUser(req, db)
  if (!context) {
    throw new ApiError(401, 'unauthorized', '需要先登录。')
  }
  // last_seen_at 至多每分钟更新一次，避免高频写。
  const last = new Date(context.user.last_seen_at).getTime()
  if (!Number.isFinite(last) || Date.now() - last > 60_000) {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), context.user.id)
    context.user.last_seen_at = nowIso()
  }
  return context
}

export function requireAdmin(req, db) {
  const context = requireUser(req, db)
  if (context.user.role !== 'admin') {
    throw new ApiError(403, 'forbidden', '只有管理员可以访问这个接口。')
  }
  return context
}

/**
 * 解析 Bearer 个人令牌；无效、停用或过期抛 401。
 * @returns {{ token: object, user: object }}
 */
export function bearerToken(req, db) {
  const header = req.headers.authorization
  if (!header || !/^Bearer\s+/i.test(header)) {
    throw new ApiError(401, 'unauthorized', '缺少个人访问令牌。')
  }
  const secret = header.replace(/^Bearer\s+/i, '').trim()
  if (!secret.startsWith('mgn_tk_')) {
    throw new ApiError(401, 'unauthorized', '个人令牌格式不正确。')
  }
  const token = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(sha256(secret))
  if (!token) throw new ApiError(401, 'unauthorized', '个人令牌无效。')
  if (token.revoked_at) throw new ApiError(401, 'unauthorized', '这个令牌已停用。')
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    throw new ApiError(401, 'unauthorized', '这个令牌已过期。')
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token.owner_id)
  if (!user || user.status !== 'active') {
    throw new ApiError(403, 'forbidden', '令牌所属账号不可用。')
  }
  const last = token.last_used_at ? new Date(token.last_used_at).getTime() : 0
  if (Date.now() - last > 60_000) {
    db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), token.id)
  }
  return { token, user }
}

export function tokenScopes(token) {
  try {
    const value = JSON.parse(token.scopes)
    return Array.isArray(value) ? value.filter((item) => item === 'publish' || item === 'manage') : []
  } catch {
    return []
  }
}

/** 对外用户对象，与前端 AuthUser 形状一致。 */
export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
  }
}
