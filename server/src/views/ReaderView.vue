<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import EvidenceDrawer from '../components/EvidenceDrawer.vue'
import { shareClient } from '../api/shareClient'
import { formatBytes, type ShareSummary } from '../api/types'
import { useToast } from '../composables/useToast'
import { copyText } from '../lib/clipboard'
import { formatDateTime, padNumber } from '../lib/format'
import { renderMarkdown } from '../markdown/renderMarkdown'
import type { Apparatus, Message, SnapshotDocument, Turn } from '../parser/types'

const props = defineProps<{ id: string }>()

const router = useRouter()
const { push } = useToast()

const summary = ref<ShareSummary | null>(null)
const doc = ref<SnapshotDocument | null>(null)
const loading = ref(true)
const loadError = ref<{ code: string; message: string; details: string[] } | null>(null)
const recordEl = ref<HTMLElement | null>(null)
const progress = ref(0)
const activeTurn = ref(1)
const selected = ref<{ item: Apparatus; turn: Turn } | null>(null)
const copiedMessageId = ref('')
const confirmingDelete = ref(false)
const deleting = ref(false)

let scrollTicking = false
let copyTimer: number | undefined
let confirmTimer: number | undefined
let previousTitle = ''

const turns = computed(() => doc.value?.turns ?? [])
const counts = computed(() => doc.value?.counts ?? summary.value?.counts ?? null)
const source = computed(() => doc.value?.source ?? summary.value?.source ?? null)
const generatedLabel = computed(() => {
  const generated = source.value?.generatedAt
  if (generated) return generated
  return summary.value ? formatDateTime(summary.value.createdAt) : '未记录'
})
const sessionLabel = computed(() => source.value?.sessionId ?? summary.value?.source.sessionId ?? props.id)
const snapshotBytes = computed(() => summary.value?.snapshotBytes ?? 0)
const redactions = computed(() => counts.value?.redactions)
const picked = computed(() => counts.value?.picked)
const totalEntries = computed(() => counts.value?.totalEntries)
const isDemo = computed(() => summary.value?.demo === true)
const canDelete = computed(() => !isDemo.value && (shareClient.mode === 'local' || summary.value?.canManage === true))
const warnings = computed(() => doc.value?.warnings ?? [])

const stats = computed(() => {
  const value = counts.value
  return [
    { value: value?.turns ?? 0, unit: '轮', label: '对话轮次' },
    { value: value?.userMessages ?? 0, unit: '条', label: '用户消息' },
    { value: value?.assistantMessages ?? 0, unit: '条', label: '助手消息' },
    { value: value?.toolCalls ?? 0, unit: '次', label: '工具调用' },
    { value: value?.redactions ?? 0, unit: '处', label: '已脱敏' },
  ]
})

const endnote = computed(() => {
  const parts: string[] = ['这是发布时写定的静态快照，不是实时会话。']
  if (redactions.value) parts.push(`快照内有 ${redactions.value} 处内容在发布前已脱敏。`)
  if (picked.value !== null && totalEntries.value !== null) {
    parts.push(`本页只包含发布时选中的 ${picked.value} / ${totalEntries.value} 条消息。`)
  }
  const reasoningOmitted = turns.value.reduce((total, turn) => total + (turn.reasoningOmitted?.count ?? 0), 0)
  if (reasoningOmitted) parts.push(`另有 ${reasoningOmitted} 段思考过程按「计数」模式省略。`)
  return parts.join(' ')
})

const recordPath = computed(() => source.value?.cwd ?? '')

function apparatusGroups(turn: Turn): Array<{ type: Apparatus['type']; label: string; items: Apparatus[] }> {
  const definitions: Array<{ type: Apparatus['type']; label: string }> = [
    { type: 'context', label: '上下文 / CONTEXT' },
    { type: 'reasoning', label: '思考 / REASONING' },
    { type: 'tool', label: '工具 / TOOLS' },
  ]
  return definitions
    .map((definition) => ({
      ...definition,
      items: turn.apparatus.filter((item) => item.type === definition.type),
    }))
    .filter((group) => group.items.length > 0)
}

function apparatusCount(turn: Turn): number {
  return turn.apparatus.length
}

function apparatusSummary(turn: Turn): string {
  const context = turn.apparatus.filter((item) => item.type === 'context').length
  const reasoning = turn.apparatus.filter((item) => item.type === 'reasoning').length
  const tools = turn.apparatus.filter((item) => item.type === 'tool').length
  const parts = [
    context ? `${context} 条上下文` : '',
    reasoning ? `${reasoning} 段思考` : '',
    tools ? `${tools} 次工具` : '',
  ].filter(Boolean)
  if (!parts.length && turn.reasoningOmitted) return `思考 ${turn.reasoningOmitted.count} 段 · 已省略`
  return parts.join(' · ')
}

