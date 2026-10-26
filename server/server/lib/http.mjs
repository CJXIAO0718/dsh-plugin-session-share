// HTTP 基础设施：JSON 读写、Cookie、统一错误响应与安全头。
import { SnapshotError } from './validate.mjs'

export const JSON_TYPE = 'application/json; charset=utf-8'
export const SNAPSHOT_TYPE = 'application/vnd.dsh.session-share+json'

export class ApiError extends Error {
  constructor(status, code, message, details = null, extraHeaders = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.extraHeaders = extraHeaders
  }
}

function baseHeaders(res, extra = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'no-store')
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined) res.setHeader(key, value)
  }
}

export function sendJson(res, status, body, extra = {}) {
  baseHeaders(res, extra)
  res.statusCode = status
  res.setHeader('Content-Type', JSON_TYPE)
  res.end(JSON.stringify(body))
}

export function sendError(res, error) {
  if (error instanceof SnapshotError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, details: error.details },
    })
    return
  }
  if (error instanceof ApiError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    }, error.extraHeaders ?? undefined)
    return
  }
  console.error('[margin] unhandled error:', error)
  sendJson(res, 500, { error: { code: 'internal', message: '服务内部错误，请稍后再试。' } })
}

export function notFound(res) {
  sendJson(res, 404, { error: { code: 'not_found', message: '没有找到这份会话存档。' } })
}

/** 读取请求体，限制最大字节数；超限时排水剩余数据并抛 413，不掐断连接。 */
let activeBodies = 0
const MAX_BODY_READERS = 4

export function readBody(req, limitBytes) {
  const length = Number(req.headers['content-length'])
  if (length > limitBytes) {
    req.resume()
    return Promise.reject(new ApiError(413, 'payload_too_large', '请求体超过大小上限。', null, { Connection: 'close' }))
  }
  if (activeBodies >= MAX_BODY_READERS) {
    req.resume()
    return Promise.reject(new ApiError(503, 'server_busy', '上传服务繁忙，请稍后重试。', null, { 'Retry-After': '1', Connection: 'close' }))
  }
  activeBodies += 1
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let done = false
    function finish(error, value) {
      if (done) return
      done = true
      activeBodies -= 1
      chunks.length = 0
      if (error) reject(error)
      else resolve(value)
    }
    req.on('data', (chunk) => {
      if (done) return
      total += chunk.length
      if (total > limitBytes) {
        finish(new ApiError(413, 'payload_too_large', '请求体超过大小上限。', null, { Connection: 'close' }))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      finish(null, Buffer.concat(chunks, total))
    })
    req.on('error', (error) => {
      if (done) return
      finish(error)
    })
    req.on('aborted', () => finish(new ApiError(400, 'request_aborted', '上传已中断。')))
  })
}

export async function readJsonBody(req, limitBytes = 64 * 1024) {
  const buffer = await readBody(req, limitBytes)
  if (!buffer.length) return {}
  try {
    const value = JSON.parse(buffer.toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'invalid_json', '请求体必须是 JSON 对象。')
    }
    return value
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'invalid_json', '请求体不是合法 JSON。')
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

/** 会话 Cookie：HttpOnly + SameSite=Lax；https 环境加 Secure。 */
export function setSessionCookie(res, name, value, { maxAgeSeconds, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (secure) parts.push('Secure')
  if (maxAgeSeconds !== null && maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`)
  const previous = res.getHeader('Set-Cookie')
  const list = previous ? (Array.isArray(previous) ? previous : [String(previous)]) : []
  list.push(parts.join('; '))
  res.setHeader('Set-Cookie', list)
}

export function clearSessionCookie(res, name) {
  setSessionCookie(res, name, '', { maxAgeSeconds: 0, secure: false })
}

export function requestHost(req) {
  const forwarded = req.headers['x-forwarded-host']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.headers.host ?? 'localhost'
}

export function requestProto(req, explicitBase) {
  if (explicitBase) {
    try {
      return new URL(explicitBase).protocol.replace(':', '')
    } catch {
      /* 忽略非法 base */
    }
  }
  const forwarded = req.headers['x-forwarded-proto']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.socket.encrypted || req.socket.localPort === 443 ? 'https' : 'http'
}

/** 构建分享的绝对地址：优先 MARGIN_BASE_URL，其次反代头，最后请求 Host。 */
export function absoluteShareUrl(req, id, config) {
  if (config.baseUrl) return `${config.baseUrl.replace(/\/+$/, '')}/s/${id}`
  return `${requestProto(req, config.baseUrl)}://${requestHost(req)}/s/${id}`
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}
