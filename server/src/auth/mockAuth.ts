import {
  AuthError,
  type AuthClient,
  type AuthSession,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
  type UserRole,
} from './types'
import {
  addMockAccount,
  findMockAccount,
  findMockAccountById,
  toAuthUser,
  touchMockAccount,
  usernameTaken,
} from './mockAccounts'
import { consumeInvite, InviteError } from './mockInvites'

const SESSION_KEY = 'margin-auth-session'
const ATTEMPT_KEY = 'margin-auth-attempts'
const MAX_ATTEMPTS = 5
const LOCK_SECONDS = 30
const SESSION_HOURS = 12
const REMEMBER_DAYS = 7

export const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'margin-admin', role: 'admin' as UserRole, label: '管理员预览' },
  { username: 'reader', password: 'reader-demo', role: 'member' as UserRole, label: '读者预览' },
]

export const DEMO_INVITE = 'MARGIN-DEMO-2026'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function parseSession(raw: string | null): AuthSession | null {
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as AuthSession
    if (!session.user || !session.expiresAt) return null
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null
    return session
  } catch {
    return null
  }
}

function readStoredSession(): AuthSession | null {
  return parseSession(localStorage.getItem(SESSION_KEY)) ?? parseSession(sessionStorage.getItem(SESSION_KEY))
}

function clearStoredSession(): void {
  localStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(SESSION_KEY)
}

function storeSession(session: AuthSession): void {
  clearStoredSession()
  const storage = session.persistent ? localStorage : sessionStorage
  storage.setItem(SESSION_KEY, JSON.stringify(session))
}

interface AttemptState {
  username: string
  count: number
  lockedUntil: number
}

function readAttempts(): AttemptState {
  try {
    const raw = localStorage.getItem(ATTEMPT_KEY)
    if (!raw) return { username: '', count: 0, lockedUntil: 0 }
    const value = JSON.parse(raw) as AttemptState
    if (typeof value.count !== 'number') return { username: '', count: 0, lockedUntil: 0 }
    return value
  } catch {
    return { username: '', count: 0, lockedUntil: 0 }
  }
}

function writeAttempts(value: AttemptState): void {
  localStorage.setItem(ATTEMPT_KEY, JSON.stringify(value))
}

function sessionFor(user: AuthUser, remember: boolean): AuthSession {
  const lifetime = (remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * 60 * 60 * 1000
  return {
    user,
    expiresAt: new Date(Date.now() + lifetime).toISOString(),
    persistent: remember,
  }
}

function inviteFailure(error: unknown): AuthError | null {
  if (!(error instanceof InviteError)) return null
  switch (error.code) {
    case 'invite_expired':
      return new AuthError('invite_expired', error.message, 410)
    case 'invite_exhausted':
      return new AuthError('invite_exhausted', error.message, 409)
    case 'invite_revoked':
      return new AuthError('invite_revoked', error.message, 403)
    default:
      return new AuthError('invalid_invite', error.message, 404)
  }
}

export class MockAuthClient implements AuthClient {
  readonly mode = 'mock' as const

  async login(input: LoginInput): Promise<AuthSession> {
    await delay(620)

    const username = input.username.trim().toLowerCase()
    const attempts = readAttempts()
    const now = Date.now()

    if (attempts.lockedUntil > now) {
      const retryAfter = Math.ceil((attempts.lockedUntil - now) / 1000)
      throw new AuthError(
        'rate_limited',
        `尝试次数过多，请在 ${retryAfter} 秒后再试。`,
        429,
        retryAfter,
      )
    }

    const account = findMockAccount(username)
    if (!account || account.password !== input.password) {
      const count = attempts.username === username ? attempts.count + 1 : 1
      if (count >= MAX_ATTEMPTS) {
        writeAttempts({ username, count: 0, lockedUntil: now + LOCK_SECONDS * 1000 })
        throw new AuthError(
          'rate_limited',
          `连续 ${MAX_ATTEMPTS} 次未通过，入口锁定 ${LOCK_SECONDS} 秒。`,
          429,
          LOCK_SECONDS,
        )
      }
      writeAttempts({ username, count, lockedUntil: 0 })
      throw new AuthError(
        'invalid_credentials',
        `用户名或密码不正确。还可尝试 ${MAX_ATTEMPTS - count} 次。`,
        401,
      )
    }

    if (account.status !== 'active') {
      throw new AuthError('account_suspended', '这个账号已被暂停，请联系管理员。', 403)
    }

    localStorage.removeItem(ATTEMPT_KEY)
    touchMockAccount(account.id)

    const session = sessionFor(toAuthUser({ ...account, lastSeenAt: new Date().toISOString() }), input.remember)
    storeSession(session)
    return session
  }

  async register(input: RegisterInput): Promise<AuthSession> {
    await delay(720)

    const username = input.username.trim().toLowerCase()
    const code = input.inviteCode.trim()

    if (!code) throw new AuthError('invalid_input', '请填写邀请码。', 400)
    if (!/^[a-z0-9_-]{3,24}$/.test(username)) {
      throw new AuthError('invalid_input', '用户名需为 3–24 位小写字母、数字、下划线或短横线。', 400)
    }
    if (input.password.length < 8) {
      throw new AuthError('invalid_input', '密码至少需要 8 个字符。', 400)
    }
    if (usernameTaken(username)) {
      throw new AuthError('username_taken', '这个用户名已经被使用。', 409)
    }

    let role: UserRole
    try {
      role = consumeInvite(code)
    } catch (error) {
      const failure = inviteFailure(error)
      if (failure) throw failure
      throw new AuthError('invalid_invite', '邀请码无法核验。', 400)
    }

    const account = addMockAccount({ username, password: input.password, role })
    const session = sessionFor(toAuthUser(account), input.remember)
    storeSession(session)
    localStorage.removeItem(ATTEMPT_KEY)
    return session
  }

  async me(): Promise<AuthSession | null> {
    const session = readStoredSession()
    if (!session) {
      clearStoredSession()
      return null
    }
    const account = findMockAccountById(session.user.id)
    if (!account) {
      const fresh = findMockAccount(session.user.username)
      if (!fresh) {
        clearStoredSession()
        return null
      }
      if (fresh.status !== 'active') {
        clearStoredSession()
        return null
      }
      return { ...session, user: toAuthUser(fresh) }
    }
    if (account.status !== 'active') {
      clearStoredSession()
      return null
    }
    return { ...session, user: toAuthUser(account) }
  }

  async logout(): Promise<void> {
    await delay(180)
    clearStoredSession()
  }
}

export const authClient: AuthClient = new MockAuthClient()
