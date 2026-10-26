export type UserRole = 'admin' | 'member'
export type UserStatus = 'active' | 'suspended'

export interface AuthUser {
  id: string
  username: string
  name: string
  role: UserRole
  status: UserStatus
  createdAt: string
  lastSeenAt: string
}

export interface AuthSession {
  user: AuthUser
  expiresAt: string
  persistent: boolean
}

export interface LoginInput {
  username: string
  password: string
  remember: boolean
}

export interface RegisterInput {
  inviteCode: string
  username: string
  password: string
  remember: boolean
}

export interface AuthClient {
  readonly mode: 'mock' | 'remote'
  login(input: LoginInput): Promise<AuthSession>
  register(input: RegisterInput): Promise<AuthSession>
  me(): Promise<AuthSession | null>
  logout(): Promise<void>
}

export class AuthError extends Error {
  code:
    | 'invalid_credentials'
    | 'rate_limited'
    | 'account_suspended'
    | 'invalid_invite'
    | 'invite_expired'
    | 'invite_exhausted'
    | 'invite_revoked'
    | 'username_taken'
    | 'invalid_input'
    | 'network'
    | 'unknown'
  status: number
  retryAfter: number

  constructor(
    code: AuthError['code'],
    message: string,
    status = 400,
    retryAfter = 0,
  ) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}
