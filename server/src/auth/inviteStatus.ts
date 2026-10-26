// 邀请码状态判定：纯逻辑，mock 与 remote 共用，不携带演示数据。
import type { InviteCode, InviteStatus } from './inviteTypes'

export function inviteStatus(invite: InviteCode, now = Date.now()): InviteStatus {
  if (invite.revokedAt) return 'revoked'
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= now) return 'expired'
  if (invite.usedCount >= invite.maxUses) return 'exhausted'
  return 'active'
}
