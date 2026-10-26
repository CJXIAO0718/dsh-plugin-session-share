// 全量 API 集成测试：临时数据库 + 临时端口启动真实服务，覆盖认证、邀请码、
// 令牌、快照、个人分享、管理端、限流、配额、CSRF 与静态托管。
// 运行：npm run test:api
import { rmSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { openDatabase, metaSet } from '../lib/db.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..', '..')

const workDir = mkdtempSync(join(tmpdir(), 'margin-api-test-'))
const dbPath = join(workDir, 'test.db')

const ADMIN_PASSWORD = 'test-admin-pass-1'
const distDir = resolve(projectRoot, 'dist')

const { startServer } = await import('../main.mjs')

const config = {
  port: 0,
  host: '127.0.0.1',
  dbPath,
  distDir,
  baseUrl: '',
  secureCookies: false,
  adminUsername: 'admin',
  adminPassword: ADMIN_PASSWORD,
  seedDemo: false,
  loginLockoutMs: 600,
}

const { server, db } = startServer({ config })
await new Promise((resolvePromise) => server.on('listening', resolvePromise))
const address = server.address()
const base = `http://127.0.0.1:${address.port}`

let passed = 0
let failed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    console.error(`FAIL  ${name}`)
    console.error(`      ${error?.message ?? error}`)
  }
}

function jar() {
  const cookies = new Map()
  return {
    header() {
      return Array.from(cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ')
    },
    absorb(response) {
      const raw = response.headers.getSetCookie?.() ?? []
      for (const line of raw) {
        const [pair] = line.split(';')
        const index = pair.indexOf('=')
        if (index > 0) {
          const name = pair.slice(0, index).trim()
          const value = pair.slice(index + 1).trim()
          if (value === '') cookies.delete(name)
          else cookies.set(name, value)
        }
      }
    },
  }
}

async function call(method, path, { body, token, cookie, headers } = {}) {
  const init = {
    method,
    headers: { ...(headers ?? {}) },
    redirect: 'manual',
  }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    if (!init.headers['content-type']) init.headers['content-type'] = 'application/json'
  }
  if (token) init.headers.authorization = `Bearer ${token}`
  if (cookie) init.headers.cookie = cookie
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { response, json, text }
}

const demoBundle = readFileSync(join(projectRoot, 'public', 'demo', 'spectral.json'), 'utf8')

console.log(`\n[api-test] 服务: ${base}\n`)

// ---------- 静态与基础 ----------
await test('HEAD / 可达（插件 probe 用）', async () => {
  const { response } = await call('HEAD', '/')
  assert.equal(response.status, 200)
})

await test('GET / 返回 index.html', async () => {
  const { response, text } = await call('GET', '/')
  assert.equal(response.status, 200)
  assert.ok(text.includes('<div id="app">'))
})

await test('SPA 回退：GET /admin 直接打开返回 index.html', async () => {
  const { response, text } = await call('GET', '/admin')
  assert.equal(response.status, 200)
  assert.ok(text.includes('<div id="app">'))
})

await test('SPA 回退：GET /s/xxxx 同样返回 index.html', async () => {
  const { response } = await call('GET', '/s/whatever-id')
  assert.equal(response.status, 200)
})

await test('缺失的静态文件（带扩展名）保持 404', async () => {
  const { response } = await call('GET', '/demo/spectral.json')
  assert.equal(response.status, 404)
})

await test('openapi.yaml 可访问', async () => {
  const { response, text } = await call('GET', '/api/openapi.yaml')
  assert.equal(response.status, 200)
  assert.ok(text.includes('openapi'))
})

await test('健康检查 /healthz', async () => {
  const { response, json } = await call('GET', '/healthz')
  assert.equal(response.status, 200)
  assert.equal(json.ok, true)
})

await test('未知 API 返回 404 JSON', async () => {
  const { response, json } = await call('GET', '/api/v1/nothing')
  assert.equal(response.status, 404)
  assert.equal(json.error.code, 'not_found')
})

