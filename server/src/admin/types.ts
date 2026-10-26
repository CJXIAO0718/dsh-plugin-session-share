export type ShareStatus = 'published' | 'revoked'

export interface AdminShare {
  id: string
  title: string
  owner: string
  createdAt: string
  status: ShareStatus
  visibility: 'unlisted' | 'public'
  views: number
  snapshotBytes: number
  redactions: number
  tools: number
  url: string
}

export type AdminUserRole = 'admin' | 'member'
export type AdminUserStatus = 'active' | 'suspended'

export interface AdminUser {
  id: string
  name: string
  username: string
  role: AdminUserRole
  status: AdminUserStatus
  createdAt: string
  lastSeenAt: string
  shareCount: number
}

export interface ActivityDay {
  iso: string
  label: string
  count: number
}

export interface AdminTotals {
  shares: number
  published: number
  revoked: number
  users: number
  activeUsers: number
  storageBytes: number
  views: number
}

export interface AdminOverview {
  totals: AdminTotals
  activity: ActivityDay[]
  recent: AdminShare[]
  users: AdminUser[]
}
