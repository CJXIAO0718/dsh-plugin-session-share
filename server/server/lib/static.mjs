// Async metadata reads, streamed bodies, conditional requests, precompressed assets.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

function safeJoin(root, urlPath) {
  try {
    const decoded = decodeURIComponent(urlPath.split('?')[0])
    if (decoded.includes('\0') || decoded.includes('\\')) return null
    const base = resolve(root)
    const target = resolve(base, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded))
    return target.startsWith(base + sep) ? target : null
  } catch { return null }
}

async function fileStat(target) {
  if (!target) return null
  try { const info = await stat(target); return info.isFile() ? info : null }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error }
}

function encodingQuality(header, name) {
  const entries = String(header ?? '').toLowerCase().split(',').map(part => {
    const [encoding, ...parameters] = part.trim().split(';')
    const q = parameters.find(p => p.trim().startsWith('q='))
    const value = q ? Number(q.trim().slice(2)) : 1
    return [encoding, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0]
  })
  return entries.find(([encoding]) => encoding === name)?.[1]
    ?? entries.find(([encoding]) => encoding === '*')?.[1] ?? 0
}

async function sendFile(req, res, target, info, cacheControl) {
  let file = target
  let encoding = null
  const accepted = req.headers['accept-encoding']
  const variants = [['br', '.br'], ['gzip', '.gz']]
    .map(([name, suffix]) => ({ name, suffix, q: encodingQuality(accepted, name) }))
    .filter(v => v.q > 0).sort((a, b) => b.q - a.q)
  for (const variant of variants) {
    const compressed = await fileStat(target + variant.suffix)
    if (compressed) { file += variant.suffix; encoding = variant.name; info = compressed; break }
  }
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}-${encoding ?? 'identity'}"`
  res.setHeader('Content-Type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Vary', 'Accept-Encoding')
  res.setHeader('ETag', etag)
  res.setHeader('Last-Modified', info.mtime.toUTCString())
  if (encoding) res.setHeader('Content-Encoding', encoding)
  const ifNoneMatch = req.headers['if-none-match']
  const matches = ifNoneMatch && String(ifNoneMatch).split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
  const since = req.headers['if-modified-since']
  if (matches || (!ifNoneMatch && since && Math.floor(info.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000))) {
    res.statusCode = 304
    res.end()
    return true
  }
  res.statusCode = 200
  res.setHeader('Content-Length', info.size)
  if (req.method === 'HEAD') res.end()
  else pipeline(createReadStream(file), res, () => { /* Both ends close on disconnect/error. */ })
  return true
}

export async function serveStaticFile(req, res, distDir, relativePath) {
  if (!distDir || !['GET', 'HEAD'].includes(req.method)) return false
  const target = safeJoin(distDir, '/' + relativePath)
  const info = await fileStat(target)
  return info ? sendFile(req, res, target, info, 'no-cache') : false
}

export async function serveStatic(req, res, distDir) {
  if (!distDir || !['GET', 'HEAD'].includes(req.method)) return false
  const pathname = req.url.split('?')[0]
  if (pathname.startsWith('/api/')) return false
  const target = safeJoin(distDir, pathname)
  const info = await fileStat(target)
  if (info) {
    const cache = pathname.startsWith('/assets/') ? 'public, max-age=604800, immutable'
      : pathname === '/index.html' ? 'no-cache' : 'public, max-age=3600'
    return sendFile(req, res, target, info, cache)
  }
  if (extname(pathname) || (!target && pathname !== '/')) return false
  const index = safeJoin(distDir, '/index.html')
  const indexInfo = await fileStat(index)
  return indexInfo ? sendFile(req, res, index, indexInfo, 'no-cache') : false
}
