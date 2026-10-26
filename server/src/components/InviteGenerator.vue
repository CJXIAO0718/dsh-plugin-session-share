<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminClient } from '../api/adminClient'
import type { InviteCode } from '../auth/inviteTypes'
import { copyText } from '../lib/clipboard'
import { useToast } from '../composables/useToast'

const emit = defineEmits<{ created: [InviteCode] }>()
const toast = useToast()

const note = ref('')
const maxUses = ref(5)
const expiresInDays = ref(30)
const creating = ref(false)
const created = ref<InviteCode | null>(null)

const seatOptions = [1, 3, 5, 10, 25, 100, 300]
const expiryOptions = [
  { value: 1, label: '1 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 0, label: '不过期' },
]

const inviteLink = computed(() => {
  if (!created.value) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/register?invite=${encodeURIComponent(created.value.code)}`
})

async function generate(): Promise<void> {
  if (creating.value) return
  creating.value = true
  try {
    const invite = await adminClient.createInvite({
      note: note.value.trim() || '未命名批次',
      maxUses: maxUses.value,
      expiresInDays: expiresInDays.value,
    })
    created.value = invite
    note.value = ''
    emit('created', invite)
    toast.push(`邀请码已生成 · ${invite.maxUses} 个名额`)
  } catch (error) {
    toast.push(error instanceof Error ? error.message : '邀请码没有生成', 'error')
  } finally {
    creating.value = false
  }
}

async function copy(value: string, label: string): Promise<void> {
  const ok = await copyText(value)
  toast.push(ok ? `${label}已复制` : '浏览器拒绝了剪贴板访问', ok ? 'neutral' : 'error')
}
</script>

<template>
  <section class="invite-generator" aria-labelledby="invite-generator-title">
    <div class="invite-generator-head">
      <div>
        <p class="admin-kicker">NEW INVITATION</p>
        <h2 id="invite-generator-title">发出一批邀请。</h2>
      </div>
      <p>把名额和有效期定好，生成后把链接交给该进来的人。对方自己设置用户名和密码。</p>
    </div>

    <form class="invite-form" @submit.prevent="generate">
      <label class="invite-field invite-field-wide">
        <span>批次备注</span>
        <input v-model="note" type="text" placeholder="例如 十月写作小组" :disabled="creating" />
      </label>
      <label class="invite-field">
        <span>名额</span>
        <select v-model.number="maxUses" :disabled="creating">
          <option v-for="seat in seatOptions" :key="seat" :value="seat">{{ seat }} 人</option>
        </select>
      </label>
      <label class="invite-field">
        <span>有效期</span>
        <select v-model.number="expiresInDays" :disabled="creating">
          <option v-for="option in expiryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <button class="btn btn-primary invite-generate" type="submit" :disabled="creating">
        {{ creating ? '正在生成…' : '生成邀请码' }}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
      </button>
    </form>

    <div v-if="created" class="invite-created">
      <div class="invite-created-head">
        <span class="mono">NEW CODE · 只显示这一次</span>
        <span class="mono">{{ created.maxUses }} 个名额</span>
      </div>
      <div class="invite-created-code">{{ created.code }}</div>
      <div class="invite-created-link">
        <code>{{ inviteLink }}</code>
        <div class="invite-created-actions">
          <button type="button" @click="copy(created.code, '邀请码')">复制邀请码</button>
          <button type="button" @click="copy(inviteLink, '邀请链接')">复制链接</button>
        </div>
      </div>
      <p>链接会打开注册页并预填邀请码。名额用完、过期或停用后，链接自动失效。</p>
    </div>
  </section>
</template>
