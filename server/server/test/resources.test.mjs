import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { LoginThrottle, SlidingWindow, hashPassword, hashPasswordAsync, verifyPasswordAsync } from '../lib/security.mjs'
import { readBody } from '../lib/http.mjs'
import { startServer, buildConfig } from '../main.mjs'
import { pruneExpiredSessions } from '../lib/db.mjs'
import { newTokenSecret, sha256 } from '../lib/security.mjs'

test('limiter storage expires and fails closed at its capacity', () => {
  let now = 1000
  const login = new LoginThrottle({ maxEntries: 2, lockMs: 100, now: () => now })
  login.noteFailure('alice', 'ip'); login.noteFailure('bob', 'ip')
  assert.ok(login.lockedSeconds('charlie', 'ip') > 0)
  login.noteFailure('charlie', 'ip')
  assert.equal(login.attempts.size, 2)
  now += 101
  assert.equal(login.lockedSeconds('charlie', 'ip'), 0)
  assert.equal(login.attempts.size, 0)
  const uploads = new SlidingWindow(100, { maxEntries: 2, now: () => now })
  for (let i = 0; i < 100; i++) assert.equal(uploads.current('probe'+i), 0)
  assert.equal(uploads.events.size, 0)
  uploads.add('alice'); uploads.add('bob')
  assert.equal(uploads.current('charlie'), Infinity)
  assert.throws(() => uploads.add('charlie'), { status: 429 })
  now += 101
  assert.equal(uploads.current('charlie'), 0)
  assert.equal(uploads.events.size, 0)
})

test('async scrypt reads existing hashes, yields to timers, and limits concurrency', async () => {
  const old = hashPassword('resource-test-password')
  let yielded = false
  setImmediate(() => { yielded = true })
  const results = await Promise.allSettled([
    verifyPasswordAsync('resource-test-password', old),
    hashPasswordAsync('new-resource-password'),
    hashPasswordAsync('busy-resource-password'),
  ])
  assert.equal(yielded, true)
  assert.equal(results[0].value, true)
  assert.equal(results[1].status, 'fulfilled')
  assert.equal(results[2].reason.status, 503)
  assert.equal(await verifyPasswordAsync('new-resource-password', results[1].value), true)
  assert.equal(await verifyPasswordAsync('wrong-password', old), false)
})

function request(headers = {}) {
  const req = new EventEmitter()
  req.headers = headers
  req.resume = () => {}
  return req
}

test('body admission rejects oversize/concurrent uploads and releases aborted slots', async () => {
  await assert.rejects(readBody(request({ 'content-length': '100' }), 10), { status: 413 })
  const reqs = Array.from({ length: 4 }, () => request())
  const pending = reqs.map(req => readBody(req, 10).catch(error => error))
  await assert.rejects(readBody(request(), 10), { status: 503 })
  for (const req of reqs) req.emit('aborted')
  assert.ok((await Promise.all(pending)).every(error => error.code === 'request_aborted'))
  const fresh = request()
  const body = readBody(fresh, 10)
  fresh.emit('data', Buffer.from('abc')); fresh.emit('end')
  assert.equal((await body).toString(), 'abc')
  const chunked = request()
  const overflow = readBody(chunked, 2)
  chunked.emit('data', Buffer.from('abc'))
  await assert.rejects(overflow, { status: 413 })
})

