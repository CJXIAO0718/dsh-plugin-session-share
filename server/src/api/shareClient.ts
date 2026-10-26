import { localShareClient } from './localClient'
import { remoteShareClient } from './remoteShareClient'
import type { ShareClient } from './types'

// 内联环境判断（构建期常量），保证未用到的适配器被摇掉。
const USE_REMOTE = import.meta.env.VITE_AUTH_MODE === 'remote'

export const shareClient: ShareClient = USE_REMOTE ? remoteShareClient : localShareClient
