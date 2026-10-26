import { API_BASE } from '../config'
import { adminBusy, adminOverviewRef } from './adminStore'
import type { AdminOverview, AdminUser, AdminUserStatus } from '../admin/types'
import type { HostSettings } from '../admin/settings'
import { hostSettings } from '../admin/settings'
import type { InviteCode } from '../auth/inviteTypes'
import type { AdminClient } from './adminClient'

interface ErrorBody {
  error?: { code?: string; message?: string }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      ...init,
    })
  } catch {
    throw new Error('暂时连不上服务器，请稍后再试。')
  }
  if (response.status === 204) return undefined as T
  const body = (await response.json().catch(() => null)) as (T & ErrorBody) | null
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录。')
    if (response.status === 403) throw new Error('只有管理员可以执行这个操作。')
    throw new Error(body?.error?.message ?? '操作没有完成，请稍后再试。')
  }
  return body as T
}

function syncSettings(settings: HostSettings | undefined): void {
  if (settings) hostSettings.value = { ...settings }
}

export class RemoteAdminClient implements AdminClient {
  readonly mode = 'remote' as const

  async overview(): Promise<AdminOverview> {
    adminBusy.value = true
    try {
      const body = await request<{ overview: AdminOverview }>('/admin/overview')
      adminOverviewRef.value = body.overview
      return body.overview
    } finally {
      adminBusy.value = false
    }
  }

  async listUsers(): Promise<AdminUser[]> {
    const body = await request<{ users: AdminUser[] }>('/admin/users')
    return body.users
  }

  async setUserStatus(id: string, status: AdminUserStatus): Promise<AdminUser[]> {
    adminBusy.value = true
    try {
      const body = await request<{ users: AdminUser[] }>(`/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      return body.users
    } finally {
      adminBusy.value = false
    }
  }

  async listInvites(): Promise<InviteCode[]> {
    const body = await request<{ invites: InviteCode[] }>('/admin/invites')
    return body.invites
  }

  async createInvite(input: {
    note: string
    maxUses: number
    expiresInDays: number
  }): Promise<InviteCode> {
    adminBusy.value = true
    try {
      const body = await request<{ invite: InviteCode }>('/admin/invites', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return body.invite
    } finally {
      adminBusy.value = false
    }
  }

  async revokeInvite(code: string): Promise<InviteCode> {
    adminBusy.value = true
    try {
      const body = await request<{ invite: InviteCode }>(`/admin/invites/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'revoked' }),
      })
      return body.invite
    } finally {
      adminBusy.value = false
    }
  }

  async getSettings(): Promise<HostSettings> {
    const body = await request<{ settings: HostSettings }>('/admin/settings')
    syncSettings(body.settings)
    return { ...body.settings }
  }

  async saveSettings(next: HostSettings): Promise<HostSettings> {
    adminBusy.value = true
    try {
      const body = await request<{ settings: HostSettings }>('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(next),
      })
      syncSettings(body.settings)
      return { ...body.settings }
    } finally {
      adminBusy.value = false
    }
  }
}