await test('演示邀请码在生产服务上不存在', async () => {
  const { response, json } = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: 'MARGIN-DEMO-2026', username: 'demo', password: 'password-1' },
  })
  assert.equal(response.status, 404)
  assert.equal(json.error.code, 'invalid_invite')
})

// ---------- 登录与会话 ----------
const adminJar = jar()

await test('演示账号 admin/margin-admin 无法登录（服务端不存演示账号）', async () => {
  const { response } = await call('POST', '/api/v1/auth/login', {
    body: { username: 'admin', password: 'margin-admin' },
  })
  assert.equal(response.status, 401)
})

await test('管理员登录成功并下发会话 Cookie', async () => {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD, remember: true }),
  })
  assert.equal(response.status, 200)
  adminJar.absorb(response)
  const setCookie = (response.headers.getSetCookie?.() ?? []).join('\n')
  assert.ok(setCookie.includes('HttpOnly'), 'Cookie 应为 HttpOnly')
  assert.ok(setCookie.includes('SameSite=Lax'), 'Cookie 应为 SameSite=Lax')
  assert.ok(adminJar.header().includes('margin_session='))
})

await test('GET /auth/me 返回管理员', async () => {
  const { response, json } = await call('GET', '/api/v1/auth/me', { cookie: adminJar.header() })
  assert.equal(response.status, 200)
  assert.equal(json.user.username, 'admin')
  assert.equal(json.user.role, 'admin')
})

await test('未登录 /auth/me 返回 401', async () => {
  const { response } = await call('GET', '/api/v1/auth/me')
  assert.equal(response.status, 401)
})

await test('全新数据库的默认策略 = 1 天 / 8 次发布 / 200 MB / 5 GB', async () => {
  const { response, json } = await call('GET', '/api/v1/admin/settings', { cookie: adminJar.header() })
  assert.equal(response.status, 200)
  assert.equal(json.settings.retentionDays, 1)
  assert.equal(json.settings.uploadsPerMinute, 8)
  assert.equal(json.settings.userQuotaMb, 200)
  assert.equal(json.settings.storageQuotaGb, 5)
  // 后续用例按 90 天 / 60 次发布的运行参数执行（避免多次发布触发限流）。
  const restore = await call('PUT', '/api/v1/admin/settings', {
    body: { retentionDays: 90, uploadsPerMinute: 60 },
    cookie: adminJar.header(),
  })
  assert.equal(restore.response.status, 200)
})

await test('伪造会话 Cookie 返回 401', async () => {
  const { response } = await call('GET', '/api/v1/auth/me', { cookie: 'margin_session=fake' })
  assert.equal(response.status, 401)
})

await test('跨站 Origin 的写请求被拒绝（CSRF）', async () => {
  const { response, json } = await call('POST', '/api/v1/auth/login', {
    body: { username: 'admin', password: ADMIN_PASSWORD },
    headers: { origin: 'http://evil.example' },
  })
  assert.equal(response.status, 403)
  assert.equal(json.error.code, 'forbidden')
})

// ---------- 邀请码与注册 ----------
let inviteSingle
let inviteMulti

await test('管理员生成单人邀请码', async () => {
  const { response, json } = await call('POST', '/api/v1/admin/invites', {
    body: { note: '单人批次', maxUses: 1, expiresInDays: 7 },
    cookie: adminJar.header(),
  })
  assert.equal(response.status, 200)
  inviteSingle = json.invite
  assert.match(inviteSingle.code, /^MGN-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.equal(inviteSingle.maxUses, 1)
})

await test('管理员生成多人邀请码', async () => {
  const { response, json } = await call('POST', '/api/v1/admin/invites', {
    body: { note: '多人批次', maxUses: 5, expiresInDays: 0 },
    cookie: adminJar.header(),
  })
  inviteMulti = json.invite
  assert.equal(response.status, 200)
  assert.equal(inviteMulti.expiresAt, null)
})

await test('成员不能生成邀请码（403）', async () => {
  const memberJar = jar()
  const response = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: inviteMulti.code, username: 'temp-a', password: 'password-1', remember: false }),
  })
  assert.equal(response.status, 200)
  memberJar.absorb(response)
  const { response: denied } = await call('POST', '/api/v1/admin/invites', {
    body: { note: 'x', maxUses: 1, expiresInDays: 1 },
    cookie: memberJar.header(),
  })
  assert.equal(denied.status, 403)
})

