<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AccountTabs from '../components/AccountTabs.vue'
import { useAuth } from '../auth/useAuth'
import { formatBytes, shortDate } from '../api/types'
import { copyText } from '../lib/clipboard'
import { formatDate } from '../lib/format'
import { useToast } from '../composables/useToast'
import { hostSettings, userQuotaBytes } from '../admin/settings'
import { listMyShares, myShareRetentionLabel, setMyShareStatus, type MyShare } from '../account/myShares'

type Filter = 'all' | 'published' | 'revoked'

const { state, mode } = useAuth()
const toast = useToast()
const query = ref('')
const filter = ref<Filter>('all')

const shares = computed(() => listMyShares(state.user?.name ?? ''))
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return shares.value.filter((share) => {
    if (filter.value !== 'all' && share.status !== filter.value) return false
    if (!needle) return true
    return `${share.title} ${share.id}`.toLowerCase().includes(needle)
  })
})

const stats = computed(() => {
  const total = shares.value.length
  const published = shares.value.filter((share) => share.status === 'published' && !share.expired).length
  const views = shares.value.reduce((sum, share) => sum + share.views, 0)
  const bytes = shares.value.reduce((sum, share) => sum + share.snapshotBytes, 0)
  return { total, published, views, bytes }
})

const quotaPercent = computed(() =>
  Math.min(100, Math.max(0.4, (stats.value.bytes / userQuotaBytes.value) * 100)),
)

const userQuotaLabel = computed(() => formatBytes(userQuotaBytes.value))
const uploadsPerMinute = computed(() => hostSettings.value.uploadsPerMinute)

function statusLabel(share: MyShare): string {
  if (share.expired) return '已过期'
  if (share.status === 'revoked') return '已撤回'
  return '可读'
}

function expiryLabel(share: MyShare): string {
  if (share.status === 'revoked') return '已停止访问'
  if (share.expired) return '保留期已结束'
  if (!share.expiresAt) return '永久保留'
  return `保留至 ${formatDate(share.expiresAt)}`
}

const isDemo = (share: MyShare): boolean => share.id === 'demo-spectral'

async function copyShare(share: MyShare): Promise<void> {
  const url = new URL(share.url, window.location.origin).toString()
  const ok = await copyText(url)
  toast.push(ok ? '链接已复制' : '浏览器拒绝了剪贴板访问', ok ? 'neutral' : 'error')
}

function toggleShare(share: MyShare): void {
  const next = share.status === 'published' ? 'revoked' : 'published'
  setMyShareStatus(share.id, next)
  toast.push(next === 'revoked' ? '记录已撤回，地址不再返回内容' : '记录已恢复访问')
}
</script>

