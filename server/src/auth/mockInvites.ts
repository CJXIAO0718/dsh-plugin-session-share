import type { UserRole } from './types'
import type { InviteCode, InviteStatus } from './inviteTypes'
import { inviteStatus } from './inviteStatus'

export type { InviteCode, InviteStatus }
export { inviteStatus }

const INVITES_KEY = 'margin-invites'

function daysFromNow(days: number): string | null {
  if (days <= 0) return null
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

const seedInvites: InviteCode[] = [
  {
    code: 'MARGIN-DEMO-2026',
    note: '演示邀请码 · 可重复使用',
    role: 'member',
    maxUses: 999,
    usedCount: 12,
    createdAt: '2026-10-20T09:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    revokedAt: null,
  },
  {
    code: 'MGN-7Q2F-K9M4',
    note: '十月写作小组',
    role: 'member',
    maxUses: 5,
    usedCount: 3,
    createdAt: '2026-10-18T10:30:00.000Z',
    expiresAt: '2026-11-17T10:30:00.000Z',
    revokedAt: null,
  },
  {
    code: 'MGN-2D1E-40CA',
    note: '播客剪辑同事',
    role: 'member',
    maxUses: 3,
    usedCount: 3,
    createdAt: '2026-09-28T08:10:00.000Z',
    expiresAt: '2026-10-28T08:10:00.000Z',
    revokedAt: null,
  },
  {
    code: 'MGN-91E4-D0B7',
    note: '已停用的旧批次',
    role: 'member',
    maxUses: 5,
    usedCount: 2,
    createdAt: '2026-09-12T12:00:00.000Z',
    expiresAt: '2026-10-12T12:00:00.000Z',
    revokedAt: '2026-09-30T09:00:00.000Z',
  },
]

function clone(invite: InviteCode): InviteCode {
  return { ...invite }
}

function readInvites(): InviteCode[] {
  try {
    const raw = localStorage.getItem(INVITES_KEY)
    if (!raw) return seedInvites.map(clone)
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return seedInvites.map(clone)
    return value
      .filter((item): item is InviteCode => Boolean(item) && typeof item.code === 'string')
      .map(clone)
  } catch {
    return seedInvites.map(clone)
  }
}

let invites: InviteCode[] = readInvites()

function persist(): void {
  localStorage.setItem(INVITES_KEY, JSON.stringify(invites))
}

export function listInvites(): InviteCode[] {
  return invites.map(clone)
}

export function activeInviteCount(): number {
  return invites.filter((invite) => inviteStatus(invite) === 'active').length
}

function randomBlock(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

export function createInvite(input: {
  note: string
  maxUses: number
  expiresInDays: number
  role?: UserRole
}): InviteCode {
  let code = `MGN-${randomBlock()}-${randomBlock()}`
  while (invites.some((item) => item.code === code)) code = `MGN-${randomBlock()}-${randomBlock()}`
  const invite: InviteCode = {
    code,
    note: input.note.trim(),
    role: input.role ?? 'member',
    maxUses: Math.max(1, Math.round(input.maxUses)),
    usedCount: 0,
    createdAt: new Date().toISOString(),
    expiresAt: daysFromNow(input.expiresInDays),
    revokedAt: null,
  }
  invites = [invite, ...invites]
  persist()
  return clone(invite)
}

export function revokeInvite(code: string): InviteCode | null {
  const invite = invites.find((item) => item.code === code.toUpperCase())
  if (!invite) return null
  invite.revokedAt = new Date().toISOString()
  persist()
  return clone(invite)
}

export class InviteError extends Error {
  code: 'invite_not_found' | 'invite_exhausted' | 'invite_expired' | 'invite_revoked'

  constructor(code: InviteError['code'], message: string) {
    super(message)
    this.name = 'InviteError'
    this.code = code
  }
}

export function consumeInvite(rawCode: string): UserRole {
  const code = rawCode.trim().toUpperCase()
  const invite = invites.find((item) => item.code === code)
  if (!invite) throw new InviteError('invite_not_found', '这个邀请码不存在，请核对后重试。')
  const status = inviteStatus(invite)
  if (status === 'revoked') throw new InviteError('invite_revoked', '这个邀请码已被停用。')
  if (status === 'expired') throw new InviteError('invite_expired', '这个邀请码已过期。')
  if (status === 'exhausted') throw new InviteError('invite_exhausted', '这个邀请码的名额已经用完。')
  invite.usedCount += 1
  persist()
  return invite.role
}

export function findInvite(code: string): InviteCode | null {
  const invite = invites.find((item) => item.code === code.trim().toUpperCase())
  return invite ? clone(invite) : null
}