await test('未登录不能访问管理端（401）', async () => {
  const { response } = await call('GET', '/api/v1/admin/overview')
  assert.equal(response.status, 401)
})

const aliceJar = jar()
await test('用邀请码注册 alice 成功', async () => {
  const response = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: inviteSingle.code, username: 'alice', password: 'alice-pass-1', remember: true }),
  })
  assert.equal(response.status, 200)
  aliceJar.absorb(response)
  const body = await response.json()
  assert.equal(body.user.username, 'alice')
  assert.equal(body.user.name, 'alice')
  assert.equal(body.user.role, 'member')
})

await test('邀请码名额用尽后再注册返回 409', async () => {
  const { response, json } = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: inviteSingle.code, username: 'alice2', password: 'password-1' },
  })
  assert.equal(response.status, 409)
  assert.equal(json.error.code, 'invite_exhausted')
})

await test('重复用户名返回 409', async () => {
  const { response, json } = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: inviteMulti.code, username: 'alice', password: 'password-1' },
  })
  assert.equal(response.status, 409)
  assert.equal(json.error.code, 'username_taken')
})

await test('非法用户名与短密码返回 400', async () => {
  const badName = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: inviteMulti.code, username: 'Bad Name!', password: 'password-1' },
  })
  assert.equal(badName.response.status, 400)
  assert.equal(badName.json.error.code, 'invalid_input')

  const badPassword = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: inviteMulti.code, username: 'shortpw', password: 'short' },
  })
  assert.equal(badPassword.response.status, 400)
})

await test('被停用的邀请码返回 403', async () => {
  const created = await call('POST', '/api/v1/admin/invites', {
    body: { note: '将停用', maxUses: 3, expiresInDays: 7 },
    cookie: adminJar.header(),
  })
  await call('PATCH', `/api/v1/admin/invites/${created.json.invite.code}`, {
    body: { status: 'revoked' },
    cookie: adminJar.header(),
  })
  const { response, json } = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: created.json.invite.code, username: 'revokeduser', password: 'password-1' },
  })
  assert.equal(response.status, 403)
  assert.equal(json.error.code, 'invite_revoked')
})

await test('过期邀请码返回 410', async () => {
  db.prepare('INSERT INTO invites (code, note, role, max_uses, used_count, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, 0, ?, ?, NULL)')
    .run('MGN-OLD0-EXPI', '过期测试', 'member', 3, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
  const { response, json } = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: 'MGN-OLD0-EXPI', username: 'expireduser', password: 'password-1' },
  })
  assert.equal(response.status, 410)
  assert.equal(json.error.code, 'invite_expired')
})

// ---------- 登录失败限流 ----------
await test('连续 5 次错误密码后锁定 429，等待后恢复', async () => {
  for (let i = 1; i <= 4; i += 1) {
    const wrong = await call('POST', '/api/v1/auth/login', {
      body: { username: 'alice', password: 'wrong-password' },
    })
    assert.equal(wrong.response.status, 401)
    assert.ok(wrong.json.error.message.includes(`还可尝试 ${5 - i}`), `第 ${i} 次应提示剩余次数`)
  }
  const locked = await call('POST', '/api/v1/auth/login', {
    body: { username: 'alice', password: 'wrong-password' },
  })
  assert.equal(locked.response.status, 429)
  assert.equal(locked.json.error.code, 'rate_limited')
  assert.ok(Number(locked.response.headers.get('retry-after')) >= 1)
  const stillLocked = await call('POST', '/api/v1/auth/login', {
    body: { username: 'alice', password: 'alice-pass-1' },
  })
  assert.equal(stillLocked.response.status, 429)
  await new Promise((r) => setTimeout(r, 700))
  const recovered = await call('POST', '/api/v1/auth/login', {
    body: { username: 'alice', password: 'alice-pass-1' },
  })
  assert.equal(recovered.response.status, 200)
})

