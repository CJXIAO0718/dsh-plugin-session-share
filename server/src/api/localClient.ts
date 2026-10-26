import { parseShareBundle, SNAPSHOT_SCHEMA, type ShareBundle } from '../parser/parseSnapshot'
import { SnapshotParseError, type SnapshotDocument } from '../parser/types'
import {
  MAX_SNAPSHOT_BYTES,
  ShareClientError,
  formatBytes,
  shareFilename,
  type CreateShareInput,
  type CreateShareResult,
  type ShareClient,
  type ShareSnapshot,
  type ShareSummary,
} from './types'

const DB_NAME = 'margin-native-archive'
const STORE = 'shares'
const DEMO_ID = 'demo-spectral'
const DEMO_URL = '/demo/spectral.json'

interface StoredShare {
  summary: ShareSummary
  document: SnapshotDocument
  json: string
}

let dbPromise: Promise<IDBDatabase> | null = null
let memoryFallback = false
const memory = new Map<string, StoredShare>()

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'summary.id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
  dbPromise = opening.catch((error: unknown) => {
    memoryFallback = true
    throw error
  })
  return dbPromise
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (memoryFallback) throw new Error('memory fallback')
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = work(tx.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function getRecord(id: string): Promise<StoredShare | null> {
  try {
    const record = await withStore<StoredShare | undefined>('readonly', (store) => store.get(id))
    return record ?? null
  } catch {
    return memory.get(id) ?? null
  }
}

async function putRecord(record: StoredShare): Promise<void> {
  try {
    await withStore<IDBValidKey>('readwrite', (store) => store.put(record))
  } catch {
    memory.set(record.summary.id, record)
  }
}

async function deleteRecord(id: string): Promise<void> {
  try {
    await withStore<undefined>('readwrite', (store) => store.delete(id))
  } catch {
    memory.delete(id)
  }
}

async function readAll(): Promise<StoredShare[]> {
  try {
    const records = await withStore<StoredShare[]>('readonly', (store) => store.getAll())
    return records
  } catch {
    return Array.from(memory.values())
  }
}

function randomId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function summaryFrom(
  document: SnapshotDocument,
  id: string,
  bytes: number,
  createdAt: string,
  demo = false,
): ShareSummary {
  return {
    id,
    url: `/s/${id}`,
    title: document.title,
    createdAt,
    source: document.source,
    counts: document.counts,
    visibility: 'unlisted',
    expiresAt: null,
    snapshotBytes: bytes,
    demo,
  }
}

async function ensureDemo(): Promise<ShareSummary | null> {
  const existing = await getRecord(DEMO_ID)
  if (existing) return existing.summary
  try {
    const response = await fetch(DEMO_URL, { cache: 'no-store' })
    if (!response.ok) return null
    const json = await response.text()
    const parsed = parseShareBundle(json)
    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString()
    const summary = summaryFrom(parsed.document, DEMO_ID, parsed.bytes, createdAt, true)
    await putRecord({ summary, document: parsed.document, json })
    return summary
  } catch {
    return null
  }
}

export class LocalShareClient implements ShareClient {
  readonly mode = 'local' as const

  async create(input: CreateShareInput): Promise<CreateShareResult> {
    const title = input.title?.trim()
    const document = title ? { ...input.document, title } : input.document
    const bundle: ShareBundle = { schema: SNAPSHOT_SCHEMA, document }
    const json = JSON.stringify(bundle, null, 2)
    const bytes = new TextEncoder().encode(json).length
    if (bytes > MAX_SNAPSHOT_BYTES) {
      throw new ShareClientError(
        'payload_too_large',
        `这份快照超过 ${formatBytes(MAX_SNAPSHOT_BYTES)} 的大小上限。`,
        413,
        [`当前快照约 ${formatBytes(bytes)}。`],
      )
    }

    let parsed
    try {
      parsed = parseShareBundle(json)
    } catch (error) {
      if (error instanceof SnapshotParseError) {
        throw new ShareClientError(error.code, error.message, 422, error.details)
      }
      throw error
    }

    let id = randomId()
    while (await getRecord(id)) id = randomId()
    const createdAt = new Date().toISOString()
    const summary = summaryFrom(parsed.document, id, bytes, createdAt)
    await putRecord({ summary, document: parsed.document, json })

    return {
      summary,
      warnings: parsed.document.warnings,
    }
  }

  async get(id: string): Promise<ShareSnapshot> {
    if (id === DEMO_ID) await ensureDemo()
    const record = await getRecord(id)
    if (!record) {
      throw new ShareClientError('not_found', '没有找到这份会话存档。', 404)
    }
    return { summary: record.summary, document: record.document }
  }

  async list(): Promise<ShareSummary[]> {
    await ensureDemo()
    const records = await readAll()
    return records
      .map((record) => record.summary)
      .sort((a, b) => {
        if (a.demo !== b.demo) return a.demo ? -1 : 1
        return b.createdAt.localeCompare(a.createdAt)
      })
  }

  async remove(id: string): Promise<void> {
    if (id === DEMO_ID) return
    await deleteRecord(id)
  }

  async snapshotJson(id: string): Promise<{ json: string; filename: string }> {
    if (id === DEMO_ID) await ensureDemo()
    const record = await getRecord(id)
    if (!record) throw new ShareClientError('not_found', '没有找到这份会话存档。', 404)
    return { json: record.json, filename: shareFilename(id) }
  }

  ensureDemo(): Promise<ShareSummary | null> {
    return ensureDemo()
  }
}

export const localShareClient = new LocalShareClient()
export { DEMO_ID }
