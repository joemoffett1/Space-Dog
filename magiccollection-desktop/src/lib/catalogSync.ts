import { invoke } from '@tauri-apps/api/core'

export interface CatalogPriceRecord {
  scryfallId: string
  name: string
  setCode: string
  collectorNumber: string
  imageUrl?: string
  marketPrice: number
  updatedAt: string
}

interface ManifestEntry {
  version: string
  snapshot?: string
  patchFromPrevious?: string
  createdAt: string
}

interface CompactedPatchEntry {
  fromVersion: string
  toVersion: string
  path: string
  createdAt: string
}

interface SyncPolicy {
  compactedThresholdMissed: number
  forceFullThresholdMissed: number
  compactedRetentionDays: number
  expectedPublishTimeUtc?: string
  refreshUnlockLagMinutes?: number
}

interface SyncManifest {
  latestVersion: string
  latestSnapshot?: string
  syncPolicy?: SyncPolicy
  versions: ManifestEntry[]
  compactedPatches?: CompactedPatchEntry[]
}

interface PatchFile {
  fromVersion: string
  toVersion: string
  added: CatalogPriceRecord[]
  updated: CatalogPriceRecord[]
  removed: string[]
}

interface CatalogSyncStateRow {
  dataset: string
  currentVersion: string | null
  stateHash: string | null
  syncedAt: string | null
  totalRecords: number
}

interface CatalogApplyResult {
  dataset: string
  fromVersion: string | null
  toVersion: string
  strategy: string
  patchHash: string | null
  stateHash: string
  totalRecords: number
  addedCount: number
  updatedCount: number
  removedCount: number
}

export interface CatalogSyncResult {
  fromVersion: string | null
  toVersion: string
  strategy: 'noop' | 'chain' | 'compacted' | 'full'
  appliedPatches: number
  added: number
  updated: number
  removed: number
  totalRecords: number
}

export interface CatalogSyncStatus {
  localVersion: string | null
  latestVersion: string
  canRefreshNow: boolean
  refreshLockedUntilUtc: string
  reason: string
}

const CATALOG_DATASET = 'default_cards'
const CATALOG_DATA_KEY = 'magiccollection.catalog.data.v1'
const CATALOG_VERSION_KEY = 'magiccollection.catalog.version.v1'
const CATALOG_DEMO_SEEDED_KEY = 'magiccollection.catalog.demo-seeded.v1'
const DEFAULT_COMPACTED_THRESHOLD = 5
const DEFAULT_FORCE_FULL_THRESHOLD = 21
const DEFAULT_EXPECTED_PUBLISH_TIME_UTC = '22:30'
const DEFAULT_REFRESH_UNLOCK_LAG_MINUTES = 60

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function readStoredCatalogMap(): Record<string, CatalogPriceRecord> {
  if (!hasWindow()) {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(CATALOG_DATA_KEY)
    if (!raw) {
      return {}
    }
    return JSON.parse(raw) as Record<string, CatalogPriceRecord>
  } catch {
    return {}
  }
}

function writeStoredCatalogMap(map: Record<string, CatalogPriceRecord>): void {
  if (!hasWindow()) {
    return
  }
  window.localStorage.setItem(CATALOG_DATA_KEY, JSON.stringify(map))
}

export function readCatalogVersion(): string | null {
  if (!hasWindow() || hasTauriRuntime()) {
    return null
  }
  return window.localStorage.getItem(CATALOG_VERSION_KEY)
}

