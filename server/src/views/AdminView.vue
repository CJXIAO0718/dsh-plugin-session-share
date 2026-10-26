<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import ThemeToggle from '../components/ThemeToggle.vue'
import InviteGenerator from '../components/InviteGenerator.vue'
import SettingsForm from '../components/SettingsForm.vue'
import { useAuth } from '../auth/useAuth'
import { adminClient, adminOverview } from '../api/adminClient'
import type { AdminUser } from '../admin/types'
import type { InviteCode } from '../auth/inviteTypes'
import { inviteStatus } from '../auth/inviteStatus'
import { hostSettings, storageQuotaBytes, formatRetention } from '../admin/settings'
import { copyText } from '../lib/clipboard'
import { formatBytes, shortDate } from '../api/types'
import { formatDate, formatDateTime } from '../lib/format'
import { useToast } from '../composables/useToast'

type Tab = 'overview' | 'invites' | 'people' | 'settings'
type InviteFilter = 'all' | 'active' | 'inactive'

type DialogState =
  | { kind: 'suspend' | 'activate'; user: AdminUser }
  | { kind: 'revoke-invite'; invite: InviteCode }

const route = useRoute()
const router = useRouter()
const { state, signOut, mode } = useAuth()
const toast = useToast()

const tab = computed<Tab>(() => {
  if (route.name === 'admin-invites') return 'invites'
  if (route.name === 'admin-people') return 'people'
  if (route.name === 'admin-settings') return 'settings'
  return 'overview'
})

const tabTitle = computed(() => {
  if (tab.value === 'invites') return '邀请码'
  if (tab.value === 'people') return '成员'
  if (tab.value === 'settings') return '设置'
  return '概览'
})

const adminName = computed(() => state.user?.name ?? '管理员')
const adminInitial = computed(() => adminName.value.slice(0, 1))

const todayLabel = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date())

const overview = adminOverview
const totals = computed(() => overview.value.totals)
const activityMax = computed(() => Math.max(1, ...overview.value.activity.map((day) => day.count)))
const todayCount = computed(() => overview.value.activity.at(-1)?.count ?? 0)

const allUsers = ref<AdminUser[]>([])
const invites = ref<InviteCode[]>([])
const peopleQuery = ref('')
const inviteQuery = ref('')
const inviteFilter = ref<InviteFilter>('all')
const dialog = ref<DialogState | null>(null)
const dialogBusy = ref(false)
const dialogLayer = ref<HTMLElement | null>(null)
const dialogTrigger = ref<HTMLElement | null>(null)

const userList = computed(() => {
  const query = peopleQuery.value.trim().toLowerCase()
  if (!query) return allUsers.value
  return allUsers.value.filter((user) =>
    `${user.name} ${user.username}`.toLowerCase().includes(query),
  )
})

const activeUsers = computed(() => allUsers.value.filter((user) => user.status === 'active'))
const suspendedUsers = computed(() => allUsers.value.filter((user) => user.status === 'suspended'))
const activeInvites = computed(() =>
  invites.value.filter((invite) => inviteStatus(invite) === 'active').length,
)

const inviteList = computed(() => {
  const query = inviteQuery.value.trim().toLowerCase()
  return invites.value.filter((invite) => {
    const status = inviteStatus(invite)
    if (inviteFilter.value === 'active' && status !== 'active') return false
    if (inviteFilter.value === 'inactive' && status === 'active') return false
    if (!query) return true
    return `${invite.code} ${invite.note}`.toLowerCase().includes(query)
  })
})

const retentionLabel = computed(() => formatRetention(hostSettings.value.retentionDays))
const storagePercent = computed(() =>
  Math.min(100, Math.max(0.2, (totals.value.storageBytes / storageQuotaBytes.value) * 100)),
)

function canPreview(id: string, status: string): boolean {
  return id === 'demo-spectral' && status === 'published'
}

