import { createRouter, createWebHistory } from 'vue-router'
import { ensureAuth, authState } from './auth/useAuth'
const HomeView = () => import('./views/HomeView.vue')
const ArchiveView = () => import('./views/ArchiveView.vue')
const TokensView = () => import('./views/TokensView.vue')
const ReaderView = () => import('./views/ReaderView.vue')
const ApiView = () => import('./views/ApiView.vue')
const ConnectView = () => import('./views/ConnectView.vue')
const LoginView = () => import('./views/LoginView.vue')
const RegisterView = () => import('./views/RegisterView.vue')
const AdminView = () => import('./views/AdminView.vue')

function defaultLanding(): string {
  return authState.user?.role === 'admin' ? '/admin' : '/archive'
}

function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: '边注 · 会话托管' } },
    {
      path: '/archive',
      name: 'archive',
      component: ArchiveView,
      meta: { requiresAuth: true, title: '我的分享 · 边注' },
    },
    {
      path: '/tokens',
      name: 'tokens',
      component: TokensView,
      meta: { requiresAuth: true, title: '连接与令牌 · 边注' },
    },
    { path: '/s/:id', name: 'reader', component: ReaderView, props: true, meta: { title: '会话存档 · 边注' } },
    { path: '/connect', name: 'connect', component: ConnectView, meta: { title: '把 DSH 接到边注' } },
    { path: '/api', name: 'api', component: ApiView, meta: { title: '接口参考 · 边注' } },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { guestOnly: true, bare: true, title: '登录 · 边注' },
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView,
      meta: { guestOnly: true, bare: true, title: '使用邀请码创建账号 · 边注' },
    },
    {
      path: '/admin',
      name: 'admin',
      component: AdminView,
      meta: { requiresAuth: true, requiresAdmin: true, bare: true, title: '登记处 · 边注' },
    },
    {
      path: '/admin/invites',
      name: 'admin-invites',
      component: AdminView,
      meta: { requiresAuth: true, requiresAdmin: true, bare: true, title: '邀请码 · 边注' },
    },
    {
      path: '/admin/people',
      name: 'admin-people',
      component: AdminView,
      meta: { requiresAuth: true, requiresAdmin: true, bare: true, title: '成员管理 · 边注' },
    },
    {
      path: '/admin/settings',
      name: 'admin-settings',
      component: AdminView,
      meta: { requiresAuth: true, requiresAdmin: true, bare: true, title: '系统设置 · 边注' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash) {
      return new Promise((resolve) => {
        window.setTimeout(() => {
          const target = document.querySelector(to.hash)
          if (target) target.scrollIntoView({ block: 'start' })
          resolve(false)
        }, 80)
      })
    }
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  await ensureAuth()

  if (to.meta.requiresAuth && !authState.user) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.meta.requiresAdmin && authState.user?.role !== 'admin') {
    return { name: 'archive' }
  }

  if (to.meta.guestOnly && authState.user) {
    return safeRedirect(to.query.redirect) ?? defaultLanding()
  }

  return true
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '边注 · 会话托管'
  if (title) document.title = title
})
