// 认证路由：登录、邀请码注册、会话查询、退出。
import { ApiError, clearSessionCookie, readJsonBody, sendJson, setSessionCookie, clientIp } from '../lib/http.mjs'
import { SESSION_COOKIE, publicUser, sessionUser } from '../lib/auth-context.mjs'
import {
  hashPassword,
  hashPasswordAsync,
  verifyPasswordAsync,
  validUsername,
  validPassword,
  newSessionId,
  newUserId,
} from '../lib/security.mjs'
import { audit, nowIso } from '../lib/db.mjs'

// 占位哈希：用户名不存在时也做一次完整比对，避免通过响应时间枚举账号。
const DUMMY_HASH = hashPassword('margin-dummy-password')

const SESSION_HOURS = 12
const REMEMBER_DAYS = 7

function sessionLifetime(remember) {
  return (remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * 60 * 60 * 1000
}

function issueSession(db, res, user, remember, secureCookies) {
  const lifetime = sessionLifetime(remember)
  const expiresAt = new Date(Date.now() + lifetime).toISOString()
  const sid = newSessionId()
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, persistent) VALUES (?, ?, ?, ?, ?)',
  ).run(sid, user.id, nowIso(), expiresAt, remember ? 1 : 0)
  setSessionCookie(res, SESSION_COOKIE, sid, {
    maxAgeSeconds: Math.floor(lifetime / 1000),
    secure: secureCookies,
  })
  return expiresAt
}

function sessionBody(user, expiresAt, remember) {
  return {
    user: publicUser(user),
    expiresAt,
    persistent: Boolean(remember),
  }
}

function inviteFailure(status, code, message) {
  return new ApiError(status, code, message)
}

export function registerAuthRoutes(router) {
  router.post('/api/v1/auth/login', async (ctx) => {
    const body = await readJsonBody(ctx.req)
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const remember = body.remember === true

    if (!validUsername(username) || !validPassword(password)) {
      throw new ApiError(400, 'invalid_input', '请输入用户名和密码。')
    }

    const ip = clientIp(ctx.req)
    const locked = ctx.loginThrottle.lockedSeconds(username, ip)
    if (locked > 0) {
      throw new ApiError(429, 'rate_limited', `尝试次数过多，请在 ${locked} 秒后再试。`, null, {
        'Retry-After': String(locked),
      })
    }

    const user = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(username)
    // 无论用户是否存在都执行一次哈希比对，尽量抹平响应耗时差。
    const ok = await verifyPasswordAsync(password, user ? user.password_hash : DUMMY_HASH)

    if (!user || !ok) {
      const { remaining } = ctx.loginThrottle.noteFailure(username, ip)
      if (remaining === 0) {
        throw new ApiError(
          429,
          'rate_limited',
          `连续 ${ctx.loginThrottle.maxAttempts} 次未通过，入口锁定 ${Math.round(ctx.loginThrottle.lockMs / 1000)} 秒。`,
          null,
          { 'Retry-After': String(Math.ceil(ctx.loginThrottle.lockMs / 1000)) },
        )
      }
      throw new ApiError(401, 'invalid_credentials', `用户名或密码不正确。还可尝试 ${remaining} 次。`)
    }

    // Re-read after awaiting scrypt: suspension can occur while the hash is running.
    if (user.status !== 'active' || ctx.db.prepare('SELECT status FROM users WHERE id = ?').get(user.id)?.status !== 'active') {
      throw new ApiError(403, 'account_suspended', '这个账号已被暂停，请联系管理员。')
    }

    ctx.loginThrottle.reset(username, ip)
    ctx.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), user.id)
    user.last_seen_at = nowIso()
    const expiresAt = issueSession(ctx.db, ctx.res, user, remember, ctx.config.secureCookies)
    audit(ctx.db, user.username, 'login', { ip })
    sendJson(ctx.res, 200, sessionBody(user, expiresAt, remember))
  })

  router.post('/api/v1/auth/register', async (ctx) => {
    const body = await readJsonBody(ctx.req)
    const inviteCode = String(body.inviteCode ?? '').trim().toUpperCase()
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const remember = body.remember !== false

    if (!inviteCode) throw new ApiError(400, 'invalid_input', '请填写邀请码。')
    if (!validUsername(username)) {
      throw new ApiError(400, 'invalid_input', '用户名需为 3–24 位小写字母、数字、下划线或短横线。')
    }
    if (!validPassword(password)) {
      throw new ApiError(400, 'invalid_input', '密码至少需要 8 个字符。')
    }

    const invite = ctx.db.prepare('SELECT * FROM invites WHERE code = ?').get(inviteCode)
    if (!invite) throw inviteFailure(404, 'invalid_invite', '这个邀请码不存在，请核对后重试。')
    if (invite.revoked_at) throw inviteFailure(403, 'invite_revoked', '这个邀请码已被停用。')
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      throw inviteFailure(410, 'invite_expired', '这个邀请码已过期。')
    }
    if (invite.used_count >= invite.max_uses) {
      throw inviteFailure(409, 'invite_exhausted', '这个邀请码的名额已经用完。')
    }
    const taken = ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (taken) throw new ApiError(409, 'username_taken', '这个用户名已经被使用。')

    // 事务内消耗名额并建号，保证并发注册不会超额。
    const passwordHash = await hashPasswordAsync(password)
    const userId = newUserId()
    const createdAt = nowIso()
    ctx.db.exec('BEGIN')
    try {
      const fresh = ctx.db.prepare('SELECT * FROM invites WHERE code = ?').get(inviteCode)
      if (!fresh || fresh.revoked_at || fresh.used_count >= fresh.max_uses) {
        throw inviteFailure(409, 'invite_exhausted', '这个邀请码的名额已经用完。')
      }
      if (fresh.expires_at && new Date(fresh.expires_at).getTime() <= Date.now()) throw inviteFailure(410, 'invite_expired', '这个邀请码已过期。')
      if (ctx.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new ApiError(409, 'username_taken', '这个用户名已经被使用。')
      ctx.db.prepare('UPDATE invites SET used_count = used_count + 1 WHERE code = ?').run(inviteCode)
      ctx.db
        .prepare(
          'INSERT INTO users (id, username, name, password_hash, role, status, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(userId, username, username, passwordHash, fresh.role === 'admin' ? 'admin' : 'member', 'active', createdAt, createdAt)
      ctx.db.exec('COMMIT')
    } catch (error) {
      ctx.db.exec('ROLLBACK')
      throw error
    }

    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    const expiresAt = issueSession(ctx.db, ctx.res, user, remember, ctx.config.secureCookies)
    audit(ctx.db, username, 'register', { invite: inviteCode })
    sendJson(ctx.res, 200, sessionBody(user, expiresAt, remember))
  })

  router.get('/api/v1/auth/me', async (ctx) => {
    const context = sessionUser(ctx.req, ctx.db)
    if (!context) throw new ApiError(401, 'unauthorized', '尚未登录或会话已过期。')
    sendJson(ctx.res, 200, {
      user: publicUser(context.user),
      expiresAt: context.session.expires_at,
      persistent: context.session.persistent === 1,
    })
  })

  router.post('/api/v1/auth/logout', async (ctx) => {
    const context = sessionUser(ctx.req, ctx.db)
    if (context) {
      ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(context.session.id)
      audit(ctx.db, context.user.username, 'logout')
    }
    clearSessionCookie(ctx.res, SESSION_COOKIE)
    ctx.res.statusCode = 204
    ctx.res.end()
  })
}
