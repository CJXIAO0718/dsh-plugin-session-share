<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { adminClient, adminOverview } from '../api/adminClient'
import {
  DEFAULT_SETTINGS,
  RETENTION_OPTIONS,
  formatRetention,
  hostSettings,
  storageQuotaBytes,
  type HostSettings,
} from '../admin/settings'
import { formatBytes } from '../api/types'
import { formatDateTime } from '../lib/format'
import { useToast } from '../composables/useToast'

const toast = useToast()

function draftFrom(settings: HostSettings): HostSettings {
  return { ...settings }
}

const draft = reactive<HostSettings>(draftFrom(hostSettings.value))
const saving = ref(false)

const usedBytes = computed(() => adminOverview.value.totals.storageBytes)
const storagePercent = computed(() =>
  Math.min(100, Math.max(0.2, (usedBytes.value / storageQuotaBytes.value) * 100)),
)

const dirty = computed(
  () =>
    draft.storageQuotaGb !== hostSettings.value.storageQuotaGb ||
    draft.userQuotaMb !== hostSettings.value.userQuotaMb ||
    draft.maxSnapshotMb !== hostSettings.value.maxSnapshotMb ||
    draft.retentionDays !== hostSettings.value.retentionDays ||
    draft.uploadsPerMinute !== hostSettings.value.uploadsPerMinute,
)

const retentionLabel = computed(() => formatRetention(draft.retentionDays))
const userQuotaWarning = computed(() => draft.userQuotaMb > draft.storageQuotaGb * 1024)
const snapshotWarning = computed(() => draft.maxSnapshotMb > draft.userQuotaMb)

function fillDefaults(): void {
  Object.assign(draft, DEFAULT_SETTINGS)
  toast.push('已填入建议值，保存后生效')
}

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

async function save(): Promise<void> {
  if (saving.value) return
  if (userQuotaWarning.value) {
    toast.push('每人配额不能超过站点总容量', 'error')
    return
  }
  if (snapshotWarning.value) {
    toast.push('单份快照上限不能超过每人配额', 'error')
    return
  }
  saving.value = true
  try {
    const saved = await adminClient.saveSettings({
      ...draft,
      storageQuotaGb: clampValue(draft.storageQuotaGb, 1, 1024),
      userQuotaMb: clampValue(draft.userQuotaMb, 32, 10240),
      maxSnapshotMb: clampValue(draft.maxSnapshotMb, 1, 64),
      uploadsPerMinute: clampValue(draft.uploadsPerMinute, 1, 600),
      inviteOnly: true,
    })
    Object.assign(draft, saved)
    toast.push('站点策略已保存')
  } catch {
    toast.push('策略没有保存，请稍后再试', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="policy-panel" aria-labelledby="policy-title">
    <div class="policy-head">
      <div>
        <p class="admin-kicker">SITE POLICY</p>
        <h2 id="policy-title">设定整体边界，不介入每条记录。</h2>
        <p>这里只决定容量、保留期和上传节奏。已经发布的记录归发布者管理，管理员不逐条撤回。</p>
      </div>
      <div class="policy-head-meta">
        <span class="mono">LAST SAVED</span>
        <span>{{ formatDateTime(hostSettings.updatedAt) }}</span>
      </div>
    </div>

    <div class="policy-grid">
      <fieldset class="policy-group">
        <legend>容量与上限</legend>
        <label class="policy-row">
          <span class="policy-label">
            站点总容量
            <small>所有账号的快照总和上限</small>
          </span>
          <span class="policy-input">
            <input v-model.number="draft.storageQuotaGb" type="number" min="1" max="1024" :disabled="saving" />
            <em>GB</em>
          </span>
        </label>
        <label class="policy-row">
          <span class="policy-label">
            每人配额
            <small>单个账号最多占用的空间</small>
          </span>
          <span class="policy-input">
            <input v-model.number="draft.userQuotaMb" type="number" min="32" max="10240" :disabled="saving" />
            <em>MB</em>
          </span>
        </label>
        <label class="policy-row">
          <span class="policy-label">
            单份快照上限
            <small>超过后插件收到 413，不会截断</small>
          </span>
          <span class="policy-input">
            <input v-model.number="draft.maxSnapshotMb" type="number" min="1" max="64" :disabled="saving" />
            <em>MB</em>
          </span>
        </label>
      </fieldset>

      <fieldset class="policy-group">
        <legend>保留与节奏</legend>
        <label class="policy-row">
          <span class="policy-label">
            链接保留
            <small>到期后停止访问，再过 7 天自动永久清理</small>
          </span>
          <span class="policy-input">
            <select v-model.number="draft.retentionDays" :disabled="saving">
              <option v-for="option in RETENTION_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </span>
        </label>
        <label class="policy-row">
          <span class="policy-label">
            每人每分钟发布
            <small>按发布次数计；一份快照无论多少条消息都只占 1 次</small>
          </span>
          <span class="policy-input">
            <input v-model.number="draft.uploadsPerMinute" type="number" min="1" max="600" :disabled="saving" />
            <em>次</em>
          </span>
        </label>
        <div class="policy-row policy-row-static">
          <span class="policy-label">
            准入方式
            <small>当前只开放邀请码注册</small>
          </span>
          <span class="policy-static-value">邀请码 · 后续可接 GitHub OAuth</span>
        </div>
      </fieldset>
    </div>

    <div class="policy-summary">
      <div class="policy-summary-copy">
        <p class="admin-kicker">CURRENT USE</p>
        <p>
          已用 {{ formatBytes(usedBytes) }} / {{ draft.storageQuotaGb }} GB ·
          每人 {{ draft.userQuotaMb }} MB ·
          链接{{ retentionLabel }} ·
          每分钟 {{ draft.uploadsPerMinute }} 次发布
        </p>
        <div class="policy-summary-track">
          <span :style="{ width: `${storagePercent}%` }"></span>
        </div>
      </div>
      <div class="policy-actions">
        <span class="policy-dirty" :class="{ 'is-dirty': dirty }">{{ dirty ? '有未保存的修改' : '已与当前策略一致' }}</span>
        <button type="button" class="btn btn-quiet" :disabled="saving" @click="fillDefaults">填入建议值</button>
        <button type="button" class="btn btn-primary" :disabled="saving || !dirty" @click="save">
          {{ saving ? '正在保存…' : '保存策略' }}
        </button>
      </div>
    </div>

    <p v-if="userQuotaWarning" class="policy-warning">每人配额高于站点总容量，请先调整这两项。</p>
    <p v-else-if="snapshotWarning" class="policy-warning">单份快照上限高于每人配额，请先调整这两项。</p>
    <p v-else class="policy-note">
      修改保留期后，已有记录的到期时间会按新策略重新计算；已经撤回的记录不会自动恢复。
      到期满 7 天的记录会自动永久删除，已清理的记录无法恢复；永久保留的记录不受影响。
    </p>
  </section>
</template>
