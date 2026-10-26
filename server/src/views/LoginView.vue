<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useAuth } from '../auth/useAuth'
import { AuthError } from '../auth/types'

const route = useRoute()
const router = useRouter()
const { state, mode, signIn } = useAuth()

// 演示面板只在本地预览模式加载；remote 构建不携带演示凭据。
const MockPanel = mode === 'mock' ? defineAsyncComponent(() => import('../components/LoginMockPanel.vue')) : null

const username = ref('')
const password = ref('')
const remember = ref(false)
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const capsLock = ref(false)
const lockedUntil = ref(0)
const now = ref(Date.now())
const stamped = ref(false)
const usernameInput = ref<HTMLInputElement | null>(null)

const remaining = computed(() => Math.max(0, Math.ceil((lockedUntil.value - now.value) / 1000)))
const locked = computed(() => remaining.value > 0)
const signedIn = computed(() => Boolean(state.user))

const timer = window.setInterval(() => {
  now.value = Date.now()
  if (lockedUntil.value && lockedUntil.value <= now.value) lockedUntil.value = 0
}, 500)

onBeforeUnmount(() => window.clearInterval(timer))

function safeRedirect(): string | null {
  const target = route.query.redirect
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return null
  return target
}

function fillDemo(nextUsername: string, nextPassword: string): void {
  username.value = nextUsername
  password.value = nextPassword
  errorMessage.value = ''
  void nextTick(() => usernameInput.value?.focus())
}

function onKeydown(event: KeyboardEvent): void {
  if (typeof event.getModifierState === 'function') {
    capsLock.value = event.getModifierState('CapsLock')
  }
}

