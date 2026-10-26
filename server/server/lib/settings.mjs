// 站点策略：存 SQLite meta，字段与前端 src/admin/settings.ts 的 HostSettings 一致。
import { metaGet, metaSet, nowIso } from './db.mjs'

// 部署默认策略：链接保留 1 天 · 每人每分钟 8 次发布 · 每人 200 MB · 全站 5 GB。
export const DEFAULT_SETTINGS = {
  storageQuotaGb: 5,
  userQuotaMb: 200,
  maxSnapshotMb: 8,
  retentionDays: 1,
  uploadsPerMinute: 8,
  inviteOnly: true,
  updatedAt: '2026-10-26T06:00:00.000Z',
}

const NUMERIC_RANGES = {
  storageQuotaGb: [1, 1024],
  userQuotaMb: [32, 10240],
  maxSnapshotMb: [1, 64],
  retentionDays: [0, 3650],
  uploadsPerMinute: [1, 600],
}

export function loadSettings(db) {
  const raw = metaGet(db, 'settings')
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const value = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...value }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** 校验并夹紧数值范围；inviteOnly 恒为 true（当前产品只开放邀请码注册）。 */
export function sanitizeSettings(input, previous) {
  const next = { ...previous }
  for (const [key, [min, max]] of Object.entries(NUMERIC_RANGES)) {
    const value = Number(input[key])
    if (Number.isFinite(value)) next[key] = Math.min(max, Math.max(min, Math.round(value)))
  }
  next.inviteOnly = true
  return next
}

export function persistSettings(db, settings) {
  const saved = { ...settings, updatedAt: nowIso() }
  metaSet(db, 'settings', JSON.stringify(saved))
  return saved
}

/** 保留期变化时，按 created_at 重算所有未删除记录的到期时间。 */
export function recomputeExpiry(db) {
  const settings = loadSettings(db)
  const days = settings.retentionDays
  // One SQL update avoids allocating every record and issuing one write per row.
  return db.prepare(`UPDATE shares SET expires_at = CASE WHEN ? > 0
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || ? || ' days') ELSE NULL END
    WHERE deleted_at IS NULL`).run(days, days).changes
}

export function expiryFor(createdAt, retentionDays) {
  if (!retentionDays || retentionDays <= 0) return null
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return null
  return new Date(created + retentionDays * 24 * 60 * 60 * 1000).toISOString()
}

export function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false
  const time = new Date(expiresAt).getTime()
  return Number.isFinite(time) && time <= now
}
