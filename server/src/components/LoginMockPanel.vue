<script setup lang="ts">
// 登录页的“本地预览模式”面板。仅在 mock 模式被动态加载；
// remote 构建里这个组件（与演示凭据）不会进入代码图。
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const emit = defineEmits<{ fill: [username: string, password: string] }>()

const accounts = ref<Array<{ username: string; password: string; role: string; label: string }>>([])
const invite = ref('')

onMounted(async () => {
  const module = await import('../auth/mockAuth')
  accounts.value = module.DEMO_ACCOUNTS
  invite.value = module.DEMO_INVITE
})

function fill(role: string): void {
  const account = accounts.value.find((item) => item.role === role)
  if (!account) return
  emit('fill', account.username, account.password)
}
</script>

<template>
  <div class="login-demo">
    <div class="login-demo-head">
      <span class="login-demo-dot" aria-hidden="true"></span>
      <span>本地预览模式</span>
      <span class="mono">MOCK AUTH</span>
    </div>
    <p>尚未接入服务端。用下面的通行证预览登录后的界面。</p>
    <div class="login-demo-actions">
      <button type="button" @click="fill('admin')">填入管理员</button>
      <button type="button" @click="fill('member')">填入读者</button>
    </div>
    <p class="login-demo-link">
      还没有账号？
      <RouterLink :to="{ name: 'register', query: invite ? { invite } : undefined }">用演示邀请码注册</RouterLink>
    </p>
  </div>
</template>
