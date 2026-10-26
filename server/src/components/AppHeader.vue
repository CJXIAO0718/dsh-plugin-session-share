<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import ThemeToggle from './ThemeToggle.vue'
import { useAuth } from '../auth/useAuth'

const route = useRoute()
const router = useRouter()
const { state, isAdmin, signOut } = useAuth()

const signedIn = computed(() => Boolean(state.user))
const accountActive = computed(() => route.name === 'archive' || route.name === 'tokens' || route.name === 'reader')
const accountTarget = computed(() =>
  signedIn.value ? '/archive' : { name: 'login', query: { redirect: '/archive' } },
)
const landing = computed(() => (isAdmin.value ? '/admin' : '/archive'))
const initial = computed(() => state.user?.name?.slice(0, 1) ?? '·')

async function logout(): Promise<void> {
  await signOut()
  await router.push('/')
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-inner">
      <RouterLink class="brand" to="/" aria-label="边注首页">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path class="brand-sheet" d="M6.5 3.5h19v25h-19z" />
          <path class="brand-margin" d="M12 3.5v25" />
          <path class="brand-lines" d="M16 9.5h6M16 14h6M16 18.5h4" />
        </svg>
        <span class="brand-word">边注</span>
        <span class="brand-tail">会话托管</span>
      </RouterLink>

      <nav class="topnav" aria-label="主导航">
        <RouterLink to="/" class="topnav-link" :class="{ 'is-active': route.name === 'home' }">首页</RouterLink>
        <RouterLink :to="accountTarget" class="topnav-link" :class="{ 'is-active': accountActive }">
          {{ signedIn ? '我的分享' : '存档' }}
        </RouterLink>
        <RouterLink
          to="/connect"
          class="topnav-link topnav-link-extra"
          :class="{ 'is-active': route.name === 'connect' }"
        >插件接入</RouterLink>
        <RouterLink
          v-if="isAdmin"
          to="/admin"
          class="topnav-link topnav-link-extra"
          :class="{ 'is-active': route.name?.toString().startsWith('admin') }"
        >登记处</RouterLink>
      </nav>

      <div class="topbar-actions">
        <RouterLink v-if="!signedIn" class="topbar-login" to="/login">登录</RouterLink>
        <template v-else>
          <RouterLink class="topbar-user" :to="landing">
            <span class="topbar-avatar">{{ initial }}</span>
            <span class="topbar-user-name">{{ state.user?.name }}</span>
            <span v-if="isAdmin" class="topbar-role">管理员</span>
          </RouterLink>
          <button type="button" class="topbar-signout" @click="logout">退出</button>
        </template>
        <ThemeToggle />
      </div>
    </div>
  </header>
</template>