// ---------- 个人令牌 ----------
let aliceTokenSecret
let alicePublishOnlySecret

await test('alice 生成发布+管理令牌，明文只出现一次', async () => {
  const { response, json } = await call('POST', '/api/v1/tokens', {
    body: { name: '测试机', scopes: ['publish', 'manage'], expiresInDays: 0 },
    cookie: aliceJar.header(),
  })
  assert.equal(response.status, 200)
  assert.match(json.secret, /^mgn_tk_/)
  aliceTokenSecret = json.secret
  assert.equal(json.token.prefix, json.secret.slice(0, 14))
  assert.equal(json.token.suffix, json.secret.slice(-4))
})

await test('令牌列表只含前后缀，不含明文与哈希', async () => {
  const { response, json } = await call('GET', '/api/v1/tokens', { cookie: aliceJar.header() })
  assert.equal(response.status, 200)
  const raw = JSON.stringify(json)
  assert.ok(!raw.includes(aliceTokenSecret), '完整令牌不能出现在列表里')
  assert.ok(json.tokens.length >= 1)
  assert.ok(json.tokens[0].prefix.startsWith('mgn_tk_'))
})

await test('生成仅发布权限的令牌', async () => {
  const { json } = await call('POST', '/api/v1/tokens', {
    body: { name: '只发布', scopes: ['publish'], expiresInDays: 30 },
    cookie: aliceJar.header(),
  })
  alicePublishOnlySecret = json.secret
  assert.deepEqual(json.token.scopes, ['publish'])
})

await test('未登录不能管理令牌', async () => {
  const { response } = await call('GET', '/api/v1/tokens')
  assert.equal(response.status, 401)
})

// ---------- 快照发布与读取 ----------
let shareId

await test('无令牌发布返回 401', async () => {
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: demoBundle,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 401)
  assert.equal(json.error.code, 'unauthorized')
})

await test('错误令牌发布返回 401', async () => {
  const { response } = await call('POST', '/api/v1/shares', {
    body: demoBundle,
    token: 'mgn_tk_totally_invalid',
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 401)
})

await test('用令牌发布演示快照成功（201）', async () => {
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: demoBundle,
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 201, JSON.stringify(json))
  shareId = json.share.id
  assert.match(shareId, /^[a-z0-9]{10}$/)
  assert.equal(json.share.owner.username, 'alice')
  assert.equal(json.share.counts.turns, 3)
  assert.ok(json.share.snapshotBytes > 10000)
  assert.ok(json.share.url.includes(`/s/${shareId}`))
  assert.ok(Array.isArray(json.warnings))
})

