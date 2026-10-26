<script setup lang="ts">
import { ref } from 'vue'
import { copyText } from '../lib/clipboard'
import { useToast } from '../composables/useToast'

defineProps<{
  code: string
  label?: string
}>()

const { push } = useToast()
const copied = ref(false)

async function copy(code: string): Promise<void> {
  const ok = await copyText(code)
  copied.value = ok
  if (!ok) push('复制失败，请手动选择文本。', 'error')
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}
</script>

<template>
  <figure class="api-code">
    <figcaption>
      <span>{{ label ?? 'example' }}</span>
      <button type="button" @click="copy(code)">{{ copied ? '已复制' : '复制' }}</button>
    </figcaption>
    <pre><code>{{ code }}</code></pre>
  </figure>
</template>
