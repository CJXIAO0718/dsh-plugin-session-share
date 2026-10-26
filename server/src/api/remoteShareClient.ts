import { API_BASE } from '../config'
import type { SnapshotDocument } from '../parser/types'
import {
  ShareClientError,
  shareFilename,
  type CreateShareInput,
  type CreateShareResult,
  type ShareClient,
  type ShareSnapshot,
  type ShareSummary,
} from './types'

interface ErrorBody {
  error?: { code?: string; message?: string; details?: string[] }
}

function toError(status: number, body: ErrorBody | null, fallback: string): ShareClientError {
  return new ShareClientError(
    body?.error?.code ?? 'unknown',
    body?.error?.message ?? fallback,
    status,
    body?.error?.details ?? [],
  )
}

/** 远程分享适配器：只读读取、快照下载、发布者删除；发布本身由 DSH 插件持令牌完成。 */
export class RemoteShareClient implements ShareClient {
  readonly mode = 'remote' as const

  async get(id: string): Promise<ShareSnapshot> {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/shares/${encodeURIComponent(id)}`, {
        credentials: 'include',
      })
    } catch {
      throw new ShareClientError('network', '暂时连不上托管服务。', 0)
    }
    const body = (await response.json().catch(() => null)) as
      | { share?: ShareSummary; document?: SnapshotDocument; error?: ErrorBody['error'] }
      | null
    if (!response.ok || !body?.share || !body.document) {
      throw toError(
        response.status,
        body as ErrorBody | null,
        response.status === 404 ? '没有找到这份会话存档。' : '读取这份存档时出错。',
      )
    }
    return { summary: body.share, document: body.document }
  }

  async snapshotJson(id: string): Promise<{ json: string; filename: string }> {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/shares/${encodeURIComponent(id)}/snapshot`, {
        credentials: 'include',
      })
    } catch {
      throw new ShareClientError('network', '暂时连不上托管服务。', 0)
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ErrorBody | null
      throw toError(response.status, body, '下载这份存档时出错。')
    }
    const json = await response.text()
    return { json, filename: shareFilename(id) }
  }

  async remove(id: string): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${API_BASE}/shares/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
    } catch {
      throw new ShareClientError('network', '暂时连不上托管服务。', 0)
    }
    if (response.status === 204) return
    const body = (await response.json().catch(() => null)) as ErrorBody | null
    if (response.status === 401) {
      throw new ShareClientError('unauthorized', '只有发布者可以删除这份记录。', 401)
    }
    throw toError(response.status, body, '删除这份记录时出错。')
  }

  async create(_input: CreateShareInput): Promise<CreateShareResult> {
    // 网页端不发布；发布由 DSH 插件持个人令牌调用 POST /api/v1/shares。
    throw new ShareClientError('unsupported', '发布由 DSH 插件完成，网页端只负责阅读与管理。', 400)
  }

  async list(): Promise<ShareSummary[]> {
    const response = await fetch(`${API_BASE}/me/shares`, { credentials: 'include' })
    if (!response.ok) return []
    const body = (await response.json().catch(() => null)) as { shares?: ShareSummary[] }
    return Array.isArray(body.shares) ? body.shares : []
  }

  async ensureDemo(): Promise<ShareSummary | null> {
    return null
  }
}

export const remoteShareClient = new RemoteShareClient()