await test('公开读取快照：无登录返回文档', async () => {
  const { response, json } = await call('GET', `/api/v1/shares/${shareId}`)
  assert.equal(response.status, 200)
  assert.equal(json.document.schemaVersion, 1)
  assert.equal(json.document.counts.turns, 3)
  assert.equal(json.share.visibility, 'unlisted')
  assert.equal(json.share.owner, undefined, '公开读取不返回 owner')
  assert.equal(json.share.canManage, false, '匿名读者没有管理入口')
  const ownerRead = await call('GET', `/api/v1/shares/${shareId}`, { cookie: aliceJar.header() })
  assert.equal(ownerRead.json.share.canManage, true, '发布者会话可管理自己的记录')
  const adminRead = await call('GET', `/api/v1/shares/${shareId}`, { cookie: adminJar.header() })
  assert.equal(adminRead.json.share.canManage, false, '管理员不管理他人的记录')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

await test('阅读计数随公开读取递增', async () => {
  await call('GET', `/api/v1/shares/${shareId}`)
  const { json } = await call('GET', '/api/v1/me/shares', { cookie: aliceJar.header() })
  const mine = json.shares.find((share) => share.id === shareId)
  assert.ok(mine.views >= 2, `views 应 >= 2，实际 ${mine.views}`)
})

await test('下载原始 bundle 带正确的头', async () => {
  const { response, text } = await call('GET', `/api/v1/shares/${shareId}/snapshot`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/vnd.dsh.session-share+json')
  assert.equal(
    response.headers.get('content-disposition'),
    `attachment; filename="session-share-${shareId}.json"`,
  )
  const bundle = JSON.parse(text)
  assert.equal(bundle.schema, 'dsh.session-share/v1')
  // 下载的 bundle 可重新发布
  const republish = await call('POST', '/api/v1/shares', {
    body: text,
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(republish.response.status, 201)
  await call('DELETE', `/api/v1/shares/${republish.json.share.id}`, { token: aliceTokenSecret })
})

await test('schema 不对返回 422 unsupported_schema', async () => {
  const bad = JSON.parse(demoBundle)
  bad.schema = 'dsh.session-share/v2'
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: JSON.stringify(bad),
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 422)
  assert.equal(json.error.code, 'unsupported_schema')
})

await test('请求体不是 JSON 返回 400 invalid_json', async () => {
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: 'not-json{{',
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 400)
  assert.equal(json.error.code, 'invalid_json')
})

await test('HTML 冒充快照返回 422 invalid_snapshot', async () => {
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: JSON.stringify({ schema: 'dsh.session-share/v1', document: '<html><body>hi</body></html>' }),
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 422)
  assert.equal(json.error.code, 'invalid_snapshot')
})

await test('计数与内容不一致返回 422 invalid_snapshot', async () => {
  const bad = JSON.parse(demoBundle)
  bad.document.counts.turns = 9
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: JSON.stringify(bad),
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 422)
  assert.equal(json.error.code, 'invalid_snapshot')
  assert.ok(json.error.details.some((line) => line.includes('turns')))
})

await test('超过单份上限返回 413 payload_too_large', async () => {
  await call('PUT', '/api/v1/admin/settings', {
    body: { maxSnapshotMb: 1 },
    cookie: adminJar.header(),
  })
  const big = JSON.parse(demoBundle)
  big.document.turns[0].messages[0].markdown = 'x'.repeat(2 * 1024 * 1024)
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: JSON.stringify(big),
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 413)
  assert.equal(json.error.code, 'payload_too_large')
  await call('PUT', '/api/v1/admin/settings', {
    body: { maxSnapshotMb: 8 },
    cookie: adminJar.header(),
  })
})

await test('发布节奏按发布次数计（12 条消息的快照只占 1 次），超限返回 429 + Retry-After', async () => {
  const rateJar = jar()
  const invite = await call('POST', '/api/v1/admin/invites', {
    body: { note: '限流测试', maxUses: 1, expiresInDays: 1 },
    cookie: adminJar.header(),
  })
  const registered = await call('POST', '/api/v1/auth/register', {
    body: { inviteCode: invite.json.invite.code, username: 'rate-user', password: 'password-1' },
  })
  assert.equal(registered.response.status, 200)
  rateJar.absorb(registered.response)
  const tokenCreated = await call('POST', '/api/v1/tokens', {
    body: { name: '限流', scopes: ['publish'], expiresInDays: 0 },
    cookie: rateJar.header(),
  })
  const rateToken = tokenCreated.json.secret

  await call('PUT', '/api/v1/admin/settings', {
    body: { uploadsPerMinute: 2 },
    cookie: adminJar.header(),
  })
  const headers = { 'content-type': 'application/vnd.dsh.session-share+json' }
  // demoBundle 含 12 条消息；若按消息条数计，一次发布就会超限。
  const first = await call('POST', '/api/v1/shares', { body: demoBundle, token: rateToken, headers })
  assert.equal(first.response.status, 201)
  const second = await call('POST', '/api/v1/shares', { body: demoBundle, token: rateToken, headers })
  assert.equal(second.response.status, 201)
  const third = await call('POST', '/api/v1/shares', { body: demoBundle, token: rateToken, headers })
  assert.equal(third.response.status, 429)
  assert.equal(third.json.error.code, 'rate_limited')
  assert.ok(Number(third.response.headers.get('retry-after')) >= 1)
  await call('PUT', '/api/v1/admin/settings', {
    body: { uploadsPerMinute: 60 },
    cookie: adminJar.header(),
  })
})