function itemLabel(item: Apparatus): string {
  if (item.type === 'context') return item.reason || '内联上下文'
  if (item.type === 'reasoning') return `思考片段 ${padNumber(item.index)}`
  return item.name
}

function itemMeta(item: Apparatus): string {
  if (item.type === 'context') return item.chars ? `${item.chars} 字` : '原始上下文'
  if (item.type === 'reasoning') return item.chars ? `${item.chars} 字` : '思考记录'
  return item.meta.replace(/^·\s*/, '') || item.summary
}

function itemStatus(item: Apparatus): string {
  if (item.type === 'context') return '原文'
  if (item.type === 'reasoning') return '展开'
  return item.error ? '出错' : '完成'
}

function itemIsError(item: Apparatus): boolean {
  return item.type === 'tool' && item.error
}

function isInterjection(turn: Turn, messageIndex: number): boolean {
  return (
    turn.messages[messageIndex]?.role === 'user' &&
    messageIndex > 0 &&
    turn.messages[messageIndex - 1]?.role === 'assistant'
  )
}

function speakerLabel(turn: Turn, messageIndex: number): string {
  const message = turn.messages[messageIndex]
  if (message.role === 'user') return isInterjection(turn, messageIndex) ? '用户信息 · 中途插话' : '用户信息'
  return '助手回复'
}

function anchorId(turn: Turn): string {
  return `turn-${turn.number}`
}

function copyMessage(message: Message): void {
  void copyText(message.markdown).then((ok) => {
    if (!ok) {
      push('复制失败，请手动选择文本。', 'error')
      return
    }
    copiedMessageId.value = message.id
    window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      copiedMessageId.value = ''
    }, 1600)
  })
}

async function copyAll(): Promise<void> {
  if (!doc.value) return
  const text = doc.value.turns
    .map((turn) => {
      const messages = turn.messages
        .map((message) => `${message.role === 'user' ? '用户' : '助手'}：\n${message.markdown}`)
        .join('\n\n')
      return `## 第 ${turn.number} 轮\n\n${messages}`
    })
    .join('\n\n')
  const ok = await copyText(text)
  push(ok ? '已复制全部对话正文。' : '复制失败，请手动选择文本。', ok ? 'neutral' : 'error')
}

async function copyLink(): Promise<void> {
  if (!summary.value) return
  const ok = await copyText(`${window.location.origin}/s/${summary.value.id}`)
  push(ok ? '存档链接已复制。' : '复制失败，请从地址栏复制。', ok ? 'neutral' : 'error')
}

async function downloadSnapshot(): Promise<void> {
  if (!summary.value) return
  try {
    const { json, filename } = await shareClient.snapshotJson(summary.value.id)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/vnd.dsh.session-share+json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    push('原生快照已开始下载。')
  } catch (error) {
    push(error instanceof Error ? error.message : '下载失败，请再试一次。', 'error')
  }
}

function scrollToTurn(number: number): void {
  const element = document.getElementById(`turn-${number}`)
  if (!element) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  activeTurn.value = number
}

function openDrawer(turn: Turn, item: Apparatus): void {
  selected.value = { item, turn }
}

function closeDrawer(): void {
  selected.value = null
}

function requestDelete(): void {
  window.clearTimeout(confirmTimer)
  if (confirmingDelete.value) {
    void performDelete()
    return
  }
  confirmingDelete.value = true
  confirmTimer = window.setTimeout(() => {
    confirmingDelete.value = false
  }, 4200)
}

async function performDelete(): Promise<void> {
  if (!summary.value) return
  deleting.value = true
  try {
    await shareClient.remove(summary.value.id)
    push(shareClient.mode === 'remote' ? '存档已删除，地址不再返回内容。' : '存档已从本机移除。')
    await router.replace({ name: 'archive' })
  } catch (error) {
    push(error instanceof Error ? error.message : '删除失败，请再试一次。', 'error')
    deleting.value = false
  }
}