async function onSubmit(): Promise<void> {
  if (submitting.value || locked.value) return
  errorMessage.value = ''

  if (!username.value.trim()) {
    errorMessage.value = '请输入用户名。'
    usernameInput.value?.focus()
    return
  }
  if (!password.value) {
    errorMessage.value = '请输入密码。'
    return
  }

  submitting.value = true
  try {
    const user = await signIn({
      username: username.value,
      password: password.value,
      remember: remember.value,
    })
    stamped.value = true
    await new Promise((resolve) => window.setTimeout(resolve, 520))
    const target = safeRedirect() ?? (user.role === 'admin' ? '/admin' : '/archive')
    await router.replace(target)
  } catch (error) {
    if (error instanceof AuthError) {
      errorMessage.value = error.message
      if (error.code === 'rate_limited' && error.retryAfter > 0) {
        lockedUntil.value = Date.now() + error.retryAfter * 1000
        now.value = Date.now()
      }
    } else {
      errorMessage.value = '入口暂时没有响应，请稍后再试。'
    }
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <header class="login-chrome">
      <RouterLink class="brand" to="/" aria-label="边注首页">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path class="brand-sheet" d="M6.5 3.5h19v25h-19z" />
          <path class="brand-margin" d="M12 3.5v25" />
          <path class="brand-lines" d="M16 9.5h6M16 14h6M16 18.5h4" />
        </svg>
        <span class="brand-word">边注</span>
        <span class="brand-tail">会话托管</span>
      </RouterLink>
      <div class="login-chrome-actions">
        <ThemeToggle />
        <RouterLink class="login-back" to="/">返回首页</RouterLink>
      </div>
    </header>

    <div class="login-grid">
      <aside class="login-intro" aria-label="边注访问说明">
        <div class="login-intro-index mono">ACCESS / 01</div>
        <div class="login-intro-main">
          <p class="login-kicker">边注 · 会话托管</p>
          <h1>先验明身份，<br /><em>再进入档案。</em></h1>
          <p class="login-intro-copy">
            边注采用邀请制。邀请码决定谁能进来，账号由本人创建；管理员只设定整体策略，不介入每条记录。
          </p>
        </div>
        <blockquote class="login-quote">
          “读的人知道记录从哪里来，<br />写的人知道地址交给了谁。”
        </blockquote>
        <ul class="login-rules">
          <li><span class="mono">01</span>邀请码自助创建账号</li>
          <li><span class="mono">02</span>连续失败会暂时锁定</li>
          <li><span class="mono">03</span>会话不会公开索引</li>
        </ul>
      </aside>

      <main class="login-main">
        <div class="login-card">
          <div class="login-card-top">
            <span class="mono">READER'S CARD</span>
            <span class="mono">NO. 0421</span>
          </div>

          <div class="login-card-heading">
            <p class="login-eyebrow">登录 / SIGN IN</p>
            <h2>进入你的档案。</h2>
            <p>用用户名和密码进入。还没有账号，就用邀请码创建一个。</p>
          </div>

          <form class="login-form" novalidate @submit.prevent="onSubmit">
            <label class="login-field" for="login-username">
              <span class="login-field-label">用户名</span>
              <input
                id="login-username"
                ref="usernameInput"
                v-model="username"
                name="username"
                type="text"
                autocomplete="username"
                spellcheck="false"
                placeholder="输入用户名"
                :aria-invalid="Boolean(errorMessage)"
                :disabled="submitting || locked"
                @keydown="onKeydown"
              />
              <span class="login-field-rule"></span>
            </label>

            <div class="login-field">
              <label class="login-field-label" for="login-password">
                密码
                <span v-if="capsLock" class="login-caps">大写锁定已开启</span>
              </label>
              <span class="login-password-wrap">
                <input
                  id="login-password"
                  v-model="password"
                  name="password"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  placeholder="输入密码"
                  :disabled="submitting || locked"
                  @keydown="onKeydown"
                />
                <button
                  class="login-reveal"
                  type="button"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                >
                  <svg v-if="!showPassword" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.5 12s3.4-6.2 9.5-6.2S21.5 12 21.5 12s-3.4 6.2-9.5 6.2S2.5 12 2.5 12Z" />
                    <circle cx="12" cy="12" r="2.8" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 3l18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c6.1 0 9.5 6 9.5 6a17 17 0 0 1-3.3 4M7.2 7.3C4.3 9.2 2.5 12 2.5 12s3.4 6.2 9.5 6.2c1.5 0 2.9-.4 4.1-1" />
                  </svg>
                </button>
              </span>
              <span class="login-field-rule"></span>
            </div>

            <div class="login-options">
              <label class="login-check">
                <input v-model="remember" type="checkbox" :disabled="submitting || locked" />
                <span>保持登录</span>
              </label>
              <span class="login-footnote">忘记密码？联系管理员重置。</span>
            </div>

            <p v-if="errorMessage" class="login-error" role="alert" aria-live="polite">
              <span class="login-error-dot" aria-hidden="true"></span>
              {{ errorMessage }}
              <span v-if="locked" class="mono">（{{ remaining }}s）</span>
            </p>

            <button class="btn btn-primary login-submit" type="submit" :disabled="submitting || locked">
              <span v-if="!submitting">{{ locked ? `入口锁定 ${remaining}s` : '验证并进入' }}</span>
              <span v-else class="login-loading">
                <span class="login-loading-dot"></span>
                正在核对…
              </span>
              <svg v-if="!submitting" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </button>
          </form>

          <component :is="MockPanel" v-if="MockPanel && mode === 'mock'" @fill="fillDemo" />

          <div class="login-card-bottom">
            <p>
              没有账号？访问采用邀请制。
              <RouterLink class="login-register-link" :to="{ name: 'register' }">使用邀请码创建</RouterLink>
            </p>
            <p class="login-card-status"><span aria-hidden="true"></span>会话仅用于本服务，不公开索引</p>
          </div>
        </div>
      </main>
    </div>

    <Transition name="stamp">
      <div v-if="stamped" class="login-stamp-overlay" aria-live="assertive">
        <div class="login-stamp">
          <span class="mono">ACCESS GRANTED</span>
          <strong>准入</strong>
          <small>正在进入{{ signedIn ? '你的档案' : '边注' }}…</small>
        </div>
      </div>
    </Transition>
  </div>
</template>
