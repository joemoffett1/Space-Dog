export interface LocalAuthAccount {
  id: string
  username: string
  email?: string | null
  passwordHash: string
  salt: string
  createdAt: string
  updatedAt: string
  syncPending: boolean
  lastSyncedAt?: string | null
}

export interface LocalAuthSession {
  accountId: string
  username: string
  signedInAt: string
}

export interface LocalAuthStatus {
  hasAccount: boolean
  signedIn: boolean
  username: string | null
  syncPending: boolean
  lastSyncedAt: string | null
}

const AUTH_ACCOUNT_KEY = 'magiccollection.local-auth.account.v1'
const AUTH_SESSION_KEY = 'magiccollection.local-auth.session.v1'

function nowIso(): string {
  return new Date().toISOString()
}

function readAccount(): LocalAuthAccount | null {
  try {
    const raw = window.localStorage.getItem(AUTH_ACCOUNT_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as LocalAuthAccount
  } catch {
    return null
  }
}

function writeAccount(account: LocalAuthAccount): void {
  window.localStorage.setItem(AUTH_ACCOUNT_KEY, JSON.stringify(account))
}

function readSession(): LocalAuthSession | null {
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as LocalAuthSession
  } catch {
    return null
  }
}

function writeSession(session: LocalAuthSession): void {
  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
}

function clearSession(): void {
  window.localStorage.removeItem(AUTH_SESSION_KEY)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function fallbackHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function sha256Hex(input: string): Promise<string> {
  if (!window.crypto?.subtle || !window.TextEncoder) {
    return fallbackHash(input)
  }
  const bytes = new TextEncoder().encode(input)
  const digest = await window.crypto.subtle.digest('SHA-256', bytes)
  return toHex(new Uint8Array(digest))
}

function randomSaltHex(): string {
  if (!window.crypto?.getRandomValues) {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`
  }
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  return toHex(bytes)
}

async function passwordHash(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`)
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function getLocalAuthStatus(): LocalAuthStatus {
  const account = readAccount()
  const session = readSession()
  const signedIn =
    !!account && !!session && account.id === session.accountId && account.username === session.username

  return {
    hasAccount: !!account,
    signedIn,
    username: account?.username ?? null,
    syncPending: account?.syncPending ?? false,
    lastSyncedAt: account?.lastSyncedAt ?? null,
  }
}

export async function registerLocalAuthAccount(input: {
  username: string
  password: string
  email?: string
}): Promise<LocalAuthAccount> {
  const existing = readAccount()
  if (existing) {
    throw new Error('Local auth account already exists on this device.')
  }

  const username = normalizeUsername(input.username)
  if (!username) {
    throw new Error('Username is required.')
  }
  if (input.password.trim().length < 6) {
    throw new Error('Password must be at least 6 characters.')
  }

  const salt = randomSaltHex()
  const hash = await passwordHash(input.password.trim(), salt)
  const account: LocalAuthAccount = {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${username}`,
    username,
    email: input.email?.trim() || null,
    passwordHash: hash,
    salt,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    syncPending: true,
    lastSyncedAt: null,
  }

  writeAccount(account)
  writeSession({
    accountId: account.id,
    username: account.username,
    signedInAt: nowIso(),
  })
  return account
}

export async function loginLocalAuthAccount(input: {
  username: string
  password: string
}): Promise<boolean> {
  const account = readAccount()
  if (!account) {
    throw new Error('No local auth account exists yet.')
  }

  const username = normalizeUsername(input.username)
  if (username !== account.username) {
    return false
  }

  const hash = await passwordHash(input.password.trim(), account.salt)
  if (hash !== account.passwordHash) {
    return false
  }

  writeSession({
    accountId: account.id,
    username: account.username,
    signedInAt: nowIso(),
  })
  return true
}

export function logoutLocalAuthAccount(): void {
  clearSession()
}

export function getPendingLocalAuthSyncPayload():
  | {
      accountId: string
      username: string
      email: string | null
      passwordHash: string
      salt: string
      updatedAt: string
    }
  | null {
  const account = readAccount()
  if (!account || !account.syncPending) {
    return null
  }

  return {
    accountId: account.id,
    username: account.username,
    email: account.email ?? null,
    passwordHash: account.passwordHash,
    salt: account.salt,
    updatedAt: account.updatedAt,
  }
}

export function markLocalAuthSynced(timestamp?: string): void {
  const account = readAccount()
  if (!account) {
    return
  }
  account.syncPending = false
  account.lastSyncedAt = timestamp ?? nowIso()
  account.updatedAt = nowIso()
  writeAccount(account)
}
