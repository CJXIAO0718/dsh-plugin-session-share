// 密码哈希、随机 ID、登录限流与 Origin 校验。全部使用 node:crypto，无第三方依赖。
import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { ApiError } from './http.mjs'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const derive = promisify(scrypt)
let activeHashes = 0

// No unbounded worker queue: two scrypt jobs use about 32 MiB working memory.
async function passwordJob(fn) {
  if (activeHashes >= 2) throw new ApiError(503, 'server_busy', '登录服务繁忙，请稍后重试。', null, { 'Retry-After': '1' })
  activeHashes += 1
  try { return await fn() } finally { activeHashes -= 1 }
}

export async function hashPasswordAsync(password) {
  return passwordJob(async () => {
    const salt = randomBytes(16)
    const key = await derive(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`
  })
}

export async function verifyPasswordAsync(password, stored) {
  return passwordJob(async () => {
    try {
      const [kind, n, r, p, saltB64, hashB64] = String(stored).split('$')
      if (kind !== 'scrypt' || +n !== SCRYPT_N || +r !== SCRYPT_R || +p !== SCRYPT_P) return false
      const expected = Buffer.from(hashB64, 'base64')
      if (expected.length !== KEY_LEN) return false
      const actual = await derive(password, Buffer.from(saltB64, 'base64'), KEY_LEN, { N: +n, r: +r, p: +p })
      return timingSafeEqual(actual, expected)
    } catch { return false }
  })
}

/** 用 scrypt（内存困难哈希）生成可存储的密码记录，格式 `scrypt$N$r$p$salt$hash`。 */
export function hashPassword(password) {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`
}

/** 常数时间比对密码与存储记录；记录格式不对时按错误处理，不抛异常细节。 */
export function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, n, r, p, saltB64, hashB64] = parts
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz'

function fromAlphabet(alphabet, length) {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

/** 分享 ID：10 位小写不可枚举字母数字，与前端 localClient 的形态一致。 */
export function newShareId() {
  return fromAlphabet(ID_ALPHABET, 10)
}

/** 邀请码：MGN-XXXX-XXXX，与前端 mockInvites 的形态一致。 */
export function newInviteCode() {
  return `MGN-${fromAlphabet(CODE_ALPHABET, 4)}-${fromAlphabet(CODE_ALPHABET, 4)}`
}

/** 个人访问令牌明文；服务端只保存其 SHA-256。 */
export function newTokenSecret() {
  return `mgn_tk_${fromAlphabet(TOKEN_ALPHABET, 40)}`
}

export function newSessionId() {
  return randomBytes(32).toString('base64url')
}

export function newUserId() {
  return `usr_${fromAlphabet(ID_ALPHABET, 12)}`
}

export function newTokenId() {
  return `tok_${fromAlphabet(ID_ALPHABET, 12)}`
}

const USERNAME_RE = /^[a-z0-9_-]{3,24}$/

export function validUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username)
}

export function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 256
}

/**
 * 登录失败限流：同一 用户名+IP 连续失败 MAX 次后锁定 lockMs。
 * 内存实现，进程重启即清空；与前端 30 秒倒计时一致（可用 MARGIN_LOGIN_LOCKOUT_MS 调短做测试）。
 */
export class LoginThrottle {
  constructor({ maxAttempts = 5, lockMs = 30_000, maxEntries = 10_000, now = Date.now } = {}) {
    this.maxAttempts = maxAttempts
    this.lockMs = lockMs
    this.attempts = new Map()
    this.maxEntries = maxEntries
    this.now = now
    this.nextSweep = 0
  }

  sweep() {
    const now = this.now()
    if (now < this.nextSweep) return
    for (const [key, entry] of this.attempts) if (entry.expiresAt <= now) this.attempts.delete(key)
    this.nextSweep = now + Math.min(this.lockMs, 60_000)
  }

  key(username, ip) {
    return `${String(username).toLowerCase()}|${ip}`
  }

  /** @returns {number} 剩余锁定秒数；0 表示未锁定。 */
  lockedSeconds(username, ip) {
    this.sweep()
    const entry = this.attempts.get(this.key(username, ip))
    if (!entry && this.attempts.size >= this.maxEntries) return Math.ceil(this.lockMs / 1000)
    if (!entry || entry.lockedUntil <= this.now()) return 0
    return Math.ceil((entry.lockedUntil - this.now()) / 1000)
  }

  /** @returns {{remaining:number}} 记一次失败后还剩的尝试次数；触发锁定时为 0。 */
  noteFailure(username, ip) {
    this.sweep()
    const key = this.key(username, ip)
    const previous = this.attempts.get(key)
    if (!previous && this.attempts.size >= this.maxEntries) return { remaining: 0 }
    const entry = previous && previous.expiresAt > this.now() ? previous : { count: 0, lockedUntil: 0 }
    entry.expiresAt = this.now() + this.lockMs
    entry.count += 1
    const remaining = Math.max(0, this.maxAttempts - entry.count)
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = this.now() + this.lockMs
      entry.count = 0
    }
    this.attempts.set(key, entry)
    return { remaining }
  }

  reset(username, ip) {
    this.attempts.delete(this.key(username, ip))
  }
}

/** 每用户滑动窗口限流，用于发布节奏（按发布次数计，每次发布记 1）。 */
export class SlidingWindow {
  constructor(windowMs = 60_000, { maxEntries = 10_000, now = Date.now } = {}) {
    this.windowMs = windowMs
    this.events = new Map()
    this.maxEntries = maxEntries
    this.now = now
    this.nextSweep = 0
  }

  sweep() {
    const now = this.now()
    if (now < this.nextSweep) return
    for (const [key, list] of this.events) if (!list.length || now - list.at(-1) >= this.windowMs) this.events.delete(key)
    this.nextSweep = now + this.windowMs
  }

  /** @returns 当前窗口内的发布次数。 */
  current(key) {
    this.sweep()
    const now = this.now()
    const list = (this.events.get(key) ?? []).filter((at) => now - at < this.windowMs)
    if (list.length) this.events.set(key, list)
    else this.events.delete(key)
    if (!list.length && this.events.size >= this.maxEntries) return Infinity
    return list.length
  }

  /** @returns 下一次可用的等待秒数。 */
  retryAfterSeconds(key) {
    const list = this.events.get(key) ?? []
    if (!list.length) return Math.ceil(this.windowMs / 1000)
    const oldest = list[0]
    return Math.max(1, Math.ceil((this.windowMs - (this.now() - oldest)) / 1000))
  }

  add(key) {
    this.sweep()
    if (!this.events.has(key) && this.events.size >= this.maxEntries) throw new ApiError(429, 'rate_limited', '发布服务繁忙，请稍后重试。')
    const now = this.now()
    const list = (this.events.get(key) ?? []).filter((at) => now - at < this.windowMs)
    list.push(now)
    this.events.set(key, list)
  }
}

/**
 * CSRF：浏览器发起的带会话 Cookie 写请求必须携带同源 Origin/Referer。
 * Bearer 令牌请求没有 Cookie，不受影响；无 Origin 的非浏览器客户端（插件、curl）放行。
 */
export function sameOriginOk(req, host) {
  const origin = req.headers.origin
  if (!origin) {
    const referer = req.headers.referer
    if (!referer) return true
    try {
      return new URL(referer).host === host
    } catch {
      return false
    }
  }
  if (origin === 'null') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
