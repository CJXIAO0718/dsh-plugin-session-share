import type { ShareCounts, ShareSource, SnapshotDocument } from '../parser/types'

export type ShareVisibility = 'unlisted' | 'public'

export interface ShareSummary {
  id: string
  url: string
  title: string
  createdAt: string
  source: ShareSource
  counts: ShareCounts
  visibility: ShareVisibility
  expiresAt: string | null
  snapshotBytes: number
  demo?: boolean
}

export interface ShareSnapshot {
  summary: ShareSummary
  document: SnapshotDocument
}

export interface CreateShareInput {
  document: SnapshotDocument
  title?: string
}

export interface CreateShareResult {
  summary: ShareSummary
  warnings: string[]
}

export interface ShareClient {
  readonly mode: 'local' | 'remote'
  create(input: CreateShareInput): Promise<CreateShareResult>
  get(id: string): Promise<ShareSnapshot>
  list(): Promise<ShareSummary[]>
  remove(id: string): Promise<void>
  snapshotJson(id: string): Promise<{ json: string; filename: string }>
  ensureDemo(): Promise<ShareSummary | null>
}

export class ShareClientError extends Error {
  code: string
  status: number
  details: string[]

  constructor(code: string, message: string, status = 400, details: string[] = []) {
    super(message)
    this.name = 'ShareClientError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff >= 0 && diff < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(diff / 60000))
    return `${minutes} 分钟前`
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function shareFilename(id: string): string {
  return `session-share-${id}.json`
}
