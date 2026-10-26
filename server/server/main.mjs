// 边注托管服务：单进程 Node（无第三方依赖），SQLite 存储，同进程直出 dist/ 静态资源。
// 环境变量：
//   MARGIN_PORT            监听端口（默认 8787）
//   MARGIN_HOST            监听地址（默认 127.0.0.1；对外部署设 0.0.0.0 并挂反代）
//   MARGIN_DB_PATH         SQLite 文件（默认 <项目>/data/margin.db）
//   MARGIN_DIST_DIR        前端构建产物目录（默认 <项目>/dist）
//   MARGIN_BASE_URL        对外基地址，用于分享绝对链接（可选）
//   MARGIN_ADMIN_USERNAME  首位管理员用户名（默认 admin）
//   MARGIN_ADMIN_PASSWORD  首位管理员密码；缺省时自动生成并只在启动日志出现一次
//   MARGIN_SEED_DEMO=1     首次启动时种入演示快照 demo-spectral（本地联调用；生产勿开）
//   MARGIN_LOGIN_LOCKOUT_MS 登录锁定时长（默认 30000；测试可调小）
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, audit, nowIso, DEFAULTS, PROJECT_ROOT, pruneExpiredSessions } from './lib/db.mjs'
import { hashPassword, newUserId, newInviteCode, LoginThrottle, sameOriginOk } from './lib/security.mjs'
import { sendError, sendJson, requestHost } from './lib/http.mjs'
import { serveStatic, serveStaticFile } from './lib/static.mjs'
import { registerAuthRoutes } from './routes/auth.mjs'
import { registerTokenRoutes } from './routes/tokens.mjs'
import { registerShareRoutes } from './routes/shares.mjs'
import { registerMeRoutes } from './routes/me.mjs'
import { registerAdminRoutes } from './routes/admin.mjs'
import { pruneExpiredShares } from './lib/maintenance.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export function buildConfig(env = process.env) {
  const baseUrl = env.MARGIN_BASE_URL?.trim() || ''
  const secureCookies =
    env.MARGIN_SECURE_COOKIES === '1' || (baseUrl.startsWith('https://') && env.MARGIN_SECURE_COOKIES !== '0')
  return {
    port: Number(env.MARGIN_PORT) || 8787,
    host: env.MARGIN_HOST || '127.0.0.1',
    dbPath: env.MARGIN_DB_PATH || DEFAULTS.dbPath,
    distDir: resolve(env.MARGIN_DIST_DIR || resolve(here, '..', 'dist')),
    baseUrl,
    secureCookies,
    adminUsername: (env.MARGIN_ADMIN_USERNAME || 'admin').toLowerCase(),
    adminPassword: env.MARGIN_ADMIN_PASSWORD || '',
    seedInviteMaxUses: Math.min(9999, Math.max(0, Math.round(Number(env.MARGIN_SEED_INVITE_MAX_USES) || 0))),
    seedDemo: env.MARGIN_SEED_DEMO === '1',
    loginLockoutMs: Number(env.MARGIN_LOGIN_LOCKOUT_MS) || 30_000,
  }
}

export function createRouter() {
  const routes = []
  const router = {
    add(method, pattern, handler) {
      const keys = []
      const regex = new RegExp(
        '^' +
          pattern
            .split('/')
            .map((segment) => {
              if (segment.startsWith(':')) {
                keys.push(segment.slice(1))
                return '([^/]+)'
              }
              return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            })
            .join('/') +
          '$',
      )
      routes.push({ method, regex, keys, handler })
    },
    get: (pattern, handler) => router.add('GET', pattern, handler),
    post: (pattern, handler) => router.add('POST', pattern, handler),
    put: (pattern, handler) => router.add('PUT', pattern, handler),
    patch: (pattern, handler) => router.add('PATCH', pattern, handler),
    delete: (pattern, handler) => router.add('DELETE', pattern, handler),
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue
        const found = route.regex.exec(pathname)
        if (!found) continue
        const params = {}
        route.keys.forEach((key, index) => {
          params[key] = found[index + 1]
        })
        return { handler: route.handler, params }
      }
      return null
    },
  }
  return router
}

