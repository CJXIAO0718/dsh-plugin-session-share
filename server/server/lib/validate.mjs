// 快照校验：镜像 docs/API.md 的 SnapshotDocument 契约与前端 parser/parseSnapshot.ts 的规则。
// 服务端只校验并计数，不改写文档；入库保存规范化的紧凑 JSON。

export const SNAPSHOT_SCHEMA = 'dsh.session-share/v1'

export class SnapshotError extends Error {
  constructor(status, code, message, details = []) {
    super(message)
    this.name = 'SnapshotError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value) {
  return typeof value === 'string'
}

function isCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNullableCount(value) {
  return value === null || value === undefined || isCount(value)
}

function checkSource(value, details) {
  if (!isRecord(value)) {
    details.push('document.source 必须是对象。')
    return
  }
  const strings = [
    'generator',
    'pluginVersion',
    'sessionId',
    'generatedAt',
    'generatedAtIso',
    'sessionCreatedAt',
    'preset',
    'cwd',
  ]
  for (const key of strings) {
    const item = value[key]
    if (item !== null && item !== undefined && !isString(item)) {
      details.push(`document.source.${key} 必须是字符串或 null。`)
    }
  }
  if (
    value.reasoning !== null &&
    value.reasoning !== undefined &&
    !['omit', 'count', 'full'].includes(value.reasoning)
  ) {
    details.push("document.source.reasoning 只能是 'omit' | 'count' | 'full' 或 null。")
  }
  if (value.redacted !== null && value.redacted !== undefined && typeof value.redacted !== 'boolean') {
    details.push('document.source.redacted 必须是布尔或 null。')
  }
  if (value.theme !== null && value.theme !== undefined && !['auto', 'light', 'dark'].includes(value.theme)) {
    details.push("document.source.theme 只能是 'auto' | 'light' | 'dark' 或 null。")
  }
}

function checkCounts(value, details) {
  if (!isRecord(value)) {
    details.push('document.counts 必须是对象。')
    return
  }
  for (const key of ['turns', 'userMessages', 'contextMessages', 'assistantMessages', 'toolCalls']) {
    if (!isCount(value[key])) {
      details.push(`document.counts.${key} 必须是非负数字。`)
    }
  }
  for (const key of [
    'collapsedBlocks',
    'redactions',
    'badLines',
    'events',
    'picked',
    'totalEntries',
  ]) {
    if (!isNullableCount(value[key])) {
      details.push(`document.counts.${key} 必须是非负数字或 null。`)
    }
  }
}

function checkTruncation(value, where, details) {
  if (value === null || value === undefined) return
  if (!isRecord(value) || !isCount(value.shown) || !isCount(value.original)) {
    details.push(`${where} 必须是 { shown, original } 或 null。`)
  }
}

function checkMessage(value, where, details) {
  if (!isRecord(value)) {
    details.push(`${where} 必须是对象。`)
    return
  }
  if (value.role !== 'user' && value.role !== 'assistant') {
    details.push(`${where}.role 必须是 'user' 或 'assistant'。`)
  }
  if (!isString(value.markdown) || !value.markdown.trim()) {
    details.push(`${where}.markdown 必须是非空字符串。`)
  }
  if (value.id !== undefined && !isString(value.id)) details.push(`${where}.id 必须是字符串。`)
  if (value.name !== undefined && !isString(value.name)) details.push(`${where}.name 必须是字符串。`)
}

function checkApparatus(value, where, details) {
  if (!isRecord(value)) {
    details.push(`${where} 必须是对象。`)
    return
  }
  if (value.type === 'context') {
    if (!isString(value.text) || !value.text.trim()) details.push(`${where}.text 必须是非空字符串。`)
    if (value.reason !== undefined && !isString(value.reason)) details.push(`${where}.reason 必须是字符串。`)
  } else if (value.type === 'reasoning') {
    if (!isString(value.markdown) || !value.markdown.trim()) {
      details.push(`${where}.markdown 必须是非空字符串。`)
    }
  } else if (value.type === 'tool') {
    if (value.args !== null && value.args !== undefined && !isString(value.args)) {
      details.push(`${where}.args 必须是字符串或 null。`)
    }
    if (value.result !== null && value.result !== undefined && !isString(value.result)) {
      details.push(`${where}.result 必须是字符串或 null。`)
    }
    checkTruncation(value.argsTruncated, `${where}.argsTruncated`, details)
    checkTruncation(value.resultTruncated, `${where}.resultTruncated`, details)
    if (value.error !== undefined && typeof value.error !== 'boolean') {
      details.push(`${where}.error 必须是布尔。`)
    }
    if (value.noResult !== undefined && typeof value.noResult !== 'boolean') {
      details.push(`${where}.noResult 必须是布尔。`)
    }
    if (value.name !== undefined && !isString(value.name)) details.push(`${where}.name 必须是字符串。`)
    if (value.summary !== undefined && !isString(value.summary)) {
      details.push(`${where}.summary 必须是字符串。`)
    }
    if (value.meta !== undefined && !isString(value.meta)) details.push(`${where}.meta 必须是字符串。`)
  } else {
    details.push(`${where}.type 必须是 'context' | 'reasoning' | 'tool'。`)
  }
}

function checkInternal(value, details) {
  if (value === null || value === undefined) return
  if (!isRecord(value)) {
    details.push('document.internal 必须是对象或 null。')
    return
  }
  if (!isCount(value.count)) details.push('document.internal.count 必须是非负数字。')
  if (!Array.isArray(value.events)) {
    details.push('document.internal.events 必须是数组。')
  } else {
    value.events.forEach((event, index) => {
      if (!isRecord(event) || !isString(event.type) || !isCount(event.count)) {
        details.push(`document.internal.events[${index}] 必须是 { type: string, count: number }。`)
      }
    })
  }
  if (value.note !== null && value.note !== undefined && !isString(value.note)) {
    details.push('document.internal.note 必须是字符串或 null。')
  }
}

/**
 * 校验发布请求体。成功返回用于入库的统计；失败抛出 SnapshotError。
 * @param {string} raw 请求体原文
 * @returns {{ parsedBundle: object, document: object, warnings: string[] }}
 */
export function validateShareBundle(raw) {
  let bundle
  try {
    bundle = JSON.parse(raw)
  } catch {
    throw new SnapshotError(400, 'invalid_json', '请求体不是合法 JSON。')
  }
  if (!isRecord(bundle)) {
    throw new SnapshotError(400, 'invalid_json', '请求体必须是 JSON 对象。')
  }
  if (bundle.schema !== SNAPSHOT_SCHEMA) {
    throw new SnapshotError(
      422,
      'unsupported_schema',
      '这份快照使用了不兼容的协议版本。',
      [`期望 ${SNAPSHOT_SCHEMA}，收到 ${String(bundle.schema)}。`],
    )
  }

  const document = bundle.document
  const details = []
  if (!isRecord(document)) {
    throw new SnapshotError(422, 'invalid_snapshot', '这份快照不符合 dsh.session-share/v1。', [
      'document 必须是对象。',
    ])
  }
  if (document.schemaVersion !== 1) {
    details.push('document.schemaVersion 必须是 1。')
  }
  if (!isString(document.title) || !document.title.trim()) {
    details.push('document.title 必须是非空字符串。')
  }
  checkSource(document.source, details)
  checkCounts(document.counts, details)
  checkInternal(document.internal, details)
  if (typeof document.emptySelection !== 'boolean') {
    details.push('document.emptySelection 必须是布尔。')
  }
  if (!Array.isArray(document.warnings)) {
    details.push('document.warnings 必须是字符串数组。')
  } else if (document.warnings.some((warning) => !isString(warning))) {
    details.push('document.warnings 必须是字符串数组。')
  }
  if (!Array.isArray(document.turns)) {
    details.push('document.turns 必须是数组。')
  } else {
    document.turns.forEach((turn, turnIndex) => {
      const where = `document.turns[${turnIndex}]`
      if (!isRecord(turn)) {
        details.push(`${where} 必须是对象。`)
        return
      }
      if (turn.number !== undefined && !isCount(turn.number)) details.push(`${where}.number 必须是非负数字。`)
      if (turn.label !== undefined && !isString(turn.label)) details.push(`${where}.label 必须是字符串。`)
      if (turn.id !== undefined && !isString(turn.id)) details.push(`${where}.id 必须是字符串。`)
      if (!Array.isArray(turn.messages)) {
        details.push(`${where}.messages 必须是数组。`)
      } else {
        turn.messages.forEach((message, index) => {
          checkMessage(message, `${where}.messages[${index}]`, details)
        })
      }
      if (!Array.isArray(turn.apparatus)) {
        details.push(`${where}.apparatus 必须是数组。`)
      } else {
        turn.apparatus.forEach((item, index) => {
          checkApparatus(item, `${where}.apparatus[${index}]`, details)
        })
      }
      const omitted = turn.reasoningOmitted
      if (omitted !== null && omitted !== undefined) {
        if (!isRecord(omitted) || !isCount(omitted.count)) {
          details.push(`${where}.reasoningOmitted 必须是 { count } 或 null。`)
        }
      }
    })
  }

  const counts = isRecord(document.counts) ? document.counts : {}
  if (details.length === 0 && Array.isArray(document.turns)) {
    // 计数一致性：插件约定 —— turns 等长；context/tool 旁注与计数相等；
    // 用户/助手消息计数包含被过滤的空消息事件，因此允许大于实际条数。
    if (isCount(counts.turns) && counts.turns !== document.turns.length) {
      details.push(`document.counts.turns (${counts.turns}) 与轮次数量 (${document.turns.length}) 不一致。`)
    }
    const apparatus = document.turns.flatMap((turn) => (isRecord(turn) && Array.isArray(turn.apparatus) ? turn.apparatus : []))
    const messages = document.turns.flatMap((turn) => (isRecord(turn) && Array.isArray(turn.messages) ? turn.messages : []))
    const contexts = apparatus.filter((item) => isRecord(item) && item.type === 'context').length
    const tools = apparatus.filter((item) => isRecord(item) && item.type === 'tool').length
    const userSpeech = messages.filter((item) => isRecord(item) && item.role === 'user').length
    const assistant = messages.filter((item) => isRecord(item) && item.role === 'assistant').length
    if (isCount(counts.contextMessages) && counts.contextMessages !== contexts) {
      details.push(`document.counts.contextMessages (${counts.contextMessages}) 与上下文旁注数量 (${contexts}) 不一致。`)
    }
    if (isCount(counts.toolCalls) && counts.toolCalls !== tools) {
      details.push(`document.counts.toolCalls (${counts.toolCalls}) 与工具旁注数量 (${tools}) 不一致。`)
    }
    if (isCount(counts.userMessages) && userSpeech > counts.userMessages) {
      details.push(`document.counts.userMessages (${counts.userMessages}) 少于正文里的用户消息 (${userSpeech})。`)
    }
    if (isCount(counts.assistantMessages) && assistant > counts.assistantMessages) {
      details.push(`document.counts.assistantMessages (${counts.assistantMessages}) 少于正文里的助手消息 (${assistant})。`)
    }
    const emptySelection = document.emptySelection === true
    if (!document.turns.length && !emptySelection) {
      details.push('快照里没有可阅读的对话轮次。')
    }
  }

  if (details.length > 0) {
    throw new SnapshotError(422, 'invalid_snapshot', '这份快照不符合 dsh.session-share/v1。', details.slice(0, 20))
  }

  return {
    parsedBundle: bundle,
    document,
    warnings: Array.isArray(document.warnings) ? document.warnings : [],
  }
}
