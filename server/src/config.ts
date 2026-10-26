// 运行模式：mock（本地预览）与 remote（接服务器后端）。
// 生产默认 remote、开发默认 mock；部署脚本强制 remote。
export type AuthMode = 'mock' | 'remote'

export const AUTH_MODE: AuthMode = import.meta.env.VITE_AUTH_MODE === 'mock' ? 'mock' : (import.meta.env.PROD ? 'remote' : 'mock')

export const REMOTE_MODE = AUTH_MODE === 'remote'

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'