await test('个人配额用满返回 413 quota_exceeded', async () => {
  const settings = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get().value)
  settings.userQuotaMb = 0.01
  metaSet(db, 'settings', JSON.stringify(settings))
  const fresh = JSON.parse(demoBundle)
  fresh.document.source.sessionId = 'session-quota-test'
  const { response, json } = await call('POST', '/api/v1/shares', {
    body: JSON.stringify(fresh),
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(response.status, 413)
  assert.equal(json.error.code, 'quota_exceeded')
  settings.userQuotaMb = 200
  metaSet(db, 'settings', JSON.stringify(settings))
})

await test('不存在/已删除/已撤回/已过期的公开读取统一 404', async () => {
  const missing = await call('GET', '/api/v1/shares/zzzzzzzzzz')
  assert.equal(missing.response.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})

// ---------- 撤回 / 恢复 / 删除 ----------
await test('撤回后公开地址立即 404，恢复后可读', async () => {
  const revoke = await call('PATCH', `/api/v1/me/shares/${shareId}`, {
    body: { status: 'revoked' },
    cookie: aliceJar.header(),
  })
  assert.equal(revoke.response.status, 200)
  assert.equal(revoke.json.share.status, 'revoked')

  const blocked = await call('GET', `/api/v1/shares/${shareId}`)
  assert.equal(blocked.response.status, 404)
  const blockedSnapshot = await call('GET', `/api/v1/shares/${shareId}/snapshot`)
  assert.equal(blockedSnapshot.response.status, 404)

  const restore = await call('PATCH', `/api/v1/me/shares/${shareId}`, {
    body: { status: 'published' },
    cookie: aliceJar.header(),
  })
  assert.equal(restore.response.status, 200)
  const readable = await call('GET', `/api/v1/shares/${shareId}`)
  assert.equal(readable.response.status, 200)
})

await test('过期后公开地址 404（直接改库模拟时间流逝）', async () => {
  db.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', shareId)
  const { response } = await call('GET', `/api/v1/shares/${shareId}`)
  assert.equal(response.status, 404)
  db.prepare('UPDATE shares SET expires_at = NULL WHERE id = ?').run(shareId)
})

await test('仅发布权限的令牌不能删除记录（403）', async () => {
  const { response, json } = await call('DELETE', `/api/v1/shares/${shareId}`, {
    token: alicePublishOnlySecret,
  })
  assert.equal(response.status, 403)
  assert.equal(json.error.code, 'forbidden')
})

const bobJar = jar()
await test('他人令牌不能删除 alice 的记录（403）', async () => {
  const response = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: inviteMulti.code, username: 'bob', password: 'bob-pass-123', remember: false }),
  })
  assert.equal(response.status, 200)
  bobJar.absorb(response)
  const { json: tokenBody } = await call('POST', '/api/v1/tokens', {
    body: { name: 'bob token', scopes: ['publish', 'manage'], expiresInDays: 0 },
    cookie: bobJar.header(),
  })
  const { response: denied, json } = await call('DELETE', `/api/v1/shares/${shareId}`, {
    token: tokenBody.secret,
  })
  assert.equal(denied.status, 403)
  assert.equal(json.error.code, 'forbidden')
})

