import type { UserRole } from './types'

export interface InviteCode {
  code: string
  note: string
  role: UserRole
  maxUses: number
  usedCount: number
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
}

export type InviteStatus = 'active' | 'exhausted' | 'expired' | 'revoked'
