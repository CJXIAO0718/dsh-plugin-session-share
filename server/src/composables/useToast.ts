import { ref } from 'vue'

export interface ToastItem {
  id: number
  message: string
  tone: 'neutral' | 'error'
}

const items = ref<ToastItem[]>([])
let nextId = 1

function dismiss(id: number): void {
  items.value = items.value.filter((item) => item.id !== id)
}

function push(message: string, tone: ToastItem['tone'] = 'neutral'): void {
  const id = nextId
  nextId += 1
  items.value = [...items.value.slice(-2), { id, message, tone }]
  window.setTimeout(() => dismiss(id), 3200)
}

export function useToast() {
  return { items, push, dismiss }
}
