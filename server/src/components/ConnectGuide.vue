<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { copyText } from '../lib/clipboard'
import { useToast } from '../composables/useToast'

const props = withDefaults(defineProps<{ signedIn?: boolean; host?: string }>(), {
  signedIn: false,
  host: '',
})

const toast = useToast()
const hostLabel = computed(() => props.host || (typeof window !== 'undefined' ? window.location.origin : 'https://margin.example.com'))

async function copyHost(): Promise<void> {
  const ok = await copyText(hostLabel.value)
  toast.push(ok ? '主机地址已复制' : '浏览器拒绝了剪贴板访问', ok ? 'neutral' : 'error')
}
</script>

<template>
  <section class="connect-guide" aria-labelledby="connect-guide-title">
    <div class="connect-guide-head">
      <div>
        <p class="account-panel-kicker">CONNECT A LOCAL DSH</p>
        <h2 id="connect-guide-title">把本地 DSH 接到边注。</h2>
      </div>
      <p>
        不需要上传文件，也不用手动复制会话。插件在本地整理好记录，再用你的个人令牌交给边注。
      </p>
    </div>

    <ol class="connect-steps">
      <li>
        <span class="connect-num mono">01</span>
        <div class="connect-step-body">
          <h3>生成一枚令牌</h3>
          <p>在「连接与令牌」里给这台机器起个名字，生成后立即复制。完整令牌只显示一次。</p>
          <RouterLink v-if="signedIn" class="connect-step-link" to="/tokens">打开令牌页 →</RouterLink>
          <RouterLink v-else class="connect-step-link" :to="{ name: 'login', query: { redirect: '/tokens' } }">登录后生成 →</RouterLink>
        </div>
        <span class="connect-tag mono">mgn_tk_…</span>
      </li>
      <li>
        <span class="connect-num mono">02</span>
        <div class="connect-step-body">
          <h3>在插件里填写连接</h3>
          <p>打开任意会话，在头部点分享按钮，选择「连接设置」。填入下面的主机地址和令牌，保存并测试。</p>
        </div>
        <span class="connect-tag mono">HOST + TOKEN</span>
      </li>
      <li>
        <span class="connect-num mono">03</span>
        <div class="connect-step-body">
          <h3>发布到边注</h3>
          <p>在同一个菜单里选择「发布到边注」。完成后会得到一个只读地址，可以在「我的分享」里撤回。</p>
        </div>
        <span class="connect-tag mono">/s/…</span>
      </li>
    </ol>

    <div class="connect-host">
      <div class="connect-host-value">
        <span class="mono">HOST</span>
        <strong>{{ hostLabel }}</strong>
      </div>
      <button type="button" class="connect-copy" @click="copyHost">复制主机地址</button>
    </div>

    <p class="connect-note">
      令牌只保存在这台机器的 DSH 里，不写进分享链接，也不会出现在阅读页。
      如果令牌丢失，重新生成一枚即可；旧令牌可以单独停用。
    </p>
  </section>
</template>
