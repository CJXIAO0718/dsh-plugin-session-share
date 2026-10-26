<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ConnectGuide from '../components/ConnectGuide.vue'
import { useAuth } from '../auth/useAuth'
import { REMOTE_MODE } from '../config'

const { state } = useAuth()
const signedIn = computed(() => Boolean(state.user))
// 示例记录只在本地预览模式提供；部署构建没有演示数据。
const showDemo = !REMOTE_MODE
</script>

<template>
  <div class="connect-page">
    <section class="connect-hero container">
      <div class="connect-hero-copy">
        <p class="account-kicker"><span></span>PLUGIN / CONNECT</p>
        <h1>把 DSH 接到边注，<br /><em>只需要两步。</em></h1>
        <p class="connect-lede">
          生成一枚个人令牌，在插件里填入主机地址与令牌。之后，会话头部会多出「发布到边注」；
          整理、脱敏和选择仍然发生在你的机器上。
        </p>
        <div class="home-actions">
          <RouterLink
            v-if="signedIn"
            class="btn btn-primary"
            to="/tokens"
          >生成令牌</RouterLink>
          <RouterLink
            v-else
            class="btn btn-primary"
            :to="{ name: 'login', query: { redirect: '/tokens' } }"
          >登录后生成令牌</RouterLink>
          <RouterLink v-if="showDemo" class="btn btn-quiet" to="/s/demo-spectral">先读一份示例</RouterLink>
          <RouterLink v-else class="btn btn-quiet" to="/">先看看边注是什么</RouterLink>
        </div>
        <ul class="home-facts" aria-label="连接要点">
          <li>令牌只显示一次</li>
          <li>主机地址可随时更换</li>
          <li>停用令牌不会删除记录</li>
        </ul>
      </div>

      <aside class="connect-slip" aria-label="连接凭据示意">
        <div class="connect-slip-top">
          <span class="mono">CONNECTION SLIP</span>
          <span class="mono">NO. 0421</span>
        </div>
        <div class="connect-slip-rule"></div>
        <p class="connect-slip-label">主机地址</p>
        <code class="connect-slip-host">margin.example.com</code>
        <p class="connect-slip-label">个人令牌</p>
        <code class="connect-slip-token">mgn_tk_••••••••e41c</code>
        <div class="connect-slip-status">
          <span class="connect-slip-dot"></span>
          <span>等待在插件里填写</span>
        </div>
        <div class="connect-slip-stamp" aria-hidden="true">连接</div>
      </aside>
    </section>

    <div class="container">
      <ConnectGuide :signed-in="signedIn" />
    </div>

    <section class="connect-faq container">
      <div class="connect-faq-head">
        <p class="account-kicker"><span></span>BEFORE YOU CONNECT</p>
        <h2>连接之前，先知道这些。</h2>
      </div>
      <dl class="connect-faq-list">
        <div>
          <dt>需要安装什么？</dt>
          <dd>DSH 里的 <code>dsh-plugin-session-share</code>。安装后，分享菜单会出现在每个会话的头部。</dd>
        </div>
        <div>
          <dt>令牌和登录密码有什么区别？</dt>
          <dd>令牌只用来让插件发布和管理记录，不能登录网页；随时可以单独停用，不必改密码。</dd>
        </div>
        <div>
          <dt>管理员能看到我的记录吗？</dt>
          <dd>管理员看到容量、保留期和上传节奏等整体情况，不逐条撤回，也不替你决定记录该给谁看。</dd>
        </div>
        <div>
          <dt>发布之后还能改吗？</dt>
          <dd>记录是定稿。要改内容，就在 DSH 里重新发布一份，再决定是否撤回旧地址。</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
