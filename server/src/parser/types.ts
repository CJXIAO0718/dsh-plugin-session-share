export type MessageRole = 'user' | 'assistant'

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface ShareSource {
  generator: string | null
  pluginVersion: string | null
  sessionId: string | null
  generatedAt: string | null
  generatedAtIso?: string | null
  sessionCreatedAt?: string | null
  preset: string | null
  cwd: string | null
  reasoning?: 'omit' | 'count' | 'full' | null
  redacted?: boolean | null
  theme: ThemeMode | null
}

export interface ShareCounts {
  turns: number
  userMessages: number
  contextMessages: number
  assistantMessages: number
  toolCalls: number
  collapsedBlocks: number | null
  redactions: number | null
  badLines: number | null
  events: number | null
  picked: number | null
  totalEntries: number | null
}

export interface Message {
  id: string
  role: MessageRole
  name: string
  markdown: string
}

export interface ContextEntry {
  id: string
  type: 'context'
  index: number
  chars: number | null
  reason: string
  text: string
}

export interface ReasoningEntry {
  id: string
  type: 'reasoning'
  index: number
  chars: number | null
  markdown: string
}

export interface Truncation {
  shown: number
  original: number
}

export interface ToolEntry {
  id: string
  type: 'tool'
  index: number
  name: string
  summary: string
  meta: string
  error: boolean
  args: string | null
  result: string | null
  argsTruncated: Truncation | null
  resultTruncated: Truncation | null
  noResult: boolean
}

export type Apparatus = ContextEntry | ReasoningEntry | ToolEntry

export interface ReasoningOmitted {
  count: number
}

export type ApparatusKind = Apparatus['type']

export interface Turn {
  id: string
  number: number
  label: string
  messages: Message[]
  apparatus: Apparatus[]
  reasoningOmitted: ReasoningOmitted | null
}

export interface InternalEvent {
  type: string
  count: number
}

export interface InternalEvents {
  count: number
  events: InternalEvent[]
  note: string | null
}

export interface SnapshotDocument {
  schemaVersion: 1
  title: string
  source: ShareSource
  counts: ShareCounts
  turns: Turn[]
  internal: InternalEvents | null
  emptySelection: boolean
  warnings: string[]
}

export interface ParseResult {
  document: SnapshotDocument
  originalHtml: string
  bytes: number
}

export class SnapshotParseError extends Error {
  code: string
  details: string[]

  constructor(code: string, message: string, details: string[] = []) {
    super(message)
    this.name = 'SnapshotParseError'
    this.code = code
    this.details = details
  }
}
