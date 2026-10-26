import { ref } from 'vue'
import type { AdminShare, ShareStatus } from '../admin/types'
import { expiryFor, hostSettings } from '../admin/settings'
import { API_BASE, REMOTE_MODE } from '../config'

export interface MyShare extends AdminShare {
  expiresAt: string | null
  expired: boolean
  canOpen: boolean
}

// mock 模式的示例记录：remote 构建不加载种子数据。
const shares = ref<AdminShare[]>([])
if (!REMOTE_MODE) {
  void import('../admin/mockData').then((module) => {
    shares.value = module.seedShares.map((item) => ({ ...item }))
  })
}

function asMyShare(share: AdminShare): MyShare {
  const expiresAt = expiryFor(share.createdAt)
  const expired = expiresAt !== null && new Date(expiresAt).getTime() <= Date.now()
  return {
    ...share,
    expiresAt,
    expired,
    canOpen: share.status === 'published' && !expired && share.id === 'demo-spectral',
  }
}

// ---- remote 模式：记录与状态都在服务端，本地只做缓存 ----

const remoteShares = ref<MyShare[]>([])
const remoteVersion = ref(0)
let remoteLoadPromise: Promise<void> | null = null
let remoteLoadedFor = ''

async function loadRemoteShares(): Promise<void> {
  const response = await fetch(`${API_BASE}/me/shares`, { credentials: 'include' })
  if (!response.ok) return
  const body = (await response.json()) as { shares?: MyShare[] }
  remoteShares.value = Array.isArray(body.shares) ? body.shares : []
  remoteVersion.value += 1
}

function ensureRemoteShares(owner: string): void {
  if (remoteLoadedFor === owner) return
  remoteLoadedFor = owner
  remoteLoadPromise = loadRemoteShares()
    .catch(() => {
      remoteLoadedFor = ''
    })
    .finally(() => {
      remoteLoadPromise = null
    })
}

/** 撤回/恢复后调用：重新拉取一次列表，保证与服务端一致。 */
export function refreshMyShares(): void {
  if (!REMOTE_MODE) return
  remoteLoadPromise = loadRemoteShares()
    .catch(() => {
      remoteLoadedFor = ''
    })
    .finally(() => {
      remoteLoadPromise = null
    })
}

export function listMyShares(owner: string): MyShare[] {
  if (REMOTE_MODE) {
    void remoteVersion.value
    if (owner) ensureRemoteShares(owner)
    return remoteShares.value.map((share) => ({ ...share }))
  }
  return shares.value
    .filter((share) => share.owner === owner)
    .map(asMyShare)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function setMyShareStatus(id: string, status: ShareStatus): void {
  if (REMOTE_MODE) {
    // 乐观更新本地缓存；请求结束后以服务端返回为准。
    remoteShares.value = remoteShares.value.map((share) =>
      share.id === id
        ? { ...share, status, canOpen: status === 'published' && !share.expired }
        : share,
    )
    remoteVersion.value += 1
    void fetch(`${API_BASE}/me/shares/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('failed')
        const body = (await response.json()) as { share?: MyShare }
        if (body.share) {
          remoteShares.value = remoteShares.value.map((share) =>
            share.id === id ? { ...body.share! } : share,
          )
          remoteVersion.value += 1
        }
      })
      .catch(() => {
        // 失败时回拉一次真实状态。
        remoteLoadPromise = null
        refreshMyShares()
      })
    return
  }
  const share = shares.value.find((item) => item.id === id)
  if (!share) return
  share.status = status
}

export function myShareRetentionLabel(): string {
  const days = hostSettings.value.retentionDays
  if (days <= 0) return '链接永久保留'
  return `链接保留 ${days} 天`
}
