import { computed, reactive, readonly } from 'vue'
import type { AuthClient, AuthUser, LoginInput, RegisterInput } from './types'
import { refreshPolicy } from '../admin/settings'

interface AuthState {
  user: AuthUser | null
  ready: boolean
  initializing: boolean
}

export const authState = reactive<AuthState>({
  user: null,
  ready: false,
  initializing: false,
})

// 构建期决定 mock / remote；两条适配器都按需加载，
// 生产构建（VITE_AUTH_MODE=remote）里 mock 实现与演示凭据不会进入代码图。
const USE_REMOTE = import.meta.env.VITE_AUTH_MODE === 'remote'

let clientPromise: Promise<AuthClient> | null = null

function loadClient(): Promise<AuthClient> {
  if (!clientPromise) {
    clientPromise = USE_REMOTE
      ? import('./remoteAuth').then((module) => module.remoteAuthClient)
      : import('./mockAuth').then((module) => module.authClient)
  }
  return clientPromise
}

export const AUTH_CLIENT_MODE: 'mock' | 'remote' = USE_REMOTE ? 'remote' : 'mock'

let initPromise: Promise<void> | null = null

export async function ensureAuth(): Promise<void> {
  if (authState.ready) return
  if (initPromise) return initPromise
  authState.initializing = true
  initPromise = loadClient()
    .then((client) => client.me())
    .then((session) => {
      authState.user = session?.user ?? null
    })
    .catch(() => {
      authState.user = null
    })
    .finally(() => {
      authState.ready = true
      authState.initializing = false
    })
  return initPromise
}

export async function signIn(input: LoginInput): Promise<AuthUser> {
  const client = await loadClient()
  const session = await client.login(input)
  authState.user = session.user
  authState.ready = true
  void refreshPolicy()
  return session.user
}

export async function signUp(input: RegisterInput): Promise<AuthUser> {
  const client = await loadClient()
  const session = await client.register(input)
  authState.user = session.user
  authState.ready = true
  void refreshPolicy()
  return session.user
}

export async function signOut(): Promise<void> {
  const client = await loadClient()
  await client.logout()
  authState.user = null
}

export function useAuth() {
  const isAuthenticated = computed(() => authState.user !== null)
  const isAdmin = computed(() => authState.user?.role === 'admin')
  const initials = computed(() => authState.user?.name.slice(0, 1) ?? '')
  const mode = AUTH_CLIENT_MODE

  return {
    state: readonly(authState),
    isAuthenticated,
    isAdmin,
    initials,
    mode,
    ensureAuth,
    signIn,
    signUp,
    signOut,
  }
}