function updateReading(): void {
  const element = recordEl.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const start = window.scrollY + rect.top
  const readLine = window.scrollY + window.innerHeight * 0.38
  const height = Math.max(1, element.offsetHeight)
  progress.value = Math.min(100, Math.max(0, ((readLine - start) / height) * 100))

  let current = turns.value[0]?.number ?? 1
  for (const turn of turns.value) {
    const node = document.getElementById(anchorId(turn))
    if (node && node.getBoundingClientRect().top <= window.innerHeight * 0.4) {
      current = turn.number
    }
  }
  activeTurn.value = current
}

function onScroll(): void {
  if (scrollTicking) return
  scrollTicking = true
  window.requestAnimationFrame(() => {
    updateReading()
    scrollTicking = false
  })
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  doc.value = null
  summary.value = null
  selected.value = null
  try {
    const snapshot = await shareClient.get(props.id)
    summary.value = snapshot.summary
    doc.value = snapshot.document
    previousTitle = document.title
    document.title = `${snapshot.summary.title} · 边注`
    await nextTick()
    updateReading()
  } catch (error) {
    loadError.value = {
      code: error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'not_found',
      message: error instanceof Error ? error.message : '读取这份存档时出错。',
      details:
        error instanceof Error && 'details' in error && Array.isArray((error as { details: unknown }).details)
          ? ((error as { details: string[] }).details ?? [])
          : [],
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  previousTitle = document.title
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  void load()
})

watch(
  () => props.id,
  () => {
    void load()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  window.clearTimeout(copyTimer)
  window.clearTimeout(confirmTimer)
  document.title = previousTitle || '边注 · 会话存档'
})
</script>

<template>
  <div v-if="loading" class="reader-page">
    <div class="reader-loading" aria-label="正在读取存档">
      <span class="skeleton-line" />
      <span class="skeleton-line" />
      <span class="skeleton-line" />
    </div>
  </div>

  <div v-else-if="loadError || !doc || !summary" class="reader-page">
    <div class="reader-state">
      <div class="reader-state-inner">
        <p class="reader-state-code">SNAPSHOT / {{ loadError?.code ?? '404' }}</p>
        <h1>{{ shareClient.mode === 'remote' ? '这份存档不可读。' : '这份存档不在这台设备上。' }}</h1>
        <p>
          {{ loadError?.message ?? '没有找到这份会话存档。' }}
          <template v-if="shareClient.mode === 'remote'">地址可能已被撤回、删除，或已过保留期。</template>
          <template v-else>本机存档只存在当前浏览器；如果链接来自别人的托管，需要等服务端接入后再打开。</template>
        </p>
        <ul v-if="loadError?.details.length" class="reader-error-details">
          <li v-for="detail in loadError.details" :key="detail">{{ detail }}</li>
        </ul>
        <div class="reader-state-actions">
          <RouterLink class="btn btn-primary" to="/archive">回到存档</RouterLink>
          <button class="btn btn-quiet" type="button" @click="load">重新读取</button>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="reader-page">
    <div class="reading-progress" :style="{ width: `${progress}%` }" aria-hidden="true" />

    <div class="reader-layout">
      <nav class="turn-nav" aria-label="轮次导航">
        <span class="turn-nav-label">轮次</span>
        <ol class="turn-nav-list">
          <li v-for="turn in turns" :key="turn.id">
            <button
              class="turn-nav-button"
              :class="{ 'is-active': activeTurn === turn.number }"
              type="button"
              :aria-label="`跳到第 ${turn.number} 轮`"
              :aria-current="activeTurn === turn.number ? 'true' : undefined"
              @click="scrollToTurn(turn.number)"
            >
              {{ padNumber(turn.number) }}
            </button>
          </li>
        </ol>
      </nav>

      <div ref="recordEl" class="record">
        <header class="record-header">
          <div class="record-kicker">
            <span class="kicker-mark">会话存档</span>
            <span class="local-badge">{{ isDemo ? '示例 · 原生快照' : '原生快照' }}</span>
            <span class="id">{{ summary.id }}</span>
          </div>
          <h1 class="record-title">{{ doc.title }}</h1>
          <div class="record-deck">
            <span>{{ generatedLabel }}</span>
            <span class="dot" aria-hidden="true" />
            <span class="mono">会话 {{ sessionLabel }}</span>
            <template v-if="source?.preset">
              <span class="dot" aria-hidden="true" />
              <span>预设 {{ source.preset }}</span>
            </template>
            <template v-if="recordPath">
              <span class="dot" aria-hidden="true" />
              <span class="path">目录 {{ recordPath }}</span>
            </template>
          </div>

          <div class="record-stats">
            <div v-for="stat in stats" :key="stat.label" class="record-stat">
              <div class="record-stat-value">{{ stat.value }}<small>{{ stat.unit }}</small></div>
              <div class="record-stat-label">{{ stat.label }}</div>
            </div>
          </div>

          <div class="record-actions">
            <button class="btn btn-quiet" type="button" @click="copyAll">复制对话正文</button>
            <button class="btn btn-ghost" type="button" @click="downloadSnapshot">下载快照 JSON</button>
          </div>

          <p v-for="warning in warnings" :key="warning" class="record-warning">{{ warning }}</p>

          <div v-if="doc.emptySelection" class="empty-selection">
            <strong>发布时没有选择任何消息。</strong>
            这份快照只保留了空选择状态，没有可阅读的发言。请回到 DSH 分享菜单重新选择条目后再发布。
          </div>
        </header>

        <section
          v-for="turn in turns"
          :id="anchorId(turn)"
          :key="turn.id"
          class="turn"
          :data-turn="turn.number"
        >
          <div class="turn-head">
            <span class="turn-index">第 {{ padNumber(turn.number) }} 轮</span>
            <span class="turn-rule" aria-hidden="true" />
            <span class="turn-count">
              {{ turn.messages.length }} 条发言<template v-if="apparatusCount(turn)"> · {{ apparatusCount(turn) }} 条旁注</template>
            </span>
          </div>

          <article
            v-for="(message, messageIndex) in turn.messages"
            :key="message.id"
            class="message"
            :class="{
              'message-user': message.role === 'user',
              'message-assistant': message.role === 'assistant',
              'is-continuation': message.role === 'assistant' && messageIndex > 0,
              'is-interjection': isInterjection(turn, messageIndex),
            }"
          >
            <div class="speaker">
              <span class="speaker-mark" aria-hidden="true" />
              <span>{{ speakerLabel(turn, messageIndex) }}</span>
            </div>
            <p v-if="isInterjection(turn, messageIndex)" class="interjection-note">
              这条消息发生在思考或工具执行期间，正文按事件顺序保留。
            </p>
            <div class="md message-content" v-html="renderMarkdown(message.markdown)" />
            <button class="message-copy" type="button" :aria-label="`复制${message.role === 'user' ? '用户' : '助手'}消息`" @click="copyMessage(message)">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="5" y="5" width="7.5" height="8" rx="1" />
                <path d="M3.5 10.5V3.2c0-.4.3-.7.7-.7h6" />
              </svg>
              {{ copiedMessageId === message.id ? '已复制' : '复制' }}
            </button>
          </article>

          <details
            v-if="turn.apparatus.length || turn.reasoningOmitted"
            class="apparatus"
            :aria-label="`第 ${turn.number} 轮旁注`"
          >
            <summary class="apparatus-head">
              <span class="apparatus-name">旁注 / APPARATUS</span>
              <span class="apparatus-summary">{{ apparatusSummary(turn) }}</span>
              <span class="apparatus-toggle">
                <span class="when-closed">展开</span>
                <span class="when-open">收起</span>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3 3.5-3" /></svg>
              </span>
            </summary>
            <div class="apparatus-body">
              <details
                v-for="group in apparatusGroups(turn)"
                :key="group.type"
                class="trace-group"
                :open="group.items.length <= 4"
              >
                <summary class="trace-group-head">
                  <span class="trace-group-label">{{ group.label }}</span>
                  <span class="mono trace-group-count">{{ padNumber(group.items.length) }}</span>
                  <svg class="trace-group-arrow" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4.5 6.5 3.5 3 3.5-3" />
                  </svg>
                </summary>
                <div class="trace-list">
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    class="trace-row"
                    type="button"
                    :aria-label="`展开旁注：${itemLabel(item)}`"
                    @click="openDrawer(turn, item)"
                  >
                    <span class="trace-index">{{ padNumber(item.index) }}</span>
                    <span class="trace-main">
                      <span class="trace-name">{{ itemLabel(item) }}</span>
                      <span class="trace-meta">{{ itemMeta(item) }}</span>
                    </span>
                    <span class="trace-status" :class="{ 'is-error': itemIsError(item) }">
                      {{ itemStatus(item) }}
                      <svg class="trace-arrow" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
                      </svg>
                    </span>
                  </button>
                </div>
              </details>
              <p v-if="turn.reasoningOmitted" class="trace-note">
                思考过程另有 {{ turn.reasoningOmitted.count }} 段，发布时按「计数」模式省略。
              </p>
            </div>
          </details>
        </section>

        <details v-if="doc.internal" class="internal-fold">
          <summary>
            <span class="internal-title">内部事件</span>
            <span class="mono">{{ doc.internal.count }} 条 · 仅计数</span>
          </summary>
          <div class="internal-body">
            <ul>
              <li v-for="event in doc.internal.events" :key="event.type">
                <code>{{ event.type }}</code>
                <span class="mono">× {{ event.count }}</span>
              </li>
            </ul>
            <p v-if="doc.internal.note" class="internal-note">{{ doc.internal.note }}</p>
          </div>
        </details>

        <footer class="record-end">
          <div class="endnote-head">
            <h2>记录边界</h2>
            <span class="mono">{{ counts?.events ?? '—' }} 事件 · {{ formatBytes(snapshotBytes) }}</span>
          </div>
          <p class="endnote-body">{{ endnote }}</p>
          <div class="endnote-actions">
            <RouterLink class="text-link" to="/archive">回到存档</RouterLink>
            <button class="text-link" type="button" @click="downloadSnapshot">下载快照 JSON</button>
          </div>
        </footer>
      </div>

      <aside class="record-aside" aria-label="存档信息">
        <div class="aside-panel">
          <div class="aside-title">存档信息 <span class="mono">READ</span></div>
          <dl class="aside-facts">
            <div class="aside-fact">
              <dt>记录 ID</dt>
              <dd class="mono">{{ summary.id }}</dd>
            </div>
            <div class="aside-fact">
              <dt>生成时间</dt>
              <dd>{{ generatedLabel }}</dd>
            </div>
            <div class="aside-fact">
              <dt>生成器</dt>
              <dd>{{ source?.generator ?? '未标注' }}</dd>
            </div>
            <div class="aside-fact">
              <dt>快照</dt>
              <dd>{{ formatBytes(snapshotBytes) }} · {{ counts?.events ?? '—' }} 事件</dd>
            </div>
            <div class="aside-fact">
              <dt>可见性</dt>
              <dd>{{ shareClient.mode === 'remote' ? '已发布 · 持链接可读' : isDemo ? '示例 · 本地只读' : '仅本机 · 未发布' }}</dd>
            </div>
            <div v-if="picked !== null" class="aside-fact">
              <dt>选择</dt>
              <dd>{{ picked }} / {{ totalEntries ?? '—' }} 条</dd>
            </div>
            <div v-if="redactions !== null" class="aside-fact">
              <dt>脱敏</dt>
              <dd>{{ redactions }} 处</dd>
            </div>
          </dl>

          <div class="aside-divider" />

          <p class="aside-note">
            <strong>旁注是按需展开的证据。</strong>上下文按原文保留，推理与工具记录不进入主栏；每一条都来自同一份快照。
          </p>

          <div class="aside-actions">
            <button class="aside-link" type="button" @click="downloadSnapshot">
              下载快照 JSON
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7M4.8 6.8 8 10l3.2-3.2M3 12.5h10" /></svg>
            </button>
            <button class="aside-link" type="button" @click="copyLink">
              复制存档链接
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.4 9.6 9.6 6.4M5.2 8.2l-1 .9a2.6 2.6 0 0 0 3.7 3.7l.9-1M10.8 7.8l1-.9a2.6 2.6 0 0 0-3.7-3.7l-.9 1" /></svg>
            </button>
          </div>

          <div class="aside-progress">
            <div class="mono">阅读进度 {{ Math.round(progress) }}%</div>
            <div class="aside-progress-track"><div class="aside-progress-fill" :style="{ width: `${progress}%` }" /></div>
          </div>

          <template v-if="canDelete">
            <div class="aside-divider" />
            <button v-if="!confirmingDelete" class="aside-danger" type="button" @click="requestDelete">{{ shareClient.mode === 'remote' ? '删除这份存档' : '从本机删除这份存档' }}</button>
            <div v-else class="aside-confirm">
              <p>删除后无法恢复。确认移除？</p>
              <div>
                <button class="aside-confirm-yes" type="button" :disabled="deleting" @click="performDelete">
                  {{ deleting ? '移除中…' : '确认删除' }}
                </button>
                <button class="aside-confirm-no" type="button" @click="confirmingDelete = false">保留</button>
              </div>
            </div>
          </template>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <Transition name="drawer" appear :duration="{ enter: 420, leave: 240 }">
        <EvidenceDrawer
          v-if="selected"
          :key="selected.item.id"
          :item="selected.item"
          :turn-number="selected.turn.number"
          @close="closeDrawer"
        />
      </Transition>
    </Teleport>
  </div>
</template>
