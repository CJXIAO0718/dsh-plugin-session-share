import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShareBundle } from '../../lib/snapshot.js'
import events, { BASE } from './demo-events.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outFile = resolve(root, 'public/demo/spectral.json')

const session = events[0]
const rawJsonl = events.map((event) => JSON.stringify(event)).join('\n')

const bundle = buildShareBundle({
  session,
  events: rawJsonl,
  options: {
    redact: true,
    now: BASE + 1000 * 60 * 47,
    reasoning: 'full',
  },
})

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(bundle, null, 2) + '\n', 'utf8')

console.log(JSON.stringify({
  outFile,
  bytes: Buffer.byteLength(JSON.stringify(bundle)),
  counts: bundle.document.counts,
  title: bundle.document.title,
}, null, 2))
