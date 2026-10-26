// 本地预览模式的管理端数据：全部来自种子数据与 localStorage，不请求服务器。
import { ref } from 'vue'
import { seedActivity, seedShares, seedUsers } from '../admin/mockData'
import type { ActivityDay, AdminOverview, AdminShare, AdminUser, AdminUserStatus } from '../admin/types'
import { hostSettings, saveHostSettings, type HostSettings } from '../admin/settings'
import {
  createInvite as createInviteCode,
  listInvites as listInviteCodes,
  revokeInvite as revokeInviteCode,
  type InviteCode,
} from '../auth/mockInvites'
import { listMockAccounts, setMockAccountStatus } from '../auth/mockAccounts'
import { adminBusy, adminOverviewRef } from './adminStore'
import type { AdminClient } from './adminClient'

const shares = ref<AdminShare[]>(seedShares.map((item) => ({ ...item })))
const activity = ref<ActivityDay[]>(seedActivity.map((item) => ({ ...item })))
const statusOverrides = ref<Record<string, AdminUserStatus>>({})

function wait(ms = 320): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function shareCountFor(name: string): number {
  return shares.value.filter((item) => item.owner === name).length
}

function usersSnapshot(): AdminUser[] {
  const accounts = listMockAccounts()
  const byUsername = new Map(accounts.map((account) => [account.username, account]))
  const seeded = seedUsers.map((user) => {
    const account = byUsername.get(user.username)
    return {
      ...user,
      id: account?.id ?? user.id,
      name: account?.name ?? user.name,
      status: account?.status ?? statusOverrides.value[user.id] ?? user.status,
      createdAt: account?.createdAt ?? user.createdAt,
      lastSeenAt: account?.lastSeenAt ?? user.lastSeenAt,
      shareCount: shareCountFor(account?.name ?? user.name),
    }
  })
  const seededNames = new Set(seeded.map((user) => user.username))
  const registered = accounts
    .filter((account) => !seededNames.has(account.username))
    .map<AdminUser>((account) => ({
      id: account.id,
      name: account.name,
      username: account.username,
      role: account.role,
      status: account.status,
      createdAt: account.createdAt,
      lastSeenAt: account.lastSeenAt,
      shareCount: shareCountFor(account.name),
    }))
  return [...registered, ...seeded]
}

function overviewSnapshot(): AdminOverview {
  const published = shares.value.filter((item) => item.status === 'published')
  const users = usersSnapshot()
  const activeUsers = users.filter((user) => user.status === 'active')
  return {
    totals: {
      shares: shares.value.length,
      published: published.length,
      revoked: shares.value.length - published.length,
      users: users.length,
      activeUsers: activeUsers.length,
      storageBytes: shares.value.reduce((total, item) => total + item.snapshotBytes, 0),
      views: shares.value.reduce((total, item) => total + item.views, 0),
    },
    activity: activity.value.map((item) => ({ ...item })),
    recent: [...shares.value]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6),
    users,
  }
}

// 种子数据就绪后立即注入共享概览，保证概览页首屏有内容。
adminOverviewRef.value = overviewSnapshot()

export class MockAdminClient implements AdminClient {
  readonly mode = 'mock' as const

  async overview(): Promise<AdminOverview> {
    await wait(120)
    const value = overviewSnapshot()
    adminOverviewRef.value = value
    return value
  }

  async listUsers(): Promise<AdminUser[]> {
    await wait(140)
    return usersSnapshot()
  }

  async setUserStatus(id: string, status: AdminUserStatus): Promise<AdminUser[]> {
    adminBusy.value = true
    await wait(280)
    const updated = setMockAccountStatus(id, status)
    if (!updated) {
      statusOverrides.value = { ...statusOverrides.value, [id]: status }
    }
    adminOverviewRef.value = overviewSnapshot()
    adminBusy.value = false
    return usersSnapshot()
  }

  async listInvites(): Promise<InviteCode[]> {
    await wait(120)
    return listInviteCodes()
  }

  async createInvite(input: {
    note: string
    maxUses: number
    expiresInDays: number
  }): Promise<InviteCode> {
    adminBusy.value = true
    await wait(360)
    const invite = createInviteCode({ ...input, role: 'member' })
    adminBusy.value = false
    return invite
  }

  async revokeInvite(code: string): Promise<InviteCode> {
    adminBusy.value = true
    await wait(280)
    const invite = revokeInviteCode(code)
    adminBusy.value = false
    if (!invite) throw new Error('邀请码不存在')
    return invite
  }

  async getSettings(): Promise<HostSettings> {
    await wait(90)
    return { ...hostSettings.value }
  }

  async saveSettings(next: HostSettings): Promise<HostSettings> {
    adminBusy.value = true
    await wait(360)
    const saved = saveHostSettings(next)
    adminBusy.value = false
    return saved
  }
}

export const mockAdminClient = new MockAdminClient()
