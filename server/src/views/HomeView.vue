<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import gsap from 'gsap'
import { useAuth } from '../auth/useAuth'
import { REMOTE_MODE } from '../config'

const { state, isAdmin } = useAuth()
const signedIn = computed(() => Boolean(state.user))
const landing = computed(() => (isAdmin.value ? '/admin' : '/archive'))
// 示例记录与演示邀请码只在本地预览模式提供；部署构建不携带演示数据。
const showDemo = !REMOTE_MODE
const demoInvite = ref('')

onMounted(async () => {
  if (!showDemo) return
  const module = await import('../auth/mockAuth')
  demoInvite.value = module.DEMO_INVITE
})

const sceneEl = ref<HTMLElement | null>(null)
const stage = ref(0)
const playing = ref(false)
const reduced = ref(false)

const stages = [
  { key: 'voice', label: '对话' },
  { key: 'margin', label: '旁注' },
  { key: 'redact', label: '脱敏' },
  { key: 'publish', label: '地址' },
]

let timeline: gsap.core.Timeline | null = null
let observer: IntersectionObserver | null = null

function mark(index: number): void {
  stage.value = index
}

function buildTimeline(root: HTMLElement): void {
  const q = gsap.utils.selector(root)
  const tl = gsap.timeline({
    paused: true,
    defaults: { ease: 'power2.out' },
    onStart: () => {
      playing.value = true
    },
    onComplete: () => {
      playing.value = false
      stage.value = 3
    },
  })

  timeline = tl
  tl.set(q('.scene-redact-bar'), { scaleX: 0, transformOrigin: 'left center' })
    .set(q('.scene-publish'), { autoAlpha: 0, y: 18 })
    .set(q('.scene-note'), { autoAlpha: 0, x: 14 })
    .call(() => mark(0))
    .addLabel('voice')
    .from(q('.scene-line-user'), { autoAlpha: 0, y: 12, duration: 0.55 })
    .from(q('.scene-line-assistant'), { autoAlpha: 0, y: 12, duration: 0.55 }, '-=0.24')
    .addLabel('margin')
    .to(q('.scene-note'), { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.16 })
    .call(() => mark(1), undefined, '-=0.3')
    .addLabel('redact')
    .to(q('.scene-redact-bar'), { scaleX: 1, duration: 0.42, stagger: 0.18 })
    .to(q('.scene-token'), { color: 'transparent', duration: 0.2, stagger: 0.18 }, '-=0.3')
    .call(() => mark(2), undefined, '-=0.2')
    .addLabel('publish')
    .to(q('.scene-paper'), { y: -8, duration: 0.5 }, '-=0.1')
    .to(q('.scene-publish'), { autoAlpha: 1, y: 0, duration: 0.55 })
    .call(() => mark(3), undefined, '-=0.2')
}

function play(): void {
  if (reduced.value || !timeline) return
  if (stage.value === 3) {
    stage.value = 0
    timeline.restart()
    return
  }
  timeline.play()
}

function seek(index: number): void {
  if (reduced.value) {
    stage.value = index
    return
  }
  if (!timeline) return
  const key = stages[index]?.key
  const time = key ? timeline.labels[key] : 0
  timeline.pause()
  timeline.seek(typeof time === 'number' ? time : 0)
  timeline.play()
  stage.value = index
}

onMounted(() => {
  reduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced.value) {
    stage.value = 3
    return
  }
  const root = sceneEl.value
  if (!root) return
  buildTimeline(root)
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting)
        if (!visible) return
        observer?.disconnect()
        observer = null
        play()
      },
      { threshold: 0.35 },
    )
    observer.observe(root)
  } else {
    play()
  }
})