<template>
  <div class="account-page">
    <div class="container">
      <header class="account-head">
        <div class="account-head-copy">
          <p class="account-kicker"><span></span>MY RECORDS / 01</p>
          <h1>我的分享。</h1>
          <p class="account-lede">
            每次发布都会留下一个独立地址。你可以复制、撤回，也可以让它按保留期自然结束。
            管理员不会替你处理这里的某一条记录。
          </p>
        </div>
        <div class="account-stats" aria-label="分享统计">
          <div class="account-stat">
            <span>记录</span>
            <strong>{{ stats.total }}</strong>
            <small>{{ stats.published }} 份可读</small>
          </div>
          <div class="account-stat">
            <span>阅读</span>
            <strong>{{ stats.views.toLocaleString('zh-CN') }}</strong>
            <small>来自已发布地址</small>
          </div>
          <div class="account-stat">
            <span>占用</span>
            <strong>{{ formatBytes(stats.bytes) }}</strong>
            <small>配额 {{ userQuotaLabel }}</small>
          </div>
        </div>
      </header>

      <AccountTabs active="shares" />

      <div class="account-grid">
        <main class="account-main">
          <div class="account-toolbar">
            <label class="account-search">
              <span class="sr-only">搜索我的记录</span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.6" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <input v-model="query" type="search" placeholder="搜索标题或记录 id" />
            </label>
            <div class="account-segmented" aria-label="按状态筛选">
              <button type="button" :class="{ 'is-active': filter === 'all' }" @click="filter = 'all'">全部</button>
              <button type="button" :class="{ 'is-active': filter === 'published' }" @click="filter = 'published'">可读</button>
              <button type="button" :class="{ 'is-active': filter === 'revoked' }" @click="filter = 'revoked'">已撤回</button>
            </div>
            <span class="account-toolbar-count mono">{{ filtered.length }} / {{ shares.length }}</span>
          </div>

          <div class="account-ledger">
            <div class="account-ledger-head">
              <span class="mono">RECORD</span>
              <span class="mono">STATUS</span>
              <span class="mono">ACTION</span>
            </div>

            <ul v-if="filtered.length" class="record-list">
              <li v-for="share in filtered" :key="share.id" class="record-row">
                <div class="record-main">
                  <div class="record-title-line">
                    <RouterLink v-if="share.canOpen" :to="share.url" class="record-title">
                      {{ share.title }}
                    </RouterLink>
                    <span v-else class="record-title is-muted">{{ share.title }}</span>
                    <span v-if="isDemo(share)" class="record-sample">示例</span>
                  </div>
                  <p class="record-meta">
                    <span class="mono">{{ share.id }}</span>
                    <span class="record-dot" aria-hidden="true"></span>
                    <span>{{ shortDate(share.createdAt) }} 发布</span>
                    <span class="record-dot" aria-hidden="true"></span>
                    <span>{{ expiryLabel(share) }}</span>
                    <span class="record-dot" aria-hidden="true"></span>
                    <span>{{ share.views }} 阅读</span>
                    <span class="record-dot" aria-hidden="true"></span>
                    <span>{{ formatBytes(share.snapshotBytes) }}</span>
                    <span class="record-dot" aria-hidden="true"></span>
                    <span>{{ share.redactions }} 处脱敏</span>
                  </p>
                </div>
                <div class="record-status-cell">
                  <span
                    class="record-status"
                    :class="{
                      'is-published': !share.expired && share.status === 'published',
                      'is-revoked': share.status === 'revoked',
                      'is-expired': share.expired,
                    }"
                  >{{ statusLabel(share) }}</span>
                </div>
                <div class="record-actions">
                  <RouterLink v-if="share.canOpen" class="record-action" :to="share.url">打开</RouterLink>
                  <button type="button" class="record-action" @click="copyShare(share)">复制链接</button>
                  <button v-if="share.status === 'published'" type="button" class="record-action" @click="toggleShare(share)">撤回</button>
                  <button v-else type="button" class="record-action" @click="toggleShare(share)">恢复</button>
                </div>
              </li>
            </ul>

            <div v-else class="account-empty">
              <p class="account-empty-title">这里还没有符合条件的记录。</p>
              <p>换一个筛选条件，或者从 DSH 里发布第一份记录。</p>
              <RouterLink class="btn btn-quiet" to="/connect">看怎么接入</RouterLink>
            </div>
          </div>

          <p v-if="mode === 'mock'" class="account-footnote">
            本地预览：撤回与恢复只影响本页列表；示例阅读页始终可打开。接入服务端后，撤回会真正切断地址。
          </p>
          <p v-else class="account-footnote">
            撤回后地址立即停止返回内容；保留期结束后，记录会自动不可读。删除则在阅读页完成，且不可恢复。
          </p>
        </main>

        <aside class="account-aside">
          <section class="account-panel account-panel-dark">
            <p class="account-panel-kicker">PUBLISH FROM DSH</p>
            <h2>把下一段会话接进来。</h2>
            <ol class="account-steps">
              <li><span class="mono">01</span>在「连接与令牌」生成一串令牌。</li>
              <li><span class="mono">02</span>在 DSH 插件菜单里填入主机地址与令牌。</li>
              <li><span class="mono">03</span>在会话头部选择「发布到边注」。</li>
            </ol>
            <div class="account-panel-actions">
              <RouterLink class="btn btn-primary" to="/tokens">生成令牌</RouterLink>
              <RouterLink class="account-panel-link" to="/connect">接入教程 →</RouterLink>
            </div>
          </section>

          <section class="account-panel">
            <p class="account-panel-kicker">CURRENT POLICY</p>
            <h2>当前策略</h2>
            <dl class="account-policy">
              <div>
                <dt>链接保留</dt>
                <dd>{{ myShareRetentionLabel() }}</dd>
              </div>
              <div>
                <dt>我的配额</dt>
                <dd>{{ userQuotaLabel }}</dd>
              </div>
              <div>
                <dt>上传节奏</dt>
                <dd>每分钟 {{ uploadsPerMinute }} 次发布</dd>
              </div>
            </dl>
            <p class="account-policy-note">策略由管理员统一设定，适用于所有账号。</p>
          </section>

          <section class="account-panel account-panel-quiet">
            <p class="account-panel-kicker">ABOUT REVOKING</p>
            <p class="account-policy-note">
              撤回不是删除，也不会改变已经读过的内容。它只让地址不再返回记录；
              保留期结束后，记录会自动停止访问。
            </p>
          </section>

          <section class="account-meter" aria-label="个人配额使用情况">
            <div class="account-meter-top">
              <span>个人配额</span>
              <span class="mono">{{ formatBytes(stats.bytes) }} / {{ userQuotaLabel }}</span>
            </div>
            <div class="account-meter-track"><span :style="{ width: `${quotaPercent}%` }"></span></div>
            <p>超出配额后，新记录会发布失败；已发布的记录不受影响。</p>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>
