export type TokenScope = 'publish' | 'manage'
export type TokenStatus = 'active' | 'revoked' | 'expired'

import { ref } from 'vue'
import { API_BASE, REMOTE_MODE } from '../config'

export const tokenVersion = ref(0)

export interface AccessToken {
  id: string
  name: string
  prefix: string
  suffix: string
  scopes: TokenScope[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

interface StoredToken extends AccessToken {
  ownerId: string
}

const TOKEN_KEY = 'margin-access-tokens'

interface TokenSeed extends Omit<StoredToken, 'ownerId'> {
  ownerId: string
}

const seedTokens: TokenSeed[] = [
  {
    id: 'tok_mac',
    ownerId: 'user-reader',
    name: 'MacBook · 本地 DSH',
    prefix: 'mgn_tk_7Q2F9K',
    suffix: 'e41c',
    scopes: ['publish', 'manage'],
    createdAt: '2026-10-18T09:20:00.000Z',
    lastUsedAt: '2026-10-26T01:14:00.000Z',
    expiresAt: null,
    revokedAt: null,
  },
  {
    id: 'tok_studio',
    ownerId: 'user-reader',
    name: '录音棚主机',
    prefix: 'mgn_tk_D91C2A',
    suffix: '7b05',
    scopes: ['publish'],
    createdAt: '2026-09-22T04:10:00.000Z',
    lastUsedAt: '2026-10-02T12:40:00.000Z',
    expiresAt: '2026-11-30T00:00:00.000Z',
    revokedAt: null,
  },
  {
    id: 'tok_admin',
    ownerId: 'user-admin',
    name: '办公室工作站',
    prefix: 'mgn_tk_8A4E1D',
    suffix: '30f2',
    scopes: ['publish', 'manage'],
    createdAt: '2026-08-04T11:05:00.000Z',
    lastUsedAt: '2026-10-24T09:31:00.000Z',
    expiresAt: null,
    revokedAt: null,
  },
]

function readTokens(): StoredToken[] {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return seedTokens.map((token) => ({ ...token }))
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return seedTokens.map((token) => ({ ...token }))
    return value.filter((item): item is StoredToken => Boolean(item) && typeof item.id === 'string')
  } catch {
    return seedTokens.map((token) => ({ ...token }))
  }
}

// mock 模式的示例令牌：remote 构建不加载种子数据。
let tokens: StoredToken[] = []
if (!REMOTE_MODE) {
  tokens = readTokens()
}

function persist(): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
}

function randomToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz'
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

export function tokenStatus(token: AccessToken, now = Date.now()): TokenStatus {
  if (token.revokedAt) return 'revoked'
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now) return 'expired'
  return 'active'
}

// ---- remote 模式：令牌存在服务端，本地只保留响应缓存 ----

const remoteTokens = ref<AccessToken[]>([])
let remoteLoadPromise: Promise<void> | null = null
let remoteLoadedFor = ''

async function apiRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  const body = (await response.json().catch(() => null)) as
    | { tokens?: AccessToken[]; token?: AccessToken; secret?: string; error?: { message?: string } }
    | null
  if (!response.ok) {
    throw new Error(body?.error?.message ?? '令牌服务暂时不可用，请稍后再试。')
  }
  return body
}

async function loadRemoteTokens(): Promise<void> {
  const body = (await apiRequest('/tokens')) as { tokens?: AccessToken[] }
  remoteTokens.value = Array.isArray(body.tokens) ? body.tokens : []
  tokenVersion.value += 1
}

function ensureRemoteTokens(ownerId: string): void {
  if (remoteLoadedFor === ownerId) return
  remoteLoadedFor = ownerId
  remoteLoadPromise = loadRemoteTokens()
    .catch(() => {
      remoteLoadedFor = ''
    })
    .finally(() => {
      remoteLoadPromise = null
    })
}

export function listTokens(ownerId: string): AccessToken[] {
  void tokenVersion.value
  if (REMOTE_MODE) {
    if (ownerId) ensureRemoteTokens(ownerId)
    return remoteTokens.value.map((token) => ({ ...token }))
  }
  return tokens
    .filter((token) => token.ownerId === ownerId)
    .map(({ ownerId: _ownerId, ...token }) => ({ ...token }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function createToken(
  ownerId: string,
  input: { name: string; scopes: TokenScope[]; expiresInDays: number },
): Promise<{ token: AccessToken; secret: string }> {
  if (REMOTE_MODE) {
    const body = (await apiRequest('/tokens', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        scopes: input.scopes.length ? input.scopes : ['publish'],
        expiresInDays: input.expiresInDays,
      }),
    })) as { token: AccessToken; secret: string }
    remoteTokens.value = [body.token, ...remoteTokens.value.filter((item) => item.id !== body.token.id)]
    tokenVersion.value += 1
    return { token: body.token, secret: body.secret }
  }
  const secret = `mgn_tk_${randomToken()}`
  const token: AccessToken = {
    id: `tok_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: input.name.trim() || '未命名令牌',
    prefix: secret.slice(0, 14),
    suffix: secret.slice(-4),
    scopes: input.scopes.length ? input.scopes : ['publish'],
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt:
      input.expiresInDays > 0
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
    revokedAt: null,
  }
  tokens = [{ ...token, ownerId }, ...tokens]
  persist()
  tokenVersion.value += 1
  return { token, secret }
}

export async function revokeToken(ownerId: string, id: string): Promise<void> {
  if (REMOTE_MODE) {
    await apiRequest(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
    const now = new Date().toISOString()
    remoteTokens.value = remoteTokens.value.map((token) =>
      token.id === id && !token.revokedAt ? { ...token, revokedAt: now } : token,
    )
    tokenVersion.value += 1
    return
  }
  const token = tokens.find((item) => item.ownerId === ownerId && item.id === id)
  if (!token) return
  token.revokedAt = new Date().toISOString()
  persist()
  tokenVersion.value += 1
}

export function maskToken(token: AccessToken): string {
  return `mgn_tk_••••••••${token.suffix}`
}

export function scopeLabel(scope: TokenScope): string {
  if (scope === 'publish') return '发布记录'
  return '管理记录'
}
