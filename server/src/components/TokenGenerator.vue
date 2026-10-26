<script setup lang="ts">
import { computed, ref } from 'vue'
import { createToken, scopeLabel, type TokenScope } from '../account/tokens'
import { copyText } from '../lib/clipboard'
import { useToast } from '../composables/useToast'

const props = defineProps<{ ownerId: string }>()
const emit = defineEmits<{ created: [] }>()

const toast = useToast()
const name = ref('')
const scopes = ref<TokenScope[]>(['publish', 'manage'])
const expiresInDays = ref(90)
const creating = ref(false)
const secret = ref('')
const errorMessage = ref('')

const expiryOptions = [
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '1 年' },
  { value: 0, label: '不过期' },
]

const scopeOptions: TokenScope[] = ['publish', 'manage']

const canSubmit = computed(() => Boolean(props.ownerId) && name.value.trim().length > 0 && scopes.value.length > 0)

function toggleScope(scope: TokenScope): void {
  scopes.value = scopes.value.includes(scope)
    ? scopes.value.filter((item) => item !== scope)
    : [...scopes.value, scope]
}

async function generate(): Promise<void> {
  if (creating.value) return
  errorMessage.value = ''
  if (!name.value.trim()) {
    errorMessage.value = '给令牌起一个能认出设备的名称。'
    return
  }
  if (scopes.value.length === 0) {
    errorMessage.value = '至少选择一项权限。'
    return
  }
  creating.value = true
  await new Promise((resolve) => window.setTimeout(resolve, 420))
  try {
    const result = await createToken(props.ownerId, {
      name: name.value,
      scopes: scopes.value,
      expiresInDays: expiresInDays.value,
    })
    secret.value = result.secret
    name.value = ''
    emit('created')
    toast.push('令牌已生成，请立即复制')
  } catch {
    errorMessage.value = '令牌没有生成，请稍后再试。'
  } finally {
    creating.value = false
  }
}

async function copySecret(): Promise<void> {
  const ok = await copyText(secret.value)
  toast.push(ok ? '令牌已复制' : '浏览器拒绝了剪贴板访问', ok ? 'neutral' : 'error')
}
</script>

<template>
  <section class="token-generator" aria-labelledby="token-generator-title">
    <div class="token-generator-head">
      <div>
        <p class="account-panel-kicker">NEW TOKEN</p>
        <h2 id="token-generator-title">生成一枚新令牌。</h2>
      </div>
      <span class="token-generator-note mono">只显示一次</span>
    </div>

    <form class="token-form" @submit.prevent="generate">
      <label class="token-field">
        <span>令牌名称</span>
        <input v-model="name" type="text" placeholder="例如 MacBook · 本地 DSH" :disabled="creating" />
      </label>

      <fieldset class="token-scopes">
        <legend>权限</legend>
        <label v-for="scope in scopeOptions" :key="scope" class="token-scope">
          <input
            type="checkbox"
            :checked="scopes.includes(scope)"
            :disabled="creating"
            @change="toggleScope(scope)"
          />
          <span>{{ scopeLabel(scope) }}</span>
          <small>{{ scope === 'publish' ? '允许从 DSH 发布' : '允许撤回与删除' }}</small>
        </label>
      </fieldset>

      <label class="token-field token-field-short">
        <span>有效期</span>
        <select v-model.number="expiresInDays" :disabled="creating">
          <option v-for="option in expiryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>

      <button class="btn btn-primary token-generate" type="submit" :disabled="creating || !canSubmit">
        {{ creating ? '正在生成…' : '生成令牌' }}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
      </button>
    </form>

    <p v-if="errorMessage" class="token-error" role="alert">{{ errorMessage }}</p>

    <div v-if="secret" class="token-secret">
      <div class="token-secret-head">
        <span class="mono">TOKEN READY · 只显示这一次</span>
        <button type="button" @click="copySecret">复制令牌</button>
      </div>
      <code class="token-secret-value">{{ secret }}</code>
      <p>把它填进 DSH 插件的「连接设置」。关闭后，页面只会保留前后缀。</p>
    </div>
  </section>
</template>
