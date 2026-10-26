<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useAuth } from '../auth/useAuth'
import { AuthError } from '../auth/types'

const route = useRoute()
const router = useRouter()
const { state, mode, signUp } = useAuth()

// 演示面板只在本地预览模式加载；remote 构建不携带演示邀请码。
const MockPanel = mode === 'mock' ? defineAsyncComponent(() => import('../components/RegisterMockPanel.vue')) : null

const inviteCode = ref(typeof route.query.invite === 'string' ? route.query.invite.toUpperCase() : '')
const username = ref('')
const password = ref('')
const confirm = ref('')
const remember = ref(true)
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const capsLock = ref(false)
const stamped = ref(false)
const inviteInput = ref<HTMLInputElement | null>(null)
const usernameInput = ref<HTMLInputElement | null>(null)

const signedIn = computed(() => Boolean(state.user))

onMounted(() => {
  void nextTick(() => {
    if (!inviteCode.value) inviteInput.value?.focus()
    else usernameInput.value?.focus()
  })
})

function onKeydown(event: KeyboardEvent): void {
  if (typeof event.getModifierState === 'function') {
    capsLock.value = event.getModifierState('CapsLock')
  }
}

function fillDemoInvite(code: string): void {
  inviteCode.value = code
  errorMessage.value = ''
  void nextTick(() => usernameInput.value?.focus())
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return
  errorMessage.value = ''

  if (!inviteCode.value.trim()) {
    errorMessage.value = '请填写邀请码。'
    inviteInput.value?.focus()
    return
  }
  if (!/^[a-z0-9_-]{3,24}$/.test(username.value.trim())) {
    errorMessage.value = '用户名需为 3–24 位小写字母、数字、下划线或短横线。'
    return
  }
  if (password.value.length < 8) {
    errorMessage.value = '密码至少需要 8 个字符。'
    return
  }
  if (password.value !== confirm.value) {
    errorMessage.value = '两次输入的密码不一致。'
    return
  }

  submitting.value = true
  try {
    await signUp({
      inviteCode: inviteCode.value,
      username: username.value,
      password: password.value,
      remember: remember.value,
    })
    stamped.value = true
    await new Promise((resolve) => window.setTimeout(resolve, 620))
    await router.replace('/archive')
  } catch (error) {
    if (error instanceof AuthError) {
      errorMessage.value = error.message
    } else {
      errorMessage.value = '暂时无法完成注册，请稍后再试。'
    }
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page register-page">
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
        <RouterLink class="login-back" to="/login">已有账号，登录</RouterLink>
      </div>
    </header>

    <div class="login-grid">
      <aside class="login-intro register-intro" aria-label="注册说明">
        <div class="login-intro-index mono">ACCOUNT / 02</div>
        <div class="login-intro-main">
          <p class="login-kicker">边注 · 新账号</p>
          <h1>先创建账号，<br /><em>再留下你的记录。</em></h1>
          <p class="login-intro-copy">
            用户名就是你在边注里的显示名，创建后用它登录。发布前默认脱敏，地址与记录都归你管理。
          </p>
        </div>
        <blockquote class="login-quote">
          “写的人知道地址交给了谁，<br />读的人知道记录从哪里来。”
        </blockquote>
        <ul class="login-rules">
          <li><span class="mono">01</span>用户名即显示名</li>
          <li><span class="mono">02</span>密码至少 8 个字符</li>
          <li><span class="mono">03</span>发布前默认脱敏</li>
        </ul>
      </aside>

      <main class="login-main">
        <div class="login-card register-card">
          <div class="login-card-top">
            <span class="mono">ACCOUNT</span>
            <span class="mono">NO. 0421</span>
          </div>

          <div class="login-card-heading">
            <p class="login-eyebrow">注册 / CREATE ACCOUNT</p>
            <h2>创建你的账号。</h2>
            <p>用户名就是显示名，创建后用它登录。填好邀请码，设置密码就能开始。</p>
          </div>

          <form class="login-form" novalidate @submit.prevent="onSubmit">
            <label class="login-field" for="register-invite">
              <span class="login-field-label">邀请码</span>
              <input
                id="register-invite"
                ref="inviteInput"
                v-model="inviteCode"
                name="invite"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="例如 MGN-7Q2F-K9M4"
                class="register-invite-input"
                :disabled="submitting"
                @keydown="onKeydown"
              />
              <span class="login-field-rule"></span>
            </label>

            <label class="login-field" for="register-username">
              <span class="login-field-label">
                用户名
                <span class="register-hint">同时作为显示名 · 小写字母、数字、_ 或 -</span>
              </span>
              <input
                id="register-username"
                ref="usernameInput"
                v-model="username"
                name="username"
                type="text"
                autocomplete="username"
                spellcheck="false"
                placeholder="例如 zhouchi"
                :disabled="submitting"
                @keydown="onKeydown"
              />
              <span class="login-field-rule"></span>
            </label>

            <div class="login-field">
              <label class="login-field-label" for="register-password">
                密码
                <span v-if="capsLock" class="login-caps">大写锁定已开启</span>
              </label>
              <span class="login-password-wrap">
                <input
                  id="register-password"
                  v-model="password"
                  name="new-password"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="至少 8 个字符"
                  :disabled="submitting"
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

            <label class="login-field" for="register-confirm">
              <span class="login-field-label">确认密码</span>
              <input
                id="register-confirm"
                v-model="confirm"
                name="confirm-password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="再输入一次"
                :disabled="submitting"
              />
              <span class="login-field-rule"></span>
            </label>

            <div class="login-options">
              <label class="login-check">
                <input v-model="remember" type="checkbox" :disabled="submitting" />
                <span>保持登录</span>
              </label>
              <span class="login-footnote">创建后用户名不可更改。</span>
            </div>

            <p v-if="errorMessage" class="login-error" role="alert" aria-live="polite">
              <span class="login-error-dot" aria-hidden="true"></span>
              {{ errorMessage }}
            </p>

            <button class="btn btn-primary login-submit" type="submit" :disabled="submitting">
              <span v-if="!submitting">创建账号</span>
              <span v-else class="login-loading">
                <span class="login-loading-dot"></span>
                正在创建…
              </span>
              <svg v-if="!submitting" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </button>
          </form>

          <component :is="MockPanel" v-if="MockPanel && mode === 'mock'" @fill="fillDemoInvite" />

          <div class="login-card-bottom">
            <p>已经有账号？<RouterLink class="register-bottom-link" to="/login">去登录</RouterLink></p>
            <p class="login-card-status"><span aria-hidden="true"></span>账号只用于边注，不公开索引</p>
          </div>
        </div>
      </main>
    </div>

    <Transition name="stamp">
      <div v-if="stamped" class="login-stamp-overlay" aria-live="assertive">
        <div class="login-stamp">
          <span class="mono">ACCOUNT CREATED</span>
          <strong>已创建</strong>
          <small>正在{{ signedIn ? '建立你的档案' : '进入边注' }}…</small>
        </div>
      </div>
    </Transition>
  </div>
</template>
