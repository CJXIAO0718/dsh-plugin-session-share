<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{ active: 'shares' | 'tokens' }>()
</script>

<template>
  <nav class="account-tabs" aria-label="我的账户">
    <RouterLink to="/archive" class="account-tab" :class="{ 'is-active': active === 'shares' }">
      <span class="mono">01</span>我的分享
    </RouterLink>
    <RouterLink to="/tokens" class="account-tab" :class="{ 'is-active': active === 'tokens' }">
      <span class="mono">02</span>连接与令牌
    </RouterLink>
    <span class="account-tabs-note mono">INVITE ONLY · LOCAL PREVIEW</span>
  </nav>
</template>