function createAdminUser(db, username, password) {
  const id = newUserId()
  const now = nowIso()
  db.prepare(
    'INSERT INTO users (id, username, name, password_hash, role, status, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, username, username, hashPassword(password), 'admin', 'active', now, now)
}

function createInviteWithUses(db, maxUses, note) {
  let code = newInviteCode()
  while (db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code)) code = newInviteCode()
  db.prepare(
    'INSERT INTO invites (code, note, role, max_uses, used_count, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, 0, ?, NULL, NULL)',
  ).run(code, note, 'member', maxUses, nowIso())
  return code
}

/**
 * 首次启动/日常引导：
 * - 数据库无用户时创建管理员（MARGIN_ADMIN_USERNAME / MARGIN_ADMIN_PASSWORD）；
 * - 若管理员用户名不存在但指定了密码，同样补建（env 驱动配置，幂等）；
 * - MARGIN_SEED_INVITE_MAX_USES：库内无邀请码时生成一枚大额邀请码；
 * - MARGIN_SEED_DEMO=1：种入演示快照。
 * 返回给启动日志用的信息。
 */
export function bootstrap(db, config) {
  const info = { adminPassword: null, demoSeeded: false, createdAdmin: false, adminAdded: false, seedInviteCode: null }

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (userCount === 0) {
    const password = config.adminPassword || generatePassword()
    createAdminUser(db, config.adminUsername, password)
    audit(db, config.adminUsername, 'bootstrap.admin', {})
    info.adminPassword = password
    info.createdAdmin = true
  } else {
    // 已有用户：按 env 幂等补建缺失的管理员（已存在则不动，避免重启覆盖密码）。
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(config.adminUsername)
    if (!existing && config.adminPassword) {
      createAdminUser(db, config.adminUsername, config.adminPassword)
      audit(db, config.adminUsername, 'bootstrap.admin', { provisioned: true })
      info.adminPassword = config.adminPassword
      info.adminAdded = true
    }
  }

  if (config.seedInviteMaxUses > 0) {
    // 幂等：库内没有同等及以上名额的可用邀请码时才生成。
    const eligible = db
      .prepare('SELECT COUNT(*) AS n FROM invites WHERE revoked_at IS NULL AND max_uses >= ?')
      .get(config.seedInviteMaxUses).n
    if (eligible === 0) {
      const code = createInviteWithUses(db, config.seedInviteMaxUses, '首批邀请')
      audit(db, config.adminUsername, 'invite.create', { code, maxUses: config.seedInviteMaxUses, seeded: true })
      info.seedInviteCode = code
    }
  }
  if (config.seedDemo) {
    const existing = db.prepare("SELECT 1 FROM shares WHERE id = 'demo-spectral'").get()
    const candidates = [
      resolve(config.distDir, 'demo', 'spectral.json'),
      resolve(PROJECT_ROOT, 'public', 'demo', 'spectral.json'),
    ]
    const demoPath = candidates.find((candidate) => existsSync(candidate))
    if (!existing && demoPath) {
      const json = readFileSync(demoPath, 'utf8')
      const bundle = JSON.parse(json)
      const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at ASC").get()
      const document = bundle.document
      const bytes = Buffer.byteLength(json, 'utf8')
      db.prepare(
        `INSERT INTO shares (
          id, owner_id, title, created_at, status, visibility, expires_at, snapshot_bytes,
          redactions, tools, turns, user_messages, context_messages, assistant_messages, tool_calls,
          source_generator, source_session_id, json, demo
        ) VALUES (?, ?, ?, ?, 'published', 'unlisted', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        'demo-spectral',
        admin.id,
        document.title,
        nowIso(),
        bytes,
        document.counts.redactions ?? null,
        document.counts.toolCalls ?? 0,
        document.counts.turns ?? 0,
        document.counts.userMessages ?? 0,
        document.counts.contextMessages ?? 0,
        document.counts.assistantMessages ?? 0,
        document.counts.toolCalls ?? 0,
        document.source?.generator ?? null,
        document.source?.sessionId ?? null,
        json,
      )
      info.demoSeeded = true
    }
  }
  return info
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(12)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

export function createApp(db, config) {
  const router = createRouter()
  registerAuthRoutes(router)
  registerTokenRoutes(router)
  registerShareRoutes(router)
  registerMeRoutes(router)
  registerAdminRoutes(router)

  const loginThrottle = new LoginThrottle({ lockMs: config.loginLockoutMs })

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (!res.headersSent) sendError(res, error)
      else res.destroy()
    })
  })

  async function handle(req, res) {
    const url = new URL(req.url, `http://${requestHost(req)}`)
    const pathname = url.pathname

    if (pathname === '/healthz') {
      sendJson(res, 200, { ok: true })
      return
    }

    // 公开契约文件：/api/openapi.yaml 从构建产物直出（与前端 /api 页面链接一致）。
    if (pathname === '/api/openapi.yaml') {
      if (await serveStaticFile(req, res, config.distDir, 'api/openapi.yaml')) return
      sendJson(res, 404, { error: { code: 'not_found', message: 'openapi.yaml 不在构建产物里。' } })
      return
    }

    if (pathname.startsWith('/api/')) {
      // CSRF：带 Origin 的写请求必须同源（浏览器 fetch 会带；插件/curl 不带则放行）。
      if (!['GET', 'HEAD'].includes(req.method) && !sameOriginOk(req, requestHost(req))) {
        sendJson(res, 403, { error: { code: 'forbidden', message: '跨站请求被拒绝。' } })
        return
      }
      const matched = router.match(req.method, pathname)
      if (!matched) {
        sendJson(res, 404, { error: { code: 'not_found', message: '接口不存在。' } })
        return
      }
      const ctx = { req, res, params: matched.params, db, config, loginThrottle }
      await matched.handler(ctx)
      return
    }

    if (await serveStatic(req, res, config.distDir)) return

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not Found')
  }

  return server
}

export function startServer(options = {}) {
  const config = options.config ?? buildConfig()
  const db = options.db ?? openDatabase(config.dbPath)
  const info = options.skipBootstrap ? { adminPassword: null } : bootstrap(db, config)
  const server = createApp(db, config)
  server.maxConnections = 128
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.timeout = 30_000
  server.keepAliveTimeout = 5_000
  const cleanup = () => {
    pruneExpiredSessions(db)
    const result = pruneExpiredShares(db)
    if (result.deleted) console.log(`[margin] expired-share cleanup: ${result.deleted} snapshots, ${result.bytes} bytes`)
  }
  cleanup()
  const maintenance = setInterval(() => {
    try { cleanup() } catch (error) { console.error('[margin] session cleanup failed:', error.message) }
  }, 60_000)
  maintenance.unref()
  server.once('close', () => clearInterval(maintenance))
  server.listen(config.port, config.host)
  return { server, db, config, info }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = buildConfig()
  const { server, db, info } = startServer({ config })
  let stopping = false
  function shutdown() {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000)
    deadline.unref()
    server.close(() => { clearTimeout(deadline); db.close() })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  server.on('listening', () => {
    console.log(`[margin] 边注托管服务已启动: http://${config.host}:${config.port}`)
    console.log(`[margin] 数据库: ${config.dbPath}`)
    console.log(`[margin] 静态目录: ${config.distDir}${existsSync(config.distDir) ? '' : '（不存在，先运行 npm run build:deploy）'}`)
    if (info.createdAdmin) {
      console.log(`[margin] 首位管理员已创建: ${config.adminUsername} / ${info.adminPassword}`)
      if (!config.adminPassword) {
        console.log('[margin] 请安全保存生成的密码；环境变量只在首次建号时生效。')
      }
    }
    if (info.adminAdded) {
      console.log(`[margin] 已按环境变量补建管理员: ${config.adminUsername}`)
    }
    if (info.seedInviteCode) {
      console.log(`[margin] 已生成首批邀请码: ${info.seedInviteCode}（${config.seedInviteMaxUses} 个名额，不过期）`)
    }
    if (info.demoSeeded) console.log('[margin] 已种入演示快照 demo-spectral（MARGIN_SEED_DEMO=1）')
  })
}