function writeCatalogVersion(version: string): void {
  if (!hasWindow() || hasTauriRuntime()) {
    return
  }
  window.localStorage.setItem(CATALOG_VERSION_KEY, version)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Catalog sync request failed (${response.status}) for ${url}`)
  }
  return (await response.json()) as T
}

function asRecordMap(records: CatalogPriceRecord[]): Record<string, CatalogPriceRecord> {
  return records.reduce<Record<string, CatalogPriceRecord>>((acc, entry) => {
    acc[entry.scryfallId] = entry
    return acc
  }, {})
}

function applyPatch(map: Record<string, CatalogPriceRecord>, patch: PatchFile) {
  for (const id of patch.removed) {
    delete map[id]
  }
  for (const row of patch.added) {
    map[row.scryfallId] = row
  }
  for (const row of patch.updated) {
    map[row.scryfallId] = row
  }
}

async function loadSnapshotRecords(path: string): Promise<CatalogPriceRecord[]> {
  return fetchJson<CatalogPriceRecord[]>(`/mock-sync/${path}`)
}

async function loadSnapshotToMap(path: string): Promise<Record<string, CatalogPriceRecord>> {
  const rows = await loadSnapshotRecords(path)
  return asRecordMap(rows)
}

function resolvePolicy(manifest: SyncManifest): Required<SyncPolicy> {
  return {
    compactedThresholdMissed:
      manifest.syncPolicy?.compactedThresholdMissed ?? DEFAULT_COMPACTED_THRESHOLD,
    forceFullThresholdMissed:
      manifest.syncPolicy?.forceFullThresholdMissed ?? DEFAULT_FORCE_FULL_THRESHOLD,
    compactedRetentionDays: manifest.syncPolicy?.compactedRetentionDays ?? 21,
    expectedPublishTimeUtc:
      manifest.syncPolicy?.expectedPublishTimeUtc ?? DEFAULT_EXPECTED_PUBLISH_TIME_UTC,
    refreshUnlockLagMinutes:
      manifest.syncPolicy?.refreshUnlockLagMinutes ?? DEFAULT_REFRESH_UNLOCK_LAG_MINUTES,
  }
}

function findVersionIndex(manifest: SyncManifest, version: string): number {
  return manifest.versions.findIndex((entry) => entry.version === version)
}

function parseUtcDateFromVersion(version: string): Date {
  if (/^v\d{6}$/i.test(version)) {
    const yy = Number(version.slice(1, 3))
    const mm = Number(version.slice(3, 5))
    const dd = Number(version.slice(5, 7))
    const year = 2000 + yy
    return new Date(Date.UTC(year, mm - 1, dd, 0, 0, 0, 0))
  }

  const [year, month, day] = version.split('-').map((value) => Number(value))
  if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  }

  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

function buildRefreshUnlockUtc(version: string, expectedTimeUtc: string, lagMinutes: number): Date {
  const base = parseUtcDateFromVersion(version)
  const [hourText, minuteText] = expectedTimeUtc.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  base.setUTCHours(Number.isFinite(hour) ? hour : 22, Number.isFinite(minute) ? minute : 30, 0, 0)
  return new Date(base.getTime() + lagMinutes * 60 * 1000)
}

async function getBackendSyncState(): Promise<CatalogSyncStateRow> {
  return invoke<CatalogSyncStateRow>('get_catalog_sync_state', {
    dataset: CATALOG_DATASET,
  })
}

async function getBackendCatalogPriceRecords(
  scryfallIds: string[],
): Promise<CatalogPriceRecord[]> {
  if (!scryfallIds.length) {
    return []
  }
  return invoke<CatalogPriceRecord[]>('get_catalog_price_records', {
    dataset: CATALOG_DATASET,
    scryfallIds,
  })
}

async function applyBackendSnapshot(input: {
  version: string
  records: CatalogPriceRecord[]
  snapshotHash?: string
  strategy?: string
}): Promise<CatalogApplyResult> {
  return invoke<CatalogApplyResult>('apply_catalog_snapshot', {
    input: {
      dataset: CATALOG_DATASET,
      version: input.version,
      records: input.records,
      snapshotHash: input.snapshotHash ?? null,
      strategy: input.strategy ?? 'full',
    },
  })
}

async function applyBackendPatch(input: {
  patch: PatchFile
  patchHash?: string
  strategy?: string
}): Promise<CatalogApplyResult> {
  return invoke<CatalogApplyResult>('apply_catalog_patch', {
    input: {
      dataset: CATALOG_DATASET,
      fromVersion: input.patch.fromVersion,
      toVersion: input.patch.toVersion,
      added: input.patch.added,
      updated: input.patch.updated,
      removed: input.patch.removed,
      patchHash: input.patchHash ?? null,
      strategy: input.strategy ?? 'chain',
    },
  })
}

export async function getCatalogPriceRecords(
  scryfallIds: string[],
): Promise<Record<string, CatalogPriceRecord>> {
  if (!scryfallIds.length) {
    return {}
  }

  if (!hasTauriRuntime()) {
    const map = readStoredCatalogMap()
    const out: Record<string, CatalogPriceRecord> = {}
    for (const id of scryfallIds) {
      const row = map[id]
      if (row) {
        out[id] = row
      }
    }
    return out
  }

  const uniqueIds = [...new Set(scryfallIds.map((id) => id.trim()).filter(Boolean))]
  const rows = await getBackendCatalogPriceRecords(uniqueIds)
  return asRecordMap(rows)
}

export function getCatalogPriceRecord(scryfallId: string): CatalogPriceRecord | null {
  if (hasTauriRuntime()) {
    return null
  }
  const map = readStoredCatalogMap()
  return map[scryfallId] ?? null
}

export async function seedDemoOutdatedCatalogOnce(): Promise<void> {
  if (!hasWindow()) {
    return
  }

  const alreadySeeded = window.localStorage.getItem(CATALOG_DEMO_SEEDED_KEY)
  if (alreadySeeded === '1') {
    return
  }

  const manifest = await fetchJson<SyncManifest>('/mock-sync/manifest.json')
  const oldest = manifest.versions.find((entry) => !!entry.snapshot)
  if (!oldest?.snapshot) {
    return
  }

  if (hasTauriRuntime()) {
    const state = await getBackendSyncState()
    if (state.currentVersion) {
      window.localStorage.setItem(CATALOG_DEMO_SEEDED_KEY, '1')
      return
    }

    const rows = await loadSnapshotRecords(oldest.snapshot)
    await applyBackendSnapshot({
      version: oldest.version,
      records: rows,
      strategy: 'seed',
    })
    window.localStorage.setItem(CATALOG_DEMO_SEEDED_KEY, '1')
    return
  }

  const map = await loadSnapshotToMap(oldest.snapshot)
  writeStoredCatalogMap(map)
  writeCatalogVersion(oldest.version)
  window.localStorage.setItem(CATALOG_DEMO_SEEDED_KEY, '1')
}

export async function getCatalogSyncStatus(): Promise<CatalogSyncStatus> {
  const manifest = await fetchJson<SyncManifest>('/mock-sync/manifest.json')
  const policy = resolvePolicy(manifest)
  const latestVersion = manifest.latestVersion

  let localVersion: string | null
  if (hasTauriRuntime()) {
    const state = await getBackendSyncState()
    localVersion = state.currentVersion
  } else {
    localVersion = readCatalogVersion()
  }

  if (!localVersion) {
    localVersion = latestVersion
    if (!hasTauriRuntime()) {
      writeCatalogVersion(latestVersion)
    }
  }

  if (localVersion !== latestVersion) {
    const unlockAtWhenUnsynced = buildRefreshUnlockUtc(
      latestVersion,
      policy.expectedPublishTimeUtc,
      policy.refreshUnlockLagMinutes,
    )
    return {
      localVersion,
      latestVersion,
      canRefreshNow: true,
      refreshLockedUntilUtc: unlockAtWhenUnsynced.toISOString(),
      reason: 'Local build is behind latest. Refresh is available now.',
    }
  }

  const unlockAt = buildRefreshUnlockUtc(
    latestVersion,
    policy.expectedPublishTimeUtc,
    policy.refreshUnlockLagMinutes,
  )
  const now = new Date()

  if (now < unlockAt) {
    return {
      localVersion,
      latestVersion,
      canRefreshNow: false,
      refreshLockedUntilUtc: unlockAt.toISOString(),
      reason: 'Waiting for scheduled Scryfall publish window + server patch time.',
    }
  }

  return {
    localVersion,
    latestVersion,
    canRefreshNow: false,
    refreshLockedUntilUtc: unlockAt.toISOString(),
    reason: 'Already on latest data build.',
  }
}

async function syncCatalogWithBackend(
  manifest: SyncManifest,
  policy: Required<SyncPolicy>,
): Promise<CatalogSyncResult> {
  const initialState = await getBackendSyncState()
  const previousVersion = initialState.currentVersion

  let workingVersion = initialState.currentVersion
  let appliedPatches = 0
  let added = 0
  let updated = 0
  let removed = 0
  let strategy: CatalogSyncResult['strategy'] = 'noop'

  if (!workingVersion) {
    const snapshotPath =
      manifest.latestSnapshot ??
      manifest.versions.find((entry) => !!entry.snapshot)?.snapshot
    if (!snapshotPath) {
      throw new Error('Catalog manifest does not contain an initial snapshot.')
    }
    const rows = await loadSnapshotRecords(snapshotPath)
    const result = await applyBackendSnapshot({
      version: manifest.latestVersion,
      records: rows,
      strategy: 'full',
    })

    return {
      fromVersion: previousVersion,
      toVersion: result.toVersion,
      strategy: 'full',
      appliedPatches: 0,
      added: result.addedCount,
      updated: result.updatedCount,
      removed: result.removedCount,
      totalRecords: result.totalRecords,
    }
  }

  if (workingVersion === manifest.latestVersion) {
    return {
      fromVersion: previousVersion,
      toVersion: workingVersion,
      strategy: 'noop',
      appliedPatches: 0,
      added: 0,
      updated: 0,
      removed: 0,
      totalRecords: initialState.totalRecords,
    }
  }

  const startIndex = findVersionIndex(manifest, workingVersion)
  const latestIndex = findVersionIndex(manifest, manifest.latestVersion)
  if (startIndex === -1 || latestIndex === -1) {
    const snapshotPath =
      manifest.latestSnapshot ??
      manifest.versions.find((entry) => !!entry.snapshot)?.snapshot
    if (!snapshotPath) {
      throw new Error('Catalog sync cannot recover because no snapshot is available.')
    }
    const rows = await loadSnapshotRecords(snapshotPath)
    const result = await applyBackendSnapshot({
      version: manifest.latestVersion,
      records: rows,
      strategy: 'full',
    })
    return {
      fromVersion: previousVersion,
      toVersion: result.toVersion,
      strategy: 'full',
      appliedPatches: 0,
      added: result.addedCount,
      updated: result.updatedCount,
      removed: result.removedCount,
      totalRecords: result.totalRecords,
    }
  }

  const missedUpdates = latestIndex - startIndex
  if (missedUpdates >= policy.forceFullThresholdMissed) {
    const snapshotPath =
      manifest.latestSnapshot ??
      manifest.versions.find((entry) => entry.version === manifest.latestVersion)?.snapshot
    if (!snapshotPath) {
      throw new Error('Full sync required but latest snapshot is missing from manifest.')
    }
    const rows = await loadSnapshotRecords(snapshotPath)
    const result = await applyBackendSnapshot({
      version: manifest.latestVersion,
      records: rows,
      strategy: 'full',
    })
    return {
      fromVersion: previousVersion,
      toVersion: result.toVersion,
      strategy: 'full',
      appliedPatches: 0,
      added: result.addedCount,
      updated: result.updatedCount,
      removed: result.removedCount,
      totalRecords: result.totalRecords,
    }
  }

  if (missedUpdates >= policy.compactedThresholdMissed) {
    const compacted = manifest.compactedPatches?.find(
      (entry) =>
        entry.fromVersion === workingVersion &&
        entry.toVersion === manifest.latestVersion,
    )

    if (compacted?.path) {
      const patch = await fetchJson<PatchFile>(`/mock-sync/${compacted.path}`)
      const result = await applyBackendPatch({
        patch,
        strategy: 'compacted',
      })
      appliedPatches = 1
      added = result.addedCount
      updated = result.updatedCount
      removed = result.removedCount
      workingVersion = result.toVersion
      strategy = 'compacted'
    }
  }

  if (workingVersion !== manifest.latestVersion) {
    const recheckStartIndex = findVersionIndex(manifest, workingVersion)
    if (recheckStartIndex === -1) {
      throw new Error('Unable to resolve chain sync from current catalog version.')
    }

    for (let i = recheckStartIndex + 1; i <= latestIndex; i += 1) {
      const entry = manifest.versions[i]
      if (!entry?.patchFromPrevious) {
        continue
      }
      const patch = await fetchJson<PatchFile>(`/mock-sync/${entry.patchFromPrevious}`)
      const result = await applyBackendPatch({
        patch,
        strategy: 'chain',
      })
      appliedPatches += 1
      added += result.addedCount
      updated += result.updatedCount
      removed += result.removedCount
      workingVersion = result.toVersion
      strategy = 'chain'
    }
  }

  if (workingVersion !== manifest.latestVersion) {
    const snapshotPath =
      manifest.latestSnapshot ??
      manifest.versions.find((entry) => entry.version === manifest.latestVersion)?.snapshot
    if (!snapshotPath) {
      throw new Error('Catalog sync did not reach latest and no recovery snapshot exists.')
    }
    const rows = await loadSnapshotRecords(snapshotPath)
    const result = await applyBackendSnapshot({
      version: manifest.latestVersion,
      records: rows,
      strategy: 'full',
    })
    return {
      fromVersion: previousVersion,
      toVersion: result.toVersion,
      strategy: 'full',
      appliedPatches,
      added: added + result.addedCount,
      updated: updated + result.updatedCount,
      removed: removed + result.removedCount,
      totalRecords: result.totalRecords,
    }
  }

  const finalState = await getBackendSyncState()
  return {
    fromVersion: previousVersion,
    toVersion: workingVersion,
    strategy,
    appliedPatches,
    added,
    updated,
    removed,
    totalRecords: finalState.totalRecords,
  }
}

async function syncCatalogWithLocalStorage(
  manifest: SyncManifest,
  policy: Required<SyncPolicy>,
): Promise<CatalogSyncResult> {
  const currentVersion = readCatalogVersion()
  const previousVersion = currentVersion

  let map = readStoredCatalogMap()
  let appliedPatches = 0
  let added = 0
  let updated = 0
  let removed = 0
  let strategy: CatalogSyncResult['strategy'] = 'noop'

  if (!currentVersion) {
    const seedSnapshotPath =
      manifest.latestSnapshot ??
      manifest.versions.find((entry) => !!entry.snapshot)?.snapshot
    if (!seedSnapshotPath) {
      throw new Error('Catalog manifest does not contain an initial snapshot.')
    }

    map = await loadSnapshotToMap(seedSnapshotPath)
    writeStoredCatalogMap(map)
    writeCatalogVersion(manifest.latestVersion)
    strategy = 'full'

    return {
      fromVersion: previousVersion,
      toVersion: manifest.latestVersion,
      strategy,
      appliedPatches: 0,
      added: 0,
      updated: 0,
      removed: 0,
      totalRecords: Object.keys(map).length,
    }
  }

  let workingVersion = readCatalogVersion()
  if (!workingVersion) {
    throw new Error('Unable to establish initial catalog version.')
  }

  if (workingVersion === manifest.latestVersion) {
    return {
      fromVersion: previousVersion,
      toVersion: workingVersion,
      strategy: 'noop',
      appliedPatches: 0,
      added: 0,
      updated: 0,
      removed: 0,
      totalRecords: Object.keys(map).length,
    }
  }

  const startIndex = findVersionIndex(manifest, workingVersion)
  const latestIndex = findVersionIndex(manifest, manifest.latestVersion)
  if (startIndex === -1 || latestIndex === -1) {
    const snapshotPath =
      manifest.latestSnapshot ??
      manifest.versions.find((entry) => !!entry.snapshot)?.snapshot
    if (!snapshotPath) {
      throw new Error('Catalog sync cannot recover because no snapshot is available.')
    }

    map = await loadSnapshotToMap(snapshotPath)
    workingVersion = manifest.latestVersion
    strategy = 'full'

    writeStoredCatalogMap(map)
    writeCatalogVersion(workingVersion)
    return {
      fromVersion: previousVersion,
      toVersion: workingVersion,
      strategy,
      appliedPatches: 0,
      added: 0,
      updated: 0,
      removed: 0,
      totalRecords: Object.keys(map).length,
    }
  }

  const missedUpdates = latestIndex - startIndex
  if (missedUpdates >= policy.forceFullThresholdMissed) {
    const snapshotPath =
      manifest.latestSnapshot ??
      manifest.versions.find((entry) => entry.version === manifest.latestVersion)?.snapshot
    if (!snapshotPath) {
      throw new Error('Full sync required but latest snapshot is missing from manifest.')
    }

    map = await loadSnapshotToMap(snapshotPath)
    workingVersion = manifest.latestVersion
    strategy = 'full'

    writeStoredCatalogMap(map)
    writeCatalogVersion(workingVersion)
    return {
      fromVersion: previousVersion,
      toVersion: workingVersion,
      strategy,
      appliedPatches: 0,
      added: 0,
      updated: 0,
      removed: 0,
      totalRecords: Object.keys(map).length,
    }
  }

  if (missedUpdates >= policy.compactedThresholdMissed) {
    const compacted = manifest.compactedPatches?.find(
      (entry) =>
        entry.fromVersion === workingVersion &&
        entry.toVersion === manifest.latestVersion,
    )

    if (compacted?.path) {
      const patch = await fetchJson<PatchFile>(`/mock-sync/${compacted.path}`)
      applyPatch(map, patch)
      appliedPatches = 1
      added = patch.added.length
      updated = patch.updated.length
      removed = patch.removed.length
      workingVersion = patch.toVersion
      strategy = 'compacted'
    }
  }

  if (workingVersion !== manifest.latestVersion) {
    const baseVersion = workingVersion
    const nextVersions = manifest.versions.filter((entry) => entry.version > baseVersion)

    for (const entry of nextVersions) {
      if (!entry.patchFromPrevious) {
        continue
      }

      const patch = await fetchJson<PatchFile>(`/mock-sync/${entry.patchFromPrevious}`)
      applyPatch(map, patch)
      appliedPatches += 1
      added += patch.added.length
      updated += patch.updated.length
      removed += patch.removed.length
      workingVersion = entry.version
      strategy = 'chain'
    }
  }

  writeStoredCatalogMap(map)
  writeCatalogVersion(workingVersion)

  return {
    fromVersion: previousVersion,
    toVersion: workingVersion,
    strategy,
    appliedPatches,
    added,
    updated,
    removed,
    totalRecords: Object.keys(map).length,
  }
}

export async function syncCatalogFromMockPatches(): Promise<CatalogSyncResult> {
  const manifest = await fetchJson<SyncManifest>('/mock-sync/manifest.json')
  const policy = resolvePolicy(manifest)

  if (hasTauriRuntime()) {
    return syncCatalogWithBackend(manifest, policy)
  }

  return syncCatalogWithLocalStorage(manifest, policy)
}
