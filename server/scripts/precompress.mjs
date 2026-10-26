// Compress once at build time; the server only streams files at request time.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
let files = 0
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) { await walk(file); continue }
    if (!['.html', '.js', '.css', '.json', '.yaml', '.svg'].includes(extname(file))) continue
    if ((await stat(file)).size < 1024) continue
    const raw = await readFile(file)
    for (const [suffix, compressed] of [
      ['.br', brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })],
      ['.gz', gzipSync(raw, { level: 9 })],
    ]) if (compressed.length < raw.length) await writeFile(file + suffix, compressed)
    files += 1
  }
}
await walk(root)
console.log(`[build:deploy] precompressed ${files} text assets`)
