import { audit } from './db.mjs'

export const EXPIRED_SHARE_GRACE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** Delete only snapshots whose expiry is at least seven days in the past.
 * Never-expiring records are excluded. Metadata-only selection bounds each batch;
 * one oversized snapshot is allowed so it cannot block cleanup indefinitely.
 */
export function pruneExpiredShares(db, {
  now = Date.now(), batchSize = 25, maxBytes = 16 * 1024 * 1024,
} = {}) {
  const cutoff = new Date(now - EXPIRED_SHARE_GRACE_DAYS * DAY_MS).toISOString()
  const rows = db.prepare(`
    SELECT id, snapshot_bytes FROM shares
    WHERE expires_at IS NOT NULL AND expires_at <= ?
    ORDER BY expires_at, id LIMIT ?
  `).all(cutoff, batchSize)
  const batch = []
  let selectedBytes = 0
  for (const row of rows) {
    if (batch.length && selectedBytes + row.snapshot_bytes > maxBytes) break
    batch.push(row)
    selectedBytes += row.snapshot_bytes
    if (selectedBytes >= maxBytes) break
  }
  if (!batch.length) return { deleted: 0, bytes: 0 }

  let deleted = 0
  let bytes = 0
  const remove = db.prepare('DELETE FROM shares WHERE id = ? AND expires_at IS NOT NULL AND expires_at <= ?')
  db.exec('BEGIN')
  try {
    for (const row of batch) {
      const result = remove.run(row.id, cutoff)
      if (result.changes) { deleted += result.changes; bytes += row.snapshot_bytes }
    }
    if (deleted) audit(db, null, 'maintenance.share_cleanup', {
      deleted, bytes, expiredBefore: cutoff, graceDays: EXPIRED_SHARE_GRACE_DAYS,
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { deleted, bytes }
}
