const PROFILE_AUTH_KEY = 'magiccollection.profile-auth.v1'

interface ProfileAuthRecord {
  passcodeHash: string
  updatedAt: string
}

type ProfileAuthMap = Record<string, ProfileAuthRecord>

function nowIso(): string {
  return new Date().toISOString()
}

function readAuthMap(): ProfileAuthMap {
  try {
    const raw = window.localStorage.getItem(PROFILE_AUTH_KEY)
    if (!raw) {
      return {}
    }
    return JSON.parse(raw) as ProfileAuthMap
  } catch {
    return {}
  }
}

function writeAuthMap(map: ProfileAuthMap): void {
  window.localStorage.setItem(PROFILE_AUTH_KEY, JSON.stringify(map))
}

function normalizePasscode(passcode: string): string {
  return passcode.trim()
}

// Lightweight local hash for a rudimentary passcode gate. Not intended as strong cryptography.
function hashPasscode(passcode: string): string {
  const normalized = normalizePasscode(passcode)
  let hash = 2166136261
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function listProtectedProfileIds(validProfileIds?: string[]): Set<string> {
  const map = readAuthMap()
  if (!validProfileIds) {
    return new Set(Object.keys(map))
  }

  const valid = new Set(validProfileIds)
  const next: ProfileAuthMap = {}
  for (const [profileId, record] of Object.entries(map)) {
    if (valid.has(profileId)) {
      next[profileId] = record
    }
  }

  if (Object.keys(next).length !== Object.keys(map).length) {
    writeAuthMap(next)
  }

  return new Set(Object.keys(next))
}

export function profileHasPasscode(profileId: string): boolean {
  const map = readAuthMap()
  return Boolean(map[profileId]?.passcodeHash)
}

export function setProfilePasscode(profileId: string, passcode: string): void {
  const normalized = normalizePasscode(passcode)
  const map = readAuthMap()

  if (!normalized) {
    delete map[profileId]
    writeAuthMap(map)
    return
  }

  map[profileId] = {
    passcodeHash: hashPasscode(normalized),
    updatedAt: nowIso(),
  }
  writeAuthMap(map)
}

export function verifyProfilePasscode(profileId: string, passcode: string): boolean {
  const map = readAuthMap()
  const stored = map[profileId]
  if (!stored?.passcodeHash) {
    return true
  }
  return stored.passcodeHash === hashPasscode(passcode)
}
