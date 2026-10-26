<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import ToastHost from './components/ToastHost.vue'
import { REMOTE_MODE } from './config'

const route = useRoute()
const bare = computed(() => route.meta.bare === true)
// 示例记录链接只在本地预览模式提供；部署构建没有演示数据。
const showDemo = !REMOTE_MODE
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell-bare': bare }">
    <AppHeader v-if="!bare" />
    <main id="main" class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>
    <footer v-if="!bare" class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <span class="footer-word">边注</span>
          <span class="footer-note">把会话留成一份可读、可撤回的记录。整理与脱敏在 DSH 本地完成。</span>
        </div>
        <div class="footer-links">
          <RouterLink to="/">首页</RouterLink>
          <span aria-hidden="true">·</span>
          <RouterLink to="/archive">我的分享</RouterLink>
          <span aria-hidden="true">·</span>
          <RouterLink to="/connect">插件接入</RouterLink>
          <template v-if="showDemo">
            <span aria-hidden="true">·</span>
            <RouterLink to="/s/demo-spectral">示例记录</RouterLink>
          </template>
          <span aria-hidden="true">·</span>
          <span>dsh-plugin-session-share</span>
        </div>
      </div>
    </footer>
    <ToastHost />
  </div>
</template>
