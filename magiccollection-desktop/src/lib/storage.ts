import type { OwnedCardMap, Profile } from '../types'

const PROFILE_KEY = 'magiccollection.profiles.v1'
const ACTIVE_PROFILE_KEY = 'magiccollection.active-profile-id.v1'
const COLLECTION_KEY_PREFIX = 'magiccollection.collection.v1'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return fallback
    }

    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function loadProfiles(): Profile[] {
  return readJson<Profile[]>(PROFILE_KEY, [])
}

export function saveProfiles(profiles: Profile[]): void {
  writeJson(PROFILE_KEY, profiles)
}

export function loadActiveProfileId(): string | null {
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY)
}

export function saveActiveProfileId(profileId: string): void {
  window.localStorage.setItem(ACTIVE_PROFILE_KEY, profileId)
}

export function clearActiveProfileId(): void {
  window.localStorage.removeItem(ACTIVE_PROFILE_KEY)
}

function collectionKey(profileId: string): string {
  return `${COLLECTION_KEY_PREFIX}.${profileId}`
}

export function loadCollection(profileId: string): OwnedCardMap {
  return readJson<OwnedCardMap>(collectionKey(profileId), {})
}

export function saveCollection(
  profileId: string,
  collection: OwnedCardMap,
): void {
  writeJson(collectionKey(profileId), collection)
}