onBeforeUnmount(() => {
  timeline?.kill()
  timeline = null
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="home-page">
    <section class="home-hero container">
      <div class="home-hero-copy">
        <p class="kicker"><span class="kicker-rule"></span>边注 · 会话托管</p>
        <h1 class="home-title">把说过的话，<br /><em>留成可以交出去的记录。</em></h1>
        <p class="home-lede">
          边注把 DSH 里的一次会话整理成一份可读、可核查的记录。正文留在纸面，推理与工具证据收进旁注；
          发布前先脱敏，发布后只有一个可撤回的地址。
        </p>
        <div class="home-actions">
          <RouterLink v-if="showDemo" class="btn btn-primary" to="/s/demo-spectral">
            打开示例记录
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
          </RouterLink>
          <RouterLink v-else class="btn btn-primary" to="/connect">
            看怎么接入
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
          </RouterLink>
          <RouterLink v-if="!signedIn && showDemo" class="btn btn-quiet" :to="{ name: 'register', query: demoInvite ? { invite: demoInvite } : undefined }">
            有邀请码，创建账号
          </RouterLink>
          <RouterLink v-else-if="!signedIn" class="btn btn-quiet" :to="{ name: 'register' }">
            有邀请码，创建账号
          </RouterLink>
          <RouterLink v-else class="btn btn-quiet" :to="landing">
            {{ isAdmin ? '进入登记处' : '回到我的分享' }}
          </RouterLink>
        </div>
        <ul class="home-facts" aria-label="产品边界">
          <li>邀请制</li>
          <li>发布前脱敏</li>
          <li>地址可撤回</li>
        </ul>
      </div>

      <div
        ref="sceneEl"
        class="scene"
        :class="{ 'is-static': reduced }"
        aria-label="一份记录从对话、旁注、脱敏到可分享地址的演示"
      >
        <div class="scene-head">
          <span>SCENE / 一次排障会话</span>
          <span class="mono">2026-10-26 · 第 03 轮</span>
        </div>

        <div class="scene-stage">
          <div class="scene-paper">
            <div class="scene-main">
              <p class="scene-turn-label">你 · 02</p>
              <p class="scene-line scene-line-user">
                “这个底鼓在 96 kHz 下录的，但我怀疑问题不在采样率本身。先别重采样，我们做一次单变量对照。”
              </p>
              <p class="scene-turn-label">DeepSeek · 02</p>
              <p class="scene-line scene-line-assistant">
                先做一次单变量对照。我把 96 kHz 与 44.1 kHz 的鼓组各取一段，只更换重采样器，其余链路不动。
              </p>
              <div class="scene-redact-row">
                <span class="scene-redact-label">发布前脱敏</span>
                <span class="scene-redact"><span class="scene-token">/Users/linan/audio-lab/</span><span class="scene-redact-bar"></span></span>
                <span class="scene-redact"><span class="scene-token">sk-live-8f2c-91</span><span class="scene-redact-bar"></span></span>
                <span class="scene-redact-tail">2 处</span>
              </div>
            </div>

            <aside class="scene-margin" aria-label="旁注示例">
              <div class="scene-note">
                <span class="scene-note-label">旁注 01 · 推理</span>
                <p>先排除采样率的影响，只更换重采样器，保留同一段动态。</p>
              </div>
              <div class="scene-note">
                <span class="scene-note-label">旁注 02 · 工具证据</span>
                <p>resample_compare.py 返回 12,480 字符；前 12,000 字符保留，其余只留截断说明。</p>
              </div>
            </aside>
          </div>

          <div class="scene-publish">
            <div class="scene-publish-top">
              <span aria-hidden="true">PUBLISHED</span>
              <span>已发布 · 只读</span>
            </div>
            <p class="scene-publish-title">采样率之外：一次鼓组重采样的频谱体检</p>
            <div class="scene-publish-foot">
              <code>margin.local/s/demo-spectral</code>
              <span>3 轮 · 7 处脱敏</span>
            </div>
            <span class="scene-stamp" aria-hidden="true">已发布</span>
          </div>
        </div>

        <div class="scene-controls">
          <button type="button" class="scene-replay" :disabled="reduced" @click="play">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5h-2.4" />
            </svg>
            {{ reduced ? '已按静态呈现' : playing ? '演示中' : stage === 3 ? '再看一次' : '继续' }}
          </button>
          <div class="scene-stages" role="tablist" aria-label="演示步骤">
            <button
              v-for="(item, index) in stages"
              :key="item.key"
              type="button"
              role="tab"
              :aria-selected="stage === index"
              :class="{ 'is-active': stage === index }"
              @click="seek(index)"
            >
              <span class="mono">0{{ index + 1 }}</span>{{ item.label }}
            </button>
          </div>
          <span class="scene-caption">示意图 · 内容取自示例记录</span>
        </div>
      </div>
    </section>

    <section class="home-layers container">
      <div class="section-marker">01 / 一份记录</div>
      <div class="layers-copy">
        <h2>一次会话，<br />不只是一段回答。</h2>
        <p>
          读的人可以顺着证据往下查，而不是凭语气猜。哪一句是你说的，哪一段是推理，哪一次工具返回被截断，
          都留在同一份记录里。
        </p>
      </div>
      <dl class="layer-list">
        <div class="layer-row">
          <dt><span>01</span>主栏</dt>
          <dd>你与助手说过的话</dd>
          <span class="layer-count mono">读起来像对话</span>
        </div>
        <div class="layer-row">
          <dt><span>02</span>旁注</dt>
          <dd>上下文、推理与工具证据</dd>
          <span class="layer-count mono">需要时再展开</span>
        </div>
        <div class="layer-row">
          <dt><span>03</span>页脚</dt>
          <dd>轮次、脱敏与截断的计数</dd>
          <span class="layer-count mono">不假装原文还在</span>
        </div>
      </dl>
    </section>

    <section class="home-boundaries">
      <div class="container">
        <div class="section-marker">02 / 边界</div>
        <div class="boundary-head">
          <h2>分享之前，<br />先拿走不能分享的。</h2>
          <p>整理、脱敏与选择都在你的 DSH 里完成。边注只负责收下一份已经定稿的记录。</p>
        </div>
        <div class="boundary-list">
          <article class="boundary-row">
            <span class="boundary-num mono">01</span>
            <h3>默认脱敏</h3>
            <p>路径、密钥、令牌和身份线索在离开本机之前替换；页面保留脱敏计数，不假装原文还在。</p>
            <span class="boundary-tag">本地完成</span>
          </article>
          <article class="boundary-row">
            <span class="boundary-num mono">02</span>
            <h3>定稿，不是重建</h3>
            <p>发布出去的是当时那份记录。轮次、截断与选择范围都写进正文，不随后续编辑漂移。</p>
            <span class="boundary-tag">只读归档</span>
          </article>
          <article class="boundary-row">
            <span class="boundary-num mono">03</span>
            <h3>地址可撤回</h3>
            <p>每条记录都有独立的地址。撤回之后，地址不再返回内容；保留期由管理员统一设定。</p>
            <span class="boundary-tag">由你控制</span>
          </article>
        </div>
      </div>
    </section>

    <section class="home-flow container">
      <div class="section-marker">03 / 托管</div>
      <div class="flow-head">
        <h2>一次点击，<br />从会话到地址。</h2>
        <p>没有截图、没有复制粘贴，也没有手工上传。</p>
      </div>
      <ol class="flow-list">
        <li>
          <span class="flow-num mono">01</span>
          <div>
            <h3>在会话里发起</h3>
            <p>分享菜单就在对话上方；可以发布整段，也可以只挑几条消息。</p>
          </div>
          <span class="flow-chip">在会话里</span>
        </li>
        <li>
          <span class="flow-num mono">02</span>
          <div>
            <h3>本地整理</h3>
            <p>解析、脱敏、计数都在 DSH 里完成；离开之前，这份记录已经定稿。</p>
          </div>
          <span class="flow-chip">发布前脱敏</span>
        </li>
        <li>
          <span class="flow-num mono">03</span>
          <div>
            <h3>拿到只读地址</h3>
            <p>地址默认不公开索引；你可以把链接交给该读的人，也可以随时撤回。</p>
          </div>
          <span class="flow-chip">只读 · 不公开索引</span>
        </li>
      </ol>
    </section>

    <section class="home-access">
      <div class="container home-access-inner">
        <div class="access-copy">
          <div class="section-marker section-marker-light">04 / 准入</div>
          <h2>访问是一种署名。</h2>
          <p>
            边注不开放匿名注册。邀请码决定谁能进来，账号由本人创建。管理员只设定容量、保留期与上传节奏，
            不替你决定哪一条该撤回。
          </p>
          <ul class="access-points">
            <li><span class="mono">01</span>邀请码自助创建账号，不再代发临时密码</li>
            <li><span class="mono">02</span>管理员管理整体策略，不介入每条记录</li>
            <li><span class="mono">03</span>个人令牌把本地 DSH 接到边注</li>
          </ul>
        </div>
        <div class="access-card">
          <div class="access-card-top">
            <span class="mono">READER'S CARD</span>
            <span class="mono">NO. 0421</span>
          </div>
          <div class="access-card-name">受邀读者</div>
          <p class="access-card-note">邀请码注册 · 令牌连接 · 记录归本人管理</p>
          <div class="access-card-rule"></div>
          <div class="access-card-foot">
            <span>边注 · 会话托管</span>
            <RouterLink v-if="!signedIn" class="access-card-link" :to="{ name: 'register', query: demoInvite ? { invite: demoInvite } : undefined }">
              创建账号 →
            </RouterLink>
            <RouterLink v-else class="access-card-link" :to="landing">进入 →</RouterLink>
          </div>
          <div class="access-stamp" aria-hidden="true">准入</div>
        </div>
      </div>
    </section>

    <section class="home-close container">
      <p class="section-marker">现在</p>
      <h2>先读一份，<br />再决定要不要留下自己的。</h2>
      <div class="home-actions">
        <RouterLink v-if="showDemo" class="btn btn-primary" to="/s/demo-spectral">打开示例记录</RouterLink>
        <RouterLink v-else class="btn btn-primary" to="/connect">看怎么接入</RouterLink>
        <RouterLink v-if="showDemo" class="btn btn-quiet" to="/connect">看怎么接入</RouterLink>
        <RouterLink v-if="!signedIn" class="btn btn-ghost" :to="{ name: 'login' }">已有账号，登录</RouterLink>
      </div>
    </section>
  </div>
</template>
