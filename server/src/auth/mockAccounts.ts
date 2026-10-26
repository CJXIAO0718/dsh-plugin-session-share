import type { AuthUser, UserRole, UserStatus } from './types'

export interface MockAccount extends AuthUser {
  password: string
  source: 'seed' | 'invite'
}

const ACCOUNTS_KEY = 'margin-mock-accounts'

const seedAccounts: MockAccount[] = [
  {
    id: 'user-admin',
    username: 'admin',
    password: 'margin-admin',
    name: '林岸',
    role: 'admin',
    status: 'active',
    createdAt: '2026-07-12T09:20:00.000Z',
    lastSeenAt: '2026-10-25T16:10:00.000Z',
    source: 'seed',
  },
  {
    id: 'user-reader',
    username: 'reader',
    password: 'reader-demo',
    name: '周迟',
    role: 'member',
    status: 'active',
    createdAt: '2026-09-03T13:40:00.000Z',
    lastSeenAt: '2026-10-24T11:05:00.000Z',
    source: 'seed',
  },
]

function clone(account: MockAccount): MockAccount {
  return { ...account }
}

function readAccounts(): MockAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (!raw) return seedAccounts.map(clone)
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return seedAccounts.map(clone)
    return value
      .filter((item): item is MockAccount => Boolean(item) && typeof item.username === 'string' && typeof item.password === 'string')
      .map(clone)
  } catch {
    return seedAccounts.map(clone)
  }
}

let accounts: MockAccount[] = readAccounts()

function persist(): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function listMockAccounts(): MockAccount[] {
  return accounts.map(clone)
}

export function findMockAccount(username: string): MockAccount | null {
  const normalized = username.trim().toLowerCase()
  const account = accounts.find((item) => item.username === normalized)
  return account ? clone(account) : null
}

export function findMockAccountById(id: string): MockAccount | null {
  const account = accounts.find((item) => item.id === id)
  return account ? clone(account) : null
}

export function usernameTaken(username: string): boolean {
  const normalized = username.trim().toLowerCase()
  return accounts.some((item) => item.username === normalized)
}

export function addMockAccount(input: {
  username: string
  password: string
  role: UserRole
}): MockAccount {
  const username = input.username.trim().toLowerCase()
  const account: MockAccount = {
    id: `user_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    username,
    password: input.password,
    name: username,
    role: input.role,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    source: 'invite',
  }
  accounts = [...accounts, account]
  persist()
  return clone(account)
}

export function setMockAccountStatus(id: string, status: UserStatus): MockAccount | null {
  const account = accounts.find((item) => item.id === id)
  if (!account) return null
  account.status = status
  persist()
  return clone(account)
}

export function touchMockAccount(id: string): void {
  const account = accounts.find((item) => item.id === id)
  if (!account) return
  account.lastSeenAt = new Date().toISOString()
  persist()
}

export function toAuthUser(account: MockAccount): AuthUser {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    role: account.role,
    status: account.status,
    createdAt: account.createdAt,
    lastSeenAt: account.lastSeenAt,
  }
}
