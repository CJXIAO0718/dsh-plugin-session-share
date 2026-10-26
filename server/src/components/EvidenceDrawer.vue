<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Apparatus } from '../parser/types'
import { renderMarkdown } from '../markdown/renderMarkdown'
import { copyText } from '../lib/clipboard'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  item: Apparatus
  turnNumber: number
}>()

const emit = defineEmits<{
  close: []
}>()

const { push } = useToast()
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const copied = ref(false)
const argsExpanded = ref(false)
const resultExpanded = ref(false)
const reasoningExpanded = ref(false)
const contextExpanded = ref(false)

const LONG_PREVIEW = 2200
const REASONING_PREVIEW = 900
const CONTEXT_PREVIEW = 2600

let previousFocus: HTMLElement | null = null
let previousOverflow = ''

const titleId = 'evidence-drawer-title'

const kicker = computed(() => `旁注 / 第 ${String(props.turnNumber).padStart(2, '0')} 轮`)

const title = computed(() => {
  if (props.item.type === 'context') return '内联上下文'
  if (props.item.type === 'reasoning') return '思考过程'
  return props.item.name
})

const subtitle = computed(() => {
  const item = props.item
  if (item.type === 'context') {
    return [`第 ${item.index} 条`, item.chars ? `${item.chars} 字` : '', item.reason]
      .filter(Boolean)
      .join(' · ')
  }
  if (item.type === 'reasoning') {
    return [`第 ${item.index} 段`, item.chars ? `${item.chars} 字` : ''].filter(Boolean).join(' · ')
  }
  return [`第 ${item.index} 次调用`, item.meta].filter(Boolean).join(' · ')
})

const copyValue = computed(() => {
  const item = props.item
  if (item.type === 'context') return item.text
  if (item.type === 'reasoning') return item.markdown
  const chunks = [item.args ? `参数\n${item.args}` : '', item.result ? `结果\n${item.result}` : '']
  return chunks.filter(Boolean).join('\n\n') || item.summary
})

function preview(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const lineBreak = cut.lastIndexOf('\n')
  const clean = lineBreak > limit * 0.55 ? cut.slice(0, lineBreak) : cut
  return `${clean}\n…`
}

function close(): void {
  emit('close')
}

async function copy(): Promise<void> {
  const ok = await copyText(copyValue.value)
  copied.value = ok
  if (!ok) push('复制失败，请手动选择文本。', 'error')
  window.setTimeout(() => {
    copied.value = false
  }, 1800)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  const focusables = Array.from(
    panel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], textarea, input, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null)
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  void nextTick(() => closeButton.value?.focus())
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = previousOverflow
  previousFocus?.focus({ preventScroll: true })
})
</script>