test('static negotiation, revalidation, HEAD, invalid paths and stream disconnects', async () => {
  const work = mkdtempSync(join(tmpdir(), 'margin-resources-'))
  const dist = join(work, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  const body = 'const test = "resource test";\n'.repeat(100)
  writeFileSync(join(dist, 'index.html'), '<div id="app"></div>')
  writeFileSync(join(dist, 'assets/app.js'), body)
  writeFileSync(join(dist, 'assets/app.js.gz'), gzipSync(body))
  writeFileSync(join(dist, 'assets/app.js.br'), brotliCompressSync(body))
  const { server, db } = startServer({ config: { ...buildConfig({}), dbPath: join(work, 'db.sqlite'), distDir: dist, port: 0, adminPassword: 'resources-admin-password' } })
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const response = await fetch(base + '/assets/app.js', { headers: { 'accept-encoding': 'gzip;q=0.5, br;q=1' } })
    assert.equal(response.headers.get('content-encoding'), 'br')
    assert.equal(await response.text(), body)
    const etag = response.headers.get('etag')
    const cached = await fetch(base + '/assets/app.js', { headers: { 'accept-encoding': 'br', 'if-none-match': etag } })
    assert.equal(cached.status, 304)
    assert.equal(await cached.text(), '')
    const gzip = await fetch(base + '/assets/app.js', { headers: { 'accept-encoding': 'br;q=0, gzip' } })
    assert.equal(gzip.headers.get('content-encoding'), 'gzip')
    assert.equal(await gzip.text(), body)
    const identity = await fetch(base + '/assets/app.js', { headers: { 'accept-encoding': 'identity' } })
    assert.equal(identity.headers.get('content-encoding'), null)
    assert.equal(await identity.text(), body)
    const head = await fetch(base + '/assets/app.js', { method: 'HEAD', headers: { 'accept-encoding': 'br' } })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), response.headers.get('content-length'))
    assert.equal(await head.text(), '')
    assert.equal((await fetch(base + '/assets/app.js', { method: 'POST' })).status, 404)
    assert.equal((await fetch(base + '/%ZZ')).status, 404)
    assert.equal((await fetch(base + '/%2e%2e%5csecret')).status, 404)
    for (let i = 0; i < 5; i++) {
      const abort = new AbortController()
      const result = fetch(base + '/assets/app.js', { signal: abort.signal }).catch(() => {})
      abort.abort(); await result
    }
    assert.equal((await fetch(base + '/healthz')).status, 200)
    // Expired sessions are pruned without touching active sessions or share content.
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, 0)').run('expired', 'nobody', '2000-01-01', '2000-01-02')
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, 0)').run('active', 'nobody', '2000-01-01', '2099-01-02')
    assert.equal(pruneExpiredSessions(db), 1)
    assert.equal(db.prepare('SELECT id FROM sessions').get().id, 'active')
    assert.equal(buildConfig({}).seedInviteMaxUses, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
    rmSync(work, { recursive: true, force: true })
  }
})

test('plugin publish handler sends a native snapshot through the real host API', async () => {
  const { apply } = await import('../../../lib/index.js')
  const { default: events } = await import('../../scripts/demo-events.mjs')
  const work = mkdtempSync(join(tmpdir(), 'margin-plugin-host-'))
  const { server, db } = startServer({ config: { ...buildConfig({}), dbPath: join(work, 'test.db'), port: 0, adminPassword: 'plugin-test-password' } })
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const user = db.prepare('SELECT * FROM users').get()
    const secret = newTokenSecret()
    db.prepare('INSERT INTO tokens (id, owner_id, name, prefix, suffix, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('plugin-token', user.id, 'integration', secret.slice(0, 10), secret.slice(-4), sha256(secret), '["publish","manage"]', new Date().toISOString())
    const routes = []
    apply({
      effect(fn) { fn(); return () => {} },
      logger: { warn() {}, error() {}, info() {}, debug() {} },
      get(name) { if (name === 'sessionQuery') return { readSession: async () => ({ session: events[0], events, inheritedEventCount: 0 }) } },
      commands: { register() { return () => {} } },
      connection: { fetch: { register(route) { routes.push(route); return () => {} } } },
    }, {})
    const publish = routes.find(route => route.path === '/api/session.publishHost')
    const response = await publish.fetch(new Request('http://localhost/api/session.publishHost', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: events[0].id, host: base, token: secret }),
    }))
    const result = await response.json()
    assert.equal(response.status, 201, JSON.stringify(result))
    assert.ok(result.share.url.startsWith(base + '/s/'))
    const read = await fetch(base + '/api/v1/shares/' + result.share.id)
    assert.equal(read.status, 200)
    assert.equal((await read.json()).document.schemaVersion, 1)
    const download = await fetch(base + '/api/v1/shares/' + result.share.id + '/snapshot')
    const stored = await download.text()
    assert.equal(stored, JSON.stringify(JSON.parse(stored)))
    assert.equal(db.prepare('SELECT snapshot_bytes AS bytes FROM shares').get().bytes, Buffer.byteLength(stored))

    // New async registration must still consume a single-use invite exactly once.
    db.prepare('INSERT INTO invites (code, note, role, max_uses, used_count, created_at) VALUES (?, ?, ?, 1, 0, ?)')
      .run('MGN-RACE-TEST', 'synthetic race', 'member', new Date().toISOString())
    const register = username => fetch(base + '/api/v1/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteCode: 'MGN-RACE-TEST', username, password: 'race-test-password' }),
    }).then(async response => { await response.text(); return response.status })
    assert.deepEqual((await Promise.all([register('raceone'), register('racetwo')])).sort(), [200, 409])
    assert.equal(db.prepare('SELECT used_count FROM invites WHERE code = ?').get('MGN-RACE-TEST').used_count, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close(); rmSync(work, { recursive: true, force: true })
  }
})
