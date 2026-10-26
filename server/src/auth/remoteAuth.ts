import { API_BASE } from '../config'
import { AuthError, type AuthClient, type AuthSession } from './types'

interface AuthResponseBody {
  user?: AuthSession['user']
  expiresAt?: string
  persistent?: boolean
  error?: { code?: string; message?: string }
}

function networkFailure(): AuthError {
  return new AuthError('network', '暂时连不上服务器，请稍后再试。', 0)
}

function mapError(status: number, body: AuthResponseBody | null): AuthError {
  const code = body?.error?.code ?? 'unknown'
  const message = body?.error?.message ?? '请求没有完成，请稍后再试。'
  switch (code) {
    case 'invalid_credentials':
      return new AuthError('invalid_credentials', message, 401)
    case 'account_suspended':
      return new AuthError('account_suspended', message, 403)
    case 'rate_limited':
      return new AuthError('rate_limited', message, 429, 30)
    case 'invalid_invite':
      return new AuthError('invalid_invite', message, 404)
    case 'invite_expired':
      return new AuthError('invite_expired', message, 410)
    case 'invite_exhausted':
    case 'invite_revoked':
      return new AuthError(code as 'invite_exhausted' | 'invite_revoked', message, code === 'invite_revoked' ? 403 : 409)
    case 'username_taken':
      return new AuthError('username_taken', message, 409)
    case 'invalid_input':
    case 'invalid_json':
      return new AuthError('invalid_input', message, 400)
    default:
      return new AuthError('unknown', message, status)
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<AuthSession> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw networkFailure()
  }
  const parsed = (await response.json().catch(() => null)) as AuthResponseBody | null
  if (!response.ok) throw mapError(response.status, parsed)
  if (!parsed?.user || !parsed.expiresAt) throw new AuthError('unknown', '服务器响应不完整。', response.status)
  return {
    user: parsed.user,
    expiresAt: parsed.expiresAt,
    persistent: parsed.persistent === true,
  }
}

export class RemoteAuthClient implements AuthClient {
  readonly mode = 'remote' as const

  login(input: { username: string; password: string; remember: boolean }): Promise<AuthSession> {
    return post('/auth/login', input)
  }

  register(input: {
    inviteCode: string
    username: string
    password: string
    remember: boolean
  }): Promise<AuthSession> {
    return post('/auth/register', input)
  }

  async me(): Promise<AuthSession | null> {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
    } catch {
      // 网络失败按未登录处理，让路由守卫落到登录页。
      return null
    }
    if (response.status === 401) return null
    const parsed = (await response.json().catch(() => null)) as AuthResponseBody | null
    if (!response.ok || !parsed?.user || !parsed.expiresAt) return null
    return {
      user: parsed.user,
      expiresAt: parsed.expiresAt,
      persistent: parsed.persistent === true,
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      // 退出失败也清本地状态；下次打开页面会再试一次。
    }
  }
}

export const remoteAuthClient = new RemoteAuthClient()