<template>
  <div class="drawer-root">
    <div class="drawer-backdrop" @click="close" />
    <aside
      ref="panel"
      class="drawer-panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
    >
      <header class="drawer-head">
        <div>
          <p class="drawer-kicker">{{ kicker }}</p>
          <h2 :id="titleId" class="drawer-title">{{ title }}</h2>
          <p class="drawer-sub">{{ subtitle }}</p>
        </div>
        <button ref="closeButton" class="drawer-close" type="button" aria-label="关闭旁注" @click="close">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
          </svg>
        </button>
      </header>

      <div class="drawer-body">
        <template v-if="item.type === 'context'">
          <section class="drawer-section">
            <div class="drawer-section-label">
              <span>原始上下文</span>
              <span class="mono">按原样呈现 · 不解析 Markdown</span>
            </div>
            <pre class="context-raw">{{ contextExpanded || item.text.length <= CONTEXT_PREVIEW ? item.text : preview(item.text, CONTEXT_PREVIEW) }}</pre>
            <button
              v-if="item.text.length > CONTEXT_PREVIEW"
              class="long-toggle"
              type="button"
              @click="contextExpanded = !contextExpanded"
            >
              {{ contextExpanded ? '收起上下文' : `展开完整上下文 · ${item.text.length} 字符` }}
            </button>
          </section>
          <p class="drawer-note">这段文字是系统在发布时归入「内联上下文」的内容，不是用户说出口的话。</p>
        </template>

        <template v-else-if="item.type === 'reasoning'">
          <section class="drawer-section">
            <div class="reasoning-segment">
              <div class="reasoning-segment-head">
                <span>第 {{ item.index }} 段</span>
                <span v-if="item.chars" class="mono">{{ item.chars }} 字</span>
              </div>
              <template v-if="item.markdown.length > REASONING_PREVIEW && !reasoningExpanded">
                <p class="long-teaser">{{ preview(item.markdown, REASONING_PREVIEW) }}</p>
                <button class="long-toggle" type="button" @click="reasoningExpanded = true">
                  展开完整思考 · {{ item.chars || item.markdown.length }} 字
                </button>
              </template>
              <template v-else>
                <div class="md" v-html="renderMarkdown(item.markdown)" />
                <button
                  v-if="item.markdown.length > REASONING_PREVIEW"
                  class="long-toggle"
                  type="button"
                  @click="reasoningExpanded = false"
                >
                  收起思考
                </button>
              </template>
            </div>
          </section>
          <p class="drawer-note">思考过程是模型内部记录，只作为旁注保存；它不属于对话正文。</p>
        </template>

        <template v-else>
          <section class="drawer-section">
            <div class="drawer-section-label">
              <span>工具调用</span>
              <span class="tool-state" :class="{ 'is-error': item.error }">{{ item.error ? '出错' : '完成' }}</span>
            </div>

            <div v-if="item.args !== null" class="tool-field">
              <div class="tool-field-head">
                <span>参数</span>
                <span class="mono">
                  {{
                    item.argsTruncated
                      ? `已截断 · 原始 ${item.argsTruncated.original} 字符`
                      : `${item.args.length} 字符`
                  }}
                </span>
              </div>
              <pre class="tool-pre">{{ argsExpanded || item.args.length <= LONG_PREVIEW ? (item.args || '（空参数）') : preview(item.args, LONG_PREVIEW) }}</pre>
              <button
                v-if="item.args.length > LONG_PREVIEW"
                class="long-toggle"
                type="button"
                @click="argsExpanded = !argsExpanded"
              >
                {{ argsExpanded ? '收起参数' : `展开完整参数 · ${item.args.length} 字符` }}
              </button>
            </div>

            <div v-if="item.result !== null" class="tool-field">
              <div class="tool-field-head">
                <span>结果</span>
                <span class="mono">
                  {{
                    item.resultTruncated
                      ? `已截断 · 原始 ${item.resultTruncated.original} 字符`
                      : `${item.result.length} 字符`
                  }}
                </span>
              </div>
              <pre class="tool-pre" :class="{ 'is-error': item.error }">{{ resultExpanded || item.result.length <= LONG_PREVIEW ? (item.result || '（空结果）') : preview(item.result, LONG_PREVIEW) }}</pre>
              <button
                v-if="item.result.length > LONG_PREVIEW"
                class="long-toggle"
                type="button"
                @click="resultExpanded = !resultExpanded"
              >
                {{ resultExpanded ? '收起结果' : `展开完整结果 · ${item.result.length} 字符` }}
              </button>
            </div>

            <div v-if="item.noResult" class="tool-missing">该工具调用没有配对的 tool/result 事件，发布时只能保留调用本身。</div>

            <p v-if="item.argsTruncated" class="drawer-note">
              参数在发布时被截断：仅保留前 {{ item.argsTruncated.shown }} 字符，原文共
              {{ item.argsTruncated.original }} 字符。
            </p>
            <p v-if="item.resultTruncated" class="drawer-note">
              结果在发布时被截断：仅保留前 {{ item.resultTruncated.shown }} 字符，原文共
              {{ item.resultTruncated.original }} 字符。
            </p>
          </section>
        </template>
      </div>

      <footer class="drawer-foot">
        <span>旁注来自发布快照，阅读器未改写内容。</span>
        <button class="drawer-copy" type="button" @click="copy">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5" y="5" width="7.5" height="8" rx="1" />
            <path d="M3.5 10.5V3.2c0-.4.3-.7.7-.7h6" />
          </svg>
          {{ copied ? '已复制' : '复制原文' }}
        </button>
      </footer>
    </aside>
  </div>
</template>
