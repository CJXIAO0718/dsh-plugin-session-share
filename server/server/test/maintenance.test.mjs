import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { openDatabase } from '../lib/db.mjs'
import { pruneExpiredShares } from '../lib/maintenance.mjs'
import { startServer, buildConfig } from '../main.mjs'

const NOW = Date.parse('2026-10-26T00:00:00.000Z')
const DAY = 86400000
function add(db, id, expiry, { bytes = 12, status = 'published' } = {}) {
  db.prepare(`INSERT INTO shares (id, owner_id, title, created_at, status, expires_at, snapshot_bytes, json)
    VALUES (?, 'fixture-owner', 'Synthetic cleanup test', '2026-01-01T00:00:00.000Z', ?, ?, ?, '{}')`)
    .run(id, status, expiry === null ? null : new Date(expiry).toISOString(), bytes)
}
const ids = db => db.prepare('SELECT id FROM shares ORDER BY id').all().map(row => row.id)

test('seven-day boundary, revoked records and never-expiring records; quota and audit stay consistent', () => {
  const db = openDatabase(':memory:')
  try {
    add(db, 'old', NOW - 8 * DAY)
    add(db, 'exact', NOW - 7 * DAY)
    add(db, 'revoked-old', NOW - 8 * DAY, { status: 'revoked' })
    add(db, 'not-yet', NOW - 7 * DAY + 1)
    add(db, 'recent', NOW - DAY)
    add(db, 'future', NOW + DAY)
    add(db, 'permanent', null)
    assert.deepEqual(pruneExpiredShares(db, { now: NOW }), { deleted: 3, bytes: 36 })
    assert.deepEqual(ids(db), ['future', 'not-yet', 'permanent', 'recent'])
    assert.equal(db.prepare('SELECT SUM(snapshot_bytes) AS bytes FROM shares').get().bytes, 48)
    const entry = db.prepare('SELECT action, detail FROM audit').get()
    assert.equal(entry.action, 'maintenance.share_cleanup')
    assert.deepEqual(JSON.parse(entry.detail), { deleted:3, bytes:36, expiredBefore:'2026-10-19T00:00:00.000Z', graceDays:7 })
    assert.deepEqual(pruneExpiredShares(db, { now: NOW }), { deleted:0, bytes:0 })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 1)
  } finally { db.close() }
})

test('cleanup bounds both rows and bytes, and does not starve an oversized record', () => {
  const db = openDatabase(':memory:')
  try {
    add(db, 'oversized', NOW - 10 * DAY, { bytes:30 })
    add(db, 'small-a', NOW - 9 * DAY, { bytes:10 })
    add(db, 'small-b', NOW - 8 * DAY, { bytes:10 })
    assert.deepEqual(pruneExpiredShares(db, { now:NOW, maxBytes:16 }), { deleted:1, bytes:30 })
    assert.deepEqual(pruneExpiredShares(db, { now:NOW, maxBytes:16 }), { deleted:1, bytes:10 })
    assert.deepEqual(ids(db), ['small-b'])
    assert.deepEqual(pruneExpiredShares(db, { now:NOW, maxBytes:16 }), { deleted:1, bytes:10 })
    for (let i=0;i<4;i++) add(db,'row-'+i,NOW-8*DAY)
    assert.equal(pruneExpiredShares(db,{now:NOW,batchSize:2}).deleted,2)
    assert.equal(ids(db).length,2)
    assert.equal(pruneExpiredShares(db,{now:NOW,batchSize:2}).deleted,2)
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at, id LIMIT 25').all(new Date(NOW).toISOString())
    assert.ok(plan.some(row=>row.detail.includes('idx_shares_cleanup_expiry')))
  } finally { db.close() }
})

test('a failed deletion rolls back the entire batch and its audit entry', () => {
  const db = openDatabase(':memory:')
  try {
    add(db,'first',NOW-10*DAY)
    add(db,'blocked',NOW-9*DAY)
    db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON shares WHEN OLD.id = 'blocked' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
    assert.throws(()=>pruneExpiredShares(db,{now:NOW}), /synthetic failure/)
    assert.deepEqual(ids(db),['blocked','first'])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n,0)
  } finally { db.close() }
})

test('server startup runs cleanup and preserves live and permanent records', async () => {
  const db = openDatabase(':memory:')
  add(db,'old',Date.now()-8*DAY)
  add(db,'live',Date.now()+DAY)
  add(db,'permanent',null)
  const { server } = startServer({ db, skipBootstrap:true, config:{...buildConfig({}),port:0} })
  try {
    await once(server,'listening')
    assert.deepEqual(ids(db),['live','permanent'])
  } finally {
    await new Promise(resolve=>server.close(resolve))
    db.close()
  }
})
