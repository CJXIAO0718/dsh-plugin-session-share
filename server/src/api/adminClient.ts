import { computed } from 'vue'
import type { AdminOverview, AdminUser, AdminUserStatus } from '../admin/types'
import { DEFAULT_SETTINGS, type HostSettings } from '../admin/settings'
import type { InviteCode } from '../auth/inviteTypes'
import { adminBusy, adminOverview, adminOverviewRef } from './adminStore'
import { REMOTE_MODE } from '../config'

export interface AdminClient {
  readonly mode: 'mock' | 'remote'
  overview(): Promise<AdminOverview>
  listUsers(): Promise<AdminUser[]>
  setUserStatus(id: string, status: AdminUserStatus): Promise<AdminUser[]>
  listInvites(): Promise<InviteCode[]>
  createInvite(input: {
    note: string
    maxUses: number
    expiresInDays: number
  }): Promise<InviteCode>
  revokeInvite(code: string): Promise<InviteCode>
  getSettings(): Promise<HostSettings>
  saveSettings(next: HostSettings): Promise<HostSettings>
}

// 构建期决定 mock / remote；生产构建只加载 remote 适配器。
const USE_REMOTE = REMOTE_MODE

let clientPromise: Promise<AdminClient> | null = null

function loadClient(): Promise<AdminClient> {
  if (!clientPromise) {
    clientPromise = USE_REMOTE
      ? import('./remoteAdminClient').then((module) => new module.RemoteAdminClient())
      : import('./mockAdminClient').then((module) => module.mockAdminClient)
  }
  return clientPromise
}

/** 分发对象：按当前模式转发到对应实现；模式固定，类型与调用方契约不变。 */
class DispatchClient implements AdminClient {
  readonly mode = USE_REMOTE ? 'remote' : 'mock'

  overview(): Promise<AdminOverview> {
    return loadClient().then((client) => client.overview())
  }

  listUsers(): Promise<AdminUser[]> {
    return loadClient().then((client) => client.listUsers())
  }

  setUserStatus(id: string, status: AdminUserStatus): Promise<AdminUser[]> {
    return loadClient().then((client) => client.setUserStatus(id, status))
  }

  listInvites(): Promise<InviteCode[]> {
    return loadClient().then((client) => client.listInvites())
  }

  createInvite(input: { note: string; maxUses: number; expiresInDays: number }): Promise<InviteCode> {
    return loadClient().then((client) => client.createInvite(input))
  }

  revokeInvite(code: string): Promise<InviteCode> {
    return loadClient().then((client) => client.revokeInvite(code))
  }

  getSettings(): Promise<HostSettings> {
    return loadClient().then((client) => client.getSettings())
  }

  saveSettings(next: HostSettings): Promise<HostSettings> {
    return loadClient().then((client) => client.saveSettings(next))
  }
}

export const adminClient: AdminClient = new DispatchClient()
export { adminBusy, adminOverview, DEFAULT_SETTINGS }
export const adminShares = computed(() => adminOverviewRef.value.recent)
