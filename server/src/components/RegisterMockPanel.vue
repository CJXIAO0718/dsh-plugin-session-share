<script setup lang="ts">
// 注册页的“本地预览模式”面板。仅在 mock 模式被动态加载。
import { onMounted, ref } from 'vue'

const emit = defineEmits<{ fill: [inviteCode: string] }>()

const invite = ref('')

onMounted(async () => {
  const module = await import('../auth/mockAuth')
  invite.value = module.DEMO_INVITE
})

function fill(): void {
  if (!invite.value) return
  emit('fill', invite.value)
}
</script>

<template>
  <div class="login-demo">
    <div class="login-demo-head">
      <span class="login-demo-dot" aria-hidden="true"></span>
      <span>本地预览模式</span>
      <span class="mono">MOCK ACCOUNT</span>
    </div>
    <p>演示环境里可以填入一个可用邀请码；新账号会保存在这台浏览器，刷新后仍能登录。</p>
    <div class="login-demo-actions">
      <button type="button" @click="fill">填入可用邀请码</button>
    </div>
  </div>
</template>
