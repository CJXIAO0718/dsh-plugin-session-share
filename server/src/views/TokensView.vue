<script setup lang="ts">
import { computed, ref } from 'vue'
import AccountTabs from '../components/AccountTabs.vue'
import ConnectGuide from '../components/ConnectGuide.vue'
import TokenGenerator from '../components/TokenGenerator.vue'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../composables/useToast'
import { formatDate, formatDateTime } from '../lib/format'
import { hostSettings } from '../admin/settings'
import {
  listTokens,
  maskToken,
  revokeToken,
  scopeLabel,
  tokenStatus,
  type AccessToken,
} from '../account/tokens'

const { state } = useAuth()
const toast = useToast()
const pendingRevoke = ref('')

const user = computed(() => state.user)
const tokens = computed(() => (user.value ? listTokens(user.value.id) : []))
const activeTokens = computed(() => tokens.value.filter((token) => tokenStatus(token) === 'active'))
const lastUsed = computed(() => {
  const values = tokens.value
    .map((token) => token.lastUsedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  return values.at(-1) ?? null
})
const uploadsPerMinute = computed(() => hostSettings.value.uploadsPerMinute)

function statusLabel(token: AccessToken): string {
  const status = tokenStatus(token)
  if (status === 'revoked') return '已停用'
  if (status === 'expired') return '已过期'
  return '可用'
}

function expiryLabel(token: AccessToken): string {
  if (!token.expiresAt) return '不过期'
  const status = tokenStatus(token)
  if (status === 'expired') return `已于 ${formatDate(token.expiresAt)} 过期`
  return `有效至 ${formatDate(token.expiresAt)}`
}

function askRevoke(token: AccessToken): void {
  if (pendingRevoke.value !== token.id) {
    pendingRevoke.value = token.id
    return
  }
  if (!user.value) return
  void revokeToken(user.value.id, token.id)
    .then(() => {
      toast.push('令牌已停用，新的发布请求会被拒绝')
    })
    .catch(() => {
      toast.push('令牌没有停用，请稍后再试', 'error')
    })
  pendingRevoke.value = ''
}
</script>

<template>
  <div class="account-page">
    <div class="container">
      <header class="account-head">
        <div class="account-head-copy">
          <p class="account-kicker"><span></span>CONNECT / 02</p>
          <h1>连接与令牌。</h1>
          <p class="account-lede">
            一串令牌，把本地 DSH 接到这里。它允许插件替你发布记录；完整值只显示一次，
            其余时候页面只保留前后缀。停用后，旧连接立即失效。
          </p>
        </div>
        <div class="account-stats" aria-label="令牌统计">
          <div class="account-stat">
            <span>可用令牌</span>
            <strong>{{ activeTokens.length }}</strong>
            <small>共 {{ tokens.length }} 枚</small>
          </div>
          <div class="account-stat">
            <span>最近使用</span>
            <strong class="account-stat-small">{{ lastUsed ? formatDateTime(lastUsed) : '尚未使用' }}</strong>
            <small>来自插件发布</small>
          </div>
          <div class="account-stat">
            <span>上传节奏</span>
            <strong>{{ uploadsPerMinute }}</strong>
            <small>次发布 / 分钟</small>
          </div>
        </div>
      </header>

      <AccountTabs active="tokens" />

      <div class="account-grid">
        <main class="account-main">
          <TokenGenerator v-if="user" :owner-id="user.id" />

          <section class="token-ledger" aria-labelledby="token-ledger-title">
            <div class="token-ledger-head">
              <div>
                <p class="account-panel-kicker">EXISTING TOKENS</p>
                <h2 id="token-ledger-title">已经发出的令牌。</h2>
              </div>
              <span class="account-toolbar-count mono">{{ tokens.length }} TOTAL</span>
            </div>

            <div class="token-ledger-columns" aria-hidden="true">
              <span class="mono">TOKEN</span>
              <span class="mono">SCOPE</span>
              <span class="mono">LAST USED</span>
              <span class="mono">STATUS</span>
              <span></span>
            </div>

            <ul v-if="tokens.length" class="token-list">
              <li v-for="token in tokens" :key="token.id" class="token-row">
                <div class="token-main">
                  <div class="token-name-line">
                    <strong>{{ token.name }}</strong>
                    <code class="token-mask">{{ maskToken(token) }}</code>
                  </div>
                  <p class="token-meta">
                    创建于 {{ formatDate(token.createdAt) }}
                    <span class="record-dot" aria-hidden="true"></span>
                    {{ expiryLabel(token) }}
                  </p>
                </div>
                <div class="token-scope-list">
                  <span v-for="scope in token.scopes" :key="scope" class="token-scope-tag">{{ scopeLabel(scope) }}</span>
                </div>
                <span class="token-used">{{ token.lastUsedAt ? formatDateTime(token.lastUsedAt) : '尚未使用' }}</span>
                <span
                  class="token-status"
                  :class="{
                    'is-active': tokenStatus(token) === 'active',
                    'is-revoked': tokenStatus(token) === 'revoked',
                    'is-expired': tokenStatus(token) === 'expired',
                  }"
                >{{ statusLabel(token) }}</span>
                <div class="token-actions">
                  <button
                    v-if="tokenStatus(token) === 'active'"
                    type="button"
                    class="record-action"
                    :class="{ 'is-confirming': pendingRevoke === token.id }"
                    @click="askRevoke(token)"
                  >{{ pendingRevoke === token.id ? '确认停用' : '停用' }}</button>
                  <span v-else class="token-used">—</span>
                </div>
              </li>
            </ul>

            <div v-else class="account-empty">
              <p class="account-empty-title">还没有令牌。</p>
              <p>生成一枚，然后把它填进 DSH 插件的连接设置。</p>
            </div>
          </section>
        </main>

        <aside class="account-aside">
          <section class="account-panel">
            <p class="account-panel-kicker">WHAT A TOKEN CAN DO</p>
            <h2>令牌的边界</h2>
            <dl class="account-policy">
              <div>
                <dt>可以</dt>
                <dd>从这台 DSH 发布新记录；按权限撤回或删除自己发布的记录。</dd>
              </div>
              <div>
                <dt>不可以</dt>
                <dd>读取别人的记录，进入管理区，或替代登录密码。</dd>
              </div>
              <div>
                <dt>存放</dt>
                <dd>只保存在本机 DSH；不会写进分享链接或阅读页。</dd>
              </div>
            </dl>
          </section>

          <section class="account-panel account-panel-quiet">
            <p class="account-panel-kicker">IF A TOKEN LEAKS</p>
            <p class="account-policy-note">
              立即在列表里停用。停用不会删除已发布的记录，只是让这串令牌不能再发布或管理。
              然后为那台机器生成一枚新的。
            </p>
          </section>

          <section class="account-panel account-panel-dark">
            <p class="account-panel-kicker">PLUGIN SETUP</p>
            <h2>还没有连接过？</h2>
            <p class="account-policy-note">从生成令牌到发布第一条记录，下面有完整的三步。</p>
            <a class="account-panel-link" href="#connect-guide-title">看接入步骤 →</a>
          </section>
        </aside>
      </div>

      <ConnectGuide :signed-in="true" />
    </div>
  </div>
</template>
