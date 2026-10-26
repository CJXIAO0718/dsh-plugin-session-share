<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { items, dismiss } = useToast()
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div
        v-for="item in items"
        :key="item.id"
        class="toast"
        :class="{ 'is-error': item.tone === 'error' }"
        role="status"
      >
        <span class="toast-dot" aria-hidden="true"></span>
        <span class="toast-text">{{ item.message }}</span>
        <button class="toast-close" type="button" aria-label="关闭提示" @click="dismiss(item.id)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