function inviteStatusLabel(invite: InviteCode): string {
  const status = inviteStatus(invite)
  if (status === 'active') return '可用'
  if (status === 'exhausted') return '名额已满'
  if (status === 'expired') return '已过期'
  return '已停用'
}

function inviteStatusClass(invite: InviteCode): string {
  const status = inviteStatus(invite)
  if (status === 'active') return 'is-active'
  if (status === 'revoked') return 'is-revoked'
  return 'is-suspended'
}

function inviteExpiry(invite: InviteCode): string {
  if (!invite.expiresAt) return '不过期'
  return formatDate(invite.expiresAt)
}

function inviteLink(invite: InviteCode): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/register?invite=${encodeURIComponent(invite.code)}`
}

function fullUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

async function copyValue(value: string, label: string): Promise<void> {
  const ok = await copyText(value)
  toast.push(ok ? `${label}已复制` : '浏览器拒绝了剪贴板访问', ok ? 'neutral' : 'error')
}

function askUser(user: AdminUser): void {
  dialogTrigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value = { kind: user.status === 'active' ? 'suspend' : 'activate', user }
}

function askInvite(invite: InviteCode): void {
  dialogTrigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value = { kind: 'revoke-invite', invite }
}

function closeDialog(): void {
  if (dialogBusy.value) return
  dialog.value = null
}

function dialogCopy(): { title: string; body: string; action: string; danger: boolean } {
  const current = dialog.value
  if (!current) return { title: '', body: '', action: '', danger: false }
  if (current.kind === 'revoke-invite') {
    return {
      title: '停用这个邀请码？',
      body: `「${current.invite.note}」将不能再用于注册。已经用它创建的账号不受影响。`,
      action: '停用邀请码',
      danger: true,
    }
  }
  if (current.kind === 'suspend') {
    return {
      title: `暂停 ${current.user.name} 的访问？`,
      body: '该成员将无法登录、发布新记录或管理自己的地址。已经发布的记录不会自动撤回。',
      action: '暂停成员',
      danger: true,
    }
  }
  return {
    title: `恢复 ${current.user.name} 的访问？`,
    body: '恢复后，该成员可以重新登录并管理自己的记录。',
    action: '恢复成员',
    danger: false,
  }
}

async function confirmDialog(): Promise<void> {
  const current = dialog.value
  if (!current || dialogBusy.value) return
  dialogBusy.value = true
  try {
    if (current.kind === 'revoke-invite') {
      const updated = await adminClient.revokeInvite(current.invite.code)
      invites.value = invites.value.map((item) => (item.code === updated.code ? updated : item))
      toast.push('邀请码已停用')
      dialog.value = null
      return
    }
    const users = await adminClient.setUserStatus(
      current.user.id,
      current.kind === 'suspend' ? 'suspended' : 'active',
    )
    allUsers.value = users
    toast.push(current.kind === 'suspend' ? '成员已暂停' : '成员已恢复')
    dialog.value = null
  } catch (error) {
    toast.push(error instanceof Error ? error.message : '操作没有完成', 'error')
  } finally {
    dialogBusy.value = false
  }
}

function onInviteCreated(invite: InviteCode): void {
  invites.value = [invite, ...invites.value]
}

async function logout(): Promise<void> {
  await signOut()
  await router.replace({ name: 'login' })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeDialog()
}

watch(dialog, async (value, previous) => {
  if (value) {
    await nextTick()
    dialogLayer.value?.focus()
    return
  }
  if (previous) {
    await nextTick()
    const trigger = dialogTrigger.value
    dialogTrigger.value = null
    if (trigger?.isConnected) trigger.focus()
  }
})

onMounted(async () => {
  const [users, codes] = await Promise.all([adminClient.listUsers(), adminClient.listInvites()])
  allUsers.value = users
  invites.value = codes
  // remote 模式下概览数据来自服务端；mock 模式只是刷新同一份本地数据。
  adminClient.overview().catch(() => undefined)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-rail">
      <div class="admin-rail-head">
        <RouterLink class="admin-brand" to="/" aria-label="边注首页">
          <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path class="brand-sheet" d="M6.5 3.5h19v25h-19z" />
            <path class="brand-margin" d="M12 3.5v25" />
            <path class="brand-lines" d="M16 9.5h6M16 14h6M16 18.5h4" />
          </svg>
          <span class="brand-word">边注</span>
        </RouterLink>
        <span class="admin-rail-role">登记处 / REGISTRAR</span>
      </div>

      <nav class="admin-nav" aria-label="管理员导航">
        <RouterLink :to="{ name: 'admin' }" class="admin-nav-link" :class="{ 'is-active': tab === 'overview' }">
          <span class="admin-nav-index mono">01</span>
          <span>概览</span>
          <span class="admin-nav-count mono">{{ totals.shares }}</span>
        </RouterLink>
        <RouterLink :to="{ name: 'admin-invites' }" class="admin-nav-link" :class="{ 'is-active': tab === 'invites' }">
          <span class="admin-nav-index mono">02</span>
          <span>邀请码</span>
          <span class="admin-nav-count mono">{{ activeInvites }}</span>
        </RouterLink>
        <RouterLink :to="{ name: 'admin-people' }" class="admin-nav-link" :class="{ 'is-active': tab === 'people' }">
          <span class="admin-nav-index mono">03</span>
          <span>成员</span>
          <span class="admin-nav-count mono">{{ totals.users }}</span>
        </RouterLink>
        <RouterLink :to="{ name: 'admin-settings' }" class="admin-nav-link" :class="{ 'is-active': tab === 'settings' }">
          <span class="admin-nav-index mono">04</span>
          <span>设置</span>
          <span class="admin-nav-count mono">POLICY</span>
        </RouterLink>
      </nav>

      <div class="admin-rail-notes">
        <p class="admin-rail-label">状态</p>
        <p><span class="admin-live-dot"></span>托管运行正常</p>
        <p class="admin-rail-muted">{{ retentionLabel }}<template v-if="mode === 'mock'"> · 本地预览</template></p>
      </div>

      <div class="admin-rail-foot">
        <div class="admin-me">
          <span class="admin-avatar">{{ adminInitial }}</span>
          <div>
            <strong>{{ adminName }}</strong>
            <small>管理员</small>
          </div>
        </div>
        <div class="admin-rail-actions">
          <RouterLink to="/" class="admin-rail-link">返回站点</RouterLink>
          <button type="button" class="admin-rail-link" @click="logout">退出</button>
        </div>
      </div>
    </aside>

    <main class="admin-main">
      <header class="admin-top">
        <div>
          <p class="admin-breadcrumb"><span>管理</span> / {{ tabTitle }}</p>
          <h1>{{ tabTitle }}</h1>
        </div>
        <div class="admin-top-side">
          <span class="admin-date">{{ todayLabel }}</span>
          <button type="button" class="admin-mobile-logout" @click="logout">退出</button>
          <ThemeToggle />
        </div>
      </header>

      <div v-if="tab === 'overview'" class="admin-content">
        <section class="admin-intro">
          <div>
            <p class="admin-kicker">WEEKLY LEDGER</p>
            <h2>今天有 {{ todayCount }} 份新记录。</h2>
            <p>这里登记容量、准入与分发。管理员设定整体策略，记录本身归发布者管理。</p>
          </div>
          <div class="admin-intro-side">
            <span class="admin-status-dot"></span>
            <div>
              <strong>运行正常</strong>
              <small>快照校验通过 · 7 日无失败</small>
            </div>
          </div>
        </section>

        <section class="admin-stats" aria-label="站点统计">
          <div class="admin-stat">
            <span>记录总数</span>
            <strong>{{ totals.shares }}</strong>
            <small>{{ totals.published }} 份可读 · {{ totals.revoked }} 份已撤回</small>
          </div>
          <div class="admin-stat">
            <span>成员</span>
            <strong>{{ totals.users }}</strong>
            <small>{{ totals.activeUsers }} 位可登录 · {{ totals.users - totals.activeUsers }} 位已暂停</small>
          </div>
          <div class="admin-stat">
            <span>阅读</span>
            <strong>{{ totals.views.toLocaleString('zh-CN') }}</strong>
            <small>来自已发布地址的累计访问</small>
          </div>
          <div class="admin-stat">
            <span>快照占用</span>
            <strong>{{ formatBytes(totals.storageBytes) }}</strong>
            <small>上限 {{ hostSettings.storageQuotaGb }} GB · {{ storagePercent.toFixed(1) }}% 已用</small>
          </div>
        </section>

        <div class="admin-overview-grid">
          <div class="admin-column">
            <section class="admin-panel">
              <div class="admin-panel-head">
                <div>
                  <p class="admin-kicker">LAST 7 DAYS</p>
                  <h2>发布节奏</h2>
                </div>
                <span class="admin-panel-meta mono">{{ totals.published }} PUBLISHED</span>
              </div>
              <div class="admin-chart" role="img" aria-label="最近七天发布数量柱状图">
                <div v-for="day in overview.activity" :key="day.iso" class="admin-chart-day">
                  <span class="admin-chart-count mono">{{ day.count }}</span>
                  <span class="admin-chart-bar" :style="{ height: `${8 + (day.count / activityMax) * 58}px` }"></span>
                  <span class="admin-chart-label">{{ day.label }}</span>
                </div>
              </div>
            </section>

            <section class="admin-panel">
              <div class="admin-panel-head">
                <div>
                  <p class="admin-kicker">LATEST RECORDS</p>
                  <h2>最近发布</h2>
                </div>
                <span class="admin-panel-meta mono">只读视图</span>
              </div>
              <div class="admin-table-scroll">
                <table class="admin-table admin-table-compact">
                  <thead>
                    <tr>
                      <th>记录</th>
                      <th>所有者</th>
                      <th>发布</th>
                      <th>状态</th>
                      <th><span class="sr-only">操作</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="share in overview.recent.slice(0, 5)" :key="share.id">
                      <td>
                        <RouterLink v-if="canPreview(share.id, share.status)" :to="share.url" class="admin-row-title">
                          {{ share.title }}
                        </RouterLink>
                        <span v-else class="admin-row-title" :class="{ 'is-muted': share.status !== 'published' }">{{ share.title }}</span>
                      </td>
                      <td class="admin-cell-muted">{{ share.owner }}</td>
                      <td class="admin-cell-muted">{{ shortDate(share.createdAt) }}</td>
                      <td>
                        <span class="admin-status" :class="`is-${share.status}`">
                          {{ share.status === 'published' ? '可读' : '已撤回' }}
                        </span>
                      </td>
                      <td class="admin-cell-actions">
                        <button class="admin-action" type="button" @click="copyValue(fullUrl(share.url), '记录地址')">复制</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="admin-panel-foot">管理员不在这里撤回记录；发布者可在「我的分享」里自行处理。</p>
            </section>
          </div>

          <aside class="admin-column admin-column-side">
            <section class="admin-panel">
              <div class="admin-panel-head">
                <div>
                  <p class="admin-kicker">ATTENTION</p>
                  <h2>需要留意</h2>
                </div>
                <span class="admin-panel-meta mono">{{ suspendedUsers.length }}</span>
              </div>
              <div v-if="suspendedUsers.length" class="admin-attention">
                <p class="admin-attention-label">暂停中的访问</p>
                <div v-for="user in suspendedUsers" :key="user.id" class="admin-attention-item">
                  <div>
                    <p class="admin-attention-title">{{ user.name }}</p>
                    <p class="admin-attention-meta">@{{ user.username }} · 自 {{ formatDate(user.lastSeenAt) }}</p>
                  </div>
                  <button class="admin-text-link" type="button" @click="askUser(user)">恢复</button>
                </div>
              </div>
              <p v-else class="admin-empty-line">没有待处理的访问。</p>
            </section>

            <section class="admin-panel">
              <div class="admin-panel-head">
                <div>
                  <p class="admin-kicker">SITE POLICY</p>
                  <h2>当前策略</h2>
                </div>
                <RouterLink class="admin-text-link" :to="{ name: 'admin-settings' }">调整 →</RouterLink>
              </div>
              <dl class="admin-policy-summary">
                <div><dt>链接保留</dt><dd>{{ retentionLabel }}</dd></div>
                <div><dt>每人配额</dt><dd>{{ hostSettings.userQuotaMb }} MB</dd></div>
                <div><dt>上传节奏</dt><dd>{{ hostSettings.uploadsPerMinute }} 次发布 / 分钟</dd></div>
                <div><dt>准入</dt><dd>邀请码注册</dd></div>
              </dl>
            </section>

            <section class="admin-panel">
              <div class="admin-panel-head">
                <div>
                  <p class="admin-kicker">CAPACITY</p>
                  <h2>容量</h2>
                </div>
              </div>
              <div class="admin-capacity">
                <div class="admin-capacity-top">
                  <span>{{ formatBytes(totals.storageBytes) }}</span>
                  <span class="mono">{{ hostSettings.storageQuotaGb }} GB</span>
                </div>
                <div class="admin-capacity-track">
                  <span :style="{ width: `${storagePercent}%` }"></span>
                </div>
                <p>快照原样存储，不压缩、不改写。达到阈值后，管理员会先收到提醒。</p>
              </div>
            </section>

            <section class="admin-notes">
              <p class="admin-kicker">RULES OF THE DESK</p>
              <p>管理者设定容量、保留期与上传节奏，不逐条撤回记录。</p>
              <p>暂停成员会立即断开新登录，但不会自动撤回其已发布记录。</p>
            </section>
          </aside>
        </div>
      </div>

      <div v-else-if="tab === 'invites'" class="admin-content">
        <InviteGenerator @created="onInviteCreated" />

        <div class="admin-toolbar admin-toolbar-spaced">
          <label class="admin-search">
            <span class="sr-only">搜索邀请码</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.6" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input v-model="inviteQuery" type="search" placeholder="搜索邀请码或批次备注" />
          </label>
          <div class="admin-segmented" aria-label="按邀请码状态筛选">
            <button type="button" :class="{ 'is-active': inviteFilter === 'all' }" @click="inviteFilter = 'all'">全部</button>
            <button type="button" :class="{ 'is-active': inviteFilter === 'active' }" @click="inviteFilter = 'active'">可用</button>
            <button type="button" :class="{ 'is-active': inviteFilter === 'inactive' }" @click="inviteFilter = 'inactive'">已失效</button>
          </div>
          <span class="admin-toolbar-count mono">{{ inviteList.length }} / {{ invites.length }}</span>
        </div>

        <section class="admin-panel admin-panel-table">
          <div class="admin-panel-head">
            <div>
              <p class="admin-kicker">INVITATION LEDGER</p>
              <h2>已经发出的邀请</h2>
            </div>
            <span class="admin-panel-meta">{{ activeInvites }} 个可用</span>
          </div>
          <div v-if="inviteList.length" class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>邀请码</th>
                  <th>批次</th>
                  <th>名额</th>
                  <th>到期</th>
                  <th>状态</th>
                  <th><span class="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="invite in inviteList" :key="invite.code">
                  <td>
                    <span class="admin-invite-code mono">{{ invite.code }}</span>
                    <span class="admin-row-id">{{ formatDate(invite.createdAt) }} 生成</span>
                  </td>
                  <td class="admin-cell-muted">{{ invite.note }}</td>
                  <td class="admin-cell-muted mono">{{ invite.usedCount }} / {{ invite.maxUses }}</td>
                  <td class="admin-cell-muted">{{ inviteExpiry(invite) }}</td>
                  <td>
                    <span class="admin-status" :class="inviteStatusClass(invite)">{{ inviteStatusLabel(invite) }}</span>
                  </td>
                  <td class="admin-cell-actions">
                    <button class="admin-action" type="button" @click="copyValue(invite.code, '邀请码')">复制码</button>
                    <button class="admin-action" type="button" @click="copyValue(inviteLink(invite), '邀请链接')">复制链接</button>
                    <button
                      v-if="inviteStatus(invite) === 'active'"
                      class="admin-action"
                      type="button"
                      @click="askInvite(invite)"
                    >停用</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="admin-empty-line">没有符合条件的邀请码。</p>
        </section>
      </div>

      <div v-else-if="tab === 'people'" class="admin-content">
        <div class="admin-toolbar">
          <label class="admin-search">
            <span class="sr-only">搜索成员</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.6" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input v-model="peopleQuery" type="search" placeholder="搜索姓名或用户名" />
          </label>
          <RouterLink class="btn btn-primary admin-toolbar-action" :to="{ name: 'admin-invites' }">
            生成邀请码
          </RouterLink>
          <span class="admin-toolbar-count mono">{{ userList.length }} / {{ allUsers.length }}</span>
        </div>

        <section class="admin-panel admin-panel-table">
          <div class="admin-panel-head">
            <div>
              <p class="admin-kicker">PEOPLE WITH ACCESS</p>
              <h2>成员与权限</h2>
            </div>
            <span class="admin-panel-meta">{{ activeUsers.length }} 位可登录</span>
          </div>
          <div class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>角色</th>
                  <th>加入</th>
                  <th>最近出现</th>
                  <th>记录</th>
                  <th>状态</th>
                  <th><span class="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in userList" :key="user.id">
                  <td>
                    <span class="admin-person">
                      <span class="admin-avatar admin-avatar-sm">{{ user.name.slice(0, 1) }}</span>
                      <span>
                        <strong>{{ user.name }}</strong>
                        <small class="mono">@{{ user.username }}</small>
                      </span>
                    </span>
                  </td>
                  <td class="admin-cell-muted">{{ user.role === 'admin' ? '管理员' : '成员' }}</td>
                  <td class="admin-cell-muted">{{ formatDate(user.createdAt) }}</td>
                  <td class="admin-cell-muted">{{ formatDateTime(user.lastSeenAt) }}</td>
                  <td class="admin-cell-muted mono">{{ user.shareCount }}</td>
                  <td>
                    <span class="admin-status" :class="`is-${user.status}`">
                      {{ user.status === 'active' ? '可登录' : '已暂停' }}
                    </span>
                  </td>
                  <td class="admin-cell-actions">
                    <button
                      v-if="user.username !== 'admin'"
                      class="admin-action"
                      type="button"
                      @click="askUser(user)"
                    >
                      {{ user.status === 'active' ? '暂停' : '恢复' }}
                    </button>
                    <span v-else class="admin-cell-muted">本人</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="admin-panel-foot">账号由邀请码自助创建；这里只处理暂停与恢复，不代发密码。</p>
        </section>
      </div>

      <div v-else class="admin-content">
        <SettingsForm />
      </div>
    </main>

    <Transition name="admin-dialog">
      <div
        v-if="dialog"
        ref="dialogLayer"
        class="admin-dialog-layer"
        tabindex="-1"
        @click.self="closeDialog"
        @keydown.esc="closeDialog"
      >
        <div class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title">
          <p class="admin-kicker">REGISTRAR ACTION</p>
          <h2 id="admin-dialog-title">{{ dialogCopy().title }}</h2>
          <p class="admin-dialog-body">{{ dialogCopy().body }}</p>
          <div class="admin-dialog-actions">
            <button type="button" class="btn btn-quiet" @click="closeDialog">取消</button>
            <button
              type="button"
              class="btn"
              :class="dialogCopy().danger ? 'admin-danger-btn' : 'btn-primary'"
              :disabled="dialogBusy"
              @click="confirmDialog"
            >
              {{ dialogBusy ? '正在处理…' : dialogCopy().action }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
