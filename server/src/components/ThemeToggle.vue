<script setup lang="ts">
import { useTheme } from '../composables/useTheme'

const { mode, label, cycle } = useTheme()
</script>

<template>
  <button
    class="theme-toggle"
    type="button"
    :aria-label="`主题：${label}，点击切换`"
    :title="`主题：${label}`"
    @click="cycle"
  >
    <Transition name="theme-icon" mode="out-in">
      <span :key="mode" class="theme-icon" aria-hidden="true">
        <svg v-if="mode === 'auto'" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="5.2" />
          <path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2" />
          <path d="M5.1 5.1 6.5 6.5M14.9 5.1 13.5 6.5M5.1 14.9l1.4-1.4M14.9 14.9l-1.4-1.4" />
        </svg>
        <svg v-else-if="mode === 'light'" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="3.6" />
          <path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M5.1 5.1 6.5 6.5M14.9 5.1 13.5 6.5M5.1 14.9l1.4-1.4M14.9 14.9l-1.4-1.4" />
        </svg>
        <svg v-else viewBox="0 0 20 20">
          <path d="M14.6 12.7A5.8 5.8 0 0 1 7.3 5.4 6.2 6.2 0 1 0 14.6 12.7Z" />
        </svg>
      </span>
    </Transition>
    <span class="theme-toggle-label">{{ label }}</span>
  </button>
</template>
