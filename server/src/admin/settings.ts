import { computed, ref } from 'vue'
import { API_BASE, REMOTE_MODE } from '../config'

export interface HostSettings {
  storageQuotaGb: number
  userQuotaMb: number
  maxSnapshotMb: number
  retentionDays: number
  uploadsPerMinute: number
  inviteOnly: boolean
  updatedAt: string
}

const SETTINGS_KEY = 'margin-host-settings'

// 部署默认策略：链接保留 1 天 · 每人每分钟 8 次发布 · 每人 200 MB · 全站 5 GB。
export const DEFAULT_SETTINGS: HostSettings = {
  storageQuotaGb: 5,
  userQuotaMb: 200,
  maxSnapshotMb: 8,
  retentionDays: 1,
  uploadsPerMinute: 8,
  inviteOnly: true,
  updatedAt: '2026-10-26T06:00:00.000Z',
}

export const RETENTION_OPTIONS = [
  { value: 1, label: '1 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 180, label: '180 天' },
  { value: 365, label: '1 年' },
  { value: 0, label: '永久' },
]

function readSettings(): HostSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const value = JSON.parse(raw) as Partial<HostSettings>
    return { ...DEFAULT_SETTINGS, ...value }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const hostSettings = ref<HostSettings>(readSettings())

export const storageQuotaBytes = computed(() => hostSettings.value.storageQuotaGb * 1024 * 1024 * 1024)
export const userQuotaBytes = computed(() => hostSettings.value.userQuotaMb * 1024 * 1024)

export function formatRetention(days: number): string {
  if (days <= 0) return '永久保留'
  if (days === 365) return '1 年'
  return `${days} 天`
}

export function saveHostSettings(next: HostSettings): HostSettings {
  const saved: HostSettings = { ...next, updatedAt: new Date().toISOString() }
  hostSettings.value = saved
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved))
  return saved
}

export function resetHostSettings(): HostSettings {
  localStorage.removeItem(SETTINGS_KEY)
  hostSettings.value = { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() }
  return hostSettings.value
}

export function expiryFor(createdAt: string): string | null {
  const days = hostSettings.value.retentionDays
  if (days <= 0) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

// 远程模式：站点策略以服务端为准。登录后（以及每次调用 refreshPolicy）拉取一次。
let policyLoaded = false

export async function refreshPolicy(): Promise<void> {
  if (!REMOTE_MODE) return
  try {
    const response = await fetch(`${API_BASE}/me/policy`, { credentials: 'include' })
    if (!response.ok) return
    const body = (await response.json()) as { settings?: Partial<HostSettings> }
    if (body.settings) {
      hostSettings.value = { ...DEFAULT_SETTINGS, ...body.settings }
      policyLoaded = true
    }
  } catch {
    // 网络失败时沿用当前值；下次登录或进页面会再拉。
  }
}

if (REMOTE_MODE) {
  void refreshPolicy()
}

export function policyReady(): boolean {
  return !REMOTE_MODE || policyLoaded
}
