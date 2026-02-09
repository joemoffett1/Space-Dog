const ACTIVE_PROFILE_KEY = 'magiccollection.active-profile-id.v1'

export function loadActiveProfileId(): string | null {
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY)
}

export function saveActiveProfileId(profileId: string): void {
  window.localStorage.setItem(ACTIVE_PROFILE_KEY, profileId)
}

export function clearActiveProfileId(): void {
  window.localStorage.removeItem(ACTIVE_PROFILE_KEY)
}
