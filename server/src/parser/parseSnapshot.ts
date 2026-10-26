import {
  SnapshotParseError,
  type Apparatus,
  type ContextEntry,
  type InternalEvents,
  type Message,
  type ReasoningEntry,
  type ReasoningOmitted,
  type ShareCounts,
  type ShareSource,
  type SnapshotDocument,
  type ToolEntry,
  type Turn,
} from './types'

export const SNAPSHOT_SCHEMA = 'dsh.session-share/v1'

export interface ShareBundle {
  schema: typeof SNAPSHOT_SCHEMA
  document: SnapshotDocument
}

export interface ParsedSnapshot {
  document: SnapshotDocument
  bytes: number
}

type UnknownRecord = Record<string, unknown>

function fail(message: string, details: string[] = []): never {
  throw new SnapshotParseError('not_a_snapshot', message, details)
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim()
  return valueText ? valueText : null
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeSource(value: unknown): ShareSource {
  const source = record(value)
  return {
    generator: nullableText(source.generator),
    pluginVersion: nullableText(source.pluginVersion),
    sessionId: nullableText(source.sessionId),
    generatedAt: nullableText(source.generatedAt),
    generatedAtIso: nullableText(source.generatedAtIso),
    sessionCreatedAt: nullableText(source.sessionCreatedAt),
    preset: nullableText(source.preset),
    cwd: nullableText(source.cwd),
    reasoning: source.reasoning === 'count' || source.reasoning === 'full' || source.reasoning === 'omit'
      ? source.reasoning
      : null,
    redacted: typeof source.redacted === 'boolean' ? source.redacted : null,
    theme: source.theme === 'light' || source.theme === 'dark' || source.theme === 'auto'
      ? source.theme
      : null,
  }
}

function normalizeCounts(value: unknown): ShareCounts {
  const counts = record(value)
  return {
    turns: number(counts.turns),
    userMessages: number(counts.userMessages),
    contextMessages: number(counts.contextMessages),
    assistantMessages: number(counts.assistantMessages),
    toolCalls: number(counts.toolCalls),
    collapsedBlocks: nullableNumber(counts.collapsedBlocks),
    redactions: nullableNumber(counts.redactions),
    badLines: nullableNumber(counts.badLines),
    events: nullableNumber(counts.events),
    picked: nullableNumber(counts.picked),
    totalEntries: nullableNumber(counts.totalEntries),
  }
}

function normalizeMessage(value: unknown, fallbackId: string): Message | null {
  const message = record(value)
  const role = message.role === 'assistant' ? 'assistant' : 'user'
  const markdown = text(message.markdown)
  if (!markdown.trim()) return null
  return {
    id: text(message.id) || fallbackId,
    role,
    name: text(message.name) || (role === 'user' ? '你' : 'DeepSeek'),
    markdown,
  }
}

function normalizeContext(value: unknown, index: number): ContextEntry | null {
  const item = record(value)
  const body = text(item.text)
  if (!body.trim()) return null
  return {
    id: text(item.id) || `ctx-${index}`,
    type: 'context',
    index: number(item.index, index),
    chars: nullableNumber(item.chars),
    reason: text(item.reason) || '内联上下文',
    text: body,
  }
}

function normalizeReasoning(value: unknown, index: number): ReasoningEntry | null {
  const item = record(value)
  const markdown = text(item.markdown)
  if (!markdown.trim()) return null
  return {
    id: text(item.id) || `reason-${index}`,
    type: 'reasoning',
    index: number(item.index, index),
    chars: nullableNumber(item.chars),
    markdown,
  }
}

function normalizeTool(value: unknown, index: number): ToolEntry {
  const item = record(value)
  const args = typeof item.args === 'string' ? item.args : null
  const result = typeof item.result === 'string' ? item.result : null
  const argsTruncated = record(item.argsTruncated)
  const resultTruncated = record(item.resultTruncated)
  return {
    id: text(item.id) || `tool-${index}`,
    type: 'tool',
    index: number(item.index, index),
    name: text(item.name) || 'tool',
    summary: text(item.summary),
    meta: text(item.meta),
    error: item.error === true,
    args,
    result,
    argsTruncated: item.argsTruncated
      ? { shown: number(argsTruncated.shown, args?.length ?? 0), original: number(argsTruncated.original, args?.length ?? 0) }
      : null,
    resultTruncated: item.resultTruncated
      ? { shown: number(resultTruncated.shown, result?.length ?? 0), original: number(resultTruncated.original, result?.length ?? 0) }
      : null,
    noResult: item.noResult === true || (result === null && item.noResult !== false),
  }
}

function normalizeTurn(value: unknown, turnIndex: number): Turn {
  const turn = record(value)
  const messages = array(turn.messages)
    .map((message, index) => normalizeMessage(message, `turn-${turnIndex}-m-${index}`))
    .filter((message): message is Message => message !== null)
  const apparatus: Apparatus[] = []
  for (const [index, raw] of array(turn.apparatus).entries()) {
    const item = record(raw)
    if (item.type === 'context') {
      const context = normalizeContext(item, index + 1)
      if (context) apparatus.push(context)
    } else if (item.type === 'reasoning') {
      const reasoning = normalizeReasoning(item, index + 1)
      if (reasoning) apparatus.push(reasoning)
    } else if (item.type === 'tool') {
      apparatus.push(normalizeTool(item, index + 1))
    }
  }
  const omitted = record(turn.reasoningOmitted)
  const reasoningOmitted: ReasoningOmitted | null = turn.reasoningOmitted
    ? { count: number(omitted.count) }
    : null
  const numberValue = number(turn.number, turnIndex + 1)
  return {
    id: text(turn.id) || `turn-${turnIndex + 1}`,
    number: numberValue > 0 ? numberValue : turnIndex + 1,
    label: text(turn.label) || `第 ${String(numberValue).padStart(2, '0')} 轮`,
    messages,
    apparatus,
    reasoningOmitted,
  }
}

function normalizeInternal(value: unknown): InternalEvents | null {
  if (value === null || value === undefined) return null
  const internal = record(value)
  const events = array(internal.events)
    .map((raw) => record(raw))
    .map((event) => ({ type: text(event.type), count: number(event.count) }))
    .filter((event) => event.type && event.count > 0)
  const count = number(internal.count, events.reduce((total, event) => total + event.count, 0))
  if (!count && !events.length) return null
  return {
    count,
    events,
    note: nullableText(internal.note),
  }
}

function normalizeDocument(value: unknown): SnapshotDocument {
  const document = record(value)
  if (number(document.schemaVersion, 0) !== 1) {
    fail('这份快照的格式版本不受支持。', ['需要 schemaVersion: 1。'])
  }
  const title = text(document.title).trim()
  if (!title) fail('快照缺少标题。')
  const turns = array(document.turns).map((turn, index) => normalizeTurn(turn, index))
  if (!turns.length && document.emptySelection !== true) {
    fail('快照里没有可阅读的对话轮次。')
  }
  const warnings = array(document.warnings)
    .map((warning) => text(warning))
    .filter(Boolean)
  return {
    schemaVersion: 1,
    title,
    source: normalizeSource(document.source),
    counts: normalizeCounts(document.counts),
    turns,
    internal: normalizeInternal(document.internal),
    emptySelection: document.emptySelection === true,
    warnings,
  }
}

/** Validates and normalizes the native snapshot posted by the DSH plugin. */
export function parseShareBundle(input: unknown): ParsedSnapshot {
  const raw = typeof input === 'string' ? input : JSON.stringify(input)
  let value: unknown
  try {
    value = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    throw new SnapshotParseError('invalid_json', '这份快照不是有效的 JSON 文件。')
  }
  const envelope = record(value)
  if (envelope.schema !== undefined && envelope.schema !== SNAPSHOT_SCHEMA) {
    fail('这份快照使用了不兼容的协议版本。', [`期望 ${SNAPSHOT_SCHEMA}，收到 ${text(envelope.schema)}。`])
  }
  const document = normalizeDocument(envelope.document ?? value)
  return {
    document,
    bytes: new TextEncoder().encode(raw).length,
  }
}