await test('发布者用会话 Cookie 也能删除自己的记录', async () => {
  const { response } = await call('DELETE', `/api/v1/shares/${shareId}`, { cookie: aliceJar.header() })
  assert.equal(response.status, 204)
  const gone = await call('GET', `/api/v1/shares/${shareId}`)
  assert.equal(gone.response.status, 404)
  // 再次删除 → 404
  const again = await call('DELETE', `/api/v1/shares/${shareId}`, { token: aliceTokenSecret })
  assert.equal(again.response.status, 404)
})

// ---------- 我的分享与策略 ----------
await test('me/shares 只返回自己的记录', async () => {
  const fresh = JSON.parse(demoBundle)
  fresh.document.source.sessionId = 'session-alice-2'
  const published = await call('POST', '/api/v1/shares', {
    body: JSON.stringify(fresh),
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(published.response.status, 201)

  const mine = await call('GET', '/api/v1/me/shares', { cookie: aliceJar.header() })
  assert.equal(mine.response.status, 200)
  assert.ok(mine.json.shares.length >= 1)
  assert.ok(mine.json.shares.every((share) => typeof share.canOpen === 'boolean'))

  const bobs = await call('GET', '/api/v1/me/shares', { cookie: bobJar.header() })
  assert.equal(bobs.json.shares.length, 0)
})

await test('me/policy 返回当前策略', async () => {
  const { response, json } = await call('GET', '/api/v1/me/policy', { cookie: aliceJar.header() })
  assert.equal(response.status, 200)
  assert.equal(json.settings.uploadsPerMinute, 60)
  assert.equal(json.settings.maxSnapshotMb, 8)
  assert.equal(json.settings.inviteOnly, true)
})

// ---------- 管理端 ----------
await test('管理概览包含统计、活动、最近与成员', async () => {
  const { response, json } = await call('GET', '/api/v1/admin/overview', { cookie: adminJar.header() })
  assert.equal(response.status, 200)
  const { totals, activity, recent, users } = json.overview
  assert.ok(totals.shares >= 1)
  assert.ok(totals.published >= 1)
  assert.ok(totals.users >= 3)
  assert.equal(activity.length, 7)
  assert.ok(recent.length >= 1)
  assert.ok(users.some((user) => user.username === 'alice'))
  assert.ok(users.some((user) => user.username === 'bob'))
})

await test('成员访问管理端返回 403', async () => {
  const { response } = await call('GET', '/api/v1/admin/overview', { cookie: aliceJar.header() })
  assert.equal(response.status, 403)
})

await test('停用令牌后发布立即 401', async () => {
  const { json } = await call('POST', '/api/v1/tokens', {
    body: { name: '将被停用', scopes: ['publish'], expiresInDays: 0 },
    cookie: aliceJar.header(),
  })
  const revoke = await call('DELETE', `/api/v1/tokens/${json.token.id}`, { cookie: aliceJar.header() })
  assert.equal(revoke.response.status, 204)
  const publish = await call('POST', '/api/v1/shares', {
    body: demoBundle,
    token: json.secret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  assert.equal(publish.response.status, 401)
})

await test('暂停成员：会话立即失效且无法登录；恢复后可登录', async () => {
  const users = await call('GET', '/api/v1/admin/users', { cookie: adminJar.header() })
  const bob = users.json.users.find((user) => user.username === 'bob')
  assert.ok(bob, '成员列表应包含 bob')

  const suspended = await call('PATCH', `/api/v1/admin/users/${bob.id}`, {
    body: { status: 'suspended' },
    cookie: adminJar.header(),
  })
  assert.equal(suspended.response.status, 200)
  assert.ok(suspended.json.users.find((user) => user.id === bob.id).status === 'suspended')

  const meAfter = await call('GET', '/api/v1/auth/me', { cookie: bobJar.header() })
  assert.equal(meAfter.response.status, 401, '暂停后既有会话应失效')

  const loginBlocked = await call('POST', '/api/v1/auth/login', {
    body: { username: 'bob', password: 'bob-pass-123' },
  })
  assert.equal(loginBlocked.response.status, 403)
  assert.equal(loginBlocked.json.error.code, 'account_suspended')

  await call('PATCH', `/api/v1/admin/users/${bob.id}`, {
    body: { status: 'active' },
    cookie: adminJar.header(),
  })
  const loginBack = await call('POST', '/api/v1/auth/login', {
    body: { username: 'bob', password: 'bob-pass-123' },
  })
  assert.equal(loginBack.response.status, 200)
})

await test('不能暂停自己（唯一管理员保护）', async () => {
  const users = await call('GET', '/api/v1/admin/users', { cookie: adminJar.header() })
  const admin = users.json.users.find((user) => user.username === 'admin')
  const { response } = await call('PATCH', `/api/v1/admin/users/${admin.id}`, {
    body: { status: 'suspended' },
    cookie: adminJar.header(),
  })
  assert.equal(response.status, 400)
})

await test('保存策略后 me/policy 同步，且保留期变化会重算到期时间', async () => {
  const published = await call('POST', '/api/v1/shares', {
    body: demoBundle,
    token: aliceTokenSecret,
    headers: { 'content-type': 'application/vnd.dsh.session-share+json' },
  })
  const id = published.json.share.id
  assert.equal(published.response.status, 201)
  const before = published.json.share.expiresAt
  assert.ok(before, '默认 90 天保留期应有 expiresAt')

  const saved = await call('PUT', '/api/v1/admin/settings', {
    body: { retentionDays: 30 },
    cookie: adminJar.header(),
  })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.json.settings.retentionDays, 30)

  const mine = await call('GET', '/api/v1/me/shares', { cookie: aliceJar.header() })
  const mine1 = mine.json.shares.find((share) => share.id === id)
  const beforeDate = new Date(before).getTime()
  const afterDate = new Date(mine1.expiresAt).getTime()
  assert.ok(afterDate < beforeDate, '保留期缩短后 expiresAt 应提前')

  const policy = await call('GET', '/api/v1/me/policy', { cookie: aliceJar.header() })
  assert.equal(policy.json.settings.retentionDays, 30)

  // 恢复默认，避免影响后续用例
  await call('PUT', '/api/v1/admin/settings', {
    body: { retentionDays: 90 },
    cookie: adminJar.header(),
  })
  await call('DELETE', `/api/v1/shares/${id}`, { token: aliceTokenSecret })
})

await test('邀请码列表与停用状态可查', async () => {
  const { response, json } = await call('GET', '/api/v1/admin/invites', { cookie: adminJar.header() })
  assert.equal(response.status, 200)
  const single = json.invites.find((invite) => invite.code === inviteSingle.code)
  assert.equal(single.usedCount, 1)
  assert.equal(single.maxUses, 1)
})

// ---------- 退出与审计 ----------
await test('退出后会话失效', async () => {
  const logout = await call('POST', '/api/v1/auth/logout', { cookie: bobJar.header() })
  assert.equal(logout.response.status, 204)
  const me = await call('GET', '/api/v1/auth/me', { cookie: bobJar.header() })
  assert.equal(me.response.status, 401)
})

await test('审计日志记录了关键动作且不含敏感值', async () => {
  const rows = db.prepare('SELECT actor, action FROM audit ORDER BY id').all()
  const actions = rows.map((row) => row.action)
  for (const expected of ['login', 'register', 'invite.create', 'invite.revoke', 'token.create', 'token.revoke', 'share.publish', 'share.revoke', 'share.restore', 'share.delete', 'user.suspend', 'user.activate', 'settings.save']) {
    assert.ok(actions.includes(expected), `审计应包含 ${expected}`)
  }
  const dump = JSON.stringify(rows)
  assert.ok(!dump.includes(ADMIN_PASSWORD))
  assert.ok(!dump.includes(aliceTokenSecret))
})

// ---------- 收尾 ----------
server.close()
db.close()
rmSync(workDir, { recursive: true, force: true })

console.log(`\n[api-test] 通过 ${passed} · 失败 ${failed}`)
if (failed > 0) {
  process.exit(1)
}
