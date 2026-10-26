import { computed, ref, watch } from 'vue'

export type ThemeMode = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'margin-theme'
const ORDER: ThemeMode[] = ['auto', 'light', 'dark']

function readMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'auto') return value
  } catch {
    // storage can be unavailable in private windows
  }
  return 'auto'
}

const media = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(media.matches)
const mode = ref<ThemeMode>(readMode())
const resolved = computed<ResolvedTheme>(() => {
  if (mode.value === 'auto') return systemDark.value ? 'dark' : 'light'
  return mode.value
})

function apply(): void {
  const root = document.documentElement
  root.dataset.theme = resolved.value
  root.style.colorScheme = resolved.value
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

let initialApply = true

function applyWithMotion(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const transitionDocument = document as ViewTransitionDocument
  if (initialApply || reduced || typeof transitionDocument.startViewTransition !== 'function') {
    apply()
    initialApply = false
    return
  }
  initialApply = false
  transitionDocument.startViewTransition(() => {
    apply()
  })
}

watch(resolved, applyWithMotion, { immediate: true })

watch(mode, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore
  }
})

media.addEventListener('change', (event) => {
  systemDark.value = event.matches
})

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return
  const next = event.newValue
  if (next === 'auto' || next === 'light' || next === 'dark') mode.value = next
})

export function useTheme() {
  const label = computed(() => {
    if (mode.value === 'auto') return '自动'
    return mode.value === 'light' ? '浅色' : '深色'
  })

  function cycle(): void {
    const index = ORDER.indexOf(mode.value)
    mode.value = ORDER[(index + 1) % ORDER.length]
  }

  return { mode, resolved, label, cycle }
}
