import { localShareClient } from './localClient'
import { remoteShareClient } from './remoteShareClient'
import type { ShareClient } from './types'
import { REMOTE_MODE } from '../config'

// All adapters share the same build-time mode; production defaults to remote.
const USE_REMOTE = REMOTE_MODE

export const shareClient: ShareClient = USE_REMOTE ? remoteShareClient : localShareClient
