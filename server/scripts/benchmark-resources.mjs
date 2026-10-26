// Compare two app directories in isolated processes with identical synthetic data.
// node --expose-gc scripts/benchmark-resources.mjs <baseline-app> <candidate-app>
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const self = fileURLToPath(import.meta.url)
if (process.argv[2] === '--worker') {
  const root = resolve(process.argv[3])
  const load = file => import(pathToFileURL(join(root, file)).href)
  const { openDatabase, nowIso } = await load('server/lib/db.mjs')
  const { hashPassword } = await load('server/lib/security.mjs')
  const { createApp, buildConfig } = await load('server/main.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'margin-bench-'))
  const db = openDatabase(join(dir, 'bench.db'))
  const now = nowIso()
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('bench', 'benchadmin', 'benchadmin', hashPassword('benchmark-password'), 'admin', 'active', now, now)
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, 0)').run('bench-session', 'bench', now, '2099-01-01T00:00:00.000Z')
  const body = JSON.stringify({ document: { synthetic: 'x'.repeat(256 * 1024) } })
  const insert = db.prepare(`INSERT INTO shares (id, owner_id, title, created_at, snapshot_bytes, json) VALUES (?, 'bench', 'Synthetic resource fixture', ?, ?, ?)`)
  db.exec('BEGIN')
  for (let i = 0; i < 240; i++) insert.run('bench-'+i, now, Buffer.byteLength(body), body)
  db.exec('COMMIT')
  const server = createApp(db, { ...buildConfig({}), distDir: join(root, 'dist') })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  global.gc?.()
  process.send({ base: `http://127.0.0.1:${server.address().port}`, idleRss: process.memoryUsage().rss })
  process.on('message', async message => {
    if (message === 'metrics') process.send({ peakRss: process.resourceUsage().maxRSS * 1024, rss: process.memoryUsage().rss })
    if (message === 'stop') {
      await new Promise(resolve => server.close(resolve))
      db.close(); rmSync(dir, { recursive: true, force: true }); process.disconnect()
    }
  })
} else {
  const [baseline, candidate] = process.argv.slice(2)
  if (!baseline || !candidate) throw Error('Pass baseline and candidate app paths')
  const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]
  async function run(root) {
    const child = fork(self, ['--worker', resolve(root)], { execArgv: ['--expose-gc'], stdio: ['ignore','ignore','inherit','ipc'] })
    const [ready] = await once(child, 'message')
    async function measure(endpoint) {
      const times = []
      for (let i=0; i<5; i++) {
        const before = performance.now()
        const response = await fetch(ready.base + endpoint, { headers: { cookie: 'margin_session=bench-session' } })
        if (response.status !== 200) throw Error('Unexpected HTTP '+response.status)
        await response.arrayBuffer()
        times.push(performance.now()-before)
      }
      return +median(times).toFixed(2)
    }
    try {
      const overviewMedianMs = await measure('/api/v1/admin/overview')
      const mySharesMedianMs = await measure('/api/v1/me/shares')
      const health = []
      for (let i=0; i<3; i++) {
        const login = () => fetch(ready.base+'/api/v1/auth/login', { method: 'POST', body: JSON.stringify({username:'benchadmin', password:'benchmark-password'}), headers:{'content-type':'application/json'} }).then(async r => { if (r.status!==200) throw Error('Login '+r.status); await r.text() })
        const jobs = [login(),login()]
        await new Promise(resolve => setTimeout(resolve, 5))
        const before = performance.now()
        await (await fetch(ready.base+'/healthz')).text()
        health.push(performance.now()-before)
        await Promise.all(jobs)
      }
      child.send('metrics')
      const [metrics] = await once(child,'message')
      const assets = join(root,'dist/assets')
      const html = readFileSync(join(root,'dist/index.html'),'utf8')
      const entry = html.match(/src="\/assets\/([^\"]+\.js)"/)?.[1]
      const entryJsBytes = statSync(join(assets,entry)).size
      const home = readdirSync(assets).find(name => /^HomeView-.*\.js$/.test(name))
      const homeRouteJsBytes = entryJsBytes + (home ? statSync(join(assets,home)).size : 0)
      const fixture = JSON.parse(readFileSync(join(root,'public/demo/spectral.json'),'utf8'))
      return { idleRss:ready.idleRss, ...metrics, overviewMedianMs, mySharesMedianMs,
        healthDuringLoginMedianMs:+median(health).toFixed(2), entryJsBytes, homeRouteJsBytes,
        fixturePrettyBytes:Buffer.byteLength(JSON.stringify(fixture,null,2)), fixtureCompactBytes:Buffer.byteLength(JSON.stringify(fixture)) }
    } finally { child.send('stop'); await once(child,'exit') }
  }
  const results = { at: new Date().toISOString(), node: process.version, fixture: { shares:240, bodyBytesEach:262144 }, baseline: await run(resolve(baseline)), candidate: await run(resolve(candidate)) }
  console.log(JSON.stringify(results,null,2))
}
